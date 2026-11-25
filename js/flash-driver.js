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
  };
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
 * Uses setTimeout for the coarse part and short yields for the final ~5 ms so bit edges stay tight.
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
    if (remaining > 8) {
      await new Promise((resolve) => setTimeout(resolve, Math.floor(remaining - 5)));
    } else if (remaining > 2) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    } else {
      // Final sub-2ms busy-wait for crisp optical edges
      while (performance.now() < targetPerfMs) {
        if (signal?.aborted) {
          throw new DOMException('Transmission aborted', 'AbortError');
        }
      }
      return;
    }
  }
}

export class OpticalFlashDriver {
  constructor() {
    this.stream = null;
    this.track = null;
    this.torchSupported = null; // null = unknown, true/false after probe
    this.torchOn = false;
    this.wakeLock = null;
  }

  get hasActiveCamera() {
    return Boolean(this.track && this.track.readyState === 'live');
  }

  async acquireTorch() {
    if (this.hasActiveCamera && this.torchSupported === true) {
      return { supported: true, stream: this.stream };
    }

    this.releaseCamera();

    if (!window.isSecureContext) {
      this.torchSupported = false;
      throw new Error('HTTPS is required for camera/flashlight access.');
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.torchSupported = false;
      throw new Error('MediaDevices API is not available in this browser.');
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
      audio: false,
    });

    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((t) => t.stop());
      this.torchSupported = false;
      throw new Error('No rear camera video track found.');
    }

    let supportsTorch = false;
    try {
      const caps = typeof track.getCapabilities === 'function' ? track.getCapabilities() : null;
      if (caps && 'torch' in caps && caps.torch) {
        supportsTorch = true;
      } else {
        // Fallback probe: try applying torch: false directly
        await track.applyConstraints({ advanced: [{ torch: false }] });
        supportsTorch = true;
      }
    } catch {
      supportsTorch = false;
    }

    this.stream = stream;
    this.track = track;
    this.torchSupported = supportsTorch;
    this.torchOn = false;

    if (!supportsTorch) {
      this.releaseCamera();
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

  releaseCamera() {
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

  async requestWakeLock() {
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
    if (lightMode === 'torch') {
      const res = await this.acquireTorch();
      if (!res.supported) {
        throw new Error('Rear LED torch is not supported by this browser.');
      }
      await this.forceTorchOff();
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
      const tOrigin = performance.now() + Math.max(0, startDelayMs);
      if (startDelayMs > 0) {
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
