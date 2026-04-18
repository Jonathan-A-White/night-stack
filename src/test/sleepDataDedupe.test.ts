import { describe, it, expect } from 'vitest';
import { findDuplicateSleepData } from '../services/sleepDataDedupe';
import type { NightLog, SleepData } from '../types';

function makeSleepData(overrides: Partial<SleepData> = {}): SleepData {
  return {
    sleepTime: '22:31',
    wakeTime: '04:43',
    totalSleepDuration: 372,
    actualSleepDuration: 351,
    sleepScore: 82,
    sleepScoreDelta: 5,
    deepSleep: 64,
    remSleep: 108,
    lightSleep: 179,
    awakeDuration: 21,
    avgHeartRate: 48,
    minHeartRate: 42,
    avgRespiratoryRate: 15.1,
    bloodOxygenAvg: 93,
    skinTempRange: '',
    sleepLatencyRating: 'Good',
    restfulnessRating: 'Good',
    deepSleepRating: 'Good',
    remSleepRating: 'Good',
    importedAt: 0,
    ...overrides,
  };
}

function makeNightLog(date: string, sleepData: SleepData | null): NightLog {
  return {
    id: `log-${date}`,
    date,
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
    sleepData,
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
  };
}

describe('findDuplicateSleepData (bugfixes T2)', () => {
  it('flags a ±3 day duplicate with byte-identical key fields', () => {
    // The exact regression from the 2026-04-17 export: 4/15 and 4/16 share
    // byte-identical sleepData. Saving either should raise the banner.
    const existing = [
      makeNightLog('2026-04-16', makeSleepData({ sleepScore: 93, totalSleepDuration: 422 })),
    ];
    const candidate = makeSleepData({ sleepScore: 93, totalSleepDuration: 422 });
    const match = findDuplicateSleepData(candidate, '2026-04-15', existing);
    expect(match).not.toBeNull();
    expect(match!.date).toBe('2026-04-16');
  });

  it('returns null when no duplicate exists in the window', () => {
    const existing = [
      makeNightLog('2026-04-16', makeSleepData({ sleepScore: 87, totalSleepDuration: 410 })),
    ];
    const candidate = makeSleepData({ sleepScore: 93, totalSleepDuration: 422 });
    const match = findDuplicateSleepData(candidate, '2026-04-15', existing);
    expect(match).toBeNull();
  });

  it('ignores duplicates outside the ±3 day window', () => {
    const existing = [
      makeNightLog('2026-04-01', makeSleepData()),
    ];
    const match = findDuplicateSleepData(makeSleepData(), '2026-04-15', existing);
    expect(match).toBeNull();
  });

  it('skips the excluded log id so editing an existing log does not self-report', () => {
    const log = makeNightLog('2026-04-15', makeSleepData());
    const match = findDuplicateSleepData(makeSleepData(), '2026-04-15', [log], {
      excludeLogId: log.id,
    });
    expect(match).toBeNull();
  });

  it('does not flag logs whose sleepData is null', () => {
    const existing = [makeNightLog('2026-04-16', null)];
    const match = findDuplicateSleepData(makeSleepData(), '2026-04-15', existing);
    expect(match).toBeNull();
  });

  it('considers sleepScore + totalSleepDuration part of the key — mismatched score does not dupe', () => {
    const existing = [
      makeNightLog('2026-04-16', makeSleepData({ sleepScore: 88 })),
    ];
    const candidate = makeSleepData({ sleepScore: 82 });
    expect(findDuplicateSleepData(candidate, '2026-04-15', existing)).toBeNull();
  });

  it('does not flag two legitimate nights that share only bedtime/waketime/score/total', () => {
    // Regression: 2026-04-18 user hit a false-positive where today's fresh
    // import matched 2026-04-15's stored log on just the 4 original key
    // fields. The stage breakdown and vitals differ on real different
    // nights, so the wider fingerprint must let this through.
    const existing = [
      makeNightLog(
        '2026-04-15',
        makeSleepData({
          sleepTime: '22:52',
          wakeTime: '06:16',
          sleepScore: 93,
          totalSleepDuration: 444,
          actualSleepDuration: 410,
          deepSleep: 71,
          remSleep: 98,
          lightSleep: 241,
          awakeDuration: 34,
          avgHeartRate: 49,
          avgRespiratoryRate: 14.6,
        }),
      ),
    ];
    const candidate = makeSleepData({
      sleepTime: '22:52',
      wakeTime: '06:16',
      sleepScore: 93,
      totalSleepDuration: 444,
      actualSleepDuration: 422,
      deepSleep: 59,
      remSleep: 107,
      lightSleep: 256,
      awakeDuration: 22,
      avgHeartRate: 46,
      avgRespiratoryRate: 15,
    });
    expect(findDuplicateSleepData(candidate, '2026-04-18', existing)).toBeNull();
  });
});
