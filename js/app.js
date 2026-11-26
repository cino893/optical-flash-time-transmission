import {
  WOP,
  buildWopFrame,
  buildAutoSyncedFrame,
  bitsToString,
} from './wop-protocol.js?v=10';
import {
  analyzeTimezone,
  getSupportedTimezones,
  getLocalSystemTimezone,
  getLocalParts,
  formatUtcOffset,
} from './timezone-utils.js?v=10';
import { OpticalFlashDriver, detectEnvironment, classifyCameraError } from './flash-driver.js?v=10';
import { detectInitialLanguage, createTranslator } from './i18n.js?v=10';
import { syncNetworkUtcOffset } from './time-sync.js?v=10';
import {
  unlockFeedbackAudio,
  feedbackStart,
  feedbackSuccess,
  feedbackError,
} from './feedback.js?v=10';

const DEFAULT_SCREEN_BIT_PERIOD_MS = 50;

const STORAGE_KEYS = {
  lang: 'wop_lang',
  lightMode: 'wop_light_mode',
  homeTz: 'wop_home_tz',
  travelTz: 'wop_travel_tz',
  bitPeriod: 'wop_bit_period',
  screenBitPeriod: 'wop_screen_bit_period',
  torchOffset: 'wop_torch_offset',
  screenCountdown: 'wop_screen_countdown',
  txDurationComp: 'wop_tx_duration_comp',
  includeDst: 'wop_include_dst',
  feedback: 'wop_feedback',
  dateRef: 'wop_date_ref',
};

const env = detectEnvironment();
const driver = new OpticalFlashDriver();
const allTimezones = getSupportedTimezones();

const clampInt = (val, min, max) => Math.max(min, Math.min(max, Math.round(val)));
const getSafeOffsetLimit = (bitPeriodMs) =>
  Math.min(WOP.MAX_OFFSET_MS, Math.max(0, Math.floor(bitPeriodMs / 2)));

const initialBitPeriodMs = clampInt(
  loadNumber(STORAGE_KEYS.bitPeriod, WOP.DEFAULT_BIT_PERIOD_MS),
  WOP.MIN_BIT_PERIOD_MS,
  WOP.MAX_BIT_PERIOD_MS,
);
const initialOffsetLimit = getSafeOffsetLimit(initialBitPeriodMs);

const state = {
  lang: detectInitialLanguage(),
  t: null,
  lightMode: loadLightMode(),
  homeTz: loadString(STORAGE_KEYS.homeTz, getLocalSystemTimezone()),
  travelTz: loadString(STORAGE_KEYS.travelTz, pickDefaultTravelTz(getLocalSystemTimezone())),
  bitPeriodMs: initialBitPeriodMs,
  screenBitPeriodMs: clampInt(
    loadNumber(STORAGE_KEYS.screenBitPeriod, DEFAULT_SCREEN_BIT_PERIOD_MS),
    WOP.MIN_BIT_PERIOD_MS,
    WOP.MAX_BIT_PERIOD_MS,
  ),
  torchOffsetMs: clampInt(
    loadNumber(
      STORAGE_KEYS.torchOffset,
      env.ios ? WOP.APPLE_TORCH_OFFSET_MS : WOP.DEFAULT_TORCH_OFFSET_MS,
    ),
    Math.max(-20, -initialOffsetLimit),
    initialOffsetLimit,
  ),
  screenCountdownSec: clampInt(loadNumber(STORAGE_KEYS.screenCountdown, 2), 0, 10),
  txDurationComp: loadBool(STORAGE_KEYS.txDurationComp, true),
  includeDst: loadBool(STORAGE_KEYS.includeDst, true),
  feedbackEnabled: loadBool(STORAGE_KEYS.feedback, true),
  dateRef: loadString(STORAGE_KEYS.dateRef, 'utc'),
  utcOffsetMs: 0,
  timeSyncInfo: null,
  timeSyncBusy: false,
  torchBench: null,
  cameraErrorKind: null,
  cameraBusy: false,
  screenTestBlinkTimer: null,
  customTimeEnabled: false,
  inspectMode: 'home',
  transmitting: false,
  abortController: null,
  toast: null,
};

state.t = createTranslator(state.lang);

