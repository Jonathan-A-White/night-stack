import { describe, it, expect, beforeEach } from 'vitest';
import { db, mergeNightLogDuplicates, seedDatabase } from '../db';
import { createBlankNightLog } from '../utils';
import type { NightLog, SleepData, WakeUpEvent } from '../types';

function makeNightLog(date: string, overrides: Partial<NightLog> = {}): NightLog {
  const log = createBlankNightLog(date, {
    expectedAlarmTime: '06:15',
    actualAlarmTime: '06:15',
    isOverridden: false,
    targetBedtime: '22:45',
    eatingCutoff: '20:15',
    supplementTime: '22:00',
  });
  return { ...log, ...overrides };
}

function makeSleepData(sleepScore: number): SleepData {
  return {
    sleepTime: '22:30',
    wakeTime: '06:15',
    totalSleepDuration: 465,
    actualSleepDuration: 450,
    sleepScore,
    sleepScoreDelta: 0,
    deepSleep: 70,
    remSleep: 90,
    lightSleep: 290,
    awakeDuration: 15,
    avgHeartRate: 52,
    minHeartRate: 45,
    avgRespiratoryRate: 14,
    bloodOxygenAvg: 97,
    skinTempRange: '-0.2 to +0.1',
    sleepLatencyRating: 'Good',
    restfulnessRating: 'Good',
    deepSleepRating: 'Good',
    remSleepRating: 'Good',
    importedAt: Date.now(),
  };
}

function makeWakeUpEvent(): WakeUpEvent {
  return {
    id: 'wake-1',
    startTime: '03:00',
    endTime: '03:15',
    cause: 'bathroom',
    fellBackAsleep: 'yes',
    minutesToFallBackAsleep: 15,
    notes: '',
  };
}

describe('seedDatabase', () => {
  beforeEach(async () => {
    // Clear all tables before each test
    await db.delete();
    await db.open();
  });

  it('seeds all configuration tables on first run', async () => {
    await seedDatabase();

    const settings = await db.appSettings.get('default');
    expect(settings).not.toBeNull();
    expect(settings!.latitude).toBe(41.37);
    expect(settings!.longitude).toBe(-73.41);
    expect(settings!.darkMode).toBe(true);
    expect(settings!.unitSystem).toBe('us');
    expect(settings!.weighInPeriod).toBe('morning');
    expect(settings!.sex).toBeNull();
    expect(settings!.heightInches).toBeNull();
    expect(settings!.startingWeightLbs).toBeNull();
    expect(settings!.age).toBeNull();

    const schedules = await db.alarmSchedules.toArray();
    expect(schedules).toHaveLength(7);

    const supplements = await db.supplementDefs.toArray();
    expect(supplements).toHaveLength(13);
    expect(supplements.find((s) => s.name === 'Magnesium Glycinate')).toBeTruthy();

    const clothing = await db.clothingItems.toArray();
    expect(clothing).toHaveLength(6);

    const bedding = await db.beddingItems.toArray();
    expect(bedding).toHaveLength(6);

    const copingItems = await db.middayCopingItems.toArray();
    expect(copingItems).toHaveLength(7);
    expect(copingItems.find((i) => i.name === 'Ginger juice / tea')?.type).toBe('drink');
    expect(copingItems.find((i) => i.name === 'Peanuts')?.type).toBe('food');
    expect(copingItems.find((i) => i.name === '30 minute power nap')?.type).toBe('nap');

    const causes = await db.wakeUpCauses.toArray();
    expect(causes).toHaveLength(8);

    const reasons = await db.bedtimeReasons.toArray();
    expect(reasons).toHaveLength(8);

    const rules = await db.sleepRules.toArray();
    expect(rules).toHaveLength(12);
    expect(rules.every((r) => r.source === 'seeded')).toBe(true);
    expect(rules.every((r) => r.isActive)).toBe(true);
  });

  it('does not re-seed if already seeded', async () => {
    await seedDatabase();
    const firstRules = await db.sleepRules.toArray();

    await seedDatabase(); // second call
    const secondRules = await db.sleepRules.toArray();

    expect(secondRules).toHaveLength(firstRules.length);
  });

  it('seeds correct alarm schedule', async () => {
    await seedDatabase();
    const schedules = await db.alarmSchedules.orderBy('dayOfWeek').toArray();

    // Sunday
    expect(schedules[0].hasAlarm).toBe(false);
    expect(schedules[0].naturalWakeTime).toBe('07:15');

    // Monday
    expect(schedules[1].hasAlarm).toBe(true);
    expect(schedules[1].alarmTime).toBe('04:43');

    // Wednesday
    expect(schedules[3].hasAlarm).toBe(true);
    expect(schedules[3].alarmTime).toBe('06:15');

    // Saturday
    expect(schedules[6].hasAlarm).toBe(false);
  });

  it('seeds all sleep rules with correct priorities', async () => {
    await seedDatabase();
    const rules = await db.sleepRules.toArray();

    const highRules = rules.filter((r) => r.priority === 'high');
    const medRules = rules.filter((r) => r.priority === 'medium');
    const lowRules = rules.filter((r) => r.priority === 'low');

    // 10 legacy rules + 2 midday coping rules (medium + low)
    expect(highRules).toHaveLength(5);
    expect(medRules).toHaveLength(5);
    expect(lowRules).toHaveLength(2);
  });
});

