# Home Experiments — spec pack

NightStack was built to debug thermal 4am wake-ups; that problem is
largely solved. The live problem is an abrupt **adrenergic 4am
arousal** (pounding heart, wired, can't return to sleep) that follows
modest sodium loads. Six months of Samsung Health data plus three
natural experiments point to **sleep position** as the strongest
modifier (salt + supine → episode; salt + side → no episode), with
**overnight fluid retention (~2 lb)** on salty nights and an open
question about **renal/autonomic sodium handling**. An endocrinology
visit is Friday 2026-09-05; a sleep study is likely to follow.

This pack makes the app capture a small set of home-experiment
measurements cleanly enough that (a) Jonathan can correlate them
against nights and (b) the record can be handed to a clinician. Three
competing theories must stay distinguishable — the app must make it
easy to tell them apart, not assume one:

| | Theory | What discriminates it |
|---|---|---|
| T1 | Renal / aldosterone — low sodium baseline, kidney swaps Na for K/Mg overnight | Electrolyte-drink dose, orthostatic vitals, no position dependence |
| T2 | Autonomic / volume — low-normal BP, sleeping HR 36–45, twitchy BP regulation | Orthostatic flags, pulse rise without a drop, position-independent |
| T3 | Fluid shift / airway — retained fluid moves into the neck when supine, airway narrows, O2 dips | **Position** (supine vs side), **neck circumference delta** vs weight delta, SpO2 dips before the episode |

## What this pack is for

An agent team implementing, in dependency order, the workstreams
below. Requirements were gathered **one question at a time** and are
recorded in `questions.md` (Q1–Q21); those decisions are authoritative
and every workstream file assumes them. Development is **BDD-first**:
each workstream's Given/When/Then scenarios become Vitest specs before
implementation.

Workflow: issue → research → plan → implement → validate, tracked in
HumanLayer. `research.md` is the research artifact; this README plus
the workstream files are the plan.

## Decisions that reshaped the brief

Read `questions.md` for the full record. The ones that change the
original brief's shape:

- **Q1 — three apps within the app.** The five-tab bar is replaced by
  a top-level switcher between **Routine**, **Tracking** and
  **Experiments**, each with its own tab bar; Settings is shared. New
  workstream `app-shell.md`.
- **Q5 — `weightEntries` is migrated** into a generalized
  `bodyMeasurements` table (`kind: 'weight' | 'neck'`).
- **Q8 — the blinded pinch experiment is dropped from the app.** No
  `BlindedExperiment` entity, allocator, PIN screen or reveal. Q9 and
  Q10 were not asked.
- **Q11 — the boolean `high_salt` flag is replaced** by
  `EveningIntake.sodiumLevel` (`normal | more | much_more`) with a
  `sodiumLevelSource` provenance field and a proxy backfill.
- **Q13 — electrolyte dose is a dedicated field**, not a
  `SupplementDef`.
- **Q17 — the Samsung Health bulk importer is in scope.** New
  workstream `samsung-bulk-import.md`.
- **Q20 — no priority cut before Friday.** Everything, starting now,
  merged in dependency order so any partial state is a working app.

## Workstreams

Each file is self-contained: scope, non-goals, data changes, UI
changes, Given/When/Then scenarios, acceptance criteria, open
questions. Files are ordered by dependency.

| File | Scope | Blocks / Blocked by |
|---|---|---|
| `questions.md` | Q1–Q21 with decisions. Read first. | — |
| `research.md` | Exact touch points in the codebase, migration pattern, provenance pattern, reader lists for `high_salt` and `weightEntries`, Samsung export layout. | — |
| `schema.md` | Types + Dexie v12: `bodyMeasurements` (weight migrated in, neck new), `orthostaticReadings`, `vitalSamples`, `NightLog` night-tag fields, `WakeUpEvent` episode fields, `sodiumLevel` replacing `high_salt`, `AppSettings` additions, two seeded rules. Backfills for every field. | **Blocks everything.** |
| `app-shell.md` | Three-app switcher (Routine / Tracking / Experiments), per-app tab bars, route prefixes with redirects for every existing deep link, PWA manifest shortcut for "Episode", dark-theme override for the 4am flow. | Blocked by `schema` (only for the Experiments home card). Blocks every UI workstream. |
| `episode-capture.md` | One-tap 4am "Episode" flow; `WakeUpEvent` extension; auto-created minimal `NightLog`; crash-safe draft (reuses `routineWipStorage` pattern); evening/morning wizards merge instead of overwrite. | Blocked by `schema`, `app-shell`. Runs in parallel with `vitals`, `body-measurements`, `night-tags`. |
| `vitals.md` | Orthostatic entry with coached timers; cuff/watch source; calibration age; derived drops/rises and flags (≥20 systolic, ≥10 diastolic, pulse rise ≥30 without drop); AM/PM reminders. | Blocked by `schema`, `app-shell`. Parallel. |
| `body-measurements.md` | AM/PM weight and neck circumference on the `bodyMeasurements` table; overnight deltas; retarget every `weightEntries` reader; bedtime weigh-in reminder. | Blocked by `schema`, `app-shell`. Parallel. |
| `night-tags.md` | `sodiumLevel` + sources + `electrolyteDose` + `positionStarted` in the evening log; `positionAtWake` + `wiredWake` in the morning log; imported Samsung wake time surfaced; retarget every `high_salt` reader. | Blocked by `schema`, `app-shell`. Parallel. |
| `samsung-bulk-import.md` | Parse the Samsung Health personal-data export (sleep CSV + per-minute HR/SpO2); store `vitalSamples`; pre-episode trace view. UNVERIFIED against a real export until Jonathan supplies one (Q21). | Blocked by `schema`, `episode-capture` (trace anchors on episode timestamps). |
| `insights-and-rules.md` | New measures in `Correlations` (either axis, deltas default Y), `MetricDetail`, Experiments dashboard cards; `adrenergicNight` derived boolean; clause kinds `high_salt_and_supine` and `orthostatic_flag_today` with seeded rules. | Blocked by all four capture workstreams. |
| `clinician-export.md` | One-tap CSV (one row per night) + print-styled HTML summary over a date range (14-day default), including tags, deltas, vitals, episodes, calibration flags. | Blocked by all four capture workstreams; `samsung-bulk-import` optional (adds SpO2 nadir column when present). |

## Dependency graph and execution order

```
schema ──► app-shell ──┬─► episode-capture ──┬─► samsung-bulk-import ──┐
                       ├─► vitals            │                          │
                       ├─► body-measurements ├─► insights-and-rules ────┼─► pack acceptance
                       └─► night-tags        └─► clinician-export ──────┘
```

- Agent 1 lands `schema` first; nothing else merges before it.
- Agent 2 lands `app-shell` next (it only needs the types).
- Agents 3–6 take `episode-capture`, `vitals`, `body-measurements`,
  `night-tags` in parallel. Each owns its own new files (see
  "Recommended file map" in `research.md`) and touches shared files
  (`EveningLog.tsx`, `MorningLog.tsx`, `DataManagementPage.tsx`) only
  in the places its spec names, with a note in the PR body.
- Agents 7–9 take `samsung-bulk-import`, `insights-and-rules`,
  `clinician-export` once all four capture PRs are merged.

One PR per workstream against `main`, small, spec file linked. `npm
run lint`, `npm run build`, `npm test` green before opening.

## Pack acceptance (orchestrator verifies before closing the issue)

1. **Upgrade safety.** On a fresh install and on an upgraded install
   with existing v11 data, all pages render with no `undefined`
   reads; historical nights show `sodiumLevel` with
   `sodiumLevelSource: 'proxy'` (`'more'` where `high_salt` was
   active, else `'normal'`), every prior `weightEntries` row exists
   in `bodyMeasurements` with the same id and value, and the Weight
   Profile trend is unchanged.
2. **Vitals in under 60 s.** A full orthostatic entry (coached or
   direct) completes in under 60 seconds of interaction and yields the
   three deltas and any flags on the Experiments dashboard the same
   day.
3. **One-tap episode from cold.** From a killed app at 4:30 AM, an
   episode is saved in one tap (PWA shortcut or the Experiments home
   button), survives the app being killed mid follow-up, and is
   attached to the correct night when the morning log is opened —
   including when no evening log existed.
4. **Three-app shell.** The switcher reaches Routine, Tracking and
   Experiments; every route that existed at v11 still resolves (by
   redirect where it moved); the tab bar within each app reflects only
   that app; the 4am flow is dark regardless of the theme setting.
5. **Clinician CSV.** The CSV for the last 14 nights opens in a
   spreadsheet with one row per night and columns for every tag,
   delta, vital, flag and episode field; the printable summary
   renders the same nights on one page.
6. **Insights and rules.** `Correlations` can plot overnight weight
   delta and neck delta against sodium level and position; a seeded
   rule fires "Sleep on your side tonight" when tonight's
   `sodiumLevel !== 'normal'`; "Bring today's orthostatic reading to
   the doctor" fires when any reading today carries a flag.
7. **Samsung bulk import.** A folder matching the documented export
   layout imports with a per-file recognized/skipped report, fills
   `sleepData` for every night it covers without duplicating existing
   rows (`sleepDataDedupe`), and a pre-episode HR/SpO2 trace renders
   for a night that has both samples and an episode.
8. **Tests.** Every existing test still passes; the Q18 required
   tests exist and pass.

## Constraints (apply to every workstream)

- Nothing in the app prescribes doses, diet changes or medical
  interpretation. Flags say "bring this to your doctor," not what it
  means.
- Offline-first: no network dependency on any capture path.
  `docs/pwa-best-practices.md` applies.
- One-thumb mobile ergonomics as in the current logs; 44 px targets;
  the 4am flow forces the dark theme.
- Every new field gets a versioned migration with a backfill; no
  `undefined` reads.
- Preserve every existing test.

## Not in scope

- **Blinded pinch experiment** (Q8). If wanted later: a
  `BlindedExperiment` entity with encrypted-at-rest allocations and a
  PIN-gated reveal; file its own pack.
- Dropping the legacy `weightEntries` table (kept read-only for one
  release after v12; drop in v13).
- Watch-side automation (reading BP/ECG directly from the Galaxy
  Watch); readings are typed in.
- Any recommender (`recommender.ts`) changes beyond keeping it
  compiling against the new types.

## Status (2026-09-03)

All nine workstreams are implemented on branch
`claude/nightstack-home-experiments-udr0ui`, one commit per workstream
in dependency order, each validated with `npm run lint`, `npx tsc
--noEmit`, `npm test` and `npm run build` before commit.

| Workstream | Commit | Tests added |
|---|---|---|
| schema | `feat(schema)` | `schemaBackfill.test.ts`, `schemaV12.test.ts` (real v11 → v12 upgrade on fake-indexeddb) |
| app-shell | `feat(app-shell)` | `apps.test.ts`, `appShell.test.tsx` |
| episode-capture | `feat(episode-capture)` | `episodes.test.ts`, `episodeDraftStorage.test.ts`, `episodeCapture.test.tsx` |
| vitals | `feat(vitals)` | `orthostatic.test.ts`, `notifications.test.ts`, `vitalsEntry.test.tsx` |
| body-measurements | `feat(body-measurements)` | `bodyMeasurements.test.ts` (incl. backup round trip and pre-v12 import) |
| night-tags | `feat(night-tags)` | `nightTags.test.ts` |
| insights-and-rules | `feat(insights-and-rules)` | `nightMetrics.test.ts`, `homeExperimentRules.test.ts` |
| clinician-export | `feat(clinician-export)` | `clinicianExport.test.ts` (CSV round trip) |
| samsung-bulk-import | `feat(samsung-bulk-import)` | `samsungExport.test.ts` + `fixtures/samsung.ts` (hand-written, UNVERIFIED) |
| pack | `test(pack)` | `appRoutes.test.tsx` mounts the whole app at all 41 routes on a seeded DB |

Pack acceptance: items 1, 3, 4, 5, 6, 7 and 8 are covered by the tests
above (288 → 461 tests). Items 2 (vitals entry under 60 s) and the
on-phone halves of 3, 4 and 5 (PWA shortcut, print-to-PDF, opening the
CSV in Sheets) need a manual pass on the phone.

Deviations from the brief, decided by the orchestrator:

- **Single branch, sequential commits, no PRs opened.** The session's
  branch rules confine pushes to the designated branch, and the
  workstreams overlap heavily in `EveningLog.tsx`, `MorningLog.tsx`
  and `db.ts`; parallel agent branches would have conflicted. The
  research agent also died on a usage-credit error, so research and
  implementation were done inline.
- **Tag steps live inside existing wizard steps** (evening Food & Drink,
  morning Wake-Up Events) rather than as new numbered steps, to avoid
  renumbering the 8- and 5-step wizards two days before the visit.
- **Reminders fire only while the app is open** (pre-existing
  `setTimeout` scheduler; no service-worker push). Documented on the
  Reminders page.
- **`weightEntries` is kept** (read-only, exported for one release)
  alongside the new `bodyMeasurements`; drop in v13.
- **Samsung parser is unverified** against a real export (Q21); the
  first-real-export checklist is in `samsung-bulk-import.md`.

## Follow-up packs

- `weight-table-cleanup` — drop `weightEntries`, fold the Weight
  Profile page into the Experiments app's body-measurements tab.
- `blinded-experiment` — see "Not in scope".
- `samsung-import-verification` — replace the hand-written Samsung
  fixtures with Jonathan's real export once available (Q21).
