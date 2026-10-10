# NightStack module map

Written 2026-10-09 at base commit 9327234 (212 commits, 2026-04-06 to 2026-09-06; `src/` is about 33,000 lines
of which 35 files are tests). Docs only: no source file moved, no behaviour changed. It answers the Governor's
standing rule (pwa-best-practices 27, Modular Boundaries): draw the boundaries so two stories can change two
modules at once, and keep refactoring toward that.

How to read it:

- Backticks mean a path that exists today. A path written in **bold** is a file or folder this map proposes.
- `bash docs/check-module-map.sh` checks every backticked path and the collision tables against git.
- Sizes: **fits one story** means one Builder session with the gate green at the end; **needs N stories** names the split.
- The app has no event bus. Modules talk through Dexie live queries (`useLiveQuery` in 174 places under
  `src/pages/` and `src/components/`) and through `localStorage` keys. Both are noted where they hurt.

## Modules

Dependency direction today, top imports down: `src/main.tsx` imports `src/App.tsx`; the page folders import
`src/db.ts`, `src/utils.ts`, `src/types.ts`, `src/components/` and `src/services/`; services import `src/types.ts`
and `src/utils.ts`, and five of them import `src/db.ts`. Nothing under `src/services/` imports a page or a
component, which is the one clean seam the app already has (one exception: `src/services/nightTags.ts`
reads a key that a page writes; see Rule breaks).

