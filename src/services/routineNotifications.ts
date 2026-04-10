// Evening routine start-time notifications.
//
// Kept deliberately simple: we're a PWA, so we schedule an in-memory
// setTimeout that calls `new Notification(...)` when it fires. Anything
// beyond ~24h is refused (setTimeout clamping + not wanting to pretend
// we persist across reloads anyway). Callers on the routine page re-arm
// the timer every time inputs change.

export type NotificationPermissionState =
  | 'granted'
  | 'denied'
  | 'default'
  | 'unsupported';

const MAX_SCHEDULE_AHEAD_MS = 24 * 60 * 60 * 1000; // 24h

let scheduledTimeout: ReturnType<typeof setTimeout> | null = null;
let scheduledFireAt: number | null = null;

function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotificationPermission(): NotificationPermissionState {
  if (!notificationsSupported()) return 'unsupported';
  const perm = window.Notification.permission;
  if (perm === 'granted' || perm === 'denied' || perm === 'default') return perm;
  return 'default';
}

export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (!notificationsSupported()) return 'unsupported';
  const current = window.Notification.permission;
  if (current === 'granted') return 'granted';
  if (current === 'denied') return 'denied';
  try {
    const result = await window.Notification.requestPermission();
    if (result === 'granted' || result === 'denied' || result === 'default') {
      return result;
    }
    return 'default';
  } catch {
    return 'default';
  }
}

/**
 * Schedule a single local notification to fire at `fireAt`. Cancels any
 * prior routine start notification first. Returns true only if a timer
 * was actually armed.
 */
export function scheduleRoutineStartNotification(
  fireAt: Date,
  options: { title: string; body: string },
): boolean {
  cancelRoutineStartNotification();

  if (!notificationsSupported()) return false;
  if (window.Notification.permission !== 'granted') return false;

  const now = Date.now();
  const delay = fireAt.getTime() - now;
  if (delay <= 0) return false;
  if (delay > MAX_SCHEDULE_AHEAD_MS) return false;

  const fireTs = fireAt.getTime();
  scheduledTimeout = setTimeout(() => {
    scheduledTimeout = null;
    scheduledFireAt = null;
    try {
      // Icon path is the vite-pwa-generated 192x192 asset under the base path.
      // If the asset isn't present the browser simply drops the icon and
      // shows the notification without it.
      new window.Notification(options.title, {
        body: options.body,
        icon: '/night-stack/pwa-192x192.png',
      });
    } catch {
      // Swallow — notifications are best-effort UX, never critical path.
    }
  }, delay);
  scheduledFireAt = fireTs;
  return true;
}

export function cancelRoutineStartNotification(): void {
  if (scheduledTimeout != null) {
    clearTimeout(scheduledTimeout);
  }
  scheduledTimeout = null;
  scheduledFireAt = null;
}

/** Exposed for tests/debug: the timestamp of the pending fire, or null. */
export function getScheduledFireAt(): number | null {
  return scheduledFireAt;
}
