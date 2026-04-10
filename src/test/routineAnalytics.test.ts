import { describe, it, expect } from 'vitest';
import {
  computeStepPBs,
  computeRecommendedStart,
  computeBufferedTotalMs,
  computeSessionStats,
  formatStopwatch,
  formatTotal,
} from '../services/routineAnalytics';
import type { RoutineSession, RoutineStepLog } from '../types';

function makeStepLog(partial: Partial<RoutineStepLog>): RoutineStepLog {
  return {
    stepId: partial.stepId ?? 'step-1',
    stepName: partial.stepName ?? 'Brush teeth',
    status: partial.status ?? 'completed',
    startedAt: partial.startedAt ?? 0,
    endedAt: partial.endedAt ?? 0,
    durationMs: partial.durationMs ?? null,
    pbAtStartMs: partial.pbAtStartMs ?? null,
    notes: partial.notes ?? '',
  };
}

function makeSession(partial: Partial<RoutineSession>): RoutineSession {
  return {
    id: partial.id ?? crypto.randomUUID(),
    date: partial.date ?? '2026-04-01',
    variantId: partial.variantId ?? null,
    variantName: partial.variantName ?? 'Full',
    startedAt: partial.startedAt ?? 0,
    endedAt: partial.endedAt ?? null,
    completedAt: partial.completedAt ?? null,
    totalDurationMs: partial.totalDurationMs ?? null,
    steps: partial.steps ?? [],
    sessionNotes: partial.sessionNotes ?? '',
    createdAt: partial.createdAt ?? 0,
  };
}

describe('computeStepPBs', () => {
  it('returns empty map for no sessions', () => {
    expect(computeStepPBs([]).size).toBe(0);
  });

  it('returns the minimum completed durationMs per step', () => {
    const sessions: RoutineSession[] = [
      makeSession({
        steps: [
          makeStepLog({ stepId: 'a', status: 'completed', durationMs: 10_000 }),
          makeStepLog({ stepId: 'b', status: 'completed', durationMs: 20_000 }),
        ],
      }),
      makeSession({
        steps: [
          makeStepLog({ stepId: 'a', status: 'completed', durationMs: 7_500 }),
          makeStepLog({ stepId: 'b', status: 'completed', durationMs: 25_000 }),
        ],
      }),
    ];
    const pbs = computeStepPBs(sessions);
    expect(pbs.get('a')).toBe(7_500);
    expect(pbs.get('b')).toBe(20_000);
  });

  it('ignores skipped/punted steps and null durations', () => {
    const sessions: RoutineSession[] = [
      makeSession({
        steps: [
          makeStepLog({ stepId: 'a', status: 'skipped', durationMs: null }),
          makeStepLog({ stepId: 'a', status: 'punted', durationMs: null }),
          makeStepLog({ stepId: 'a', status: 'completed', durationMs: null }),
        ],
      }),
    ];
    const pbs = computeStepPBs(sessions);
    expect(pbs.has('a')).toBe(false);
  });
});

describe('computeRecommendedStart', () => {
  it('returns null when bufferedMs is null', () => {
    expect(
      computeRecommendedStart('22:30', null, new Date(2026, 3, 9, 18, 0, 0)),
    ).toBeNull();
  });

  it('returns null for malformed target bedtime', () => {
    expect(
      computeRecommendedStart('not-a-time', 60_000, new Date(2026, 3, 9, 18, 0, 0)),
    ).toBeNull();
  });

  it('returns null for empty target bedtime', () => {
    expect(
      computeRecommendedStart('', 60_000, new Date(2026, 3, 9, 18, 0, 0)),
    ).toBeNull();
  });

  it('subtracts bufferedMs from target bedtime on today', () => {
    const now = new Date(2026, 3, 9, 18, 0, 0); // Apr 9, 6 PM
    const bufferedMs = 30 * 60 * 1000; // 30 min
    const start = computeRecommendedStart('22:30', bufferedMs, now);
    expect(start).not.toBeNull();
    expect(start!.getHours()).toBe(22);
    expect(start!.getMinutes()).toBe(0);
    expect(start!.getDate()).toBe(9);
  });

  it('returns a Date even if start is already in the past (for overdue display)', () => {
    const now = new Date(2026, 3, 9, 23, 0, 0); // Apr 9, 11 PM
    const bufferedMs = 30 * 60 * 1000; // 30 min
    const start = computeRecommendedStart('22:30', bufferedMs, now);
    // 22:30 - 30m = 22:00 earlier today, which is before `now` (23:00).
    expect(start).not.toBeNull();
    expect(start!.getTime()).toBeLessThan(now.getTime());
  });

  it('rolls "early morning" bedtime forward to tomorrow when now is afternoon/later', () => {
    const now = new Date(2026, 3, 9, 20, 0, 0); // Apr 9, 8 PM
    const bufferedMs = 30 * 60 * 1000;
    const start = computeRecommendedStart('00:30', bufferedMs, now);
    expect(start).not.toBeNull();
    // Should be April 10, 00:00
    expect(start!.getDate()).toBe(10);
    expect(start!.getHours()).toBe(0);
    expect(start!.getMinutes()).toBe(0);
  });
});

describe('computeBufferedTotalMs', () => {
  it('returns null with no data', () => {
    const stats = computeSessionStats([]);
    expect(computeBufferedTotalMs(stats)).toBeNull();
  });

  it('uses 1.25x fallback when fewer than 5 30d sessions', () => {
    const mk = (totalMs: number, date: string): RoutineSession =>
      makeSession({
        date,
        totalDurationMs: totalMs,
        completedAt: 1,
        endedAt: 1,
      });
    // Use dates close to today so they fall inside the 30-day window.
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const sessions = [mk(60_000, todayIso), mk(80_000, todayIso)];
    const stats = computeSessionStats(sessions);
    const buf = computeBufferedTotalMs(stats);
    expect(buf).not.toBeNull();
    // avg = 70_000, * 1.25 = 87_500
    expect(buf).toBeCloseTo(87_500, 0);
  });
});

describe('formatStopwatch', () => {
  it('formats zero as 00:00', () => {
    expect(formatStopwatch(0)).toBe('00:00');
  });

  it('formats positive ms as MM:SS', () => {
    expect(formatStopwatch(65_000)).toBe('01:05');
  });

  it('formats negative ms with leading minus', () => {
    expect(formatStopwatch(-75_000)).toBe('-01:15');
  });

  it('formats >= 1h as H:MM:SS', () => {
    expect(formatStopwatch(3_725_000)).toBe('1:02:05');
  });
});

describe('formatTotal', () => {
  it('returns em dash for null', () => {
    expect(formatTotal(null)).toBe('—');
  });

  it('formats ms as MM:SS when < 1h', () => {
    expect(formatTotal(125_000)).toBe('02:05');
  });

  it('formats ms as H:MM:SS when >= 1h', () => {
    expect(formatTotal(3_725_000)).toBe('1:02:05');
  });
});
