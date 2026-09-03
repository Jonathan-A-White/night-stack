import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { db, seedDatabase } from '../db';
import { App } from '../App';
import { createBlankNightLog, createBlankWakeUpEvent } from '../utils';

/**
 * Pack acceptance 1 + 4 (specs/home-experiments/README.md): every route
 * that existed at v11 plus every new Experiments route renders on a
 * seeded database with realistic data — no thrown render, no blank
 * screen — and the app shell (switcher + tab bar) is present on each.
 */

const ROUTES = [
  '/', '/routine', '/tonight', '/tonight/log', '/tonight/routine',
  '/morning', '/calendar',
  '/insights', '/insights/correlations', '/insights/thermal-fit', '/insights/best-nights',
  '/insights/metric/score', '/insights/metric/weightDelta', '/insights/metric/orthoAm', '/insights/backfill',
  '/experiments', '/experiments/episode', '/experiments/vitals', '/experiments/vitals/new?slot=am',
  '/experiments/body', '/experiments/import', '/experiments/export', '/experiments/export/print',
  '/settings', '/settings/evening-routine', '/settings/alarm-schedule', '/settings/supplements',
  '/settings/clothing', '/settings/bedding', '/settings/midday-coping', '/settings/wake-up-causes',
  '/settings/bedtime-reasons', '/settings/sleep-rules', '/settings/location', '/settings/sleep-environment',
  '/settings/weight-profile', '/settings/reminders', '/settings/vitals', '/settings/data',
  '/settings/data/cleanup', '/settings/about',
];

const ALARM = { expectedAlarmTime: '04:43', actualAlarmTime: '04:43', isOverridden: false, targetBedtime: '21:13', eatingCutoff: '18:43', supplementTime: '20:28' };

describe('every route renders on a seeded database', () => {
  beforeEach(async () => {
    cleanup();
    localStorage.clear();
    await db.delete();
    await db.open();
    await seedDatabase();
    const night = createBlankNightLog('2026-09-03', ALARM);
    night.eveningIntake.sodiumLevel = 'more';
    night.eveningIntake.sodiumLevelSource = 'proxy';
    night.wakeUpEvents = [createBlankWakeUpEvent({ source: 'episode', capturedAt: new Date(2026, 8, 4, 4, 31).getTime(), startTime: '04:31' })];
    night.sleepData = { sleepTime: '22:30', wakeTime: '04:43', totalSleepDuration: 360, actualSleepDuration: 340, sleepScore: 81, sleepScoreDelta: 0, deepSleep: 60, remSleep: 100, lightSleep: 180, awakeDuration: 20, avgHeartRate: 48, minHeartRate: 40, avgRespiratoryRate: 14, bloodOxygenAvg: 95, skinTempRange: '', sleepLatencyRating: 'Good', restfulnessRating: 'Good', deepSleepRating: 'Good', remSleepRating: 'Good', importedAt: 1 };
    await db.nightLogs.put(night);
    await db.bodyMeasurements.bulkAdd([
      { id: 'w1', kind: 'weight', nightLogId: night.id, date: '2026-09-03', time: '21:00', timestamp: 1, period: 'evening', value: 172.4, measured: true, createdAt: 1 },
      { id: 'w2', kind: 'weight', nightLogId: night.id, date: '2026-09-04', time: '07:00', timestamp: 2, period: 'morning', value: 174.2, measured: true, createdAt: 2 },
      { id: 'n1', kind: 'neck', nightLogId: night.id, date: '2026-09-03', time: '21:00', timestamp: 1, period: 'evening', value: 15.6, measured: true, createdAt: 1 },
    ]);
    await db.orthostaticReadings.add({ id: 'o1', date: '2026-09-04', slot: 'am', timestamp: 3, source: 'watch', supine: { systolic: 120, diastolic: 78, pulse: 60 }, standing1: null, standing3: { systolic: 98, diastolic: 66, pulse: 92 }, notes: '', createdAt: 3 });
  });

  afterEach(() => cleanup());

  for (const route of ROUTES) {
    it(`renders ${route}`, async () => {
      const errors: unknown[] = [];
      const orig = console.error;
      console.error = (...args: unknown[]) => { errors.push(args); };
      try {
        const { container } = render(
          <MemoryRouter initialEntries={[route]}>
            <App />
          </MemoryRouter>,
        );
        await waitFor(() => {
          expect(container.querySelector('.app-switcher')).not.toBeNull();
          expect(container.querySelector('nav.bottom-tabs')).not.toBeNull();
          // Something meaningful rendered inside the content area.
          expect((container.querySelector('.app-content')?.textContent ?? '').trim().length).toBeGreaterThan(0);
        });
        // Let live queries settle, then ensure no React render error surfaced.
        await new Promise((r) => setTimeout(r, 50));
        const rendersFailed = errors.some((e) => String(e).includes('The above error occurred'));
        expect(rendersFailed).toBe(false);
      } finally {
        console.error = orig;
      }
    });
  }
});
