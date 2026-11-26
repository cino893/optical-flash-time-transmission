/**
 * Optical Flash Driver supporting:
 *  1. Rear Camera LED Torch via WebRTC MediaTrackConstraints (Android Chrome/Edge/Samsung Internet, etc.)
 *  2. Full-screen High-Contrast Display Flash fallback (iOS Safari, desktop, or browsers without torch API)
 *
 * Implements non-drifting absolute-time bit scheduling using performance.now() and only toggles
 * the hardware torch when the bit value actually changes (matching WOP Torchlight.on/off).
 */

import { buildBitSchedule } from './wop-protocol.js';

export function isLikelyIOS() {
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

export function isLikelyMobile() {
  const ua = navigator.userAgent || '';
  return isLikelyIOS() || /Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);
}

export const HDR_MEDIA_QUERY = '(dynamic-range: high)';

/**
 * True when the current display/browser reports HDR (EDR headroom) capability.
 * Safe to call outside a browser (e.g. Node.js tests) where `window` is undefined.
 */
export function detectHdrDisplaySupport() {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return Boolean(window.matchMedia(HDR_MEDIA_QUERY).matches);
  } catch {
    return false;
  }
}

export function detectEnvironment() {
  const secureContext = Boolean(window.isSecureContext);
  const hasMediaDevices = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  const ios = isLikelyIOS();
  const mobile = isLikelyMobile();
  return {
    secureContext,
    hasMediaDevices,
    ios,
    mobile,
    hdrSupported: detectHdrDisplaySupport(),
  };
}

export function classifyCameraError(err) {
  if (!err) {
    return 'unknown';
  }
  const code = typeof err.code === 'string' ? err.code : '';
  const name = typeof err.name === 'string' ? err.name : '';
  const message = typeof err.message === 'string' ? err.message : '';

  if (code === 'INSECURE_CONTEXT' || /https/i.test(message)) {
    return 'insecure_context';
  }
  if (
    name === 'NotAllowedError' ||
    name === 'PermissionDeniedError' ||
    name === 'SecurityError'
  ) {
    return 'permission_denied';
  }
  if (
    name === 'NotFoundError' ||
    name === 'DevicesNotFoundError' ||
    name === 'OverconstrainedError'
  ) {
    return 'no_camera';
  }
  if (
    name === 'NotReadableError' ||
    name === 'TrackStartError' ||
    name === 'AbortError'
  ) {
    return 'camera_busy';
  }
  return 'unknown';
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Recommend a WOP bit period based on measured rear LED torch toggle latencies.
 */
export function recommendBitPeriodFromLatency(
  medianToggleMs,
  maxToggleMs,
  defaultBitPeriodMs = 30,
) {
  if (maxToggleMs <= 22 && medianToggleMs <= 16) {
    return {
      recommendedBitPeriodMs: defaultBitPeriodMs,
      needsAdjustment: false,
    };
  }
  const recommendedBitPeriodMs = Math.min(
    80,
    Math.max(
      defaultBitPeriodMs,
      Math.ceil((Math.max(medianToggleMs * 1.6, maxToggleMs) + 12) / 5) * 5,
    ),
  );
  return {
    recommendedBitPeriodMs,
    needsAdjustment: recommendedBitPeriodMs > defaultBitPeriodMs,
  };
}

/**
 * High-precision sleep until `targetPerfMs` (performance.now() timeline).
 * Uses setTimeout for the coarse part and spins for the final 4.5 ms to avoid
 * the HTML5 4 ms nested timer clamp and keep optical bit edges crisp.
 */
async function waitUntil(targetPerfMs, signal) {
  while (true) {
    if (signal?.aborted) {
      throw new DOMException('Transmission aborted', 'AbortError');
    }
    const remaining = targetPerfMs - performance.now();
    if (remaining <= 0.4) {
      return;
    }
    if (remaining > 10) {
      await new Promise((resolve) => setTimeout(resolve, Math.floor(remaining - 6)));
    } else if (remaining > 4.5) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    } else {
      // Final sub-4.5ms busy-wait avoids 4ms nested setTimeout clamp
      while (performance.now() < targetPerfMs) {
        if (signal?.aborted) {
          throw new DOMException('Transmission aborted', 'AbortError');
        }
      }
      return;
    }
  }
}

/**
 * Reliable WebRTC torch capability detection.
 * Never treats a non-throwing applyConstraints({ advanced: [{ torch: false }] }) as proof of support,
 * because browsers silently ignore unknown/unsupported advanced constraints on desktops, Safari, and front cameras.
 */
