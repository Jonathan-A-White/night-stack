import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { WeighInPeriod } from '../types';
import {
  formatWeight,
  recalculateCalculatedWeights,
  roundWeightLbs,
} from '../weightUtils';
import { WeightStepper } from './WeightStepper';

interface WeightEditCardProps {
  nightLogId: string;
  period: WeighInPeriod;
}

/**
 * Shown on the review pages. Loads the WeightEntry linked to this night log
 * for the given period. Allows editing the value: saving writes the new
 * weight, marks the entry measured, and triggers a full recalculation of
 * calculated entries anchored on this edit.
 */
export function WeightEditCard({ nightLogId, period }: WeightEditCardProps) {
  const entry = useLiveQuery(
    () =>
      db.weightEntries
        .where('nightLogId')
        .equals(nightLogId)
        .filter((e) => e.period === period)
        .first(),
    [nightLogId, period],
  );

  const settings = useLiveQuery(() => db.appSettings.get('default'));
  const unitSystem = settings?.unitSystem ?? 'us';

  const [editing, setEditing] = useState(false);
  const [draftLbs, setDraftLbs] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Seed the draft from the loaded entry when entering edit mode.
  useEffect(() => {
    if (editing && entry && draftLbs === null) {
      setDraftLbs(entry.weightLbs);
    }
  }, [editing, entry, draftLbs]);

  if (entry === undefined) {
    // Query still loading — render nothing to avoid flicker.
    return null;
  }

  if (entry === null) {
    // No weight entry exists for this night + period; nothing to edit here.
    return null;
  }

  const label = period === 'morning' ? 'Morning Weight' : 'Evening Weight';

  function beginEdit() {
    if (!entry) return;
    setDraftLbs(entry.weightLbs);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDraftLbs(null);
  }

  async function saveEdit() {
    if (!entry || draftLbs == null) return;
    setSaving(true);
    try {
      const rounded = roundWeightLbs(draftLbs, 'us');
      // Write the edit: new weight, promoted to measured.
      await db.weightEntries.update(entry.id, {
        weightLbs: rounded,
        measured: true,
      });

      // Re-anchor the timeline around this edit: calculated entries between
      // the previous measurement and this edit (and between this edit and the
      // next measurement) get re-interpolated.
      const all = await db.weightEntries.toArray();
      const recalculated = recalculateCalculatedWeights(all, entry.id);
      await db.weightEntries.bulkPut(recalculated);

      setEditing(false);
      setDraftLbs(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <div className="card-title">{label}</div>

      {!editing && (
        <>
          <div className="summary-row">
            <span className="summary-label">Weight</span>
            <span className="summary-value text-accent">
              {formatWeight(entry.weightLbs, unitSystem)}
              {!entry.measured && (
                <span className="text-secondary text-sm"> (calculated)</span>
              )}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-full mt-8"
            onClick={beginEdit}
          >
            Edit weight
          </button>
        </>
      )}

      {editing && draftLbs != null && (
        <>
          <WeightStepper
            valueLbs={draftLbs}
            onChange={setDraftLbs}
            unitSystem={unitSystem}
            helpText="Hold +/- to move faster"
          />
          <div className="flex gap-8 mt-8">
            <button
              type="button"
              className="btn btn-secondary"
              style={{ flex: 1 }}
              onClick={cancelEdit}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              style={{ flex: 1 }}
              onClick={saveEdit}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
          {!entry.measured && (
            <div className="text-secondary text-sm mt-8" style={{ textAlign: 'center' }}>
              Saving will promote this entry from calculated to measured and
              re-interpolate surrounding days.
            </div>
          )}
        </>
      )}
    </div>
  );
}
