/**
 * Format "HH:MM" 24h to 12h display (e.g., "21:13" -> "9:13 PM")
 */
export function formatTime12h(time24: string): string {
  const [h, m] = time24.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${m.toString().padStart(2, '0')} ${period}`;
}

/**
 * Subtract minutes from a "HH:MM" time string, returning "HH:MM"
 */
export function subtractMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  let totalMins = h * 60 + m - minutes;
  if (totalMins < 0) totalMins += 24 * 60;
  const newH = Math.floor(totalMins / 60) % 24;
  const newM = totalMins % 60;
  return `${newH.toString().padStart(2, '0')}:${newM.toString().padStart(2, '0')}`;
}

/**
 * Add minutes to a "HH:MM" time string
 */
export function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  let totalMins = h * 60 + m + minutes;
  const newH = Math.floor(totalMins / 60) % 24;
  const newM = totalMins % 60;
  return `${newH.toString().padStart(2, '0')}:${newM.toString().padStart(2, '0')}`;
}

/**
 * Calculate schedule from alarm time
 */
export function calculateSchedule(alarmTime: string) {
  const targetBedtime = subtractMinutes(alarmTime, 7 * 60 + 30); // 5 sleep cycles
  const eatingCutoff = subtractMinutes(targetBedtime, 2 * 60 + 30); // 2.5 hrs before bed
  const supplementTime = subtractMinutes(targetBedtime, 45); // 45 min before bed
  return { targetBedtime, eatingCutoff, supplementTime };
}

/**
 * Get tomorrow's day of week (0=Sunday)
 */
export function getTomorrowDayOfWeek(): number {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.getDay();
}

/**
 * Format a Date as a local "YYYY-MM-DD" string. Uses local time components
 * to avoid the UTC shift from toISOString() that can move the date by a day
 * in negative UTC offsets.
 */
export function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Get today's date as local "YYYY-MM-DD"
 */
export function getTodayDate(): string {
  return toLocalDateString(new Date());
}

/**
 * Get yesterday's date as local "YYYY-MM-DD"
 */
export function getYesterdayDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toLocalDateString(d);
}

/**
 * Add (or subtract) days to a local "YYYY-MM-DD" date string, returning a new
 * "YYYY-MM-DD" string. Parses components explicitly so it's immune to the
 * timezone shift that `new Date("YYYY-MM-DD")` triggers in some runtimes.
 */
export function addDaysToDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return toLocalDateString(dt);
}

/**
 * Return the date a new Evening Log should be stamped with. The stored
 * `NightLog.date` is the date of the evening itself, so an evening logged
 * in the early hours (before noon) of the next morning belongs to yesterday,
 * not today. After noon we assume the user is prepping/logging today's
 * upcoming evening.
 */
export function getEveningLogDate(now: Date = new Date()): string {
  const target = new Date(now);
  if (now.getHours() < 12) {
    target.setDate(target.getDate() - 1);
  }
  return toLocalDateString(target);
}

/**
 * Day names
 */
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Compare two "HH:MM" time strings. Returns true if a is after b.
 */
export function isTimeAfter(a: string, b: string): boolean {
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  return ah * 60 + am > bh * 60 + bm;
}

/**
 * Get current time as "HH:MM"
 */
export function getCurrentTime(): string {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
}

/**
 * Convert an epoch-ms timestamp to local "HH:MM".
 */
export function timestampToHHMM(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

/**
 * bugfixes T5 pure check: true when the evening log is being finalized
 * before its own eating cutoff, which would seed a negative
 * hours-since-meal anchor in the recommender. Skipped for retroactive
 * saves — explicit backfills (?date=...) and morning-after logs (where
 * logDate auto-derived to yesterday) both set `isRetroactive=true`,
 * since save-time in those cases doesn't represent actual bedtime.
 *
 * `nowHHMM` is the local wall-clock time the user clicked save at;
 * `eatingCutoff` is the computed cutoff for the night. Returns true when
 * the user should be warned.
 */
export function isSaveBeforeEatingCutoff(
  nowHHMM: string,
  eatingCutoff: string,
  isRetroactive: boolean,
): boolean {
  if (isRetroactive) return false;
  return isTimeAfter(eatingCutoff, nowHHMM);
}

/**
 * Find the RoomReading closest in time-of-day to a "HH:MM" target. Uses
 * circular minute distance so a 03:10 target correctly matches a 03:12
 * reading even when other readings fall on the previous evening side of
 * midnight. Returns null if the list is empty. Safe on a single-night
 * timeline (<24h of readings) — longer windows could produce collisions.
 */
export function findNearestRoomReading<T extends { timestamp: string }>(
  targetHHMM: string,
  readings: readonly T[]
): T | null {
  if (readings.length === 0) return null;
  const [th, tm] = targetHHMM.split(':').map(Number);
  const targetMin = th * 60 + tm;
  let best: T | null = null;
  let bestDist = Infinity;
  for (const r of readings) {
    const d = new Date(r.timestamp);
    const rMin = d.getHours() * 60 + d.getMinutes();
    const raw = Math.abs(rMin - targetMin);
    const dist = Math.min(raw, 1440 - raw);
    if (dist < bestDist) {
      bestDist = dist;
      best = r;
    }
  }
  return best;
}

/**
 * Decide what `lastMealTime` value should be persisted when the evening log
 * is saved. The recommender's `hoursSinceLastMeal` feature (see
 * derived-features.md) cannot be computed without a meal time, so we prefill
 * blank values with the eating cutoff the user was already prompted with.
 * The prefill is only applied if the user never interacted with the field —
 * if they intentionally cleared it, leave it blank so the recommender flags
 * the night as unknown rather than pretending to have data.
 *
 * Pure helper so the save-path behavior can be unit-tested without mounting
 * the EveningLog component.
 */
export function resolveLastMealTimeForSave(params: {
  currentValue: string;
  eatingCutoff: string;
  userInteracted: boolean;
}): string {
  const { currentValue, eatingCutoff, userInteracted } = params;
  if (currentValue.trim() !== '') return currentValue;
  if (userInteracted) return currentValue; // respect explicit clear
  if (!eatingCutoff) return currentValue;
  return eatingCutoff;
}

/**
 * Assumed minutes between closing the evening log and actual sleep onset.
 * Used by computeAdjustedSleepOnset to derive a plausible onset timestamp
 * from loggedBedtime when the watch missed the early part of the night.
 */
export const ASSUMED_SLEEP_LATENCY_MINUTES = 10;

export interface AdjustedSleepOnset {
  sleepTime: string; // "HH:MM" — displayed onset
  totalSleepDuration: number;
  actualSleepDuration: number;
  adjustmentMinutes: number; // minutes added vs. watch
  watchSleepTime: string; // original watch onset "HH:MM"
  isAdjusted: boolean;
}

/**
 * When the watch detects sleep onset significantly later than the evening
 * log's finish time (e.g. because the watch was charging and went on right
 * before bed), use `loggedBedtime + assumed latency` as the onset instead
 * and extend the sleep durations by the recovered gap. Purely derived —
 * the stored `SleepData` is never modified. When the watch's onset is
 * within `minAdjustmentMinutes` of the expected onset, no adjustment is
 * applied.
 */
export function computeAdjustedSleepOnset(params: {
  loggedBedtime: number | null;
  watchSleepTime: string;
  watchTotalDuration: number;
  watchActualDuration: number;
  assumedLatencyMinutes?: number;
  minAdjustmentMinutes?: number;
}): AdjustedSleepOnset {
  const {
    loggedBedtime,
    watchSleepTime,
    watchTotalDuration,
    watchActualDuration,
    assumedLatencyMinutes = ASSUMED_SLEEP_LATENCY_MINUTES,
    minAdjustmentMinutes = 5,
  } = params;

  const unchanged: AdjustedSleepOnset = {
    sleepTime: watchSleepTime,
    totalSleepDuration: watchTotalDuration,
    actualSleepDuration: watchActualDuration,
    adjustmentMinutes: 0,
    watchSleepTime,
    isAdjusted: false,
  };

  if (loggedBedtime == null) return unchanged;

  // Resolve the watch's HH:MM onset to the first occurrence at-or-after
  // loggedBedtime so midnight-crossing nights compare correctly.
  const [wh, wm] = watchSleepTime.split(':').map(Number);
  const watchOnset = new Date(loggedBedtime);
  watchOnset.setHours(wh, wm, 0, 0);
  if (watchOnset.getTime() < loggedBedtime) {
    watchOnset.setDate(watchOnset.getDate() + 1);
  }

  const expectedOnsetMs = loggedBedtime + assumedLatencyMinutes * 60_000;
  const missedMin = Math.round((watchOnset.getTime() - expectedOnsetMs) / 60_000);
  if (missedMin < minAdjustmentMinutes) return unchanged;

  const adjusted = new Date(expectedOnsetMs);
  const adjustedHHMM = `${adjusted.getHours().toString().padStart(2, '0')}:${adjusted.getMinutes().toString().padStart(2, '0')}`;

  return {
    sleepTime: adjustedHHMM,
    totalSleepDuration: watchTotalDuration + missedMin,
    actualSleepDuration: watchActualDuration + missedMin,
    adjustmentMinutes: missedMin,
    watchSleepTime,
    isAdjusted: true,
  };
}

/**
 * Create a blank NightLog for a given date
 */
export function createBlankNightLog(date: string, alarm: {
  expectedAlarmTime: string;
  actualAlarmTime: string;
  isOverridden: boolean;
  targetBedtime: string;
  eatingCutoff: string;
  supplementTime: string;
}): import('./types').NightLog {
  return {
    id: crypto.randomUUID(),
    date,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    alarm,
    loggedBedtime: null,
    stack: { baseStackUsed: true, deviations: [] },
    eveningIntake: {
      lastMealTime: '',
      foodDescription: '',
      flags: [
        { type: 'overate', label: 'Overate', active: false },
        { type: 'high_salt', label: 'High salt', active: false },
        { type: 'nitrates', label: 'Nitrates', active: false },
        { type: 'questionable_food', label: 'Questionable food', active: false },
        { type: 'late_meal', label: 'Late meal', active: false },
      ],
      alcohol: null,
      liquidIntake: '',
    },
    environment: {
      roomTempF: null,
      roomHumidity: null,
      externalWeather: null,
      acCurveProfile: 'off',
      acSetpointF: null,
      fanSpeed: 'off',
    },
    clothing: [],
    bedding: [],
    sleepData: null,
    roomTimeline: null,
    wakeUpEvents: [],
    bedtimeExplanation: null,
    middayStruggle: {
      hadStruggle: false,
      copingItemIds: [],
      struggleTime: '',
      intensity: null,
      notes: '',
    },
    eveningNotes: '',
    morningNotes: '',
    thermalComfort: null,
    thermalComfortSource: null,
    thermalProxyDismissed: false,
  };
}
