import { describe, it, expect } from 'vitest';
import {
  computeHoursSinceLastMeal,
  computeCoolingRate1to4F,
  logToInputs,
} from '../services/recommender';
import { createBlankNightLog } from '../utils';
import type { NightLog, RoomReading } from '../types';

/**
 * Tests for the derived-features workstream
 * (`specs/recommender-v2/derived-features.md`). The pure helpers are the
 * focus per Q8 — unit-test each case the spec enumerates. `logToInputs` is
 * tested as an integration of the helpers.
 */

function makeLog(date: string): NightLog {
  return createBlankNightLog(date, {
    expectedAlarmTime: '06:00',
    actualAlarmTime: '06:00',
    isOverridden: false,
    targetBedtime: '22:30',
    eatingCutoff: '20:00',
    supplementTime: '21:45',
  });
}

/** Build an ISO timestamp from local-time components so tests stay TZ-agnostic. */
function ts(y: number, mo: number, d: number, h: number, m: number): string {
  return new Date(y, mo, d, h, m).toISOString();
}

function reading(
  y: number,
  mo: number,
  d: number,
  h: number,
  m: number,
  tempF: number,
  humidity = 50,
): RoomReading {
  return { timestamp: ts(y, mo, d, h, m), tempF, humidity };
}

describe('computeHoursSinceLastMeal (derived-features T1)', () => {
  it('returns 3.5 for lastMeal=18:00 and loggedBedtime=2026-04-15T21:30', () => {
    const log = makeLog('2026-04-15');
    log.eveningIntake.lastMealTime = '18:00';
    // 21:30 on 2026-04-15 local
    log.loggedBedtime = new Date(2026, 3, 15, 21, 30).getTime();
    expect(computeHoursSinceLastMeal(log)).toBe(3.5);
  });

  it('returns null when lastMealTime is blank', () => {
    const log = makeLog('2026-04-15');
    log.eveningIntake.lastMealTime = '';
    log.loggedBedtime = new Date(2026, 3, 15, 21, 30).getTime();
    expect(computeHoursSinceLastMeal(log)).toBeNull();
  });

  it('uses alarm.targetBedtime when loggedBedtime is null', () => {
    const log = makeLog('2026-04-15');
    log.eveningIntake.lastMealTime = '18:00';
    log.loggedBedtime = null;
    log.alarm.targetBedtime = '21:00';
    // 21:00 - 18:00 on the same date = 3 hours
    expect(computeHoursSinceLastMeal(log)).toBe(3);
  });

  it('falls back to sleepData.sleepTime when loggedBedtime and targetBedtime missing', () => {
    const log = makeLog('2026-04-15');
    log.eveningIntake.lastMealTime = '18:30';
    log.loggedBedtime = null;
    log.alarm.targetBedtime = '';
    log.sleepData = {
      sleepTime: '22:00',
      wakeTime: '06:00',
      totalSleepDuration: 480,
      actualSleepDuration: 460,
      sleepScore: 80,
      sleepScoreDelta: 0,
      deepSleep: 90,
      remSleep: 90,
      lightSleep: 280,
      awakeDuration: 20,
      avgHeartRate: 58,
      minHeartRate: 50,
      avgRespiratoryRate: 14,
      bloodOxygenAvg: 97,
      skinTempRange: '',
      sleepLatencyRating: 'Good',
      restfulnessRating: 'Good',
      deepSleepRating: 'Good',
      remSleepRating: 'Good',
      importedAt: Date.now(),
    };
    // 22:00 - 18:30 = 3.5 hours
    expect(computeHoursSinceLastMeal(log)).toBe(3.5);
  });

  it('returns null when lastMealTime crosses midnight and would invert (02:00 meal, 21:30 bedtime same date)', () => {
    const log = makeLog('2026-04-15');
    // 02:00 HH:MM means the meal is interpreted as the next morning per the
    // midnight rule, which makes the gap negative vs. a 21:30 bedtime on the
    // 15th. The [0, 12] sanity bound rejects it.
    log.eveningIntake.lastMealTime = '02:00';
    log.loggedBedtime = new Date(2026, 3, 15, 21, 30).getTime();
    expect(computeHoursSinceLastMeal(log)).toBeNull();
  });
});

