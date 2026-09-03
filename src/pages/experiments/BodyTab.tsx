import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import { addDaysToDate, getEveningLogDate, getTodayDate } from '../../utils';
import { formatWeight } from '../../weightUtils';
import { formatNeck, measurementsForNight, overnightDelta } from '../../services/bodyMeasurements';

const SODIUM_LABEL = { normal: 'normal', more: 'more salt', much_more: 'much more salt' } as const;

/** Experiments › Body: PM/AM weight and neck with overnight deltas, last 14 nights. */
export function BodyTab() {
  const navigate = useNavigate();
  const today = getTodayDate();
  const tonight = getEveningLogDate();
  const firstNight = addDaysToDate(today, -14);

  const rows = useLiveQuery(
    () => db.bodyMeasurements.where('date').between(firstNight, addDaysToDate(today, 1), true, true).toArray(),
    [firstNight, today],
  );
  const logs = useLiveQuery(
    () => db.nightLogs.where('date').between(firstNight, today, true, true).toArray(),
    [firstNight, today],
  );
  const settings = useLiveQuery(() => db.appSettings.get('default'));
  const unit = settings?.unitSystem ?? 'us';

  const nights: string[] = [];
  for (let d = tonight; d >= firstNight; d = addDaysToDate(d, -1)) nights.push(d);

  const fmtW = (v: number | null) => (v == null ? '—' : formatWeight(v, unit));
  const fmtN = (v: number | null) => (v == null ? '—' : formatNeck(v, unit));
  const fmtDelta = (v: number | null, f: (x: number) => string) => (v == null ? '—' : `${v > 0 ? '+' : ''}${f(v)}`);

  return (
    <div>
      <div className="page-header">
        <h1>Body</h1>
        <p className="subtitle">Weight and neck, bedtime vs morning</p>
      </div>

      <div className="flex gap-8 mb-16">
        <button type="button" className="btn btn-primary btn-full" style={{ minHeight: 56 }} onClick={() => navigate('/tonight/log')}>
          PM (evening log)
        </button>
        <button type="button" className="btn btn-primary btn-full" style={{ minHeight: 56 }} onClick={() => navigate('/morning')}>
          AM (morning log)
        </button>
      </div>

      <div className="card">
        <div className="card-title">Last 14 nights</div>
        <div style={{ overflowX: 'auto' }}>
          <table className="body-table">
            <thead>
              <tr>
                <th>Night</th>
                <th>Salt</th>
                <th>PM wt</th>
                <th>AM wt</th>
                <th>Δ wt</th>
                <th>PM neck</th>
                <th>AM neck</th>
                <th>Δ neck</th>
              </tr>
            </thead>
            <tbody>
              {nights.map((night) => {
                const m = measurementsForNight(night, rows ?? []);
                const log = logs?.find((l) => l.date === night);
                const hasAny = m.pmWeight || m.amWeight || m.pmNeck || m.amNeck;
                if (!hasAny && !log) return null;
                return (
                  <tr key={night} onClick={() => log && navigate(`/morning/review/${log.id}`)}>
                    <td>{night.slice(5)}</td>
                    <td>{log ? SODIUM_LABEL[log.eveningIntake.sodiumLevel] : '—'}</td>
                    <td>{fmtW(m.pmWeight?.value ?? null)}</td>
                    <td>{fmtW(m.amWeight?.value ?? null)}</td>
                    <td className="fw-600">{fmtDelta(overnightDelta('weight', night, rows ?? []), (x) => formatWeight(x, unit))}</td>
                    <td>{fmtN(m.pmNeck?.value ?? null)}</td>
                    <td>{fmtN(m.amNeck?.value ?? null)}</td>
                    <td className="fw-600">{fmtDelta(overnightDelta('neck', night, rows ?? []), (x) => formatNeck(x, unit))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-secondary text-sm">
        Long-term trend and units: <Link to="/settings/weight-profile">Settings › Weight Profile</Link>.
      </p>
    </div>
  );
}

export default BodyTab;
