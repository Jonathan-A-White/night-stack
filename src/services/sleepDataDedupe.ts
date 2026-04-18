import type { NightLog, SleepData } from '../types';

/**
 * Look for an existing NightLog within ±`windowDays` of `targetDate` whose
 * `sleepData` is byte-identical to `candidate` on a fingerprint wide enough
 * to identify a re-import of the same JSON without false-positiving on
 * legitimately different nights. The original T2 bug (2026-04-17 Samsung
 * Health export) wrote byte-identical sleepData to two nights, so the
 * fingerprint has to catch that — but limiting it to just `sleepTime`,
 * `wakeTime`, `sleepScore`, and `totalSleepDuration` is too coarse: two
 * real nights can share a bedtime, wake time, score, and total duration
 * without being duplicates.
 *
 * We also require the stage breakdown (deep/REM/light/awake) and vitals
 * (avg heart rate, avg respiratory rate) to match. These vary noticeably
 * night-to-night, so legitimate collisions across all of them are
 * vanishingly rare, but any true re-import will match byte-for-byte.
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
      sd.totalSleepDuration === candidate.totalSleepDuration &&
      sd.actualSleepDuration === candidate.actualSleepDuration &&
      sd.deepSleep === candidate.deepSleep &&
      sd.remSleep === candidate.remSleep &&
      sd.lightSleep === candidate.lightSleep &&
      sd.awakeDuration === candidate.awakeDuration &&
      sd.avgHeartRate === candidate.avgHeartRate &&
      sd.avgRespiratoryRate === candidate.avgRespiratoryRate
    ) {
      return log;
    }
  }

  return null;
}
