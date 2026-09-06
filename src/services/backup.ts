import { db } from '../db';
import type { Routine, WeightEntry } from '../types';
import { backfillAppSettingsV12, backfillNightLogV12, weightEntryToBodyMeasurement } from './schemaBackfill';
import { EVENING_ROUTINE_ID, buildDefaultVariant, buildEveningRoutine } from './routineSeeds';

/**
 * JSON backup export/import, extracted from DataManagementPage so the
 * round trip can be tested (body-measurements.md). Import translates
 * pre-v12 backups: `weightEntries` → `bodyMeasurements`, `high_salt`
 * flags → `sodiumLevel`, missing night/settings fields → defaults; and
 * pre-v13 routine data (no `routines`, no `routineId`) → the evening
 * routine.
 *
 * The vault (`vaultConfig`, `secrets`) is deliberately never exported:
 * secrets stay on the device.
 */

type Loose = Record<string, unknown>;

export async function buildConfigPayload() {
  return {
    appSettings: (await db.appSettings.toArray())[0] ?? null,
    supplementDefs: await db.supplementDefs.toArray(),
    clothingItems: await db.clothingItems.toArray(),
    beddingItems: await db.beddingItems.toArray(),
    middayCopingItems: await db.middayCopingItems.toArray(),
    wakeUpCauses: await db.wakeUpCauses.toArray(),
    bedtimeReasons: await db.bedtimeReasons.toArray(),
    alarmSchedules: await db.alarmSchedules.toArray(),
    sleepRules: await db.sleepRules.toArray(),
    routines: await db.routines.toArray(),
    routineSteps: await db.routineSteps.toArray(),
    routineVariants: await db.routineVariants.toArray(),
  };
}

/** Routine-only export (Settings → Data Management → Export Routines). */
export async function buildRoutinesExport(includeSessions: boolean) {
  return {
    exportedAt: new Date().toISOString(),
    version: 2,
    kind: 'nightstack-routines' as const,
    includesSessions: includeSessions,
    routines: await db.routines.toArray(),
    routineSteps: await db.routineSteps.toArray(),
    routineVariants: await db.routineVariants.toArray(),
    ...(includeSessions ? { routineSessions: await db.routineSessions.toArray() } : {}),
  };
}

export interface NormalizedRoutines {
  routines: Loose[];
  routineSteps: Loose[];
  routineVariants: Loose[];
  routineSessions: Loose[];
}

/**
 * Bring any routine payload (v1 single-routine or v2 multi-routine, top
 * level or nested under `config`) to the v13 shape: every row has a
 * `routineId`, every referenced routine exists, every step has
 * `secretNames`, and every routine has at least one variant with exactly
 * one default. Pure; the callers below write it.
 */
export function normalizeRoutinePayload(data: Loose): NormalizedRoutines | null {
  const config = (data.config ?? {}) as Loose;
  const pick = (key: string): unknown => data[key] ?? config[key];
  const stepsRaw = pick('routineSteps');
  const variantsRaw = pick('routineVariants');
  if (!Array.isArray(stepsRaw) || !Array.isArray(variantsRaw)) return null;

  const now = Date.now();
  const routines: Loose[] = asArray(pick('routines')).map((r) => ({ ...r }));
  const ids = new Set(routines.map((r) => r.id as string));
  const ensureRoutine = (id: string) => {
    if (ids.has(id)) return;
    ids.add(id);
    routines.push(
      id === EVENING_ROUTINE_ID
        ? (buildEveningRoutine(now) as unknown as Loose)
        : ({
            ...buildEveningRoutine(now),
            id,
            name: `Imported routine ${routines.length + 1}`,
            schedule: { anchor: 'none' },
            sortOrder: routines.length + 1,
          } as unknown as Loose),
    );
  };
  const stamp = (row: Loose): Loose => {
    const routineId = typeof row.routineId === 'string' ? row.routineId : EVENING_ROUTINE_ID;
    ensureRoutine(routineId);
    return { ...row, routineId };
  };

  const routineSteps = (stepsRaw as Loose[]).map((s) => {
    const stamped = stamp(s);
    if (!Array.isArray(stamped.secretNames)) stamped.secretNames = [];
    return stamped;
  });
  const routineVariants = (variantsRaw as Loose[]).map(stamp);
  const routineSessions = asArray(data.routineSessions).map(stamp);

  // Every routine in the file must remain runnable.
  for (const routine of routines) {
    const rid = routine.id as string;
    const mine = routineVariants.filter((v) => v.routineId === rid);
    if (mine.length === 0) {
      routineVariants.push(buildDefaultVariant(rid, now) as unknown as Loose);
    } else if (!mine.some((v) => v.isDefault === true)) {
      mine[0].isDefault = true;
    }
    routine.isActive = routine.isActive !== false;
    if (typeof routine.sortOrder !== 'number') routine.sortOrder = routines.indexOf(routine) + 1;
    if (!routine.schedule || typeof routine.schedule !== 'object') {
      routine.schedule = rid === EVENING_ROUTINE_ID ? { anchor: 'bedtime' } : { anchor: 'none' };
    }
    if (typeof routine.description !== 'string') routine.description = '';
    if (typeof routine.createdAt !== 'number') routine.createdAt = now;
  }
  return { routines, routineSteps, routineVariants, routineSessions };
}

/**
 * Replace only the routine tables from a routine file. Returns the
 * number of sessions written (0 when the file carried none), or null
 * when the file has no routine data.
 */
