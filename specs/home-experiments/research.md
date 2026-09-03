# Research — home-experiments touch points

Read after `questions.md`. Every workstream file references sections
here by number. Line numbers are against `main` at `7cb3689`.

## 1. Dexie version and migration pattern

- `src/db.ts:177` — current head is **version 11**. Each version calls
  `.stores({...})` listing only the tables whose indexes change, then
  `.upgrade(async (tx) => …)`.
- Backfill idiom: `tx.table('x').toCollection().modify((row) => { if
  (row.f === undefined) row.f = default; })` — see v7 (`:114-125`), v8
  (`:126-150`, nested `environment` and `wakeUpEvents[]` backfill), v10
  (`:161-176`).
- Seeding for upgraders: v5 (`:73-100`) counts a table and `bulkAdd`s
  if empty, and dedupes rules **by name** against `sleepRules` before
  adding. Reuse that for the two new rules.
- `seedDatabase()` (`:268`) short-circuits on `appSettings.count() >
  0`, so anything upgraders need must also be in an `upgrade`.
- `createBlankNightLog` lives in `src/utils.ts:319-375` (not `db.ts`)
  and is the single factory for a blank `NightLog`; it hard-codes the
  five default flags including `high_salt` at `:340`. `EveningLog.tsx:188`
  duplicates the same flag list for its form state.
- Tests: `src/test/setup.ts` imports `fake-indexeddb/auto`;
  `src/test/db.test.ts` does `await db.delete(); await db.open()` in
  `beforeEach` and asserts seed counts (12 rules, 13 supplements…).
  **No existing test opens an older-version database to exercise an
  upgrade.** `schemaV12.test.ts` must create a throwaway `new
  Dexie('nightstack')` with `.version(11).stores({...})` matching the
  v11 union of stores, insert fixture rows, `close()`, then open
  `NightStackDB`. Because `db` is a module singleton, run this in its
  own test file and call `db.delete()` first.
- The v12 shape recommended in `schema.md` follows the above exactly.
  `db.test.ts` seed-count assertions must be updated: rules 12 → 14.

## 2. Provenance pattern (template for `sodiumLevelSource`)

- Types: `NightLog.thermalComfort`, `thermalComfortSource: 'user' |
  'proxy' | null`, `thermalProxyDismissed` (`src/types.ts:34-52`).
- Writer (user): `MorningLog.tsx:668-680` — `db.nightLogs.update(id,
  { thermalComfort, thermalComfortSource: thermalComfort ? 'user' :
  null, … })`.
- Writer (proxy): `src/pages/insights/ThermalBackfillReview.tsx` via
  `src/services/thermalProxy.ts`.
- Reader: `src/components/ThermalComfortChip.tsx` renders the label and
  a "proxy" hint; `MorningReview.tsx:126,144,154` uses it.
- For sodium: `sodiumLevelSource` has no `null` state (every night has
  a level after v12), so the pair is `'user' | 'proxy'`. Evening log
  stamps `'user'` when the picker is touched (track a `touched` flag
  like `lastMealTimeTouched` at `EveningLog.tsx:535`). A
  `SodiumLevelChip` mirroring `ThermalComfortChip` shows "(inferred)"
  for proxy rows.

## 3. `high_salt` readers (Q11: flag removed)

| File:line | What it does today | Change |
|---|---|---|
| `src/types.ts:94` | union member | remove |
| `src/utils.ts:340` | default flag in `createBlankNightLog` | remove; add `sodiumLevel: 'normal'`, `sodiumLevelSource: 'user'`, `sodiumSources: []` |
| `src/pages/tonight/EveningLog.tsx:188` | default flag list for form state | remove row; add sodium picker state (night-tags) |
| `src/pages/insights/ThermalFit.tsx:35,43` | `INTAKE_LABELS` / `INTAKE_KEYS` filter chips keyed by flag type | replace `high_salt` key with `sodium_more` (level ≥ more) and `sodium_much_more`; the filter predicate reads `eveningIntake.sodiumLevel` |
| `src/test/recommender.test.ts:415-440` | toggles `high_salt` on fixtures to prove flags don't affect distance | change the loop to `['overate','late_meal']` and add a sodium-level flip assertion |
| `specs/recommender-v2/distance-function.md:150` | doc only | leave |

