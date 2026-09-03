import { db } from '../db';
import type { NightLog, WakeUpEvent } from '../types';
import {
  addDaysToDate,
  calculateSchedule,
  createBlankNightLog,
  createBlankWakeUpEvent,
  getEveningLogDate,
  timestampToHHMM,
} from '../utils';

/**
 * 4am episode capture (specs/home-experiments/episode-capture.md).
 *
 * `attachEpisode` is the one-tap save: it resolves the night, creates a
 * minimal `autoCreated` NightLog when none exists (Q6), and appends a
 * `source: 'episode'` WakeUpEvent — all inside one readwrite transaction so
 * a double tap cannot create two nights. A tap within `REOPEN_WINDOW_MS` of
 * the last episode re-opens that event instead of appending a new one.
 */

/** Taps within this window of the last episode re-open it (10 minutes). */
export const REOPEN_WINDOW_MS = 10 * 60 * 1000;

export interface AttachEpisodeResult {
  nightDate: string;
  nightLogId: string;
  eventId: string;
  /** True when the NightLog had to be auto-created. */
  created: boolean;
  /** True when an existing recent episode was returned instead of a new one. */
  reopened: boolean;
}

function dayOfWeekOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

/** Build the minimal NightLog the episode flow creates when none exists. */
export async function buildAutoCreatedNightLog(nightDate: string): Promise<NightLog> {
  // The alarm that ends this night is the one for the *next* calendar day.
  const wakeDay = dayOfWeekOf(addDaysToDate(nightDate, 1));
  const schedule = await db.alarmSchedules.where('dayOfWeek').equals(wakeDay).first();
  const alarmTime = schedule?.alarmTime ?? '07:00';
  const times = calculateSchedule(alarmTime);
  const log = createBlankNightLog(nightDate, {
    expectedAlarmTime: alarmTime,
    actualAlarmTime: alarmTime,
    isOverridden: false,
    targetBedtime: times.targetBedtime,
    eatingCutoff: times.eatingCutoff,
    supplementTime: times.supplementTime,
  });
  log.autoCreated = true;
  return log;
}

/** Make the WakeUpEvent row for a live capture at `now`. */
export function buildEpisodeEvent(now: number): WakeUpEvent {
  return createBlankWakeUpEvent({
    startTime: timestampToHHMM(now),
    endTime: '',
    cause: '',
    fellBackAsleep: 'no',
    racingHeart: true,
    capturedAt: now,
    source: 'episode',
  });
}

export async function attachEpisode(now: number = Date.now()): Promise<AttachEpisodeResult> {
  const nightDate = getEveningLogDate(new Date(now));
  return db.transaction('rw', db.nightLogs, db.alarmSchedules, async () => {
    let log = await db.nightLogs.where('date').equals(nightDate).first();
    let created = false;
    if (!log) {
      log = await buildAutoCreatedNightLog(nightDate);
      created = true;
    }

    // Re-open a very recent episode rather than stacking duplicates.
    const recent = log.wakeUpEvents
      .filter((e) => e.source === 'episode' && e.capturedAt !== null)
      .sort((a, b) => (b.capturedAt ?? 0) - (a.capturedAt ?? 0))[0];
    if (recent && recent.capturedAt !== null && now - recent.capturedAt < REOPEN_WINDOW_MS) {
      return { nightDate, nightLogId: log.id, eventId: recent.id, created, reopened: true };
    }

    const event = buildEpisodeEvent(now);
    const updated: NightLog = {
      ...log,
      wakeUpEvents: [...log.wakeUpEvents, event],
      updatedAt: now,
    };
    await db.nightLogs.put(updated);
    return { nightDate, nightLogId: log.id, eventId: event.id, created, reopened: false };
  });
}

/** Patch one wake-up event on a night; no-op when the event is missing. */
export async function updateEpisode(
  nightLogId: string,
  eventId: string,
  patch: Partial<WakeUpEvent>,
): Promise<void> {
  await db.transaction('rw', db.nightLogs, async () => {
    const log = await db.nightLogs.get(nightLogId);
    if (!log) return;
    if (!log.wakeUpEvents.some((e) => e.id === eventId)) return;
    await db.nightLogs.update(nightLogId, {
      wakeUpEvents: log.wakeUpEvents.map((e) => (e.id === eventId ? { ...e, ...patch, id: e.id } : e)),
      updatedAt: Date.now(),
    });
  });
}

export function episodesForNight(log: Pick<NightLog, 'wakeUpEvents'>): WakeUpEvent[] {
  return log.wakeUpEvents.filter((e) => e.source === 'episode');
}

export function hasEpisode(log: Pick<NightLog, 'wakeUpEvents'>): boolean {
  return log.wakeUpEvents.some((e) => e.source === 'episode');
}

/**
 * Apply the evening wizard's fields onto an auto-created row without
 * losing anything the 4am flow or the morning log already wrote. Pure.
 */
export function mergeEveningIntoAutoCreated(
  auto: NightLog,
  eveningFields: Partial<NightLog>,
): NightLog {
  return {
    ...auto,
    ...eveningFields,
    id: auto.id,
    date: auto.date,
    wakeUpEvents: auto.wakeUpEvents,
    positionAtWake: auto.positionAtWake,
    wiredWake: auto.wiredWake,
    autoCreated: false,
  };
}
