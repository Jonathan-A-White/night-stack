import type { Routine, RoutineSchedule } from '../types';
import { DAY_NAMES, formatTime12h } from '../utils';

/**
 * Pure helpers for a routine's `schedule` (types.ts `RoutineSchedule`).
 * The start card asks "when is the next deadline?" and "how do I label
 * it?"; the tracker asks for the countdown label above the step timer.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function parseHHMM(hhmm: string): { hh: number; mm: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? '').trim());
  if (!match) return null;
  const hh = parseInt(match[1], 10);
  const mm = parseInt(match[2], 10);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return { hh, mm };
}

/**
 * Resolve a "HH:MM" target bedtime to the concrete Date for TONIGHT. An
 * early-morning bedtime (before noon) seen in the afternoon or evening
 * belongs to tomorrow; otherwise it stays on today's date. This is the
 * rule `computeRecommendedStart` has always used.
 */
export function resolveBedtimeDeadline(
  targetBedtimeHHMM: string,
  now: Date = new Date(),
): Date | null {
  const parsed = parseHHMM(targetBedtimeHHMM);
  if (!parsed) return null;
  const bedtime = new Date(
    now.getFullYear(), now.getMonth(), now.getDate(), parsed.hh, parsed.mm, 0, 0,
  );
  if (parsed.hh < 12 && now.getHours() >= 12) {
    bedtime.setDate(bedtime.getDate() + 1);
  }
  return bedtime;
}

/**
 * Next occurrence of a fixed-time deadline on an allowed day of week.
 * Today counts as long as the deadline has not passed by more than
 * `graceMs` (default 3 h), so a routine that overruns its deadline keeps
 * showing "past deadline" for a while instead of flipping to next week.
 * Returns null only when `daysOfWeek` contains no valid day.
 */
export function resolveFixedDeadline(
  deadlineHHMM: string,
  daysOfWeek: number[],
  now: Date = new Date(),
  graceMs: number = 3 * 60 * 60 * 1000,
): Date | null {
  const parsed = parseHHMM(deadlineHHMM);
  if (!parsed) return null;
  const allowed = daysOfWeek.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const everyDay = allowed.length === 0;
  if (!everyDay && allowed.length === 0) return null;
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(
      now.getFullYear(), now.getMonth(), now.getDate() + offset,
      parsed.hh, parsed.mm, 0, 0,
    );
    if (!everyDay && !allowed.includes(candidate.getDay())) continue;
    if (candidate.getTime() + graceMs < now.getTime()) continue;
    return candidate;
  }
  return null;
}

/**
 * The concrete deadline the start card counts down to. `targetBedtime`
 * is the "HH:MM" bedtime the caller already resolved for tonight (from
 * the night log or the alarm schedule); it is only used by the
 * 'bedtime' anchor.
 */
export function resolveDeadline(
  schedule: RoutineSchedule,
  targetBedtimeHHMM: string | null,
  now: Date = new Date(),
): Date | null {
  switch (schedule.anchor) {
    case 'bedtime':
      return targetBedtimeHHMM ? resolveBedtimeDeadline(targetBedtimeHHMM, now) : null;
    case 'time':
      return resolveFixedDeadline(schedule.deadlineHHMM, schedule.daysOfWeek, now);
    case 'none':
      return null;
  }
}

/** Short label for the countdown above the tracker's step timer. */
export function deadlineCountdownLabel(schedule: RoutineSchedule, overdue: boolean): string {
  if (schedule.anchor === 'bedtime') return overdue ? 'past bedtime' : 'until bed';
  return overdue ? 'past deadline' : 'until deadline';
}

/** One-line human description of a schedule for lists and editors. */
export function describeSchedule(schedule: RoutineSchedule): string {
  switch (schedule.anchor) {
    case 'bedtime':
      return 'Finish by tonight’s target bedtime';
    case 'time': {
      const time = parseHHMM(schedule.deadlineHHMM)
        ? formatTime12h(schedule.deadlineHHMM)
        : schedule.deadlineHHMM;
      const days = schedule.daysOfWeek.filter((d) => d >= 0 && d <= 6);
      if (days.length === 0 || days.length === 7) return `Finish by ${time} every day`;
      const names = [...days].sort((a, b) => a - b).map((d) => DAY_NAMES[d].slice(0, 3));
      return `Finish by ${time} on ${names.join(', ')}`;
    }
    case 'none':
      return 'No deadline';
  }
}

/** "Sunday 9:45 AM" / "Today 9:13 PM" / "Tomorrow 12:30 AM" for a resolved deadline. */
export function describeDeadline(deadline: Date, now: Date = new Date()): string {
  const hhmm = `${deadline.getHours().toString().padStart(2, '0')}:${deadline
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
  const time = formatTime12h(hhmm);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDeadlineDay = new Date(
    deadline.getFullYear(), deadline.getMonth(), deadline.getDate(),
  ).getTime();
  const dayDelta = Math.round((startOfDeadlineDay - startOfToday) / MS_PER_DAY);
  if (dayDelta === 0) return `Today ${time}`;
  if (dayDelta === 1) return `Tomorrow ${time}`;
  if (dayDelta === -1) return `Yesterday ${time}`;
  return `${DAY_NAMES[deadline.getDay()]} ${time}`;
}

/** Blank schedule for a given anchor, used by the editor's anchor picker. */
export function blankSchedule(anchor: RoutineSchedule['anchor']): RoutineSchedule {
  switch (anchor) {
    case 'bedtime':
      return { anchor: 'bedtime' };
    case 'time':
      return { anchor: 'time', deadlineHHMM: '09:00', daysOfWeek: [] };
    case 'none':
      return { anchor: 'none' };
  }
}

/** Sort routines for display: active first, then sortOrder. */
export function sortRoutines(routines: Routine[]): Routine[] {
  return [...routines].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return a.sortOrder - b.sortOrder;
  });
}
