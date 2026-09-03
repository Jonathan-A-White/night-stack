import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import { addDaysToDate, getTodayDate } from '../../utils';
import { FLAG_LABELS, computeOrthostatic, formatBp } from '../../services/orthostatic';

/** Experiments › Vitals: today's AM/PM buttons and the last 14 days. */
export function VitalsTab() {
  const navigate = useNavigate();
  const today = getTodayDate();
  const since = addDaysToDate(today, -13);
  const readings = useLiveQuery(
    () => db.orthostaticReadings.where('date').between(since, today, true, true).reverse().sortBy('timestamp'),
    [since, today],
  );
  const settings = useLiveQuery(() => db.appSettings.get('default'));
  const calibratedAt = settings?.watchBpCalibratedAt ?? null;

  const todayAm = readings?.find((r) => r.date === today && r.slot === 'am');
  const todayPm = readings?.find((r) => r.date === today && r.slot === 'pm');

  return (
    <div>
      <div className="page-header">
        <h1>Vitals</h1>
        <p className="subtitle">Orthostatic readings, twice a day</p>
      </div>

      <div className="flex gap-8 mb-16">
        <button
          type="button"
          className={`btn btn-full ${todayAm ? 'btn-secondary' : 'btn-primary'}`}
          style={{ minHeight: 64 }}
          onClick={() => navigate('/experiments/vitals/new?slot=am')}
        >
          {todayAm ? 'AM ✓ (edit)' : 'AM reading'}
        </button>
        <button
          type="button"
          className={`btn btn-full ${todayPm ? 'btn-secondary' : 'btn-primary'}`}
          style={{ minHeight: 64 }}
          onClick={() => navigate('/experiments/vitals/new?slot=pm')}
        >
          {todayPm ? 'PM ✓ (edit)' : 'PM reading'}
        </button>
      </div>

      {readings && readings.length === 0 && (
        <div className="empty-state">
          <h3>No readings yet</h3>
          <p>Take the first one with the buttons above.</p>
        </div>
      )}

      {readings && readings.length > 0 && (
        <div className="card">
          <div className="card-title">Last 14 days</div>
          {readings.map((r) => {
            const d = computeOrthostatic(r, calibratedAt);
            return (
              <div
                key={r.id}
                className="list-item"
                style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}
                onClick={() => navigate(`/experiments/vitals/new?slot=${r.slot}&date=${r.date}`)}
              >
                <div className="flex items-center justify-between" style={{ width: '100%' }}>
                  <span className="fw-600">{r.date} · {r.slot.toUpperCase()}</span>
                  <span className="text-secondary text-sm">{r.source}{d.needsRecalibration ? ' · recalibrate' : ''}</span>
                </div>
                <div className="text-sm">
                  {formatBp(r.supine)} → {formatBp(r.standing1)} → {formatBp(r.standing3)}
                </div>
                {d.drop3 && (
                  <div className="text-secondary text-sm">
                    3 min: −{d.drop3.systolic}/−{d.drop3.diastolic}, pulse +{d.drop3.pulseRise}
                  </div>
                )}
                {d.flags.length > 0 && (
                  <div className="text-warning text-sm">
                    {d.flags.map((f) => FLAG_LABELS[f]).join(' · ')} — bring this to your doctor
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-secondary text-sm">
        Watch calibration and reminders live in <Link to="/settings/vitals">Settings › Vitals</Link>.
      </p>
    </div>
  );
}

export default VitalsTab;
