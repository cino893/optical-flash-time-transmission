/**
 * Watch Optical Protocol (WOP v2.4) encoder for Longines Conquest V.H.P. GMT Flash Setting.
 *
 * Frame layout (MultiMessage):
 *   ProtHeader (8 bits: 11101010)
 *   ProtLength (4 bits: number of sub-messages, 1 or 2)
 *   [Sub-message 1]
 *     ProtOpcode (8 bits: 57 = TZ_TIME_DATE_T1 Home, 58 = TZ_TIME_DATE_T2 Travel)
 *     ProtPayload (41 bits):
 *       Timezone (8 bits): hourShift (5b two's complement, -12..+15) | minuteShift (2b: 0=0m, 1=30m, 2=45m) | hemisphere (1b: 0=NORTH, 1=SOUTH)
 *       Time     (17 bits): utcHour (5b, 0..23) | utcMinute (6b, 0..59) | utcSecond (6b, 0..59)
 *       Date     (16 bits): yearMod100 (7b, 0..99) | month (4b, 1..12) | day (5b, 1..31)
 *   [Sub-message 2 — optional, included when timezone observes DST]
 *     ProtOpcode (8 bits: 59 = DST_DATE_TIME_SUMMER_WINTER_T1, 60 = DST_DATE_TIME_SUMMER_WINTER_T2)
 *     ProtPayload (30 bits):
 *       SummerEvent (15 bits): season (1b: 0=SUMMER) | month (4b) | day (5b) | hour (5b)
 *       WinterEvent (15 bits): season (1b: 1=WINTER) | month (4b) | day (5b) | hour (5b)
 *   ProtErrorDetection (8 bits): CRC-8 over all bits AFTER ProtHeader, polynomial 0x107 (263)
 *
 * Post-processing:
 *   - 5-bit bipolar bit stuffing (after 5 consecutive identical bits, insert inverted bit;
 *     the inserted stuff bit counts as bit #1 of the next run).
 *   - Append 2 trailing zero bits [0, 0].
 *   - Transmit via OOK (1 = ON, 0 = OFF) with bitPeriod (default 30 ms) and optional rising-edge offset.
 */

export const WOP = Object.freeze({
  HEADER_BYTE: 117, // 0b1110101 + trailing 0 => 11101010
  CRC_POLYNOM: 263, // 0b100000111 (x^8 + x^2 + x + 1)
  CRC_RANK: 8,
  STUFF_MAX_RUN: 5,
  ENDING_ZEROS: 2,
  DEFAULT_BIT_PERIOD_MS: 30,
  MIN_BIT_PERIOD_MS: 10,
  MAX_BIT_PERIOD_MS: 100,
  DEFAULT_TORCH_OFFSET_MS: 0,
  APPLE_TORCH_OFFSET_MS: 8,
  MAX_OFFSET_MS: 30,

  OPCODE: Object.freeze({
    TZ_TIME_DATE_T1: 57,
    TZ_TIME_DATE_T2: 58,
    DST_DATE_TIME_SUMMER_WINTER_T1: 59,
    DST_DATE_TIME_SUMMER_WINTER_T2: 60,
  }),

  MINUTE_SHIFT: Object.freeze({
    NONE: 0,       // 0 min
    THIRTY: 1,     // 30 min
    FORTY_FIVE: 2, // 45 min
  }),

  HEMISPHERE: Object.freeze({
    NORTH: 0,
    SOUTH: 1,
  }),

  SEASON: Object.freeze({
    SUMMER: 0,
    WINTER: 1,
  }),
});

/**
 * Convert an integer into an MSB-first array of `bitWidth` bits (0/1).
 * For negative values, uses two's complement truncated to `bitWidth` bits,
 * matching Java's ByteUtil.toByteArray(val, width) + ProtBuffer right-alignment.
 */
export function intToBits(value, bitWidth) {
  if (!Number.isInteger(value)) {
    throw new RangeError(`Expected integer value, got ${value}`);
  }
  if (!Number.isInteger(bitWidth) || bitWidth <= 0 || bitWidth > 31) {
    throw new RangeError(`Invalid bitWidth: ${bitWidth}`);
  }
  const bits = new Array(bitWidth);
  const masked = value < 0 ? (value >>> 0) : value;
  for (let i = 0; i < bitWidth; i++) {
    bits[bitWidth - 1 - i] = (masked >>> i) & 1;
  }
  return bits;
}

export function encodeHeader() {
  const bits = new Array(8);
  for (let i = 0; i < 7; i++) {
    bits[i] = (WOP.HEADER_BYTE >> (6 - i)) & 1;
  }
  bits[7] = 0;
  return bits; // [1, 1, 1, 0, 1, 0, 1, 0]
}

