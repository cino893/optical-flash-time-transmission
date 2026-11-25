import {
  WOP,
  buildWopFrame,
  buildAutoSyncedFrame,
  bitsToString,
} from './wop-protocol.js';
import {
  analyzeTimezone,
  getSupportedTimezones,
  getLocalSystemTimezone,
  getLocalParts,
  formatUtcOffset,
} from './timezone-utils.js';
import { OpticalFlashDriver, detectEnvironment } from './flash-driver.js';
import { detectInitialLanguage, createTranslator } from './i18n.js';

const STORAGE_KEYS = {
  lang: 'wop_lang',
  homeTz: 'wop_home_tz',
  travelTz: 'wop_travel_tz',
  bitPeriod: 'wop_bit_period',
  torchOffset: 'wop_torch_offset',
  screenCountdown: 'wop_screen_countdown',
  includeDst: 'wop_include_dst',
  dateRef: 'wop_date_ref',
};

const env = detectEnvironment();
const driver = new OpticalFlashDriver();
const allTimezones = getSupportedTimezones();

const state = {
  lang: detectInitialLanguage(),
  t: null,
  lightMode: 'torch',
  homeTz: loadString(STORAGE_KEYS.homeTz, getLocalSystemTimezone()),
  travelTz: loadString(STORAGE_KEYS.travelTz, pickDefaultTravelTz(getLocalSystemTimezone())),
  bitPeriodMs: loadNumber(STORAGE_KEYS.bitPeriod, WOP.DEFAULT_BIT_PERIOD_MS),
  torchOffsetMs: loadNumber(
    STORAGE_KEYS.torchOffset,
    env.ios ? WOP.APPLE_TORCH_OFFSET_MS : WOP.DEFAULT_TORCH_OFFSET_MS,
  ),
  screenCountdownSec: loadNumber(STORAGE_KEYS.screenCountdown, 2),
  includeDst: loadBool(STORAGE_KEYS.includeDst, true),
  dateRef: loadString(STORAGE_KEYS.dateRef, 'utc'),
  customTimeEnabled: false,
  inspectMode: 'home',
  transmitting: false,
  abortController: null,
};

state.t = createTranslator(state.lang);

// DOM references
const el = {
  liveLedDot: document.getElementById('liveLedDot'),
  utcClock: document.getElementById('utcClock'),
  utcDate: document.getElementById('utcDate'),
  envBadge: document.getElementById('envBadge'),
  srcTorch: document.getElementById('srcTorch'),
  srcScreen: document.getElementById('srcScreen'),
  torchStatusMsg: document.getElementById('torchStatusMsg'),
  torchControlsRow: document.getElementById('torchControlsRow'),
  btnInitTorch: document.getElementById('btnInitTorch'),
  btnTestBlink: document.getElementById('btnTestBlink'),
  btnReleaseCamera: document.getElementById('btnReleaseCamera'),
  chkPreview: document.getElementById('chkPreview'),
  cameraPreviewWrap: document.getElementById('cameraPreviewWrap'),
  cameraVideo: document.getElementById('cameraVideo'),
  homeTimeDisplay: document.getElementById('homeTimeDisplay'),
  homeDateDisplay: document.getElementById('homeDateDisplay'),
  homeSearch: document.getElementById('homeSearch'),
  homeTzSelect: document.getElementById('homeTzSelect'),
  homeStdOffset: document.getElementById('homeStdOffset'),
  homeDstInfo: document.getElementById('homeDstInfo'),
  btnSendHome: document.getElementById('btnSendHome'),
  travelTimeDisplay: document.getElementById('travelTimeDisplay'),
  travelDateDisplay: document.getElementById('travelDateDisplay'),
  travelSearch: document.getElementById('travelSearch'),
  travelTzSelect: document.getElementById('travelTzSelect'),
  travelStdOffset: document.getElementById('travelStdOffset'),
  travelDstInfo: document.getElementById('travelDstInfo'),
  btnSendTravel: document.getElementById('btnSendTravel'),
  txPulseDot: document.getElementById('txPulseDot'),
  txStatusText: document.getElementById('txStatusText'),
  btnCancelTx: document.getElementById('btnCancelTx'),
  txProgressBar: document.getElementById('txProgressBar'),
  txProgressFill: document.getElementById('txProgressFill'),
  bitPeriodRange: document.getElementById('bitPeriodRange'),
  bitPeriodVal: document.getElementById('bitPeriodVal'),
  torchOffsetRange: document.getElementById('torchOffsetRange'),
  torchOffsetVal: document.getElementById('torchOffsetVal'),
  screenCountdownRange: document.getElementById('screenCountdownRange'),
  screenCountdownVal: document.getElementById('screenCountdownVal'),
  dateRefSelect: document.getElementById('dateRefSelect'),
  chkIncludeDst: document.getElementById('chkIncludeDst'),
  chkCustomTime: document.getElementById('chkCustomTime'),
  customTimeWrap: document.getElementById('customTimeWrap'),
  customUtcInput: document.getElementById('customUtcInput'),
  btnResetDefaults: document.getElementById('btnResetDefaults'),
  inspectorSummary: document.getElementById('inspectorSummary'),
  inspectorSegments: document.getElementById('inspectorSegments'),
  waveformCanvas: document.getElementById('waveformCanvas'),
  screenFlashOverlay: document.getElementById('screenFlashOverlay'),
  screenFlashPad: document.getElementById('screenFlashPad'),
  screenOverlayText: document.getElementById('screenOverlayText'),
  screenOverlayProgress: document.getElementById('screenOverlayProgress'),
  btnOverlayCancel: document.getElementById('btnOverlayCancel'),
};

