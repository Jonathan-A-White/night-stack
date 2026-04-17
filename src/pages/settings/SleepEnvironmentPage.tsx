import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';

/**
 * Sleep Environment settings — currently just a toggle for whether a
 * window AC is installed. The evening log reads this flag to decide
 * whether to surface the AC sleep-curve / setpoint inputs; fan speed
 * stays visible either way because a user can run a standalone fan
 * without AC.
 *
 * Kept on its own page (rather than folding into LocationPage or a
 * generic "environment" grab-bag) so future hardware toggles
 * (humidifier, space heater, ceiling fan, etc.) have a home without
 * cluttering unrelated settings.
 */
export default function SleepEnvironmentPage() {
  const settings = useLiveQuery(() => db.appSettings.get('default'));

  if (!settings) {
    return <div className="empty-state"><h3>Loading...</h3></div>;
  }

  const acInstalled = settings.acInstalled ?? false;

  const handleToggleAc = async () => {
    // Flipping from false → true stamps a one-time-tip flag that the
    // evening log reads to show a "your AC fields will start feeding
    // the recommender soon" hint above the AC card. That flag is stored
    // in localStorage so it doesn't bloat the settings schema.
    const next = !acInstalled;
    if (next) {
      try {
        localStorage.setItem('ac-installed-tip-pending', '1');
      } catch {
        // localStorage can be disabled — tip just doesn't show, not a bug.
      }
    }
    await db.appSettings.update('default', { acInstalled: next });
  };

  return (
    <div>
      <div className="page-header">
        <Link to="/settings" className="text-accent" style={{ textDecoration: 'none', fontSize: 14 }}>
          &lsaquo; Settings
        </Link>
        <h1>Sleep Environment</h1>
        <p className="subtitle">Hardware that affects your overnight thermal signal</p>
      </div>

      <div className="card">
        <div className="switch-row">
          <span className="fw-600">Window AC installed</span>
          <label className="switch">
            <input
              type="checkbox"
              checked={acInstalled}
              onChange={handleToggleAc}
            />
            <span className="switch-slider" />
          </label>
        </div>
        <p className="text-secondary text-sm mt-8">
          Enables the AC sleep-curve inputs on the evening log. Leave off
          until the window AC is actually installed — empty AC fields
          only add noise to the recommender.
        </p>
      </div>
    </div>
  );
}

export { SleepEnvironmentPage };
