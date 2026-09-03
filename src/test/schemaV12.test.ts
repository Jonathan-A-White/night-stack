import { describe, it, expect, beforeEach } from 'vitest';
import Dexie from 'dexie';
import { db, seedDatabase } from '../db';

/**
 * Upgrade tests: build a real v11 database with fake-indexeddb, then open
 * the app's NightStackDB on top of it and assert the v12 backfills.
 *
 * `db` is a module singleton, so each test deletes the database first,
 * seeds a throwaway v11 instance, closes it, then re-opens `db`.
 */

const V11_STORES = {
  nightLogs: 'id, date',
  supplementDefs: 'id, sortOrder',
  clothingItems: 'id, sortOrder',
  beddingItems: 'id, sortOrder',
  wakeUpCauses: 'id, sortOrder',
  bedtimeReasons: 'id, sortOrder',
  alarmSchedules: 'id, dayOfWeek',
  sleepRules: 'id, priority',
  appSettings: 'id',
  weightEntries: 'id, date, nightLogId, timestamp',
  middayCopingItems: 'id, sortOrder',
  routineSteps: 'id, sortOrder',
  routineVariants: 'id, sortOrder',
  routineSessions: 'id, date, startedAt',
};

type Loose = Record<string, unknown>;

function v11Night(id: string, date: string, highSalt: boolean | null, events: Loose[] = []): Loose {
  const flags: Loose[] = [{ type: 'overate', label: 'Overate', active: false }];
  if (highSalt !== null) flags.push({ type: 'high_salt', label: 'High salt', active: highSalt });
  return {
    id, date, createdAt: 1, updatedAt: 1,
    alarm: { expectedAlarmTime: '04:43', actualAlarmTime: '04:43', isOverridden: false, targetBedtime: '21:13', eatingCutoff: '18:43', supplementTime: '20:28' },
    loggedBedtime: null,
    stack: { baseStackUsed: true, deviations: [] },
    eveningIntake: { lastMealTime: '', foodDescription: '', flags, alcohol: null, liquidIntake: '' },
    environment: { roomTempF: null, roomHumidity: null, externalWeather: null, acCurveProfile: 'off', acSetpointF: null, fanSpeed: 'off' },
    clothing: [], bedding: [], sleepData: null, roomTimeline: null,
    wakeUpEvents: events, bedtimeExplanation: null,
    middayStruggle: { hadStruggle: false, copingItemIds: [], struggleTime: '', intensity: null, notes: '' },
    eveningNotes: '', morningNotes: '',
    thermalComfort: null, thermalComfortSource: null, thermalProxyDismissed: false,
  };
}

function v11Weight(id: string, date: string, period: 'morning' | 'evening', ts: number, lbs: number, measured = true): Loose {
  return { id, nightLogId: null, date, time: '07:00', timestamp: ts, weightLbs: lbs, period, createdAt: ts, measured };
}

const V11_SETTINGS: Loose = {
  id: 'default', latitude: 41.37, longitude: -73.41, darkMode: true, notificationsEnabled: true,
  notificationPreferences: { eatingCutoff: true, supplementReminder: false, bedtimeWarning: true, bedtime: true, morningLog: true },
  unitSystem: 'us', weighInPeriod: 'morning', sex: null, heightInches: null, startingWeightLbs: null, age: null, acInstalled: false,
};

async function seedV11(fixture: { nightLogs?: Loose[]; weightEntries?: Loose[]; sleepRules?: Loose[]; appSettings?: Loose[] }) {
  await db.delete();
  const old = new Dexie('nightstack');
  old.version(11).stores(V11_STORES);
  await old.open();
  if (fixture.nightLogs) await old.table('nightLogs').bulkAdd(fixture.nightLogs);
  if (fixture.weightEntries) await old.table('weightEntries').bulkAdd(fixture.weightEntries);
  if (fixture.sleepRules) await old.table('sleepRules').bulkAdd(fixture.sleepRules);
  if (fixture.appSettings) await old.table('appSettings').bulkAdd(fixture.appSettings);
  old.close();
  await db.open();
}