function loadString(key, fallback) {
  try {
    const val = localStorage.getItem(key);
    return val !== null ? val : fallback;
  } catch {
    return fallback;
  }
}

function loadNumber(key, fallback) {
  try {
    const val = localStorage.getItem(key);
    if (val === null) return fallback;
    const n = Number(val);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function loadBool(key, fallback) {
  try {
    const val = localStorage.getItem(key);
    if (val === null) return fallback;
    return val === 'true';
  } catch {
    return fallback;
  }
}

function saveStorage(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // ignore storage quota errors
  }
}

function pickDefaultTravelTz(homeTz) {
  if (homeTz === 'America/New_York') return 'Europe/Warsaw';
  if (homeTz === 'Europe/London') return 'America/New_York';
  return 'America/New_York';
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function pad3(n) {
  return String(n).padStart(3, '0');
}

function formatDstEvent(ev) {
  return `${pad2(ev.day)}.${pad2(ev.month)} ${pad2(ev.hour)}:00`;
}

// ---------- i18n ----------

function applyLanguage(lang) {
  state.lang = lang;
  state.t = createTranslator(lang);
  document.documentElement.lang = lang;
  saveStorage(STORAGE_KEYS.lang, lang);

  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });

  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = state.t(node.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-html]').forEach((node) => {
    node.innerHTML = state.t(node.dataset.i18nHtml);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    node.placeholder = state.t(node.dataset.i18nPlaceholder);
  });

  updateTorchStatusUI();
  updateTimezoneMeta('home');
  updateTimezoneMeta('travel');
  updateInspector();
}

// ---------- Timezone Selectors ----------

function populateTimezoneSelect(selectEl, filterText, selectedValue) {
  const q = (filterText || '').trim().toLowerCase();
  const filtered = q
    ? allTimezones.filter((tz) => tz.toLowerCase().includes(q))
    : allTimezones;

  const list = filtered.includes(selectedValue) || q ? filtered : [selectedValue, ...filtered];
  selectEl.innerHTML = '';

  const frag = document.createDocumentFragment();
  for (const tz of list) {
    const opt = document.createElement('option');
    opt.value = tz;
    opt.textContent = tz.replaceAll('_', ' ');
    if (tz === selectedValue) opt.selected = true;
    frag.appendChild(opt);
  }
  selectEl.appendChild(frag);
}

