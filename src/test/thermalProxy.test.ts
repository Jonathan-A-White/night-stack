import { describe, it, expect } from 'vitest';
import {
  AMBIGUITY_THRESHOLD,
  classifyThermalComfortFromWakes,
  resolveThermalCauseIds,
} from '../services/thermalProxy';
import type {
  NightLog,
  SleepData,
  WakeUpCause,
  WakeUpEvent,
} from '../types';

/**
 * Tests for the backfill proxy classifier (backfill.md T2 + T5). Each
 * branch of the rule is exercised here — the UI in ThermalBackfillReview
 * is a thin wrapper around these pure functions, so hitting every branch
 * at this layer is the coverage that matters.
 *
 * Cause IDs are deliberately short strings rather than UUIDs so test
 * failures are easy to read.
 */

const CAUSES: WakeUpCause[] = [
  { id: 'c-hot', label: 'Sweating / too hot', sortOrder: 1, isActive: true },
  { id: 'c-heart', label: 'Heart racing / palpitations', sortOrder: 2, isActive: true },
  { id: 'c-cold', label: 'Too cold', sortOrder: 3, isActive: true },
  { id: 'c-bath', label: 'Bathroom', sortOrder: 4, isActive: true },
  { id: 'c-noise', label: 'Noise', sortOrder: 5, isActive: true },
  { id: 'c-unknown', label: 'Unknown', sortOrder: 6, isActive: true },
];

function makeSleepData(overrides: Partial<SleepData> = {}): SleepData {
  return {
    sleepTime: '22:31',
    wakeTime: '06:43',
    totalSleepDuration: 420,
    actualSleepDuration: 400,
    sleepScore: 80,
    sleepScoreDelta: 0,
    deepSleep: 70,
    remSleep: 100,
    lightSleep: 200,
    awakeDuration: 20,
    avgHeartRate: 50,
    minHeartRate: 44,
    avgRespiratoryRate: 15,
    bloodOxygenAvg: 95,
    skinTempRange: '',
    sleepLatencyRating: 'Good',
    restfulnessRating: 'Good',
    deepSleepRating: 'Good',
    remSleepRating: 'Good',
    importedAt: 0,
    ...overrides,
  };
}

function makeWake(overrides: Partial<WakeUpEvent> = {}): WakeUpEvent {
  return {
    id: crypto.randomUUID(),
    startTime: '03:00',
    endTime: '03:10',
    cause: '',
    fellBackAsleep: 'yes',
    minutesToFallBackAsleep: 10,
    notes: '',
    wasSweating: false,
    feltCold: false,
    racingHeart: false,
    ...overrides,
  };
}

function makeLog(overrides: Partial<NightLog>): NightLog {
  return {
    id: 'log-1',
    date: '2026-04-10',
    createdAt: 0,
    updatedAt: 0,
    alarm: {
      expectedAlarmTime: '07:00',
      actualAlarmTime: '07:00',
      isOverridden: false,
      targetBedtime: '22:00',
      eatingCutoff: '19:00',
      supplementTime: '21:15',
    },
    loggedBedtime: null,
    stack: { baseStackUsed: true, deviations: [] },
    eveningIntake: {
      lastMealTime: '',
      foodDescription: '',
      flags: [],
      alcohol: null,
      liquidIntake: '',
    },
    environment: {
      roomTempF: null,
      roomHumidity: null,
      externalWeather: null,
      acCurveProfile: 'off',
      acSetpointF: null,
      fanSpeed: 'off',
    },
    clothing: [],
    bedding: [],
    sleepData: makeSleepData(),
    roomTimeline: null,
    wakeUpEvents: [],
    bedtimeExplanation: null,
    middayStruggle: {
      hadStruggle: false,
      copingItemIds: [],
      struggleTime: '',
      intensity: null,
      notes: '',
    },
    eveningNotes: '',
    morningNotes: '',
    thermalComfort: null,
    thermalComfortSource: null,
    thermalProxyDismissed: false,
    ...overrides,
  };
}

describe('resolveThermalCauseIds', () => {
  it('partitions the seeded wake-causes by thermal meaning', () => {
    const { hot, cold } = resolveThermalCauseIds(CAUSES);
    expect(hot).toEqual(new Set(['c-hot', 'c-heart']));
    expect(cold).toEqual(new Set(['c-cold']));
  });

  it('matches case-insensitively', () => {
    const mixedCase: WakeUpCause[] = [
      { id: 'c-a', label: 'sweating / TOO HOT', sortOrder: 1, isActive: true },
      { id: 'c-b', label: 'too COLD', sortOrder: 2, isActive: true },
    ];
    const { hot, cold } = resolveThermalCauseIds(mixedCase);
    expect(hot).toEqual(new Set(['c-a']));
    expect(cold).toEqual(new Set(['c-b']));
  });

  it('ignores non-thermal causes and unknown labels', () => {
    const { hot, cold } = resolveThermalCauseIds([
      { id: 'c-x', label: 'Bathroom', sortOrder: 1, isActive: true },
      { id: 'c-y', label: 'Aliens', sortOrder: 2, isActive: true },
    ]);
    expect(hot.size).toBe(0);
    expect(cold.size).toBe(0);
  });
});

