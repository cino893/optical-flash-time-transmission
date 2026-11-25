import test from 'node:test';
import assert from 'node:assert/strict';
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
import { recommendBitPeriodFromLatency } from '../js/flash-driver.js';
import { computeClockOffsetMs } from '../js/time-sync.js';

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
});

test('Bit schedule rising-edge offset shifts 0->1 transitions early without cumulative drift', () => {
  const bits = [1, 1, 0, 1, 0, 0];
  const { schedule } = buildBitSchedule(bits, 30, 8);
  // index 0: bits[1]==1 => t = 30 - 8 = 22 (compensated=true)
  // index 1: t = 22 + 30 + 8 = 60
  // index 2: t = 60 + 30 = 90 (bit=0, next=1 => next t -= 8)
  // index 3: t = 90 + 30 - 8 = 112 (compensated=true)
  // index 4: t = 112 + 30 + 8 = 150
  // index 5: t = 150 + 30 = 180
  assert.deepEqual(
    schedule.map((s) => s.timeMs),
    [22, 60, 90, 112, 150, 180],
  );
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
  assert.equal(tokyo.hasDst, false);
  assert.equal(tokyo.dst, null);

  const kolkata = analyzeTimezone('Asia/Kolkata', 2026);
  assert.equal(kolkata.hourShift, 5);
  assert.equal(kolkata.minuteShift, WOP.MINUTE_SHIFT.THIRTY);
  assert.equal(kolkata.hasDst, false);

  const stJohns = analyzeTimezone('America/St_Johns', 2026);
  assert.equal(stJohns.hourShift, -3);
  assert.equal(stJohns.minuteShift, WOP.MINUTE_SHIFT.THIRTY);
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
