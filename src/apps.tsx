import type { ReactNode } from 'react';

/**
 * Three-apps-within-the-app registry (specs/home-experiments/app-shell.md,
 * Q1). Existing routes are NOT moved: each app is a group of route
 * prefixes with its own tab bar, and Settings is shared by all three.
 */
export type AppId = 'routine' | 'tracking' | 'experiments';

export interface AppTab {
  path: string;
  label: string;
  icon: ReactNode;
}

export interface AppDef {
  id: AppId;
  label: string;
  home: string;
  /** Route prefixes that belong to this app (longest prefix wins). */
  prefixes: string[];
  tabs: AppTab[];
}

const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

const ICONS = {
  moon: svg(<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />),
  sun: svg(<>
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </>),
  calendar: svg(<>
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
  </>),
  chart: svg(<>
    <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
  </>),
  gear: svg(<>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </>),
  play: svg(<polygon points="5 3 19 12 5 21 5 3" />),
  timer: svg(<><circle cx="12" cy="13" r="8" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="10" y1="2" x2="14" y2="2" /></>),
  home: svg(<><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></>),
  heart: svg(<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />),
  scale: svg(<><path d="M12 3v18" /><path d="M5 7h14" /><path d="M3 13l2-6 2 6a2 2 0 0 1-4 0z" /><path d="M17 13l2-6 2 6a2 2 0 0 1-4 0z" /></>),
  upload: svg(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></>),
};

const SETTINGS_TAB: AppTab = { path: '/settings', label: 'Settings', icon: ICONS.gear };

export const APPS: AppDef[] = [
  {
    id: 'routine',
    label: 'Routine',
    home: '/routine',
    prefixes: ['/routine', '/tonight/routine'],
    tabs: [
      { path: '/routine', label: 'Start', icon: ICONS.play },
      { path: '/tonight/routine', label: 'Tracker', icon: ICONS.timer },
      SETTINGS_TAB,
    ],
  },
  {
    id: 'tracking',
    label: 'Tracking',
    home: '/tonight',
    prefixes: ['/tonight', '/morning', '/calendar', '/insights'],
    tabs: [
      { path: '/tonight', label: 'Tonight', icon: ICONS.moon },
      { path: '/morning', label: 'Morning', icon: ICONS.sun },
      { path: '/calendar', label: 'Calendar', icon: ICONS.calendar },
      { path: '/insights', label: 'Insights', icon: ICONS.chart },
      SETTINGS_TAB,
    ],
  },
  {
    id: 'experiments',
    label: 'Experiments',
    home: '/experiments',
    prefixes: ['/experiments'],
    tabs: [
      { path: '/experiments', label: 'Home', icon: ICONS.home },
      { path: '/experiments/vitals', label: 'Vitals', icon: ICONS.heart },
      { path: '/experiments/body', label: 'Body', icon: ICONS.scale },
      { path: '/experiments/import', label: 'Import', icon: ICONS.upload },
      SETTINGS_TAB,
    ],
  },
];

const APP_BY_ID: Record<AppId, AppDef> = Object.fromEntries(APPS.map((a) => [a.id, a])) as Record<AppId, AppDef>;

export function getApp(id: AppId): AppDef {
  return APP_BY_ID[id];
}

export function homePathFor(id: AppId): string {
  return APP_BY_ID[id].home;
}

export function isSettingsPath(pathname: string): boolean {
  return pathname === '/settings' || pathname.startsWith('/settings/');
}

function prefixMatches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + '/');
}

/**
 * Which app a pathname belongs to. Longest matching prefix wins so
 * `/tonight/routine` is Routine while `/tonight` is Tracking. Settings is
 * shared and resolves to the last-active app. Unknown paths also fall back
 * to the last-active app so the shell never renders without a tab bar.
 */
export function resolveAppForPath(pathname: string): AppId {
  if (isSettingsPath(pathname)) return readLastApp();
  let best: { id: AppId; len: number } | null = null;
  for (const app of APPS) {
    for (const prefix of app.prefixes) {
      if (prefixMatches(pathname, prefix) && (!best || prefix.length > best.len)) {
        best = { id: app.id, len: prefix.length };
      }
    }
  }
  return best ? best.id : readLastApp();
}

// --- localStorage memory (best-effort; private mode / quota tolerated) ---

export const LAST_APP_KEY = 'nightstack-app';
export const LAST_PATH_KEY = 'nightstack-app-last-path';

function isAppId(v: unknown): v is AppId {
  return v === 'routine' || v === 'tracking' || v === 'experiments';
}

export function readLastApp(): AppId {
  try {
    const raw = localStorage.getItem(LAST_APP_KEY);
    return isAppId(raw) ? raw : 'tracking';
  } catch {
    return 'tracking';
  }
}

export function writeLastApp(id: AppId): void {
  try {
    localStorage.setItem(LAST_APP_KEY, id);
  } catch {
    // best-effort
  }
}

function readPathMap(): Partial<Record<AppId, string>> {
  try {
    const raw = localStorage.getItem(LAST_PATH_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Partial<Record<AppId, string>>) : {};
  } catch {
    return {};
  }
}

export function readLastPath(id: AppId): string | null {
  const v = readPathMap()[id];
  return typeof v === 'string' && v.startsWith('/') ? v : null;
}

/** Remember the last non-settings path visited inside an app. */
export function writeLastPath(id: AppId, pathname: string): void {
  if (isSettingsPath(pathname)) return;
  try {
    const map = readPathMap();
    map[id] = pathname;
    localStorage.setItem(LAST_PATH_KEY, JSON.stringify(map));
  } catch {
    // best-effort
  }
}