describe('classifyThermalComfortFromWakes — cause-ID branches (T2)', () => {
  const { hot, cold } = resolveThermalCauseIds(CAUSES);

  it('all wakes hot → too_hot', () => {
    const log = makeLog({
      wakeUpEvents: [
        makeWake({ cause: 'c-hot' }),
        makeWake({ cause: 'c-heart' }),
      ],
    });
    expect(classifyThermalComfortFromWakes(log, hot, cold)).toBe('too_hot');
  });

  it('all wakes cold → too_cold', () => {
    const log = makeLog({
      wakeUpEvents: [makeWake({ cause: 'c-cold' })],
    });
    expect(classifyThermalComfortFromWakes(log, hot, cold)).toBe('too_cold');
  });

  it('one hot + one cold → mixed (Q5 option a)', () => {
    const log = makeLog({
      wakeUpEvents: [
        makeWake({ cause: 'c-hot', startTime: '01:00' }),
        makeWake({ cause: 'c-cold', startTime: '04:00' }),
      ],
    });
    expect(classifyThermalComfortFromWakes(log, hot, cold)).toBe('mixed');
  });

  it('no wakes, sleep score 80 → just_right', () => {
    const log = makeLog({
      wakeUpEvents: [],
      sleepData: makeSleepData({ sleepScore: 80 }),
    });
    expect(classifyThermalComfortFromWakes(log, hot, cold)).toBe('just_right');
  });

  it('no wakes, sleep score 50 → null (below ambiguity threshold)', () => {
    const log = makeLog({
      wakeUpEvents: [],
      sleepData: makeSleepData({ sleepScore: 50 }),
    });
    expect(classifyThermalComfortFromWakes(log, hot, cold)).toBeNull();
  });

  it('only bathroom wake, sleep score 75 → just_right', () => {
    const log = makeLog({
      wakeUpEvents: [makeWake({ cause: 'c-bath' })],
      sleepData: makeSleepData({ sleepScore: 75 }),
    });
    expect(classifyThermalComfortFromWakes(log, hot, cold)).toBe('just_right');
  });

  it('only Unknown cause → null regardless of score', () => {
    // 'Unknown' is not in the hot/cold sets, so the score is what gates
    // the answer. With a mid-range score under the threshold we get null.
    const log = makeLog({
      wakeUpEvents: [makeWake({ cause: 'c-unknown' })],
      sleepData: makeSleepData({ sleepScore: 55 }),
    });
    expect(classifyThermalComfortFromWakes(log, hot, cold)).toBeNull();
  });

  it('no sleepData at all → null (can\'t clear the ambiguity threshold)', () => {
    const log = makeLog({ wakeUpEvents: [], sleepData: null });
    expect(classifyThermalComfortFromWakes(log, hot, cold)).toBeNull();
  });

  it('exactly at the threshold counts as just_right', () => {
    const log = makeLog({
      wakeUpEvents: [],
      sleepData: makeSleepData({ sleepScore: AMBIGUITY_THRESHOLD }),
    });
    expect(classifyThermalComfortFromWakes(log, hot, cold)).toBe('just_right');
  });
});

describe('classifyThermalComfortFromWakes — per-wake flag branches (T5)', () => {
  // These exercise the TODO(flags) branches. The analysis showed these
  // flags are always false in real data today, but the classifier honors
  // them when set, so once logging-fixes T2 starts capturing them the
  // classifier will pick them up automatically.
  const { hot, cold } = resolveThermalCauseIds(CAUSES);

  it('wasSweating: true, no hot cause → too_hot', () => {
    const log = makeLog({
      wakeUpEvents: [makeWake({ cause: 'c-bath', wasSweating: true })],
    });
    expect(classifyThermalComfortFromWakes(log, hot, cold)).toBe('too_hot');
  });

  it('feltCold: true, no cold cause → too_cold', () => {
    const log = makeLog({
      wakeUpEvents: [makeWake({ cause: 'c-bath', feltCold: true })],
    });
    expect(classifyThermalComfortFromWakes(log, hot, cold)).toBe('too_cold');
  });

  it('racingHeart: true on a non-thermal cause → too_hot', () => {
    const log = makeLog({
      wakeUpEvents: [makeWake({ cause: 'c-noise', racingHeart: true })],
    });
    expect(classifyThermalComfortFromWakes(log, hot, cold)).toBe('too_hot');
  });

  it('one wasSweating wake + one feltCold wake → mixed', () => {
    const log = makeLog({
      wakeUpEvents: [
        makeWake({ cause: 'c-bath', wasSweating: true, startTime: '02:00' }),
        makeWake({ cause: 'c-bath', feltCold: true, startTime: '05:00' }),
      ],
    });
    expect(classifyThermalComfortFromWakes(log, hot, cold)).toBe('mixed');
  });

  it('per-wake flag overrides a non-thermal cause cleanly', () => {
    // User marks a Bathroom wake as wasSweating — the analysis says that
    // should still flag hot for that night. (Spec: "hot-wake cause OR
    // wasSweating → too_hot".)
    const log = makeLog({
      wakeUpEvents: [makeWake({ cause: 'c-bath', wasSweating: true })],
      sleepData: makeSleepData({ sleepScore: 90 }),
    });
    expect(classifyThermalComfortFromWakes(log, hot, cold)).toBe('too_hot');
  });
});
