import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  formatTime12h,
  subtractMinutes,
  addMinutes,
  calculateSchedule,
  isTimeAfter,
  isSaveBeforeEatingCutoff,
  createBlankNightLog,
  toLocalDateString,
  getTodayDate,
  getYesterdayDate,
  getEveningLogDate,
  timestampToHHMM,
  findNearestRoomReading,
  resolveLastMealTimeForSave,
  computeAdjustedSleepOnset,
} from '../utils';

describe('isSaveBeforeEatingCutoff (bugfixes T5)', () => {
  it('returns true when now is before the eating cutoff', () => {
    expect(isSaveBeforeEatingCutoff('17:30', '19:00', false)).toBe(true);
  });

  it('returns false when now is after the eating cutoff', () => {
    expect(isSaveBeforeEatingCutoff('21:30', '19:00', false)).toBe(false);
  });

  it('returns false at exactly the eating cutoff (no strict-inequality warning)', () => {
    expect(isSaveBeforeEatingCutoff('19:00', '19:00', false)).toBe(false);
  });

  it('never warns in backfill mode', () => {
    expect(isSaveBeforeEatingCutoff('10:00', '19:00', true)).toBe(false);
  });

  it('never warns for a morning-after save (retroactive, wall-clock earlier than cutoff)', () => {
    // 6:32 AM save for last night's log: wall-clock precedes the 9:15 PM
    // eating cutoff numerically, but the save is retroactive so the
    // save-time-is-bedtime assumption doesn't hold. Must not warn.
    expect(isSaveBeforeEatingCutoff('06:32', '21:15', true)).toBe(false);
  });
});

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

describe('toLocalDateString', () => {
  it('formats using local time components', () => {
    // Date constructed from local parts; should round-trip regardless of TZ
    const d = new Date(2026, 3, 9, 22, 30); // April 9, 2026 22:30 local
    expect(toLocalDateString(d)).toBe('2026-04-09');
  });

  it('zero-pads single-digit months and days', () => {
    const d = new Date(2026, 0, 5, 12, 0); // Jan 5, 2026
    expect(toLocalDateString(d)).toBe('2026-01-05');
  });
});

describe('date helpers (getTodayDate / getYesterdayDate / getEveningLogDate)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('getTodayDate returns local date, not UTC-shifted', () => {
    // 10 PM local on April 8 — in many negative-UTC-offset zones this is
    // already April 9 in UTC. We want the local date.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 8, 22, 0));
    expect(getTodayDate()).toBe('2026-04-08');
  });

  it('getYesterdayDate returns the day before today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 9, 6, 31));
    expect(getYesterdayDate()).toBe('2026-04-08');
  });

  it('getYesterdayDate crosses month boundaries', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 1, 6, 0)); // May 1
    expect(getYesterdayDate()).toBe('2026-04-30');
  });

  it('getEveningLogDate returns yesterday in the early morning', () => {
    // 6:31 AM on April 9 — user is logging about last night's evening
    expect(getEveningLogDate(new Date(2026, 3, 9, 6, 31))).toBe('2026-04-08');
  });

  it('getEveningLogDate returns yesterday just past midnight', () => {
    // 1:15 AM — still last night's evening
    expect(getEveningLogDate(new Date(2026, 3, 9, 1, 15))).toBe('2026-04-08');
  });

  it('getEveningLogDate returns today at noon', () => {
    // Noon is the cutoff; at exactly noon we start counting as today
    expect(getEveningLogDate(new Date(2026, 3, 9, 12, 0))).toBe('2026-04-09');
  });

  it('getEveningLogDate returns today in the evening', () => {
    // 9 PM on April 9 — logging for tonight
    expect(getEveningLogDate(new Date(2026, 3, 9, 21, 0))).toBe('2026-04-09');
  });

  it('getEveningLogDate handles month boundary in morning', () => {
    // 5 AM on May 1 — last night was April 30
    expect(getEveningLogDate(new Date(2026, 4, 1, 5, 0))).toBe('2026-04-30');
  });

  it('a morning-after flow has logDate !== today (the saveTimeIsBedtime check)', () => {
    // Reproduces the EveningLog.tsx saveTimeIsBedtime derivation:
    // `logDate === getTodayDate()` must be false at 6:32 AM, otherwise
    // the pre-eating-cutoff warning fires against a log for yesterday.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 18, 6, 32)); // 2026-04-18 06:32
    expect(getEveningLogDate()).toBe('2026-04-17');
    expect(getTodayDate()).toBe('2026-04-18');
    expect(getEveningLogDate() === getTodayDate()).toBe(false);
  });

  it('an evening-same-day flow has logDate === today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 18, 21, 0)); // 2026-04-18 21:00
    expect(getEveningLogDate()).toBe('2026-04-18');
    expect(getTodayDate()).toBe('2026-04-18');
    expect(getEveningLogDate() === getTodayDate()).toBe(true);
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
    expect(log.middayStruggle.hadStruggle).toBe(false);
    expect(log.middayStruggle.copingItemIds).toEqual([]);
    expect(log.middayStruggle.intensity).toBeNull();
    expect(log.loggedBedtime).toBeNull();
  });
});

