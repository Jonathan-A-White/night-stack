import { describe, it, expect, beforeEach } from 'vitest';
import { db, seedDatabase } from '../db';
import {
  buildFullExport,
  buildRoutinesExport,
  importBackup,
  importRoutines,
  normalizeRoutinePayload,
} from '../services/backup';
import { EVENING_ROUTINE_ID, SOUND_BOOTH_ROUTINE_NAME } from '../services/routineSeeds';
import { createVault, encryptSecret } from '../services/vault';

/**
 * Routine import / export across the v1 (single routine) and v2
 * (multi-routine) file shapes, plus the rule that the vault never leaves
 * the device.
 */

const V1_FILE = {
  exportedAt: 'x', version: 1, kind: 'nightstack-routines', includesSessions: false,
  routineSteps: [
    { id: 's1', name: 'Dishes', description: '', sortOrder: 1, isActive: true, createdAt: 1 },
  ],
  routineVariants: [
    { id: 'v1', name: 'Full', description: '', stepIds: ['s1'], isDefault: true, sortOrder: 1, createdAt: 1 },
  ],
};

describe('normalizeRoutinePayload', () => {
  it('returns null without step and variant arrays', () => {
    expect(normalizeRoutinePayload({})).toBeNull();
    expect(normalizeRoutinePayload({ routineSteps: [] })).toBeNull();
  });

  it('treats a v1 file as the evening routine', () => {
    const n = normalizeRoutinePayload(V1_FILE)!;
    expect(n.routines.map((r) => r.id)).toEqual([EVENING_ROUTINE_ID]);
    expect(n.routineSteps[0].routineId).toBe(EVENING_ROUTINE_ID);
    expect(n.routineSteps[0].secretNames).toEqual([]);
    expect(n.routineVariants[0].routineId).toBe(EVENING_ROUTINE_ID);
    expect(n.routineSessions).toEqual([]);
  });

  it('reads the routine sections nested under config', () => {
    const n = normalizeRoutinePayload({ config: { routineSteps: V1_FILE.routineSteps, routineVariants: V1_FILE.routineVariants } })!;
    expect(n.routineSteps).toHaveLength(1);
  });

  it('creates a placeholder routine for an unknown routineId and a default variant for a routine with none', () => {
    const n = normalizeRoutinePayload({
      routines: [{ id: 'r-booth', name: 'Booth', description: '', schedule: { anchor: 'none' }, isActive: true, sortOrder: 1, createdAt: 1 }],
      routineSteps: [{ id: 's9', routineId: 'r-other', name: 'X', description: '', secretNames: ['k'], sortOrder: 1, isActive: true, createdAt: 1 }],
      routineVariants: [{ id: 'v9', routineId: 'r-booth', name: 'Full', description: '', stepIds: [], isDefault: false, sortOrder: 1, createdAt: 1 }],
    })!;
    expect(n.routines.map((r) => r.id).sort()).toEqual(['r-booth', 'r-other']);
    // r-other got a synthesized default variant; r-booth's lone variant became default.
    expect(n.routineVariants.find((v) => v.routineId === 'r-other')?.isDefault).toBe(true);
    expect(n.routineVariants.find((v) => v.id === 'v9')?.isDefault).toBe(true);
    expect(n.routineSteps[0].secretNames).toEqual(['k']);
  });
});

describe('importRoutines / buildRoutinesExport', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await seedDatabase();
  });

  it('round-trips every routine with steps, variants and sessions', async () => {
    await db.routineSessions.add({
      id: 'sess1', routineId: EVENING_ROUTINE_ID, date: '2026-09-01', variantId: null, variantName: 'Full',
      startedAt: 1, endedAt: 2, completedAt: 2, totalDurationMs: 1, steps: [], sessionNotes: '', createdAt: 2,
    });
    const before = {
      routines: await db.routines.count(),
      steps: await db.routineSteps.count(),
      variants: await db.routineVariants.count(),
    };
    const file = JSON.parse(JSON.stringify(await buildRoutinesExport(true)));
    expect(file.version).toBe(2);
    expect(file.routines.length).toBe(before.routines);
    expect(file.routineSessions).toHaveLength(1);

    await db.routineSessions.clear();
    const written = await importRoutines(file);
    expect(written).toBe(1);
    expect(await db.routines.count()).toBe(before.routines);
    expect(await db.routineSteps.count()).toBe(before.steps);
    expect(await db.routineVariants.count()).toBe(before.variants);
    expect((await db.routineSessions.get('sess1'))?.routineId).toBe(EVENING_ROUTINE_ID);
    expect((await db.routines.toArray()).some((r) => r.name === SOUND_BOOTH_ROUTINE_NAME)).toBe(true);
  });

  it('a v1 file replaces everything with just the evening routine', async () => {
    await importRoutines(V1_FILE);
    const routines = await db.routines.toArray();
    expect(routines.map((r) => r.id)).toEqual([EVENING_ROUTINE_ID]);
    expect((await db.routineSteps.get('s1'))?.routineId).toBe(EVENING_ROUTINE_ID);
    expect(await db.routineSessions.count()).toBe(0);
  });

  it('returns null and leaves the tables alone for a file without routine data', async () => {
    const before = await db.routineSteps.count();
    expect(await importRoutines({ hello: 'world' })).toBeNull();
    expect(await db.routineSteps.count()).toBe(before);
  });
});

describe('full backup and the vault', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await seedDatabase();
  });

  it('the full export carries routines but never the vault', async () => {
    const { config, dek } = await createVault('2468');
    await db.vaultConfig.put(config);
    await db.secrets.put(await encryptSecret(dek, 'Uncased iPad password', 'super-secret-value'));
    const payload = await buildFullExport();
    const text = JSON.stringify(payload);
    expect(payload.config.routines.length).toBeGreaterThanOrEqual(2);
    expect(text).not.toContain('super-secret-value');
    expect(text).not.toContain('pinWrappedKey');
    expect(text).not.toContain(config.kdfSalt);
    // Re-importing the backup keeps the vault untouched.
    await importBackup(JSON.parse(text));
    expect(await db.vaultConfig.count()).toBe(1);
    expect(await db.secrets.count()).toBe(1);
    expect(await db.routines.count()).toBe(payload.config.routines.length);
  });

  it('a pre-v13 full backup (no routines array) is imported as the evening routine', async () => {
    await importBackup({
      version: 2,
      config: { appSettings: null, routineSteps: V1_FILE.routineSteps, routineVariants: V1_FILE.routineVariants },
      routineSessions: [
        { id: 'sess1', date: '2026-09-01', variantId: 'v1', variantName: 'Full', startedAt: 1, endedAt: 2, completedAt: 2, totalDurationMs: 1, steps: [], sessionNotes: '', createdAt: 2 },
      ],
    });
    expect((await db.routines.toArray()).map((r) => r.id)).toEqual([EVENING_ROUTINE_ID]);
    expect((await db.routineSessions.get('sess1'))?.routineId).toBe(EVENING_ROUTINE_ID);
    expect(await db.routineVariants.where('routineId').equals(EVENING_ROUTINE_ID).count()).toBe(1);
  });
});
