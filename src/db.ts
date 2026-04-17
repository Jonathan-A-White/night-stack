import Dexie, { type Table } from 'dexie';
import type {
  NightLog, SupplementDef, ClothingItem, BeddingItem,
  WakeUpCause, BedtimeReason, AlarmSchedule, SleepRule, AppSettings,
  WeightEntry, MiddayCopingItem, MiddayStruggle,
  RoutineStep, RoutineVariant, RoutineSession,
} from './types';
import { parseConditionString } from './services/rules';

export class NightStackDB extends Dexie {
  nightLogs!: Table<NightLog>;
  supplementDefs!: Table<SupplementDef>;
  clothingItems!: Table<ClothingItem>;
  beddingItems!: Table<BeddingItem>;
  wakeUpCauses!: Table<WakeUpCause>;
  bedtimeReasons!: Table<BedtimeReason>;
  alarmSchedules!: Table<AlarmSchedule>;
  sleepRules!: Table<SleepRule>;
  appSettings!: Table<AppSettings>;
  weightEntries!: Table<WeightEntry>;
  middayCopingItems!: Table<MiddayCopingItem>;
  routineSteps!: Table<RoutineStep>;
  routineVariants!: Table<RoutineVariant>;
  routineSessions!: Table<RoutineSession>;

  constructor() {
    super('nightstack');
    this.version(1).stores({
      nightLogs: 'id, date',
      supplementDefs: 'id, sortOrder',
      clothingItems: 'id, sortOrder',
      beddingItems: 'id, sortOrder',
      wakeUpCauses: 'id, sortOrder',
      bedtimeReasons: 'id, sortOrder',
      alarmSchedules: 'id, dayOfWeek',
      sleepRules: 'id, priority',
      appSettings: 'id',
    });
    this.version(2).stores({
      weightEntries: 'id, date, nightLogId, timestamp',
    }).upgrade(async (tx) => {
      // Backfill new AppSettings fields on existing installs
      await tx.table('appSettings').toCollection().modify((s: Partial<AppSettings>) => {
        if (s.unitSystem === undefined) s.unitSystem = 'us';
        if (s.weighInPeriod === undefined) s.weighInPeriod = 'morning';
        if (s.sex === undefined) s.sex = null;
        if (s.heightInches === undefined) s.heightInches = null;
        if (s.startingWeightLbs === undefined) s.startingWeightLbs = null;
        if (s.age === undefined) s.age = null;
      });
    });
    this.version(3).stores({
      weightEntries: 'id, date, nightLogId, timestamp',
    }).upgrade(async (tx) => {
      // All existing weight entries were real user entries, so mark them measured
      await tx.table('weightEntries').toCollection().modify((w: Partial<WeightEntry>) => {
        if (w.measured === undefined) w.measured = true;
      });
    });
    this.version(4).stores({
      sleepRules: 'id, priority',
    }).upgrade(async (tx) => {
      // Migrate free-form string conditions into the structured AST format.
      // `parseConditionString` best-effort parses the known patterns and falls
      // back to "Always" for anything it doesn't recognize (matching the old
      // evaluator's default-true behavior).
      await tx.table('sleepRules').toCollection().modify((r: Record<string, unknown>) => {
        if (typeof r.condition === 'string') {
          r.condition = parseConditionString(r.condition);
        }
      });
    });
    this.version(5).stores({
      middayCopingItems: 'id, sortOrder',
    }).upgrade(async (tx) => {
      // Backfill middayStruggle on existing night logs so reads never
      // encounter `undefined`. Existing entries default to "no struggle".
      await tx.table('nightLogs').toCollection().modify((log: Partial<NightLog>) => {
        if (log.middayStruggle === undefined) {
          log.middayStruggle = blankMiddayStruggle();
        }
      });
      // Existing installs need the seeded coping items too — seedDatabase()
      // short-circuits after the first run, so do it here for upgraders.
      const count = await tx.table('middayCopingItems').count();
      if (count === 0) {
        await tx.table('middayCopingItems').bulkAdd(seedMiddayCopingItems());
      }
      // Seed the two new sleep rules for upgraders. We look for them by name
      // so re-running the migration never creates duplicates.
      const rulesTable = tx.table('sleepRules');
      const now = Date.now();
      const existing = await rulesTable.toArray();
      const newRules = seedMiddayCopingRules(now).filter(
        (r) => !existing.some((e) => e.name === r.name),
      );
      if (newRules.length > 0) {
        await rulesTable.bulkAdd(newRules);
      }
    });
    this.version(6).stores({
      routineSteps: 'id, sortOrder',
      routineVariants: 'id, sortOrder',
      routineSessions: 'id, date, startedAt',
    }).upgrade(async (tx) => {
      // Ensure there's always at least one variant so sessions have somewhere
      // to attach. Only seed if the table is empty (upgraders get this once).
      const variantsTable = tx.table('routineVariants');
      const variantCount = await variantsTable.count();
      if (variantCount === 0) {
        await variantsTable.add(buildDefaultRoutineVariant());
      }
    });
    this.version(7).stores({
      nightLogs: 'id, date',
    }).upgrade(async (tx) => {
      // Backfill `loggedBedtime` on existing night logs. Historical entries
      // predate the field, so there's no accurate value to assign — leave
      // them null and let the UI fall back to sleepData.sleepTime.
      await tx.table('nightLogs').toCollection().modify((log: Partial<NightLog>) => {
        if (log.loggedBedtime === undefined) {
          log.loggedBedtime = null;
        }
      });
    });
    this.version(8).stores({
      nightLogs: 'id, date',
    }).upgrade(async (tx) => {
      // Backfill fields that drive the thermal recommender: a morning
      // `thermalComfort` label, per-wake thermal flags, and structured
      // AC-curve + fan-speed intervention fields. Historical rows can't
      // assign real values, so leave them as null / false and let the
      // recommender treat them as missing.
      await tx.table('nightLogs').toCollection().modify((log: Record<string, unknown>) => {
        if (log.thermalComfort === undefined) log.thermalComfort = null;

        const env = (log.environment ?? {}) as Record<string, unknown>;
        if (env.acCurveProfile === undefined) env.acCurveProfile = 'off';
        if (env.acSetpointF === undefined) env.acSetpointF = null;
        if (env.fanSpeed === undefined) env.fanSpeed = 'off';
        log.environment = env;

        const events = (log.wakeUpEvents ?? []) as Record<string, unknown>[];
        for (const ev of events) {
          if (ev.wasSweating === undefined) ev.wasSweating = false;
          if (ev.feltCold === undefined) ev.feltCold = false;
          if (ev.racingHeart === undefined) ev.racingHeart = false;
        }
      });
    });
    this.version(9).stores({
      appSettings: 'id',
    }).upgrade(async (tx) => {
      // Default existing installs to acInstalled=false so the evening log
      // stops prompting for an AC curve the user can't supply. The user
      // can flip this in Settings → Sleep Environment once an AC is in.
      await tx.table('appSettings').toCollection().modify((s: Partial<AppSettings>) => {
        if (s.acInstalled === undefined) s.acInstalled = false;
      });
    });
  }
}

