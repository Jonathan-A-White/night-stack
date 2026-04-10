// === Core Entities ===

export interface NightLog {
  id: string;
  date: string; // ISO date "YYYY-MM-DD" — the evening date
  createdAt: number;
  updatedAt: number;
  alarm: AlarmInfo;
  stack: StackEntry;
  eveningIntake: EveningIntake;
  environment: EnvironmentEntry;
  clothing: string[]; // IDs of ClothingItem
  bedding: string[]; // IDs of BeddingItem
  sleepData: SleepData | null;
  roomTimeline: RoomReading[] | null;
  wakeUpEvents: WakeUpEvent[];
  bedtimeExplanation: BedtimeExplanation | null;
  middayStruggle: MiddayStruggle;
  eveningNotes: string;
  morningNotes: string;
}

export interface AlarmInfo {
  expectedAlarmTime: string; // "HH:MM"
  actualAlarmTime: string; // "HH:MM"
  isOverridden: boolean;
  targetBedtime: string; // "HH:MM"
  eatingCutoff: string; // "HH:MM"
  supplementTime: string; // "HH:MM"
}

export interface StackEntry {
  baseStackUsed: boolean;
  deviations: StackDeviation[];
}

export interface StackDeviation {
  id: string;
  supplementId: string;
  deviation: 'skipped' | 'reduced' | 'increased' | 'substituted' | 'added';
  notes: string;
}

export interface EveningIntake {
  lastMealTime: string; // "HH:MM"
  foodDescription: string;
  flags: EveningFlag[];
  alcohol: AlcoholEntry | null;
  liquidIntake: string;
}

export interface EveningFlag {
  type: 'overate' | 'high_salt' | 'nitrates' | 'questionable_food' | 'late_meal' | 'custom';
  label: string;
  active: boolean;
}

export interface AlcoholEntry {
  type: string;
  amount: string;
  time: string; // "HH:MM"
}

export interface EnvironmentEntry {
  roomTempF: number | null;
  roomHumidity: number | null;
  externalWeather: ExternalWeather | null;
}

export interface ExternalWeather {
  overnightTemps: HourlyReading[];
  overnightHumidity: HourlyReading[];
  fetchedAt: number;
}

export interface HourlyReading {
  hour: string; // ISO datetime
  value: number;
}

export interface SleepData {
  sleepTime: string; // "HH:MM"
  wakeTime: string; // "HH:MM"
  totalSleepDuration: number; // minutes
  actualSleepDuration: number; // minutes
  sleepScore: number;
  sleepScoreDelta: number;
  deepSleep: number; // minutes
  remSleep: number; // minutes
  lightSleep: number; // minutes
  awakeDuration: number; // minutes
  avgHeartRate: number; // bpm
  minHeartRate: number | null; // bpm — lowest HR observed during the night
  avgRespiratoryRate: number; // breaths/min
  bloodOxygenAvg: number; // percent
  skinTempRange: string;
  sleepLatencyRating: SleepRating;
  restfulnessRating: SleepRating;
  deepSleepRating: SleepRating;
  remSleepRating: SleepRating;
  importedAt: number;
}

export type SleepRating = 'Excellent' | 'Good' | 'Fair' | 'Attention';

export interface RoomReading {
  timestamp: string; // ISO datetime
  tempF: number;
  humidity: number;
}

export interface WakeUpEvent {
  id: string;
  startTime: string; // "HH:MM" — when the wake-up began
  endTime: string; // "HH:MM" — when fell back asleep (empty if didn't)
  cause: string; // ID of WakeUpCause
  fellBackAsleep: 'yes' | 'no' | 'eventually';
  minutesToFallBackAsleep: number | null;
  notes: string;
}

export interface BedtimeExplanation {
  actualBedtime: string; // "HH:MM"
  targetBedtime: string; // "HH:MM"
  wasLate: boolean;
  reason: string; // ID of BedtimeReason
  notes: string;
}

/**
 * Midday slump coping. Food is a "bad" coping action (crash + thermic load);
 * drink and exercise are "good"; nap is a good response to a bad situation
 * (indicates the prior night fell short). The good/bad flavor is derived from
 * the item's `type`, not stored per-entry, so classifying an item correctly in
 * settings is what drives rule evaluation and UI color.
 */
export type MiddayCopingType = 'food' | 'drink' | 'exercise' | 'nap';

export type StruggleIntensity = 'low' | 'medium' | 'high';

export interface MiddayCopingItem {
  id: string;
  name: string;
  type: MiddayCopingType;
  sortOrder: number;
  isActive: boolean;
}

export interface MiddayStruggle {
  hadStruggle: boolean;
  copingItemIds: string[]; // IDs of MiddayCopingItem; can be empty even when hadStruggle=true
  struggleTime: string; // "HH:MM", empty if not set
  intensity: StruggleIntensity | null;
  notes: string;
}

// === Configuration Entities ===

