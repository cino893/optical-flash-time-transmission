/**
 * Optical Flash Driver supporting:
 *  1. Rear Camera LED Torch via WebRTC MediaTrackConstraints (Android Chrome/Edge/Samsung Internet, etc.)
 *  2. Full-screen High-Contrast Display Flash fallback (iOS Safari, desktop, or browsers without torch API)
 *
 * Implements non-drifting absolute-time bit scheduling using performance.now() and only toggles
 * the hardware torch when the bit value actually changes (matching WOP Torchlight.on/off).
 * Also provides passive (prompt-free) capability detection and display refresh-rate measurement
 * used to pick a frame-locked Screen Flash bit period.
 */

import { buildBitSchedule } from './wop-protocol.js';

export function isLikelyIOS() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

export function isLikelyMobile() {
  if (typeof navigator === 'undefined') return false;
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

/**
 * Widest color gamut reported by the display: 'rec2020' | 'p3' | 'srgb'.
 */
export function detectColorGamut() {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return 'srgb';
    }
    if (window.matchMedia('(color-gamut: rec2020)').matches) return 'rec2020';
    if (window.matchMedia('(color-gamut: p3)').matches) return 'p3';
  } catch {
    // ignore unsupported media query
  }
  return 'srgb';
}

/**
 * Purely synchronous, passive capability detection (never triggers a permission prompt).
 */
export function detectEnvironment() {
  const hasWindow = typeof window !== 'undefined';
  const hasNavigator = typeof navigator !== 'undefined';
  const hasDocument = typeof document !== 'undefined';
  const secureContext = Boolean(hasWindow && window.isSecureContext);
  const hasMediaDevices = Boolean(
    hasNavigator && navigator.mediaDevices && navigator.mediaDevices.getUserMedia,
  );
  const ios = isLikelyIOS();
  const mobile = isLikelyMobile();
  return {
    secureContext,
    hasMediaDevices,
    ios,
    mobile,
    hdrSupported: detectHdrDisplaySupport(),
    colorGamut: detectColorGamut(),
    hasWakeLock: Boolean(hasNavigator && 'wakeLock' in navigator && navigator.wakeLock?.request),
    hasVibration: Boolean(hasNavigator && typeof navigator.vibrate === 'function'),
    hasWebAudio: Boolean(hasWindow && (window.AudioContext || window.webkitAudioContext)),
    hasFullscreen: Boolean(
      hasDocument &&
        (document.fullscreenEnabled ||
          typeof document.documentElement?.requestFullscreen === 'function'),
    ),
    devicePixelRatio: hasWindow ? window.devicePixelRatio || 1 : 1,
  };
}

/**
 * Passive camera presence check via enumerateDevices() — never prompts for permission.
 * Resolves to `{ hasVideoInput, videoInputCount }`, or `null` when the API is unavailable/fails.
 */
export async function detectCameraPresence() {
  try {
    const mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
    if (!mediaDevices || typeof mediaDevices.enumerateDevices !== 'function') {
      return null;
    }
    const devices = await mediaDevices.enumerateDevices();
    if (!Array.isArray(devices)) {
      return null;
    }
    const videoInputCount = devices.filter((d) => d && d.kind === 'videoinput').length;
    return { hasVideoInput: videoInputCount > 0, videoInputCount };
  } catch {
    return null;
  }
}

// ---------- Display refresh rate detection & frame-locked screen bit period ----------

export const STANDARD_REFRESH_RATES_HZ = [24, 30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240];
const REFRESH_SNAP_TOLERANCE = 0.045;
const MIN_REFRESH_HZ = 24;
const MAX_REFRESH_HZ = 360;
const MAX_FRAME_DELTA_MS = 100;
const MIN_FRAME_DELTA_MS = 1;

export const DEFAULT_SCREEN_BIT_PERIOD_MS = 50;
const SCREEN_PERIOD_MIN_MS = 30;
const SCREEN_PERIOD_MAX_MS = 60;
const SCREEN_PERIOD_PREFERRED_MAX_MS = 50;
const SCREEN_PERIOD_EXTENDED_MAX_MS = 100;

const round3 = (v) => Math.round(v * 1000) / 1000;

/**
 * Snap a measured refresh rate to the nearest standard rate when within ±4.5%,
 * otherwise round to the nearest integer clamped to [24, 360]. Invalid input → null.
 */
export function snapRefreshRateHz(rawHz) {
  if (typeof rawHz !== 'number' || !Number.isFinite(rawHz) || rawHz <= 0) {
    return null;
  }
  let best = null;
  let bestRel = Infinity;
  for (const std of STANDARD_REFRESH_RATES_HZ) {
    const rel = Math.abs(rawHz - std) / std;
    if (rel < bestRel) {
      bestRel = rel;
      best = std;
    }
  }
  if (bestRel <= REFRESH_SNAP_TOLERANCE) {
    return best;
  }
  return Math.round(Math.min(MAX_REFRESH_HZ, Math.max(MIN_REFRESH_HZ, rawHz)));
}

function isDocumentHidden() {
  return typeof document !== 'undefined' && Boolean(document.hidden);
}

/**
 * Measure the display refresh rate from requestAnimationFrame deltas.
 * Discards the warm-up frame and outlier deltas (> 100 ms pauses or < 1 ms duplicates).
 * Resolves to `{ hz, rawHz, frameMs }` or `null` when rAF is unavailable, the page is
 * (or becomes) hidden, or the timeout fires before enough frames were sampled.
 */