const tzInfoCache = new Map();
function getTzAnalysis(tzId) {
  const year = new Date().getUTCFullYear();
  const key = `${tzId}:${year}`;
  let info = tzInfoCache.get(key);
  if (!info) {
    info = analyzeTimezone(tzId, year);
    tzInfoCache.set(key, info);
  }
  return info;
}

function updateTimezoneMeta(which) {
  const tzId = which === 'home' ? state.homeTz : state.travelTz;
  const info = getTzAnalysis(tzId);
  const offsetEl = which === 'home' ? el.homeStdOffset : el.travelStdOffset;
  const dstEl = which === 'home' ? el.homeDstInfo : el.travelDstInfo;

  const hemLabel = info.hemisphere === WOP.HEMISPHERE.NORTH ? 'N' : 'S';
  offsetEl.textContent = `${formatUtcOffset(info.standardOffsetMinutes)} (${hemLabel})`;

  if (info.hasDst && info.dst) {
    dstEl.textContent = state.t('dstDates', {
      start: formatDstEvent(info.dst.start),
      stop: formatDstEvent(info.dst.stop),
    });
  } else {
    dstEl.textContent = state.t('dstNone');
  }
}

// ---------- Environment & Torch UI ----------

function updateTorchStatusUI() {
  el.torchStatusMsg.classList.remove('ok', 'warn');

  if (!env.secureContext) {
    el.envBadge.textContent = 'HTTP';
    el.torchStatusMsg.textContent = state.t('torchStatusInsecure');
    el.torchStatusMsg.classList.add('warn');
  } else {
    el.envBadge.textContent = env.ios ? 'iOS · HTTPS' : env.mobile ? 'Mobile · HTTPS' : 'Desktop · HTTPS';
    if (driver.torchSupported === true && driver.hasActiveCamera) {
      el.torchStatusMsg.textContent = state.t('torchStatusReady');
      el.torchStatusMsg.classList.add('ok');
    } else if (driver.torchSupported === false) {
      el.torchStatusMsg.textContent = env.ios
        ? state.t('torchStatusIosWarning')
        : state.t('torchStatusUnsupported');
      el.torchStatusMsg.classList.add('warn');
    } else if (env.ios) {
      el.torchStatusMsg.textContent = state.t('torchStatusIosWarning');
      el.torchStatusMsg.classList.add('warn');
    } else if (!env.mobile && state.lightMode === 'screen') {
      el.torchStatusMsg.textContent = state.t('torchStatusDesktop');
    } else {
      el.torchStatusMsg.textContent = state.t('torchStatusChecking');
    }
  }

  el.srcTorch.checked = state.lightMode === 'torch';
  el.srcScreen.checked = state.lightMode === 'screen';
  el.btnTestBlink.disabled = state.transmitting;
  el.btnReleaseCamera.hidden = !driver.hasActiveCamera;

  updateCameraPreviewVisibility();
}

function updateCameraPreviewVisibility() {
  const show = state.lightMode === 'torch' && el.chkPreview.checked && driver.hasActiveCamera;
  el.cameraPreviewWrap.hidden = !show;
  if (show && driver.stream && el.cameraVideo.srcObject !== driver.stream) {
    el.cameraVideo.srcObject = driver.stream;
  } else if (!show && el.cameraVideo.srcObject) {
    el.cameraVideo.srcObject = null;
  }
}

async function handleInitTorch() {
  try {
    setTxStatus(state.t('statusPreparing'), 'active');
    const res = await driver.acquireTorch();
    if (!res.supported) {
      state.lightMode = 'screen';
      setTxStatus(state.t(env.ios ? 'torchStatusIosWarning' : 'torchStatusUnsupported'), 'error');
    } else {
      state.lightMode = 'torch';
      await driver.testBlink(180);
      setTxStatus(state.t('torchStatusReady'), 'done');
    }
  } catch (err) {
    driver.torchSupported = false;
    state.lightMode = 'screen';
    setTxStatus(state.t('statusError', { msg: err.message || String(err) }), 'error');
  } finally {
    updateTorchStatusUI();
  }
}

// ---------- Clocks ----------

