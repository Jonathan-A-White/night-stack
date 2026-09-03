import { useLocation, useNavigate } from 'react-router-dom';
import { APPS, homePathFor, readLastPath, resolveAppForPath, writeLastApp } from '../apps';

/**
 * Top-level segmented control between the three apps (Routine / Tracking /
 * Experiments). Tapping a segment navigates to that app's last-visited tab
 * or its home. The active segment follows the current route; on shared
 * Settings routes it follows the last-active app.
 */
export function AppSwitcher() {
  const navigate = useNavigate();
  const location = useLocation();
  const active = resolveAppForPath(location.pathname);

  return (
    <div className="app-switcher" role="group" aria-label="App">
      {APPS.map((app) => (
        <button
          key={app.id}
          type="button"
          className={`app-switcher-segment ${active === app.id ? 'active' : ''}`}
          aria-pressed={active === app.id}
          onClick={() => {
            writeLastApp(app.id);
            navigate(readLastPath(app.id) ?? homePathFor(app.id));
          }}
        >
          {app.label}
        </button>
      ))}
    </div>
  );
}