function buildDefaultRoutineVariant(): RoutineVariant {
  return {
    id: crypto.randomUUID(),
    name: 'Full',
    description: '',
    stepIds: [],
    isDefault: true,
    sortOrder: 1,
    createdAt: Date.now(),
  };
}

export function blankMiddayStruggle(): MiddayStruggle {
  return {
    hadStruggle: false,
    copingItemIds: [],
    struggleTime: '',
    intensity: null,
    notes: '',
  };
}

/**
 * Default coping items. Type determines "good/bad" flavor:
 *   food     = bad coping (crash + thermic load)
 *   drink    = good coping
 *   exercise = good coping
 *   nap      = good action / bad signal (prior sleep likely fell short)
 * Seeded once at first install; the version 5 migration re-seeds for upgraders.
 */
function seedMiddayCopingItems(): MiddayCopingItem[] {
  return [
    { id: crypto.randomUUID(), name: 'Ginger juice / tea', type: 'drink', sortOrder: 1, isActive: true },
    { id: crypto.randomUUID(), name: 'Peanuts', type: 'food', sortOrder: 2, isActive: true },
    { id: crypto.randomUUID(), name: 'Peanut butter & chocolate', type: 'food', sortOrder: 3, isActive: true },
    { id: crypto.randomUUID(), name: 'Walk', type: 'exercise', sortOrder: 4, isActive: true },
    { id: crypto.randomUUID(), name: 'Standing at desk', type: 'exercise', sortOrder: 5, isActive: true },
    { id: crypto.randomUUID(), name: '30 minute power nap', type: 'nap', sortOrder: 6, isActive: true },
    { id: crypto.randomUUID(), name: '1.5 hour nap', type: 'nap', sortOrder: 7, isActive: true },
  ];
}