function tickClocks() {
  const now = Date.now();
  const d = new Date(now);
  el.utcClock.textContent = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}.${pad3(d.getUTCMilliseconds())}`;
  el.utcDate.textContent = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

  const homeParts = getLocalParts(now, state.homeTz);
  el.homeTimeDisplay.textContent = `${pad2(homeParts.hour)}:${pad2(homeParts.minute)}:${pad2(homeParts.second)}`;
  el.homeDateDisplay.textContent = `${homeParts.year}-${pad2(homeParts.month)}-${pad2(homeParts.day)}`;

  const travelParts = getLocalParts(now, state.travelTz);
  el.travelTimeDisplay.textContent = `${pad2(travelParts.hour)}:${pad2(travelParts.minute)}:${pad2(travelParts.second)}`;
  el.travelDateDisplay.textContent = `${travelParts.year}-${pad2(travelParts.month)}-${pad2(travelParts.day)}`;
}

// ---------- Protocol Frame Inspector ----------

function getEffectiveTargetMs() {
  if (state.customTimeEnabled && el.customUtcInput.value) {
    const parsed = Date.parse(`${el.customUtcInput.value}Z`);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}

function buildPreviewFrame(mode) {
  const tzId = mode === 'home' ? state.homeTz : state.travelTz;
  const tzInfo = getTzAnalysis(tzId);
  const nowMs = getEffectiveTargetMs();
  const d = new Date(nowMs);
  const dateObj =
    state.dateRef === 'local'
      ? { year: d.getFullYear() % 100, month: d.getMonth() + 1, day: d.getDate() }
      : { year: d.getUTCFullYear() % 100, month: d.getUTCMonth() + 1, day: d.getUTCDate() };

  return buildWopFrame({
    mode,
    timezone: {
      hourShift: tzInfo.hourShift,
      minuteShift: tzInfo.minuteShift,
      hemisphere: tzInfo.hemisphere,
    },
    utcTime: {
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
    },
    date: dateObj,
    dst: state.includeDst && tzInfo.hasDst ? tzInfo.dst : null,
  });
}

function drawWaveform(txBits) {
  const canvas = el.waveformCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Grid baseline
  const hiY = 16;
  const loY = h - 18;
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, hiY);
  ctx.lineTo(w, hiY);
  ctx.moveTo(0, loY);
  ctx.lineTo(w, loY);
  ctx.stroke();

  if (!txBits || txBits.length === 0) return;

  const stepX = w / txBits.length;
  ctx.strokeStyle = '#d4af37';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < txBits.length; i++) {
    const x0 = i * stepX;
    const x1 = (i + 1) * stepX;
    const y = txBits[i] === 1 ? hiY : loY;
    if (i === 0) {
      ctx.moveTo(x0, y);
    } else {
      ctx.lineTo(x0, y);
    }
    ctx.lineTo(x1, y);
  }
  ctx.stroke();
}

function updateInspector() {
  const frame = buildPreviewFrame(state.inspectMode);
  const estSec = (((frame.txBits.length + 1) * state.bitPeriodMs) / 1000).toFixed(2);
  el.inspectorSummary.textContent = state.t('inspectorBitsInfo', {
    raw: frame.rawBits.length,
    stuffed: frame.stuffedBits.length,
    tx: frame.txBits.length,
    sec: estSec,
  });

  drawWaveform(frame.txBits);

  const s = frame.segments;
  const rows = [
    [state.t('inspectorHeader'), bitsToString(s.headerBits)],
    [state.t('inspectorLength'), bitsToString(s.lengthBits)],
    [
      state.t('inspectorMsg1'),
      `${bitsToString(s.subMsg1Opcode)} | TZ:${bitsToString(s.tzBits)} | T:${bitsToString(s.timeBits)} | D:${bitsToString(s.dateBits)}`,
    ],
  ];
  if (frame.hasDst) {
    rows.push([
      state.t('inspectorMsg2'),
      `${bitsToString(s.subMsg2Opcode)} | ${bitsToString(s.subMsg2Payload)}`,
    ]);
  }
  rows.push([state.t('inspectorCrc'), bitsToString(s.crcBits)]);
  rows.push([state.t('inspectorStuffed'), bitsToString(frame.txBits)]);

  el.inspectorSegments.innerHTML = '';
  for (const [label, bits] of rows) {
    const row = document.createElement('div');
    row.className = 'seg-row';
    const lbl = document.createElement('span');
    lbl.className = 'seg-label';
    lbl.textContent = label;
    const val = document.createElement('span');
    val.textContent = bits;
    row.append(lbl, val);
    el.inspectorSegments.appendChild(row);
  }
}

// ---------- Transmission ----------

function setTxStatus(text, mood = 'idle') {
  el.txStatusText.textContent = text;
  el.txPulseDot.className = 'pulse-indicator';
  if (mood === 'active') el.txPulseDot.classList.add('active');
  if (mood === 'done') el.txPulseDot.classList.add('done');
  if (mood === 'error') el.txPulseDot.classList.add('error');
}

function setProgress(pct) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  el.txProgressFill.style.width = `${clamped}%`;
  el.txProgressBar.setAttribute('aria-valuenow', String(clamped));
  el.screenOverlayProgress.style.width = `${clamped}%`;
}

function setButtonsDisabled(disabled) {
  el.btnSendHome.disabled = disabled;
  el.btnSendTravel.disabled = disabled;
  el.btnInitTorch.disabled = disabled;
  el.btnTestBlink.disabled = disabled || state.lightMode !== 'torch';
  el.btnCancelTx.hidden = !disabled;
}

function formatUtcHms(ms) {
  const d = new Date(ms);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

async function runCountdown(seconds, signal, onTick) {
  for (let s = seconds; s > 0; s--) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    onTick(s);
    await new Promise((resolve, reject) => {
      const id = setTimeout(resolve, 1000);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(id);
          reject(new DOMException('Aborted', 'AbortError'));
        },
        { once: true },
      );
    });
  }
}

async function startTransmission(mode) {
  if (state.transmitting) return;

  state.transmitting = true;
  state.abortController = new AbortController();
  const { signal } = state.abortController;
  setButtonsDisabled(true);
  setProgress(0);

  const tzId = mode === 'home' ? state.homeTz : state.travelTz;
  const tzInfo = getTzAnalysis(tzId);
  const dstData = state.includeDst && tzInfo.hasDst ? tzInfo.dst : null;
  let activeLightMode = state.lightMode;

  try {
    // 1. Prepare hardware torch if selected
    if (activeLightMode === 'torch') {
      setTxStatus(state.t('statusPreparing'), 'active');
      try {
        const res = await driver.acquireTorch();
        if (!res.supported) {
          activeLightMode = 'screen';
          state.lightMode = 'screen';
          updateTorchStatusUI();
        }
      } catch (err) {
        driver.torchSupported = false;
        activeLightMode = 'screen';
        state.lightMode = 'screen';
        updateTorchStatusUI();
        void err;
      }
    }

    // 2. If screen flash mode, open fullscreen overlay and give countdown so watch can be positioned
    if (activeLightMode === 'screen') {
      el.screenFlashOverlay.hidden = false;
      el.screenFlashPad.classList.remove('lit', 'tx-active');
      if (typeof el.screenFlashOverlay.requestFullscreen === 'function' && !document.fullscreenElement) {
        el.screenFlashOverlay.requestFullscreen().catch(() => {});
      }
      if (state.screenCountdownSec > 0) {
        await runCountdown(state.screenCountdownSec, signal, (sec) => {
          el.screenOverlayText.textContent = state.t('screenOverlayPrep', { sec });
          setTxStatus(state.t('statusCountdown', { sec }), 'active');
        });
      }
      el.screenOverlayText.textContent = state.t('screenOverlayHint');
      el.screenFlashPad.classList.add('tx-active');
    }

    // 3. Build frame right before sending for exact UTC second synchronization
    let txBits;
    let startDelayMs = 0;
    let targetUtcMs;

    if (state.customTimeEnabled && el.customUtcInput.value) {
      const parsed = Date.parse(`${el.customUtcInput.value}Z`);
      if (!Number.isFinite(parsed)) {
        throw new Error('Invalid custom UTC date/time');
      }
      targetUtcMs = parsed;
      const d = new Date(parsed);
      const frame = buildWopFrame({
        mode,
        timezone: {
          hourShift: tzInfo.hourShift,
          minuteShift: tzInfo.minuteShift,
          hemisphere: tzInfo.hemisphere,
        },
        utcTime: {
          hour: d.getUTCHours(),
          minute: d.getUTCMinutes(),
          second: d.getUTCSeconds(),
        },
        date: {
          year: d.getUTCFullYear() % 100,
          month: d.getUTCMonth() + 1,
          day: d.getUTCDate(),
        },
        dst: dstData,
      });
      txBits = frame.txBits;
      startDelayMs = 60;
    } else {
      const synced = buildAutoSyncedFrame({
        nowMs: Date.now(),
        mode,
        timezone: {
          hourShift: tzInfo.hourShift,
          minuteShift: tzInfo.minuteShift,
          hemisphere: tzInfo.hemisphere,
        },
        dst: dstData,
        bitPeriodMs: state.bitPeriodMs,
        dateRef: state.dateRef,
      });
      txBits = synced.frame.txBits;
      startDelayMs = synced.startDelayMs;
      targetUtcMs = synced.targetUtcMs;
    }

    if (startDelayMs > 40) {
      setTxStatus(state.t('statusWaitingSync', { ms: Math.round(startDelayMs) }), 'active');
    }

    // 4. Transmit optical pulses!
    const stats = await driver.transmit({
      txBits,
      bitPeriodMs: state.bitPeriodMs,
      offsetMs: activeLightMode === 'torch' ? state.torchOffsetMs : 0,
      startDelayMs,
      lightMode: activeLightMode,
      signal,
      onLightChange: (isOn) => {
        el.liveLedDot.classList.toggle('on', isOn);
        el.txPulseDot.classList.toggle('flash-on', isOn);
        if (activeLightMode === 'screen') {
          el.screenFlashPad.classList.toggle('lit', isOn);
        }
      },
      onProgress: (sent, total) => {
        const pct = Math.round((sent / total) * 100);
        setProgress(pct);
        setTxStatus(state.t('statusTransmitting', { sent, total, pct }), 'active');
      },
    });

    setProgress(100);
    setTxStatus(
      state.t('statusDone', {
        utc: formatUtcHms(targetUtcMs),
        bits: txBits.length,
        dur: stats.actualDurationMs,
        jitter: stats.avgJitterMs,
      }),
      'done',
    );
  } catch (err) {
    if (err && err.name === 'AbortError') {
      setTxStatus(state.t('statusCancelled'), 'idle');
      setProgress(0);
    } else {
      setTxStatus(state.t('statusError', { msg: err?.message || String(err) }), 'error');
    }
  } finally {
    el.liveLedDot.classList.remove('on');
    el.txPulseDot.classList.remove('flash-on');
    el.screenFlashPad.classList.remove('lit', 'tx-active');
    el.screenFlashOverlay.hidden = true;
    if (document.fullscreenElement === el.screenFlashOverlay && typeof document.exitFullscreen === 'function') {
      document.exitFullscreen().catch(() => {});
    }
    state.transmitting = false;
    state.abortController = null;
    setButtonsDisabled(false);
    updateTorchStatusUI();
  }
}

function cancelTransmission() {
  if (state.abortController) {
    state.abortController.abort();
  }
}

// ---------- Wiring & Initialization ----------

function initControls() {
  // Language switcher
  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.addEventListener('click', () => applyLanguage(btn.dataset.lang));
  });

  // Light source radios
  el.srcTorch.addEventListener('change', () => {
    if (el.srcTorch.checked) {
      state.lightMode = 'torch';
      updateTorchStatusUI();
    }
  });
  el.srcScreen.addEventListener('change', () => {
    if (el.srcScreen.checked) {
      state.lightMode = 'screen';
      updateTorchStatusUI();
    }
  });

  el.btnInitTorch.addEventListener('click', handleInitTorch);
  el.btnTestBlink.addEventListener('click', async () => {
    if (state.transmitting) return;
    if (state.lightMode === 'screen') {
      el.screenFlashOverlay.hidden = false;
      el.screenFlashPad.classList.add('tx-active', 'lit');
      setTimeout(() => {
        el.screenFlashPad.classList.remove('lit', 'tx-active');
        el.screenFlashOverlay.hidden = true;
      }, 320);
      return;
    }
    try {
      const ok = await driver.testBlink(200);
      if (!ok) {
        state.lightMode = 'screen';
      }
      updateTorchStatusUI();
    } catch (err) {
      setTxStatus(state.t('statusError', { msg: err.message || String(err) }), 'error');
    }
  });
  el.btnReleaseCamera.addEventListener('click', () => {
    driver.releaseCamera();
    el.chkPreview.checked = false;
    updateTorchStatusUI();
  });
  el.chkPreview.addEventListener('change', async () => {
    if (el.chkPreview.checked && !driver.hasActiveCamera) {
      await handleInitTorch();
    }
    updateCameraPreviewVisibility();
  });

  // Timezone selectors + search
  populateTimezoneSelect(el.homeTzSelect, '', state.homeTz);
  populateTimezoneSelect(el.travelTzSelect, '', state.travelTz);

  el.homeSearch.addEventListener('input', () => {
    populateTimezoneSelect(el.homeTzSelect, el.homeSearch.value, state.homeTz);
    if (el.homeTzSelect.options.length > 0 && !Array.from(el.homeTzSelect.options).some((o) => o.value === state.homeTz)) {
      state.homeTz = el.homeTzSelect.options[0].value;
      saveStorage(STORAGE_KEYS.homeTz, state.homeTz);
      updateTimezoneMeta('home');
      updateInspector();
    }
  });
  el.homeTzSelect.addEventListener('change', () => {
    state.homeTz = el.homeTzSelect.value;
    saveStorage(STORAGE_KEYS.homeTz, state.homeTz);
    updateTimezoneMeta('home');
    updateInspector();
    tickClocks();
  });

  el.travelSearch.addEventListener('input', () => {
    populateTimezoneSelect(el.travelTzSelect, el.travelSearch.value, state.travelTz);
    if (el.travelTzSelect.options.length > 0 && !Array.from(el.travelTzSelect.options).some((o) => o.value === state.travelTz)) {
      state.travelTz = el.travelTzSelect.options[0].value;
      saveStorage(STORAGE_KEYS.travelTz, state.travelTz);
      updateTimezoneMeta('travel');
      updateInspector();
    }
  });
  el.travelTzSelect.addEventListener('change', () => {
    state.travelTz = el.travelTzSelect.value;
    saveStorage(STORAGE_KEYS.travelTz, state.travelTz);
    updateTimezoneMeta('travel');
    updateInspector();
    tickClocks();
  });

  // Send & cancel buttons
  el.btnSendHome.addEventListener('click', () => startTransmission('home'));
  el.btnSendTravel.addEventListener('click', () => startTransmission('travel'));
  el.btnCancelTx.addEventListener('click', cancelTransmission);
  el.btnOverlayCancel.addEventListener('click', cancelTransmission);

  // Calibration controls
  el.bitPeriodRange.value = String(state.bitPeriodMs);
  el.bitPeriodVal.textContent = `${state.bitPeriodMs} ms`;
  el.bitPeriodRange.addEventListener('input', () => {
    state.bitPeriodMs = Number(el.bitPeriodRange.value);
    el.bitPeriodVal.textContent = `${state.bitPeriodMs} ms`;
    saveStorage(STORAGE_KEYS.bitPeriod, state.bitPeriodMs);
    updateInspector();
  });

  el.torchOffsetRange.value = String(state.torchOffsetMs);
  el.torchOffsetVal.textContent = `${state.torchOffsetMs} ms`;
  el.torchOffsetRange.addEventListener('input', () => {
    state.torchOffsetMs = Number(el.torchOffsetRange.value);
    el.torchOffsetVal.textContent = `${state.torchOffsetMs} ms`;
    saveStorage(STORAGE_KEYS.torchOffset, state.torchOffsetMs);
  });

  el.screenCountdownRange.value = String(state.screenCountdownSec);
  el.screenCountdownVal.textContent = `${state.screenCountdownSec} s`;
  el.screenCountdownRange.addEventListener('input', () => {
    state.screenCountdownSec = Number(el.screenCountdownRange.value);
    el.screenCountdownVal.textContent = `${state.screenCountdownSec} s`;
    saveStorage(STORAGE_KEYS.screenCountdown, state.screenCountdownSec);
  });

  el.dateRefSelect.value = state.dateRef;
  el.dateRefSelect.addEventListener('change', () => {
    state.dateRef = el.dateRefSelect.value;
    saveStorage(STORAGE_KEYS.dateRef, state.dateRef);
    updateInspector();
  });

  el.chkIncludeDst.checked = state.includeDst;
  el.chkIncludeDst.addEventListener('change', () => {
    state.includeDst = el.chkIncludeDst.checked;
    saveStorage(STORAGE_KEYS.includeDst, state.includeDst);
    updateInspector();
  });

  el.chkCustomTime.addEventListener('change', () => {
    state.customTimeEnabled = el.chkCustomTime.checked;
    el.customTimeWrap.hidden = !state.customTimeEnabled;
    if (state.customTimeEnabled && !el.customUtcInput.value) {
      const now = new Date();
      el.customUtcInput.value = `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}T${pad2(now.getUTCHours())}:${pad2(now.getUTCMinutes())}:${pad2(now.getUTCSeconds())}`;
    }
    updateInspector();
  });
  el.customUtcInput.addEventListener('input', updateInspector);

  el.btnResetDefaults.addEventListener('click', () => {
    state.bitPeriodMs = WOP.DEFAULT_BIT_PERIOD_MS;
    state.torchOffsetMs = env.ios ? WOP.APPLE_TORCH_OFFSET_MS : WOP.DEFAULT_TORCH_OFFSET_MS;
    state.screenCountdownSec = 2;
    state.includeDst = true;
    state.dateRef = 'utc';
    state.customTimeEnabled = false;

    el.bitPeriodRange.value = String(state.bitPeriodMs);
    el.bitPeriodVal.textContent = `${state.bitPeriodMs} ms`;
    el.torchOffsetRange.value = String(state.torchOffsetMs);
    el.torchOffsetVal.textContent = `${state.torchOffsetMs} ms`;
    el.screenCountdownRange.value = String(state.screenCountdownSec);
    el.screenCountdownVal.textContent = `${state.screenCountdownSec} s`;
    el.dateRefSelect.value = state.dateRef;
    el.chkIncludeDst.checked = true;
    el.chkCustomTime.checked = false;
    el.customTimeWrap.hidden = true;

    saveStorage(STORAGE_KEYS.bitPeriod, state.bitPeriodMs);
    saveStorage(STORAGE_KEYS.torchOffset, state.torchOffsetMs);
    saveStorage(STORAGE_KEYS.screenCountdown, state.screenCountdownSec);
    saveStorage(STORAGE_KEYS.includeDst, state.includeDst);
    saveStorage(STORAGE_KEYS.dateRef, state.dateRef);
    updateInspector();
  });

  // Inspector mode tabs
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.inspectMode = btn.dataset.inspect;
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
      updateInspector();
    });
  });

  // Allow Escape key to cancel active transmission (especially useful in fullscreen monitor mode)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.transmitting) {
      cancelTransmission();
    }
  });

  // Clean up camera if tab is closed/hidden
  window.addEventListener('pagehide', () => driver.releaseCamera());
}

initControls();
applyLanguage(state.lang);
tickClocks();
setInterval(tickClocks, 100);
setInterval(() => {
  const details = document.getElementById('advancedDetails');
  if (details && details.open && !state.customTimeEnabled) {
    updateInspector();
  }
}, 1000);
