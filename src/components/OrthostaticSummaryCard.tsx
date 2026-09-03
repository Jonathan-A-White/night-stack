import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { FLAG_LABELS, computeOrthostatic, formatBp, readingsForNight } from '../services/orthostatic';
import type { OrthostaticReading } from '../types';

/**
 * Read-only card for the Tracking review pages: the PM reading of the
 * evening and the AM reading of the morning after. Hidden when neither
 * exists (vitals.md open question, default hide).
 */
export function OrthostaticSummaryCard({ nightDate }: { nightDate: string }) {
  const all = useLiveQuery(() => db.orthostaticReadings.toArray(), []);
  const settings = useLiveQuery(() => db.appSettings.get('default'));
  if (!all) return null;
  const { am, pm } = readingsForNight(nightDate, all);
  if (!am && !pm) return null;
  const calibratedAt = settings?.watchBpCalibratedAt ?? null;

  const row = (label: string, r: OrthostaticReading | null) => {
    if (!r) return null;
    const d = computeOrthostatic(r, calibratedAt);
    return (
      <div className="summary-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
        <span className="summary-label">{label} · {r.source}</span>
        <span className="text-sm">{formatBp(r.supine)} → {formatBp(r.standing1)} → {formatBp(r.standing3)}</span>
        {d.flags.length > 0 && (
          <span className="text-warning text-sm">{d.flags.map((f) => FLAG_LABELS[f]).join(' · ')} — bring this to your doctor</span>
        )}
      </div>
    );
  };

  return (
    <div className="card">
      <div className="card-title">Orthostatic vitals</div>
      {row('PM (evening)', pm)}
      {row('AM (next morning)', am)}
    </div>
  );
}
