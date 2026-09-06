import { describe, it, expect, beforeEach } from 'vitest';
import Dexie from 'dexie';
import { db, seedDatabase } from '../db';
import { EVENING_ROUTINE_ID, SOUND_BOOTH_ROUTINE_NAME } from '../services/routineSeeds';

/**
 * Upgrade tests for the routines generalization: build a real v12
 * database with fake-indexeddb, open the app's NightStackDB on top of it
 * and assert every routine row was stamped with the evening routine and
 * the sound booth SOP was seeded exactly once.
 */

const V12_STORES = {
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
  bodyMeasurements: 'id, date, nightLogId, timestamp, kind, [kind+date+period]',
  orthostaticReadings: 'id, date, timestamp, [date+slot]',
  vitalSamples: '[kind+timestamp], nightLogId, timestamp, importBatchId',
  importBatches: 'id, importedAt',
};

type Loose = Record<string, unknown>;

async function seedV12(fixture: { routineSteps?: Loose[]; routineVariants?: Loose[]; routineSessions?: Loose[] }) {
  await db.delete();
  const old = new Dexie('nightstack');
  old.version(12).stores(V12_STORES);
  await old.open();
  if (fixture.routineSteps) await old.table('routineSteps').bulkAdd(fixture.routineSteps);
  if (fixture.routineVariants) await old.table('routineVariants').bulkAdd(fixture.routineVariants);
  if (fixture.routineSessions) await old.table('routineSessions').bulkAdd(fixture.routineSessions);
  old.close();
  await db.open();
}

const V12_STEPS: Loose[] = [
  { id: 's1', name: 'Dishes', description: '', sortOrder: 1, isActive: true, createdAt: 1 },
  { id: 's2', name: 'Teeth', description: '', sortOrder: 2, isActive: true, createdAt: 1 },
];
const V12_VARIANTS: Loose[] = [
  { id: 'v1', name: 'Full', description: '', stepIds: ['s1', 's2'], isDefault: true, sortOrder: 1, createdAt: 1 },
  { id: 'v2', name: 'Quick', description: '', stepIds: ['s2'], isDefault: false, sortOrder: 2, createdAt: 1 },
];
const V12_SESSIONS: Loose[] = [
  {
    id: 'sess1', date: '2026-09-01', variantId: 'v1', variantName: 'Full', startedAt: 10, endedAt: 20,
    completedAt: 20, totalDurationMs: 10, sessionNotes: '', createdAt: 20,
    steps: [{ stepId: 's1', stepName: 'Dishes', status: 'completed', startedAt: 10, endedAt: 20, durationMs: 10, pbAtStartMs: null, notes: '' }],
  },
];

describe('v13 migration (routines)', () => {
  beforeEach(async () => {
    await db.delete();
  });

  it('stamps every existing step, variant and session with the evening routine', async () => {
    await seedV12({ routineSteps: V12_STEPS, routineVariants: V12_VARIANTS, routineSessions: V12_SESSIONS });
    const evening = await db.routines.get(EVENING_ROUTINE_ID);
    expect(evening).toBeDefined();
    expect(evening!.schedule).toEqual({ anchor: 'bedtime' });
    expect(evening!.isActive).toBe(true);

    for (const id of ['s1', 's2']) {
      const step = (await db.routineSteps.get(id))!;
      expect(step.routineId).toBe(EVENING_ROUTINE_ID);
      expect(step.secretNames).toEqual([]);
    }
    for (const id of ['v1', 'v2']) {
      expect((await db.routineVariants.get(id))!.routineId).toBe(EVENING_ROUTINE_ID);
    }
    expect((await db.routineSessions.get('sess1'))!.routineId).toBe(EVENING_ROUTINE_ID);
    // Indexed queries work on the stamped rows.
    expect(await db.routineSessions.where('routineId').equals(EVENING_ROUTINE_ID).count()).toBe(1);
    expect(await db.routineSessions.where('[routineId+date]').equals([EVENING_ROUTINE_ID, '2026-09-01']).count()).toBe(1);
  });

  it('seeds the sound booth routine once with its steps and a default variant', async () => {
    await seedV12({ routineSteps: V12_STEPS, routineVariants: V12_VARIANTS });
    const booth = (await db.routines.toArray()).filter((r) => r.name === SOUND_BOOTH_ROUTINE_NAME);
    expect(booth).toHaveLength(1);
    expect(booth[0].schedule).toEqual({ anchor: 'time', deadlineHHMM: '09:45', daysOfWeek: [0] });
    const steps = await db.routineSteps.where('routineId').equals(booth[0].id).sortBy('sortOrder');
    expect(steps.length).toBeGreaterThanOrEqual(12);
    expect(steps[0].name).toBe('House lights on');
    expect(steps.some((s) => s.secretNames.includes('Uncased iPad password'))).toBe(true);
    expect(steps.some((s) => s.secretNames.includes('Cased iPad password'))).toBe(true);
    // No plaintext password anywhere in the seed.
    expect(JSON.stringify(steps)).not.toMatch(/password is/i);
    const variants = await db.routineVariants.where('routineId').equals(booth[0].id).toArray();
    expect(variants).toHaveLength(1);
    expect(variants[0].isDefault).toBe(true);
    expect(variants[0].stepIds).toEqual(steps.map((s) => s.id));
    // The evening variants are untouched.
    expect(await db.routineVariants.where('routineId').equals(EVENING_ROUTINE_ID).count()).toBe(2);

    // Re-open: still exactly one sound booth routine.
    db.close();
    await db.open();
    expect((await db.routines.toArray()).filter((r) => r.name === SOUND_BOOTH_ROUTINE_NAME)).toHaveLength(1);
  });

  it('gives the evening routine a default variant when the v12 table was empty', async () => {
    await seedV12({});
    const variants = await db.routineVariants.where('routineId').equals(EVENING_ROUTINE_ID).toArray();
    expect(variants).toHaveLength(1);
    expect(variants[0].isDefault).toBe(true);
  });

  it('fresh install seeds both routines and the vault tables are empty', async () => {
    await db.open();
    await seedDatabase();
    const routines = await db.routines.orderBy('sortOrder').toArray();
    expect(routines.map((r) => r.id)[0]).toBe(EVENING_ROUTINE_ID);
    expect(routines.some((r) => r.name === SOUND_BOOTH_ROUTINE_NAME)).toBe(true);
    expect(await db.routineVariants.where('routineId').equals(EVENING_ROUTINE_ID).count()).toBe(1);
    expect(await db.secrets.count()).toBe(0);
    expect(await db.vaultConfig.count()).toBe(0);
    // seedDatabase is idempotent.
    await seedDatabase();
    expect((await db.routines.toArray()).filter((r) => r.name === SOUND_BOOTH_ROUTINE_NAME)).toHaveLength(1);
  });
});