**Not readers** (verified by grep): `CalendarPage.tsx` (no flag
reads), `Correlations.tsx` (reads `anyFlag` and `overate` only — note
`anyFlag` semantics change slightly once `high_salt` is gone; document
in night-tags), `BestNights.tsx` (grep `flags` there before assuming),
`recommender.ts` (comment at `:29` says binary food flags were
dropped; `:209` handles booleans generically), `rules.ts` (no clause
reads flags), `dataCleanupScanner.ts`, `DataManagementPage.tsx`
(imports `nightLogs` verbatim — **old backups containing `high_salt`
must be translated on import**; add a `normalizeImportedNightLog`
that runs `backfillNightLogV12` on each row).

## 4. `weightEntries` readers (Q5: migrate into `bodyMeasurements`)

| File:line | Today | Change |
|---|---|---|
| `src/weightUtils.ts:161-330` | `recalculateCalculatedWeights(entries: WeightEntry[], anchorId)`, `recalculateAllCalculatedWeights(entries)` — pure, keyed on `timestamp`, `measured`, `weightLbs` | Generalize to `BodyMeasurement` via `value`: rename params to `entries: BodyMeasurement[]`, replace `weightLbs` with `value`, keep `roundWeightLbs` for `kind==='weight'` and a `roundNeckIn` (0.1 in) for `kind==='neck'`. Keep the old names exported as thin adapters for one release so `weightUtils.test.ts` (400 lines) only needs its `makeEntry` fixture updated. |
| `src/pages/tonight/EveningLog.tsx:166,573-590` | `latestWeight` query; on save adds a `period:'evening'` row and recalculates | Query `bodyMeasurements.where('kind').equals('weight')…`; add weight **and** neck rows; recalc per kind. Body-measurements owns this edit. |
| `src/pages/morning/MorningLog.tsx:124,683-706` | same for `period:'morning'` | same |
| `src/components/WeightEditCard.tsx:26,77,85-87` | loads entry by `nightLogId`+period, updates, recalcs | Generalize to `BodyMeasurementEditCard` with `kind` prop |
| `src/components/WeightStepper.tsx` | stepper over lbs/kg | add `NeckStepper` (in/cm, 0.1 step) or generalize with a `unit` prop |
| `src/components/NightLogDateEditor.tsx:40` | re-links `weightEntries` when a night's date changes | re-link `bodyMeasurements` (all kinds) |
| `src/pages/settings/WeightProfilePage.tsx` | trend chart over `weightEntries` | read `kind==='weight'`; period filter uses `weighInPeriod` (Q4) |
| `src/pages/insights/Correlations.tsx:220-247` | `weightByLogId` map from all entries | read `kind==='weight'`; add neck + deltas (insights) |
| `src/pages/settings/DataManagementPage.tsx:113,141-156` | full and range export include `weightEntries`; **import ignores it entirely** (`:212-265` never restores weights — pre-existing bug) | export `bodyMeasurements` (and still `weightEntries` for one release); import restores `bodyMeasurements`, and translates a legacy `weightEntries` array via `weightEntryToBodyMeasurement` |
| `src/db.ts:20,40,53-58` | table + v2/v3 | keep declared; add `bodyMeasurements` |
| `src/test/weightUtils.test.ts` | fixtures via `makeEntry` | update fixture shape only |
| `src/services/dataCleanupScanner.ts` | grep shows **no** weight reads | none |

Blast radius: 11 files. Adapter strategy: land `weightUtils`
generalization with old-name re-exports first, then move each page.

## 5. `WakeUpEvent` lifecycle

- State: `MorningLog.tsx:177` `useState<WakeUpEvent[]>`; hydrated from
  the draft (`:238`) or the stored log (`:253-255`); pre-filled from the
  Samsung import via `resolveWakeUpEvents` (`:380-381`), which maps
  `ParsedWakeUpEvent.cause` labels to `WakeUpCause` ids.
- Editing UI: the per-event card starts around `:1272`; the "any two of
  start / end / duration" logic (commit `e95a3f0`) lives in the
  handlers that set `startTime` / `endTime` /
  `minutesToFallBackAsleep`.