export async function detectTorchCapability(track, { pollAttempts = 5, pollDelayMs = 100 } = {}) {
  if (!track) return false;

  const hasGetCapabilities = typeof track.getCapabilities === 'function';
  if (hasGetCapabilities) {
    const checkCaps = () => {
      try {
        const caps = track.getCapabilities();
        return Boolean(caps && caps.torch === true);
      } catch {
        return false;
      }
    };

    if (checkCaps()) {
      return true;
    }

    // Some Android Chrome Camera2 devices populate capabilities shortly after track start
    // or expose flash/torch capability through ImageCapture.getPhotoCapabilities().
    if (typeof globalThis.ImageCapture === 'function') {
      try {
        const ic = new globalThis.ImageCapture(track);
        if (typeof ic.getPhotoCapabilities === 'function') {
          const photoCaps = await ic.getPhotoCapabilities();
          if (photoCaps?.torch === true) {
            return true;
          }
          if (
            Array.isArray(photoCaps?.fillLightMode) &&
            photoCaps.fillLightMode.includes('torch')
          ) {
            return true;
          }
        }
      } catch {
        // ignore ImageCapture unavailability
      }
    }

    for (let i = 0; i < pollAttempts; i++) {
      if (track.readyState && track.readyState !== 'live') {
        return false;
      }
      await new Promise((r) => setTimeout(r, pollDelayMs));
      if (checkCaps()) {
        return true;
      }
    }
    return false;
  }

  // Fallback only when getCapabilities() is absent: apply torch:true and verify getSettings().torch === true
  if (typeof track.applyConstraints === 'function' && typeof track.getSettings === 'function') {
    try {
      await track.applyConstraints({ advanced: [{ torch: true }] });
      const settings = track.getSettings();
      const confirmed = Boolean(settings && settings.torch === true);
      await track.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
      return confirmed;
    } catch {
      return false;
    }
  }

  return false;
}

export class OpticalFlashDriver {
  constructor() {
    this.stream = null;
    this.track = null;
    this.torchSupported = null; // null = unknown, true/false after probe
    this.torchOn = false;
    this.wakeLock = null;
    this._acquiring = null;
    this._cameraGen = 0;
  }

  get hasActiveCamera() {
    return Boolean(this.track && this.track.readyState === 'live');
  }

  async acquireTorch() {
    if (this.hasActiveCamera && this.torchSupported === true) {
      return { supported: true, stream: this.stream };
    }
    if (this._acquiring) {
      return this._acquiring;
    }

    const gen = ++this._cameraGen;
    const promise = this._acquireTorchInternal(gen);
    this._acquiring = promise;
    try {
      return await promise;
    } finally {
      if (this._acquiring === promise) {
        this._acquiring = null;
      }
    }
  }

