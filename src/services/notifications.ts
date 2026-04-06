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

export function scheduleNotifications(
  alarm: AlarmInfo,
  prefs: AppSettings['notificationPreferences']
) {
  clearScheduledNotifications();

  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const notifications: { time: string; message: string; enabled: boolean }[] = [
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
  ];

  const now = new Date();

  for (const notif of notifications) {
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