- Save: `performSave` (`:668-680`) writes `wakeUpEvents: hadWakeUps ?
  resolvedWakes : []` — **this overwrites any episode rows** the 4am
  flow attached if the user toggles "did you wake up" off, and it
  drops any event field the morning UI doesn't round-trip.
  `episode-capture.md` requires: hydrate `source:'episode'` rows into
  state, never filter them out on `hadWakeUps === false`, and spread the
  original event when editing so episode fields survive.
- Blank-cause confirm (`:714-737`) stamps the `Unknown` cause id; an
  episode row starts with `cause: ''` and goes through the same path.
- Consumers: `MorningReview.tsx:294-297`, `Dashboard.tsx` recent-night
  rows (count), `MetricDetail.tsx:56` (count), `Correlations.tsx:179`
  (count), `rules.ts:175-183` (`recurrent_night_wakeup` parses
  `startTime` hours 2–4), `thermalProxy.ts` (per-wake thermal flags),
  `recommender.ts`.
- Draft key: `getDraftKey(nightLog.date)` with `DRAFT_SCHEMA_VERSION =
  2` stamped as `__v` (`:57-77`); drafts without the stamp are dropped
  (fix `4f36ee5`). Auto-save at `:275-291`.

## 6. Night-log creation and date keying

- `getEveningLogDate(now)` (`src/utils.ts:100-106`): before noon →
  yesterday; else today. Used by `EveningLog.tsx:101`,
  `TonightPlan.tsx:40`, `routineWipStorage.ts:61`.
- `EveningLog` finds an existing row by `date` (`:115-118`) and on save
  does `{ ...existingLog }` **or** `createBlankNightLog` (`:474-483`),
  then overwrites `alarm`, `stack`, `eveningIntake`, `environment`,
  `clothing`, `bedding`, `middayStruggle`, `eveningNotes` and
  `db.nightLogs.put` (`:568`). Morning-side fields are preserved by the
  spread — so an `autoCreated` row's `wakeUpEvents` survive an evening
  save already. The only merge work is: clear `autoCreated`, and
  preserve `positionAtWake`/`wiredWake` if the morning log ran first.
- `MorningLog` resolves the log by `?date=`, else today, else
  yesterday (`:88-100`) and shows "No evening log found" at `:769` when
  null. With Q6 an auto-created row exists, so that branch is reached
  less often; it must still work.
- Draft key for evening: `evening-log-draft-${logDate}`
  (`EveningLog.tsx:112`); `TonightPlan.tsx:99,114` peeks at it.
- `nightLogs` index is `id, date` — **not unique on `date`**.
  `dataCleanupScanner.ts` exists because duplicates have happened. The
  episode flow must `where('date').equals(d).first()` and only create
  when null, inside a `db.transaction('rw', db.nightLogs, …)`.

## 7. Crash-safe draft pattern

`src/pages/tonight/routineWipStorage.ts`: `WIP_KEY`, `loadWip(now)`
validates shape and **expires the draft when its `startedAt` falls on a
different evening** (`:52-70`); `saveWip(wip|null)` is best-effort
try/catch (`:72-82`). `RoutineStartCard.tsx:17` offers "resume" from
`loadWip`; `RoutineTracker.tsx:33` reads/writes it. Test file
`src/test/routineWipStorage.test.ts` (400+ lines) is pure — sets
`localStorage`, calls the functions, asserts. Copy this shape for
`episodeDraftStorage.ts`, with one difference: the episode draft must
**not** expire on evening rollover until the morning log has been
saved, because a 4am draft is opened at 7am (same evening per
`getEveningLogDate`, fine) but may also be finished at 1pm (different
evening) — key the draft by the night date it was attached to, not by
`startedAt`.

## 8. Navigation and app shell

- Routes: `src/App.tsx:44-76` — flat `<Routes>`; `BottomTabs`
  (`src/components/BottomTabs.tsx`) is a fixed bar of five, active by
  `pathname.startsWith(tab.path)`. CSS: `.app-layout` (column,
  `100svh`), `.app-content` (scroll, `padding-bottom: tab-height`),
  `.bottom-tabs` (fixed, `--tab-height`), `.tab-button[.active]`
  (`src/theme.css:56-113`); `.page-header` at `:405`.