// DOM references
const el = {
  liveLedDot: document.getElementById('liveLedDot'),
  utcClock: document.getElementById('utcClock'),
  utcDate: document.getElementById('utcDate'),
  btnSyncTime: document.getElementById('btnSyncTime'),
  timeSyncText: document.getElementById('timeSyncText'),
  envBadge: document.getElementById('envBadge'),
  optScreenLabel: document.getElementById('optScreenLabel'),
  srcTorch: document.getElementById('srcTorch'),
  srcScreen: document.getElementById('srcScreen'),
  torchStatusMsg: document.getElementById('torchStatusMsg'),
  torchControlsRow: document.getElementById('torchControlsRow'),
  btnInitTorch: document.getElementById('btnInitTorch'),
  btnTestBlink: document.getElementById('btnTestBlink'),
  btnReleaseCamera: document.getElementById('btnReleaseCamera'),
  btnSwitchToScreen: document.getElementById('btnSwitchToScreen'),
  previewToggleWrap: document.getElementById('previewToggleWrap'),
  chkPreview: document.getElementById('chkPreview'),
  cameraPreviewWrap: document.getElementById('cameraPreviewWrap'),
  cameraVideo: document.getElementById('cameraVideo'),
  btnSwapTz: document.getElementById('btnSwapTz'),
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
  txToast: document.getElementById('txToast'),
  txToastIcon: document.getElementById('txToastIcon'),
  txToastTitle: document.getElementById('txToastTitle'),
  txToastMessage: document.getElementById('txToastMessage'),
  txToastProgressTrack: document.getElementById('txToastProgressTrack'),
  txToastProgressFill: document.getElementById('txToastProgressFill'),
  btnToastSwitchScreen: document.getElementById('btnToastSwitchScreen'),
  btnToastCancel: document.getElementById('btnToastCancel'),
  btnToastClose: document.getElementById('btnToastClose'),
  bitPeriodRange: document.getElementById('bitPeriodRange'),
  bitPeriodNum: document.getElementById('bitPeriodNum'),
  screenBitPeriodRange: document.getElementById('screenBitPeriodRange'),
  screenBitPeriodNum: document.getElementById('screenBitPeriodNum'),
  torchOffsetRange: document.getElementById('torchOffsetRange'),
  torchOffsetNum: document.getElementById('torchOffsetNum'),
  screenCountdownRange: document.getElementById('screenCountdownRange'),
  screenCountdownNum: document.getElementById('screenCountdownNum'),
  dateRefSelect: document.getElementById('dateRefSelect'),
  chkTxDurationComp: document.getElementById('chkTxDurationComp'),
  chkFeedback: document.getElementById('chkFeedback'),
  chkIncludeDst: document.getElementById('chkIncludeDst'),
  chkCustomTime: document.getElementById('chkCustomTime'),
  customTimeWrap: document.getElementById('customTimeWrap'),
  customUtcInput: document.getElementById('customUtcInput'),
  btnResetDefaults: document.getElementById('btnResetDefaults'),
  sensorDiagramImg: document.getElementById('sensorDiagramImg'),
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

function loadLightMode() {
  const saved = loadString(STORAGE_KEYS.lightMode, 'torch');
  return saved === 'screen' ? 'screen' : 'torch';
}

function getCorrectedNowMs() {
  return Date.now() + state.utcOffsetMs;
}

function getActiveBitPeriodMs(lightMode = state.lightMode) {
  return lightMode === 'screen' ? state.screenBitPeriodMs : state.bitPeriodMs;
}

function setLightMode(mode) {
  state.lightMode = mode === 'screen' ? 'screen' : 'torch';
  if (state.lightMode === 'screen') {
    state.cameraErrorKind = null;
    if (state.toast && state.toast.kind === 'error' && state.toast.showSwitchToScreen) {
      hideToast();
    }
  }
  saveStorage(STORAGE_KEYS.lightMode, state.lightMode);
  updateTorchStatusUI();
  updateInspector();
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
    const key = node.dataset.i18n;
    if (state.t.has(key)) {
      node.textContent = state.t(key);
    }
  });
  document.querySelectorAll('[data-i18n-html]').forEach((node) => {
    const key = node.dataset.i18nHtml;
    if (state.t.has(key)) {
      node.innerHTML = state.t(key);
    }
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    const key = node.dataset.i18nPlaceholder;
    if (state.t.has(key)) {
      node.placeholder = state.t(key);
    }
  });

  if (el.sensorDiagramImg) {
    el.sensorDiagramImg.src =
      lang === 'pl'
        ? 'assets/conquest-vhp-gmt-diagram-pl.svg'
        : 'assets/conquest-vhp-gmt-diagram.svg';
    el.sensorDiagramImg.alt = state.t('sensorDiagramAlt');
  }

  updateTimeSyncUI();
  updateTorchStatusUI();
  updateTimezoneMeta('home');
  updateTimezoneMeta('travel');
  updateInspector();
  renderToast();
}

// ---------- Network UTC Time Sync ----------

function updateTimeSyncUI() {
  if (!el.btnSyncTime || !el.timeSyncText) return;
  el.btnSyncTime.disabled = state.timeSyncBusy;
  el.btnSyncTime.classList.toggle('syncing', state.timeSyncBusy);

  if (state.timeSyncBusy) {
    el.btnSyncTime.classList.remove('synced');
    el.timeSyncText.textContent = state.t('timeSyncSyncing');
    el.btnSyncTime.title = state.t('timeSyncTooltip');
    return;
  }

  const info = state.timeSyncInfo;
  if (info && info.synced) {
    el.btnSyncTime.classList.add('synced');
    const offset = state.utcOffsetMs;
    const sign = offset >= 0 ? '+' : '';
    if (Math.abs(offset) < 10) {
      el.timeSyncText.textContent = state.t('timeSyncOk');
    } else {
      el.timeSyncText.textContent = state.t('timeSyncOffset', {
        sign,
        ms: offset,
      });
    }
    el.btnSyncTime.title = state.t('timeSyncTooltipSynced', {
      source: info.source,
      rtt: info.rttMs,
      sign,
      ms: offset,
    });
  } else {
    el.btnSyncTime.classList.remove('synced');
    el.timeSyncText.textContent = state.t('timeSyncDevice');
    el.btnSyncTime.title = state.t('timeSyncTooltip');
  }
}

