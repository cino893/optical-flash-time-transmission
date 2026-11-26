import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import {
  WOP,
  intToBits,
  encodeHeader,
  encodeLength,
  encodeOpcode,
  encodeTimezonePayload,
  encodeTimePayload,
  encodeDatePayload,
  encodeDstEventPayload,
  computeCrc8,
  addStuffBits,
  buildWopFrame,
  buildAutoSyncedFrame,
  buildBitSchedule,
  bitsToString,
} from '../js/wop-protocol.js';
import { analyzeTimezone } from '../js/timezone-utils.js';
import {
  recommendBitPeriodFromLatency,
  classifyCameraError,
  detectTorchCapability,
  detectHdrDisplaySupport,
  detectCameraPresence,
  snapRefreshRateHz,
  measureDisplayRefreshRate,
  recommendScreenBitPeriodFromHz,
} from '../js/flash-driver.js';
import { computeClockOffsetMs } from '../js/time-sync.js';
import { TRANSLATIONS, createTranslator } from '../js/i18n.js';

test('ProtHeader matches 117 << 1 = 11101010', () => {
  assert.equal(bitsToString(encodeHeader()), '11101010');
});

test('ProtLength encodes 4-bit message count', () => {
  assert.equal(bitsToString(encodeLength(1)), '0001');
  assert.equal(bitsToString(encodeLength(2)), '0010');
});

test('ProtOpcode encodes 8-bit opcodes for Home (T1) and Travel (T2)', () => {
  assert.equal(bitsToString(encodeOpcode(WOP.OPCODE.TZ_TIME_DATE_T1)), '00111001'); // 57
  assert.equal(bitsToString(encodeOpcode(WOP.OPCODE.TZ_TIME_DATE_T2)), '00111010'); // 58
  assert.equal(bitsToString(encodeOpcode(WOP.OPCODE.DST_DATE_TIME_SUMMER_WINTER_T1)), '00111011'); // 59
  assert.equal(bitsToString(encodeOpcode(WOP.OPCODE.DST_DATE_TIME_SUMMER_WINTER_T2)), '00111100'); // 60
});

test('TimezoneMessage encodes positive and negative two\'s complement shifts correctly', () => {
  // Europe/Warsaw: +1h, 0m, NORTH -> 00001 00 0
  assert.equal(
    bitsToString(encodeTimezonePayload({ hourShift: 1, minuteShift: 0, hemisphere: 0 })),
    '00001000',
  );
  // America/New_York: -5h, 0m, NORTH -> (-5 & 0x1F = 27 = 11011) 00 0
  assert.equal(
    bitsToString(encodeTimezonePayload({ hourShift: -5, minuteShift: 0, hemisphere: 0 })),
    '11011000',
  );
  // -12h -> (-12 & 0x1F = 20 = 10100)
  assert.equal(bitsToString(intToBits(-12, 5)), '10100');
  // +15h -> 01111
  assert.equal(bitsToString(intToBits(15, 5)), '01111');
  // India +5:30 -> 00101 01 1
  assert.equal(
    bitsToString(encodeTimezonePayload({ hourShift: 5, minuteShift: 1, hemisphere: 1 })),
    '00101011',
  );
  // Chatham +12:45 SOUTH -> 01100 10 1
  assert.equal(
    bitsToString(encodeTimezonePayload({ hourShift: 12, minuteShift: 2, hemisphere: 1 })),
    '01100101',
  );
});

test('TimeMessage, DateMessage, DstDateTimeMessage bit widths and packing', () => {
  // 14:35:09 -> 01110 | 100011 | 001001
  assert.equal(
    bitsToString(encodeTimePayload({ hour: 14, minute: 35, second: 9 })),
    '01110100011001001',
  );
  // 2026-11-25 -> 26 (0011010) | 11 (1011) | 25 (11001)
  assert.equal(
    bitsToString(encodeDatePayload({ year: 2026, month: 11, day: 25 })),
    '0011010101111001',
  );
  // DST Summer: March 29 02:00 -> 0 | 0011 | 11101 | 00010
  assert.equal(
    bitsToString(encodeDstEventPayload({ season: 0, month: 3, day: 29, hour: 2 })),
    '000111110100010',
  );
  // DST Winter: Oct 25 03:00 -> 1 | 1010 | 11001 | 00011
  assert.equal(
    bitsToString(encodeDstEventPayload({ season: 1, month: 10, day: 25, hour: 3 })),
    '110101100100011',
  );
});

test('CRC-8 with polynomial 263 (0x107) matches standard CRC-8-CCITT', () => {
  // Standard test vector: 0x00 -> 0x00; 0x01 -> 0x07; 0xFF -> 0xF3; "123456789" -> 0xF4
  assert.equal(bitsToString(computeCrc8(intToBits(0x01, 8))), '00000111');
  assert.equal(bitsToString(computeCrc8(intToBits(0xFF, 8))), '11110011');

  const ascii = '123456789';
  const asciiBits = [];
  for (const ch of ascii) {
    asciiBits.push(...intToBits(ch.charCodeAt(0), 8));
  }
  // Standard CRC-8 (poly 0x07, init 0x00, refin=false, refout=false, xorout=0x00) of "123456789" is 0xF4 = 11110100
  assert.equal(bitsToString(computeCrc8(asciiBits)), '11110100');
});

