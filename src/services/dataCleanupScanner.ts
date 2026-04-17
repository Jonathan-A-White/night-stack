import type { NightLog, RoomReading } from '../types';

/**
 * A single row surfaced by the data cleanup scanner. Each row targets one
 * problematic `NightLog` and labels the specific field the user should
 * decide on. The UI turns this into a radio group (Keep / Clear sleepData /
 * Clear roomTimeline) and calls back into the runner with the user's
 * choices.
 */
export interface CleanupIssue {
  nightLogId: string;
  date: string; // NightLog.date (evening)
  /**
   * The kind of corruption detected:
   *   - `duplicate-sleep` — this log's sleepData is byte-identical to
   *     another log within ±3 days. `relatedDate` identifies the sibling.
   *   - `stale-room-timeline` — more than 10% of the roomTimeline samples
   *     fall outside the log's own 21:00–07:00 evening window.
   */
  kind: 'duplicate-sleep' | 'stale-room-timeline';
  /** Short human summary the UI renders alongside the row. */
  summary: string;
  /** For `duplicate-sleep`: the date of the sibling log that shares data. */
  relatedDate?: string;
  /** For `stale-room-timeline`: the count of out-of-window samples. */
  outOfWindowCount?: number;
  /** For `stale-room-timeline`: total sample count. */
  totalCount?: number;
}

function sameSleepSession(a: NightLog, b: NightLog): boolean {
  if (!a.sleepData || !b.sleepData) return false;
  return (
    a.sleepData.sleepTime === b.sleepData.sleepTime &&
    a.sleepData.wakeTime === b.sleepData.wakeTime &&
    a.sleepData.sleepScore === b.sleepData.sleepScore &&
    a.sleepData.totalSleepDuration === b.sleepData.totalSleepDuration
  );
}

function daysBetween(dateA: string, dateB: string): number {
  const [ay, am, ad] = dateA.split('-').map(Number);
  const [by, bm, bd] = dateB.split('-').map(Number);
  const a = new Date(ay, am - 1, ad);
  const b = new Date(by, bm - 1, bd);
  return Math.abs(Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24)));
}

function countOutOfWindowSamples(date: string, readings: readonly RoomReading[]): number {
  const eveningStart = new Date(`${date}T21:00:00`);
  const morningEnd = new Date(eveningStart);
  morningEnd.setDate(morningEnd.getDate() + 1);
  morningEnd.setHours(7, 0, 0, 0);

  let bad = 0;
  for (const r of readings) {
    const d = new Date(r.timestamp);
    if (isNaN(d.getTime())) {
      bad++;
      continue;
    }
    if (d < eveningStart || d > morningEnd) bad++;
  }
  return bad;
}

/**
 * Scan a list of NightLogs for the two data-hygiene defects the 2026-04-17
 * export exposed. Returns a flat list of issues — each issue is one row the
 * UI will render with per-row actions.
 *
 * Idempotent: running the scanner twice on the same clean input returns an
 * empty list the second time.
 */
export function scanLogsForIssues(logs: readonly NightLog[]): CleanupIssue[] {
  const issues: CleanupIssue[] = [];

  // 1) Duplicate sleepData within ±3 days. We walk pairs once, emitting
  // BOTH sides of each duplicate pair so the user can pick which one to
  // keep independently.
  for (let i = 0; i < logs.length; i++) {
    for (let j = i + 1; j < logs.length; j++) {
      const a = logs[i];
      const b = logs[j];
      if (daysBetween(a.date, b.date) > 3) continue;
      if (!sameSleepSession(a, b)) continue;
      issues.push({
        nightLogId: a.id,
        date: a.date,
        kind: 'duplicate-sleep',
        summary: `sleepData byte-identical to ${b.date}`,
        relatedDate: b.date,
      });
      issues.push({
        nightLogId: b.id,
        date: b.date,
        kind: 'duplicate-sleep',
        summary: `sleepData byte-identical to ${a.date}`,
        relatedDate: a.date,
      });
    }
  }

  // 2) roomTimeline with >10% of samples outside the evening window.
  for (const log of logs) {
    if (!log.roomTimeline || log.roomTimeline.length === 0) continue;
    const bad = countOutOfWindowSamples(log.date, log.roomTimeline);
    if (bad === 0) continue;
    const ratio = bad / log.roomTimeline.length;
    if (ratio > 0.1) {
      issues.push({
        nightLogId: log.id,
        date: log.date,
        kind: 'stale-room-timeline',
        summary: `${bad}/${log.roomTimeline.length} samples outside the 21:00\u201307:00 window`,
        outOfWindowCount: bad,
        totalCount: log.roomTimeline.length,
      });
    }
  }

  return issues;
}

/**
 * Per-row action the user selected in the cleanup modal. `keep` leaves the
 * log untouched; the two `clear-*` options null out the offending field
 * before the updated record is written back. The modal radio group maps
 * directly onto these values.
 */
export type CleanupAction = 'keep' | 'clear-sleepData' | 'clear-roomTimeline';

/**
 * Apply a map of per-issue user actions to a set of logs, returning the
 * mutated set ready for `db.nightLogs.bulkPut`. Pure — no IO, no side
 * effects — so the caller can preview the diff before writing.
 *
 * Only logs with at least one non-`keep` action are included in the
 * output. The bulkPut therefore only touches rows that actually changed.
 */
export function applyCleanupActions(
  logs: readonly NightLog[],
  actionsByIssue: ReadonlyArray<{ issue: CleanupIssue; action: CleanupAction }>,
): NightLog[] {
  const byId = new Map<string, NightLog>();
  for (const { issue, action } of actionsByIssue) {
    if (action === 'keep') continue;
    const base = byId.get(issue.nightLogId)
      ?? logs.find((l) => l.id === issue.nightLogId);
    if (!base) continue;
    const next: NightLog = { ...base };
    if (action === 'clear-sleepData') next.sleepData = null;
    if (action === 'clear-roomTimeline') next.roomTimeline = null;
    next.updatedAt = Date.now();
    byId.set(issue.nightLogId, next);
  }
  return Array.from(byId.values());
}
