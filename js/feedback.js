/**
 * Audio & haptic feedback helper so users holding the phone face-down (rear LED aimed at the watch)
 * immediately know when transmission starts, finishes, or is cancelled.
 */

let audioCtx = null;

function ensureAudioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playTone(freqHz, durationMs, delaySec = 0, gainPeak = 0.08) {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime + delaySec;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freqHz, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainPeak, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durationMs / 1000 + 0.02);
  } catch {
    // Ignore audio restrictions
  }
}

function vibrate(pattern) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  } catch {
    // Ignore unsupported vibration
  }
}

export function unlockFeedbackAudio() {
  ensureAudioContext();
}

export function feedbackStart(enabled = true) {
  if (!enabled) return;
  vibrate(30);
  playTone(740, 55, 0, 0.06);
}

export function feedbackSuccess(enabled = true) {
  if (!enabled) return;
  vibrate([70, 55, 130]);
  playTone(880, 90, 0, 0.08);
  playTone(1174.66, 160, 0.1, 0.09);
}

export function feedbackError(enabled = true) {
  if (!enabled) return;
  vibrate([120, 60, 120]);
  playTone(330, 140, 0, 0.07);
}
