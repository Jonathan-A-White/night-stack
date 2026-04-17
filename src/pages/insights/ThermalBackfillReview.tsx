import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import type { NightLog, ThermalComfort } from '../../types';
import {
  classifyThermalComfortFromWakes,
  resolveThermalCauseIds,
} from '../../services/thermalProxy';

/**
 * Historical-backfill review UI (backfill.md T3).
 *
 * One-time-ish screen: lists every unlabeled night, runs the proxy
 * classifier, and shows each row with a dropdown defaulting to the
 * proposed label. The user can override per-row, skip ("—"), or accept
 * as-is. "Apply labels" writes in a single bulk update and navigates
 * back.
 *
 * Q2 decision: this is the review-and-confirm flow (option b). We never
 * auto-apply proxy labels — the user consciously accepts each one so the
 * recommender doesn't get seeded with systematically-wrong labels.
 *
 * Q10 decision: when the user saves "—" on a row that had a proposed
 * label, we stamp `thermalProxyDismissed = true` so the row doesn't
 * re-appear next time. This is permanent; a future proxy-rule change
 * won't re-surface dismissed nights.
 */

type Selection = ThermalComfort | 'skip' | 'unchanged';

interface ReviewRow {
  log: NightLog;
  /** Proxy-proposed label. `null` means the classifier returned null (ambiguous). */
  proposed: ThermalComfort | null;
  /** User's current dropdown choice. */
  selection: Selection;
}

const LABEL_OPTIONS: { value: ThermalComfort; label: string }[] = [
  { value: 'just_right', label: 'Just right' },
  { value: 'too_hot', label: 'Too hot' },
  { value: 'too_cold', label: 'Too cold' },
  { value: 'mixed', label: 'Mixed' },
];

function describeProposed(
  label: ThermalComfort | null,
  isAmbiguous: boolean,
): string {
  if (isAmbiguous) return 'ambiguous';
  if (label == null) return '—';
  return LABEL_OPTIONS.find((o) => o.value === label)?.label ?? label;
}

