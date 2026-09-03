# Workstream: schema

**Blocks:** every other workstream. **Blocked by:** nothing.

Land this first, alone, as one PR. Every later workstream assumes
these types and the v12 migration exist. Reader retargeting (the
`high_salt` readers, the `weightEntries` readers) is **not** done
here beyond what is needed to keep `tsc` and the existing tests green
— see "Scope" below for the exact line.

## Scope

1. New and changed types in `src/types.ts` (below).
2. Dexie **version 12** in `src/db.ts` with stores and an `upgrade`
   that backfills every new field so no reader ever sees `undefined`.
3. Pure helpers in a new `src/services/schemaBackfill.ts` that the
   migration calls, so the backfill logic is unit-testable without
   IndexedDB: `backfillNightLogV12(log)`, `backfillWakeUpEventV12(ev)`,
   `weightEntryToBodyMeasurement(entry)`, `backfillAppSettingsV12(s)`.
4. Seed the two new sleep rules for fresh installs (`seedDatabase`)
   and upgraders (v12 upgrade, name-dedupe pattern from v5).
5. **Minimal compile fixes only** in existing files: wherever removing
   `'high_salt'` from `EveningFlag['type']` or adding required fields
   breaks `tsc`, make the smallest change that compiles and preserves
   behavior (e.g. the evening log's flag list drops the `high_salt`
   row; factories that build a blank `NightLog` / `WakeUpEvent` set
   the new defaults). Do **not** build new UI here.
6. Migration tests (Q18 required test 1).

## Non-goals

- Any new screen or wizard step.
- Retargeting `Correlations`, `BestNights`, `ThermalFit`,
  `CalendarPage`, `WeightProfilePage`, `weightUtils` to the new
  tables/fields beyond compiling (owned by `night-tags` and
  `body-measurements`).
- Dropping `weightEntries` (kept, read-only by convention, until v13).
- Samsung per-minute parsing (only the `vitalSamples` table is
  created here).

## Data changes

### Shared enums

```ts
export type SodiumLevel = 'normal' | 'more' | 'much_more';
export type SleepPosition = 'side' | 'back' | 'unknown';
export type ElectrolyteDose = 'none' | 'half' | 'full';
export type ProvenanceSource = 'user' | 'proxy';
```

### `EveningIntake`

```ts
export interface EveningIntake {
  lastMealTime: string;
  foodDescription: string;
  flags: EveningFlag[];          // 'high_salt' removed from the union
  alcohol: AlcoholEntry | null;
  liquidIntake: string;
  /**
   * Graded sodium load for the evening. Replaces the boolean
   * `high_salt` flag (Q11). Backfilled by v12 from the flag with
   * `sodiumLevelSource: 'proxy'`.
   */
  sodiumLevel: SodiumLevel;
  /** 'user' once the evening log's picker is touched; 'proxy' from backfill. */
  sodiumLevelSource: ProvenanceSource;
  /** Free-text chips: "pretzels", "soy sauce", "electrolyte drink"... */
  sodiumSources: string[];
}

export interface EveningFlag {
  type: 'overate' | 'nitrates' | 'questionable_food' | 'late_meal' | 'custom';
  label: string;
  active: boolean;
}
```

### `NightLog` additions

```ts
  /** Daytime sodium+potassium drink dose (Q13). null = not asked / unknown. */
  electrolyteDose: ElectrolyteDose | null;
  /** Position when getting into bed (evening log). */
  positionStarted: SleepPosition;
  /** Position at the final morning wake (morning log). Episodes carry their own. */
  positionAtWake: SleepPosition;
  /** Morning label: woke wired / adrenergic at any point overnight. */
  wiredWake: boolean;
  /**
   * True when this row was created by the 4am episode flow because no
   * evening log existed (Q6). The evening wizard merges into such a
   * row and clears the flag; the calendar shows it as "partial".
   */
  autoCreated: boolean;
```

### `WakeUpEvent` additions (episode fields)

```ts
export type EcgVerdict = 'sinus' | 'afib' | 'inconclusive' | 'not_taken';
export type RhythmFelt = 'fast_regular' | 'irregular' | 'unsure';
export interface BpPoint { systolic: number; diastolic: number; pulse: number; }

  positionAtWake: SleepPosition;   // default 'unknown'
  ecgTaken: boolean;               // default false
  ecgVerdict: EcgVerdict;          // default 'not_taken'
  rhythmFelt: RhythmFelt | null;   // default null
  lyingBp: BpPoint | null;         // default null
  minutesToSettle: number | null;  // default null
  wired: boolean;                  // default false
  /** Epoch ms when captured live by the episode flow; null when entered in the morning. */
  capturedAt: number | null;
  /** How the row came to exist. 'episode' rows are the 4am captures. */
  source: 'episode' | 'morning' | 'import';
```

`startTime` for an episode row is derived from `capturedAt` in local
"HH:MM"; `fellBackAsleep` stays the existing field (`'yes' | 'no' |
'eventually'`) and the episode flow writes it in a follow-up screen.

