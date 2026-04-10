import type { RoutineSession, RoutineStepLog } from '../types';

export interface StepStats {
  stepId: string;
  completedCount: number;
  skippedCount: number;
  puntedCount: number;
  bestMs: number | null;      // all-time best
  avgMs: number | null;       // all-time average
  avgMs30d: number | null;    // 30-day rolling average
  lastMs: number | null;      // most recent completion
}

export interface SessionStats {
  totalSessions: number;
  completedSessions: number;
  bestTotalMs: number | null;       // all-time fastest completed session
  avgTotalMs: number | null;        // all-time average completed session total
  avgTotalMs30d: number | null;     // 30-day moving average of completed session totals
  stdDevMs30d: number | null;       // 30-day std dev of completed session totals
  lastTotalMs: number | null;
  sampleCount30d: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24h — also used by notifications module

/** Return ms-since-epoch cutoff 30 days ago. */
export function thirtyDaysAgo(now: number = Date.now()): number {
  return now - 30 * MS_PER_DAY;
}

/** Parse a YYYY-MM-DD session date into ms-since-epoch at local midnight. */
function sessionDateToMs(date: string): number {
  // Dates are stored as "YYYY-MM-DD" — construct at local midnight so the
  // 30-day window respects the user's timezone.
  const [y, m, d] = date.split('-').map((v) => parseInt(v, 10));
  if (!y || !m || !d) return 0;
  return new Date(y, m - 1, d).getTime();
}

/**
 * Returns the earliest `startedAt` across today's already-saved sessions —
 * i.e. the "immutable" session start for the day. Once the user has begun
 * their routine for the evening, later sub-sessions (e.g. added items run
 * after a first save) should inherit this value so the displayed total
 * stays a true wall-clock measurement from the very first step. Returns
 * null if no session exists yet for the given date.
 */
export function computeTodaySessionStartedAt(
  sessions: RoutineSession[],
  todayDate: string,
): number | null {
  let earliest: number | null = null;
  for (const s of sessions) {
    if (s.date !== todayDate) continue;
    if (earliest == null || s.startedAt < earliest) {
      earliest = s.startedAt;
    }
  }
  return earliest;
}

/**
 * Returns the latest `endedAt` across the given steps. Used to compute the
 * session's effective end time — this naturally "bumps" forward as
 * additional steps are completed in later sub-sessions the same evening.
 * Returns null if no step has a non-null endedAt.
 */
export function computeLatestStepEndedAt(
  steps: ReadonlyArray<{ endedAt: number | null }>,
): number | null {
  let latest: number | null = null;
  for (const s of steps) {
    if (s.endedAt == null) continue;
    if (latest == null || s.endedAt > latest) latest = s.endedAt;
  }
  return latest;
}

/** All-time best completion per step. */
export function computeStepPBs(sessions: RoutineSession[]): Map<string, number> {
  const pbs = new Map<string, number>();
  for (const session of sessions) {
    for (const log of session.steps) {
      if (log.status !== 'completed' || log.durationMs == null) continue;
      const current = pbs.get(log.stepId);
      if (current == null || log.durationMs < current) {
        pbs.set(log.stepId, log.durationMs);
      }
    }
  }
  return pbs;
}

/** Full per-step stats (all-time + 30d rolling). */
export function computeStepStats(sessions: RoutineSession[]): Map<string, StepStats> {
  const cutoff30d = thirtyDaysAgo();
  const stats = new Map<string, StepStats>();
  const allTimeTotals = new Map<string, { sum: number; count: number }>();
  const rolling30d = new Map<string, { sum: number; count: number }>();
  // Track the most recent completion per step by startedAt.
  const lastByStep = new Map<string, { startedAt: number; durationMs: number }>();

  // Order sessions chronologically so iteration reflects time.
  const ordered = [...sessions].sort((a, b) => a.startedAt - b.startedAt);

  for (const session of ordered) {
    const sessionDateMs = sessionDateToMs(session.date);
    const within30d = sessionDateMs >= cutoff30d;

    for (const log of session.steps) {
      if (!stats.has(log.stepId)) {
        stats.set(log.stepId, {
          stepId: log.stepId,
          completedCount: 0,
          skippedCount: 0,
          puntedCount: 0,
          bestMs: null,
          avgMs: null,
          avgMs30d: null,
          lastMs: null,
        });
      }
      const s = stats.get(log.stepId)!;

      if (log.status === 'skipped') {
        s.skippedCount += 1;
        continue;
      }
      if (log.status === 'punted') {
        s.puntedCount += 1;
        continue;
      }
      // Completed path
      if (log.durationMs == null) continue;
      s.completedCount += 1;

      if (s.bestMs == null || log.durationMs < s.bestMs) {
        s.bestMs = log.durationMs;
      }

      const allTotal = allTimeTotals.get(log.stepId) ?? { sum: 0, count: 0 };
      allTotal.sum += log.durationMs;
      allTotal.count += 1;
      allTimeTotals.set(log.stepId, allTotal);

      if (within30d) {
        const r = rolling30d.get(log.stepId) ?? { sum: 0, count: 0 };
        r.sum += log.durationMs;
        r.count += 1;
        rolling30d.set(log.stepId, r);
      }

      const startedAt = log.startedAt ?? session.startedAt;
      const prevLast = lastByStep.get(log.stepId);
      if (!prevLast || startedAt >= prevLast.startedAt) {
        lastByStep.set(log.stepId, { startedAt, durationMs: log.durationMs });
      }
    }
  }

  // Finalize averages.
  for (const [stepId, s] of stats) {
    const all = allTimeTotals.get(stepId);
    if (all && all.count > 0) s.avgMs = all.sum / all.count;
    const r30 = rolling30d.get(stepId);
    if (r30 && r30.count > 0) s.avgMs30d = r30.sum / r30.count;
    const last = lastByStep.get(stepId);
    if (last) s.lastMs = last.durationMs;
  }

  return stats;
}

/** Session-level aggregate stats. */
export function computeSessionStats(sessions: RoutineSession[]): SessionStats {
  const cutoff30d = thirtyDaysAgo();
  const completed = sessions.filter(
    (s) => s.completedAt != null && s.totalDurationMs != null,
  );

  if (sessions.length === 0) {
    return {
      totalSessions: 0,
      completedSessions: 0,
      bestTotalMs: null,
      avgTotalMs: null,
      avgTotalMs30d: null,
      stdDevMs30d: null,
      lastTotalMs: null,
      sampleCount30d: 0,
    };
  }

  let bestTotalMs: number | null = null;
  let sum = 0;
  for (const s of completed) {
    const total = s.totalDurationMs as number;
    if (bestTotalMs == null || total < bestTotalMs) bestTotalMs = total;
    sum += total;
  }
  const avgTotalMs = completed.length > 0 ? sum / completed.length : null;

  // 30-day window on session.date.
  const within30d = completed.filter((s) => sessionDateToMs(s.date) >= cutoff30d);
  let avgTotalMs30d: number | null = null;
  let stdDevMs30d: number | null = null;
  if (within30d.length > 0) {
    const totals = within30d.map((s) => s.totalDurationMs as number);
    const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
    avgTotalMs30d = mean;
    const variance =
      totals.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / totals.length;
    stdDevMs30d = Math.sqrt(variance);
  }

  // Most recent completed session by startedAt.
  let lastTotalMs: number | null = null;
  if (completed.length > 0) {
    const latest = [...completed].sort((a, b) => b.startedAt - a.startedAt)[0];
    lastTotalMs = latest.totalDurationMs ?? null;
  }

  return {
    totalSessions: sessions.length,
    completedSessions: completed.length,
    bestTotalMs,
    avgTotalMs,
    avgTotalMs30d,
    stdDevMs30d,
    lastTotalMs,
    sampleCount30d: within30d.length,
  };
}

/**
 * Given 30-day avg + std dev, return ms buffer = avg + stdDev.
 * If < 5 sessions, fall back to avg * 1.25; if 0 sessions, return null.
 */
export function computeBufferedTotalMs(stats: SessionStats): number | null {
  if (stats.sampleCount30d === 0) {
    // Fall back to all-time average if we have anything at all.
    if (stats.avgTotalMs != null) return stats.avgTotalMs * 1.25;
    return null;
  }
  if (stats.sampleCount30d < 5) {
    const base = stats.avgTotalMs30d ?? stats.avgTotalMs;
    return base != null ? base * 1.25 : null;
  }
  const avg = stats.avgTotalMs30d;
  const sd = stats.stdDevMs30d ?? 0;
  if (avg == null) return null;
  return avg + sd;
}

/**
 * Given target bedtime "HH:MM" (local) and today's Date, return a Date representing
 * the recommended start time for TONIGHT.
 */
export function computeRecommendedStart(
  targetBedtimeHHMM: string,
  bufferedMs: number | null,
  now: Date = new Date(),
): Date | null {
  if (bufferedMs == null) return null;
  // Defend against callers passing undefined/null/empty — the alarm schedule
  // may not be loaded yet when the card first mounts.
  if (typeof targetBedtimeHHMM !== 'string' || targetBedtimeHHMM.length === 0) {
    return null;
  }
  const match = /^(\d{1,2}):(\d{2})$/.exec(targetBedtimeHHMM.trim());
  if (!match) return null;
  const hh = parseInt(match[1], 10);
  const mm = parseInt(match[2], 10);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;

  // Anchor target bedtime to tonight: if the computed bedtime has already
  // passed today and the hour is "early" (likely past midnight), roll forward
  // a day. Otherwise keep it on today's date. For typical evening bedtimes
  // the bedtime Date stays on today.
  const bedtime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
  // If bedtime is "early morning" (hh < 12) and the current time is afternoon
  // or later, treat the bedtime as belonging to tomorrow.
  if (hh < 12 && now.getHours() >= 12) {
    bedtime.setDate(bedtime.getDate() + 1);
  }

  return new Date(bedtime.getTime() - bufferedMs);
}

/** Format a ms value as "MM:SS" or "-MM:SS" (negative when exceeded PB), "H:MM:SS" at ≥1h. */
export function formatStopwatch(ms: number): string {
  const negative = ms < 0;
  const abs = Math.floor(Math.abs(ms) / 1000); // whole seconds
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  const seconds = abs % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  const sign = negative ? '-' : '';
  if (hours > 0) return `${sign}${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${sign}${pad(minutes)}:${pad(seconds)}`;
}

/** Format a ms total-time as "H:MM:SS" or "MM:SS" if < 1h. Null → em dash. */
export function formatTotal(ms: number | null): string {
  if (ms == null) return '—';
  const abs = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  const seconds = abs % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

// Re-export to keep the RoutineStepLog type referenced for downstream importers.
export type { RoutineStepLog };
// Re-export the max schedule window so notifications module can share the constant if needed.
export { MAX_TIMEOUT_MS };