export interface SupplementDef {
  id: string;
  name: string;
  defaultDose: string;
  timing: 'morning' | 'lunch' | 'dinner' | 'bedtime';
  frequency: 'daily' | 'every_other_day' | 'weekdays' | 'custom';
  notes: string;
  isActive: boolean;
  sortOrder: number;
}

export interface ClothingItem {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface BeddingItem {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface WakeUpCause {
  id: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
}

export interface BedtimeReason {
  id: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
}

export interface AlarmSchedule {
  id: string;
  dayOfWeek: number; // 0=Sunday, 1=Monday, ...
  alarmTime: string; // "HH:MM"
  hasAlarm: boolean;
  naturalWakeTime: string | null;
}

/**
 * A single atomic condition clause. Each `kind` corresponds to a signal the
 * rules engine knows how to evaluate. Adding a new kind requires adding both
 * a UI option and a case in the evaluator, which keeps rule conditions from
 * drifting away from what the app can actually enforce.
 */
export type ConditionClause =
  | { kind: 'always' }
  | { kind: 'room_temp_above'; thresholdF: number }
  | { kind: 'external_temp_above'; thresholdF: number }
  | { kind: 'food_after_cutoff' }
  | { kind: 'alcohol_logged' }
  | { kind: 'peanuts_logged' }
  | { kind: 'recurrent_night_wakeup' }
  | { kind: 'iron_supplement_day' }
  | { kind: 'feeling_cold' }
  | { kind: 'midday_food_coping' }
  | { kind: 'midday_nap_logged' };

export type ConditionClauseKind = ConditionClause['kind'];

/**
 * A rule condition: one or more clauses joined by AND/OR. A single-clause
 * condition still carries a combinator, but its value is irrelevant.
 */
export interface SleepCondition {
  combinator: 'and' | 'or';
  clauses: ConditionClause[];
}

export interface SleepRule {
  id: string;
  name: string;
  condition: SleepCondition;
  recommendation: string;
  priority: 'high' | 'medium' | 'low';
  isActive: boolean;
  source: 'seeded' | 'user';
  createdAt: number;
}

// === Weight Tracking ===

export type UnitSystem = 'us' | 'metric';
export type Sex = 'm' | 'f';
export type WeighInPeriod = 'morning' | 'evening';

export interface WeightEntry {
  id: string;
  nightLogId: string | null; // Links to the NightLog this weigh-in correlates with
  date: string; // ISO date "YYYY-MM-DD" — date of the weigh-in
  time: string; // "HH:MM" — time of the weigh-in
  timestamp: number; // epoch ms for sorting
  weightLbs: number; // canonical storage in pounds
  period: WeighInPeriod;
  createdAt: number;
  /**
   * True when the user actively entered this weight.
   * False when the value is auto-computed (fill-forward from the most recent
   * measurement, or linear interpolation between surrounding measurements).
   */
  measured: boolean;
}

// === App Settings ===

export interface AppSettings {
  id: string;
  latitude: number;
  longitude: number;
  darkMode: boolean;
  notificationsEnabled: boolean;
  notificationPreferences: {
    eatingCutoff: boolean;
    supplementReminder: boolean;
    bedtimeWarning: boolean;
    bedtime: boolean;
    morningLog: boolean;
  };
  // Weight profile
  unitSystem: UnitSystem;
  weighInPeriod: WeighInPeriod;
  sex: Sex | null;
  heightInches: number | null;
  startingWeightLbs: number | null;
  age: number | null;
}

// === Evening Routine Tracker ===

export interface RoutineStep {
  id: string;
  name: string;
  description: string; // optional long text
  sortOrder: number;
  isActive: boolean; // inactive steps never appear in sessions
  createdAt: number;
}

export interface RoutineVariant {
  id: string;
  name: string; // e.g. "Full", "Quick", "Weeknight"
  description: string;
  stepIds: string[]; // ordered list (can override default sortOrder for this variant)
  isDefault: boolean; // exactly one should be default
  sortOrder: number;
  createdAt: number;
}

export type RoutineStepStatus = 'completed' | 'skipped' | 'punted';

export interface RoutineStepLog {
  stepId: string;
  stepName: string; // snapshot at time of session, for historical stability if step renamed/deleted
  status: RoutineStepStatus;
  startedAt: number | null; // epoch ms; null if never started (skipped from start)
  endedAt: number | null;   // epoch ms
  durationMs: number | null; // endedAt - startedAt; null if skipped/punted without running
  pbAtStartMs: number | null; // PB that was loaded when the timer started (used to display negative deltas historically)
  notes: string;
}

export interface RoutineSession {
  id: string;
  date: string; // ISO "YYYY-MM-DD" — the evening date the session belongs to
  variantId: string | null; // null = no variant / ad-hoc
  variantName: string; // snapshot
  startedAt: number;
  endedAt: number | null;  // null if still running
  completedAt: number | null; // null if abandoned
  totalDurationMs: number | null; // wall-clock: endedAt - startedAt; null if not finished
  steps: RoutineStepLog[];
  sessionNotes: string; // "what went well / poorly"
  createdAt: number;
}