async function runTimeSync() {
  if (state.timeSyncBusy) return;
  state.timeSyncBusy = true;
  updateTimeSyncUI();
  try {
    const info = await syncNetworkUtcOffset();
    state.timeSyncInfo = info;
    state.utcOffsetMs = info.synced ? info.offsetMs : 0;
  } catch {
    state.timeSyncInfo = {
      synced: false,
      source: 'device',
      precision: 'local',
      offsetMs: 0,
      rttMs: 0,
    };
    state.utcOffsetMs = 0;
  } finally {
    state.timeSyncBusy = false;
    updateTimeSyncUI();
    tickClocks();
    updateInspector();
  }
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

function getCameraErrorMessage(kind, err = null) {
  switch (kind) {
    case 'permission_denied':
      return state.t('torchStatusPermissionDenied');
    case 'no_camera':
      return state.t('torchStatusNoCamera');
    case 'camera_busy':
      return state.t('torchStatusCameraBusy');
    case 'insecure_context':
      return state.t('torchStatusInsecure');
    case 'no_torch':
      return state.t(env.ios ? 'torchStatusIosWarning' : 'torchStatusUnsupported');
    default:
      return state.t('statusError', { msg: err?.message || String(err || 'Unknown camera error') });
  }
}

async function initCameraPermissionMonitor() {
  try {
    if (!navigator.permissions || typeof navigator.permissions.query !== 'function') {
      return;
    }
    const permStatus = await navigator.permissions.query({ name: 'camera' });
    if (permStatus.state === 'denied') {
      state.cameraErrorKind = 'permission_denied';
      updateTorchStatusUI();
    }
    permStatus.onchange = () => {
      if (permStatus.state === 'granted') {
        state.cameraErrorKind = null;
        updateTorchStatusUI();
      } else if (permStatus.state === 'denied') {
        state.cameraErrorKind = 'permission_denied';
        updateTorchStatusUI();
      }
    };
  } catch {
    // Safari / Firefox may not support querying 'camera' permission
  }
}

function updateTorchStatusUI() {
  el.torchStatusMsg.classList.remove('ok', 'warn');
  const isScreen = state.lightMode === 'screen';

  if (!env.secureContext) {
    el.envBadge.textContent = 'HTTP';
  } else {
    el.envBadge.textContent = env.ios ? 'iOS · HTTPS' : env.mobile ? 'Mobile · HTTPS' : 'Desktop · HTTPS';
  }

  if (isScreen) {
    if (!env.mobile) {
      el.torchStatusMsg.textContent = state.t('torchStatusDesktop');
    } else {
      el.torchStatusMsg.textContent = state.t('torchStatusScreenActive');
    }
  } else if (!env.secureContext || state.cameraErrorKind === 'insecure_context') {
    el.torchStatusMsg.textContent = state.t('torchStatusInsecure');
    el.torchStatusMsg.classList.add('warn');
  } else if (state.cameraErrorKind === 'permission_denied') {
    el.torchStatusMsg.textContent = state.t('torchStatusPermissionDenied');
    el.torchStatusMsg.classList.add('warn');
  } else if (state.cameraErrorKind === 'no_camera') {
    el.torchStatusMsg.textContent = state.t('torchStatusNoCamera');
    el.torchStatusMsg.classList.add('warn');
  } else if (state.cameraErrorKind === 'camera_busy') {
    el.torchStatusMsg.textContent = state.t('torchStatusCameraBusy');
    el.torchStatusMsg.classList.add('warn');
  } else if (state.cameraErrorKind === 'no_torch' || driver.torchSupported === false) {
    el.torchStatusMsg.textContent = env.ios
      ? state.t('torchStatusIosWarning')
      : state.t('torchStatusUnsupported');
    el.torchStatusMsg.classList.add('warn');
  } else if (driver.torchSupported === true) {
    if (state.torchBench) {
      if (state.torchBench.needsAdjustment) {
        el.torchStatusMsg.textContent = state.t('torchStatusBenchAdjusted', {
          median: state.torchBench.medianToggleMs,
          max: state.torchBench.maxToggleMs,
          period: state.bitPeriodMs,
        });
        el.torchStatusMsg.classList.add('warn');
      } else {
        el.torchStatusMsg.textContent = state.t('torchStatusBenchOk', {
          median: state.torchBench.medianToggleMs,
          period: state.bitPeriodMs,
        });
        el.torchStatusMsg.classList.add('ok');
      }
    } else {
      el.torchStatusMsg.textContent = state.t('torchStatusReady');
      el.torchStatusMsg.classList.add('ok');
    }
  } else if (env.ios) {
    el.torchStatusMsg.textContent = state.t('torchStatusIosWarning');
    el.torchStatusMsg.classList.add('warn');
  } else {
    el.torchStatusMsg.textContent = state.t('torchStatusChecking');
  }

  const showSwitchToScreen =
    state.lightMode === 'torch' &&
    (state.cameraErrorKind === 'permission_denied' ||
      state.cameraErrorKind === 'no_camera' ||
      state.cameraErrorKind === 'no_torch');

  el.srcTorch.checked = !isScreen;
  el.srcScreen.checked = isScreen;
  el.btnInitTorch.hidden = isScreen;
  el.previewToggleWrap.hidden = isScreen;
  el.btnReleaseCamera.hidden = isScreen || !driver.hasActiveCamera;
  if (el.btnSwitchToScreen) {
    el.btnSwitchToScreen.hidden = !showSwitchToScreen;
  }
  syncControlsDisabled();

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

function applyTorchOffsetBounds() {
  const limit = getSafeOffsetLimit(state.bitPeriodMs);
  const minOff = Math.max(-20, -limit);
  const maxOff = limit;
  el.torchOffsetRange.min = String(minOff);
  el.torchOffsetRange.max = String(maxOff);
  el.torchOffsetNum.min = String(minOff);
  el.torchOffsetNum.max = String(maxOff);
  const clamped = clampInt(state.torchOffsetMs, minOff, maxOff);
  if (clamped !== state.torchOffsetMs) {
    state.torchOffsetMs = clamped;
    saveStorage(STORAGE_KEYS.torchOffset, clamped);
  }
  el.torchOffsetRange.value = String(state.torchOffsetMs);
  el.torchOffsetNum.value = String(state.torchOffsetMs);
}

async function handleInitTorch() {
  if (state.transmitting || state.cameraBusy) return;
  setCameraBusy(true);
  try {
    setTxStatus(state.t('statusPreparing'), 'active');
    const res = await driver.acquireTorch();
    if (!res.supported) {
      state.torchBench = null;
      state.cameraErrorKind = 'no_torch';
      el.chkPreview.checked = false;
      driver.releaseCamera();
      setTxStatus(getCameraErrorMessage('no_torch'), 'error');
      showToast({
        kind: 'error',
        errorKind: 'no_torch',
        showSwitchToScreen: true,
      });
    } else {
      state.cameraErrorKind = null;
      setTxStatus(state.t('torchStatusBenchmarking'), 'active');
      const bench = await driver.benchmarkTorch(3);
      state.torchBench = bench;
      driver.torchSupported = true;

      if (bench.needsAdjustment) {
        state.bitPeriodMs = clampInt(
          bench.recommendedBitPeriodMs,
          WOP.MIN_BIT_PERIOD_MS,
          WOP.MAX_BIT_PERIOD_MS,
        );
        el.bitPeriodRange.value = String(state.bitPeriodMs);
        el.bitPeriodNum.value = String(state.bitPeriodMs);
        saveStorage(STORAGE_KEYS.bitPeriod, state.bitPeriodMs);
        applyTorchOffsetBounds();
        setTxStatus(
          state.t('torchStatusBenchAdjusted', {
            median: bench.medianToggleMs,
            max: bench.maxToggleMs,
            period: state.bitPeriodMs,
          }),
          'done',
        );
      } else {
        setTxStatus(
          state.t('torchStatusBenchOk', {
            median: bench.medianToggleMs,
            period: state.bitPeriodMs,
          }),
          'done',
        );
      }
    }
  } catch (err) {
    if (err?.name === 'AbortError') {
      return;
    }
    state.torchBench = null;
    const kind = err?.cameraErrorKind || classifyCameraError(err);
    state.cameraErrorKind = kind;
    el.chkPreview.checked = false;
    driver.releaseCamera();
    setTxStatus(getCameraErrorMessage(kind, err), 'error');
    showToast({
      kind: 'error',
      errorKind: kind,
      rawError: err?.message || String(err),
      showSwitchToScreen: isCameraSwitchableError(kind),
    });
  } finally {
    if (!el.chkPreview.checked || state.lightMode !== 'torch' || !driver.torchSupported) {
      driver.releaseCamera();
    }
    setCameraBusy(false);
    updateTorchStatusUI();
    updateInspector();
  }
}

// ---------- Clocks ----------

function tickClocks() {
  if (state.transmitting) return;
  const now = getCorrectedNowMs();
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
  return getCorrectedNowMs();
}

function getFrameDateParts(utcMs, tzId) {
  if (state.dateRef === 'local') {
    const p = getLocalParts(utcMs, tzId);
    return { year: p.year % 100, month: p.month, day: p.day };
  }
  const d = new Date(utcMs);
  return {
    year: d.getUTCFullYear() % 100,
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

function buildPreviewFrame(mode) {
  const tzId = mode === 'home' ? state.homeTz : state.travelTz;
  const tzInfo = getTzAnalysis(tzId);
  const nowMs = getEffectiveTargetMs();
  const d = new Date(nowMs);
  const dateObj = getFrameDateParts(nowMs, tzId);

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
  ctx.strokeStyle = 'rgba(11, 26, 48, 0.14)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, hiY);
  ctx.lineTo(w, hiY);
  ctx.moveTo(0, loY);
  ctx.lineTo(w, loY);
  ctx.stroke();

  if (!txBits || txBits.length === 0) return;

  const stepX = w / txBits.length;
  ctx.strokeStyle = '#0b1a30';
  ctx.lineWidth = 1.8;
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
  const estSec = (((frame.txBits.length + 1) * getActiveBitPeriodMs()) / 1000).toFixed(2);
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

function isCameraSwitchableError(kind) {
  return (
    kind === 'permission_denied' ||
    kind === 'no_camera' ||
    kind === 'no_torch' ||
    kind === 'camera_busy' ||
    kind === 'insecure_context'
  );
}

function renderToast() {
  if (!el.txToast) return;
  const toast = state.toast;
  if (!toast) {
    el.txToast.hidden = true;
    return;
  }

  el.txToast.classList.remove('tx-toast--active', 'tx-toast--done', 'tx-toast--error');
  el.txToast.classList.add(`tx-toast--${toast.kind}`);
  el.txToast.setAttribute('role', toast.kind === 'error' ? 'alert' : 'status');

  const modeLabel =
    toast.mode === 'home'
      ? state.t('homeTitle')
      : toast.mode === 'travel'
        ? state.t('travelTitle')
        : '';

  if (toast.kind === 'active') {
    el.txToastTitle.textContent = modeLabel
      ? state.t('toastTitleActiveMode', { mode: modeLabel })
      : state.t('toastTitleActive');
    el.txToastMessage.textContent = toast.messageKey
      ? state.t(toast.messageKey, toast.messageVars)
      : '';
    el.txToastMessage.classList.remove('mono');
    el.txToastProgressTrack.hidden = false;
    el.btnToastCancel.textContent = state.t('btnCancel');
    el.btnToastCancel.hidden = !toast.showCancel;
    el.btnToastClose.hidden = true;
    el.btnToastSwitchScreen.hidden = true;
  } else if (toast.kind === 'done') {
    el.txToastTitle.textContent = state.t('toastTitleDone');
    el.txToastMessage.textContent = state.t('toastDetailsDone', {
      mode: modeLabel,
      utc: toast.utc,
      bits: toast.bits,
      dur: toast.dur,
    });
    el.txToastMessage.classList.add('mono');
    el.txToastProgressTrack.hidden = true;
    el.btnToastCancel.hidden = true;
    el.btnToastSwitchScreen.hidden = true;
    el.btnToastClose.textContent = state.t('toastBtnOk');
    el.btnToastClose.hidden = false;
  } else if (toast.kind === 'error') {
    el.txToastTitle.textContent =
      toast.errorKind === 'permission_denied'
        ? state.t('toastTitlePermissionDenied')
        : state.t('toastTitleError');
    el.txToastMessage.textContent =
      toast.errorKind && toast.errorKind !== 'generic'
        ? getCameraErrorMessage(toast.errorKind, toast.rawError ? { message: toast.rawError } : null)
        : state.t('statusError', { msg: toast.rawError || 'Unknown error' });
    el.txToastMessage.classList.remove('mono');
    el.txToastProgressTrack.hidden = true;
    el.btnToastCancel.hidden = true;
    el.btnToastSwitchScreen.textContent = state.t('btnSwitchToScreen');
    el.btnToastSwitchScreen.hidden = !(toast.showSwitchToScreen && state.lightMode === 'torch');
    el.btnToastClose.textContent = state.t('toastBtnClose');
    el.btnToastClose.hidden = false;
  }

  el.txToast.hidden = false;
}

function showToast(payload) {
  state.toast = { ...payload };
  renderToast();
}

function updateToastActive(messageKey, messageVars = null) {
  if (!state.toast || state.toast.kind !== 'active') return;
  state.toast.messageKey = messageKey;
  state.toast.messageVars = messageVars;
  renderToast();
}

function hideToast() {
  state.toast = null;
  if (!el.txToast) return;
  el.txToast.hidden = true;
  el.txToast.classList.remove('tx-toast--active', 'tx-toast--done', 'tx-toast--error');
  if (el.txToastIcon) el.txToastIcon.classList.remove('flash-on');
}

function setProgress(pct) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  el.txProgressFill.style.width = `${clamped}%`;
  el.txProgressBar.setAttribute('aria-valuenow', String(clamped));
  el.screenOverlayProgress.style.width = `${clamped}%`;
  if (el.txToastProgressFill) {
    el.txToastProgressFill.style.width = `${clamped}%`;
  }
}

function syncControlsDisabled() {
  const busy = state.transmitting || state.cameraBusy;
  el.btnSendHome.disabled = busy;
  el.btnSendTravel.disabled = busy;
  el.btnInitTorch.disabled = busy;
  el.btnTestBlink.disabled = busy;
  el.btnReleaseCamera.disabled = busy;
  el.chkPreview.disabled = busy;
  el.srcTorch.disabled = busy;
  el.srcScreen.disabled = busy;
  if (el.btnSwitchToScreen) el.btnSwitchToScreen.disabled = busy;
  if (el.btnSwapTz) el.btnSwapTz.disabled = busy;
  el.btnCancelTx.hidden = !state.transmitting;
}

function setCameraBusy(busy) {
  state.cameraBusy = Boolean(busy);
  syncControlsDisabled();
}

function clearScreenTestBlinkTimer() {
  if (state.screenTestBlinkTimer !== null) {
    clearTimeout(state.screenTestBlinkTimer);
    state.screenTestBlinkTimer = null;
  }
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
  if (state.transmitting || state.cameraBusy) return;

  clearScreenTestBlinkTimer();
  unlockFeedbackAudio();

  state.transmitting = true;
  state.abortController = new AbortController();
  const { signal } = state.abortController;
  syncControlsDisabled();
  setProgress(0);
  showToast({
    kind: 'active',
    mode,
    messageKey: 'statusPreparing',
    showCancel: true,
  });

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
          state.cameraErrorKind = 'no_torch';
          el.chkPreview.checked = false;
          driver.releaseCamera();
          feedbackError(state.feedbackEnabled);
          setTxStatus(getCameraErrorMessage('no_torch'), 'error');
          showToast({
            kind: 'error',
            errorKind: 'no_torch',
            showSwitchToScreen: true,
          });
          updateTorchStatusUI();
          return;
        }
        state.cameraErrorKind = null;
        updateTorchStatusUI();
      } catch (err) {
        const kind = err?.cameraErrorKind || classifyCameraError(err);
        state.cameraErrorKind = kind;
        el.chkPreview.checked = false;
        driver.releaseCamera();
        feedbackError(state.feedbackEnabled);
        setTxStatus(getCameraErrorMessage(kind, err), 'error');
        showToast({
          kind: 'error',
          errorKind: kind,
          rawError: err?.message || String(err),
          showSwitchToScreen: isCameraSwitchableError(kind),
        });
        updateTorchStatusUI();
        return;
      }
    }

    const activeBitPeriodMs = clampInt(
      getActiveBitPeriodMs(activeLightMode),
      WOP.MIN_BIT_PERIOD_MS,
      WOP.MAX_BIT_PERIOD_MS,
    );

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
          updateToastActive('statusCountdown', { sec });
        });
      }
      el.screenOverlayText.textContent = state.t('screenOverlayHint');
      el.screenFlashPad.classList.add('tx-active');
    }

    // Complete async hardware/wake-lock setup BEFORE capturing UTC timestamp for alignment
    if (activeLightMode === 'torch') {
      await driver.forceTorchOff();
    }
    await driver.requestWakeLock();

    if (signal.aborted) {
      throw new DOMException('Transmission aborted', 'AbortError');
    }

    // 3. Build frame right before sending for exact UTC second synchronization
    let txBits;
    let startDelayMs = 0;
    let targetUtcMs;
    let transmitBitPeriodMs = activeBitPeriodMs;

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
        date: getFrameDateParts(parsed, tzId),
        dst: dstData,
      });
      txBits = frame.txBits;
      startDelayMs = 60;
    } else {
      const synced = buildAutoSyncedFrame({
        nowMs: getCorrectedNowMs(),
        mode,
        timezone: {
          hourShift: tzInfo.hourShift,
          minuteShift: tzInfo.minuteShift,
          hemisphere: tzInfo.hemisphere,
        },
        dst: dstData,
        bitPeriodMs: activeBitPeriodMs,
        dateRef: state.dateRef,
        getDateParts: (ms) => getFrameDateParts(ms, tzId),
        compensateDuration: state.txDurationComp,
      });
      txBits = synced.frame.txBits;
      startDelayMs = synced.startDelayMs;
      targetUtcMs = synced.targetUtcMs;
      transmitBitPeriodMs = synced.bitPeriodMs;
    }

    if (startDelayMs > 40) {
      setTxStatus(state.t('statusWaitingSync', { ms: Math.round(startDelayMs) }), 'active');
      updateToastActive('statusWaitingSync', { ms: Math.round(startDelayMs) });
    }

    // 4. Transmit optical pulses!
    let startFeedbackPlayed = false;
    const stats = await driver.transmit({
      txBits,
      bitPeriodMs: transmitBitPeriodMs,
      offsetMs: activeLightMode === 'torch' ? state.torchOffsetMs : 0,
      startDelayMs,
      lightMode: activeLightMode,
      signal,
      onLightChange: (isOn) => {
        el.liveLedDot.classList.toggle('on', isOn);
        el.txPulseDot.classList.toggle('flash-on', isOn);
        if (el.txToastIcon) {
          el.txToastIcon.classList.toggle('flash-on', isOn);
        }
        if (activeLightMode === 'screen') {
          el.screenFlashPad.classList.toggle('lit', isOn);
        }
      },
      onProgress: (sent, total) => {
        if (!startFeedbackPlayed) {
          startFeedbackPlayed = true;
          feedbackStart(state.feedbackEnabled);
        }
        if (sent === 1 || sent === total || sent % 4 === 0) {
          const pct = Math.round((sent / total) * 100);
          setProgress(pct);
          setTxStatus(state.t('statusTransmitting', { sent, total, pct }), 'active');
          updateToastActive('statusTransmitting', { sent, total, pct });
        }
      },
    });

    feedbackSuccess(state.feedbackEnabled);
    setProgress(100);
    const sentUtc = formatUtcHms(targetUtcMs);
    setTxStatus(
      state.t('statusDone', {
        utc: sentUtc,
        bits: txBits.length,
        dur: stats.actualDurationMs,
        jitter: stats.avgJitterMs,
      }),
      'done',
    );
    showToast({
      kind: 'done',
      mode,
      utc: sentUtc,
      bits: txBits.length,
      dur: stats.actualDurationMs,
    });
  } catch (err) {
    if (signal.aborted || (err && err.name === 'AbortError')) {
      setTxStatus(state.t('statusCancelled'), 'idle');
      setProgress(0);
      hideToast();
    } else {
      feedbackError(state.feedbackEnabled);
      const errMsg = err?.message || String(err);
      setTxStatus(state.t('statusError', { msg: errMsg }), 'error');
      showToast({
        kind: 'error',
        errorKind: 'generic',
        rawError: errMsg,
        showSwitchToScreen: false,
      });
    }
  } finally {
    el.liveLedDot.classList.remove('on');
    el.txPulseDot.classList.remove('flash-on');
    if (el.txToastIcon) {
      el.txToastIcon.classList.remove('flash-on');
    }
    el.screenFlashPad.classList.remove('lit', 'tx-active');
    el.screenFlashOverlay.hidden = true;
    if (document.fullscreenElement === el.screenFlashOverlay && typeof document.exitFullscreen === 'function') {
      document.exitFullscreen().catch(() => {});
    }
    el.chkPreview.checked = false;
    driver.releaseCamera();
    state.transmitting = false;
    state.abortController = null;
    syncControlsDisabled();
    updateTorchStatusUI();
    tickClocks();
  }
}