export async function importRoutines(data: Loose): Promise<number | null> {
  const normalized = normalizeRoutinePayload(data);
  if (!normalized) return null;
  await db.transaction(
    'rw',
    [db.routines, db.routineSteps, db.routineVariants, db.routineSessions],
    async () => {
      await db.routines.clear();
      await db.routineSteps.clear();
      await db.routineVariants.clear();
      await db.routineSessions.clear();
      await db.routines.bulkAdd(normalized.routines as unknown as Routine[]);
      if (normalized.routineSteps.length) await db.routineSteps.bulkAdd(normalized.routineSteps as never[]);
      if (normalized.routineVariants.length) await db.routineVariants.bulkAdd(normalized.routineVariants as never[]);
      if (normalized.routineSessions.length) await db.routineSessions.bulkAdd(normalized.routineSessions as never[]);
    },
  );
  return normalized.routineSessions.length;
}

/**
 * Full export. `vitalSamples` (per-minute HR/SpO2, potentially 100k+ rows)
 * is deliberately excluded — re-import the Samsung folder instead.
 */
export async function buildFullExport(range?: { start: string; end: string }) {
  const inRange = <T extends { date: string }>(table: { where: (k: string) => { between: (a: string, b: string, c: boolean, d: boolean) => { toArray: () => Promise<T[]> } }; toArray: () => Promise<T[]> }) =>
    range ? table.where('date').between(range.start, range.end, true, true).toArray() : table.toArray();
  return {
    exportedAt: new Date().toISOString(),
    version: 2,
    dateRange: range ?? null,
    nightLogs: await inRange(db.nightLogs),
    bodyMeasurements: await inRange(db.bodyMeasurements),
    orthostaticReadings: await inRange(db.orthostaticReadings),
    // Kept for one release so older app versions can still read the file.
    weightEntries: await inRange(db.weightEntries),
    routineSessions: await inRange(db.routineSessions),
    importBatches: await db.importBatches.toArray(),
    config: await buildConfigPayload(),
  };
}

function asArray(v: unknown): Loose[] {
  return Array.isArray(v) ? (v as Loose[]) : [];
}

/** Replace every table with the backup's contents (pre-v12 shapes translated). */
export async function importBackup(data: Loose): Promise<void> {
  const config = (data.config ?? {}) as Loose;
  const pick = (key: string) => asArray(data[key] ?? config[key]);

  const nightLogs = pick('nightLogs').map((log) => {
    backfillNightLogV12(log);
    return log;
  });

  const settingsRaw = asArray(data.appSettings).length > 0
    ? asArray(data.appSettings)
    : config.appSettings && typeof config.appSettings === 'object'
      ? [config.appSettings as Loose]
      : [];
  const appSettings = settingsRaw.map((s) => {
    backfillAppSettingsV12(s);
    return s;
  });

  const bodyMeasurements = pick('bodyMeasurements');
  const legacyWeights = asArray(data.weightEntries) as unknown as WeightEntry[];
  const translated = bodyMeasurements.length > 0
    ? bodyMeasurements
    : legacyWeights.map((w) => weightEntryToBodyMeasurement(w) as unknown as Loose);

  // Routine tables: v1 files (no `routines`, no `routineId`) become the
  // evening routine. A file with no routine data at all still gets the
  // evening routine so the app stays in a valid state.
  const routineData = normalizeRoutinePayload(data) ?? normalizeRoutinePayload({
    routineSteps: [], routineVariants: [],
  })!;

  await db.transaction('rw', [
    db.nightLogs, db.supplementDefs, db.clothingItems, db.beddingItems,
    db.middayCopingItems, db.wakeUpCauses, db.bedtimeReasons, db.alarmSchedules,
    db.sleepRules, db.appSettings,
    db.routines, db.routineSteps, db.routineVariants, db.routineSessions,
    db.weightEntries, db.bodyMeasurements, db.orthostaticReadings, db.importBatches,
  ], async () => {
    await Promise.all([
      db.nightLogs.clear(), db.supplementDefs.clear(), db.clothingItems.clear(), db.beddingItems.clear(),
      db.middayCopingItems.clear(), db.wakeUpCauses.clear(), db.bedtimeReasons.clear(), db.alarmSchedules.clear(),
      db.sleepRules.clear(), db.appSettings.clear(),
      db.routines.clear(), db.routineSteps.clear(), db.routineVariants.clear(), db.routineSessions.clear(),
      db.weightEntries.clear(), db.bodyMeasurements.clear(), db.orthostaticReadings.clear(), db.importBatches.clear(),
    ]);

    const add = async (table: { bulkAdd: (rows: never[]) => Promise<unknown> }, rows: Loose[]) => {
      if (rows.length) await table.bulkAdd(rows as never[]);
    };
    await add(db.nightLogs, nightLogs);
    await add(db.supplementDefs, pick('supplementDefs'));
    await add(db.clothingItems, pick('clothingItems'));
    await add(db.beddingItems, pick('beddingItems'));
    await add(db.middayCopingItems, pick('middayCopingItems'));
    await add(db.wakeUpCauses, pick('wakeUpCauses'));
    await add(db.bedtimeReasons, pick('bedtimeReasons'));
    await add(db.alarmSchedules, pick('alarmSchedules'));
    await add(db.sleepRules, pick('sleepRules'));
    await add(db.appSettings, appSettings);
    await add(db.routines, routineData.routines);
    await add(db.routineSteps, routineData.routineSteps);
    await add(db.routineVariants, routineData.routineVariants);
    await add(db.routineSessions, routineData.routineSessions);
    await add(db.weightEntries, asArray(data.weightEntries));
    await add(db.bodyMeasurements, translated);
    await add(db.orthostaticReadings, pick('orthostaticReadings'));
    await add(db.importBatches, asArray(data.importBatches));
  });
}