| Module | One responsibility | Entry file and exported API | Imports |
| --- | --- | --- | --- |
| App shell | Start the app, route to a page, switch between the three apps (Routine, Tracking, Experiments) | `src/main.tsx` (no exports); `src/App.tsx` exports `App`; `src/apps.tsx` exports `APPS`, `getApp(id)`, `homePathFor(id)`, `resolveAppForPath(path)`, `readLastApp()`, `writeLastApp(id)`, `readLastPath(id)`, `writeLastPath(id, path)` | every page (47 imports in `src/App.tsx`), `src/components/AppSwitcher.tsx`, `src/components/AppTabBar.tsx`, `src/components/AppEntryRedirect.tsx`, `src/hooks/useTheme.ts` |
| Domain types | The one vocabulary of records: nights, wake-ups, routines, vitals, settings, vault rows | `src/types.ts`: 66 exported types and interfaces, no code | nothing |
| Persistence | Own the Dexie schema (13 versions), the singleton `db`, first-run seeding | `src/db.ts` exports `db`, `NightStackDB`, `seedDatabase()`, `upgradeRoutinesV13(tx)`, `seedSoundBoothRoutine(tx, now)`, `blankMiddayStruggle()` | `dexie`, `src/services/rules.ts` (for one migration) |
| Persistence helpers | Back up, restore and migrate stored data | `src/services/backup.ts` (`buildFullExport`, `importBackup`, `buildRoutinesExport`, `importRoutines`, `normalizeRoutinePayload`); `src/services/schemaBackfill.ts` (`backfillNightLogV12`, `backfillWakeUpEventV12`, `backfillAppSettingsV12`, `weightEntryToBodyMeasurement`) | `src/db.ts`, `src/types.ts`, `src/services/routineSeeds.ts` |
| Time and night-log helpers | Local dates, 12-hour times, the bedtime schedule, sleep-onset maths, blank-record factories | `src/utils.ts`: 23 exports (`getEveningLogDate`, `addDaysToDate`, `calculateSchedule`, `computeAdjustedSleepOnset`, `createBlankNightLog`, ...) | nothing |
| Units and body measurements | Pounds/kilograms/inches/centimetres, ideal weight, neck and weight deltas, AM/PM measurement rows | `src/weightUtils.ts` (17 pure exports); `src/services/bodyMeasurements.ts` (`upsertMeasurement`, `latestMeasurement`, `measurementsForLog`, `deltasForNight`, `formatNeck`, ...) | `src/types.ts`; the second also `src/db.ts`, `src/utils.ts`, `src/weightUtils.ts` |
| Evening (Tonight) | Plan tonight from past nights and rules, log the evening in 8 steps, review it | `src/pages/tonight/TonightPlan.tsx`, `src/pages/tonight/EveningLog.tsx`, `src/pages/tonight/EveningReview.tsx`, `src/pages/tonight/steps/NightTagsStep.tsx` (page components, no non-React API) | `src/db.ts`, `src/services/weather.ts`, `src/services/rules.ts`, `src/services/recommender.ts`, `src/services/nightTags.ts`, `src/services/notifications.ts`, `src/components/` steppers |
| Morning | Log the morning in 5 steps, import the watch data, review the night | `src/pages/morning/MorningLog.tsx`, `src/pages/morning/MorningReview.tsx`, `src/pages/morning/RoomConditionsDetail.tsx`, `src/pages/morning/steps/WakeTagsStep.tsx` | `src/db.ts`, `src/services/importers.ts`, `src/services/sleepDataDedupe.ts`, `src/services/nightTags.ts`, `src/services/recommender.ts`, `src/pages/experiments/episodeDraftStorage.ts`, `src/components/` |
| Routines | Run a timed routine (evening, sound booth), keep it crash-safe, schedule and edit it | `src/pages/tonight/RoutineTracker.tsx`, `src/pages/tonight/RoutineStartCard.tsx`, `src/pages/tonight/routineWipStorage.ts` (`loadWip`, `saveWip`, `listRoutinesWithWip`, `reconcileWipWithVariant`), `src/pages/routine/RoutineHome.tsx`, `src/pages/settings/RoutineEditorPage.tsx`, `src/pages/settings/RoutinesSettingsPage.tsx`; services `src/services/routineSchedule.ts`, `src/services/routineSeeds.ts`, `src/services/routinePaths.ts`, `src/services/routineAnalytics.ts`, `src/services/routineNotifications.ts` | `src/db.ts`, `src/types.ts`, `src/utils.ts`, `src/components/SecretReveal.tsx` |
| Secret vault | A PIN- or fingerprint-unlocked store of encrypted secrets (passwords for routine steps) | `src/services/vault.ts` (`createVault`, `unlockWithPin`, `changePin`, `enrollPrfKey`, `unlockWithPrfOutput`, `encryptSecret`, `decryptSecret`, `getUnlockedDek`, `lockVault`, `onVaultStateChange`, `VaultError`); `src/services/webauthnPrf.ts` (`enrollBiometric`, `assertBiometric`, `isWebAuthnAvailable`); UI in `src/components/SecretReveal.tsx` and `src/pages/settings/VaultSettingsPage.tsx` | the vault imports only `src/types.ts`; the UI imports `src/db.ts` and `src/services/routinePaths.ts` |
| Insights | Charts and statistics over nights: dashboard, correlations, best nights, thermal fit, metric detail | `src/pages/insights/` (6 pages); services `src/services/nightMetrics.ts` (`NIGHT_METRICS`, `getMetric`, `buildNightMetricCtx`, `adrenergicNight`), `src/services/recommender.ts` (`recommendForTonight`, `nightDistance`, `logToInputs`, `describePressure`), `src/services/thermalProxy.ts`, `src/services/rules.ts` (`evaluateRules`, `parseConditionString`, `formatCondition`) | `src/db.ts`, `src/types.ts`, `src/utils.ts`; `src/pages/insights/Correlations.tsx`, `src/pages/insights/BestNights.tsx` and `src/pages/insights/ThermalFit.tsx` import `SubNav` from `src/pages/insights/Dashboard.tsx` |
| Calendar | Month view of nights | `src/pages/calendar/CalendarPage.tsx` | `src/db.ts`, `src/utils.ts`, `src/types.ts` |
| Experiments | Home experiments: 4am episode capture, orthostatic vitals, body tab, clinician export, Samsung import | `src/pages/experiments/` (8 pages, 2 draft stores); services `src/services/episodes.ts` (`attachEpisode`, `updateEpisode`, `episodesForNight`), `src/services/orthostatic.ts` (`computeOrthostatic`, `saveReading`, `getReading`, `readingsForNight`), `src/services/clinicianExport.ts` (`buildClinicianRows`, `toCsv`, `parseCsv`, `summaryStats`) | `src/db.ts`, `src/types.ts`, `src/utils.ts` |
| Data import | Parse the watch and sensor exports and plan a de-duplicated import | `src/services/samsungExport.ts` (`planImport`, `runImport`, 36 exports), `src/services/importers.ts` (`parseSamsungHealthJSON`, `parseGoveeCSV`), `src/services/sleepDataDedupe.ts` (`findDuplicateSleepData`), `src/services/dataCleanupScanner.ts` (`scanLogsForIssues`, `applyCleanupActions`) | `src/types.ts`, `src/utils.ts`; `samsungExport.ts` also `src/db.ts` and `src/services/episodes.ts` |
| Night tags and weather | Tag vocabulary and tag building for save; overnight weather lookup | `src/services/nightTags.ts` (`buildEveningTagsForSave`, `buildMorningTagsForSave`, `readEveningDraftTags`, option lists); `src/services/weather.ts` (`fetchOvernightWeather`, `getOvernightLow`) | `src/types.ts` |
| Reminders | Browser notifications for bedtime, supplements, the morning log | `src/services/notifications.ts` (`buildNotificationPlan`, `scheduleNotifications`, `requestNotificationPermission`); `src/services/routineNotifications.ts` (`scheduleRoutineStartNotification`, `cancelRoutineStartNotification`, `getNotificationPermission`) | `src/types.ts` |
| Settings | One page per configurable list or option | `src/pages/settings/` (20 pages) behind `src/pages/settings/SettingsHome.tsx` | `src/db.ts`, `src/types.ts`, `src/utils.ts`, a few services |
| Shared components | Steppers, chips, charts, banners | `src/components/` (17 files; `ValueStepper`, `WeightStepper`, `NeckStepper`, `ThermalComfortChip`, `VitalTraceChart`, `BodyMeasurementEditCard`, `NightLogDateEditor`, `InstallBanner`) | `src/types.ts`, `src/db.ts` (5 of them, see Rule breaks), `src/hooks/` |
| Styling | One global stylesheet for every screen | `src/theme.css` (1,304 lines, 205 rules that start with a class selector) | nothing |
| Tests | 35 vitest files with a jsdom + fake-indexeddb setup | `src/test/` (`src/test/setup.ts`, `src/test/fixtures/samsung.ts`) | everything |

## Collisions

Counts come from `git log <window> --name-only --format= -- src | sort | uniq -c | sort -rn | head -15`; lines are
`wc -l` at the base commit. The literal window `--since=30.days` is **empty** at this commit: the last commit is
2026-09-06 and today is 2026-10-09, so nothing falls inside 30 days. Two windows are given instead, both checked
by `docs/check-module-map.sh`. Test files and the stylesheet are in the command's output because the command
lists everything under `src/`.

