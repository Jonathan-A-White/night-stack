import { describe, it, expect } from 'vitest';
import {
  scanLogsForIssues,
  applyCleanupActions,
  type CleanupIssue,
} from '../services/dataCleanupScanner';
import type { NightLog, SleepData, RoomReading } from '../types';

function makeSleep(overrides: Partial<SleepData> = {}): SleepData {
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

function makeLog(
  date: string,
  opts: { sleepData?: SleepData | null; roomTimeline?: RoomReading[] | null } = {},
): NightLog {
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
    sleepData: opts.sleepData ?? null,
    roomTimeline: opts.roomTimeline ?? null,
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
  };
}

function reading(iso: string, tempF = 68, humidity = 45): RoomReading {
  return { timestamp: iso, tempF, humidity };
}

describe('scanLogsForIssues (bugfixes T4)', () => {
  it('flags the exact 4/15 \u2261 4/16 duplicate from the 2026-04-17 export', () => {
    const shared = makeSleep({ sleepScore: 93, totalSleepDuration: 422 });
    const logs = [
      makeLog('2026-04-15', { sleepData: shared }),
      makeLog('2026-04-16', { sleepData: shared }),
    ];
    const issues = scanLogsForIssues(logs);
    // One issue per side of the pair so the user can keep either.
    const dupes = issues.filter((i) => i.kind === 'duplicate-sleep');
    expect(dupes).toHaveLength(2);
    expect(new Set(dupes.map((d) => d.date))).toEqual(new Set(['2026-04-15', '2026-04-16']));
  });

  it('flags roomTimeline with >10% samples outside the evening window', () => {
    // 1 in-window, 2 out-of-window (2026-04-17 timestamps on a 2026-04-15 log).
    const roomTimeline: RoomReading[] = [
      reading('2026-04-15T22:00:00'),
      reading('2026-04-17T01:00:00'),
      reading('2026-04-17T02:00:00'),
    ];
    const logs = [makeLog('2026-04-15', { roomTimeline })];
    const issues = scanLogsForIssues(logs);
    const stale = issues.filter((i) => i.kind === 'stale-room-timeline');
    expect(stale).toHaveLength(1);
    expect(stale[0].outOfWindowCount).toBe(2);
    expect(stale[0].totalCount).toBe(3);
  });

  it('returns an empty list for clean data (idempotent on re-run)', () => {
    const logs = [
      makeLog('2026-04-15', { sleepData: makeSleep({ sleepScore: 70 }) }),
      makeLog('2026-04-16', { sleepData: makeSleep({ sleepScore: 93 }) }),
      makeLog('2026-04-17', {
        sleepData: makeSleep({ sleepScore: 85 }),
        roomTimeline: [reading('2026-04-17T22:00:00'), reading('2026-04-18T03:00:00')],
      }),
    ];
    expect(scanLogsForIssues(logs)).toHaveLength(0);
  });

  it('does not flag duplicates more than 3 days apart', () => {
    const shared = makeSleep();
    const logs = [
      makeLog('2026-04-01', { sleepData: shared }),
      makeLog('2026-04-10', { sleepData: shared }),
    ];
    expect(scanLogsForIssues(logs)).toHaveLength(0);
  });
});

describe('applyCleanupActions (bugfixes T4)', () => {
  it('clears sleepData only on logs the user tagged for that action', () => {
    const logs = [
      makeLog('2026-04-15', { sleepData: makeSleep() }),
      makeLog('2026-04-16', { sleepData: makeSleep() }),
    ];
    const issue: CleanupIssue = {
      nightLogId: 'log-2026-04-15',
      date: '2026-04-15',
      kind: 'duplicate-sleep',
      summary: '',
      relatedDate: '2026-04-16',
    };
    const updated = applyCleanupActions(logs, [
      { issue, action: 'clear-sleepData' },
    ]);
    expect(updated).toHaveLength(1);
    expect(updated[0].id).toBe('log-2026-04-15');
    expect(updated[0].sleepData).toBeNull();
  });

  it('returns nothing when every action is `keep`', () => {
    const logs = [makeLog('2026-04-15', { sleepData: makeSleep() })];
    const issue: CleanupIssue = {
      nightLogId: 'log-2026-04-15',
      date: '2026-04-15',
      kind: 'duplicate-sleep',
      summary: '',
    };
    expect(
      applyCleanupActions(logs, [{ issue, action: 'keep' }]),
    ).toHaveLength(0);
  });

  it('clears roomTimeline for stale-room-timeline actions', () => {
    const logs = [
      makeLog('2026-04-15', {
        roomTimeline: [reading('2026-04-17T01:00:00')],
      }),
    ];
    const issue: CleanupIssue = {
      nightLogId: 'log-2026-04-15',
      date: '2026-04-15',
      kind: 'stale-room-timeline',
      summary: '',
    };
    const updated = applyCleanupActions(logs, [
      { issue, action: 'clear-roomTimeline' },
    ]);
    expect(updated[0].roomTimeline).toBeNull();
  });
});