### `BodyMeasurement` (new table, replaces `weightEntries`)

```ts
export type BodyMeasurementKind = 'weight' | 'neck';

export interface BodyMeasurement {
  id: string;
  kind: BodyMeasurementKind;
  nightLogId: string | null;
  date: string;         // "YYYY-MM-DD" calendar date of the measurement
  time: string;         // "HH:MM"
  timestamp: number;    // epoch ms
  period: WeighInPeriod; // 'morning' | 'evening'
  /** Canonical imperial storage: lbs for weight, inches for neck. Display converts via unitSystem. */
  value: number;
  measured: boolean;
  createdAt: number;
}
```

`WeightEntry` and `db.weightEntries` **stay declared** so old rows are
readable; a `// @deprecated — read-only after v12, dropped in v13`
comment goes on both. `weightEntryToBodyMeasurement` maps
`weightLbs → value`, `kind: 'weight'`, and **preserves `id`**.

### `OrthostaticReading` (new table)

```ts
export type VitalsSource = 'cuff' | 'watch';
export type OrthostaticSlot = 'am' | 'pm';

export interface OrthostaticReading {
  id: string;
  date: string;              // "YYYY-MM-DD" calendar date of the reading (NOT evening date)
  slot: OrthostaticSlot;
  timestamp: number;         // epoch ms of the supine reading
  source: VitalsSource;
  supine: BpPoint;
  standing1: BpPoint | null; // null when the stage was skipped
  standing3: BpPoint | null;
  notes: string;
  createdAt: number;
}
```

Derived values (systolic/diastolic drop, pulse rise, flags,
`needsRecalibration`) are **computed, never stored** — see `vitals.md`.

### `VitalSample` and `ImportBatch` (new tables, filled by `samsung-bulk-import`)

```ts
export type VitalSampleKind = 'hr' | 'spo2';

export interface VitalSample {
  kind: VitalSampleKind;
  timestamp: number;        // epoch ms, minute resolution
  value: number;            // bpm or percent
  nightLogId: string | null; // resolved on import by overnight window; null when outside any night
  importBatchId: string;
}

export interface ImportBatch {
  id: string;
  importedAt: number;
  source: 'samsung_export';
  files: { name: string; recognized: boolean; rows: number; note: string }[];
}
```

`vitalSamples` uses the compound primary key `[kind+timestamp]` so a
re-import of the same export is idempotent.

### `AppSettings` additions

```ts
  notificationPreferences: {
    ...existing five...
    amVitals: boolean;        // default false (opt-in, Q19)
    pmVitals: boolean;        // default false
    bedtimeWeighIn: boolean;  // default false
  };
  /** Epoch ms of the last Galaxy Watch BP cuff calibration (Q3). null = never recorded. */
  watchBpCalibratedAt: number | null;
```

### `ConditionClause` additions

```ts
  | { kind: 'high_salt_and_supine' }
  | { kind: 'orthostatic_flag_today' }
```

Evaluator cases are owned by `insights-and-rules.md`, **but** the
union members are added here so the seeded rules type-check. Until
that workstream lands, the evaluator's `default` branch must return
`false` for unknown kinds (verify it does; if it throws, add the two
cases returning `false` with a `// TODO(insights-and-rules)`).

### Dexie v12

```ts
this.version(12).stores({
  nightLogs: 'id, date',
  appSettings: 'id',
  sleepRules: 'id, priority',
  weightEntries: 'id, date, nightLogId, timestamp',          // unchanged, deprecated
  bodyMeasurements: 'id, date, nightLogId, timestamp, kind, [kind+date+period]',
  orthostaticReadings: 'id, date, timestamp, [date+slot]',
  vitalSamples: '[kind+timestamp], nightLogId, timestamp, importBatchId',
  importBatches: 'id, importedAt',
}).upgrade(async (tx) => {
  await tx.table('nightLogs').toCollection().modify(backfillNightLogV12);
  await tx.table('appSettings').toCollection().modify(backfillAppSettingsV12);
  // weightEntries → bodyMeasurements, preserving ids; idempotent on re-run.
  const existing = await tx.table('bodyMeasurements').count();
  if (existing === 0) {
    const rows = await tx.table('weightEntries').toArray();
    await tx.table('bodyMeasurements').bulkAdd(rows.map(weightEntryToBodyMeasurement));
  }
  // Seed the two new rules by name (v5 pattern).
  ...
});
```

`backfillNightLogV12(log)` (pure, in `schemaBackfill.ts`):