describe('mergeNightLogDuplicates', () => {
  it('returns the single log unchanged when there are no duplicates', () => {
    const log = makeNightLog('2026-04-09');
    expect(mergeNightLogDuplicates([log])).toBe(log);
  });

  it('picks the log with sleepData as the winner', () => {
    const bare = makeNightLog('2026-04-09', {
      id: 'bare',
      updatedAt: 2000,
      stack: { baseStackUsed: true, deviations: [
        { id: 'd1', supplementId: 's1', deviation: 'skipped', notes: '' },
      ] },
    });
    const full = makeNightLog('2026-04-09', {
      id: 'full',
      updatedAt: 1000, // older, but has sleepData
      sleepData: makeSleepData(82),
      wakeUpEvents: [makeWakeUpEvent()],
    });

    const merged = mergeNightLogDuplicates([bare, full]);

    expect(merged.id).toBe('full');
    expect(merged.sleepData?.sleepScore).toBe(82);
    expect(merged.wakeUpEvents).toHaveLength(1);
  });

  it('breaks ties on score by updatedAt (most recent wins)', () => {
    const older = makeNightLog('2026-04-09', { id: 'older', updatedAt: 1000 });
    const newer = makeNightLog('2026-04-09', { id: 'newer', updatedAt: 2000 });

    const merged = mergeNightLogDuplicates([older, newer]);

    expect(merged.id).toBe('newer');
  });

  it('fills blank fields on the winner from losers', () => {
    const winner = makeNightLog('2026-04-09', {
      id: 'winner',
      sleepData: makeSleepData(90),
      updatedAt: 2000,
      eveningNotes: '',
    });
    const loser = makeNightLog('2026-04-09', {
      id: 'loser',
      updatedAt: 1000,
      wakeUpEvents: [makeWakeUpEvent()],
      eveningNotes: 'felt good',
    });

    const merged = mergeNightLogDuplicates([winner, loser]);

    expect(merged.id).toBe('winner');
    expect(merged.sleepData?.sleepScore).toBe(90);
    // winner had no wake-ups, should inherit from loser
    expect(merged.wakeUpEvents).toHaveLength(1);
    expect(merged.eveningNotes).toBe('felt good');
  });

  it('preserves the earliest createdAt across all logs', () => {
    const a = makeNightLog('2026-04-09', { id: 'a', createdAt: 5000, updatedAt: 5000 });
    const b = makeNightLog('2026-04-09', { id: 'b', createdAt: 1000, updatedAt: 1000 });
    const c = makeNightLog('2026-04-09', { id: 'c', createdAt: 3000, updatedAt: 3000 });

    const merged = mergeNightLogDuplicates([a, b, c]);

    expect(merged.createdAt).toBe(1000);
  });

  it('throws on an empty list', () => {
    expect(() => mergeNightLogDuplicates([])).toThrow();
  });
});

