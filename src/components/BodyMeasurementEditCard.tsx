import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { BodyMeasurementKind, WeighInPeriod } from '../types';
import { formatWeight, recalculateCalculatedMeasurements, roundWeightLbs } from '../weightUtils';
import { formatNeck, roundMeasurement } from '../services/bodyMeasurements';
import { WeightStepper } from './WeightStepper';
import { NeckStepper } from './NeckStepper';

interface Props {
  nightLogId: string;
  period: WeighInPeriod;
  kind: BodyMeasurementKind;
}

/**
 * Review-page card for one measurement (weight or neck) linked to a night.
 * Replaces `WeightEditCard`. Saving promotes the row to measured and, for
 * weight, re-interpolates the surrounding calculated rows.
 */
export function BodyMeasurementEditCard({ nightLogId, period, kind }: Props) {
  const entry = useLiveQuery(
    () =>
      db.bodyMeasurements
        .where('nightLogId')
        .equals(nightLogId)
        .filter((e) => e.period === period && e.kind === kind)
        .first(),
    [nightLogId, period, kind],
  );
  const settings = useLiveQuery(() => db.appSettings.get('default'));
  const unitSystem = settings?.unitSystem ?? 'us';

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  if (!entry) return null;

  const title = `${period === 'morning' ? 'Morning' : 'Evening'} ${kind === 'weight' ? 'Weight' : 'Neck'}`;
  const format = (v: number) => (kind === 'weight' ? formatWeight(v, unitSystem) : formatNeck(v, unitSystem));

  async function saveEdit() {
    if (!entry || draft == null) return;
    setSaving(true);
    try {
      const rounded = kind === 'weight' ? roundWeightLbs(draft, 'us') : roundMeasurement('neck', draft);
      await db.bodyMeasurements.update(entry.id, { value: rounded, measured: true });
      if (kind === 'weight') {
        const all = await db.bodyMeasurements.where('kind').equals('weight').toArray();
        await db.bodyMeasurements.bulkPut(recalculateCalculatedMeasurements(all, entry.id));
      }
      setEditing(false);
      setDraft(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <div className="card-title">{title}</div>
      {!editing && (
        <>
          <div className="summary-row">
            <span className="summary-label">{kind === 'weight' ? 'Weight' : 'Neck'}</span>
            <span className="summary-value text-accent">
              {format(entry.value)}
              {!entry.measured && <span className="text-secondary text-sm"> (calculated)</span>}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-full mt-8"
            onClick={() => {
              setDraft(entry.value);
              setEditing(true);
            }}
          >
            Edit
          </button>
        </>
      )}
      {editing && draft != null && (
        <>
          {kind === 'weight' ? (
            <WeightStepper valueLbs={draft} onChange={setDraft} unitSystem={unitSystem} helpText="Hold +/- to move faster" />
          ) : (
            <NeckStepper valueIn={draft} onChange={setDraft} unitSystem={unitSystem} helpText="Hold +/- to move faster" />
          )}
          <div className="flex gap-8 mt-8">
            <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => { setEditing(false); setDraft(null); }} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={saveEdit} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