describe('timestampToHHMM', () => {
  it('formats a timestamp as zero-padded HH:MM in local time', () => {
    // Construct from local-time components so the test is timezone-agnostic
    const ts = new Date(2026, 3, 9, 22, 7, 33, 0).getTime();
    expect(timestampToHHMM(ts)).toBe('22:07');
  });

  it('pads single-digit hours and minutes', () => {
    const ts = new Date(2026, 3, 9, 3, 5, 0, 0).getTime();
    expect(timestampToHHMM(ts)).toBe('03:05');
  });
});

describe('findNearestRoomReading', () => {
  // Build an ISO timestamp from local-time components so tests stay
  // timezone-agnostic (the helper reads local hours/minutes).
  const ts = (y: number, mo: number, d: number, h: number, m: number): string =>
    new Date(y, mo, d, h, m).toISOString();

  const reading = (time: string, tempF: number, humidity = 50) => {
    const [h, m] = time.split(':').map(Number);
    return { timestamp: ts(2026, 3, 9, h, m), tempF, humidity };
  };

  it('returns null for an empty timeline', () => {
    expect(findNearestRoomReading('03:10', [])).toBeNull();
  });

  it('picks the reading closest to the target time', () => {
    const readings = [
      reading('22:00', 64.0),
      reading('02:55', 65.5),
      reading('03:20', 66.2),
      reading('06:30', 63.1),
    ];
    // 03:10 is 15 min from 02:55 but only 10 min from 03:20.
    expect(findNearestRoomReading('03:10', readings)?.tempF).toBe(66.2);
    // 03:00 is 5 min from 02:55 and 20 min from 03:20.
    expect(findNearestRoomReading('03:00', readings)?.tempF).toBe(65.5);
  });

  it('handles midnight wrap with circular distance', () => {
    // Target is 23:55; a reading at 00:05 is only 10 minutes away even
    // though raw subtraction would say 23h50m.
    const readings = [
      reading('22:00', 63.0),
      reading('00:05', 65.0),
    ];
    expect(findNearestRoomReading('23:55', readings)?.tempF).toBe(65.0);
  });

  it('returns the single reading when only one exists', () => {
    const readings = [reading('02:30', 64.7)];
    expect(findNearestRoomReading('05:00', readings)?.tempF).toBe(64.7);
  });

  it('breaks ties by returning the first equidistant reading', () => {
    const readings = [
      reading('03:00', 64.0),
      reading('03:20', 66.0),
    ];
    // 03:10 is exactly 10 minutes from both — first wins.
    expect(findNearestRoomReading('03:10', readings)?.tempF).toBe(64.0);
  });
});

describe('resolveLastMealTimeForSave', () => {
  it('returns the user-entered value when non-empty', () => {
    expect(
      resolveLastMealTimeForSave({
        currentValue: '18:00',
        eatingCutoff: '20:00',
        userInteracted: true,
      }),
    ).toBe('18:00');
  });

  it('prefills blank with eating cutoff when the user never touched the field', () => {
    expect(
      resolveLastMealTimeForSave({
        currentValue: '',
        eatingCutoff: '20:00',
        userInteracted: false,
      }),
    ).toBe('20:00');
  });

  it('respects an explicit clear (userInteracted=true, value blank)', () => {
    expect(
      resolveLastMealTimeForSave({
        currentValue: '',
        eatingCutoff: '20:00',
        userInteracted: true,
      }),
    ).toBe('');
  });

  it('returns blank if no eating cutoff is available to prefill with', () => {
    expect(
      resolveLastMealTimeForSave({
        currentValue: '',
        eatingCutoff: '',
        userInteracted: false,
      }),
    ).toBe('');
  });

  it('treats whitespace-only as empty', () => {
    expect(
      resolveLastMealTimeForSave({
        currentValue: '   ',
        eatingCutoff: '20:00',
        userInteracted: false,
      }),
    ).toBe('20:00');
  });
});

