import { describe, it, expect } from 'vitest';
import {
  formatTime12h,
  subtractMinutes,
  addMinutes,
  calculateSchedule,
  isTimeAfter,
  createBlankNightLog,
} from '../utils';

describe('formatTime12h', () => {
  it('formats midnight', () => {
    expect(formatTime12h('00:00')).toBe('12:00 AM');
  });

  it('formats noon', () => {
    expect(formatTime12h('12:00')).toBe('12:00 PM');
  });

  it('formats morning time', () => {
    expect(formatTime12h('04:43')).toBe('4:43 AM');
  });

  it('formats evening time', () => {
    expect(formatTime12h('21:13')).toBe('9:13 PM');
  });

  it('formats 1 PM', () => {
    expect(formatTime12h('13:05')).toBe('1:05 PM');
  });
});

describe('subtractMinutes', () => {
  it('subtracts within same day', () => {
    expect(subtractMinutes('10:00', 30)).toBe('09:30');
  });

  it('wraps around midnight', () => {
    expect(subtractMinutes('00:30', 60)).toBe('23:30');
  });

  it('subtracts hours', () => {
    expect(subtractMinutes('09:00', 150)).toBe('06:30');
  });
});

describe('addMinutes', () => {
  it('adds within same day', () => {
    expect(addMinutes('10:00', 30)).toBe('10:30');
  });

  it('wraps around midnight', () => {
    expect(addMinutes('23:30', 60)).toBe('00:30');
  });
});

describe('calculateSchedule', () => {
  it('calculates correct schedule for 4:43 AM alarm', () => {
    const schedule = calculateSchedule('04:43');
    expect(schedule.targetBedtime).toBe('21:13'); // 4:43 - 7:30
    expect(schedule.eatingCutoff).toBe('18:43'); // 21:13 - 2:30
    expect(schedule.supplementTime).toBe('20:28'); // 21:13 - 0:45
  });

  it('calculates correct schedule for 6:15 AM alarm', () => {
    const schedule = calculateSchedule('06:15');
    expect(schedule.targetBedtime).toBe('22:45');
    expect(schedule.eatingCutoff).toBe('20:15');
    expect(schedule.supplementTime).toBe('22:00');
  });

  it('calculates correct schedule for 7:15 AM alarm', () => {
    const schedule = calculateSchedule('07:15');
    expect(schedule.targetBedtime).toBe('23:45');
    expect(schedule.eatingCutoff).toBe('21:15');
    expect(schedule.supplementTime).toBe('23:00');
  });
});

describe('isTimeAfter', () => {
  it('returns true when a is after b', () => {
    expect(isTimeAfter('22:00', '21:00')).toBe(true);
  });

  it('returns false when a is before b', () => {
    expect(isTimeAfter('21:00', '22:00')).toBe(false);
  });

  it('returns false when equal', () => {
    expect(isTimeAfter('21:00', '21:00')).toBe(false);
  });
});

describe('createBlankNightLog', () => {
  it('creates a NightLog with correct defaults', () => {
    const alarm = {
      expectedAlarmTime: '04:43',
      actualAlarmTime: '04:43',
      isOverridden: false,
      targetBedtime: '21:13',
      eatingCutoff: '18:43',
      supplementTime: '20:28',
    };
    const log = createBlankNightLog('2026-04-06', alarm);

    expect(log.id).toBeTruthy();
    expect(log.date).toBe('2026-04-06');
    expect(log.alarm).toEqual(alarm);
    expect(log.stack.baseStackUsed).toBe(true);
    expect(log.stack.deviations).toEqual([]);
    expect(log.sleepData).toBeNull();
    expect(log.wakeUpEvents).toEqual([]);
    expect(log.clothing).toEqual([]);
    expect(log.bedding).toEqual([]);
    expect(log.eveningIntake.flags).toHaveLength(5);
    expect(log.eveningIntake.flags.every((f) => !f.active)).toBe(true);
  });
});
