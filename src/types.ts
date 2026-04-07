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

export interface SleepRule {
  id: string;
  name: string;
  condition: string;
  recommendation: string;
  priority: 'high' | 'medium' | 'low';
  isActive: boolean;
  source: 'seeded' | 'user';
  createdAt: number;
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
}
