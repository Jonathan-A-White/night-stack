// Routine start-time notifications.
//
// Kept deliberately simple: we're a PWA, so we schedule an in-memory
// setTimeout that calls `new Notification(...)` when it fires. Anything
// beyond ~24h is refused (setTimeout clamping + not wanting to pretend
// we persist across reloads anyway). Callers on the routine page re-arm
// the timer every time inputs change.
//
// One timer per `key` (the routine id) so several start cards on the
// Routine home each keep their own reminder instead of overwriting one
// shared slot.

export type NotificationPermissionState =
  | 'granted'
  | 'denied'
  | 'default'
  | 'unsupported';

const MAX_SCHEDULE_AHEAD_MS = 24 * 60 * 60 * 1000; // 24h
const DEFAULT_KEY = 'default';

interface Scheduled {
  timeout: ReturnType<typeof setTimeout>;
  fireAt: number;
}

const scheduled = new Map<string, Scheduled>();

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
 * Schedule a single local notification to fire at `fireAt` for `key`.
 * Cancels any prior notification with the same key first. Returns true
 * only if a timer was actually armed.
 */
export function scheduleRoutineStartNotification(
  fireAt: Date,
  options: { title: string; body: string },
  key: string = DEFAULT_KEY,
): boolean {
  cancelRoutineStartNotification(key);

  if (!notificationsSupported()) return false;
  if (window.Notification.permission !== 'granted') return false;

  const now = Date.now();
  const delay = fireAt.getTime() - now;
  if (delay <= 0) return false;
  if (delay > MAX_SCHEDULE_AHEAD_MS) return false;

  const fireTs = fireAt.getTime();
  const timeout = setTimeout(() => {
    scheduled.delete(key);
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
  scheduled.set(key, { timeout, fireAt: fireTs });
  return true;
}

/** Cancel the pending notification for `key` (or every key when omitted). */
export function cancelRoutineStartNotification(key?: string): void {
  if (key === undefined) {
    for (const s of scheduled.values()) clearTimeout(s.timeout);
    scheduled.clear();
    return;
  }
  const s = scheduled.get(key);
  if (s) clearTimeout(s.timeout);
  scheduled.delete(key);
}

/** Exposed for tests/debug: the timestamp of the pending fire for `key`, or null. */
export function getScheduledFireAt(key: string = DEFAULT_KEY): number | null {
  return scheduled.get(key)?.fireAt ?? null;
}