function walkForUndefined(value: unknown, path: string, out: string[]) {
  if (value === undefined) { out.push(path); return; }
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) { value.forEach((v, i) => walkForUndefined(v, `${path}[${i}]`, out)); return; }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) walkForUndefined(v, `${path}.${k}`, out);
}

describe('v12 migration', () => {
  beforeEach(async () => {
    await db.delete();
  });

  it('derives sodiumLevel from the high_salt flag and removes the flag', async () => {
    await seedV11({
      nightLogs: [
        v11Night('a', '2026-04-06', true),
        v11Night('b', '2026-04-07', false),
        v11Night('c', '2026-04-08', null),
      ],
    });
    const a = (await db.nightLogs.get('a'))!;
    const b = (await db.nightLogs.get('b'))!;
    const c = (await db.nightLogs.get('c'))!;
    expect(a.eveningIntake.sodiumLevel).toBe('more');
    expect(a.eveningIntake.sodiumLevelSource).toBe('proxy');
    expect(b.eveningIntake.sodiumLevel).toBe('normal');
    expect(c.eveningIntake.sodiumLevel).toBe('normal');
    for (const log of [a, b, c]) {
      expect(log.eveningIntake.flags.some((f) => (f.type as string) === 'high_salt')).toBe(false);
      expect(log.eveningIntake.flags.map((f) => f.type)).toEqual(['overate']);
      expect(log.eveningIntake.sodiumSources).toEqual([]);
      expect(log.electrolyteDose).toBeNull();
      expect(log.positionStarted).toBe('unknown');
      expect(log.positionAtWake).toBe('unknown');
      expect(log.wiredWake).toBe(false);
      expect(log.autoCreated).toBe(false);
      expect(log.experimentNotes).toBe('');
    }
  });

  it('backfills episode defaults on every wake-up event', async () => {
    await seedV11({
      nightLogs: [
        v11Night('a', '2026-04-06', true, [
          { id: 'w1', startTime: '03:10', endTime: '03:30', cause: 'x', fellBackAsleep: 'yes', minutesToFallBackAsleep: 20, notes: '', wasSweating: true, feltCold: false, racingHeart: false },
          { id: 'w2', startTime: '04:40', endTime: '', cause: '', fellBackAsleep: 'no', minutesToFallBackAsleep: null, notes: '', wasSweating: false, feltCold: false, racingHeart: true },
        ]),
      ],
    });
    const a = (await db.nightLogs.get('a'))!;
    expect(a.wakeUpEvents).toHaveLength(2);
    for (const ev of a.wakeUpEvents) {
      expect(ev.positionAtWake).toBe('unknown');
      expect(ev.ecgTaken).toBe(false);
      expect(ev.ecgVerdict).toBe('not_taken');
      expect(ev.rhythmFelt).toBeNull();
      expect(ev.lyingBp).toBeNull();
      expect(ev.minutesToSettle).toBeNull();
      expect(ev.wired).toBe(false);
      expect(ev.capturedAt).toBeNull();
      expect(ev.source).toBe('morning');
    }
    expect(a.wakeUpEvents[0].wasSweating).toBe(true);
    expect(a.wakeUpEvents[1].racingHeart).toBe(true);
  });

  it('copies weight entries into bodyMeasurements with ids preserved and keeps the old table', async () => {
    const rows = [
      v11Weight('w1', '2026-04-01', 'morning', 1_000, 170.0),
      v11Weight('w2', '2026-04-02', 'morning', 2_000, 170.4),
      v11Weight('w3', '2026-04-02', 'evening', 2_500, 171.8),
      v11Weight('w4', '2026-04-03', 'morning', 3_000, 170.2, false),
      v11Weight('w5', '2026-04-04', 'morning', 4_000, 169.9),
      v11Weight('w6', '2026-04-05', 'morning', 5_000, 170.1),
      v11Weight('w7', '2026-04-06', 'morning', 6_000, 170.6),
    ];
    await seedV11({ weightEntries: rows });
    const bms = await db.bodyMeasurements.orderBy('timestamp').toArray();
    expect(bms).toHaveLength(7);
    expect(bms.every((b) => b.kind === 'weight')).toBe(true);
    for (const src of rows) {
      const bm = bms.find((b) => b.id === src.id)!;
      expect(bm).toBeDefined();
      expect(bm.date).toBe(src.date);
      expect(bm.time).toBe(src.time);
      expect(bm.timestamp).toBe(src.timestamp);
      expect(bm.period).toBe(src.period);
      expect(bm.measured).toBe(src.measured);
      expect(bm.createdAt).toBe(src.createdAt);
      expect(bm.value).toBe(src.weightLbs);
    }
    expect(await db.weightEntries.count()).toBe(7);
  });

  it('adds reminder preferences and the calibration date to settings', async () => {
    await seedV11({ appSettings: [V11_SETTINGS] });
    const s = (await db.appSettings.get('default'))!;
    expect(s.notificationPreferences.amVitals).toBe(false);
    expect(s.notificationPreferences.pmVitals).toBe(false);
    expect(s.notificationPreferences.bedtimeWeighIn).toBe(false);
    expect(s.notificationPreferences.supplementReminder).toBe(false);
    expect(s.notificationPreferences.bedtime).toBe(true);
    expect(s.watchBpCalibratedAt).toBeNull();
  });

  it('seeds the two new rules exactly once for upgraders', async () => {
    await seedV11({
      sleepRules: [
        { id: 'r1', name: 'Full glycinate dose', condition: { combinator: 'and', clauses: [{ kind: 'always' }] }, recommendation: 'x', priority: 'high', isActive: true, source: 'seeded', createdAt: 1 },
      ],
      appSettings: [V11_SETTINGS],
    });
    let rules = await db.sleepRules.toArray();
    expect(rules.filter((r) => r.name === 'Salt night — side sleep')).toHaveLength(1);
    expect(rules.filter((r) => r.name === 'Orthostatic flag')).toHaveLength(1);
    const salt = rules.find((r) => r.name === 'Salt night — side sleep')!;
    expect(salt.recommendation).toBe('Sleep on your side tonight.');
    expect(salt.condition.clauses).toEqual([{ kind: 'high_salt_and_supine' }]);
    const ortho = rules.find((r) => r.name === 'Orthostatic flag')!;
    expect(ortho.recommendation).toBe("Bring today's orthostatic reading to the doctor.");
    expect(ortho.condition.clauses).toEqual([{ kind: 'orthostatic_flag_today' }]);
    // Re-open: still one copy each.
    db.close();
    await db.open();
    rules = await db.sleepRules.toArray();
    expect(rules.filter((r) => r.name === 'Salt night — side sleep')).toHaveLength(1);
    expect(rules.filter((r) => r.name === 'Orthostatic flag')).toHaveLength(1);
  });

  it('fresh install seeds the two rules too', async () => {
    await db.delete();
    await db.open();
    await seedDatabase();
    const rules = await db.sleepRules.toArray();
    expect(rules.filter((r) => r.name === 'Salt night — side sleep')).toHaveLength(1);
    expect(rules.filter((r) => r.name === 'Orthostatic flag')).toHaveLength(1);
    expect(rules.every((r) => r.source === 'seeded' && r.isActive)).toBe(true);
  });

  it('leaves no undefined property anywhere on upgraded night logs or settings', async () => {
    await seedV11({
      nightLogs: [
        v11Night('a', '2026-04-06', true, [
          { id: 'w1', startTime: '03:10', endTime: '', cause: '', fellBackAsleep: 'no', minutesToFallBackAsleep: null, notes: '', wasSweating: false, feltCold: false, racingHeart: false },
        ]),
        v11Night('b', '2026-04-07', null),
      ],
      weightEntries: [v11Weight('w1', '2026-04-07', 'morning', 1_000, 170)],
      appSettings: [V11_SETTINGS],
    });
    const out: string[] = [];
    for (const log of await db.nightLogs.toArray()) walkForUndefined(log, `nightLogs.${log.id}`, out);
    for (const s of await db.appSettings.toArray()) walkForUndefined(s, 'appSettings', out);
    for (const b of await db.bodyMeasurements.toArray()) walkForUndefined(b, `bodyMeasurements.${b.id}`, out);
    expect(out).toEqual([]);
  });
});
