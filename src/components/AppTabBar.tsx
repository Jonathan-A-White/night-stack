import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getApp, isSettingsPath, resolveAppForPath, writeLastApp, writeLastPath } from '../apps';

/**
 * Bottom tab bar for the active app. Replaces the old five-tab BottomTabs.
 * Also the single place that records "last app" and "last path per app"
 * so the switcher can restore where the user was.
 */
export function AppTabBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const appId = resolveAppForPath(location.pathname);
  const app = getApp(appId);

  useEffect(() => {
    if (isSettingsPath(location.pathname)) return;
    writeLastApp(appId);
    writeLastPath(appId, location.pathname);
  }, [appId, location.pathname]);

  const settingsActive = isSettingsPath(location.pathname);

  return (
    <nav className="bottom-tabs" aria-label="App tabs">
      {app.tabs.map((tab) => {
        const isSettings = tab.path === '/settings';
        let active: boolean;
        if (isSettings) {
          active = settingsActive;
        } else if (settingsActive) {
          active = false;
        } else {
          // Longest matching tab wins so /tonight/routine lights "Tracker"
          // rather than "Tonight" inside the Routine app.
          const matching = app.tabs
            .filter((t) => t.path !== '/settings')
            .filter((t) => location.pathname === t.path || location.pathname.startsWith(t.path + '/'))
            .sort((a, b) => b.path.length - a.path.length);
          active = matching[0]?.path === tab.path;
        }
        return (
          <button
            key={tab.path}
            type="button"
            className={`tab-button ${active ? 'active' : ''}`}
            onClick={() => navigate(tab.path)}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
