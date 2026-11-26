export const TRANSLATIONS = {
  en: {
    appTitle: 'Optical Flash Time Sync',
    appSubtitle: 'Web transmitter for optical watch setting (WOP v2.4)',
    compatTitle: 'Compatibility Notice',
    compatBody:
      'Currently this application supports <strong>Longines Conquest V.H.P. GMT</strong> (Flash Setting) only. It is unknown whether it will work with other watches.',
    utcClockLabel: 'UTC Clock',
    timeSyncSyncing: 'Syncing...',
    timeSyncOk: 'NTP OK',
    timeSyncOffset: 'NTP {sign}{ms} ms',
    timeSyncDevice: 'Device clock',
    timeSyncTooltip: 'Synchronize UTC clock offset over network',
    timeSyncTooltipSynced: 'Synced via {source} (RTT {rtt} ms, offset {sign}{ms} ms) — tap to refresh',
    lightSourceTitle: 'Light Source',
    sourceTorch: 'Rear LED Flashlight',
    sourceTorchBadge: 'Default',
    sourceTorchHint: 'Primary mode — recommended on Android (Chrome / Edge / Samsung Internet)',
    sourceScreen: 'Screen / Monitor Flash',
    sourceScreenHint: 'Works on iOS Safari, desktop monitors & laptops (pure black/white)',
    torchStatusDesktop:
      'Desktop browser detected — Screen / Monitor Flash mode is selected. Set monitor brightness to 100% and hold the watch dial close to the flashing white area.',
    torchStatusScreenActive:
      'Screen / Monitor Flash mode selected. Set screen brightness to 100% and hold the watch dial close to the flashing area.',
    torchStatusChecking: 'Tap "Enable Camera / LED" or Transmit to check rear LED flashlight support.',
    torchStatusReady: 'Rear LED flashlight is ready.',
    torchStatusBenchmarking: 'Measuring rear LED toggle latency...',
    torchStatusBenchOk: 'Rear LED ready — toggle ~{median} ms ({period} ms bit period OK).',
    torchStatusBenchAdjusted:
      'Rear LED ready — slow HAL detected (~{median} ms, max {max} ms). Bit period auto-adjusted to {period} ms.',
    torchStatusIosWarning:
      'iOS Safari does not expose web access to the rear LED flashlight. Switch to Screen / Monitor Flash below (set brightness to 100%) or use Chrome on Android for Rear LED.',
    torchStatusUnsupported:
      'This browser does not expose camera LED torch control. Switch to Screen Flash mode, or open this page in Chrome on Android.',
    torchStatusInsecure:
      'Camera/flashlight access requires HTTPS. Open the deployed GitHub Pages URL over HTTPS.',
    torchStatusPermissionDenied:
      'Camera permission was denied. Rear LED flashlight requires camera access — allow camera permission in your browser site settings and retry, or switch to Screen / Monitor Flash.',
    torchStatusNoCamera:
      'No rear camera was found on this device. Switch to Screen / Monitor Flash to transmit using your display.',
    torchStatusCameraBusy:
      'Camera is currently busy or used by another app. Close other camera apps and try again.',
    btnSwitchToScreen: 'Use Screen / Monitor Flash',
    btnInitTorch: 'Enable Camera / Test LED',
    btnTestBlink: 'Test Blink',
    btnReleaseCamera: 'Release Camera',
    togglePreview: 'Show camera alignment preview',
    previewHint: 'Aim the rear LED (next to the camera lens) at the sensor hidden inside the "1" of "12" on the watch dial.',
    tzSectionLabel: 'Dual Timezones',
    homeTitle: 'Home Time (T1)',
    travelTitle: 'Travel Time (T2)',
    btnSwapTz: 'Swap T1 / T2',
    tzSearchPlaceholder: 'Search timezone (e.g. Warsaw, New York, Tokyo)...',
    tzLabel: 'Timezone',
    stdOffsetLabel: 'Standard offset',
    dstStatusLabel: 'DST schedule',
    dstNone: 'No DST (single frame)',
    dstDates: 'Summer {start} · Winter {stop}',
    btnSendHome: 'Transmit Home (T1)',
    btnSendTravel: 'Transmit Travel (T2)',
    btnCancel: 'Cancel',
    statusIdle: 'Ready to transmit.',
    statusPreparing: 'Preparing light source...',
    statusCountdown: 'Starting in {sec}s — hold watch steady...',
    statusWaitingSync: 'Synchronizing to next UTC second ({ms} ms)...',
    statusTransmitting: 'Transmitting {sent} / {total} bits ({pct}%)...',
    statusDone: 'Transmission complete! Sent UTC {utc} ({bits} bits in {dur} ms, avg jitter {jitter} ms).',
    statusCancelled: 'Transmission cancelled.',
    statusError: 'Error: {msg}',
    toastTitleActive: 'Transmitting…',
    toastTitleActiveMode: 'Transmitting · {mode}',
    toastTitleDone: 'Transmission Complete',
    toastDetailsDone: '{mode} · UTC {utc} · {bits} bits in {dur} ms',
    toastTitleError: 'Transmission Error',
    toastTitlePermissionDenied: 'Camera Permission Denied',
    toastBtnOk: 'OK',
    toastBtnClose: 'Close',
    howToTitle: 'How to set your watch',
    sensorDiagramAlt: 'Conquest V.H.P. GMT schematic showing the optical light sensor hidden inside the "1" of "12" and all 4 hands',
    sensorDiagramCaption: 'The optical light sensor (photodiode) is hidden inside the vertical stem of the "1" in "12".',
    step1:
      'Put the <strong>Longines Conquest V.H.P. GMT</strong> into Flash Setting mode: press the crown briefly, then press and hold it for about 2 seconds until the hands move into reception position.',
    step2:
      'Choose your <strong>Home (T1)</strong> or <strong>Travel (T2)</strong> timezone. UTC time, date, standard offset, and yearly DST dates are encoded automatically.',
    step3:
      '<strong>Android LED:</strong> Hold the phone\'s rear LED flashlight 2–5 cm directly above the optical sensor hidden inside the "1" of "12" on the dial.<br><strong>iOS / Phone Screen / Monitor:</strong> Set screen brightness to 100%, dim room lighting, and hold the watch dial right up to the white/black flashing area.',
    step4:
      'Tap <strong>Transmit</strong> and keep the watch steady for ~2–4 seconds until the hands move to the new time.',
    advancedTitle: 'Calibration & Protocol Inspector',
    bitPeriodLabel: 'Rear LED bit period (ms)',
    bitPeriodHelp: 'Default is 30 ms (Longines standard). Valid WOP range: 10–100 ms. Auto-adjusted if slow LED hardware is detected.',
    screenBitPeriodLabel: 'Screen / Monitor bit period (ms)',
    screenBitPeriodHelp: 'Default is 50 ms (~3 frames on 60 Hz LCD monitors) for crisp black/white contrast. Valid range: 10–100 ms.',
    torchOffsetLabel: 'Torch turn-on offset (ms)',
    torchOffsetHelp: 'Fires 0→1 rising edges earlier to compensate for LED turn-on lag (0 ms Android, 8 ms Apple).',
    txDurationCompLabel: 'Compensate transmission duration (align end to UTC second)',
    feedbackLabel: 'Audio & vibration cue on start/finish',
    includeDstLabel: 'Include DST Summer/Winter message (opcodes 59/60)',
    dateRefLabel: 'Date reference',
    dateRefUtc: 'UTC date (recommended)',
    dateRefLocal: 'Device local date',
    customTimeToggle: 'Manual UTC date & time override (for testing)',
    customTimeLabel: 'Custom UTC date & time',
    hdrBoostLabel: 'HDR peak white boost for Screen / Monitor Flash (EDR)',
    hdrBoostDetectedHdr: 'HDR display detected — boost recommended for maximum Screen Flash brightness.',
    hdrBoostDetectedSdr: 'SDR display detected — HDR boost has no effect on this screen (standard white is used).',
    screenCountdownLabel: 'Screen Flash countdown (s)',
    resetDefaults: 'Reset Defaults',
    inspectorTitle: 'Encoded WOP v2.4 Frame Preview',
    inspectorHeader: 'Header (8b)',
    inspectorLength: 'Length (4b)',
    inspectorMsg1: 'TZ+Time+Date',
    inspectorMsg2: 'DST Summer/Winter',
    inspectorCrc: 'CRC-8 (8b)',
    inspectorStuffed: 'Stuffed + 2 zeros',
    inspectorBitsInfo: '{raw} raw bits → {stuffed} stuffed bits + 2 zeros = {tx} bits (~{sec} s)',
    screenOverlayHint: 'Place watch 12 o\'clock sensor over the bright area',
    screenOverlayPrep: 'Get ready... {sec}',
    screenOverlayCancel: 'Tap to cancel',
    footerNote: 'Reverse-engineered WOP v2.4 optical protocol · Runs 100% locally in your browser · No data leaves your device.',
  },
  pl: {
    appTitle: 'Optyczna Synchronizacja Czasu',
    appSubtitle: 'Webowy nadajnik sygnału świetlnego dla zegarka (WOP v2.4)',
    compatTitle: 'Informacja o kompatybilności',
    compatBody:
      'Na razie aplikacja wspiera wyłącznie zegarek <strong>Longines Conquest V.H.P. GMT</strong> (Flash Setting) i nie wiadomo, czy będzie działać z innymi zegarkami.',
    utcClockLabel: 'Czas UTC',
    timeSyncSyncing: 'Synchronizacja...',
    timeSyncOk: 'NTP OK',
    timeSyncOffset: 'NTP {sign}{ms} ms',
    timeSyncDevice: 'Zegar urządzenia',
    timeSyncTooltip: 'Synchronizuj odchylenie czasu UTC przez sieć',
    timeSyncTooltipSynced: 'Zsynchronizowano przez {source} (RTT {rtt} ms, odchylenie {sign}{ms} ms) — kliknij, aby odświeżyć',
    lightSourceTitle: 'Źródło światła',
    sourceTorch: 'Latarka LED telefonu (tylna)',
    sourceTorchBadge: 'Domyślne',
    sourceTorchHint: 'Tryb główny — zalecane na Androidzie (Chrome / Edge / Samsung Internet)',
    sourceScreen: 'Błysk ekranu / monitora',
    sourceScreenHint: 'Działa na iOS Safari, monitorach PC i laptopach (miganie biało-czarne)',
    torchStatusDesktop:
      'Wykryto przeglądarkę desktopową — wybrano tryb błysku ekranu / monitora. Ustaw jasność monitora na 100% i przyłóż tarczę zegarka blisko migającego białego pola.',
    torchStatusScreenActive:
      'Wybrano tryb błysku ekranu / monitora. Ustaw jasność ekranu na 100% i przyłóż tarczę zegarka blisko migającego pola.',
    torchStatusChecking: 'Kliknij „Włącz kamerę / LED” lub „Wyślij”, aby sprawdzić dostęp do tylnej latarki LED.',
    torchStatusReady: 'Tylna latarka LED jest gotowa.',
    torchStatusBenchmarking: 'Pomiar czasu przełączania tylnej latarki LED...',
    torchStatusBenchOk: 'Tylna latarka LED gotowa — czas przełączania ~{median} ms (okres {period} ms OK).',
    torchStatusBenchAdjusted:
      'Tylna latarka LED gotowa — wykryto wolne przełączanie HAL (~{median} ms, maks. {max} ms). Okres bitu automatycznie zmieniono na {period} ms.',
    torchStatusIosWarning:
      'Safari na iOS nie udostępnia stronom WWW sterowania tylną latarką LED. Przełącz się na Błysk ekranu / monitora poniżej (ustaw jasność na 100%) lub użyj Chrome na Androidzie dla latarki LED.',
    torchStatusUnsupported:
      'Ta przeglądarka nie obsługuje sterowania latarką LED z poziomu strony. Użyj trybu błysku ekranu lub otwórz stronę w Chrome na Androidzie.',
    torchStatusInsecure:
      'Dostęp do kamery i latarki wymaga połączenia HTTPS. Otwórz aplikację przez adres GitHub Pages (HTTPS).',
    torchStatusPermissionDenied:
      'Odmówiono dostępu do kamery. Tylna latarka LED wymaga uprawnienia do kamery — zezwól na dostęp do kamery w ustawieniach przeglądarki dla tej strony i spróbuj ponownie, albo przełącz się na Błysk ekranu / monitora.',
    torchStatusNoCamera:
      'Nie wykryto tylnej kamery w tym urządzeniu. Przełącz się na Błysk ekranu / monitora, aby nadawać ekranem.',
    torchStatusCameraBusy:
      'Kamera jest obecnie zajęta przez inną aplikację. Zamknij inne aplikacje używające aparatu i spróbuj ponownie.',
    btnSwitchToScreen: 'Przełącz na Błysk ekranu',
    btnInitTorch: 'Włącz kamerę / Test LED',
    btnTestBlink: 'Testowy błysk',
    btnReleaseCamera: 'Zwolnij kamerę',
    togglePreview: 'Pokaż podgląd z kamery do celowania',
    previewHint: 'Skieruj tylną diodę LED (obok obiektywu) na czujnik ukryty w cyfrze „1” z „12” na tarczy zegarka.',
    tzSectionLabel: 'Strefy czasowe',
    homeTitle: 'Czas domowy (T1)',
    travelTitle: 'Czas podróży (T2)',
    btnSwapTz: 'Zamień T1 / T2',
    tzSearchPlaceholder: 'Szukaj strefy czasowej (np. Warsaw, New York, Tokyo)...',
    tzLabel: 'Strefa czasowa',
    stdOffsetLabel: 'Przesunięcie bazowe',
    dstStatusLabel: 'Zmiana czasu (DST)',
    dstNone: 'Brak DST (pojedyncza ramka)',
    dstDates: 'Lato {start} · Zima {stop}',
    btnSendHome: 'Wyślij Czas domowy (T1)',
    btnSendTravel: 'Wyślij Czas podróży (T2)',
    btnCancel: 'Anuluj',
    statusIdle: 'Gotowy do transmisji.',
    statusPreparing: 'Przygotowywanie źródła światła...',
    statusCountdown: 'Start za {sec} s — trzymaj zegarek nieruchomo...',
    statusWaitingSync: 'Synchronizacja do pełnej sekundy UTC ({ms} ms)...',
    statusTransmitting: 'Wysyłanie {sent} / {total} bitów ({pct}%)...',
    statusDone: 'Transmisja zakończona! Wysłano UTC {utc} ({bits} bitów w {dur} ms, śr. jitter {jitter} ms).',
    statusCancelled: 'Transmisja anulowana.',
    statusError: 'Błąd: {msg}',
    toastTitleActive: 'Wysyłanie…',
    toastTitleActiveMode: 'Wysyłanie · {mode}',
    toastTitleDone: 'Transmisja zakończona',
    toastDetailsDone: '{mode} · UTC {utc} · {bits} bitów w {dur} ms',
    toastTitleError: 'Błąd transmisji',
    toastTitlePermissionDenied: 'Brak uprawnień do kamery',
    toastBtnOk: 'OK',
    toastBtnClose: 'Zamknij',
    howToTitle: 'Jak ustawić zegarek',
    sensorDiagramAlt: 'Schemat zegarka Conquest V.H.P. GMT z czujnikiem światła ukrytym w cyfrze „1” z „12” oraz 4 wskazówkami',
    sensorDiagramCaption: 'Czujnik optyczny (fotodioda) jest ukryty w pionowej kresce cyfry „1” z godziny „12”.',
    step1:
      'Przełącz zegarek <strong>Longines Conquest V.H.P. GMT</strong> w tryb odbioru Flash Setting: naciśnij krótko koronkę, a następnie przytrzymaj ją przez ok. 2 sekundy, aż wskazówki ustawią się w pozycji odbioru.',
    step2:
      'Wybierz strefę dla <strong>Czasu domowego (T1)</strong> lub <strong>Czasu podróży (T2)</strong>. Czas UTC, data, przesunięcie strefowe oraz daty zmiany czasu DST zostaną zakodowane automatycznie.',
    step3:
      '<strong>Android (Latarka LED):</strong> Przytrzymaj tylną latarkę telefonu 2–5 cm bezpośrednio nad czujnikiem optycznym ukrytym w cyfrze „1” z „12” na tarczy.<br><strong>iOS / Ekran telefonu / Monitor PC:</strong> Ustaw jasność ekranu na 100%, przygaś światło w pokoju i przyłóż tarczę zegarka bezpośrednio do migającego biało-czarnego pola.',
    step4:
      'Kliknij <strong>Wyślij</strong> i utrzymuj zegarek nieruchomo przez ok. 2–4 sekundy, aż transmisja się zakończy i wskazówki przestawią się na właściwą godzinę.',
    advancedTitle: 'Kalibracja i podgląd ramki protokołu',
    bitPeriodLabel: 'Okres bitu LED (ms)',
    bitPeriodHelp: 'Domyślnie 30 ms (standard Longines). Zakres WOP: 10–100 ms. Automatycznie zwiększany przy wolnym sterowniku LED.',
    screenBitPeriodLabel: 'Okres bitu ekranu / monitora (ms)',
    screenBitPeriodHelp: 'Domyślnie 50 ms (~3 klatki na monitorze 60 Hz) dla wyraźnego kontrastu czerni i bieli. Zakres: 10–100 ms.',
    torchOffsetLabel: 'Kompensacja włączenia LED (ms)',
    torchOffsetHelp: 'Wcześniejsze wyzwalanie zboczy 0→1 dla kompensacji opóźnienia diody (0 ms Android, 8 ms Apple).',
    txDurationCompLabel: 'Kompensuj czas trwania transmisji (wyrównaj koniec do pełnej sekundy UTC)',
    feedbackLabel: 'Dźwięk i wibracja na start/koniec transmisji',
    includeDstLabel: 'Dołącz wiadomość zmiany czasu Lato/Zima (opcode 59/60)',
    dateRefLabel: 'Źródło daty',
    dateRefUtc: 'Data UTC (zalecane)',
    dateRefLocal: 'Lokalna data urządzenia',
    customTimeToggle: 'Ręczna data i godzina UTC (do testów)',
    customTimeLabel: 'Własna data i godzina UTC',
    hdrBoostLabel: 'Wzmocnienie bieli HDR dla błysku ekranu / monitora (EDR)',
    hdrBoostDetectedHdr: 'Wykryto ekran HDR — zalecane wzmocnienie dla maksymalnej jasności błysku ekranu.',
    hdrBoostDetectedSdr: 'Wykryto ekran SDR — wzmocnienie HDR nie działa na tym ekranie (używana jest standardowa biel).',
    screenCountdownLabel: 'Odliczanie dla błysku ekranu (s)',
    resetDefaults: 'Przywróć domyślne',
    inspectorTitle: 'Podgląd zakodowanej ramki WOP v2.4',
    inspectorHeader: 'Nagłówek (8b)',
    inspectorLength: 'Długość (4b)',
    inspectorMsg1: 'Strefa+Czas+Data',
    inspectorMsg2: 'DST Lato/Zima',
    inspectorCrc: 'CRC-8 (8b)',
    inspectorStuffed: 'Bit-stuffing + 2 zera',
    inspectorBitsInfo: '{raw} bitów surowych → {stuffed} po stuffingu + 2 zera = {tx} bitów (~{sec} s)',
    screenOverlayHint: 'Umieść czujnik godziny 12 zegarka nad jasnym polem',
    screenOverlayPrep: 'Przygotuj zegarek... {sec}',
    screenOverlayCancel: 'Dotknij, aby anulować',
    footerNote: 'Odtworzony protokół optyczny WOP v2.4 · Działa w 100% lokalnie w przeglądarce · Żadne dane nie są wysyłane na zewnątrz.',
  },
};

export function detectInitialLanguage() {
  try {
    const saved = localStorage.getItem('wop_lang');
    if (saved === 'en' || saved === 'pl') return saved;
  } catch {
    // ignore
  }
  const navLang = (navigator.language || 'en').toLowerCase();
  return navLang.startsWith('pl') ? 'pl' : 'en';
}

export function createTranslator(lang) {
  const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;
  function t(key, vars = null) {
    let str = dict[key] ?? TRANSLATIONS.en[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replaceAll(`{${k}}`, String(v));
      }
    }
    return str;
  }
  t.has = (key) => Object.prototype.hasOwnProperty.call(dict, key) || Object.prototype.hasOwnProperty.call(TRANSLATIONS.en, key);
  return t;
}
