import { describe, it, expect } from 'vitest';
import {
  blankSchedule,
  deadlineCountdownLabel,
  describeDeadline,
  describeSchedule,
  resolveBedtimeDeadline,
  resolveDeadline,
  resolveFixedDeadline,
  sortRoutines,
} from '../services/routineSchedule';
import { computeRecommendedStart, computeRecommendedStartFromDeadline } from '../services/routineAnalytics';
import type { Routine } from '../types';

// 2026-09-06 is a Sunday.
const SUNDAY_0730 = new Date(2026, 8, 6, 7, 30);
const SATURDAY_2000 = new Date(2026, 8, 5, 20, 0);
const SUNDAY_1000 = new Date(2026, 8, 6, 10, 0);
const SUNDAY_1400 = new Date(2026, 8, 6, 14, 0);

describe('resolveFixedDeadline', () => {
  it('returns today when the deadline is still ahead on an allowed day', () => {
    const d = resolveFixedDeadline('09:45', [0], SUNDAY_0730)!;
    expect(d.getDay()).toBe(0);
    expect(d.getDate()).toBe(6);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(45);
  });

  it('rolls to the next allowed day from a non-allowed day', () => {
    const d = resolveFixedDeadline('09:45', [0], SATURDAY_2000)!;
    expect(d.getDay()).toBe(0);
    expect(d.getDate()).toBe(6);
  });

  it('keeps today within the grace window after the deadline passed', () => {
    // 10:00 is 15 min past 09:45 → still today (grace 3 h).
    const d = resolveFixedDeadline('09:45', [0], SUNDAY_1000)!;
    expect(d.getDate()).toBe(6);
  });

  it('moves to next week once the grace window has passed', () => {
    const d = resolveFixedDeadline('09:45', [0], SUNDAY_1400)!;
    expect(d.getDay()).toBe(0);
    expect(d.getDate()).toBe(13);
  });

  it('treats an empty days list as every day', () => {
    // Saturday 20:00 is 2 h past an 18:00 deadline, inside the 3 h grace → still Saturday.
    const d = resolveFixedDeadline('18:00', [], SATURDAY_2000)!;
    expect(d.getDate()).toBe(5);
    // From Saturday 07:00 the deadline is later today.
    expect(resolveFixedDeadline('18:00', [], new Date(2026, 8, 5, 7, 0))!.getDate()).toBe(5);
  });

  it('honors the grace boundary exactly', () => {
    // 21:01 is 3 h 1 min past 18:00 → tomorrow.
    const d = resolveFixedDeadline('18:00', [], new Date(2026, 8, 5, 21, 1))!;
    expect(d.getDate()).toBe(6);
  });

  it('returns null for an unparseable time', () => {
    expect(resolveFixedDeadline('nope', [0], SUNDAY_0730)).toBeNull();
    expect(resolveFixedDeadline('25:00', [0], SUNDAY_0730)).toBeNull();
  });
});

describe('resolveBedtimeDeadline / resolveDeadline', () => {
  it('keeps an evening bedtime on today', () => {
    const d = resolveBedtimeDeadline('21:13', SATURDAY_2000)!;
    expect(d.getDate()).toBe(5);
    expect(d.getHours()).toBe(21);
  });

  it('rolls a past-midnight bedtime to tomorrow when seen in the evening', () => {
    const d = resolveBedtimeDeadline('00:30', SATURDAY_2000)!;
    expect(d.getDate()).toBe(6);
  });

  it('dispatches on the anchor', () => {
    expect(resolveDeadline({ anchor: 'none' }, '21:13', SATURDAY_2000)).toBeNull();
    expect(resolveDeadline({ anchor: 'bedtime' }, null, SATURDAY_2000)).toBeNull();
    expect(resolveDeadline({ anchor: 'bedtime' }, '21:13', SATURDAY_2000)?.getHours()).toBe(21);
    expect(
      resolveDeadline({ anchor: 'time', deadlineHHMM: '09:45', daysOfWeek: [0] }, null, SATURDAY_2000)?.getDay(),
    ).toBe(0);
  });

  it('computeRecommendedStart equals the deadline-based form for a bedtime', () => {
    const viaHHMM = computeRecommendedStart('21:13', 45 * 60_000, SATURDAY_2000)!;
    const viaDeadline = computeRecommendedStartFromDeadline(
      resolveBedtimeDeadline('21:13', SATURDAY_2000),
      45 * 60_000,
    )!;
    expect(viaDeadline.getTime()).toBe(viaHHMM.getTime());
    expect(viaDeadline.getHours()).toBe(20);
    expect(viaDeadline.getMinutes()).toBe(28);
  });

  it('computeRecommendedStartFromDeadline is null without a deadline or buffer', () => {
    expect(computeRecommendedStartFromDeadline(null, 1)).toBeNull();
    expect(computeRecommendedStartFromDeadline(SUNDAY_0730, null)).toBeNull();
  });
});

describe('labels', () => {
  it('describes each schedule', () => {
    expect(describeSchedule({ anchor: 'bedtime' })).toMatch(/bedtime/);
    expect(describeSchedule({ anchor: 'none' })).toBe('No deadline');
    expect(describeSchedule({ anchor: 'time', deadlineHHMM: '09:45', daysOfWeek: [0] })).toBe('Finish by 9:45 AM on Sun');
    expect(describeSchedule({ anchor: 'time', deadlineHHMM: '09:45', daysOfWeek: [] })).toBe('Finish by 9:45 AM every day');
    expect(describeSchedule({ anchor: 'time', deadlineHHMM: '18:00', daysOfWeek: [1, 3, 5] })).toBe('Finish by 6:00 PM on Mon, Wed, Fri');
  });

  it('describes a deadline relative to now', () => {
    expect(describeDeadline(new Date(2026, 8, 6, 9, 45), SUNDAY_0730)).toBe('Today 9:45 AM');
    expect(describeDeadline(new Date(2026, 8, 6, 9, 45), SATURDAY_2000)).toBe('Tomorrow 9:45 AM');
    expect(describeDeadline(new Date(2026, 8, 13, 9, 45), SUNDAY_1400)).toBe('Sunday 9:45 AM');
  });

  it('countdown label depends on the anchor', () => {
    expect(deadlineCountdownLabel({ anchor: 'bedtime' }, false)).toBe('until bed');
    expect(deadlineCountdownLabel({ anchor: 'bedtime' }, true)).toBe('past bedtime');
    expect(deadlineCountdownLabel({ anchor: 'time', deadlineHHMM: '09:45', daysOfWeek: [] }, false)).toBe('until deadline');
    expect(deadlineCountdownLabel({ anchor: 'none' }, true)).toBe('past deadline');
  });

  it('blankSchedule and sortRoutines', () => {
    expect(blankSchedule('time')).toEqual({ anchor: 'time', deadlineHHMM: '09:00', daysOfWeek: [] });
    const mk = (id: string, sortOrder: number, isActive: boolean): Routine => ({
      id, name: id, description: '', schedule: { anchor: 'none' }, isActive, sortOrder, createdAt: 0,
    });
    expect(sortRoutines([mk('b', 2, true), mk('c', 1, false), mk('a', 1, true)]).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});