describe('v8 nightLogs dedupe migration', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('collapses duplicate night logs for the same date to one entry', async () => {
    // Simulate the pre-fix state: two night logs for the same date with
    // different UUIDs, one carrying morning data and one not.
    const dup1 = makeNightLog('2026-04-09', {
      id: 'dup-1',
      createdAt: 1000,
      updatedAt: 1000,
      wakeUpEvents: [makeWakeUpEvent()],
      sleepData: makeSleepData(70),
      stack: { baseStackUsed: true, deviations: [
        { id: 'd1', supplementId: 's1', deviation: 'skipped', notes: '' },
        { id: 'd2', supplementId: 's2', deviation: 'skipped', notes: '' },
        { id: 'd3', supplementId: 's3', deviation: 'skipped', notes: '' },
      ] },
    });
    const dup2 = makeNightLog('2026-04-09', {
      id: 'dup-2',
      createdAt: 2000,
      updatedAt: 2000,
      sleepData: makeSleepData(83),
      wakeUpEvents: [makeWakeUpEvent()],
      stack: { baseStackUsed: true, deviations: [
        { id: 'd4', supplementId: 's1', deviation: 'skipped', notes: '' },
        { id: 'd5', supplementId: 's2', deviation: 'skipped', notes: '' },
        { id: 'd6', supplementId: 's3', deviation: 'skipped', notes: '' },
        { id: 'd7', supplementId: 's4', deviation: 'skipped', notes: '' },
        { id: 'd8', supplementId: 's5', deviation: 'skipped', notes: '' },
        { id: 'd9', supplementId: 's6', deviation: 'skipped', notes: '' },
      ] },
    });
    const unique = makeNightLog('2026-04-08', {
      id: 'solo',
      createdAt: 500,
      updatedAt: 500,
      sleepData: makeSleepData(64),
    });

    await db.nightLogs.bulkAdd([dup1, dup2, unique]);

    // Re-opening the db after bulkAdd doesn't re-run upgrades, so drive the
    // migration logic directly through the same code path the upgrade uses.
    // (A full version jump test would require owning the Dexie schema lifecycle.)
    const all = await db.nightLogs.toArray();
    const byDate = new Map<string, NightLog[]>();
    for (const log of all) {
      const bucket = byDate.get(log.date);
      if (bucket) bucket.push(log);
      else byDate.set(log.date, [log]);
    }
    for (const group of byDate.values()) {
      if (group.length <= 1) continue;
      const winner = mergeNightLogDuplicates(group);
      const loserIds = group.filter((l) => l.id !== winner.id).map((l) => l.id);
      await db.nightLogs.bulkDelete(loserIds);
      await db.nightLogs.put(winner);
    }

    const remaining = await db.nightLogs.orderBy('date').toArray();
    expect(remaining).toHaveLength(2);

    const forApril9 = remaining.filter((l) => l.date === '2026-04-09');
    expect(forApril9).toHaveLength(1);
    // dup2 had the same sleepData-presence but was newer, so it wins on the
    // tie-breaker (updatedAt). It also had strictly more deviations.
    expect(forApril9[0].id).toBe('dup-2');
    expect(forApril9[0].sleepData?.sleepScore).toBe(83);

    // The standalone entry for 2026-04-08 must not be touched.
    const forApril8 = remaining.filter((l) => l.date === '2026-04-08');
    expect(forApril8).toHaveLength(1);
    expect(forApril8[0].id).toBe('solo');
  });
});
