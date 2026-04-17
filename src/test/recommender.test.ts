import { describe, it, expect } from 'vitest';
import {
  computeHoursSinceLastMeal,
  computeCoolingRate1to4F,
  logToInputs,
  nightDistance,
  type RecommenderInputs,
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

/**
 * Tests for the distance-function workstream
 * (`specs/recommender-v2/distance-function.md` T6). Cover the 8 cases
 * enumerated in the spec's "Minimum coverage" list.
 */

/** A realistic, fully-populated inputs object for identity / baseline tests. */
function realisticInputs(): RecommenderInputs {
  return {
    overnightLowF: 50,
    startingRoomTempF: 68,
    roomHumidity: 45,
    hoursSinceLastMeal: 3,
    coolingRate1to4F: -0.3,
    alcohol: false,
    plannedAcCurve: 'cool_early',
    plannedAcSetpointF: 64,
  };
}

describe('nightDistance (distance-function T6)', () => {
  it('identity: nightDistance(a, a) === 0 for a realistic a', () => {
    const a = realisticInputs();
    expect(nightDistance(a, a)).toBe(0);
  });

  it('AC-off symmetry: both-off produces the same distance as both-null (T3)', () => {
    // Two inputs identical except both have plannedAcCurve === 'off' and
    // plannedAcSetpointF === null. This should yield the same distance as
    // the same pair with plannedAcCurve === null — because T3 makes the
    // AC-curve block contribute zero weight + zero distance in both cases.
    const base = realisticInputs();
    const offA: RecommenderInputs = { ...base, plannedAcCurve: 'off', plannedAcSetpointF: null };
    const offB: RecommenderInputs = { ...base, plannedAcCurve: 'off', plannedAcSetpointF: null };
    const nullA: RecommenderInputs = { ...base, plannedAcCurve: null, plannedAcSetpointF: null };
    const nullB: RecommenderInputs = { ...base, plannedAcCurve: null, plannedAcSetpointF: null };

    // Perturb one dimension so the distance isn't zero (otherwise both
    // sides trivially equal 0 and the test doesn't discriminate).
    offA.startingRoomTempF = 68;
    offB.startingRoomTempF = 70;
    nullA.startingRoomTempF = 68;
    nullB.startingRoomTempF = 70;

    const dOff = nightDistance(offA, offB);
    const dNull = nightDistance(nullA, nullB);
    expect(dOff).toBe(dNull);

    // And one side 'off' + the other 'cool_early' also contributes
    // nothing (Q6 inert-baseline).
    const mixedA: RecommenderInputs = { ...base, plannedAcCurve: 'off', plannedAcSetpointF: null };
    const mixedB: RecommenderInputs = { ...base, plannedAcCurve: 'cool_early', plannedAcSetpointF: 64 };
    mixedA.startingRoomTempF = 68;
    mixedB.startingRoomTempF = 70;
    // plannedAcSetpointF differs here too (null vs 64) which costs a
    // half-penalty on that dimension — strip it to isolate the AC curve.
    mixedA.plannedAcSetpointF = null;
    mixedB.plannedAcSetpointF = null;
    expect(nightDistance(mixedA, mixedB)).toBe(dOff);
  });

  it('both sides cool_early: AC block contributes 0 (identity on AC)', () => {
    const a = realisticInputs();
    const b: RecommenderInputs = { ...a };
    // Everything equal → distance 0. But confirm by also changing nothing
    // else and ensuring identity.
    expect(nightDistance(a, b)).toBe(0);
  });

  it('cool_early vs hold_cold: AC curve difference adds 1.5 to raw d', () => {
    // Compare cool_early vs hold_cold (both non-off, non-null): the AC
    // block adds 1.5 to d and 1.5 to totalWeight.
    const a: RecommenderInputs = { ...realisticInputs(), plannedAcCurve: 'cool_early' };
    const b: RecommenderInputs = { ...realisticInputs(), plannedAcCurve: 'hold_cold' };
    const d = nightDistance(a, b);

    // totalWeight with AC block = 3 + 4 + 1 + 1 + 1 + 1 + 0.5 + 1.5 = 13.
    // Raw d = 1.5 (AC only; everything else equal).
    expect(d).toBeCloseTo(1.5 / 13, 6);
  });

  it('raised room-temp weight: 5°F startingRoomTempF diff / 5°F overnightLowF diff ≈ 4× (new 4/5 vs 3/15)', () => {
    // Old ratio was 3 (weight 3, scale 5 for startingRoomTempF; weight 3,
    // scale 15 for overnightLowF → (3*5/5) / (3*5/15) = 3/1 = 3). v2
    // raised the room-temp weight to 4 → new ratio (4*5/5) / (3*5/15) =
    // 4/1 = 4. Need every other dim to contribute zero to isolate the
    // ratio — so AC is 'off' on both sides, and every addDim dim is
    // non-null + equal across A/B (no half-penalty either).
    const base = realisticInputs();
    base.plannedAcCurve = 'off';
    // Keep plannedAcSetpointF non-null + equal on both so its half-penalty
    // doesn't leak into the comparison.
    base.plannedAcSetpointF = 64;

    const roomA: RecommenderInputs = { ...base, startingRoomTempF: 65 };
    const roomB: RecommenderInputs = { ...base, startingRoomTempF: 70 };
    const lowA: RecommenderInputs = { ...base, overnightLowF: 45 };
    const lowB: RecommenderInputs = { ...base, overnightLowF: 50 };

    const dRoom = nightDistance(roomA, roomB);
    const dLow = nightDistance(lowA, lowB);
    // Same totalWeight in both comparisons → the ratio is just the raw-d
    // ratio: (4*5/5) / (3*5/15) = 4 / 1 = 4.
    expect(dRoom / dLow).toBeCloseTo(4, 6);
  });

  it('humidity penalty: 10pp difference contributes ~1/totalWeight', () => {
    const base = realisticInputs();
    // Use non-'off' + identical AC so the AC block contributes zero but
    // still adds 1.5 to totalWeight (both sides cool_early, same).
    const a: RecommenderInputs = { ...base, roomHumidity: 40 };
    const b: RecommenderInputs = { ...base, roomHumidity: 50 };

    // totalWeight = 3+4+1+1+1+1+0.5+1.5 = 13. Raw d from humidity alone =
    // (1 * 10) / 10 = 1.
    const expected = 1 / 13;
    expect(nightDistance(a, b)).toBeCloseTo(expected, 6);
  });

  it('hours-since-meal penalty: 3-hour diff contributes 1/totalWeight', () => {
    const base = realisticInputs();
    const a: RecommenderInputs = { ...base, hoursSinceLastMeal: 2 };
    const b: RecommenderInputs = { ...base, hoursSinceLastMeal: 5 };

    // Raw d from hoursSinceLastMeal alone = (1 * 3) / 3 = 1.
    const expected = 1 / 13;
    expect(nightDistance(a, b)).toBeCloseTo(expected, 6);
  });

  it('cooling-rate penalty: 0.6 °F/h diff contributes 1/totalWeight', () => {
    const base = realisticInputs();
    const a: RecommenderInputs = { ...base, coolingRate1to4F: -0.6 };
    const b: RecommenderInputs = { ...base, coolingRate1to4F: 0 };

    // Raw d from coolingRate1to4F alone = (1 * 0.6) / 0.6 = 1.
    const expected = 1 / 13;
    expect(nightDistance(a, b)).toBeCloseTo(expected, 6);
  });

  it('missing dimension: null on one side of humidity contributes 0.5/totalWeight', () => {
    const base = realisticInputs();
    const a: RecommenderInputs = { ...base, roomHumidity: 45 };
    const b: RecommenderInputs = { ...base, roomHumidity: null };

    // addDim half-penalty: d += weight * 0.5 = 1 * 0.5 = 0.5.
    // totalWeight = 13 (still; the weight is added regardless of nulls).
    const expected = 0.5 / 13;
    expect(nightDistance(a, b)).toBeCloseTo(expected, 6);
  });

  it('dropped flags never contribute: toggling eveningIntake.flags does not change nightDistance', () => {
    // Build two nights where the *only* difference is
    // eveningIntake.flags (overate / late_meal / high_salt). Since
    // logToInputs no longer reads those flags, the nightDistance between
    // the two must be identical to the nightDistance when the flags are
    // equal. Guards against a future re-introduction of the zero-signal
    // dims.
    const a = makeLog('2026-04-15');
    const b = makeLog('2026-04-15');

    // Baseline: both logs have all flags off → distance D.
    const baselineA = logToInputs(a);
    const baselineB = logToInputs(b);
    const dBaseline = nightDistance(baselineA, baselineB);

    // Now flip overate/late_meal/high_salt on one side only. If the
    // recommender's distance function were still reading these flags,
    // distance would jump; it must stay the same.
    for (const type of ['overate', 'late_meal', 'high_salt'] as const) {
      const flag = a.eveningIntake.flags.find((f) => f.type === type);
      if (flag) flag.active = true;
    }
    const toggledA = logToInputs(a);
    const dToggled = nightDistance(toggledA, baselineB);
    expect(dToggled).toBe(dBaseline);

    // And flip them on both sides → same distance again (symmetry).
    for (const type of ['overate', 'late_meal', 'high_salt'] as const) {
      const flag = b.eveningIntake.flags.find((f) => f.type === type);
      if (flag) flag.active = true;
    }
    const toggledB = logToInputs(b);
    expect(nightDistance(toggledA, toggledB)).toBe(dBaseline);
  });
});
