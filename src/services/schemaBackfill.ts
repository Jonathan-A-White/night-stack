import type { BodyMeasurement, WeightEntry } from '../types';

/**
 * Pure backfill helpers for the Dexie v12 migration (home-experiments
 * `schema.md`). Each helper mutates the loosely-typed row it is given and
 * is guarded by `=== undefined` checks so re-running is a no-op and user-set
 * values are never overwritten. Kept out of `db.ts` so they can be unit
 * tested without IndexedDB, and reused by the JSON import path to
 * normalize pre-v12 backups.
 */

type Loose = Record<string, unknown>;

function asObject(v: unknown): Loose {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Loose) : {};
}

/** Fill the v12 episode fields (and the v8 thermal flags) on one wake-up event. */
export function backfillWakeUpEventV12(ev: Loose): void {
  // v8 thermal flags — some imported rows predate them.
  if (ev.wasSweating === undefined) ev.wasSweating = false;
  if (ev.feltCold === undefined) ev.feltCold = false;
  if (ev.racingHeart === undefined) ev.racingHeart = false;
  // v12 episode fields.
  if (ev.positionAtWake === undefined) ev.positionAtWake = 'unknown';
  if (ev.ecgTaken === undefined) ev.ecgTaken = false;
  if (ev.ecgVerdict === undefined) ev.ecgVerdict = 'not_taken';
  if (ev.rhythmFelt === undefined) ev.rhythmFelt = null;
  if (ev.lyingBp === undefined) ev.lyingBp = null;
  if (ev.minutesToSettle === undefined) ev.minutesToSettle = null;
  if (ev.wired === undefined) ev.wired = false;
  if (ev.capturedAt === undefined) ev.capturedAt = null;
  if (ev.source === undefined) ev.source = 'morning';
}

/**
 * Fill the v12 night-tag fields on one NightLog and replace the boolean
 * `high_salt` flag with `sodiumLevel` (Q11):
 *   high_salt active   → 'more'
 *   otherwise          → 'normal'
 * both stamped `sodiumLevelSource: 'proxy'`. The flag entry is removed.
 */
export function backfillNightLogV12(log: Loose): void {
  const intake = asObject(log.eveningIntake);
  if (intake.lastMealTime === undefined) intake.lastMealTime = '';
  if (intake.foodDescription === undefined) intake.foodDescription = '';
  if (intake.alcohol === undefined) intake.alcohol = null;
  if (intake.liquidIntake === undefined) intake.liquidIntake = '';

  const flags = Array.isArray(intake.flags) ? (intake.flags as Loose[]) : [];
  const saltFlag = flags.find((f) => f && f.type === 'high_salt');
  if (intake.sodiumLevel === undefined) {
    intake.sodiumLevel = saltFlag && saltFlag.active === true ? 'more' : 'normal';
    intake.sodiumLevelSource = 'proxy';
  }
  if (intake.sodiumLevelSource === undefined) intake.sodiumLevelSource = 'proxy';
  if (intake.sodiumSources === undefined) intake.sodiumSources = [];
  intake.flags = flags.filter((f) => !(f && f.type === 'high_salt'));
  log.eveningIntake = intake;

  if (log.electrolyteDose === undefined) log.electrolyteDose = null;
  if (log.positionStarted === undefined) log.positionStarted = 'unknown';
  if (log.positionAtWake === undefined) log.positionAtWake = 'unknown';
  if (log.wiredWake === undefined) log.wiredWake = false;
  if (log.autoCreated === undefined) log.autoCreated = false;
  if (log.experimentNotes === undefined) log.experimentNotes = '';

  const events = Array.isArray(log.wakeUpEvents) ? (log.wakeUpEvents as Loose[]) : [];
  for (const ev of events) backfillWakeUpEventV12(asObject(ev));
  log.wakeUpEvents = events;
}

/** Add the three reminder preferences (off) and the calibration date (null). */
export function backfillAppSettingsV12(s: Loose): void {
  const prefs = asObject(s.notificationPreferences);
  if (prefs.eatingCutoff === undefined) prefs.eatingCutoff = true;
  if (prefs.supplementReminder === undefined) prefs.supplementReminder = true;
  if (prefs.bedtimeWarning === undefined) prefs.bedtimeWarning = true;
  if (prefs.bedtime === undefined) prefs.bedtime = true;
  if (prefs.morningLog === undefined) prefs.morningLog = true;
  if (prefs.amVitals === undefined) prefs.amVitals = false;
  if (prefs.pmVitals === undefined) prefs.pmVitals = false;
  if (prefs.bedtimeWeighIn === undefined) prefs.bedtimeWeighIn = false;
  s.notificationPreferences = prefs;
  if (s.watchBpCalibratedAt === undefined) s.watchBpCalibratedAt = null;
}

/** Map a legacy WeightEntry to a BodyMeasurement, preserving its id. */
export function weightEntryToBodyMeasurement(w: WeightEntry): BodyMeasurement {
  return {
    id: w.id,
    kind: 'weight',
    nightLogId: w.nightLogId,
    date: w.date,
    time: w.time,
    timestamp: w.timestamp,
    period: w.period,
    value: w.weightLbs,
    measured: w.measured,
    createdAt: w.createdAt,
  };
}
