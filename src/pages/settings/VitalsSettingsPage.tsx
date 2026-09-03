import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import { RECALIBRATION_DAYS } from '../../services/orthostatic';
import { toLocalDateString } from '../../utils';

/** Settings › Vitals: Galaxy Watch BP calibration date (Q3). */
export default function VitalsSettingsPage() {
  const settings = useLiveQuery(() => db.appSettings.get('default'));
  const calibratedAt = settings?.watchBpCalibratedAt ?? null;
  const ageDays = calibratedAt === null ? null : Math.floor((Date.now() - calibratedAt) / (24 * 60 * 60 * 1000));
  const stale = ageDays === null || ageDays > RECALIBRATION_DAYS;

  return (
    <div>
      <div className="page-header">
        <Link to="/settings" className="text-accent" style={{ textDecoration: 'none', fontSize: 14 }}>
          ‹ Settings
        </Link>
        <h1>Vitals</h1>
      </div>

      <div className="card">
        <div className="card-title">Galaxy Watch BP calibration</div>
        <div className="summary-row">
          <span className="summary-label">Last calibrated</span>
          <span className={`summary-value ${stale ? 'text-warning' : 'text-success'}`}>
            {calibratedAt === null ? 'never recorded' : `${toLocalDateString(new Date(calibratedAt))} (${ageDays} d ago)`}
          </span>
        </div>
        <p className="text-secondary text-sm mb-8">
          Watch readings taken more than {RECALIBRATION_DAYS} days after a cuff calibration are marked "recalibrate" in the
          list and the clinician export.
        </p>
        <button
          type="button"
          className="btn btn-primary btn-full"
          onClick={() => db.appSettings.update('default', { watchBpCalibratedAt: Date.now() })}
        >
          Calibrated today
        </button>
      </div>

      <div className="card">
        <div className="card-title">Reminders</div>
        <Link to="/settings/reminders" className="btn btn-secondary btn-full">
          AM / PM reading reminders
        </Link>
      </div>
    </div>
  );
}

export { VitalsSettingsPage };