export function measureDisplayRefreshRate({ sampleFrames = 24, timeoutMs = 1200 } = {}) {
  const raf =
    typeof globalThis.requestAnimationFrame === 'function'
      ? globalThis.requestAnimationFrame.bind(globalThis)
      : null;
  if (!raf || isDocumentHidden()) {
    return Promise.resolve(null);
  }
  const caf =
    typeof globalThis.cancelAnimationFrame === 'function'
      ? globalThis.cancelAnimationFrame.bind(globalThis)
      : null;
  const targetSamples = Number.isFinite(sampleFrames) ? Math.max(3, Math.floor(sampleFrames)) : 24;
  const minPartialSamples = Math.max(5, Math.ceil(targetSamples / 2));
  const waitMs = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 1200;

  return new Promise((resolve) => {
    const deltas = [];
    let warmedUp = false;
    let prevTs = null;
    let rafId = null;
    let timer = null;
    let done = false;

    const summarize = () => {
      if (!deltas.length) return null;
      const medianFrameMs = median(deltas);
      if (!(medianFrameMs > 0)) return null;
      const rawHz = 1000 / medianFrameMs;
      const hz = snapRefreshRateHz(rawHz);
      if (!hz) return null;
      return {
        hz,
        rawHz: Number(rawHz.toFixed(2)),
        frameMs: Number(medianFrameMs.toFixed(3)),
      };
    };

    const finish = (result) => {
      if (done) return;
      done = true;
      if (timer !== null) clearTimeout(timer);
      if (rafId !== null && caf) {
        try {
          caf(rafId);
        } catch {
          // ignore
        }
      }
      resolve(result);
    };

    const onFrame = (ts) => {
      rafId = null;
      if (done) return;
      if (isDocumentHidden()) {
        finish(null);
        return;
      }
      const now = Number.isFinite(ts) ? ts : performance.now();
      if (!warmedUp) {
        warmedUp = true;
      } else if (prevTs === null) {
        prevTs = now;
      } else {
        const delta = now - prevTs;
        prevTs = now;
        if (delta >= MIN_FRAME_DELTA_MS && delta <= MAX_FRAME_DELTA_MS) {
          deltas.push(delta);
        }
      }
      if (deltas.length >= targetSamples) {
        finish(summarize());
        return;
      }
      try {
        rafId = raf(onFrame);
      } catch {
        finish(null);
      }
    };

    timer = setTimeout(() => {
      finish(deltas.length >= minPartialSamples ? summarize() : null);
    }, waitMs);

    try {
      rafId = raf(onFrame);
    } catch {
      finish(null);
    }
  });
}

function screenPeriodBandDistance(ms) {
  if (ms < SCREEN_PERIOD_MIN_MS) return SCREEN_PERIOD_MIN_MS - ms;
  if (ms > SCREEN_PERIOD_PREFERRED_MAX_MS) return ms - SCREEN_PERIOD_PREFERRED_MAX_MS;
  return 0;
}

function pickFrameLockedPeriod(frameMs, minMs, maxMs, { shortestFirst = false } = {}) {
  let best = null;
  for (let frames = 2; frames * frameMs <= maxMs + 0.5; frames++) {
    const exact = frames * frameMs;
    const bitPeriodMs = Math.round(exact);
    if (bitPeriodMs < minMs || bitPeriodMs > maxMs) continue;
    const cand = {
      bitPeriodMs,
      framesPerBit: frames,
      exactMs: round3(exact),
      errorMs: round3(Math.abs(bitPeriodMs - exact)),
    };
    if (shortestFirst) {
      return cand;
    }
    if (!best) {
      best = cand;
      continue;
    }
    const candExact = cand.errorMs < 0.005;
    const bestExact = best.errorMs < 0.005;
    let better;
    if (candExact !== bestExact) {
      better = candExact;
    } else if (!candExact && Math.abs(cand.errorMs - best.errorMs) > 1e-9) {
      better = cand.errorMs < best.errorMs;
    } else {
      const dc = screenPeriodBandDistance(cand.bitPeriodMs);
      const db = screenPeriodBandDistance(best.bitPeriodMs);
      better = dc !== db ? dc < db : cand.bitPeriodMs < best.bitPeriodMs;
    }
    if (better) best = cand;
  }
  return best;
}

/**
 * Pick the cleanest integer screen bit period in [30..60] ms spanning an integer number
 * of display frames (>= 2): exact multiples first, then minimal quantization error,
 * then closest to the 30–50 ms band (shorter wins ties). Very low refresh rates
 * (< ~34 Hz) fall back to the shortest (2-frame) period up to 100 ms.
 */
export function recommendScreenBitPeriodFromHz(hz) {
  const fallback = {
    bitPeriodMs: DEFAULT_SCREEN_BIT_PERIOD_MS,
    framesPerBit: null,
    exactMs: DEFAULT_SCREEN_BIT_PERIOD_MS,
    errorMs: null,
  };
  if (typeof hz !== 'number' || !Number.isFinite(hz) || hz <= 0 || hz > 1000) {
    return fallback;
  }
  const frameMs = 1000 / hz;
  return (
    pickFrameLockedPeriod(frameMs, SCREEN_PERIOD_MIN_MS, SCREEN_PERIOD_MAX_MS) ||
    pickFrameLockedPeriod(frameMs, SCREEN_PERIOD_MAX_MS + 1, SCREEN_PERIOD_EXTENDED_MAX_MS, {
      shortestFirst: true,
    }) ||
    fallback
  );
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
