/**
 * Optional network UTC offset estimator (SNTP-inspired over HTTPS).
 * Computes `offsetMs = networkUtcMs - Date.now()` with half-RTT compensation.
 * Falls back silently to 0 ms (device clock) when offline or blocked.
 */

export function computeClockOffsetMs({ t0Ms, t1Ms, serverUtcMs }) {
  const rttMs = Math.max(0, t1Ms - t0Ms);
  const estimatedLocalAtServer = t0Ms + rttMs / 2;
  return {
    offsetMs: Math.round(serverUtcMs - estimatedLocalAtServer),
    rttMs: Math.round(rttMs),
  };
}

/**
 * Synchronizes UTC offset against the same-origin HTTP `Date` header (Fastly/GitHub Pages CDN,
 * NTP-synced, zero CORS errors or third-party outages). Applies correction whenever device clock
 * drift exceeds 1.2s; otherwise trusts the local system clock cleanly.
 */
export async function syncNetworkUtcOffset() {
  try {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), 2500);
    try {
      const t0Ms = Date.now();
      const res = await fetch(`./index.html?ts=${t0Ms}`, {
        method: 'HEAD',
        cache: 'no-store',
        signal: ctrl.signal,
      });
      const t1Ms = Date.now();
      const dateHdr = res.headers.get('Date');
      if (dateHdr) {
        const serverUtcMs = Date.parse(dateHdr) + 500; // midpoint of 1-second HTTP Date truncation
        if (Number.isFinite(serverUtcMs)) {
          const calc = computeClockOffsetMs({ t0Ms, t1Ms, serverUtcMs });
          const appliedOffset = Math.abs(calc.offsetMs) > 1200 ? calc.offsetMs : 0;
          return {
            synced: true,
            source: 'http-date',
            precision: 's',
            offsetMs: appliedOffset,
            rawOffsetMs: calc.offsetMs,
            rttMs: calc.rttMs,
          };
        }
      }
    } finally {
      clearTimeout(id);
    }
  } catch {
    // Offline
  }

  return {
    synced: false,
    source: 'device',
    precision: 'local',
    offsetMs: 0,
    rttMs: 0,
  };
}
