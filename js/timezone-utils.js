/**
 * Timezone & DST discovery using the browser's built-in IANA TZDB (Intl.DateTimeFormat).
 * Computes:
 *  - Standard (non-DST) UTC offset in minutes -> WOP hourShift (-12..+15) & minuteShift (0/30/45)
 *  - Whether the timezone observes DST in a given year
 *  - Exact local spring-forward (SUMMER) and fall-back (WINTER) transition dates & hours
 *  - Hemisphere (NORTH if summerStartMonth < winterStopMonth, else SOUTH)
 */

import { WOP } from './wop-protocol.js';

const FALLBACK_TIMEZONES = [
  'UTC',
  'Europe/Warsaw',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Zurich',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Athens',
  'Europe/Helsinki',
  'Europe/Istanbul',
  'Europe/Moscow',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/St_Johns',
  'America/Toronto',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'America/Santiago',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Perth',
  'Australia/Adelaide',
  'Australia/Sydney',
  'Pacific/Auckland',
  'Pacific/Chatham',
];

const formatterCache = new Map();

function getPartsFormatter(timeZone) {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

/**
 * Returns local calendar fields for a UTC timestamp in `timeZone`.
 */
export function getLocalParts(utcMs, timeZone) {
  const parts = getPartsFormatter(timeZone).formatToParts(new Date(utcMs));
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') {
      map[p.type] = Number(p.value);
    }
  }
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour === 24 ? 0 : map.hour,
    minute: map.minute,
    second: map.second,
  };
}

/**
 * Returns the UTC offset in whole minutes for `timeZone` at instant `utcMs`.
 * Positive east of Greenwich (e.g., Europe/Warsaw winter = +60, summer = +120).
 */
export function getOffsetMinutesAt(utcMs, timeZone) {
  const p = getLocalParts(utcMs, timeZone);
  const asUtcMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const baseSecMs = Math.floor(utcMs / 1000) * 1000;
  return Math.round((asUtcMs - baseSecMs) / 60000);
}

/**
 * Binary-search the exact UTC minute of an offset change between loMs and hiMs.
 */