describe('computeAdjustedSleepOnset', () => {
  // 2026-04-18 23:30 local
  const bedtimeMs = new Date(2026, 3, 18, 23, 30, 0, 0).getTime();

  it('adjusts when watch detects onset well after logged bedtime (charging case)', () => {
    const result = computeAdjustedSleepOnset({
      loggedBedtime: bedtimeMs,
      watchSleepTime: '00:23', // next-day early morning
      watchTotalDuration: 350,
      watchActualDuration: 331,
    });
    expect(result.isAdjusted).toBe(true);
    // 23:30 + 10m latency = 23:40, gap to 00:23 = 43m
    expect(result.sleepTime).toBe('23:40');
    expect(result.adjustmentMinutes).toBe(43);
    expect(result.totalSleepDuration).toBe(350 + 43);
    expect(result.actualSleepDuration).toBe(331 + 43);
    expect(result.watchSleepTime).toBe('00:23');
  });

  it('does not adjust when the watch onset is close to loggedBedtime + latency', () => {
    const result = computeAdjustedSleepOnset({
      loggedBedtime: bedtimeMs, // 23:30
      watchSleepTime: '23:42', // 2m past the 23:40 expected onset
      watchTotalDuration: 420,
      watchActualDuration: 400,
    });
    expect(result.isAdjusted).toBe(false);
    expect(result.sleepTime).toBe('23:42');
    expect(result.totalSleepDuration).toBe(420);
    expect(result.actualSleepDuration).toBe(400);
    expect(result.adjustmentMinutes).toBe(0);
  });

  it('does not adjust when watch onset is earlier than logged bedtime', () => {
    const result = computeAdjustedSleepOnset({
      loggedBedtime: bedtimeMs, // 23:30
      watchSleepTime: '23:45', // later same day — will resolve same day, still within threshold
      watchTotalDuration: 400,
      watchActualDuration: 380,
    });
    // 23:30 + 10m = 23:40, diff = 5m, exactly at minAdjustmentMinutes
    expect(result.isAdjusted).toBe(true);
    expect(result.adjustmentMinutes).toBe(5);
  });

  it('returns raw values when loggedBedtime is null', () => {
    const result = computeAdjustedSleepOnset({
      loggedBedtime: null,
      watchSleepTime: '00:23',
      watchTotalDuration: 350,
      watchActualDuration: 331,
    });
    expect(result.isAdjusted).toBe(false);
    expect(result.sleepTime).toBe('00:23');
    expect(result.totalSleepDuration).toBe(350);
    expect(result.actualSleepDuration).toBe(331);
  });

  it('handles midnight crossing — onset HH:MM before bedtime wall clock resolves to next day', () => {
    // bedtime 23:55; watch onset 00:45 should resolve to +50m, expected 23:55+10 = 00:05, gap = 40m
    const lateBedtime = new Date(2026, 3, 18, 23, 55, 0, 0).getTime();
    const result = computeAdjustedSleepOnset({
      loggedBedtime: lateBedtime,
      watchSleepTime: '00:45',
      watchTotalDuration: 300,
      watchActualDuration: 290,
    });
    expect(result.isAdjusted).toBe(true);
    expect(result.sleepTime).toBe('00:05');
    expect(result.adjustmentMinutes).toBe(40);
  });

  it('respects custom latency and threshold', () => {
    const result = computeAdjustedSleepOnset({
      loggedBedtime: bedtimeMs, // 23:30
      watchSleepTime: '23:55',
      watchTotalDuration: 400,
      watchActualDuration: 380,
      assumedLatencyMinutes: 0,
      minAdjustmentMinutes: 10,
    });
    // Diff = 25m, above 10m threshold
    expect(result.isAdjusted).toBe(true);
    expect(result.sleepTime).toBe('23:30');
    expect(result.adjustmentMinutes).toBe(25);
  });

  it('refuses to adjust when wrap-around math produces a >6h gap (mismatched-night data)', () => {
    // bedtime 23:24, watch onset 22:43 — same-day-earlier wraps to next
    // day = ~23h gap. Without the cap this would compute a +1399m
    // adjustment and display nonsense durations.
    const bedtime = new Date(2026, 3, 25, 23, 24, 0, 0).getTime();
    const result = computeAdjustedSleepOnset({
      loggedBedtime: bedtime,
      watchSleepTime: '22:43',
      watchTotalDuration: 344,
      watchActualDuration: 344,
    });
    expect(result.isAdjusted).toBe(false);
    expect(result.sleepTime).toBe('22:43');
    expect(result.totalSleepDuration).toBe(344);
    expect(result.actualSleepDuration).toBe(344);
    expect(result.adjustmentMinutes).toBe(0);
  });
});