/** Sleep rules that pair with the midday-struggle feature. */
function seedMiddayCopingRules(createdAt: number): SleepRule[] {
  return [
    {
      id: crypto.randomUUID(),
      name: 'Midday food coping',
      condition: { combinator: 'and', clauses: [{ kind: 'midday_food_coping' }] },
      recommendation:
        'You reached for food to push through the afternoon slump. Swap for a drink (ginger tea) or movement (walk, standing desk). Peanuts and sweet + fat combos spike then crash, and thermic load from protein/fat makes evening cooling harder.',
      priority: 'medium',
      isActive: true,
      source: 'seeded',
      createdAt,
    },
    {
      id: crypto.randomUUID(),
      name: 'Midday nap signal',
      condition: { combinator: 'and', clauses: [{ kind: 'midday_nap_logged' }] },
      recommendation:
        'A midday nap was logged — the nap itself is a solid recovery move, but it usually means last night came up short. Check the prior night\'s bedtime, wake-ups, and room temp to find what to adjust tonight.',
      priority: 'low',
      isActive: true,
      source: 'seeded',
      createdAt,
    },
  ];
}

export const db = new NightStackDB();

// Seed data on first launch
export async function seedDatabase(): Promise<void> {
  const settingsCount = await db.appSettings.count();
  if (settingsCount > 0) return; // Already seeded

  await db.appSettings.add({
    id: 'default',
    latitude: 41.37,
    longitude: -73.41,
    darkMode: true,
    notificationsEnabled: true,
    notificationPreferences: {
      eatingCutoff: true,
      supplementReminder: true,
      bedtimeWarning: true,
      bedtime: true,
      morningLog: true,
    },
    unitSystem: 'us',
    weighInPeriod: 'morning',
    sex: null,
    heightInches: null,
    startingWeightLbs: null,
    age: null,
    acInstalled: false,
  });

  // Alarm schedule
  const schedules: AlarmSchedule[] = [
    { id: crypto.randomUUID(), dayOfWeek: 0, alarmTime: '07:15', hasAlarm: false, naturalWakeTime: '07:15' },
    { id: crypto.randomUUID(), dayOfWeek: 1, alarmTime: '04:43', hasAlarm: true, naturalWakeTime: null },
    { id: crypto.randomUUID(), dayOfWeek: 2, alarmTime: '04:43', hasAlarm: true, naturalWakeTime: null },
    { id: crypto.randomUUID(), dayOfWeek: 3, alarmTime: '06:15', hasAlarm: true, naturalWakeTime: null },
    { id: crypto.randomUUID(), dayOfWeek: 4, alarmTime: '04:43', hasAlarm: true, naturalWakeTime: null },
    { id: crypto.randomUUID(), dayOfWeek: 5, alarmTime: '06:15', hasAlarm: true, naturalWakeTime: null },
    { id: crypto.randomUUID(), dayOfWeek: 6, alarmTime: '07:15', hasAlarm: false, naturalWakeTime: '07:15' },
  ];
  await db.alarmSchedules.bulkAdd(schedules);

  // Supplements
  const supplements: SupplementDef[] = [
    { id: crypto.randomUUID(), name: 'Magnesium Glycinate', defaultDose: '400mg', timing: 'bedtime', frequency: 'daily', notes: '', isActive: true, sortOrder: 1 },
    { id: crypto.randomUUID(), name: 'Natural Calm (Mg Citrate + L-Theanine)', defaultDose: '1 tsp (200mg Mg + 200mg L-Theanine)', timing: 'bedtime', frequency: 'daily', notes: '', isActive: true, sortOrder: 2 },
    { id: crypto.randomUUID(), name: 'Cream of Tartar', defaultDose: '¼ tsp', timing: 'bedtime', frequency: 'daily', notes: 'In Calm drink', isActive: true, sortOrder: 3 },
    { id: crypto.randomUUID(), name: 'Salt (pinch)', defaultDose: 'pinch', timing: 'bedtime', frequency: 'daily', notes: 'In Calm drink', isActive: true, sortOrder: 4 },
    { id: crypto.randomUUID(), name: 'Iron Bisglycinate (Solgar)', defaultDose: '50mg (2 capsules)', timing: 'morning', frequency: 'every_other_day', notes: 'With Vitamin C', isActive: true, sortOrder: 5 },
    { id: crypto.randomUUID(), name: 'Focus Factor', defaultDose: '4 tablets', timing: 'lunch', frequency: 'daily', notes: '', isActive: true, sortOrder: 6 },
    { id: crypto.randomUUID(), name: 'Elderberry (Vitamin C + D3 + Zinc)', defaultDose: '2 gummies', timing: 'lunch', frequency: 'daily', notes: 'Seasonal — cold season only', isActive: true, sortOrder: 7 },
    { id: crypto.randomUUID(), name: 'Copper Bisglycinate (Bluebonnet)', defaultDose: '3mg', timing: 'dinner', frequency: 'every_other_day', notes: '', isActive: true, sortOrder: 8 },
    { id: crypto.randomUUID(), name: 'Zinc Picolinate (Swanson)', defaultDose: '22mg', timing: 'dinner', frequency: 'daily', notes: 'Pending reorder', isActive: true, sortOrder: 9 },
    { id: crypto.randomUUID(), name: 'LoSalt', defaultDose: '1 tsp', timing: 'morning', frequency: 'daily', notes: 'Throughout day', isActive: true, sortOrder: 10 },
    { id: crypto.randomUUID(), name: 'Sea Salt', defaultDose: '½ tsp', timing: 'morning', frequency: 'daily', notes: 'Throughout day', isActive: true, sortOrder: 11 },
    { id: crypto.randomUUID(), name: 'LoSalt (morning)', defaultDose: '¼ tsp', timing: 'morning', frequency: 'daily', notes: '', isActive: true, sortOrder: 12 },
    { id: crypto.randomUUID(), name: 'Sea Salt (morning)', defaultDose: '¼ tsp', timing: 'morning', frequency: 'daily', notes: '', isActive: true, sortOrder: 13 },
  ];
  await db.supplementDefs.bulkAdd(supplements);

  // Clothing
  const clothing: ClothingItem[] = [
    { id: crypto.randomUUID(), name: 'Underwear only', sortOrder: 1, isActive: true },
    { id: crypto.randomUUID(), name: 'Wool socks', sortOrder: 2, isActive: true },
    { id: crypto.randomUUID(), name: 'Ice Breaker top', sortOrder: 3, isActive: true },
    { id: crypto.randomUUID(), name: 'Ice Breaker bottom', sortOrder: 4, isActive: true },
    { id: crypto.randomUUID(), name: 'Wool hat', sortOrder: 5, isActive: true },
    { id: crypto.randomUUID(), name: 'Light PJs', sortOrder: 6, isActive: true },
  ];
  await db.clothingItems.bulkAdd(clothing);

  // Bedding
  const bedding: BeddingItem[] = [
    { id: crypto.randomUUID(), name: 'Wool comforter', sortOrder: 1, isActive: true },
    { id: crypto.randomUUID(), name: 'Wool blanket #1', sortOrder: 2, isActive: true },
    { id: crypto.randomUUID(), name: 'Wool blanket #2', sortOrder: 3, isActive: true },
    { id: crypto.randomUUID(), name: 'Wool blanket #3', sortOrder: 4, isActive: true },
    { id: crypto.randomUUID(), name: 'Cotton blanket', sortOrder: 5, isActive: true },
    { id: crypto.randomUUID(), name: 'Cotton sheets', sortOrder: 6, isActive: true },
  ];
  await db.beddingItems.bulkAdd(bedding);

  // Wake-up causes
  const causes: WakeUpCause[] = [
    { id: crypto.randomUUID(), label: 'Heart racing / palpitations', sortOrder: 1, isActive: true },
    { id: crypto.randomUUID(), label: 'Sweating / too hot', sortOrder: 2, isActive: true },
    { id: crypto.randomUUID(), label: 'Too cold', sortOrder: 3, isActive: true },
    { id: crypto.randomUUID(), label: 'Bathroom', sortOrder: 4, isActive: true },
    { id: crypto.randomUUID(), label: 'Noise', sortOrder: 5, isActive: true },
    { id: crypto.randomUUID(), label: 'Pain / discomfort', sortOrder: 6, isActive: true },
    { id: crypto.randomUUID(), label: 'Anxiety / racing thoughts', sortOrder: 7, isActive: true },
    { id: crypto.randomUUID(), label: 'Unknown', sortOrder: 8, isActive: true },
  ];
  await db.wakeUpCauses.bulkAdd(causes);

  // Bedtime reasons
  const reasons: BedtimeReason[] = [
    { id: crypto.randomUUID(), label: 'Work / project', sortOrder: 1, isActive: true },
    { id: crypto.randomUUID(), label: 'Screen time', sortOrder: 2, isActive: true },
    { id: crypto.randomUUID(), label: "Couldn't wind down", sortOrder: 3, isActive: true },
    { id: crypto.randomUUID(), label: 'Family', sortOrder: 4, isActive: true },
    { id: crypto.randomUUID(), label: 'Lost track of time', sortOrder: 5, isActive: true },
    { id: crypto.randomUUID(), label: 'Social / phone', sortOrder: 6, isActive: true },
    { id: crypto.randomUUID(), label: 'Felt wired / not tired', sortOrder: 7, isActive: true },
    { id: crypto.randomUUID(), label: 'Other', sortOrder: 8, isActive: true },
  ];
  await db.bedtimeReasons.bulkAdd(reasons);

  // Midday coping items
  await db.middayCopingItems.bulkAdd(seedMiddayCopingItems());

  // Sleep rules
  const now = Date.now();
  const rules: SleepRule[] = [
    { id: crypto.randomUUID(), name: 'Full glycinate dose', condition: { combinator: 'and', clauses: [{ kind: 'always' }] }, recommendation: 'Keep Magnesium Glycinate at 400mg — do not reduce when adding Calm. Citrate does not substitute for glycinate for sleep maintenance.', priority: 'high', isActive: true, source: 'seeded', createdAt: now },
    { id: crypto.randomUUID(), name: 'Eating cutoff', condition: { combinator: 'and', clauses: [{ kind: 'food_after_cutoff' }] }, recommendation: 'Stop eating 2-3 hours before target bedtime. Thermic effect of food (especially protein/fat like peanuts) raises core temperature and causes overnight wake-ups.', priority: 'high', isActive: true, source: 'seeded', createdAt: now },
    { id: crypto.randomUUID(), name: 'Light covers rule', condition: { combinator: 'or', clauses: [{ kind: 'room_temp_above', thresholdF: 68 }, { kind: 'external_temp_above', thresholdF: 50 }] }, recommendation: 'Use light covers. Skip wool comforter. Overdressing/over-covering causes sweating and cortisol-driven wake-ups around 3-4 AM.', priority: 'high', isActive: true, source: 'seeded', createdAt: now },
    { id: crypto.randomUUID(), name: 'No heavy layers', condition: { combinator: 'and', clauses: [{ kind: 'feeling_cold' }] }, recommendation: 'Use a blanket you can kick off rather than wearing heavy layers. You can\'t shed clothing while asleep. Underwear + kickable blanket > layers.', priority: 'high', isActive: true, source: 'seeded', createdAt: now },
    { id: crypto.randomUUID(), name: 'Peanut moderation', condition: { combinator: 'and', clauses: [{ kind: 'peanuts_logged' }] }, recommendation: 'Limit peanuts to one serving per day. Heavy peanut intake = more phytic acid (blocks mineral absorption) + higher thermic effect. Time peanuts away from supplements.', priority: 'medium', isActive: true, source: 'seeded', createdAt: now },
    { id: crypto.randomUUID(), name: 'Bedtime target', condition: { combinator: 'and', clauses: [{ kind: 'always' }] }, recommendation: 'Calculate bedtime from alarm: 5 sleep cycles (7.5 hrs) + time to fall asleep. Consistently going to bed late is the #1 drag on total sleep.', priority: 'high', isActive: true, source: 'seeded', createdAt: now },
    { id: crypto.randomUUID(), name: 'Alcohol timing', condition: { combinator: 'and', clauses: [{ kind: 'alcohol_logged' }] }, recommendation: 'Finish alcohol with dinner (2-3 hrs before bed). Alcohol is a vasodilator — adds to overnight warming. At 4oz dry red wine, effect is small but compounds with other heat factors.', priority: 'low', isActive: true, source: 'seeded', createdAt: now },
    { id: crypto.randomUUID(), name: 'Glycine for wake recovery', condition: { combinator: 'and', clauses: [{ kind: 'recurrent_night_wakeup' }] }, recommendation: 'Consider adding 3g glycine powder at bedtime or keep on nightstand for middle-of-night use. Glycine lowers core body temperature and promotes sleep onset.', priority: 'medium', isActive: true, source: 'seeded', createdAt: now },
    { id: crypto.randomUUID(), name: 'Magnesium total ceiling', condition: { combinator: 'and', clauses: [{ kind: 'always' }] }, recommendation: 'Keep total daily magnesium under 600-800mg. Currently: ~100mg (Focus Factor) + 200mg (Calm citrate) + 400mg (glycinate) = 700mg. Watch for loose stools.', priority: 'medium', isActive: true, source: 'seeded', createdAt: now },
    { id: crypto.randomUUID(), name: 'Supplement spacing', condition: { combinator: 'and', clauses: [{ kind: 'iron_supplement_day' }] }, recommendation: 'On iron mornings, keep 2+ hours before lunch (Focus Factor has zinc/magnesium that compete with iron absorption). Take zinc picolinate at dinner, not with iron.', priority: 'medium', isActive: true, source: 'seeded', createdAt: now },
    ...seedMiddayCopingRules(now),
  ];
  await db.sleepRules.bulkAdd(rules);

  // Evening routine: seed a default variant so sessions always have an anchor.
  // Steps are left empty — the user defines their own in settings.
  const routineVariantCount = await db.routineVariants.count();
  if (routineVariantCount === 0) {
    await db.routineVariants.add(buildDefaultRoutineVariant());
  }
}
