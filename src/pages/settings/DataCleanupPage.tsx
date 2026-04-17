import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../../db';
import {
  applyCleanupActions,
  scanLogsForIssues,
  type CleanupAction,
  type CleanupIssue,
} from '../../services/dataCleanupScanner';
import type { NightLog } from '../../types';

/**
 * One-time data cleanup UI (bugfixes T4). Scans `nightLogs` for the two
 * hygiene defects the 2026-04-17 export surfaced and lets the user decide
 * per-row whether to keep the record, clear its `sleepData`, or clear its
 * `roomTimeline`. No deletion happens without explicit confirmation.
 *
 * This is deliberately not a versioned Dexie migration — it only affects
 * one user's data and is idempotent: running it twice on clean data lists
 * zero matches.
 */
export default function DataCleanupPage() {
  const [logs, setLogs] = useState<NightLog[] | null>(null);
  const [issues, setIssues] = useState<CleanupIssue[] | null>(null);
  const [actions, setActions] = useState<Record<number, CleanupAction>>({});
  const [status, setStatus] = useState<string>('');
  const [isApplying, setIsApplying] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all = await db.nightLogs.toArray();
      if (cancelled) return;
      setLogs(all);
      const found = scanLogsForIssues(all);
      setIssues(found);
      // Default every row to `keep` — the user opts in to each deletion.
      const defaults: Record<number, CleanupAction> = {};
      for (let i = 0; i < found.length; i++) defaults[i] = 'keep';
      setActions(defaults);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function setAction(idx: number, action: CleanupAction) {
    setActions((prev) => ({ ...prev, [idx]: action }));
  }

  const plannedChanges = issues
    ? issues
        .map((issue, idx) => ({ issue, action: actions[idx] ?? 'keep' }))
        .filter((pair) => pair.action !== 'keep')
    : [];

  async function handleApply() {
    if (!logs || !issues) return;
    if (plannedChanges.length === 0) return;
    setIsApplying(true);
    try {
      const pairs = issues.map((issue, idx) => ({
        issue,
        action: actions[idx] ?? 'keep',
      }));
      const updated = applyCleanupActions(logs, pairs);
      if (updated.length > 0) {
        await db.nightLogs.bulkPut(updated);
      }
      // Re-scan so the surviving list reflects reality.
      const all = await db.nightLogs.toArray();
      setLogs(all);
      const found = scanLogsForIssues(all);
      setIssues(found);
      const defaults: Record<number, CleanupAction> = {};
      for (let i = 0; i < found.length; i++) defaults[i] = 'keep';
      setActions(defaults);
      setStatus(
        updated.length === 1
          ? 'Applied 1 cleanup change.'
          : `Applied ${updated.length} cleanup changes.`,
      );
      setTimeout(() => setStatus(''), 4000);
    } finally {
      setIsApplying(false);
      setConfirmOpen(false);
    }
  }

  if (issues === null) {
    return (
      <div className="empty-state">
        <h3>Scanning nightLogs&hellip;</h3>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <Link to="/settings/data" className="text-accent" style={{ textDecoration: 'none', fontSize: 14 }}>
          &lsaquo; Data Management
        </Link>
        <h1>Data Cleanup</h1>
        <p className="subtitle">
          Review and resolve data-hygiene issues in your night logs.
        </p>
      </div>

      <div className="card">
        <div className="card-title">Scan Result</div>
        <div className="summary-row">
          <span className="summary-label">Night logs scanned</span>
          <span className="summary-value">{logs?.length ?? 0}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Issues found</span>
          <span className="summary-value text-accent">{issues.length}</span>
        </div>
        <p className="text-secondary text-sm mt-16">
          Looks for (a) sleepData shared byte-for-byte between two nights
          within 3 days and (b) roomTimelines where more than 10% of samples
          fall outside the night's own 21:00&ndash;07:00 window. Both are
          the data-hygiene defects that the 2026-04-17 export surfaced.
        </p>
      </div>

      {issues.length === 0 ? (
        <div className="banner banner-success">
          No cleanup issues found. Running this scan again will return the
          same result.
        </div>
      ) : (
        <>
          {issues.map((issue, idx) => {
            const action: CleanupAction = actions[idx] ?? 'keep';
            return (
              <div key={`${issue.nightLogId}-${idx}`} className="card">
                <div className="card-title">
                  {issue.date}
                  <span className="text-secondary text-sm">
                    {' '}&mdash; {issue.kind === 'duplicate-sleep' ? 'Duplicate sleepData' : 'Stale roomTimeline'}
                  </span>
                </div>
                <p className="text-sm mb-8">{issue.summary}</p>
                <div className="form-group">
                  <label className="form-label">Action</label>
                  <div className="toggle-grid">
                    <button
                      className={`toggle-btn${action === 'keep' ? ' active' : ''}`}
                      onClick={() => setAction(idx, 'keep')}
                    >
                      Keep
                    </button>
                    <button
                      className={`toggle-btn${action === 'clear-sleepData' ? ' active' : ''}`}
                      onClick={() => setAction(idx, 'clear-sleepData')}
                      disabled={issue.kind !== 'duplicate-sleep'}
                    >
                      Clear sleepData
                    </button>
                    <button
                      className={`toggle-btn${action === 'clear-roomTimeline' ? ' active' : ''}`}
                      onClick={() => setAction(idx, 'clear-roomTimeline')}
                      disabled={issue.kind !== 'stale-room-timeline'}
                    >
                      Clear roomTimeline
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {confirmOpen ? (
            <div className="card">
              <div className="banner banner-warning">
                Apply {plannedChanges.length} change(s)?
                This will permanently null out the selected fields.
              </div>
              <div className="flex gap-8 mt-8">
                <button
                  className="btn btn-secondary"
                  style={{ flex: 1 }}
                  onClick={() => setConfirmOpen(false)}
                  disabled={isApplying}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-danger"
                  style={{ flex: 1 }}
                  onClick={handleApply}
                  disabled={isApplying}
                >
                  {isApplying ? 'Applying...' : 'Confirm & apply'}
                </button>
              </div>
            </div>
          ) : (
            <div className="card">
              <button
                className="btn btn-primary btn-full"
                disabled={plannedChanges.length === 0}
                onClick={() => setConfirmOpen(true)}
              >
                {plannedChanges.length === 0
                  ? 'No actions selected'
                  : `Apply ${plannedChanges.length} change(s)`}
              </button>
            </div>
          )}
        </>
      )}

      {status && (
        <div className="banner banner-success mt-16">{status}</div>
      )}
    </div>
  );
}

export { DataCleanupPage };