export function encodeLength(messageCount) {
  if (!Number.isInteger(messageCount) || messageCount < 1 || messageCount > 15) {
    throw new RangeError(`Invalid MultiMessage count: ${messageCount}`);
  }
  return intToBits(messageCount, 4);
}

export function encodeOpcode(opcode) {
  if (!Number.isInteger(opcode) || opcode < 0 || opcode > 255) {
    throw new RangeError(`Invalid opcode: ${opcode}`);
  }
  return intToBits(opcode, 8);
}

export function encodeTimezonePayload({ hourShift, minuteShift = 0, hemisphere = 0 }) {
  if (!Number.isInteger(hourShift) || hourShift < -12 || hourShift > 15) {
    throw new RangeError(`Invalid hourShift ${hourShift}. Accepted [-12, 15].`);
  }
  if (minuteShift !== 0 && minuteShift !== 1 && minuteShift !== 2) {
    throw new RangeError(`Invalid minuteShift ${minuteShift}. Accepted [0, 1, 2].`);
  }
  if (hemisphere !== 0 && hemisphere !== 1) {
    throw new RangeError(`Invalid hemisphere ${hemisphere}. Accepted [0, 1].`);
  }
  return [
    ...intToBits(hourShift, 5),
    ...intToBits(minuteShift, 2),
    ...intToBits(hemisphere, 1),
  ];
}

export function encodeTimePayload({ hour, minute, second }) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError(`Invalid hour ${hour}. Accepted [0, 23].`);
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new RangeError(`Invalid minute ${minute}. Accepted [0, 59].`);
  }
  if (!Number.isInteger(second) || second < 0 || second > 59) {
    throw new RangeError(`Invalid second ${second}. Accepted [0, 59].`);
  }
  return [
    ...intToBits(hour, 5),
    ...intToBits(minute, 6),
    ...intToBits(second, 6),
  ];
}

export function encodeDatePayload({ year, month, day }) {
  const yearTwoDigit = year >= 100 ? year % 100 : year;
  if (!Number.isInteger(yearTwoDigit) || yearTwoDigit < 0 || yearTwoDigit > 99) {
    throw new RangeError(`Invalid year ${year}. Accepted [0, 99].`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`Invalid month ${month}. Accepted [1, 12].`);
  }
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new RangeError(`Invalid day ${day}. Accepted [1, 31].`);
  }
  return [
    ...intToBits(yearTwoDigit, 7),
    ...intToBits(month, 4),
    ...intToBits(day, 5),
  ];
}

export function encodeDstEventPayload({ season, month, day, hour }) {
  if (season !== 0 && season !== 1) {
    throw new RangeError(`Invalid DST season ${season}. Accepted [0, 1].`);
  }
  if (!Number.isInteger(month) || month < 0 || month > 12) {
    throw new RangeError(`Invalid DST month ${month}. Accepted [0, 12].`);
  }
  if (!Number.isInteger(day) || day < 0 || day > 31) {
    throw new RangeError(`Invalid DST day ${day}. Accepted [0, 31].`);
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError(`Invalid DST hour ${hour}. Accepted [0, 23].`);
  }
  return [
    ...intToBits(season, 1),
    ...intToBits(month, 4),
    ...intToBits(day, 5),
    ...intToBits(hour, 5),
  ];
}

/**
 * CRC-8 polynomial division over a bit array (0/1), polynomial 263 (0b100000111).
 * Matches ProtErrorDetection.CRC8checksum bit-for-bit.
 */
export function computeCrc8(bits) {
  if (!bits || bits.length === 0) {
    return new Array(WOP.CRC_RANK).fill(0);
  }
  const polyBits = intToBits(WOP.CRC_POLYNOM, WOP.CRC_RANK + 1); // 9 bits: [1,0,0,0,0,0,1,1,1]
  const padded = new Uint8Array(bits.length + WOP.CRC_RANK);
  for (let i = 0; i < bits.length; i++) {
    padded[i] = bits[i] & 1;
  }

  const reg = padded.slice(0, polyBits.length);
  const lastIndex = polyBits.length + bits.length - 1;

  for (let idx = polyBits.length; idx < polyBits.length + bits.length; idx++) {
    if (reg[0] !== 0) {
      for (let j = 0; j < polyBits.length; j++) {
        reg[j] ^= polyBits[j];
      }
    }
    if (idx < lastIndex) {
      for (let j = 0; j < reg.length - 1; j++) {
        reg[j] = reg[j + 1];
      }
      reg[reg.length - 1] = padded[idx];
    }
  }
  return Array.from(reg.slice(1));
}

/**
 * Bipolar 5-bit stuffing matching Encoder.addStuffbits().
 * After 5 consecutive identical bits, inserts the inverted bit.
 * Crucially, the inserted stuff bit becomes the first bit of the next run.
 */