- Theme: `useTheme` (`src/hooks/useTheme.ts`) sets
  `document.documentElement[data-theme]` from `settings.darkMode`;
  `theme.css:20` overrides variables under `[data-theme="light"]`. A
  page can force dark by setting `data-theme="dark"` on its own root
  wrapper **only if** the variables are defined on `[data-theme]`
  selectors rather than `:root`; check `theme.css:1-50` — if they are
  on `:root` with a light override, forcing dark on a subtree needs a
  `.force-dark` class that redeclares the dark variables. App-shell
  owns this.
- Hard-coded paths: **59 occurrences in 29 files** (`navigate('/…')`,
  `to="/…"`). Existing routes (all must keep resolving):
  `/tonight`, `/tonight/log`, `/tonight/review/:id`, `/tonight/routine`,
  `/morning`, `/morning/review/:id`, `/morning/room-conditions/:id`,
  `/calendar`, `/insights`, `/insights/correlations`,
  `/insights/thermal-fit`, `/insights/best-nights`,
  `/insights/metric/:type`, `/insights/backfill`, `/settings/*` (15).
  Recommendation: **do not move existing routes**. Keep every path;
  mount the three apps as route *groups* with their own tab bars:
  Routine = `/tonight/routine`, `/routine/*` (new home + analytics);
  Tracking = `/tonight`, `/morning`, `/calendar`, `/insights`;
  Experiments = `/experiments/*` (new). The switcher is a compact
  segmented control above the tab bar (or in `.page-header`), and the
  last-used app is remembered in `localStorage['nightstack-app']`. A
  `/` redirect goes to the remembered app's home. This keeps all 59
  links valid with zero edits.
- PWA: `vite.config.ts:22-60` — `VitePWA` manifest has `start_url:
  '.'`, `scope: '.'`, no `shortcuts`. Add `shortcuts: [{ name:
  'Episode', url: './experiments/episode', icons: […] }]` (relative,
  per `docs/pwa-best-practices.md`). `public/` has no separate
  manifest file. `404.html` handles GitHub Pages deep links.

## 9. Notifications

- `src/services/notifications.ts`: `scheduleNotifications(alarm,
  prefs)` clears then schedules five `setTimeout`s within 24 h,
  gated by `prefs.<key>`; fires `new Notification(...)` **only while
  the page is alive** (no service-worker push). Called once, from
  `EveningLog.tsx:595` on save.
- `routineNotifications.ts` is a separate single-timer scheduler for
  the routine start time.
- **Surprise:** no Settings page toggles `notificationPreferences`
  (grep hits only `EveningLog.tsx:595` and `db.ts` seed). `AboutPage`
  has a dark-mode toggle only. `vitals.md` therefore adds a small
  **Settings › Reminders** page listing all eight preferences, and the
  PR notes that reminders fire only while the app is open.

## 10. Export / import

- `DataManagementPage.tsx:31-41` `triggerJsonDownload` (Blob + anchor).
  Payloads: "Export All Data" (`:80-94`, table dump, no weights),
  "Full export" (`:105-123`, `version: 1`, `weightEntries`,
  `routineSessions`, `config`), range export (`:125-167`).
- Import (`:199-275`) clears and `bulkAdd`s **verbatim** — no schema
  translation, and **weights are never restored** (pre-existing bug).
  Clinician export reuses `triggerJsonDownload`'s pattern with
  `text/csv`; the printable page is an in-app route with `@media print`
  CSS and a `window.print()` button.

## 11. Insights

- `Correlations.tsx`: `XVar` / `YVar` string unions (`:18-43`),
  `X_OPTIONS` / `Y_OPTIONS` label tables (`:45-70`), `getXValue(log,
  v, weightByLogId, derived)` (`:121-168`) and `getYValue(log, v)`
  (`:170-182`, returns null without `sleepData`), 90-day window
  (`:210-214`), Pearson via `linearRegression`. To let a measure sit on
  either axis (Q15), refactor to one `MetricDef { key, label, side:
  'x' | 'y' | 'both', extract(ctx) }` list and derive both pickers
  from it; `ctx` carries per-night maps for body measurements and
  orthostatic readings.