test('Bit stuffing inserts inverted bit after 5 consecutive identical bits and counts stuff bit as run=1', () => {
  // 5 zeros -> 000001
  assert.equal(bitsToString(addStuffBits([0, 0, 0, 0, 0])), '000001');
  // 5 ones -> 111110
  assert.equal(bitsToString(addStuffBits([1, 1, 1, 1, 1])), '111110');
  // Edge case: 5 zeros followed by 4 ones -> inserted '1' + four '1's = 5 ones -> inserts '0'!
  assert.equal(
    bitsToString(addStuffBits([0, 0, 0, 0, 0, 1, 1, 1, 1])),
    '00000111110',
  );
  // 10 zeros -> 00000 + 1 + 00000 + 1
  assert.equal(
    bitsToString(addStuffBits([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
    '000001000001',
  );
  // Short array (<5) unchanged
  assert.equal(bitsToString(addStuffBits([1, 1, 1, 1])), '1111');
});

test('Full MultiMessage frame lengths match WOP specification (with and without DST)', () => {
  const noDst = buildWopFrame({
    mode: 'home',
    timezone: { hourShift: 9, minuteShift: 0, hemisphere: 1 }, // Asia/Tokyo
    utcTime: { hour: 12, minute: 30, second: 45 },
    date: { year: 2026, month: 11, day: 25 },
    dst: null,
  });
  // 8 (header) + 4 (len) + 8 (op) + 41 (payload) + 8 (crc) = 69 raw bits
  assert.equal(noDst.rawBits.length, 69);
  assert.equal(noDst.txBits.length, noDst.stuffedBits.length + 2);
  assert.deepEqual(noDst.txBits.slice(-2), [0, 0]);

  const withDst = buildWopFrame({
    mode: 'travel',
    timezone: { hourShift: 1, minuteShift: 0, hemisphere: 0 }, // Europe/Warsaw
    utcTime: { hour: 12, minute: 30, second: 45 },
    date: { year: 2026, month: 11, day: 25 },
    dst: {
      start: { season: 0, month: 3, day: 29, hour: 2 },
      stop: { season: 1, month: 10, day: 25, hour: 3 },
    },
  });
  // 8 + 4 + 8 + 41 + 8 + 30 + 8 = 107 raw bits
  assert.equal(withDst.rawBits.length, 107);
  assert.equal(withDst.txBits.length, withDst.stuffedBits.length + 2);
});

test('Auto-sync timing lands end of stuffed frame on exact whole UTC second', () => {
  const nowMs = Date.UTC(2026, 10, 25, 11, 30, 12, 345);
  const res = buildAutoSyncedFrame({
    nowMs,
    mode: 'home',
    timezone: { hourShift: 1, minuteShift: 0, hemisphere: 0 },
    dst: {
      start: { season: 0, month: 3, day: 29, hour: 2 },
      stop: { season: 1, month: 10, day: 25, hour: 3 },
    },
    bitPeriodMs: 30,
  });

  assert.equal(res.targetUtcMs % 1000, 0);
  assert.ok(res.startDelayMs >= 0);
  // start + delay + initial bitPeriod + stuffedBits * bitPeriod === targetUtcMs
  const expectedEnd = nowMs + res.startDelayMs + res.bitPeriodMs + res.stuffedDurationMs;
  assert.equal(expectedEnd, res.targetUtcMs);

  // With compensateDuration disabled, sends current UTC second immediately with zero delay
  const uncomp = buildAutoSyncedFrame({
    nowMs,
    mode: 'home',
    timezone: { hourShift: 1, minuteShift: 0, hemisphere: 0 },
    dst: {
      start: { season: 0, month: 3, day: 29, hour: 2 },
      stop: { season: 1, month: 10, day: 25, hour: 3 },
    },
    bitPeriodMs: 30,
    compensateDuration: false,
  });
  assert.equal(uncomp.targetUtcMs, Date.UTC(2026, 10, 25, 11, 30, 12, 0));
  assert.equal(uncomp.startDelayMs, 0);
});

test('Bit schedule rising-edge offset shifts 0->1 transitions early without cumulative drift', () => {
  const bits = [1, 1, 0, 1, 0, 0];
  const { schedule, endTimeMs } = buildBitSchedule(bits, 30, 8);
  // index 0: bits[0]==1 => t = 30 - 8 = 22 (compensated=true)
  // index 1: t = 22 + 30 + 8 = 60
  // index 2: t = 60 + 30 = 90 (bit=0, next=1 => next t -= 8)
  // index 3: t = 90 + 30 - 8 = 112 (compensated=true)
  // index 4: t = 112 + 30 + 8 = 150
  // index 5: t = 150 + 30 = 180, endTimeMs = 210
  assert.deepEqual(
    schedule.map((s) => s.timeMs),
    [22, 60, 90, 112, 150, 180],
  );
  assert.equal(endTimeMs, 210);

  // Edge case: [1, 0, 1] starts with 1 followed by 0 and ends on 1
  const alt = buildBitSchedule([1, 0, 1], 30, 8);
  const altDurs = alt.schedule.map((s, idx) =>
    (idx < alt.schedule.length - 1 ? alt.schedule[idx + 1].timeMs : alt.endTimeMs) - s.timeMs,
  );
  assert.deepEqual(altDurs, [38, 22, 38]);

  // Edge case: [0, 1, 0] starts with 0 followed by rising edge at index 1
  const leadZero = buildBitSchedule([0, 1, 0], 30, 8);
  const leadZeroDurs = leadZero.schedule.map((s, idx) =>
    (idx < leadZero.schedule.length - 1 ? leadZero.schedule[idx + 1].timeMs : leadZero.endTimeMs) - s.timeMs,
  );
  assert.deepEqual(leadZeroDurs, [22, 38, 30]);

  // Extreme offset clamping: offset=30 at P=30 clamps to 15 (no zero-length bits)
  const extreme30 = buildBitSchedule([0, 1, 0, 1, 0], 30, 30);
  const extreme30Durs = extreme30.schedule.map((s, idx) =>
    (idx < extreme30.schedule.length - 1 ? extreme30.schedule[idx + 1].timeMs : extreme30.endTimeMs) - s.timeMs,
  );
  assert.deepEqual(extreme30Durs, [15, 45, 15, 45, 30]);

  // Extreme offset clamping: offset=30 at P=10 clamps to 5 (timestamps strictly monotonic)
  const extreme10 = buildBitSchedule([0, 1, 0, 1, 0], 10, 30);
  for (let i = 1; i < extreme10.schedule.length; i++) {
    assert.ok(
      extreme10.schedule[i].timeMs > extreme10.schedule[i - 1].timeMs,
      'Schedule timestamps must be strictly increasing',
    );
  }
});

test('Full WOP encoder matches reference bit vectors across T1/T2, DST, half/quarter-hour, and extreme offsets', () => {
  const vectors = [
    {
      name: 'UTC+0 London no DST', mode: 'home', tz: { hourShift: 0, minuteShift: 0, hemisphere: 0 },
      utc: { hour: 12, minute: 0, second: 0 }, date: { year: 26, month: 3, day: 8 }, dst: null,
      raw: '111010100001001110010000000001100000000000000001101000110100000100000',
      tx: '11101010000100111001000001000011000001000001000001011010001101000001100000100',
    },
    {
      name: 'UTC+1 Berlin standard T2', mode: 'travel', tz: { hourShift: 1, minuteShift: 0, hemisphere: 0 },
      utc: { hour: 9, minute: 57, second: 25 }, date: { year: 26, month: 1, day: 15 }, dst: null,
      raw: '111010100001001110100000100001001111001011001001101000010111100010000',
      tx: '111010100001001110100000110000100111100101100100110100001011110001000000',
    },
    {
      name: 'UTC+2 Berlin DST T1', mode: 'home', tz: { hourShift: 2, minuteShift: 0, hemisphere: 0 },
      utc: { hour: 14, minute: 30, second: 45 }, date: { year: 26, month: 7, day: 20 },
      dst: { start: { season: 0, month: 3, day: 29, hour: 2 }, stop: { season: 1, month: 10, day: 25, hour: 3 } },
      raw: '11101010001000111001000100000111001111010110100110100111101000011101100011111010001011010110010001101001100',
      tx: '111010100010001110010001000001111001111010110100110100111101000011101100011111001000101101011001000110100110000',
    },
    {
      name: 'UTC-8 LA no DST', mode: 'home', tz: { hourShift: -8, minuteShift: 0, hemisphere: 0 },
      utc: { hour: 3, minute: 15, second: 30 }, date: { year: 26, month: 12, day: 25 }, dst: null,
      raw: '111010100001001110011100000000011001111011110001101011001100101101000',
      tx: '111010100001001110011100000100001100111101111000110101100110010110100000',
    },
    {
      name: 'UTC+5:30 India no DST', mode: 'home', tz: { hourShift: 5, minuteShift: 1, hemisphere: 0 },
      utc: { hour: 8, minute: 0, second: 0 }, date: { year: 26, month: 3, day: 8 }, dst: null,
      raw: '111010100001001110010010101001000000000000000001101000110100011001110',
      tx: '11101010000100111001001010100100000100000100000100110100011010001100111000',
    },
    {
      name: 'UTC+5:45 Nepal no DST', mode: 'home', tz: { hourShift: 5, minuteShift: 2, hemisphere: 0 },
      utc: { hour: 8, minute: 0, second: 0 }, date: { year: 26, month: 3, day: 8 }, dst: null,
      raw: '111010100001001110010010110001000000000000000001101000110100001011000',
      tx: '11101010000100111001001011000100000100000100000100110100011010000101100000',
    },
    {
      name: 'UTC+11 Sydney DST T1', mode: 'home', tz: { hourShift: 11, minuteShift: 0, hemisphere: 1 },
      utc: { hour: 0, minute: 0, second: 0 }, date: { year: 26, month: 1, day: 1 },
      dst: { start: { season: 0, month: 10, day: 4, hour: 2 }, stop: { season: 1, month: 4, day: 5, hour: 3 } },
      raw: '11101010001000111001010110010000000000000000000110100001000010011101101010001000001010100001010001111011010',
      tx: '11101010001000111001010110010000010000010000010000110100001000010011101101010001000001101010000101000111101101000',
    },
    {
      name: 'UTC-12 extreme negative', mode: 'home', tz: { hourShift: -12, minuteShift: 0, hemisphere: 0 },
      utc: { hour: 0, minute: 0, second: 0 }, date: { year: 26, month: 6, day: 1 }, dst: null,
      raw: '111010100001001110011010000000000000000000000001101001100000100111101',
      tx: '1110101000010011100110100000100000100000100000100001101001100000110011110100',
    },
    {
      name: 'UTC+15 extreme positive', mode: 'home', tz: { hourShift: 15, minuteShift: 0, hemisphere: 0 },
      utc: { hour: 12, minute: 30, second: 30 }, date: { year: 26, month: 6, day: 1 }, dst: null,
      raw: '111010100001001110010111100001100011110011110001101001100000110011000',
      tx: '111010100001001110010111100001100011110011110001101001100000111001100000',
    },
  ];

  for (const v of vectors) {
    const res = buildWopFrame({
      mode: v.mode,
      timezone: v.tz,
      utcTime: v.utc,
      date: v.date,
      dst: v.dst,
    });
    assert.equal(bitsToString(res.rawBits), v.raw, `${v.name}: rawBits mismatch`);
    assert.equal(bitsToString(res.txBits), v.tx, `${v.name}: txBits mismatch`);
  }
});

test('Intl timezone analyzer matches known 2026 DST rules for EU, US, Australia, Japan, India', () => {
  const warsaw = analyzeTimezone('Europe/Warsaw', 2026);
  assert.equal(warsaw.hourShift, 1);
  assert.equal(warsaw.minuteShift, 0);
  assert.equal(warsaw.hemisphere, WOP.HEMISPHERE.NORTH);
  assert.equal(warsaw.hasDst, true);
  assert.deepEqual(warsaw.dst.start, { season: 0, month: 3, day: 29, hour: 2 });
  assert.deepEqual(warsaw.dst.stop, { season: 1, month: 10, day: 25, hour: 3 });

  const london = analyzeTimezone('Europe/London', 2026);
  assert.equal(london.hourShift, 0);
  assert.equal(london.hasDst, true);
  assert.deepEqual(london.dst.start, { season: 0, month: 3, day: 29, hour: 1 });
  assert.deepEqual(london.dst.stop, { season: 1, month: 10, day: 25, hour: 2 });

  const ny = analyzeTimezone('America/New_York', 2026);
  assert.equal(ny.hourShift, -5);
  assert.equal(ny.minuteShift, 0);
  assert.equal(ny.hemisphere, WOP.HEMISPHERE.NORTH);
  assert.equal(ny.hasDst, true);
  assert.deepEqual(ny.dst.start, { season: 0, month: 3, day: 8, hour: 2 });
  assert.deepEqual(ny.dst.stop, { season: 1, month: 11, day: 1, hour: 2 });

  const sydney = analyzeTimezone('Australia/Sydney', 2026);
  assert.equal(sydney.hourShift, 10);
  assert.equal(sydney.hemisphere, WOP.HEMISPHERE.SOUTH);
  assert.equal(sydney.hasDst, true);
  assert.deepEqual(sydney.dst.start, { season: 0, month: 10, day: 4, hour: 2 });
  assert.deepEqual(sydney.dst.stop, { season: 1, month: 4, day: 5, hour: 3 });

  const tokyo = analyzeTimezone('Asia/Tokyo', 2026);
  assert.equal(tokyo.hourShift, 9);
  assert.equal(tokyo.minuteShift, 0);
  assert.equal(tokyo.hemisphere, WOP.HEMISPHERE.NORTH);
  assert.equal(tokyo.hasDst, false);
  assert.equal(tokyo.dst, null);

  const kolkata = analyzeTimezone('Asia/Kolkata', 2026);
  assert.equal(kolkata.hourShift, 5);
  assert.equal(kolkata.minuteShift, WOP.MINUTE_SHIFT.THIRTY);
  assert.equal(kolkata.hemisphere, WOP.HEMISPHERE.NORTH);
  assert.equal(kolkata.hasDst, false);

  const utc = analyzeTimezone('UTC', 2026);
  assert.equal(utc.hourShift, 0);
  assert.equal(utc.hemisphere, WOP.HEMISPHERE.NORTH);
  assert.equal(utc.hasDst, false);

  const perth = analyzeTimezone('Australia/Perth', 2026);
  assert.equal(perth.hourShift, 8);
  assert.equal(perth.hemisphere, WOP.HEMISPHERE.SOUTH);
  assert.equal(perth.hasDst, false);

  const joburg = analyzeTimezone('Africa/Johannesburg', 2026);
  assert.equal(joburg.hourShift, 2);
  assert.equal(joburg.hemisphere, WOP.HEMISPHERE.SOUTH);
  assert.equal(joburg.hasDst, false);

  const saoPaulo = analyzeTimezone('America/Sao_Paulo', 2026);
  assert.equal(saoPaulo.hourShift, -3);
  assert.equal(saoPaulo.hemisphere, WOP.HEMISPHERE.SOUTH);
  assert.equal(saoPaulo.hasDst, false);

  const stJohns = analyzeTimezone('America/St_Johns', 2026);
  assert.equal(stJohns.hourShift, -3);
  assert.equal(stJohns.minuteShift, WOP.MINUTE_SHIFT.THIRTY);
  assert.equal(stJohns.hemisphere, WOP.HEMISPHERE.NORTH);
  assert.equal(stJohns.hasDst, true);
});

test('recommendBitPeriodFromLatency handles fast, slow, and upper-capped LED latencies', () => {
  // Fast Android LED within 30 ms budget
  assert.deepEqual(recommendBitPeriodFromLatency(6, 10), {
    recommendedBitPeriodMs: 30,
    needsAdjustment: false,
  });
  // Exact fast boundary
  assert.deepEqual(recommendBitPeriodFromLatency(16, 22), {
    recommendedBitPeriodMs: 30,
    needsAdjustment: false,
  });

  // Moderate/slow LED -> ceil((max(24 * 1.6, 32) + 12) / 5) * 5 = ceil(50.4 / 5) * 5 = 55
  const slow = recommendBitPeriodFromLatency(24, 32);
  assert.equal(slow.recommendedBitPeriodMs, 55);
  assert.equal(slow.needsAdjustment, true);

  // Latency spike exceeding max threshold alone -> ceil((max(12 * 1.6, 25) + 12) / 5) * 5 = 40
  assert.deepEqual(recommendBitPeriodFromLatency(12, 25), {
    recommendedBitPeriodMs: 40,
    needsAdjustment: true,
  });

  // Very slow LED capped at 80 ms
  assert.deepEqual(recommendBitPeriodFromLatency(50, 85), {
    recommendedBitPeriodMs: 80,
    needsAdjustment: true,
  });
});

test('computeClockOffsetMs compensates for symmetric half-RTT and positive/negative drift', () => {
  // Zero RTT, identical clocks
  assert.deepEqual(
    computeClockOffsetMs({ t0Ms: 1_000_000, t1Ms: 1_000_000, serverUtcMs: 1_000_000 }),
    { offsetMs: 0, rttMs: 0 },
  );

  // Symmetric 120 ms RTT, server midpoint aligns with local clock -> 0 offset
  assert.deepEqual(
    computeClockOffsetMs({ t0Ms: 1_000_000, t1Ms: 1_000_120, serverUtcMs: 1_000_060 }),
    { offsetMs: 0, rttMs: 120 },
  );

  // Device clock running slow by 350 ms (positive offset needed) with 80 ms RTT
  assert.deepEqual(
    computeClockOffsetMs({ t0Ms: 1_000_000, t1Ms: 1_000_080, serverUtcMs: 1_000_390 }),
    { offsetMs: 350, rttMs: 80 },
  );

  // Device clock running fast by 420 ms (negative offset needed) with 100 ms RTT
  assert.deepEqual(
    computeClockOffsetMs({ t0Ms: 1_000_000, t1Ms: 1_000_100, serverUtcMs: 999_630 }),
    { offsetMs: -420, rttMs: 100 },
  );
});

test('classifyCameraError categorizes permission, missing hardware, busy camera, HTTPS, and unknown errors', () => {
  assert.equal(classifyCameraError({ name: 'NotAllowedError', message: 'Permission denied' }), 'permission_denied');
  assert.equal(classifyCameraError({ name: 'PermissionDeniedError' }), 'permission_denied');
  assert.equal(classifyCameraError({ name: 'SecurityError', message: 'Blocked by policy' }), 'permission_denied');

  assert.equal(classifyCameraError({ name: 'NotFoundError' }), 'no_camera');
  assert.equal(classifyCameraError({ name: 'DevicesNotFoundError' }), 'no_camera');
  assert.equal(classifyCameraError({ name: 'OverconstrainedError' }), 'no_camera');

  assert.equal(classifyCameraError({ name: 'NotReadableError' }), 'camera_busy');
  assert.equal(classifyCameraError({ name: 'TrackStartError' }), 'camera_busy');
  assert.equal(classifyCameraError({ name: 'AbortError' }), 'camera_busy');

  assert.equal(classifyCameraError({ code: 'INSECURE_CONTEXT', message: 'Insecure context' }), 'insecure_context');
  assert.equal(
    classifyCameraError(new Error('HTTPS is required for camera/flashlight access.')),
    'insecure_context',
  );

  assert.equal(classifyCameraError(new Error('Unexpected driver failure')), 'unknown');
  assert.equal(classifyCameraError(null), 'unknown');
  assert.equal(classifyCameraError(undefined), 'unknown');
});

test('detectTorchCapability rejects desktop/Safari tracks that silently ignore advanced torch constraints', async () => {
  // Desktop Chrome / Safari track: getCapabilities() has no torch:true, applyConstraints resolves silently
  const desktopTrack = {
    readyState: 'live',
    getCapabilities: () => ({ facingMode: ['user'] }),
    applyConstraints: async () => {},
  };
  assert.equal(
    await detectTorchCapability(desktopTrack, { pollAttempts: 1, pollDelayMs: 1 }),
    false,
  );

  // Android rear camera track: getCapabilities().torch === true
  const androidTrack = {
    readyState: 'live',
    getCapabilities: () => ({ torch: true }),
    applyConstraints: async () => {},
  };
  assert.equal(
    await detectTorchCapability(androidTrack, { pollAttempts: 1, pollDelayMs: 1 }),
    true,
  );

  // Delayed Android Camera2 capability appearance on second poll
  let calls = 0;
  const delayedTrack = {
    readyState: 'live',
    getCapabilities: () => (++calls >= 2 ? { torch: true } : {}),
  };
  assert.equal(
    await detectTorchCapability(delayedTrack, { pollAttempts: 3, pollDelayMs: 1 }),
    true,
  );

  // Fallback without getCapabilities: only true when getSettings().torch confirms true
  const noCapsFalse = {
    readyState: 'live',
    applyConstraints: async () => {},
    getSettings: () => ({}),
  };
  assert.equal(await detectTorchCapability(noCapsFalse), false);

  let torchVal = false;
  const noCapsTrue = {
    readyState: 'live',
    applyConstraints: async (c) => {
      torchVal = Boolean(c?.advanced?.[0]?.torch);
    },
    getSettings: () => ({ torch: torchVal }),
  };
  assert.equal(await detectTorchCapability(noCapsTrue), true);
  assert.equal(torchVal, false, 'Probe must turn torch back off after confirming');
});

test('analyzeTimezone omits non-1-hour DST rules (Lord Howe 30m, Troll 2h)', () => {
  const lordHowe = analyzeTimezone('Australia/Lord_Howe', 2026);
  assert.equal(lordHowe.hasDst, false);
  assert.equal(lordHowe.nonStandardDst, true);
  assert.equal(lordHowe.dst, null);
  assert.equal(lordHowe.hemisphere, WOP.HEMISPHERE.SOUTH);
});

function pngCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

test('hdr-white.png is a valid 1x1 16-bit BT.2020 PQ (cICP 9/16/0/1) peak white PNG with correct CRCs', () => {
  const png = readFileSync(new URL('../assets/hdr-white.png', import.meta.url));
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const chunks = new Map();
  const order = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    const storedCrc = png.readUInt32BE(offset + 8 + length);
    assert.equal(storedCrc, pngCrc32(png.subarray(offset + 4, offset + 8 + length)), `${type} CRC-32`);
    chunks.set(type, data);
    order.push(type);
    offset += 12 + length;
  }
  assert.equal(offset, png.length, 'No trailing bytes after IEND');
  assert.equal(order[0], 'IHDR');
  assert.equal(order.at(-1), 'IEND');
  assert.ok(order.indexOf('cICP') < order.indexOf('IDAT'), 'cICP must precede IDAT');

  const ihdr = chunks.get('IHDR');
  assert.equal(ihdr.readUInt32BE(0), 1, 'width');
  assert.equal(ihdr.readUInt32BE(4), 1, 'height');
  assert.equal(ihdr[8], 16, 'bit depth');
  assert.equal(ihdr[9], 2, 'color type RGB');
  assert.deepEqual([...ihdr.subarray(10, 13)], [0, 0, 0]);

  assert.deepEqual([...chunks.get('cICP')], [9, 16, 0, 1]);

  const clli = chunks.get('cLLI');
  assert.equal(clli.length, 8);
  assert.equal(clli.readUInt32BE(0), 10000 * 10000, 'MaxCLL 10,000 nits');
  assert.equal(clli.readUInt32BE(4), 10000 * 10000, 'MaxFALL 10,000 nits');

  const raw = inflateSync(chunks.get('IDAT'));
  assert.equal(raw.length, 7);
  assert.equal(raw[0], 0, 'filter type None');
  assert.deepEqual([raw.readUInt16BE(1), raw.readUInt16BE(3), raw.readUInt16BE(5)], [65535, 65535, 65535]);
  assert.equal(chunks.get('IEND').length, 0);
});

test('detectHdrDisplaySupport reports HDR only when matchMedia("(dynamic-range: high)") matches', () => {
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(detectHdrDisplaySupport(), false);

  const queries = [];
  const mockWindow = (hdr) => ({
    matchMedia: (q) => {
      queries.push(q);
      return { matches: hdr && q === '(dynamic-range: high)' };
    },
  });
  try {
    globalThis.window = mockWindow(false);
    assert.equal(detectHdrDisplaySupport(), false);
    globalThis.window = mockWindow(true);
    assert.equal(detectHdrDisplaySupport(), true);
    assert.deepEqual(queries, ['(dynamic-range: high)', '(dynamic-range: high)']);
    globalThis.window = {
      matchMedia: () => {
        throw new Error('unsupported');
      },
    };
    assert.equal(detectHdrDisplaySupport(), false);
  } finally {
    delete globalThis.window;
  }
});

test('snapRefreshRateHz snaps to standard display rates within ±4.5% and rejects invalid input', () => {
  assert.equal(snapRefreshRateHz(60.1), 60);
  assert.equal(snapRefreshRateHz(59.94), 60);
  assert.equal(snapRefreshRateHz(119.8), 120);
  assert.equal(snapRefreshRateHz(143.9), 144);
  assert.equal(snapRefreshRateHz(75.2), 75);
  assert.equal(snapRefreshRateHz(165), 165);
  // Off-grid rates round to the nearest integer, clamped to [24, 360]
  assert.equal(snapRefreshRateHz(280.4), 280);
  assert.equal(snapRefreshRateHz(500), 360);
  assert.equal(snapRefreshRateHz(10), 24);
  for (const invalid of [0, -60, NaN, Infinity, null, undefined, '60']) {
    assert.equal(snapRefreshRateHz(invalid), null, `invalid ${String(invalid)}`);
  }
});

test('recommendScreenBitPeriodFromHz picks frame-locked integer periods with minimal quantization error', () => {
  assert.deepEqual(recommendScreenBitPeriodFromHz(60), { bitPeriodMs: 50, framesPerBit: 3, exactMs: 50, errorMs: 0 });
  assert.deepEqual(recommendScreenBitPeriodFromHz(75), { bitPeriodMs: 40, framesPerBit: 3, exactMs: 40, errorMs: 0 });
  assert.deepEqual(recommendScreenBitPeriodFromHz(100), { bitPeriodMs: 30, framesPerBit: 3, exactMs: 30, errorMs: 0 });
  assert.deepEqual(recommendScreenBitPeriodFromHz(120), { bitPeriodMs: 50, framesPerBit: 6, exactMs: 50, errorMs: 0 });
  assert.deepEqual(recommendScreenBitPeriodFromHz(240), { bitPeriodMs: 50, framesPerBit: 12, exactMs: 50, errorMs: 0 });

  for (const hz of [90, 144, 165, 240]) {
    const rec = recommendScreenBitPeriodFromHz(hz);
    assert.ok(Number.isInteger(rec.bitPeriodMs), `${hz} Hz integer period`);
    assert.ok(rec.bitPeriodMs >= 30 && rec.bitPeriodMs <= 60, `${hz} Hz period ${rec.bitPeriodMs} in [30..60]`);
    assert.ok(rec.framesPerBit >= 2);
    assert.ok(Math.abs(rec.exactMs - (rec.framesPerBit * 1000) / hz) < 0.001);
    assert.ok(rec.errorMs < 0.5);
  }
  assert.deepEqual(recommendScreenBitPeriodFromHz(90), { bitPeriodMs: 33, framesPerBit: 3, exactMs: 33.333, errorMs: 0.333 });
  assert.deepEqual(recommendScreenBitPeriodFromHz(144), { bitPeriodMs: 35, framesPerBit: 5, exactMs: 34.722, errorMs: 0.278 });
  assert.deepEqual(recommendScreenBitPeriodFromHz(165), { bitPeriodMs: 30, framesPerBit: 5, exactMs: 30.303, errorMs: 0.303 });

  // Throttled 30 Hz rendering cannot fit 2 frames in 60 ms -> shortest 2-frame period
  assert.deepEqual(recommendScreenBitPeriodFromHz(30), { bitPeriodMs: 67, framesPerBit: 2, exactMs: 66.667, errorMs: 0.333 });

  const fallback = { bitPeriodMs: 50, framesPerBit: null, exactMs: 50, errorMs: null };
  for (const invalid of [null, undefined, 0, -60, NaN, Infinity]) {
    assert.deepEqual(recommendScreenBitPeriodFromHz(invalid), fallback);
  }
});

async function withMockAnimationFrames(timestamps, fn) {
  let next = 0;
  let id = 0;
  globalThis.requestAnimationFrame = (cb) => {
    id += 1;
    const ts = timestamps[next++];
    if (ts !== undefined) {
      setImmediate(() => cb(ts));
    }
    return id;
  };
  globalThis.cancelAnimationFrame = () => {};
  try {
    return await fn();
  } finally {
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  }
}

function frameTimeline(hz, count, { start = 1000, jitterMs = 0 } = {}) {
  const frameMs = 1000 / hz;
  return Array.from({ length: count }, (_, k) => start + k * frameMs + (k % 2 ? jitterMs : -jitterMs));
}

test('measureDisplayRefreshRate measures 60 Hz and 120 Hz rAF timelines', async () => {
  const at60 = await withMockAnimationFrames(frameTimeline(60, 40, { jitterMs: 0.2 }), () =>
    measureDisplayRefreshRate(),
  );
  assert.equal(at60.hz, 60);
  assert.ok(Math.abs(at60.frameMs - 16.667) < 0.5, `frameMs ${at60.frameMs}`);
  assert.ok(Math.abs(at60.rawHz - 60) < 2, `rawHz ${at60.rawHz}`);

  const at120 = await withMockAnimationFrames(frameTimeline(120, 40, { jitterMs: 0.15 }), () =>
    measureDisplayRefreshRate({ sampleFrames: 30 }),
  );
  assert.equal(at120.hz, 120);
  assert.ok(Math.abs(at120.frameMs - 8.333) < 0.3, `frameMs ${at120.frameMs}`);
});

test('measureDisplayRefreshRate discards warm-up frame and rejects stall / duplicate outliers', async () => {
  // Without discarding the warm-up frame the first delta (40 ms) would dominate the median
  const warm = await withMockAnimationFrames([0, 40, 80, 96.667, 113.333, 130], () =>
    measureDisplayRefreshRate({ sampleFrames: 3 }),
  );
  assert.equal(warm.hz, 60);

  const f = 1000 / 60;
  const timeline = [0, 500];
  let t = 500;
  for (let k = 0; k < 30; k++) {
    if (k === 5) t += 250; // >100 ms tab/GC stall
    else if (k === 9) t += 0.4; // <1 ms duplicate callback
    else if (k === 14 || k === 20) t += 2 * f; // occasional dropped frame
    else t += f;
    timeline.push(t);
  }
  const res = await withMockAnimationFrames(timeline, () => measureDisplayRefreshRate({ sampleFrames: 24 }));
  assert.equal(res.hz, 60);
  assert.ok(Math.abs(res.frameMs - f) < 0.01, `frameMs ${res.frameMs}`);
});

test('measureDisplayRefreshRate resolves null without rAF, while hidden, or on timeout', async () => {
  assert.equal(typeof globalThis.requestAnimationFrame, 'undefined');
  assert.equal(await measureDisplayRefreshRate(), null);

  assert.equal(
    await withMockAnimationFrames([], () => measureDisplayRefreshRate({ timeoutMs: 20 })),
    null,
  );

  globalThis.document = { hidden: true };
  try {
    let rafCalls = 0;
    const res = await withMockAnimationFrames(frameTimeline(60, 40), () => {
      const orig = globalThis.requestAnimationFrame;
      globalThis.requestAnimationFrame = (cb) => {
        rafCalls++;
        return orig(cb);
      };
      return measureDisplayRefreshRate();
    });
    assert.equal(res, null);
    assert.equal(rafCalls, 0);
  } finally {
    delete globalThis.document;
  }
});

test('detectCameraPresence counts video inputs passively and returns null without enumerateDevices', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const setNavigator = (value) =>
    Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
  try {
    setNavigator({
      mediaDevices: {
        enumerateDevices: async () => [
          { kind: 'audioinput' },
          { kind: 'videoinput' },
          { kind: 'videoinput' },
        ],
      },
    });
    assert.deepEqual(await detectCameraPresence(), { hasVideoInput: true, videoInputCount: 2 });

    setNavigator({ mediaDevices: { enumerateDevices: async () => [{ kind: 'audiooutput' }] } });
    assert.deepEqual(await detectCameraPresence(), { hasVideoInput: false, videoInputCount: 0 });

    setNavigator({
      mediaDevices: {
        enumerateDevices: async () => {
          throw new Error('blocked');
        },
      },
    });
    assert.equal(await detectCameraPresence(), null);

    setNavigator({});
    assert.equal(await detectCameraPresence(), null);
  } finally {
    if (original) {
      Object.defineProperty(globalThis, 'navigator', original);
    } else {
      delete globalThis.navigator;
    }
  }
});

test('EN and PL translations define identical keys and placeholders; frame plurals follow CLDR', () => {
  const enKeys = Object.keys(TRANSLATIONS.en).sort();
  const plKeys = Object.keys(TRANSLATIONS.pl).sort();
  assert.deepEqual(plKeys, enKeys);

  const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const key of enKeys) {
    assert.deepEqual(placeholders(TRANSLATIONS.pl[key]), placeholders(TRANSLATIONS.en[key]), key);
  }

  const en = createTranslator('en');
  const pl = createTranslator('pl');
  assert.equal(en.plural('framesUnit', 1), 'frame');
  assert.equal(en.plural('framesUnit', 6), 'frames');
  assert.equal(pl.plural('framesUnit', 1), 'klatka');
  assert.equal(pl.plural('framesUnit', 3), 'klatki');
  assert.equal(pl.plural('framesUnit', 6), 'klatek');
  assert.equal(pl.plural('framesUnit', 12), 'klatek');
  assert.equal(pl.plural('framesUnit', 22), 'klatki');
});
