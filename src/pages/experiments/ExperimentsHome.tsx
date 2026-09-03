import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import { addDaysToDate, getTodayDate } from '../../utils';
import { buildNightMetricCtx } from '../../services/nightMetrics';
import { loadEpisodeDraft } from './episodeDraftStorage';

const SALT = { normal: '·', more: '🧂', much_more: '🧂🧂' } as const;
const POS = { side: 'S', back: 'B', unknown: '?' } as const;

/** Last 7 nights × (salt, position, Δwt, Δneck, episode, flags); tap → review. */
function RecentNightsGrid() {
  const navigate = useNavigate();
  const today = getTodayDate();
  const since = addDaysToDate(today, -7);
  const logs = useLiveQuery(() => db.nightLogs.where('date').between(since, today, true, true).reverse().sortBy('date'), [since, today]);
  const bodyRows = useLiveQuery(() => db.bodyMeasurements.where('date').between(since, addDaysToDate(today, 1), true, true).toArray(), [since, today]);
  const readings = useLiveQuery(() => db.orthostaticReadings.where('date').between(since, addDaysToDate(today, 1), true, true).toArray(), [since, today]);
  const settings = useLiveQuery(() => db.appSettings.get('default'));
  if (!logs || logs.length === 0) return null;
  const calibratedAt = settings?.watchBpCalibratedAt ?? null;
  const fmt = (v: number | null, unit: string) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}${unit}`);
  return (
    <div className="card">
      <div className="card-title">Last 7 nights</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="body-table">
          <thead>
            <tr><th>Night</th><th>Salt</th><th>Pos</th><th>Δ wt</th><th>Δ neck</th><th>⚡</th><th>Flags</th></tr>
          </thead>
          <tbody>
            {logs.map((log) => {
              const ctx = buildNightMetricCtx(log, bodyRows ?? [], readings ?? [], calibratedAt);
              const episodes = log.wakeUpEvents.filter((e) => e.source === 'episode').length;
              const flags = (ctx.ortho.am?.flags.length ?? 0) + (ctx.ortho.pm?.flags.length ?? 0);
              return (
                <tr key={log.id} onClick={() => navigate(`/morning/review/${log.id}`)}>
                  <td>{log.date.slice(5)}</td>
                  <td>{SALT[log.eveningIntake.sodiumLevel]}</td>
                  <td>{POS[log.positionStarted]}→{POS[log.positionAtWake]}</td>
                  <td>{fmt(ctx.body.weightDeltaLbs, '')}</td>
                  <td>{fmt(ctx.body.neckDeltaIn, '')}</td>
                  <td className={episodes > 0 || log.wiredWake ? 'text-warning fw-600' : ''}>{episodes > 0 ? episodes : log.wiredWake ? 'w' : '·'}</td>
                  <td className={flags > 0 ? 'text-warning fw-600' : ''}>{flags > 0 ? flags : '·'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex gap-8 mt-8" style={{ flexWrap: 'wrap' }}>
        <Link to="/insights/metric/weightDelta" className="btn btn-secondary btn-sm">Weight Δ</Link>
        <Link to="/insights/metric/neckDelta" className="btn btn-secondary btn-sm">Neck Δ</Link>
        <Link to="/insights/metric/orthoAm" className="btn btn-secondary btn-sm">AM drop</Link>
        <Link to="/insights/metric/episodes" className="btn btn-secondary btn-sm">Episodes</Link>
        <Link to="/insights/correlations" className="btn btn-secondary btn-sm">Correlations</Link>
      </div>
    </div>
  );
}

/**
 * Experiments app home. The Episode button is the one-tap entry for the
 * 4am flow (episode-capture.md); the status cards below are filled in by
 * the vitals, body-measurements and insights workstreams.
 */
export function ExperimentsHome() {
  const navigate = useNavigate();
  const [draft] = useState(() => loadEpisodeDraft());
  return (
    <div>
      <div className="page-header">
        <h1>Experiments</h1>
        <p className="subtitle">Home measurements for the 4am wake-ups</p>
      </div>

      {draft && draft.step <= 5 && (
        <div className="card">
          <div className="card-title">Unfinished episode</div>
          <p className="text-secondary text-sm mb-8">
            An episode from the night of {draft.nightDate} still has optional details to fill in.
          </p>
          <button type="button" className="btn btn-secondary btn-full" onClick={() => navigate('/experiments/episode')}>
            Finish episode details
          </button>
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary btn-full episode-button"
        onClick={() => navigate('/experiments/episode')}
      >
        ⚡ Episode now
      </button>
      <p className="text-secondary text-sm mb-16">
        One tap saves the time. Details are optional and can wait until morning.
      </p>

      <RecentNightsGrid />

      <div className="card">
        <div className="card-title">Today</div>
        <div className="summary-row">
          <span className="summary-label">Orthostatic vitals</span>
          <Link to="/experiments/vitals" className="text-accent" style={{ textDecoration: 'none' }}>Open ›</Link>
        </div>
        <div className="summary-row">
          <span className="summary-label">Weight and neck</span>
          <Link to="/experiments/body" className="text-accent" style={{ textDecoration: 'none' }}>Open ›</Link>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Data</div>
        <div className="summary-row">
          <span className="summary-label">Samsung Health bulk import</span>
          <Link to="/experiments/import" className="text-accent" style={{ textDecoration: 'none' }}>Open ›</Link>
        </div>
        <div className="summary-row">
          <span className="summary-label">Export for doctor</span>
          <Link to="/experiments/export" className="text-accent" style={{ textDecoration: 'none' }}>Open ›</Link>
        </div>
      </div>
    </div>
  );
}

export default ExperimentsHome;