function cancelTransmission() {
  clearScreenTestBlinkTimer();
  if (state.abortController) {
    state.abortController.abort();
  }
}

function handleSwapTimezones() {
  if (state.transmitting) return;
  const prevHome = state.homeTz;
  state.homeTz = state.travelTz;
  state.travelTz = prevHome;

  el.homeSearch.value = '';
  el.travelSearch.value = '';
  populateTimezoneSelect(el.homeTzSelect, '', state.homeTz);
  populateTimezoneSelect(el.travelTzSelect, '', state.travelTz);

  saveStorage(STORAGE_KEYS.homeTz, state.homeTz);
  saveStorage(STORAGE_KEYS.travelTz, state.travelTz);

  updateTimezoneMeta('home');
  updateTimezoneMeta('travel');
  tickClocks();
  updateInspector();
}

function registerServiceWorker() {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return;
  const register = () => {
    navigator.serviceWorker?.register('./sw.js').catch(() => {});
  };
  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register, { once: true });
  }
}

// ---------- Wiring & Initialization ----------

function initControls() {
  // Language switcher
  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.addEventListener('click', () => applyLanguage(btn.dataset.lang));
  });

  // Network UTC time sync trigger
  el.btnSyncTime.addEventListener('click', () => {
    runTimeSync();
  });

  // Light source radios
  el.srcTorch.addEventListener('change', () => {
    if (el.srcTorch.checked) {
      setLightMode('torch');
    }
  });
  el.srcScreen.addEventListener('change', () => {
    if (el.srcScreen.checked) {
      state.cameraErrorKind = null;
      el.chkPreview.checked = false;
      driver.releaseCamera();
      setLightMode('screen');
    }
  });
  if (el.btnSwitchToScreen) {
    el.btnSwitchToScreen.addEventListener('click', () => {
      if (state.transmitting) return;
      state.cameraErrorKind = null;
      el.chkPreview.checked = false;
      driver.releaseCamera();
      setLightMode('screen');
      setTxStatus(state.t('statusIdle'), 'idle');
    });
  }

  el.btnInitTorch.addEventListener('click', handleInitTorch);
  el.btnTestBlink.addEventListener('click', async () => {
    if (state.transmitting || state.cameraBusy) return;
    if (state.lightMode === 'screen') {
      clearScreenTestBlinkTimer();
      el.screenFlashOverlay.hidden = false;
      el.screenFlashPad.classList.add('tx-active', 'lit');
      state.screenTestBlinkTimer = setTimeout(() => {
        state.screenTestBlinkTimer = null;
        if (!state.transmitting) {
          el.screenFlashPad.classList.remove('lit', 'tx-active');
          el.screenFlashOverlay.hidden = true;
        }
      }, 320);
      return;
    }
    setCameraBusy(true);
    try {
      const ok = await driver.testBlink(200);
      if (!ok) {
        state.cameraErrorKind = 'no_torch';
        el.chkPreview.checked = false;
        driver.releaseCamera();
        setTxStatus(getCameraErrorMessage('no_torch'), 'error');
        showToast({
          kind: 'error',
          errorKind: 'no_torch',
          showSwitchToScreen: true,
        });
      } else {
        state.cameraErrorKind = null;
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        return;
      }
      const kind = err?.cameraErrorKind || classifyCameraError(err);
      state.cameraErrorKind = kind;
      el.chkPreview.checked = false;
      driver.releaseCamera();
      setTxStatus(getCameraErrorMessage(kind, err), 'error');
      showToast({
        kind: 'error',
        errorKind: kind,
        rawError: err?.message || String(err),
        showSwitchToScreen: isCameraSwitchableError(kind),
      });
    } finally {
      if (!el.chkPreview.checked) {
        driver.releaseCamera();
      }
      setCameraBusy(false);
      updateTorchStatusUI();
    }
  });
  el.btnReleaseCamera.addEventListener('click', () => {
    if (state.transmitting || state.cameraBusy) return;
    driver.releaseCamera();
    state.torchBench = null;
    el.chkPreview.checked = false;
    updateTorchStatusUI();
  });
  el.chkPreview.addEventListener('change', async () => {
    if (state.transmitting || state.cameraBusy) {
      el.chkPreview.checked = false;
      return;
    }
    if (el.chkPreview.checked) {
      if (!driver.hasActiveCamera) {
        await handleInitTorch();
      }
      updateCameraPreviewVisibility();
    } else {
      driver.releaseCamera();
      updateTorchStatusUI();
    }
  });

  // Swap Home (T1) <-> Travel (T2)
  el.btnSwapTz.addEventListener('click', handleSwapTimezones);

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
  if (el.btnToastCancel) {
    el.btnToastCancel.addEventListener('click', cancelTransmission);
  }
  if (el.btnToastClose) {
    el.btnToastClose.addEventListener('click', hideToast);
  }
  if (el.btnToastSwitchScreen) {
    el.btnToastSwitchScreen.addEventListener('click', () => {
      if (state.transmitting) return;
      state.cameraErrorKind = null;
      el.chkPreview.checked = false;
      driver.releaseCamera();
      setLightMode('screen');
      setTxStatus(state.t('statusIdle'), 'idle');
      hideToast();
    });
  }

  // Calibration controls (two-way synced slider + numeric input)
  function bindRangeNumberPair({ rangeEl, numEl, min, max, getMin, getMax, initialValue, onCommit }) {
    const readMin = () => (typeof getMin === 'function' ? getMin() : min);
    const readMax = () => (typeof getMax === 'function' ? getMax() : max);
    const syncDisplay = (v) => {
      rangeEl.value = String(v);
      numEl.value = String(v);
    };
    const clampVal = (raw) => clampInt(raw, readMin(), readMax());

    syncDisplay(clampVal(initialValue));

    rangeEl.addEventListener('input', () => {
      const val = clampVal(Number(rangeEl.value));
      numEl.value = String(val);
      onCommit(val);
    });

    numEl.addEventListener('input', () => {
      const raw = numEl.value.trim();
      if (raw === '' || raw === '-') return;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return;
      if (parsed >= readMin() && parsed <= readMax()) {
        const val = Math.round(parsed);
        rangeEl.value = String(val);
        onCommit(val);
      }
    });

    numEl.addEventListener('change', () => {
      const parsed = Number(numEl.value);
      const val = Number.isFinite(parsed) ? clampVal(parsed) : clampVal(Number(rangeEl.value));
      syncDisplay(val);
      onCommit(val);
    });

    return syncDisplay;
  }

  const syncBitPeriod = bindRangeNumberPair({
    rangeEl: el.bitPeriodRange,
    numEl: el.bitPeriodNum,
    min: WOP.MIN_BIT_PERIOD_MS,
    max: WOP.MAX_BIT_PERIOD_MS,
    initialValue: state.bitPeriodMs,
    onCommit: (val) => {
      state.bitPeriodMs = val;
      saveStorage(STORAGE_KEYS.bitPeriod, val);
      applyTorchOffsetBounds();
      updateTorchStatusUI();
      updateInspector();
    },
  });

  const syncScreenBitPeriod = bindRangeNumberPair({
    rangeEl: el.screenBitPeriodRange,
    numEl: el.screenBitPeriodNum,
    min: WOP.MIN_BIT_PERIOD_MS,
    max: WOP.MAX_BIT_PERIOD_MS,
    initialValue: state.screenBitPeriodMs,
    onCommit: (val) => {
      state.screenBitPeriodMs = val;
      saveStorage(STORAGE_KEYS.screenBitPeriod, val);
      updateInspector();
    },
  });

  const syncTorchOffset = bindRangeNumberPair({
    rangeEl: el.torchOffsetRange,
    numEl: el.torchOffsetNum,
    getMin: () => Math.max(-20, -getSafeOffsetLimit(state.bitPeriodMs)),
    getMax: () => getSafeOffsetLimit(state.bitPeriodMs),
    initialValue: state.torchOffsetMs,
    onCommit: (val) => {
      state.torchOffsetMs = val;
      saveStorage(STORAGE_KEYS.torchOffset, val);
    },
  });
  applyTorchOffsetBounds();

  const syncScreenCountdown = bindRangeNumberPair({
    rangeEl: el.screenCountdownRange,
    numEl: el.screenCountdownNum,
    min: 0,
    max: 10,
    initialValue: state.screenCountdownSec,
    onCommit: (val) => {
      state.screenCountdownSec = val;
      saveStorage(STORAGE_KEYS.screenCountdown, val);
    },
  });

  // Left / right stepper buttons for numeric calibration inputs
  document.querySelectorAll('.step-btn[data-step-target]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.stepTarget);
      if (!target) return;
      const delta = Number(btn.dataset.step) || 0;
      const cur = Number(target.value);
      const next = (Number.isFinite(cur) ? cur : 0) + delta;
      target.value = String(next);
      target.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });

  el.dateRefSelect.value = state.dateRef;
  el.dateRefSelect.addEventListener('change', () => {
    state.dateRef = el.dateRefSelect.value;
    saveStorage(STORAGE_KEYS.dateRef, state.dateRef);
    updateInspector();
  });

  el.chkTxDurationComp.checked = state.txDurationComp;
  el.chkTxDurationComp.addEventListener('change', () => {
    state.txDurationComp = el.chkTxDurationComp.checked;
    saveStorage(STORAGE_KEYS.txDurationComp, state.txDurationComp);
  });

  el.chkFeedback.checked = state.feedbackEnabled;
  el.chkFeedback.addEventListener('change', () => {
    state.feedbackEnabled = el.chkFeedback.checked;
    saveStorage(STORAGE_KEYS.feedback, state.feedbackEnabled);
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
      const now = new Date(getCorrectedNowMs());
      el.customUtcInput.value = `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}T${pad2(now.getUTCHours())}:${pad2(now.getUTCMinutes())}:${pad2(now.getUTCSeconds())}`;
    }
    updateInspector();
  });
  el.customUtcInput.addEventListener('input', updateInspector);

  el.btnResetDefaults.addEventListener('click', () => {
    state.bitPeriodMs = WOP.DEFAULT_BIT_PERIOD_MS;
    state.screenBitPeriodMs = DEFAULT_SCREEN_BIT_PERIOD_MS;
    state.torchOffsetMs = env.ios ? WOP.APPLE_TORCH_OFFSET_MS : WOP.DEFAULT_TORCH_OFFSET_MS;
    state.screenCountdownSec = 2;
    state.txDurationComp = true;
    state.includeDst = true;
    state.feedbackEnabled = true;
    state.dateRef = 'utc';
    state.customTimeEnabled = false;

    syncBitPeriod(state.bitPeriodMs);
    syncScreenBitPeriod(state.screenBitPeriodMs);
    applyTorchOffsetBounds();
    syncTorchOffset(state.torchOffsetMs);
    syncScreenCountdown(state.screenCountdownSec);
    el.dateRefSelect.value = state.dateRef;
    el.chkTxDurationComp.checked = true;
    el.chkFeedback.checked = true;
    el.chkIncludeDst.checked = true;
    el.chkCustomTime.checked = false;
    el.customTimeWrap.hidden = true;

    saveStorage(STORAGE_KEYS.bitPeriod, state.bitPeriodMs);
    saveStorage(STORAGE_KEYS.screenBitPeriod, state.screenBitPeriodMs);
    saveStorage(STORAGE_KEYS.torchOffset, state.torchOffsetMs);
    saveStorage(STORAGE_KEYS.screenCountdown, state.screenCountdownSec);
    saveStorage(STORAGE_KEYS.txDurationComp, state.txDurationComp);
    saveStorage(STORAGE_KEYS.feedback, state.feedbackEnabled);
    saveStorage(STORAGE_KEYS.includeDst, state.includeDst);
    saveStorage(STORAGE_KEYS.dateRef, state.dateRef);
    updateTorchStatusUI();
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

  // Allow Escape key to cancel active transmission or dismiss sticky notification
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (state.transmitting) {
        cancelTransmission();
      } else if (state.toast) {
        hideToast();
      }
    }
  });

  // Clean up camera and abort active flash if tab is closed/hidden
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (state.transmitting) {
        cancelTransmission();
      }
      el.chkPreview.checked = false;
      driver.releaseCamera();
      updateTorchStatusUI();
    }
  });
  window.addEventListener('pagehide', () => {
    if (state.transmitting) {
      cancelTransmission();
    }
    driver.releaseCamera();
  });
}

initControls();
applyLanguage(state.lang);
initCameraPermissionMonitor();
tickClocks();
registerServiceWorker();
runTimeSync();
setInterval(tickClocks, 100);
setInterval(() => {
  const details = document.getElementById('advancedDetails');
  if (!state.transmitting && details && details.open && !state.customTimeEnabled) {
    updateInspector();
  }
}, 1000);