- `MetricDetail.tsx`: `METRIC_CONFIG: Record<MetricType, MetricConfig>`
  with `extract(log)`; add `weightDelta`, `neckDelta`,
  `orthoSystolicDropAm`… by widening `MetricConfig.extract` to
  `(log, ctx)`.
- `Dashboard.tsx`: `SubNav` exported at `:20-51`, 90-log query, 14-night
  chart, 7-night metrics, `BACKFILL_ONBOARDING_KEY` one-time card
  pattern (`:18,92-113`).
- `ThermalFit.tsx:28-46` reads flag keys (see §3).

## 12. Rules engine

- `src/services/rules.ts`: `RuleEvalContext { weather, currentRoomTemp,
  recentLogs, currentLog, middayCopingItems? }` (`:12-24`);
  `CLAUSE_KINDS` metadata drives the editor (`:51-63`);
  `formatClause` (`:83-108`) and `evaluateClause` (`:144-208`) are
  exhaustive `switch`es with no default, so the compiler forces both new
  cases. `SleepRulesPage.tsx:318` maps `CLAUSE_KINDS` into the picker,
  `makeClause` at `:253,307`.
- `orthostatic_flag_today` needs today's readings: extend
  `RuleEvalContext` with `todayOrthostatic?: OrthostaticReading[]`
  (optional so existing callers/tests compile) and have `TonightPlan`
  pass them. `high_salt_and_supine` reads
  `currentLog.eveningIntake.sodiumLevel` and `positionStarted`.
- `src/test/rules.test.ts` builds contexts by hand; add cases there.

## 13. Importers and Samsung export layout

- `parseSamsungHealthJSON(jsonStr, targetDate?)`
  (`src/services/importers.ts:190-273`) accepts one session, `{sessions:
  []}` or an array, filters by `deriveSessionDate`, and returns `{ data,
  wakeUpEvents, error, sessionDate }`. `findDuplicateSleepData`
  (`sleepDataDedupe.ts:27-68`) fingerprints eleven fields within ±3
  days.
