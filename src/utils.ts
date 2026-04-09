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
 * Get today's date as ISO string "YYYY-MM-DD"
 */
export function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
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
    environment: { roomTempF: null, roomHumidity: null, externalWeather: null },
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
  };
}