function findTransitionMs(loMs, hiMs, timeZone, offsetAtLo) {
  let lo = loMs;
  let hi = hiMs;
  while (hi - lo > 60_000) {
    const mid = Math.floor((lo + hi) / 2);
    if (getOffsetMinutesAt(mid, timeZone) === offsetAtLo) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return hi;
}

const SOUTHERN_HEMISPHERE_PREFIXES = [
  'Antarctica/',
  'Australia/',
  'America/Argentina/',
];

const SOUTHERN_HEMISPHERE_ZONES = new Set([
  'Africa/Blantyre',
  'Africa/Brazzaville',
  'Africa/Bujumbura',
  'Africa/Dar_es_Salaam',
  'Africa/Gaborone',
  'Africa/Harare',
  'Africa/Johannesburg',
  'Africa/Kigali',
  'Africa/Kinshasa',
  'Africa/Libreville',
  'Africa/Luanda',
  'Africa/Lubumbashi',
  'Africa/Lusaka',
  'Africa/Maputo',
  'Africa/Maseru',
  'Africa/Mbabane',
  'Africa/Nairobi',
  'Africa/Windhoek',
  'America/Araguaina',
  'America/Asuncion',
  'America/Bahia',
  'America/Belem',
  'America/Buenos_Aires',
  'America/Campo_Grande',
  'America/Cuiaba',
  'America/Eirunepe',
  'America/Fortaleza',
  'America/Guayaquil',
  'America/La_Paz',
  'America/Lima',
  'America/Maceio',
  'America/Manaus',
  'America/Montevideo',
  'America/Noronha',
  'America/Porto_Velho',
  'America/Punta_Arenas',
  'America/Recife',
  'America/Rio_Branco',
  'America/Santarem',
  'America/Santiago',
  'America/Sao_Paulo',
  'Asia/Dili',
  'Asia/Jakarta',
  'Asia/Jayapura',
  'Asia/Makassar',
  'Atlantic/St_Helena',
  'Atlantic/Stanley',
  'Indian/Antananarivo',
  'Indian/Chagos',
  'Indian/Christmas',
  'Indian/Cocos',
  'Indian/Comoro',
  'Indian/Kerguelen',
  'Indian/Mahe',
  'Indian/Mauritius',
  'Indian/Mayotte',
  'Indian/Reunion',
  'Pacific/Apia',
  'Pacific/Auckland',
  'Pacific/Bougainville',
  'Pacific/Chatham',
  'Pacific/Easter',
  'Pacific/Efate',
  'Pacific/Fakaofo',
  'Pacific/Fiji',
  'Pacific/Funafuti',
  'Pacific/Galapagos',
  'Pacific/Gambier',
  'Pacific/Guadalcanal',
  'Pacific/Kanton',
  'Pacific/Marquesas',
  'Pacific/Nauru',
  'Pacific/Niue',
  'Pacific/Norfolk',
  'Pacific/Noumea',
  'Pacific/Pago_Pago',
  'Pacific/Pitcairn',
  'Pacific/Port_Moresby',
  'Pacific/Rarotonga',
  'Pacific/Tahiti',
  'Pacific/Tongatapu',
  'Pacific/Wallis',
]);

function inferHemisphereWithoutDst(timeZone) {
  if (SOUTHERN_HEMISPHERE_ZONES.has(timeZone)) {
    return WOP.HEMISPHERE.SOUTH;
  }
  for (const prefix of SOUTHERN_HEMISPHERE_PREFIXES) {
    if (timeZone.startsWith(prefix)) {
      return WOP.HEMISPHERE.SOUTH;
    }
  }
  return WOP.HEMISPHERE.NORTH;
}

/**
 * Inspect an IANA timezone for a given calendar year and return full WOP-compatible metadata.
 */
export function analyzeTimezone(timeZone, year = new Date().getUTCFullYear()) {
  const janOffset = getOffsetMinutesAt(Date.UTC(year, 0, 1, 12, 0, 0), timeZone);
  const julOffset = getOffsetMinutesAt(Date.UTC(year, 6, 1, 12, 0, 0), timeZone);

  // Sample every 12 hours across the target year to catch any DST transitions
  const yearStartMs = Date.UTC(year, 0, 1, 0, 0, 0);
  const yearEndMs = Date.UTC(year + 1, 0, 1, 0, 0, 0);
  const stepMs = 12 * 3600 * 1000;

  let prevMs = yearStartMs;
  let prevOffset = getOffsetMinutesAt(prevMs, timeZone);
  const offsetsSeen = new Set([prevOffset, janOffset, julOffset]);
  let startEvent = null;
  let stopEvent = null;

  for (let t = yearStartMs + stepMs; t <= yearEndMs; t += stepMs) {
    const off = getOffsetMinutesAt(t, timeZone);
    offsetsSeen.add(off);
    if (off !== prevOffset) {
      const transitionMs = findTransitionMs(prevMs, t, timeZone, prevOffset);
      // Local time immediately before the transition (rounded to nearest hour)
      // matches WOP dstrules.csv convention (e.g. EU: 02:00 spring, 03:00 autumn; US: 02:00 / 02:00).
      const beforeParts = getLocalParts(transitionMs - 60_000, timeZone);
      let eventHour = beforeParts.hour + (beforeParts.minute >= 30 ? 1 : 0);
      let eventDay = beforeParts.day;
      let eventMonth = beforeParts.month;
      if (eventHour >= 24) {
        // Handle 23:59 -> 00:00 transition (e.g. midnight DST rules)
        const nextDayParts = getLocalParts(transitionMs - 60_000 + 3600_000, timeZone);
        eventHour = 0;
        // Compute next calendar day from beforeParts directly so DST jump doesn't skew it
        const d = new Date(Date.UTC(beforeParts.year, beforeParts.month - 1, beforeParts.day + 1));
        eventMonth = d.getUTCMonth() + 1;
        eventDay = d.getUTCDate();
        void nextDayParts;
      }

      if (off > prevOffset && !startEvent) {
        startEvent = {
          season: WOP.SEASON.SUMMER,
          month: eventMonth,
          day: eventDay,
          hour: eventHour,
          utcMs: transitionMs,
        };
      } else if (off < prevOffset && !stopEvent) {
        stopEvent = {
          season: WOP.SEASON.WINTER,
          month: eventMonth,
          day: eventDay,
          hour: eventHour,
          utcMs: transitionMs,
        };
      }
      prevOffset = off;
    }
    prevMs = t;
  }

  const minOffset = Math.min(...offsetsSeen);
  const maxOffset = Math.max(...offsetsSeen);
  const dstShiftMinutes = maxOffset - minOffset;
  const hasTwoTransitions = Boolean(startEvent && stopEvent);
  const nonStandardDst = hasTwoTransitions && dstShiftMinutes !== 60;
  // WOP DST sub-message assumes a standard 1-hour seasonal shift; omit incompatible 30m/2h rules
  const hasDst = hasTwoTransitions && dstShiftMinutes === 60;

  const nowOffsetMinutes = getOffsetMinutesAt(Date.now(), timeZone);
  // For standard 1-hour DST zones, send the base (non-DST) offset so the watch applies DST itself.
  // For zones without WOP-compatible DST (including permanent offset changes or non-1h DST),
  // send the active offset so the watch displays the exact current local time.
  const standardOffsetMinutes = hasDst ? minOffset : nowOffsetMinutes;
  const isDstNow = hasDst && nowOffsetMinutes > standardOffsetMinutes;

  const hemisphere = hasTwoTransitions
    ? (startEvent.month < stopEvent.month ? WOP.HEMISPHERE.NORTH : WOP.HEMISPHERE.SOUTH)
    : inferHemisphereWithoutDst(timeZone);

  // Split standardOffsetMinutes into WOP hourShift + minuteShift (truncating toward zero like Java TimeUnit.toHours)
  const hourShift = Math.trunc(standardOffsetMinutes / 60);
  const absRemMinutes = Math.abs(standardOffsetMinutes % 60);
  let minuteShift = WOP.MINUTE_SHIFT.NONE;
  if (absRemMinutes >= 45) {
    minuteShift = WOP.MINUTE_SHIFT.FORTY_FIVE;
  } else if (absRemMinutes >= 30) {
    minuteShift = WOP.MINUTE_SHIFT.THIRTY;
  }

  return {
    id: timeZone,
    standardOffsetMinutes,
    currentOffsetMinutes: nowOffsetMinutes,
    isDstNow,
    hourShift,
    minuteShift,
    hemisphere,
    hasDst,
    nonStandardDst,
    dstShiftMinutes,
    dst: hasDst
      ? {
          start: {
            season: WOP.SEASON.SUMMER,
            month: startEvent.month,
            day: startEvent.day,
            hour: startEvent.hour,
          },
          stop: {
            season: WOP.SEASON.WINTER,
            month: stopEvent.month,
            day: stopEvent.day,
            hour: stopEvent.hour,
          },
        }
      : null,
  };
}

export function getSupportedTimezones() {
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
      const list = Intl.supportedValuesOf('timeZone');
      if (Array.isArray(list) && list.length > 0) {
        return list.includes('UTC') ? list : ['UTC', ...list];
      }
    }
  } catch {
    // Fallback below
  }
  return FALLBACK_TIMEZONES.slice();
}

export function getLocalSystemTimezone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) return tz;
  } catch {
    // Fallback below
  }
  return 'UTC';
}

export function formatUtcOffset(offsetMinutes) {
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const h = String(Math.floor(abs / 60)).padStart(2, '0');
  const m = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${h}:${m}`;
}