- Samsung Health "Download personal data" layout (from public
  descriptions; **UNVERIFIED** against Jonathan's export, Q21):
  - Top-level CSVs named `com.samsung.shealth.<type>.<yyyymmddHHMM>.csv`.
    **Line 1 is a metadata line** (`com.samsung.shealth.sleep,<n>,<ver>`);
    the real header is **line 2**; rows follow. Columns carry the
    `com.samsung.health.sleep.` prefix on core fields.
  - `com.samsung.shealth.sleep.*.csv`: `start_time`, `end_time`
    (UTC, `"YYYY-MM-DD HH:MM:SS.sss"`), `time_offset` (`"UTC-0400"`),
    `sleep_score`, `efficiency`, `sleep_duration`, `mental_recovery`,
    `physical_recovery`, `sleep_cycle`, `factor_*`, `datauuid`.
  - `com.samsung.health.sleep_stage.*.csv`: `start_time`, `end_time`,
    `stage` (40000 awake, 40001 light, 40002 deep, 40003 REM — UNVERIFIED
    codes), `sleep_id`.
  - `com.samsung.shealth.tracker.heart_rate.*.csv`: `start_time`,
    `end_time`, `heart_rate`, `heart_rate_min`, `heart_rate_max`,
    `binning_data` (a filename under `jsons/…/` holding per-minute
    `[{start_time, end_time, heart_rate, heart_rate_min,
    heart_rate_max}]`).
  - `com.samsung.shealth.tracker.oxygen_saturation.*.csv`: `start_time`,
    `spo2`, `spo2_min`, `spo2_max`, possibly `binning` json.
  - Timestamps in CSV are UTC; apply `time_offset` to place them in
    local time.
- Parser must: skip line 1, detect prefix-stripped column names, ignore
  unknown columns, report per-file `{recognized, rows, note}`.

## 14. Test conventions

- Vitest `globals: true`, `environment: 'jsdom'`, setup imports
  jest-dom and `fake-indexeddb/auto` (`vite.config.ts:14-19`,
  `src/test/setup.ts`).
- **No component tests exist** (all 13 test files are pure/service/DB
  level). `@testing-library/react` is installed but unused; a first
  component test needs `render` from it plus `MemoryRouter`. Keep it
  to the required cases (Q18).
- ESLint: `typescript-eslint` recommended + react-hooks rules as
  **warnings**; CI runs `npm run lint`, `npx tsc --noEmit`, `npm test`,
  `npm run build` (`.github/workflows/ci.yml`).
- `db` is a module singleton; DB tests `await db.delete(); await
  db.open()` per test.

## 15. Surprises and risks

1. `MorningLog.tsx` is 1611 lines and `EveningLog.tsx` 1415, both
   single components with step state. New steps should be **separate
   components** under `src/pages/{morning,tonight}/steps/` receiving
   value/onChange props, with the wizard only adding a `case`. Two
   parallel workstreams (`night-tags`, `body-measurements`) touch both
   wizards; each adds its own step component file and only edits the
   step list and save block — expect a small merge conflict there.
2. Import path never restores weights; the body-measurements
   workstream fixes it while retargeting.
3. No notification settings UI (see §9).
4. `nightLogs.date` is not unique; the episode flow's create-if-missing
   must be transactional (§6).
5. `evaluateClause` has no default branch, so `schema` must add
   placeholder cases returning `false` for the two new kinds or the
   build breaks before `insights-and-rules` lands.
6. Correlations `anyFlag` silently changes meaning when `high_salt` is
   removed; night-tags adds a `sodiumLevel` X option and documents it.
7. The `wakeUpEvents: hadWakeUps ? resolvedWakes : []` save path can
   erase episodes (§5).

## Recommended file map

| Workstream | New files |
|---|---|
| schema | `src/services/schemaBackfill.ts`, `src/test/schemaBackfill.test.ts`, `src/test/schemaV12.test.ts` |
| app-shell | `src/components/AppSwitcher.tsx`, `src/components/AppTabBar.tsx`, `src/apps.ts` (app + tab registry), `src/pages/routine/RoutineHome.tsx`, `src/pages/experiments/ExperimentsHome.tsx`, `src/test/apps.test.ts` |
| episode-capture | `src/pages/experiments/EpisodeCapture.tsx`, `src/pages/experiments/episodeDraftStorage.ts`, `src/services/episodes.ts` (attach/auto-create), `src/test/episodes.test.ts`, `src/test/episodeDraftStorage.test.ts`, `src/test/episodeCapture.test.tsx` |
| vitals | `src/pages/experiments/VitalsTab.tsx`, `src/pages/experiments/OrthostaticEntry.tsx`, `src/services/orthostatic.ts`, `src/components/OrthostaticSummaryCard.tsx`, `src/pages/settings/RemindersPage.tsx`, `src/pages/settings/VitalsSettingsPage.tsx`, `src/test/orthostatic.test.ts`, `src/test/vitalsEntry.test.tsx`, `src/test/notifications.test.ts` |
| body-measurements | `src/services/bodyMeasurements.ts` (queries, deltas), `src/components/BodyMeasurementEditCard.tsx`, `src/components/NeckStepper.tsx`, `src/pages/tonight/steps/BodyMeasurementStep.tsx`, `src/pages/morning/steps/BodyMeasurementStep.tsx`, `src/pages/experiments/BodyTab.tsx`, `src/test/bodyMeasurements.test.ts` |
| night-tags | `src/pages/tonight/steps/NightTagsStep.tsx`, `src/pages/morning/steps/WakeTagsStep.tsx`, `src/components/SodiumLevelChip.tsx`, `src/test/nightTags.test.ts` |
| samsung-bulk-import | `src/services/samsungExport.ts`, `src/pages/experiments/SamsungImportPage.tsx`, `src/components/VitalTraceChart.tsx`, `src/test/samsungExport.test.ts`, `src/test/fixtures/samsung/*` |
| insights-and-rules | `src/services/nightMetrics.ts` (shared extractors), edits to `Correlations`, `MetricDetail`, `rules.ts`, `SleepRulesPage`, `ExperimentsHome`, `src/test/nightMetrics.test.ts`, additions to `rules.test.ts` |
| clinician-export | `src/services/clinicianExport.ts`, `src/pages/experiments/ClinicianExportPage.tsx`, `src/pages/experiments/ClinicianSummaryPrint.tsx`, `src/test/clinicianExport.test.ts` |
