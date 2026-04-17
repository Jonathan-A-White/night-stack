import type { NightLog, SleepData } from '../types';

/**
 * Look for an existing NightLog within ±`windowDays` of `targetDate` whose
 * `sleepData` is byte-identical to `candidate` on the fields Samsung Health
 * uses to identify a sleep session (`sleepTime`, `wakeTime`, `sleepScore`,
 * `totalSleepDuration`). These four fields together uniquely pin a session
 * — duplicate writes in the 2026-04-17 export share all four — so equality
 * here is a strong signal the user is re-importing the same JSON onto a
 * different night log.
 *
 * Returns the offending log, or null if nothing matches. Defense-in-depth
 * counterpart to T1: even with the import-side date filter in place, an
 * older cached draft or a manual entry can still produce a duplicate, and
 * this check runs on every save regardless of import path.
 *
 * The `excludeLogId` param skips the log currently being saved so editing an
 * existing entry never self-reports as a duplicate of itself.
 */
export function findDuplicateSleepData(
  candidate: SleepData,
  targetDate: string,
  existingLogs: readonly NightLog[],
  opts: { windowDays?: number; excludeLogId?: string } = {},
): NightLog | null {
  const windowDays = opts.windowDays ?? 3;
  const [ty, tm, td] = targetDate.split('-').map(Number);
  const target = new Date(ty, tm - 1, td);

  for (const log of existingLogs) {
    if (log.id === opts.excludeLogId) continue;
    if (!log.sleepData) continue;
    if (log.date === targetDate) continue; // same-date edits aren't duplicates

    const [ly, lm, ld] = log.date.split('-').map(Number);
    const other = new Date(ly, lm - 1, ld);
    const diffDays = Math.abs(
      Math.round((other.getTime() - target.getTime()) / (1000 * 60 * 60 * 24)),
    );
    if (diffDays > windowDays) continue;

    const sd = log.sleepData;
    if (
      sd.sleepTime === candidate.sleepTime &&
      sd.wakeTime === candidate.wakeTime &&
      sd.sleepScore === candidate.sleepScore &&
      sd.totalSleepDuration === candidate.totalSleepDuration
    ) {
      return log;
    }
  }

  return null;
}