describe('computeCoolingRate1to4F (derived-features T2)', () => {
  it('computes ~-1.29 °F/h from a 01:05@72 and 04:10@68 timeline', () => {
    const log = makeLog('2026-04-15');
    log.roomTimeline = [
      reading(2026, 3, 16, 1, 5, 72),
      reading(2026, 3, 16, 4, 10, 68),
    ];
    const rate = computeCoolingRate1to4F(log);
    expect(rate).not.toBeNull();
    // (68-72) / (3h 5m = 3.0833h) ≈ -1.297
    expect(rate!).toBeCloseTo(-4 / (185 / 60), 2);
    expect(rate!).toBeCloseTo(-1.2973, 3);
  });

  it('rejects a timeline where t1 would land before midnight (23:00 + 04:00 only)', () => {
    const log = makeLog('2026-04-15');
    // 23:00 is the nearest to 01:00 by 2h via modular distance — must be
    // rejected because it's outside the [00:30, 02:00] t1 window.
    log.roomTimeline = [
      reading(2026, 3, 15, 23, 0, 73),
      reading(2026, 3, 16, 4, 0, 69),
    ];
    expect(computeCoolingRate1to4F(log)).toBeNull();
  });

  it('returns null when roomTimeline is null', () => {
    const log = makeLog('2026-04-15');
    log.roomTimeline = null;
    expect(computeCoolingRate1to4F(log)).toBeNull();
  });

  it('returns null for a degenerate-nearest timeline with only one early-morning reading', () => {
    const log = makeLog('2026-04-15');
    log.roomTimeline = [reading(2026, 3, 16, 2, 30, 70)];
    expect(computeCoolingRate1to4F(log)).toBeNull();
  });

  it('returns null when t1 and t4 resolve to the same reading (single 02:00 reading)', () => {
    const log = makeLog('2026-04-15');
    // Only one reading in the early-morning window — findNearestRoomReading
    // would return it for both 01:00 and 04:00 targets. Guarded against.
    log.roomTimeline = [
      reading(2026, 3, 15, 22, 0, 73),
      reading(2026, 3, 16, 2, 30, 70),
    ];
    expect(computeCoolingRate1to4F(log)).toBeNull();
  });

  it('returns null when the wall-clock gap is under 2 hours', () => {
    const log = makeLog('2026-04-15');
    // t1 at 01:30 and t4 at 03:10 — both inside their windows but only
    // 1h40m apart.
    log.roomTimeline = [
      reading(2026, 3, 16, 1, 30, 71),
      reading(2026, 3, 16, 3, 10, 70),
    ];
    expect(computeCoolingRate1to4F(log)).toBeNull();
  });
});

describe('logToInputs (derived-features T3 + T4 integration)', () => {
  it('passes roomHumidity through unchanged (including non-zero)', () => {
    const log = makeLog('2026-04-15');
    log.environment.roomHumidity = 42;
    const inputs = logToInputs(log);
    expect(inputs.roomHumidity).toBe(42);
  });

  it('returns null (not 0) for roomHumidity when unset', () => {
    const log = makeLog('2026-04-15');
    log.environment.roomHumidity = null;
    const inputs = logToInputs(log);
    expect(inputs.roomHumidity).toBeNull();
  });

  it('includes hoursSinceLastMeal in the returned shape', () => {
    const log = makeLog('2026-04-15');
    log.eveningIntake.lastMealTime = '18:00';
    log.loggedBedtime = new Date(2026, 3, 15, 21, 30).getTime();
    const inputs = logToInputs(log);
    expect(inputs.hoursSinceLastMeal).toBe(3.5);
  });

  it('includes coolingRate1to4F in the returned shape', () => {
    const log = makeLog('2026-04-15');
    log.roomTimeline = [
      reading(2026, 3, 16, 1, 5, 72),
      reading(2026, 3, 16, 4, 10, 68),
    ];
    const inputs = logToInputs(log);
    expect(inputs.coolingRate1to4F).not.toBeNull();
    expect(inputs.coolingRate1to4F!).toBeCloseTo(-1.2973, 3);
  });

  it('omits the zero-signal food flags (distance-function T1 + T5): no ateLate/overate/highSalt keys', () => {
    const log = makeLog('2026-04-15');
    // Activate every flag to prove logToInputs doesn't surface them back.
    for (const flag of log.eveningIntake.flags) {
      flag.active = true;
    }
    const inputs = logToInputs(log);
    expect(inputs).not.toHaveProperty('ateLate');
    expect(inputs).not.toHaveProperty('overate');
    expect(inputs).not.toHaveProperty('highSalt');
  });

  it('keeps alcohol flag from eveningIntake.alcohol presence', () => {
    const log = makeLog('2026-04-15');
    log.eveningIntake.alcohol = { type: 'wine', amount: '1 glass', time: '20:00' };
    expect(logToInputs(log).alcohol).toBe(true);

    log.eveningIntake.alcohol = null;
    expect(logToInputs(log).alcohol).toBe(false);
  });

  it('returns the populated shape for a realistic fixture', () => {
    const log = makeLog('2026-04-15');
    log.eveningIntake.lastMealTime = '18:30';
    log.loggedBedtime = new Date(2026, 3, 15, 22, 0).getTime();
    log.environment.roomTempF = 68.5;
    log.environment.roomHumidity = 48;
    log.environment.acCurveProfile = 'off';
    log.environment.acSetpointF = null;
    log.roomTimeline = [
      reading(2026, 3, 16, 1, 0, 70),
      reading(2026, 3, 16, 4, 0, 67),
    ];

    const inputs = logToInputs(log);
    expect(inputs.startingRoomTempF).toBe(68.5);
    expect(inputs.roomHumidity).toBe(48);
    expect(inputs.hoursSinceLastMeal).toBe(3.5);
    expect(inputs.coolingRate1to4F).not.toBeNull();
    expect(inputs.coolingRate1to4F!).toBeCloseTo(-1, 2);
    expect(inputs.plannedAcCurve).toBe('off');
    expect(inputs.plannedAcSetpointF).toBeNull();
  });
});
