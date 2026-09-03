import { Link, useNavigate } from 'react-router-dom';

/**
 * Experiments app home. The Episode button is the one-tap entry for the
 * 4am flow (episode-capture.md); the status cards below are filled in by
 * the vitals, body-measurements and insights workstreams.
 */
export function ExperimentsHome() {
  const navigate = useNavigate();
  return (
    <div>
      <div className="page-header">
        <h1>Experiments</h1>
        <p className="subtitle">Home measurements for the 4am wake-ups</p>
      </div>

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