  async _acquireTorchInternal(gen) {
    this._stopCurrentTracks();

    if (!window.isSecureContext) {
      this.torchSupported = false;
      const err = new Error('HTTPS is required for camera/flashlight access.');
      err.code = 'INSECURE_CONTEXT';
      err.cameraErrorKind = 'insecure_context';
      throw err;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.torchSupported = false;
      const err = new Error('MediaDevices API is not available in this browser.');
      err.cameraErrorKind = 'unknown';
      throw err;
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });
    } catch (err) {
      const kind = classifyCameraError(err);
      if (kind === 'permission_denied' || kind === 'camera_busy') {
        this.torchSupported = null;
      }
      if (err && typeof err === 'object') {
        try {
          err.cameraErrorKind = kind;
        } catch {
          // ignore non-extensible error object
        }
      }
      throw err;
    }

    // If releaseCamera() was called while getUserMedia was pending, stop stream immediately
    if (gen !== this._cameraGen) {
      stream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          // ignore
        }
      });
      throw new DOMException('Camera acquisition cancelled', 'AbortError');
    }

    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((t) => t.stop());
      const err = new Error('No rear camera video track found.');
      err.name = 'NotFoundError';
      err.cameraErrorKind = 'no_camera';
      throw err;
    }

    const supportsTorch = await detectTorchCapability(track);

    // Re-check cancellation after async capability probe
    if (gen !== this._cameraGen) {
      stream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          // ignore
        }
      });
      throw new DOMException('Camera acquisition cancelled', 'AbortError');
    }

    this.stream = stream;
    this.track = track;
    this.torchSupported = supportsTorch;
    this.torchOn = false;

    if (!supportsTorch) {
      this._stopCurrentTracks();
    }

    return { supported: supportsTorch, stream: this.stream };
  }

  async setTorchState(on) {
    const desired = Boolean(on);
    if (this.torchOn === desired) {
      return false; // No hardware call needed when state unchanged
    }
    if (!this.track || this.track.readyState !== 'live') {
      throw new Error('Camera track is no longer active.');
    }
    this.torchOn = desired;
    await this.track.applyConstraints({
      advanced: [{ torch: desired }],
    });
    return true;
  }

  async forceTorchOff() {
    if (this.track && this.track.readyState === 'live') {
      try {
        this.torchOn = false;
        await this.track.applyConstraints({
          advanced: [{ torch: false }],
        });
      } catch {
        // ignore cleanup error
      }
    }
  }

  async testBlink(durationMs = 220) {
    const res = await this.acquireTorch();
    if (!res.supported) {
      return false;
    }
    try {
      await this.setTorchState(true);
      await new Promise((r) => setTimeout(r, durationMs));
      await this.setTorchState(false);
      return true;
    } finally {
      await this.forceTorchOff();
    }
  }

  async benchmarkTorch(cycles = 3) {
    const res = await this.acquireTorch();
    if (!res.supported) {
      throw new Error('Rear LED torch is not supported by this browser.');
    }

    const totalCycles = Math.max(1, Math.floor(cycles));
    const settleMs = 45;
    const onTimes = [];
    const offTimes = [];

    try {
      await this.forceTorchOff();

      for (let i = 0; i < totalCycles; i++) {
        await new Promise((r) => setTimeout(r, settleMs));
        const tOnStart = performance.now();
        await this.setTorchState(true);
        onTimes.push(performance.now() - tOnStart);

        await new Promise((r) => setTimeout(r, settleMs));
        const tOffStart = performance.now();
        await this.setTorchState(false);
        offTimes.push(performance.now() - tOffStart);
      }

      const allTimes = [...onTimes, ...offTimes];
      const medianOnMs = Number(median(onTimes).toFixed(1));
      const medianOffMs = Number(median(offTimes).toFixed(1));
      const medianToggleMs = Number(median(allTimes).toFixed(1));
      const maxToggleMs = Number(Math.max(...allTimes).toFixed(1));

      return {
        cycles: totalCycles,
        medianOnMs,
        medianOffMs,
        medianToggleMs,
        maxToggleMs,
        ...recommendBitPeriodFromLatency(medianToggleMs, maxToggleMs),
      };
    } finally {
      await this.forceTorchOff();
    }
  }

  _stopCurrentTracks() {
    if (this.track && this.track.readyState === 'live') {
      try {
        if (this.torchOn) {
          this.track.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
        }
      } catch {
        // ignore
      }
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          // ignore
        }
      });
    }
    this.stream = null;
    this.track = null;
    this.torchOn = false;
  }

  releaseCamera() {
    this._cameraGen++;
    this._stopCurrentTracks();
  }

  async requestWakeLock() {
    if (this.wakeLock && !this.wakeLock.released) {
      return;
    }
    try {
      if ('wakeLock' in navigator && navigator.wakeLock?.request) {
        this.wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch {
      this.wakeLock = null;
    }
  }

  async releaseWakeLock() {
    if (this.wakeLock) {
      try {
        await this.wakeLock.release();
      } catch {
        // ignore
      }
      this.wakeLock = null;
    }
  }

  /**
   * Transmit a WOP bit array using either the rear LED torch or a screen-flash callback.
   */
  async transmit({
    txBits,
    bitPeriodMs,
    offsetMs = 0,
    startDelayMs = 0,
    lightMode = 'torch',
    onLightChange = null,
    onProgress = null,
    signal = null,
  }) {
    // Capture reference timestamp before async prep (forceTorchOff / wakeLock)
    // so UTC second-boundary alignment absorbs prep latency cleanly.
    const callPerf = performance.now();

    if (lightMode === 'torch') {
      const res = await this.acquireTorch();
      if (!res.supported) {
        throw new Error('Rear LED torch is not supported by this browser.');
      }
      if (this.torchOn) {
        await this.forceTorchOff();
      }
    }

    await this.requestWakeLock();

    const { schedule, endTimeMs } = buildBitSchedule(txBits, bitPeriodMs, offsetMs);
    let currentState = false;
    let toggleCount = 0;
    let totalAbsErrorMs = 0;
    let maxAbsErrorMs = 0;
    const totalBits = schedule.length;

    const applyOutput = async (on) => {
      if (on === currentState) return;
      currentState = on;
      toggleCount++;
      if (lightMode === 'torch') {
        await this.setTorchState(on);
      }
      if (onLightChange) {
        onLightChange(on);
      }
    };

    try {
      const tOrigin = Math.max(performance.now(), callPerf + Math.max(0, startDelayMs));
      if (tOrigin - performance.now() > 0.5) {
        await waitUntil(tOrigin, signal);
      }

      const txStartPerf = performance.now();

      for (let i = 0; i < totalBits; i++) {
        const step = schedule[i];
        const targetPerf = tOrigin + step.timeMs;
        await waitUntil(targetPerf, signal);

        const actualBefore = performance.now();
        const err = Math.abs(actualBefore - targetPerf);
        totalAbsErrorMs += err;
        if (err > maxAbsErrorMs) maxAbsErrorMs = err;

        await applyOutput(step.bit === 1);

        if (onProgress) {
          onProgress(i + 1, totalBits, step.bit);
        }
      }

      // Hold the final zero bit for one full bitPeriod (matching Encoder.encode)
      await waitUntil(tOrigin + endTimeMs, signal);
      await applyOutput(false);

      const actualDurationMs = Math.round(performance.now() - txStartPerf);
      return {
        actualDurationMs,
        toggleCount,
        avgJitterMs: totalBits > 0 ? Number((totalAbsErrorMs / totalBits).toFixed(1)) : 0,
        maxJitterMs: Number(maxAbsErrorMs.toFixed(1)),
      };
    } finally {
      if (lightMode === 'torch') {
        await this.forceTorchOff();
      }
      if (onLightChange) {
        onLightChange(false);
      }
      await this.releaseWakeLock();
    }
  }
}
