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

async function fetchJsonWithTimeout(url, timeoutMs = 2800) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const t0Ms = Date.now();
    const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    const t1Ms = Date.now();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { data, t0Ms, t1Ms };
  } finally {
    clearTimeout(id);
  }
}

/**
 * Try millisecond-precision public CORS UTC time APIs, then fall back to same-origin
 * HTTP Date header (1-second resolution, works on GitHub Pages CDN).
 */
export async function syncNetworkUtcOffset() {
  // 1. timeapi.io (millisecond UTC JSON with CORS)
  try {
    const { data, t0Ms, t1Ms } = await fetchJsonWithTimeout(
      'https://timeapi.io/api/time/current/zone?timeZone=UTC',
      2800,
    );
    if (data && typeof data.dateTime === 'string') {
      const iso = data.dateTime.endsWith('Z') ? data.dateTime : `${data.dateTime}Z`;
      const serverUtcMs = Date.parse(iso);
      if (Number.isFinite(serverUtcMs)) {
        return {
          synced: true,
          source: 'timeapi.io',
          precision: 'ms',
          ...computeClockOffsetMs({ t0Ms, t1Ms, serverUtcMs }),
        };
      }
    }
  } catch {
    // Try next source
  }

  // 2. worldtimeapi.org (millisecond UTC JSON with CORS)
  try {
    const { data, t0Ms, t1Ms } = await fetchJsonWithTimeout(
      'https://worldtimeapi.org/api/timezone/Etc/UTC',
      2800,
    );
    if (data && typeof data.utc_datetime === 'string') {
      const serverUtcMs = Date.parse(data.utc_datetime);
      if (Number.isFinite(serverUtcMs)) {
        return {
          synced: true,
          source: 'worldtimeapi.org',
          precision: 'ms',
          ...computeClockOffsetMs({ t0Ms, t1Ms, serverUtcMs }),
        };
      }
    }
  } catch {
    // Try next source
  }

  // 3. Same-origin HTTP Date header fallback (accurate to ~0.5s, works offline-safe if server responds)
  try {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), 2200);
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
          // Only apply 1s-resolution header offset if device clock is noticeably off (> 1.2s)
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
