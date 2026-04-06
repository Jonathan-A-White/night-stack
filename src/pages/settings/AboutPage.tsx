import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';

export default function AboutPage() {
  const settings = useLiveQuery(() => db.appSettings.get('default'));

  if (!settings) {
    return <div className="empty-state"><h3>Loading...</h3></div>;
  }

  const handleToggleDarkMode = async () => {
    await db.appSettings.update('default', { darkMode: !settings.darkMode });
  };

  return (
    <div>
      <div className="page-header">
        <Link to="/settings" className="text-accent" style={{ textDecoration: 'none', fontSize: 14 }}>
          &lsaquo; Settings
        </Link>
        <h1>About</h1>
      </div>

      <div className="card">
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div className="fs-20 fw-600">NightStack</div>
          <div className="text-secondary text-sm">Version 1.0.0</div>
        </div>
        <p className="text-secondary text-sm" style={{ lineHeight: 1.6 }}>
          NightStack is a personal sleep optimization PWA. It tracks your nightly routine, supplement stack, sleep environment, and sleep data to help you identify patterns and improve sleep quality over time.
        </p>
      </div>

      <div className="card">
        <div className="card-title">Appearance</div>
        <div className="switch-row">
          <span className="fw-600">Dark Mode</span>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.darkMode}
              onChange={handleToggleDarkMode}
            />
            <span className="switch-slider" />
          </label>
        </div>
      </div>
    </div>
  );
}

export { AboutPage };