The 30 days ending at the last commit (2026-08-07 to 2026-09-07, 22 commits):

<!-- collisions: --since=2026-08-07 --until=2026-09-07 -->
| Commits | File | Lines |
| --- | --- | --- |
| 6 | `src/theme.css` | 1304 |
| 6 | `src/App.tsx` | 125 |
| 5 | `src/pages/morning/MorningReview.tsx` | 431 |
| 4 | `src/pages/tonight/EveningLog.tsx` | 1497 |
| 4 | `src/pages/morning/MorningLog.tsx` | 1658 |
| 3 | `src/pages/tonight/TonightPlan.tsx` | 599 |
| 3 | `src/pages/tonight/EveningReview.tsx` | 449 |
| 3 | `src/pages/insights/Correlations.tsx` | 232 |
| 3 | `src/pages/experiments/ExperimentsHome.tsx` | 130 |
| 2 | `src/types.ts` | 727 |
| 2 | `src/test/samsungExport.test.ts` | 327 |
| 2 | `src/test/fixtures/samsung.ts` | 87 |
| 2 | `src/test/episodeDraftStorage.test.ts` | 61 |
| 2 | `src/test/appRoutes.test.tsx` | 82 |
| 2 | `src/services/vault.ts` | 325 |

The whole history (212 commits), which is the better guide because 22 commits is a thin sample:

<!-- collisions: all -->
| Commits | File | Lines |
| --- | --- | --- |
| 32 | `src/pages/morning/MorningLog.tsx` | 1658 |
| 26 | `src/pages/tonight/EveningLog.tsx` | 1497 |
| 22 | `src/theme.css` | 1304 |
| 20 | `src/App.tsx` | 125 |
| 17 | `src/types.ts` | 727 |
| 16 | `src/utils.ts` | 415 |
| 16 | `src/pages/tonight/RoutineTracker.tsx` | 1536 |
| 16 | `src/pages/morning/MorningReview.tsx` | 431 |
| 15 | `src/db.ts` | 548 |
| 12 | `src/test/utils.test.ts` | 473 |
| 12 | `src/pages/tonight/TonightPlan.tsx` | 599 |
| 12 | `src/pages/tonight/EveningReview.tsx` | 449 |
| 11 | `src/pages/insights/Correlations.tsx` | 232 |
| 9 | `src/pages/insights/Dashboard.tsx` | 358 |
| 8 | `src/pages/settings/DataManagementPage.tsx` | 470 |

What the numbers say:

- **The two logging wizards are the serial queue.** `src/pages/morning/MorningLog.tsx` and
  `src/pages/tonight/EveningLog.tsx` are 3,155 lines and 48 distinct commits between them (of the 131 commits that
  touched `src/`). Both are over the ~500-line limit three times over, and any story that adds a field to the evening
  or the morning edits one of them.
- **Four files change together with a feature's page.** In history, `src/theme.css` co-changes with `src/App.tsx`
  in 10 commits; `src/types.ts` with `src/db.ts` in 13; `src/App.tsx` with `src/db.ts` in 9 and with
  `src/pages/settings/SettingsHome.tsx` in 7. A new page edits the router, the stylesheet, the types and the schema.
- **`src/utils.ts` is a grab-bag** that `src/pages/tonight/EveningLog.tsx` (13 commits) and
  `src/pages/morning/MorningLog.tsx` (12) edit alongside; its test file `src/test/utils.test.ts` is the 10th most
  changed file.
- `src/pages/tonight/RoutineTracker.tsx` is the third giant (1,536 lines, 16 commits), and the routines pack is the
  fastest-growing area (multiple routines, vault, sound booth all landed in 2026-09).

## Proposed refactors

Ranked by how much parallel work each frees. Every one is a pure refactor: no behaviour change, the existing tests
pass unchanged, and a story that does it says in its closing comment which files moved. In the signatures, a path in
bold is new. Rules for all of them: keep `localStorage` keys and Dexie table names byte-for-byte, so no stored
data is touched.

### R1. Split the Morning and Evening wizards into step modules

- **Responsibility to carve out:** each step of `src/pages/morning/MorningLog.tsx` (5 steps, lines 848 to 1640) and
  `src/pages/tonight/EveningLog.tsx` (8 steps, lines 722 to the end) becomes its own component file; the save logic
  and the handler block (`MorningLog.tsx` lines 345 to 783) move into a hook per wizard. The screen files keep only the
  step list, the progress bar and the navigation buttons.
- **Frees:** a story that adds a field to step 3 of the morning no longer conflicts with one that edits step 1 or
  the save; the 48 commits that now queue behind two files spread over about 13 step files and 2 hooks.
- **New module and API:**