export function addStuffBits(bits) {
  if (bits.length < WOP.STUFF_MAX_RUN) {
    return bits.slice();
  }
  const out = [];
  let prev = 0;
  let run = 0;

  for (let i = 0; i < bits.length; i++) {
    let bit = bits[i] & 1;
    if (i === 0) {
      out.push(bit);
      run = 1;
      prev = bit;
    } else {
      let nextRun = 1;
      if (bit === prev) {
        out.push(bit);
        const candidateRun = run + 1;
        if (candidateRun === WOP.STUFF_MAX_RUN) {
          bit = bit === 1 ? 0 : 1;
          out.push(bit);
          // nextRun stays 1; prev becomes the inserted stuff bit
        } else {
          nextRun = candidateRun;
        }
      } else {
        out.push(bit);
      }
      prev = bit;
      run = nextRun;
    }
  }
  return out;
}

/**
 * Build a complete WOP MultiMessage frame (raw, stuffed, and final with ending zeros).
 *
 * @param {object} params
 * @param {'home'|'travel'} params.mode - T1 (home) or T2 (travel)
 * @param {{ hourShift: number, minuteShift: number, hemisphere: number }} params.timezone
 * @param {{ hour: number, minute: number, second: number }} params.utcTime
 * @param {{ year: number, month: number, day: number }} params.date
 * @param {{ start: { season: number, month: number, day: number, hour: number }, stop: { season: number, month: number, day: number, hour: number } } | null} [params.dst]
 * @param {boolean} [params.bitStuffing=true]
 */
export function buildWopFrame({ mode, timezone, utcTime, date, dst = null, bitStuffing = true }) {
  const isHome = mode === 'home';
  const tzTimeDateOpcode = isHome ? WOP.OPCODE.TZ_TIME_DATE_T1 : WOP.OPCODE.TZ_TIME_DATE_T2;
  const dstOpcode = isHome
    ? WOP.OPCODE.DST_DATE_TIME_SUMMER_WINTER_T1
    : WOP.OPCODE.DST_DATE_TIME_SUMMER_WINTER_T2;

  const headerBits = encodeHeader();
  const hasDst = Boolean(dst && dst.start && dst.stop);
  const lengthBits = encodeLength(hasDst ? 2 : 1);

  const tzBits = encodeTimezonePayload(timezone);
  const timeBits = encodeTimePayload(utcTime);
  const dateBits = encodeDatePayload(date);
  const subMsg1Opcode = encodeOpcode(tzTimeDateOpcode);
  const subMsg1Payload = [...tzBits, ...timeBits, ...dateBits];

  let subMsg2Opcode = [];
  let subMsg2Payload = [];
  if (hasDst) {
    subMsg2Opcode = encodeOpcode(dstOpcode);
    subMsg2Payload = [
      ...encodeDstEventPayload(dst.start),
      ...encodeDstEventPayload(dst.stop),
    ];
  }

  // CRC-8 covers all elements AFTER ProtHeader
  const contentBits = [
    ...lengthBits,
    ...subMsg1Opcode,
    ...subMsg1Payload,
    ...subMsg2Opcode,
    ...subMsg2Payload,
  ];
  const crcBits = computeCrc8(contentBits);

  const rawBits = [...headerBits, ...contentBits, ...crcBits];
  const stuffedBits = bitStuffing ? addStuffBits(rawBits) : rawBits.slice();
  const txBits = [...stuffedBits, ...new Array(WOP.ENDING_ZEROS).fill(0)];

  return {
    segments: {
      headerBits,
      lengthBits,
      subMsg1Opcode,
      tzBits,
      timeBits,
      dateBits,
      subMsg2Opcode,
      subMsg2Payload,
      crcBits,
    },
    rawBits,
    stuffedBits,
    txBits,
    hasDst,
  };
}

/**
 * Compute target UTC second and transmission start delay so the stuffed frame
 * completes precisely on a whole UTC second boundary (just like TimeMessageAutoAdjustUtc,
 * refined to account for exact post-stuffing bit length).
 */
