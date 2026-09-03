import { describe, it, expect } from 'vitest';
import { buildNotificationPlan } from '../services/notifications';
import type { AlarmInfo, AppSettings } from '../types';

const alarm: AlarmInfo = {
  expectedAlarmTime: '04:43',
  actualAlarmTime: '04:43',
  isOverridden: false,
  targetBedtime: '21:13',
  eatingCutoff: '18:43',
  supplementTime: '20:28',
};

function prefs(overrides: Partial<AppSettings['notificationPreferences']> = {}): AppSettings['notificationPreferences'] {
  return {
    eatingCutoff: false,
    supplementReminder: false,
    bedtimeWarning: false,
    bedtime: false,
    morningLog: false,
    amVitals: false,
    pmVitals: false,
    bedtimeWeighIn: false,
    ...overrides,
  };
}

function enabled(plan: ReturnType<typeof buildNotificationPlan>) {
  return plan.filter((n) => n.enabled).map((n) => [n.time, n.message]);
}

describe('buildNotificationPlan (home-experiments reminders)', () => {
  it('AM vitals fires 15 minutes after the alarm when enabled', () => {
    expect(enabled(buildNotificationPlan(alarm, prefs({ amVitals: true })))).toEqual([
      ['04:58', 'Time for your AM orthostatic reading'],
    ]);
  });

  it('PM vitals fires 60 minutes before target bedtime', () => {
    expect(enabled(buildNotificationPlan(alarm, prefs({ pmVitals: true })))).toEqual([
      ['20:13', 'Time for your PM orthostatic reading'],
    ]);
  });

  it('bedtime weigh-in fires 10 minutes before target bedtime', () => {
    expect(enabled(buildNotificationPlan(alarm, prefs({ bedtimeWeighIn: true })))).toEqual([
      ['21:03', 'Bedtime weigh-in and neck measurement'],
    ]);
  });

  it('nothing is scheduled when the three are off', () => {
    expect(enabled(buildNotificationPlan(alarm, prefs()))).toEqual([]);
  });

  it('existing five notifications are unchanged', () => {
    const plan = buildNotificationPlan(alarm, prefs({
      eatingCutoff: true, supplementReminder: true, bedtimeWarning: true, bedtime: true, morningLog: true,
    }));
    expect(enabled(plan).map(([t]) => t)).toEqual(['18:43', '20:28', '20:58', '21:13', '06:43']);
  });
});