```ts
// **src/pages/morning/steps/*.tsx**, **src/pages/tonight/steps/*.tsx** (the two `steps/` folders already hold one step each)
import type { ComponentType } from 'react';

export interface StepProps<TForm> {
  form: TForm;                                 // the wizard's whole draft, read-only here
  patch(change: Partial<TForm>): void;         // the only way a step changes it
  night: NightLog;                             // the record being edited
}

export interface WizardStep<TForm> {
  id: string;                                  // 'weight', 'govee', 'wakeups', 'bedtime', 'notes'
  title: string;
  isVisible?(form: TForm, night: NightLog): boolean;   // step 4 of the morning is conditional
  canAdvance?(form: TForm): boolean;
  Component: ComponentType<StepProps<TForm>>;
}

// **src/pages/morning/useMorningLog.ts**
export function useMorningLog(nightLogDate: string): {
  form: MorningForm;
  patch(change: Partial<MorningForm>): void;
  step: number;
  setStep(n: number): void;
  save(): Promise<void>;
};
// **src/pages/tonight/useEveningLog.ts** has the same shape with EveningForm.
```

- **Files touched:** `src/pages/morning/MorningLog.tsx`, `src/pages/tonight/EveningLog.tsx`, the two `steps/` folders, new hook files.
- **Risk:** medium. Both wizards keep one big mutable form and a draft persisted on every change; a split that
  loses a closure over `step` or `nightLog.date` reintroduces a stale-closure bug that the code already guards against (it snapshots `nightLog.date` at click time because `useLiveQuery` can re-resolve mid-save, `src/pages/morning/MorningLog.tsx` near line 456).
- **Size:** **needs 2 stories**, one per wizard (morning first, 5 steps). Each fits one story. R7 (the draft store) is not a prerequisite but shrinks both.

### R2. Put Dexie behind repositories

- **Responsibility to carve out:** reading and writing records. Today 41 page files, 5 components and `src/hooks/useTheme.ts`
  import `db` and call it directly (about 81 write calls in `src/pages/` and `src/components/`), so a schema change
  edits many screens and a screen cannot be tested without fake-indexeddb.
- **Frees:** the schema (`src/db.ts`, `src/types.ts`; 32 commits between them) can change behind a repository while screens keep compiling; settings pages stop colliding on `db.appSettings`.
- **New module and API:**

```ts
// **src/data/repositories/settings.ts**
export interface SettingsRepository {
  get(): Promise<AppSettings>;
  update(change: Partial<AppSettings>): Promise<void>;
  useSettings(): AppSettings | undefined;               // wraps useLiveQuery
}
// **src/data/repositories/nightLogs.ts**
export interface NightLogRepository {
  byDate(date: string): Promise<NightLog | undefined>;
  range(start: string, end: string): Promise<NightLog[]>;
  save(log: NightLog): Promise<void>;
  useNight(date: string): NightLog | undefined;
  useRange(start: string, end: string): NightLog[] | undefined;
}
// **src/data/repositories/lists.ts**: the six simple editable lists share one shape
export interface ListRepository<T extends { id: string }> {
  all(): Promise<T[]>;
  put(item: T): Promise<void>;
  remove(id: string): Promise<void>;
  useAll(): T[] | undefined;
}
// **src/data/index.ts** exports `settings`, `nightLogs`, `routines`, `clothingItems`, `beddingItems`, ... built on `src/db.ts`
```

