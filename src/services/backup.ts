import { db } from '../db';
import type { WeightEntry } from '../types';
import { backfillAppSettingsV12, backfillNightLogV12, weightEntryToBodyMeasurement } from './schemaBackfill';

/**
 * JSON backup export/import, extracted from DataManagementPage so the
 * round trip can be tested (body-measurements.md). Import translates
 * pre-v12 backups: `weightEntries` → `bodyMeasurements`, `high_salt`
 * flags → `sodiumLevel`, missing night/settings fields → defaults.
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
    routineSteps: await db.routineSteps.toArray(),
    routineVariants: await db.routineVariants.toArray(),
  };
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

  await db.transaction('rw', [
    db.nightLogs, db.supplementDefs, db.clothingItems, db.beddingItems,
    db.middayCopingItems, db.wakeUpCauses, db.bedtimeReasons, db.alarmSchedules,
    db.sleepRules, db.appSettings,
    db.routineSteps, db.routineVariants, db.routineSessions,
    db.weightEntries, db.bodyMeasurements, db.orthostaticReadings, db.importBatches,
  ], async () => {
    await Promise.all([
      db.nightLogs.clear(), db.supplementDefs.clear(), db.clothingItems.clear(), db.beddingItems.clear(),
      db.middayCopingItems.clear(), db.wakeUpCauses.clear(), db.bedtimeReasons.clear(), db.alarmSchedules.clear(),
      db.sleepRules.clear(), db.appSettings.clear(),
      db.routineSteps.clear(), db.routineVariants.clear(), db.routineSessions.clear(),
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
    await add(db.routineSteps, pick('routineSteps'));
    await add(db.routineVariants, pick('routineVariants'));
    await add(db.routineSessions, asArray(data.routineSessions));
    await add(db.weightEntries, asArray(data.weightEntries));
    await add(db.bodyMeasurements, translated);
    await add(db.orthostaticReadings, pick('orthostaticReadings'));
    await add(db.importBatches, asArray(data.importBatches));

    // Keep the app in a valid state: there must always be a routine variant.
    if (pick('routineVariants').length === 0) {
      await db.routineVariants.add({
        id: crypto.randomUUID(),
        name: 'Full',
        description: '',
        stepIds: [],
        isDefault: true,
        sortOrder: 1,
        createdAt: Date.now(),
      });
    }
  });
}
