import { describe, it, expect, beforeEach } from 'vitest';
import {
  APPS,
  resolveAppForPath,
  readLastApp,
  writeLastApp,
  readLastPath,
  writeLastPath,
  homePathFor,
  isSettingsPath,
} from '../apps';

const V11_ROUTES = [
  '/tonight', '/tonight/log', '/tonight/review/abc', '/tonight/routine',
  '/morning', '/morning/review/abc', '/morning/room-conditions/abc',
  '/calendar',
  '/insights', '/insights/correlations', '/insights/thermal-fit',
  '/insights/best-nights', '/insights/metric/score', '/insights/backfill',
  '/settings', '/settings/evening-routine', '/settings/alarm-schedule',
  '/settings/supplements', '/settings/clothing', '/settings/bedding',
  '/settings/midday-coping', '/settings/wake-up-causes',
  '/settings/bedtime-reasons', '/settings/sleep-rules', '/settings/location',
  '/settings/sleep-environment', '/settings/weight-profile', '/settings/data',
  '/settings/data/cleanup', '/settings/about',
];

describe('app registry', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defines exactly three apps with a Settings tab last in each', () => {
    expect(APPS.map((a) => a.id)).toEqual(['routine', 'tracking', 'experiments']);
    for (const app of APPS) {
      const last = app.tabs[app.tabs.length - 1];
      expect(last.path).toBe('/settings');
      expect(last.label).toBe('Settings');
    }
  });

  it('resolves every v11 route to an app (settings falls back to the last-active app)', () => {
    writeLastApp('routine');
    for (const route of V11_ROUTES) {
      const app = resolveAppForPath(route);
      expect(app, route).toBeDefined();
      if (isSettingsPath(route)) {
        expect(app, route).toBe('routine');
      }
    }
    expect(resolveAppForPath('/tonight/routine')).toBe('routine');
    expect(resolveAppForPath('/tonight')).toBe('tracking');
    expect(resolveAppForPath('/tonight/log')).toBe('tracking');
    expect(resolveAppForPath('/morning/review/x')).toBe('tracking');
    expect(resolveAppForPath('/calendar')).toBe('tracking');
    expect(resolveAppForPath('/insights/metric/score')).toBe('tracking');
  });

  it('resolves experiments and routine routes', () => {
    expect(resolveAppForPath('/experiments')).toBe('experiments');
    expect(resolveAppForPath('/experiments/vitals/new')).toBe('experiments');
    expect(resolveAppForPath('/experiments/episode')).toBe('experiments');
    expect(resolveAppForPath('/routine')).toBe('routine');
  });

  it('settings path with no remembered app defaults to tracking', () => {
    expect(resolveAppForPath('/settings/about')).toBe('tracking');
  });

  it('remembers the last app and last path per app', () => {
    expect(readLastApp()).toBe('tracking');
    writeLastApp('experiments');
    expect(readLastApp()).toBe('experiments');

    expect(readLastPath('tracking')).toBeNull();
    writeLastPath('tracking', '/insights/correlations');
    expect(readLastPath('tracking')).toBe('/insights/correlations');
    // Settings paths are never remembered as an app's last path.
    writeLastPath('tracking', '/settings/data');
    expect(readLastPath('tracking')).toBe('/insights/correlations');
  });

  it('ignores garbage in localStorage', () => {
    localStorage.setItem('nightstack-app', 'bogus');
    localStorage.setItem('nightstack-app-last-path', '{not json');
    expect(readLastApp()).toBe('tracking');
    expect(readLastPath('routine')).toBeNull();
  });

  it('home paths', () => {
    expect(homePathFor('routine')).toBe('/routine');
    expect(homePathFor('tracking')).toBe('/tonight');
    expect(homePathFor('experiments')).toBe('/experiments');
  });
});