- **Files touched:** first story: **src/data/** plus `src/pages/settings/` (the 20 settings pages are the simplest callers); later stories one page folder each. Add an ESLint `no-restricted-imports` rule for `../db` in `src/pages/`, switched on per folder as each is converted.
- **Risk:** medium. `useLiveQuery` queries that join tables must keep re-running when either table changes.
- **Size:** **needs about 6 stories**: (1) settings and the list repositories plus the lint rule, (2) nightLogs, (3) routines, (4) vitals/body/episodes, (5) insights read-only queries, (6) components. Story 1 fits one session.

### R3. Split the routine tracker into an engine and views

- **Responsibility to carve out:** `src/pages/tonight/RoutineTracker.tsx` (1,536 lines) mixes the timer state machine (start, done, skip, punt, restart, reorder, resume, bail out), long-press and drag gestures, and rendering. Carve the state machine into a pure reducer, the gestures into hooks, and the lists into components.
- **Frees:** routine features (vault steps, sound booth, analytics) stop colliding with each other; the reducer becomes testable without rendering.
- **New module and API:**

```ts
// **src/pages/tonight/routineSession.ts**: pure, no React, no Dexie
export type SessionAction =
  | { type: 'start'; variantId: string; now: number }
  | { type: 'done'; now: number }
  | { type: 'skip' | 'punt' | 'unskip' | 'restart'; stepId: string; now: number }
  | { type: 'reorder'; from: number; to: number }
  | { type: 'notes'; value: string };
export function reduceSession(state: WipSession, action: SessionAction): WipSession;
export function toRoutineSession(state: WipSession, variant: RoutineVariant, now: number): RoutineSession;

// **src/hooks/useLongPress.ts**
export function useLongPress(onLongPress: () => void, ms?: number): {
  onPointerDown(e: React.PointerEvent): void;
  onPointerUp(): void;
  onPointerLeave(): void;
};
// **src/pages/tonight/routineTracker/StepRow.tsx**, **.../StartScreen.tsx**, **.../CompletionSummary.tsx**: presentational components
```

- **Files touched:** `src/pages/tonight/RoutineTracker.tsx`, `src/pages/tonight/routineWipStorage.ts`, `src/test/routineWipStorage.test.ts`, new files.
- **Risk:** medium-high. Timing code with long-press and drag; the WIP persistence is the crash recovery path, so the reducer story must keep `routineWipStorage.ts` exactly as is.
- **Size:** **needs 2 stories**: (1) reducer and `useLongPress` with the screen calling them, (2) split the views.

### R4. Split `src/theme.css` per feature

- **Responsibility to carve out:** one 1,304-line stylesheet holds tokens, base elements, shared widgets and every feature's rules (calendar, routine tracker, vault, clinician print, thermal chips). It is the most-edited non-code file (22 commits, 6 in the last window) and co-changes with `src/App.tsx` in 10.
- **Frees:** a feature's styles live next to its page, so two features stop editing one file.
- **New module and API:** CSS has no function signatures; the interface is the class names, which stay unchanged, and the custom properties in the token file. The one typed surface is the entry that imports the parts:

```ts
// **src/styles/index.ts**: imported once from `src/main.tsx`, in cascade order
import './tokens.css';          // custom properties, light and dark
import './base.css';            // reset, layout, cards, buttons, forms, banners, utilities
import './widgets.css';         // steppers, chips, switches, progress
// feature files are imported by the feature itself:
//   **src/pages/calendar/calendar.css**, **src/pages/tonight/routineTracker.css**,
//   **src/pages/experiments/clinicianPrint.css**, **src/components/secretReveal.css**
export {};
```

- **Files touched:** `src/theme.css` (deleted), `src/main.tsx` (one import), the pages that gain a `.css` import.
- **Risk:** medium. CSS order is behaviour; a rule moved after one that overrides it changes the page. The check is a before/after screenshot of each page at phone width (pwa-best-practices 21).
- **Size:** **fits one story**, if the class names do not change.

### R5. A route registry in place of the router in `src/App.tsx`

- **Responsibility to carve out:** which pages exist and where they mount. `src/App.tsx` imports 47 pages and lists their `<Route>` elements; `src/pages/settings/SettingsHome.tsx` lists the settings pages again; `src/apps.tsx` lists the tabs a third time.
- **Frees:** a new page is one new file that registers itself; `src/App.tsx` (20 commits, 6 in the last window) stops being edited per feature.
- **New module and API:**

```ts
// **src/routes/types.ts**
import type { ComponentType } from 'react';
export interface PageRoute {
  path: string;                                   // '/settings/vault'
  app: AppId | 'settings';
  component: ComponentType;                       // lazy-loadable
  settingsEntry?: { label: string; group: string; order: number };   // shown in SettingsHome
}
// **src/pages/settings/routes.ts**, **src/pages/insights/routes.ts**, ... each exports `export const routes: PageRoute[]`
// **src/routes/index.ts**
export function allRoutes(): PageRoute[];
export function settingsEntries(): { path: string; label: string; group: string }[];
```

- **Files touched:** `src/App.tsx`, `src/pages/settings/SettingsHome.tsx`, `src/apps.tsx`, `src/test/appRoutes.test.tsx`, one `routes.ts` per page folder.
- **Risk:** low; `src/test/appRoutes.test.tsx` and `src/test/apps.test.ts` already pin the route table.
- **Size:** **fits one story.**

### R6. Split the schema files: `src/types.ts` by domain and `src/db.ts` versions into migration files

- **Responsibility to carve out:** `src/types.ts` (727 lines, 66 exports, 10 sections) and `src/db.ts` (13 `version()` blocks, upgrade code, seeding).
- **Frees:** two stories adding a table stop editing the same two files; old migrations become frozen files nobody touches.
- **New module and API:** a folder replaces each file with an `index.ts` that re-exports, so every existing `from '../types'` and `from '../db'` still resolves with no import churn.

```ts
// **src/types/index.ts** re-exports: `export * from './nightLog'; export * from './routines'; export * from './vitals'; export * from './settings'; export * from './vault';`
// **src/db/schema/v13.ts** (one file per version v01..v13)
import type { Transaction } from 'dexie';
export interface SchemaVersion {
  version: number;
  stores: Record<string, string | null>;
  upgrade?(tx: Transaction): Promise<void>;
}
export const v13: SchemaVersion;
// **src/db/index.ts**
export const db: NightStackDB;
export function seedDatabase(): Promise<void>;
```

- **Files touched:** `src/types.ts`, `src/db.ts` (both become folders), 13 schema files, `src/services/rules.ts` import direction (see Rule breaks: break the db to rules to orthostatic to db cycle by moving `parseConditionString` out of the migration).
- **Risk:** low for types (type-only); medium for db, because the version order and every `upgrade` body must move verbatim. `src/test/schemaV12.test.ts`, `src/test/schemaV13.test.ts` and `src/test/db.test.ts` cover it.
- **Size:** **needs 2 stories**: types first (fits one), then db.

### R7. One draft store for every saved-in-progress form

- **Responsibility to carve out:** crash-safe `localStorage` drafts. Five hand-written copies of load/validate/expire/save/clear exist: `src/pages/experiments/episodeDraftStorage.ts`, `src/pages/experiments/vitalsDraftStorage.ts`, `src/pages/tonight/routineWipStorage.ts`, and two inline ones in `src/pages/morning/MorningLog.tsx` and `src/pages/tonight/EveningLog.tsx`. `src/pages/tonight/TonightPlan.tsx` and `src/services/nightTags.ts` read the Evening draft's key string themselves.
- **Frees:** the wizards (R1) stop owning persistence; one tested module replaces five.
- **New module and API:**

```ts
// **src/drafts/index.ts**
export interface DraftStore<T> {
  load(now?: Date): T | null;     // null when absent, wrong version, invalid, or expired (and clears it)
  save(draft: T): void;           // best-effort, never throws
  clear(): void;
}
export interface DraftOptions<T> {
  key: string;                    // an existing key, byte-for-byte
  version?: number;               // stamps `__v`, as MorningLog does
  validate(raw: unknown): raw is T;
  expiresAfterMs?: number;        // from a timestamp the draft carries
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;   // injected; defaults to localStorage
}
export function createDraftStore<T>(options: DraftOptions<T>): DraftStore<T>;
```

- **Files touched:** the five files above, `src/pages/tonight/TonightPlan.tsx`, `src/services/nightTags.ts`, new **src/drafts/**, `src/test/episodeDraftStorage.test.ts`, `src/test/routineWipStorage.test.ts`.
- **Risk:** low if the keys and the 48-hour and evening-rollover expiries are preserved; the existing tests pin both.
- **Size:** **fits one story.** Also a library candidate (see below): write it with an injected storage so it can be lifted afterwards.

### R8. Split `src/utils.ts` by concern

- **Responsibility to carve out:** one 415-line file holds local dates and times, the bedtime schedule, the eating cutoff and last-meal rules, sleep-onset adjustment, and the blank-record factories for `NightLog` and `WakeUpEvent`.
- **Frees:** date helpers and night-log rules stop colliding (16 commits; 13 and 12 of them alongside the two wizards).
- **New module and API:** `src/utils.ts` stays as a re-export barrel, so no import changes.

```ts
// **src/time.ts**: pure date and clock helpers
export function toLocalDateString(date: Date): string;
export function addDaysToDate(dateStr: string, days: number): string;
export function getEveningLogDate(now?: Date): string;
export function formatTime12h(time24: string): string;
export function addMinutes(time: string, minutes: number): string;
// **src/nightRules.ts**: night-log rules
export function computeAdjustedSleepOnset(params: { /* as today */ }): AdjustedSleepOnset;
export function resolveLastMealTimeForSave(params: { /* as today */ }): string | null;
export function isSaveBeforeEatingCutoff(/* as today */): boolean;
// **src/nightLogFactory.ts**
export function createBlankNightLog(date: string, alarm: { /* as today */ }): NightLog;
export function createBlankWakeUpEvent(/* as today */): WakeUpEvent;
```

- **Files touched:** `src/utils.ts`, `src/test/utils.test.ts` (split to match), new files.
- **Risk:** low (pure functions, 473 lines of tests).
- **Size:** **fits one story.**

## Rule breaks

Against pwa-best-practices 27 (Modular Boundaries) and the library rules. Each is a fact in the code today.

1. **Screens call the store directly, not an interface.** 41 files under `src/pages/` import `src/db.ts`, plus `src/components/OrthostaticSummaryCard.tsx`, `src/components/BodyMeasurementEditCard.tsx`, `src/components/SecretReveal.tsx`, `src/components/NightLogDateEditor.tsx`, `src/components/VitalTraceChart.tsx` and `src/hooks/useTheme.ts`. The rule says Dexie sits behind repositories. Fix: R2.
2. **Screens talk to the browser's storage, with key strings copied around.** `localStorage` is used directly in 10 files under `src/pages/` (`src/pages/tonight/EveningLog.tsx`, `src/pages/morning/MorningLog.tsx`, `src/pages/tonight/TonightPlan.tsx`, `src/pages/tonight/RoutineTracker.tsx`, `src/pages/tonight/RoutineStartCard.tsx`, `src/pages/insights/Dashboard.tsx`, `src/pages/settings/SleepEnvironmentPage.tsx`, and the three draft stores `src/pages/experiments/episodeDraftStorage.ts`, `src/pages/experiments/vitalsDraftStorage.ts`, `src/pages/tonight/routineWipStorage.ts`). The Evening draft key `evening-log-draft-<date>` is built in three places: `src/pages/tonight/EveningLog.tsx`, `src/pages/tonight/TonightPlan.tsx`, and `src/services/nightTags.ts` (a service reading a page's private state). `src/pages/settings/SleepEnvironmentPage.tsx` sets `ac-installed-tip-pending` and `src/pages/tonight/EveningLog.tsx` reads and clears it: two modules coupled through a string, where the rule asks for the bus or an interface. Fix: R7.
3. **A page imports another page's internals.** `src/pages/morning/MorningLog.tsx` imports `src/pages/experiments/episodeDraftStorage.ts`; `src/pages/experiments/ClinicianSummaryPrint.tsx` imports `loadClinicianInput` (a Dexie read) out of the page `src/pages/experiments/ClinicianExportPage.tsx`; three insights pages import `SubNav` from the page `src/pages/insights/Dashboard.tsx`; `src/pages/routine/RoutineHome.tsx` and `src/pages/tonight/TonightPlan.tsx` import `src/pages/tonight/RoutineStartCard.tsx`. Fix: move each shared piece to `src/components/` or a service in the story that touches it (`loadClinicianInput` belongs in `src/services/clinicianExport.ts`; `SubNav` in `src/components/`).
4. **An import cycle.** `src/db.ts` imports `src/services/rules.ts` (for `parseConditionString` in one migration), which imports `src/services/orthostatic.ts`, which imports `src/db.ts`. It works only because the cycle is used lazily. Fix: R6 (move the parser the migration needs to a leaf module).
5. **A vendor and constants in a service.** `src/services/weather.ts` hard-codes the Open-Meteo hosts and the time zone `America/New_York`; only latitude and longitude come from settings. `src/services/notifications.ts` hard-codes the title `NightStack` and the icon path `/favicon.svg`. `src/utils.ts` exports English-only `DAY_NAMES`, and every screen string is inline English (no language setting exists, so a second language would touch every page). Fix: pass the time zone from settings (`Intl.DateTimeFormat().resolvedOptions().timeZone` is the default); put the notification title in a setting. One small story each.
6. **The owner's own data is in the code.** `src/db.ts` seeds new installs with a fixed location (latitude 41.37, longitude -73.41), and `src/services/routineSeeds.ts` seeds a routine named for one specific place, the 'Brookfield First' Sunday-morning sound-booth SOP (`SOUND_BOOTH_ROUTINE_NAME`), with its step list, into every install. The rule: the build holds only public defaults, the owner's data comes from settings or an import. Fix: seed no location (ask on first run) and ship the sound-booth routine as an importable file under `docs/` (the routine import path exists: `docs/routine-import-guide.md`). Decide with the Governor first: it changes first-run behaviour.
7. **Duplicates, inside the app.** `src/services/notifications.ts` and `src/services/routineNotifications.ts` both define `requestNotificationPermission` and both call `new Notification`. Three hand-rolled CSV readers: `splitCsvLine` in `src/services/samsungExport.ts`, `parseCsv` in `src/services/clinicianExport.ts`, and the Govee parser in `src/services/importers.ts`. Fix: one `NotificationPort` and one `csv` module, each its own small story (not in the ranked eight).
8. **Duplicates of shared code, between apps.** `src/services/webauthnPrf.ts` is the third copy of the WebAuthn PRF wrapper (Postern's `webauthnPrf.ts` and trade-tracker's `passkey.ts`, both under their `src/services/`), with the same comments and flow. `src/services/vault.ts` re-implements AES-GCM wrapping, PBKDF2 and PRF key derivation that bsv-kit's `packages/bsv/src/vault/wrap.ts` also has (different purpose and shape: that wraps one BIP39 key at 210,000 rounds, this wraps many secrets under a data key at 310,000, so it is overlap, not a literal copy). The one-time flags `ac-installed-tip-pending` and `insights-backfill-onboarding-seen` do by hand what `@bsv-kit/tips` already does. See Library candidates.
9. **Files over the ~500-line limit.** Eleven non-test files (ten code files and the stylesheet): `src/pages/morning/MorningLog.tsx` 1658, `src/pages/tonight/RoutineTracker.tsx` 1536, `src/pages/tonight/EveningLog.tsx` 1497, `src/theme.css` 1304, `src/services/samsungExport.ts` 802, `src/types.ts` 727, `src/services/recommender.ts` 658, `src/pages/settings/RoutineEditorPage.tsx` 636, `src/pages/tonight/TonightPlan.tsx` 599, `src/pages/insights/ThermalFit.tsx` 550, `src/db.ts` 548. R1, R3, R4 and R6 cover five of the six biggest; `src/services/samsungExport.ts` (802 lines, 36 exports: CSV parsing, session and stage parsing, night assignment, import planning, import running) is the sixth. It is not in the ranked eight because it changes rarely (2 commits in the last window, none of the 15 most-changed files), but it is the next candidate (split parse / plan / run). `src/services/recommender.ts`, `src/pages/settings/RoutineEditorPage.tsx`, `src/pages/tonight/TonightPlan.tsx` and `src/pages/insights/ThermalFit.tsx` are 550 to 658 lines and need no split yet.

## Library candidates

Rule: library-best-practices 01 (the second copy is the signal; a plainly shareable piece is lifted now) and 04
(semver, a CHANGELOG with breaking changes first, pin by tag). Every library below is a public repo under
Jonathan-A-White with nothing personal in code, tests, fixtures or history. Each starts at 0.1.0 with a README that
opens with what it does and a ten-line example, a CHANGELOG, tests in CI, an MIT licence.

| # | Candidate (source in this app) | Why it is a candidate | Home | Proposed public API | Versioning |
| --- | --- | --- | --- | --- | --- |
| L1 | WebAuthn PRF passkey (`src/services/webauthnPrf.ts`, 123 lines) | Three copies exist already: Postern, trade-tracker and this app, each with its own relying-party name, user id and salt as constants. | **NEW public repo `passkey-prf`** (the browser API puts it outside bsv-kit's `bsv`, which has no DOM) | see below | 0.1.0 lifts the shared flow with the salt, relying-party name and user id as arguments; the apps then pin by tag and delete their copies, one story per app |
| L2 | One-time tips and flags | This app hand-rolls two (`ac-installed-tip-pending`, `insights-backfill-onboarding-seen`) | **existing `@bsv-kit/tips`**: use it, no new code | `tips.nextTip(event)`, `tips.dismiss(id)` as it is | Adopt at the current pin; if a "show again after N days" need appears, that is a minor release of tips |
| L3 | Draft store (R7, `createDraftStore`) | Five copies here; Lampas and others keep unsaved work too. Storage is injected, as in tips | **new package `@bsv-kit/drafts`** in bsv-kit, beside tips (bsv-kit already holds non-BSV PWA pieces) | `createDraftStore<T>(options): DraftStore<T>` as in R7, plus a `memoryStorage()` for tests | 0.1.0; a change to the stored shape (`__v` stamp) is a breaking change, called out in the CHANGELOG with a migration line |
| L4 | Secret vault (`src/services/vault.ts`, 325 lines) | A PIN/biometric-unlocked store of many encrypted secrets, pure functions over a stored `VaultConfig`, no Dexie inside, 100% covered by `src/test/vault.test.ts`. Overlaps bsv-kit's `vault.wrap` primitives | **NEW public repo `secret-vault`**, which uses `passkey-prf` as an optional peer; bsv-kit's `wrap.ts` may later reuse its key-derivation. Decide with the Governor: it is a new library, not a bsv-kit module | see below | The stored `VaultConfig` is wire format: a change to its fields, the key-wrapping scheme or the default `PBKDF2_ITERATIONS` is a major bump with a migration (library-best-practices 05). The iteration count is already stored per vault (`kdfIterations`), so a higher default does not lock old vaults out |
| L5 | Local date and clock helpers (the pure half of `src/utils.ts`, R8) | Needed by any app with a daily log; not yet found in a second app (checked Lampas, trade-tracker, SpellForge, Postern, MyShape: none) | Stays in the app until a second app wants it | n/a | n/a |
| L6 | Overnight weather lookup (`src/services/weather.ts`, 69 lines) | No other app uses it | Stays; fix the hard-coded time zone first (Rule breaks 5) | n/a | n/a |
| L7 | Install-prompt hook and banner (`src/hooks/useInstallPrompt.ts`, `src/components/InstallBanner.tsx`) | `beforeinstallprompt` appears in no other app today | Watch: lift when a second app needs it | n/a | n/a |

L1 proposed public API (`passkey-prf`), from `src/services/webauthnPrf.ts` with the salt, relying-party name and
user id as arguments instead of constants:

```ts
export interface PrfOptions {
  rpName: string;                  // shown by the platform, the app's name
  userId: Uint8Array;              // stable per app
  userName: string;
}
export interface PrfEnrollment {
  credentialId: string;            // base64url
  prfSalt: Uint8Array<ArrayBuffer>;
  prfOutput: Uint8Array;           // 32 bytes, the only secret that leaves the authenticator
}
export function isWebAuthnAvailable(): boolean;
export function isPlatformAuthenticatorAvailable(): Promise<boolean>;
export function enrollBiometric(options: PrfOptions, prfSalt: Uint8Array<ArrayBuffer>): Promise<PrfEnrollment>;
export function assertBiometric(credentialId: string, prfSalt: Uint8Array<ArrayBuffer>): Promise<Uint8Array>;
// `passkey-prf/testing`, tests only: a stand-in that returns a fixed secret
export function fakePasskey(secret?: Uint8Array): { enroll: typeof enrollBiometric; assert: typeof assertBiometric };
```

The three copies differ in shape today (Postern and trade-tracker expose `createPrfPasskey` and `getPrfSecret` over an
`ArrayBuffer` id; this app exposes `enrollBiometric` and `assertBiometric` over a base64url id). The 0.1.0 lift picks
one shape, and the CHANGELOG names the rename for the two apps that adopt it.

L4 proposed public API (`secret-vault`): the functions `src/services/vault.ts` exports today, unchanged, with storage
left to the caller (they already take and return a `VaultConfig` and never touch Dexie).

```ts
export interface VaultConfig {
  id: 'default'; kdfSalt: string; kdfIterations: number;
  pinWrappedKey: WrappedKey; prfWrappedKey: PrfWrappedKey | null;
  autoLockMinutes: number; createdAt: number; updatedAt: number;
}
export function createVault(pin: string, now?: number): Promise<{ config: VaultConfig; dek: CryptoKey }>;
export function unlockWithPin(config: VaultConfig, pin: string): Promise<CryptoKey>;
export function changePin(config: VaultConfig, dek: CryptoKey, newPin: string, now?: number): Promise<VaultConfig>;
export function enrollPrfKey(config: VaultConfig, dek: CryptoKey, credentialId: string,
  prfSalt: Uint8Array, prfOutput: Uint8Array, now?: number): Promise<VaultConfig>;
export function unlockWithPrfOutput(config: VaultConfig, prfOutput: Uint8Array): Promise<CryptoKey>;
export function removePrfKey(config: VaultConfig, now?: number): VaultConfig;
export function encryptSecret(dek: CryptoKey, name: string, value: string, now?: number, createdAt?: number): Promise<Secret>;
export function decryptSecret(dek: CryptoKey, secret: Secret): Promise<string>;
export class VaultError extends Error {
  code: 'wrong_pin' | 'no_vault' | 'locked' | 'no_biometric' | 'biometric_failed' | 'unsupported';
}
// optional second entry point, `secret-vault/session`: the in-memory unlocked key with an auto-lock timer
export function setUnlocked(dek: CryptoKey, ttlMs: number, now?: number): void;
export function getUnlockedDek(now?: number): CryptoKey | null;
export function lockVault(): void;
export function onVaultStateChange(listener: () => void): () => void;
```

Not a library candidate: the Samsung and Govee parsers and the clinician export are specific to this app's data; the
CSV code should be consolidated inside the app first (Rule breaks 7) and then replaced by a maintained npm CSV package
if one fits, not by a library of ours.
