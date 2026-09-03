import type { AlarmInfo, AppSettings } from '../types';

let scheduledTimeouts: ReturnType<typeof setTimeout>[] = [];

export function clearScheduledNotifications() {
  scheduledTimeouts.forEach(clearTimeout);
  scheduledTimeouts = [];
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

export interface PlannedNotification {
  time: string; // "HH:MM"
  message: string;
  enabled: boolean;
}

/**
 * The full list of notifications for a night, with each gated by its
 * preference. Pure so it can be unit-tested; `scheduleNotifications` turns
 * it into timers. Home-experiments reminders (Q19): AM vitals at alarm +
 * 15 min, PM vitals at target bedtime − 60 min, bedtime weigh-in at target
 * bedtime − 10 min.
 */
export function buildNotificationPlan(
  alarm: AlarmInfo,
  prefs: AppSettings['notificationPreferences'],
): PlannedNotification[] {
  return [
    {
      time: alarm.eatingCutoff,
      message: 'Eating cutoff — stop eating to sleep well tonight',
      enabled: prefs.eatingCutoff,
    },
    {
      time: alarm.supplementTime,
      message: 'Time for your bedtime stack',
      enabled: prefs.supplementReminder,
    },
    {
      time: subtractMins(alarm.targetBedtime, 15),
      message: '15 minutes to bedtime — start winding down',
      enabled: prefs.bedtimeWarning,
    },
    {
      time: alarm.targetBedtime,
      message: 'Bedtime! Target sleep time reached',
      enabled: prefs.bedtime,
    },
    {
      time: addMins(alarm.actualAlarmTime, 120),
      message: "Don't forget to log last night's sleep",
      enabled: prefs.morningLog,
    },
    {
      time: addMins(alarm.actualAlarmTime, 15),
      message: 'Time for your AM orthostatic reading',
      enabled: prefs.amVitals,
    },
    {
      time: subtractMins(alarm.targetBedtime, 60),
      message: 'Time for your PM orthostatic reading',
      enabled: prefs.pmVitals,
    },
    {
      time: subtractMins(alarm.targetBedtime, 10),
      message: 'Bedtime weigh-in and neck measurement',
      enabled: prefs.bedtimeWeighIn,
    },
  ];
}

export function scheduleNotifications(
  alarm: AlarmInfo,
  prefs: AppSettings['notificationPreferences']
) {
  clearScheduledNotifications();

  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const now = new Date();

  for (const notif of buildNotificationPlan(alarm, prefs)) {
    if (!notif.enabled) continue;

    const targetDate = getNextOccurrence(notif.time, now);
    const delay = targetDate.getTime() - now.getTime();

    if (delay > 0 && delay < 24 * 60 * 60 * 1000) {
      const timeout = setTimeout(() => {
        new Notification('NightStack', { body: notif.message, icon: '/favicon.svg' });
      }, delay);
      scheduledTimeouts.push(timeout);
    }
  }
}

function getNextOccurrence(time: string, now: Date): Date {
  const [h, m] = time.split(':').map(Number);
  const target = new Date(now);
  target.setHours(h, m, 0, 0);

  // If the time is in the early morning (like alarm + 2hrs), it's tomorrow
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }

  return target;
}

function subtractMins(time: string, mins: number): string {
  const [h, m] = time.split(':').map(Number);
  let total = h * 60 + m - mins;
  if (total < 0) total += 24 * 60;
  return `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
}

function addMins(time: string, mins: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + mins;
  return `${(Math.floor(total / 60) % 24).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
}