| Field | Rule |
|---|---|
| `eveningIntake.sodiumLevel` | if a flag with `type === 'high_salt' && active` exists → `'more'`, else `'normal'`; only when `sodiumLevel === undefined` |
| `eveningIntake.sodiumLevelSource` | `'proxy'` when set by the rule above |
| `eveningIntake.sodiumSources` | `[]` |
| `eveningIntake.flags` | remove any entry with `type === 'high_salt'` |
| `electrolyteDose` | `null` |
| `positionStarted`, `positionAtWake` | `'unknown'` |
| `wiredWake`, `autoCreated` | `false` |
| each `wakeUpEvents[i]` | `backfillWakeUpEventV12`: `positionAtWake 'unknown'`, `ecgTaken false`, `ecgVerdict 'not_taken'`, `rhythmFelt null`, `lyingBp null`, `minutesToSettle null`, `wired false`, `capturedAt null`, `source 'morning'` |

Every rule is guarded by `=== undefined` so re-running is a no-op and
user-set values are never overwritten.

## UI changes

None (compile-only edits, see Scope item 5).

## Given / When / Then

```gherkin
Feature: v12 schema migration

  Scenario: Upgrading a v11 night with the high_salt flag active
    Given a v11 nightLog whose eveningIntake.flags contains { type: 'high_salt', active: true }
    When the database opens at version 12
    Then eveningIntake.sodiumLevel is 'more'
    And eveningIntake.sodiumLevelSource is 'proxy'
    And eveningIntake.flags contains no entry of type 'high_salt'
    And the other flags are unchanged in order and value

  Scenario: Upgrading a v11 night without the high_salt flag
    Given a v11 nightLog whose flags include high_salt with active: false
    When the database opens at version 12
    Then sodiumLevel is 'normal' and sodiumLevelSource is 'proxy'

  Scenario: Upgrading a v11 night with no flags array at all
    Given a v11 nightLog with eveningIntake.flags undefined
    When the database opens at version 12
    Then sodiumLevel is 'normal', sodiumSources is [], and flags is []

  Scenario: Backfill is idempotent and never overwrites user values
    Given a nightLog already carrying sodiumLevel 'much_more' and sodiumLevelSource 'user'
    When backfillNightLogV12 runs on it
    Then sodiumLevel and sodiumLevelSource are unchanged

  Scenario: Every wake-up event gains episode defaults
    Given a v11 nightLog with two wakeUpEvents lacking the new fields
    When the database opens at version 12
    Then each event has positionAtWake 'unknown', ecgTaken false, ecgVerdict 'not_taken',
         rhythmFelt null, lyingBp null, minutesToSettle null, wired false, capturedAt null, source 'morning'

  Scenario: Weight entries are copied into bodyMeasurements with ids preserved
    Given 7 v11 weightEntries rows with distinct ids, dates, periods and weightLbs values
    When the database opens at version 12
    Then bodyMeasurements contains exactly 7 rows of kind 'weight'
    And for each row, id, date, time, timestamp, period, measured and createdAt equal the source row
    And value equals the source weightLbs
    And weightEntries still contains the original 7 rows

  Scenario: Re-running the weight copy does not duplicate rows
    Given bodyMeasurements already has rows
    When the v12 upgrade body runs again
    Then bodyMeasurements row count is unchanged

  Scenario: App settings gain the new preferences and calibration date
    Given v11 appSettings without amVitals / pmVitals / bedtimeWeighIn / watchBpCalibratedAt
    When the database opens at version 12
    Then the three preferences are false and watchBpCalibratedAt is null
    And the five existing preferences keep their prior values

  Scenario: The two new seeded rules exist once for upgraders and fresh installs
    Given a v11 database with the 12 existing seeded rules
    When the database opens at version 12
    Then sleepRules contains exactly one rule named 'Salt night — side sleep'
    And exactly one rule named 'Orthostatic flag'
    And re-opening the database does not add a second copy
    Given a fresh install
    When seedDatabase runs
    Then the same two rules exist with source 'seeded' and isActive true

  Scenario: No undefined reads after upgrade
    Given the realistic v11 fixture (weight rows, salt nights, wake events, settings)
    When the database opens at version 12 and every nightLog is loaded
    Then a deep walk of each nightLog finds no property whose value is undefined
```

## Acceptance criteria

- `npm test` includes `src/test/schemaV12.test.ts` implementing every
  scenario above against `fake-indexeddb`, seeding a v11 database by
  opening a throwaway `Dexie` at version 11 with the v11 stores, then
  opening `NightStackDB` on the same name.
- `src/test/schemaBackfill.test.ts` unit-tests the pure helpers.
- All 170+ existing tests pass unchanged, except tests that construct
  `EveningFlag` with `'high_salt'` or build `NightLog` / `WakeUpEvent`
  literals, which are updated to the new shape (list them in the PR).
- `npm run lint`, `npx tsc --noEmit`, `npm run build` green.

## Open questions

- Whether the recommender's `logToInputs` reads flags: if it reads
  `high_salt`, this PR replaces that read with `sodiumLevel !==
  'normal'` (behavior-preserving) and notes it. Confirm in
  `research.md` §3.
- Whether any existing test fixture opens the DB at a pinned older
  version (affects how the v11 fixture is built).