export function ThermalBackfillReview() {
  const navigate = useNavigate();

  const unlabeledLogs = useLiveQuery(
    async () => {
      // Only nights that still need a label AND the user hasn't previously
      // dismissed. `thermalProxyDismissed` is a sticky "no thanks" from a
      // prior pass (T6).
      const all = await db.nightLogs.orderBy('date').reverse().toArray();
      return all.filter(
        (l) => l.thermalComfort == null && !l.thermalProxyDismissed,
      );
    },
    [],
  );

  const wakeUpCauses = useLiveQuery(() => db.wakeUpCauses.toArray(), []);

  const alreadyLabeled = useLiveQuery(
    async () => {
      const all = await db.nightLogs.orderBy('date').reverse().toArray();
      return all.filter((l) => l.thermalComfort != null);
    },
    [],
  );

  const causeIds = useMemo(() => {
    if (!wakeUpCauses) return null;
    return resolveThermalCauseIds(wakeUpCauses);
  }, [wakeUpCauses]);

  /**
   * Initial rows: proposals computed once from the classifier, selections
   * defaulted to the proposal (or 'skip' when ambiguous). We keep this in
   * component state so the user's edits survive re-renders from the
   * live-query updating on save.
   */
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Seed rows the first time data is ready. We don't re-seed on subsequent
  // live-query updates because that would clobber the user's in-progress
  // dropdown edits. After "Apply labels" completes, we reset state and
  // let the query re-seed the new, smaller list.
  if (rows === null && unlabeledLogs && causeIds) {
    const seeded: ReviewRow[] = unlabeledLogs.map((log) => {
      const proposed = classifyThermalComfortFromWakes(
        log,
        causeIds.hot,
        causeIds.cold,
      );
      return {
        log,
        proposed,
        // Default selection mirrors the proposal. Ambiguous rows default
        // to 'skip' so the user has to consciously pick a label.
        selection: proposed ?? 'skip',
      };
    });
    setRows(seeded);
  }

  function updateRow(id: string, selection: Selection) {
    setRows((prev) =>
      prev
        ? prev.map((r) => (r.log.id === id ? { ...r, selection } : r))
        : prev,
    );
  }

  async function handleApply() {
    if (!rows) return;
    setSaving(true);
    setSaveMessage(null);

    const now = Date.now();
    let applied = 0;
    let dismissed = 0;

    // Bulk-apply within a single Dexie transaction for atomicity: either
    // every row lands or none do, so a partial failure doesn't leave the
    // user with a half-labeled dataset.
    await db.transaction('rw', db.nightLogs, async () => {
      for (const row of rows) {
        if (row.selection === 'unchanged') continue;

        if (row.selection === 'skip') {
          // Only count as a dismissal when the classifier actually had a
          // proposal to begin with. Skipping an already-ambiguous row is
          // a no-op — we'd set dismissed for no reason otherwise, which
          // matters if the rule later changes and starts producing a
          // proposal (even though Q10 is "never re-surface", we should
          // still be precise about which rows the user saw a suggestion
          // for).
          if (row.proposed != null) {
            await db.nightLogs.update(row.log.id, {
              thermalProxyDismissed: true,
              updatedAt: now,
            });
            dismissed += 1;
          }
          continue;
        }

        // A concrete label selection. Source is:
        //   - 'proxy' when the user accepted the proposal as-is
        //   - 'user'  when the user changed the dropdown away from the
        //             proposal (their choice, not the classifier's)
        const userOverrode = row.selection !== row.proposed;
        await db.nightLogs.update(row.log.id, {
          thermalComfort: row.selection,
          thermalComfortSource: userOverrode ? 'user' : 'proxy',
          updatedAt: now,
        });
        applied += 1;
      }
    });

    // Reset local state so the live-query reseeds from the post-update
    // table. The "unlabeled" set is smaller now; ambiguous-skipped rows
    // are filtered out by `thermalProxyDismissed`.
    setRows(null);
    setSaving(false);
    setSaveMessage(
      `Applied ${applied} label${applied === 1 ? '' : 's'}` +
        (dismissed > 0 ? `, dismissed ${dismissed}` : '') +
        '.',
    );
  }

  if (!unlabeledLogs || !causeIds || !wakeUpCauses) {
    return (
      <div className="empty-state">
        <h3>Loading…</h3>
      </div>
    );
  }

  const pending = rows ?? [];
  const alreadyLabeledCount = alreadyLabeled?.length ?? 0;
  const hasAnyChange = pending.some(
    (r) => r.selection !== 'unchanged' &&
      !(r.selection === 'skip' && r.proposed == null),
  );

  return (
    <div>
      <div className="page-header">
        <h1>Label past nights</h1>
        <p className="subtitle">
          Review proxy-derived thermal comfort labels for historical nights.
        </p>
      </div>

      <div className="card">
        <div className="text-secondary text-sm">
          We infer a thermal-comfort label from each night's wake-up causes
          and sleep score. Accept the proposal, change it, or leave "—" to
          skip (skipped nights won't re-appear).
        </div>
      </div>

      {saveMessage && (
        <div className="banner banner-success mb-8">{saveMessage}</div>
      )}

      {pending.length === 0 ? (
        <div className="empty-state">
          <h3>Nothing to review</h3>
          <p>
            {alreadyLabeledCount > 0
              ? `All nights are either labeled (${alreadyLabeledCount}) or previously dismissed.`
              : 'Log some nights first.'}
          </p>
          <button
            className="btn btn-secondary mt-16"
            onClick={() => navigate('/insights')}
          >
            Back to Insights
          </button>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="card-title">
              {pending.length} unlabeled night{pending.length === 1 ? '' : 's'}
            </div>
            {pending.map((row) => {
              const isAmbiguous = row.proposed == null;
              return (
                <div
                  key={row.log.id}
                  className="summary-row"
                  style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}
                >
                  <div className="flex items-center gap-8" style={{ justifyContent: 'space-between' }}>
                    <div>
                      <div className="fw-600">{row.log.date}</div>
                      <div className="text-secondary text-sm">
                        Proposed: {describeProposed(row.proposed, isAmbiguous)}
                      </div>
                    </div>
                    <select
                      className="form-input"
                      style={{ maxWidth: 160 }}
                      value={row.selection}
                      onChange={(e) =>
                        updateRow(row.log.id, e.target.value as Selection)
                      }
                    >
                      <option value="skip">—</option>
                      {LABEL_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex gap-8 mt-16">
            <button
              className="btn btn-primary"
              onClick={handleApply}
              disabled={saving || !hasAnyChange}
            >
              {saving ? 'Applying…' : 'Apply labels'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => navigate('/insights')}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