export function buildAutoSyncedFrame({
  nowMs,
  mode,
  timezone,
  dst = null,
  bitPeriodMs = WOP.DEFAULT_BIT_PERIOD_MS,
  dateRef = 'utc', // 'utc' (consistent with watch UTC clock) or 'local'
  getDateParts = null, // optional (utcMs) => { year, month, day } for target-timezone local dates
  bitStuffing = true,
  compensateDuration = true,
}) {
  const safePeriod = Math.max(WOP.MIN_BIT_PERIOD_MS, Math.min(WOP.MAX_BIT_PERIOD_MS, Math.round(bitPeriodMs)));

  const makeDateParts = (ms) => {
    if (typeof getDateParts === 'function') {
      return getDateParts(ms);
    }
    const d = new Date(ms);
    if (dateRef === 'local') {
      return {
        year: d.getFullYear() % 100,
        month: d.getMonth() + 1,
        day: d.getDate(),
      };
    }
    return {
      year: d.getUTCFullYear() % 100,
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
    };
  };

  const makeUtcTimeParts = (ms) => {
    const d = new Date(ms);
    return {
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
    };
  };

  if (!compensateDuration) {
    const targetUtcMs = Math.floor(nowMs / 1000) * 1000;
    const frame = buildWopFrame({
      mode,
      timezone,
      utcTime: makeUtcTimeParts(targetUtcMs),
      date: makeDateParts(targetUtcMs),
      dst,
      bitStuffing,
    });
    const stuffedDurationMs = frame.stuffedBits.length * safePeriod;
    return {
      frame,
      targetUtcMs,
      startDelayMs: 0,
      stuffedDurationMs,
      totalDurationMs: (frame.txBits.length + 1) * safePeriod,
      bitPeriodMs: safePeriod,
    };
  }

  // Pass 1: estimate stuffed duration using placeholder 00:00:00
  const estFrame = buildWopFrame({
    mode,
    timezone,
    utcTime: { hour: 0, minute: 0, second: 0 },
    date: makeDateParts(nowMs),
    dst,
    bitStuffing,
  });

  // Encoder waits 1 bitPeriod before emitting bit 0, then stuffedBits.length * bitPeriod
  const estDurationMs = estFrame.stuffedBits.length * safePeriod;
  const roughEndMs = nowMs + estDurationMs + safePeriod;
  let targetUtcMs = Math.ceil(roughEndMs / 1000) * 1000;
  if (targetUtcMs - roughEndMs < 80) {
    // Leave at least 80 ms headroom for camera/torch prep so delay never goes negative
    targetUtcMs += 1000;
  }

  // Pass 2: build real frame for targetUtcMs and compute exact delay
  let frame = buildWopFrame({
    mode,
    timezone,
    utcTime: makeUtcTimeParts(targetUtcMs),
    date: makeDateParts(targetUtcMs),
    dst,
    bitStuffing,
  });
  let stuffedDurationMs = frame.stuffedBits.length * safePeriod;
  let startDelayMs = targetUtcMs - nowMs - stuffedDurationMs - safePeriod;

  // If bit stuffing grew the frame past targetUtcMs, bump by 1 second and rebuild
  if (startDelayMs < 0) {
    targetUtcMs += 1000;
    frame = buildWopFrame({
      mode,
      timezone,
      utcTime: makeUtcTimeParts(targetUtcMs),
      date: makeDateParts(targetUtcMs),
      dst,
      bitStuffing,
    });
    stuffedDurationMs = frame.stuffedBits.length * safePeriod;
    startDelayMs = Math.max(0, targetUtcMs - nowMs - stuffedDurationMs - safePeriod);
  }

  return {
    frame,
    targetUtcMs,
    startDelayMs,
    stuffedDurationMs,
    totalDurationMs: (frame.txBits.length + 1) * safePeriod,
    bitPeriodMs: safePeriod,
  };
}

/**
 * Compute per-bit absolute firing offsets (in ms relative to transmission start)
 * faithfully replicating Encoder.encode()'s rising-edge torch turn-on compensation.
 *
 * When transitioning 0 -> 1, the command fires `offsetMs` early to compensate for
 * LED turn-on latency, then adds `offsetMs` back on the subsequent bit so the
 * overall timeline never drifts.
 */
export function buildBitSchedule(txBits, bitPeriodMs = WOP.DEFAULT_BIT_PERIOD_MS, offsetMs = 0) {
  const maxSafeOffset = Math.min(WOP.MAX_OFFSET_MS, Math.max(0, Math.floor(bitPeriodMs / 2)));
  const clampedOffset = Math.max(-maxSafeOffset, Math.min(maxSafeOffset, offsetMs));
  const schedule = [];
  let t = bitPeriodMs;
  let compensated = false;

  if (txBits.length > 0 && txBits[0] === 1 && clampedOffset !== 0) {
    t -= clampedOffset;
    compensated = true;
  }

  for (let i = 0; i < txBits.length; i++) {
    const bit = txBits[i];
    const nextBit = i < txBits.length - 1 ? txBits[i + 1] : 0;
    schedule.push({
      index: i,
      bit,
      timeMs: Math.max(0, t),
    });

    t += bitPeriodMs;
    if (compensated) {
      t += clampedOffset;
      compensated = false;
    }
    if (bit === 0 && nextBit === 1 && clampedOffset !== 0) {
      t -= clampedOffset;
      compensated = true;
    }
  }

  const endTimeMs = schedule.length > 0 ? t : 0;
  return { schedule, endTimeMs };
}

export function bitsToString(bits) {
  return bits.join('');
}
