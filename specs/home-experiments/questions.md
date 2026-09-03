# Open questions — home-experiments pack

Cross-cutting questions that affect multiple workstreams. Each was put
to Jonathan **one at a time**, in order, before any planning started.
The **Decision** line under each question is authoritative; the
"default" is what would have applied had the question been deferred.

Status legend: `ANSWERED` · `DEFERRED (default applies)` · `PENDING`

Read this file before starting any workstream. Per-workstream "Open
questions" sections stay inside each spec file for questions scoped to
a single workstream.

---

## Q1. Where do orthostatic vitals live in the UI?

**Affects:** `vitals.md` · `insights-and-rules.md` (dashboard card)

**Context.** Orthostatic vitals are taken twice a day (AM/PM), and the
AM reading is usually before the morning log is opened, the PM reading
before the evening log. Neither existing wizard is a natural home for
a 5-minute protocol, and the wizards are date-keyed (evening date), so
a morning reading would land on the *previous* night's log.

Options considered:

- **(a) New "Vitals" tab.** Discoverable, but the bottom bar is already
  at five tabs (Tonight / Morning / Calendar / Insights / Settings).
- **(b) Card inside MorningLog and EveningLog.** Zero new nav, but
  forces the reading into a wizard step and the date-keying problem
  above.
- **(c) Standalone quick-entry sheet reachable from both logs and the
  Dashboard, plus a read-only summary card in each log.** Reading is
  keyed by its own timestamp + `slot: 'am' | 'pm'` and joined to the
  night by date, not owned by the wizard.

**Default:** (c).

**Status:** ANSWERED (2026-09-03)

**Decision:** None of the offered options. Jonathan asked for a UI
refactor into **three apps within the app**, each with its own tab bar
and a top-level switcher replacing the current five-tab bar; Settings
stays shared:

1. **Routine** — the evening routine tracker (`RoutineTracker`,
   `RoutineStartCard`, variants, routine analytics).
2. **Tracking** — nightly tracking: Tonight plan, evening + morning
   logs, calendar, insights (Dashboard, Correlations, BestNights,
   ThermalFit, MetricDetail).
3. **Experiments** — home experiments: orthostatic vitals, AM/PM
   weight + neck, episode capture, blinded pinch, clinician export.

Consequences:

- New workstream **`app-shell.md`** (three-app switcher, per-app tab
  bars, route prefixes, deep links preserved for existing paths). It
  is a dependency of every UI workstream in this pack and must land
  right after `schema`.
- Orthostatic vitals live in the **Experiments** app as their own tab
  (full quick-entry sheet), keyed by their own timestamp + AM/PM slot
  and joined to the night by date. Tracking's logs get a read-only
  summary card, not an entry step.
- The 4am episode button must be reachable in **one tap from cold
  launch** regardless of which app was last open (see Q7).

---

## Q2. Coach the orthostatic protocol, or just accept six numbers?

**Affects:** `vitals.md`

**Context.** The protocol is supine 5 min → reading → stand → reading
at 1 min → reading at 3 min. A coached flow (timers + prompts) makes
the readings comparable day to day; an uncoached form is faster when
the cuff is already on and Jonathan is timing himself.

Options considered:

- **(a) Coach with timers**, with a "skip timer" affordance on every
  stage and a "just enter numbers" shortcut on the first screen.
- **(b) Plain form** with six number inputs and a source picker.
- **(c) Both, chosen per entry.**

**Default:** (a) — coach, with a skip.

**Status:** ANSWERED (2026-09-03)

**Decision:** (a). Coached flow with countdown timers and a prompt at
each of the three points; every timer is skippable and the first
screen offers a "just enter numbers" shortcut that drops straight to
the six-field form. Timers must survive the screen locking (compute
from a stored start timestamp, not `setInterval` state).

---

## Q3. Is the Galaxy Watch BP a first-class source, and track calibration age?

**Affects:** `vitals.md` · `schema.md` · `clinician-export.md`

**Context.** Samsung's watch BP requires cuff calibration every 28
days. A clinician will discount watch readings that are far from a
calibration. If the app stores `bpCalibratedAt`, each reading can carry
`daysSinceCalibration` and a "recalibrate" flag; the export can show
it.

Options considered:

- **(a) Yes to both:** `source: 'cuff' | 'watch'` on every reading, a
  `watchBpCalibratedAt` setting, and a >28-day flag.
- **(b) Source only,** no calibration tracking.
- **(c) Cuff only** — treat watch BP as untrusted and don't store it.

**Default:** (a).

**Status:** ANSWERED (2026-09-03)

**Decision:** (a). `source: 'cuff' | 'watch'` on every orthostatic
reading; `AppSettings.watchBpCalibratedAt: number | null`; a watch
reading taken >28 days after calibration carries a derived
`needsRecalibration` flag shown in the vitals list and the clinician
export. The flag is derived at read time from the reading's timestamp
and the calibration date in effect, never stored.

---

## Q4. Weight: keep the single weigh-in setting, or make AM and PM first-class?

**Affects:** `body-measurements.md` · `schema.md` · `insights-and-rules.md`

**Context.** `WeightEntry.period` already supports `'morning' |
'evening'`, but `AppSettings.weighInPeriod` makes the daily flow assume
one weigh-in and the Weight Profile page graphs a single series. The
overnight delta (PM → next AM) is the measurement that matters for the
fluid-retention theory.

Options considered:

- **(a) Both first-class.** Evening log prompts for PM weight, morning
  log prompts for AM weight, overnight delta is the primary metric on
  the Dashboard; `weighInPeriod` becomes the *preferred* period for the
  long-term trend chart only.
- **(b) Keep single weigh-in,** add an optional second one behind a
  toggle.

**Default:** (a).

**Status:** ANSWERED (2026-09-03)

**Decision:** (a). AM and PM weigh-ins are both first-class. The
evening log prompts for PM weight, the morning log prompts for AM
weight, and the Experiments dashboard leads with the overnight delta
(PM → next AM, both `measured: true`; interpolated rows never feed a
delta). `weighInPeriod` survives only as "which series drives the
long-term trend chart" on the Weight Profile page.

---

## Q5. Neck circumference: generalized `BodyMeasurement` table, or a column on `WeightEntry`?

**Affects:** `body-measurements.md` · `schema.md` · `clinician-export.md`

**Context.** Neck circumference does not exist anywhere. It is taken at
the same two moments as weight (bedtime, morning) and needs unit
handling (in/cm, mirroring `unitSystem`).

Options considered:

- **(a) New `bodyMeasurements` table** generalized over
  `{ kind: 'weight' | 'neck' }`, and **migrate `weightEntries` into it**.
  Cleanest long-term; riskiest migration (Weight Profile page, fill-
  forward/interpolation in `weightUtils`, Data Management import/export,
  the cleanup scanner all read `weightEntries`).
- **(b) New `bodyMeasurements` table for neck only,** leave
  `weightEntries` as-is and join by `date + period`. Two tables, one
  concept, but zero churn on the weight code.
- **(c) `neckIn: number | null` column on `WeightEntry`.** Smallest
  change; couples neck to a weigh-in existing.

**Default:** (b) — generalized table for new kinds, leave
`weightEntries` alone for this pack; note a follow-up to fold weight in.

**Status:** ANSWERED (2026-09-03)

**Decision:** (a) — **new `bodyMeasurements` table and migrate
`weightEntries` into it.** Jonathan chose the cleaner long-term shape
over the lower-risk join, knowing it is the riskiest migration before
Friday.

Consequences for `schema.md` and `body-measurements.md`:

- `BodyMeasurement { id, kind: 'weight' | 'neck', nightLogId, date,
  time, timestamp, period: 'morning' | 'evening', value, unit:
  'lbs' | 'in', measured, createdAt }`. Canonical storage stays
  imperial (lbs, in) to match `weightLbs`; display converts via
  `unitSystem`.
- Dexie v12 copies every `weightEntries` row into `bodyMeasurements`
  with `kind: 'weight'`, `value: weightLbs`, `unit: 'lbs'`, preserving
  ids. `weightEntries` is **kept read-only for one release** (not
  dropped) so a downgrade or a failed migration does not lose data;
  v13 in a later pack drops it.
- Every reader of `weightEntries` must be retargeted in the same
  workstream, with its existing tests preserved: `WeightProfilePage`,
  `weightUtils` (fill-forward / interpolation), `WeightEditCard`,
  `WeightStepper`, `NightLogDateEditor`, `EveningLog`, `MorningLog`,
  `Correlations`, `DataManagementPage` (export **and** import of old
  backups that still carry `weightEntries`), `dataCleanupScanner`.
- Import of a pre-v12 JSON backup must translate `weightEntries` into
  `bodyMeasurements` on the way in.
- Migration test: an upgraded v11 fixture with N weight rows yields
  exactly N `kind: 'weight'` rows with identical ids, timestamps and
  values, and the Weight Profile trend renders the same series.

---

## Q6. Can a 4am episode create a `NightLog` if the evening log was never finalized?

**Affects:** `episode-capture.md` · `schema.md`

**Context.** The evening wizard writes a `NightLog` only on save
(drafts live in `localStorage`). If Jonathan skipped the evening log,
at 4am there is no row to attach to. The episode must still be saved.

Options considered:

- **(a) Auto-create a minimal `NightLog`** for the evening date, with
  `autoCreated: true`, blank stack/intake/environment, and the alarm
  from the schedule. The evening/morning wizards later fill it in
  (and the evening wizard must *merge into* an auto-created row, not
  overwrite it).
- **(b) Store episodes in their own table** keyed by timestamp and
  join to a night lazily. Never creates logs, but every consumer has
  to join.
- **(c) Refuse** and prompt to create the evening log first. Not
  acceptable at 4am.

**Default:** (a).

**Status:** ANSWERED (2026-09-03)

**Decision:** (a). An episode saved with no `NightLog` for the evening
date auto-creates one: `autoCreated: true`, blank stack / intake /
environment, alarm from `AlarmSchedule` for that day, `loggedBedtime:
null`, `thermalComfort: null`. The evening wizard, when it later finds
an `autoCreated` row for its date, **merges into it** (keeps
`wakeUpEvents` and any episode fields) rather than overwriting, and
clears `autoCreated`. The morning wizard already opens the row by date
and needs no change beyond not clobbering `wakeUpEvents` it did not
create (see `episode-capture.md` scenarios).

---

## Q7. Episode capture: absolute minimum taps before a valid record is saved?

**Affects:** `episode-capture.md`

**Context.** At 4am with a pounding heart, every tap is a cost. The
proposal is a full-screen dark "Episode" button reachable from the
Tonight tab (and a home-screen shortcut via the PWA manifest) that
saves `{ timestamp, kind: 'episode' }` on the first tap, then offers
the optional follow-up fields one per screen, each skippable, with
auto-save on every change.

Options considered:

- **(a) One tap** saves timestamp + episode; everything else optional.
- **(b) Two taps:** timestamp + position at wake (the single most
  discriminating field), then optional.
- **(c) Three taps:** + ECG taken y/n.

**Default:** (a).

**Status:** ANSWERED (2026-09-03)

**Decision:** (a). One tap. The first tap writes
`{ id, timestamp, kind: 'episode' }` to the night (auto-creating it
per Q6) **before** any follow-up screen renders. Follow-ups are one
field per screen, each with a large "skip" target, auto-saved on every
change, and the whole flow is resumable from a crash-safe draft (Q6 /
`episode-capture.md`). Entry points: a PWA manifest shortcut
("Episode"), a persistent button on the Experiments app's home tab,
and the app-shell switcher. The flow forces the dark theme.

---

## Q8. How does Grace enter the blinded allocation?

**Affects:** `blinded-experiment.md` · `schema.md`

**Context.** Blinding integrity requires that the per-night condition
be unreadable by Jonathan until reveal. Everything lives in one
IndexedDB on one phone.

Options considered:

- **(a) PIN-protected screen on Jonathan's phone.** PIN known only to
  Grace; allocations stored **encrypted** at rest (WebCrypto,
  AES-GCM, key derived from the PIN via PBKDF2) so a JSON export or
  DevTools inspection doesn't leak them. Reveal requires the PIN.
- **(b) Second device** via a shared export/import file.
- **(c) Paper.** Grace writes it down; both arms entered after
  unblinding. Zero code for blinding, but the app can't run the
  balanced allocator or the reveal.

**Default:** (a) with encryption at rest.

**Status:** ANSWERED (2026-09-03)

**Decision:** **None — the blinded experiment is out of scope for the
app.** Jonathan: "Let's skip this from the app." The pinch experiment,
if run, is tracked outside NightStack (paper or Grace's own notes).

Consequences:

- `blinded-experiment.md` is **not written**; the `BlindedExperiment`
  entity, allocator, PIN screen, encryption, reveal and 2×2 are all
  dropped from this pack. Recorded in `README.md` under "Not in
  scope" with a pointer to a possible follow-up pack.
- Pack-acceptance item 4 (blinding invariants) is removed.
- Q9 and Q10 are moot and were not asked (see below).
- Q18 is asked without the blinding-specific bar.
- The clinician export gains a free-text "experiment notes" column on
  each night so a hand-run experiment's condition can be added
  *after* Jonathan unblinds it himself, if he wants it in the sheet.

---

## Q9. Allocation: coin flip per night, or pre-randomized balanced sequence?

**Affects:** `blinded-experiment.md`

Options considered:

- **(a) Pre-randomized balanced sequence** of N (N/2 salt, N/2
  placebo, shuffled at experiment creation). Guarantees a usable 2×2.
- **(b) Coin flip per night.** Simpler, can produce 7/1 splits at N=8.
- **(c) Block-randomized** (blocks of 2 or 4).

**Default:** (a), N=8.

**Status:** NOT ASKED — moot after Q8 (blinded experiment dropped).

**Decision:** —

---

## Q10. Blinded experiment: what is the outcome variable?

**Affects:** `blinded-experiment.md` · `night-tags.md`

Options considered:

- **(a) Composite:** an episode capture exists for the night OR
  `wiredWake === true`.
- **(b) `wiredWake` only.**
- **(c) Episode capture exists only.**
- **(d) Wake time before HH:MM.**

**Default:** (a). The 2×2 reports the composite; the reveal screen also
shows each component separately so nothing is hidden.

**Status:** NOT ASKED — moot after Q8 (blinded experiment dropped).

**Decision:** — (The composite "episode exists OR wiredWake" is still
useful as a derived per-night boolean for Correlations and the
clinician export; `insights-and-rules.md` defines it as
`adrenergicNight` without any experiment framing.)

---

## Q11. Salt tagging: replace boolean `high_salt`, or add a graded `sodiumLevel` alongside it?

**Affects:** `night-tags.md` · `schema.md` · `insights-and-rules.md` · `clinician-export.md`

**Context.** `EveningFlag.type` includes `high_salt` (boolean, active
flag). ~150 historical nights carry it. Correlations, BestNights,
ThermalFit and rules all read flags today.

Options considered:

- **(a) Add `sodiumLevel: 'normal' | 'more' | 'much_more'` and
  `sodiumLevelSource: 'user' | 'proxy' | null` on `EveningIntake`,**
  keep the flag. Backfill: `high_salt` active → `'more'`, else
  `'normal'`, both `source: 'proxy'`. Going forward the evening log
  shows the 3-level picker and writes the flag `active` whenever level
  ≠ normal so old consumers keep working.
- **(b) Replace the flag** with the ordinal; migrate every reader.

**Default:** (a).

**Status:** ANSWERED (2026-09-03)

**Decision:** (b) — **replace the boolean flag with the ordinal.**

Consequences for `schema.md` and `night-tags.md`:

- `EveningIntake.sodiumLevel: 'normal' | 'more' | 'much_more'` and
  `EveningIntake.sodiumLevelSource: 'user' | 'proxy'` become required.
- `'high_salt'` is removed from `EveningFlag['type']`. Dexie v12
  backfill: for every night, `sodiumLevel = high_salt flag active ?
  'more' : 'normal'`, `sodiumLevelSource = 'proxy'`, then the
  `high_salt` entry is deleted from `flags`.
- Every reader of `high_salt` is retargeted in the same workstream:
  the evening log flag row, `EveningReview`, `MorningReview`,
  `CalendarPage` badges, `Correlations` ("Any flag" picker),
  `BestNights`, `ThermalFit` intake filters, `recommender.ts` (if it
  reads flags), `rules.ts` (no existing clause reads it, verify),
  `DataManagementPage` JSON import of older backups (translate on the
  way in), and `dataCleanupScanner`.
- `sodiumLevelSource: 'user'` is stamped by the evening log whenever
  Jonathan touches the picker; historical proxy rows stay `'proxy'`
  until edited, mirroring `thermalComfortSource`.

---

## Q12. Position: started + at-wake only, or also majority position? Do episodes carry their own?

**Affects:** `night-tags.md` · `episode-capture.md`

Options considered:

- **(a) Night carries `positionStarted` and `positionAtWake`; each
  episode carries its own `positionAtWake`.** Night-level at-wake is
  the final morning wake; episode-level is the 4am one.
- **(b) Add `positionMajority`** too (self-estimated).
- **(c) Position only on episodes.**

**Default:** (a).

**Status:** ANSWERED (2026-09-03)

**Decision:** (a). `NightLog.positionStarted` and
`NightLog.positionAtWake`, each `'side' | 'back' | 'unknown'`,
backfilled to `'unknown'`. `positionStarted` is asked in the evening
log; `positionAtWake` (final morning wake) in the morning log. Each
`WakeUpEvent` gains its own `positionAtWake` (same type, backfilled
`'unknown'`) so the 4am episode's position is independent of the
night's.

---

## Q13. Electrolyte drink: `SupplementDef` with dose deviations, or a dedicated field?

**Affects:** `night-tags.md` · `schema.md`

**Context.** The stack already supports `reduced` / `skipped`
deviations per supplement. A `SupplementDef` named "Electrolyte drink"
with `defaultDose: 'full'` would model none/half/full as
`skipped`/`reduced`/base. But the drink is taken during the *day*, not
at bedtime, and correlating it requires mapping deviations back to a
dose level.

Options considered:

- **(a) SupplementDef** "Electrolyte drink", doses via deviations. No
  schema change; the correlations picker derives none/half/full.
- **(b) Dedicated `electrolyteDose: 'none' | 'half' | 'full' | null`
  on `NightLog`** (or on the new night-tags block). Explicit, trivially
  queryable, one more field.

**Default:** (a) per the brief; **recommendation from research is (b)**
because deviation-to-dose mapping is fragile (a `reduced` deviation
has free-text notes, not a level).

**Status:** ANSWERED (2026-09-03)

**Decision:** (b). `NightLog.electrolyteDose: 'none' | 'half' | 'full'
| null`, backfilled `null` (unknown) on historical nights. Asked in the
evening log's night-tags step. No new `SupplementDef`.

---

## Q14. Clinician export: CSV only, or also printable? Which nights?

**Affects:** `clinician-export.md`

Options considered:

- **(a) CSV + printable HTML** (print-to-PDF via the browser), date
  range with 14-day default.
- **(b) CSV only.**
- **(c) Printable only.**

**Default:** (a).

**Status:** ANSWERED (2026-09-03)

**Decision:** (a). Flat CSV (one row per night) **and** a print-styled
HTML summary page, both over a date range whose picker defaults to
the last 14 nights. Lives in the Experiments app ("Export for doctor")
and is also linked from Settings → Data Management. Uses the existing
`Blob` + anchor download pattern from `DataManagementPage`; the
printable page opens in-app and relies on `window.print()`.

---

## Q15. Correlations: which new measures are X, which are Y?

**Affects:** `insights-and-rules.md`

Options considered:

- **(a) All new measures selectable on either axis;** weight delta and
  neck delta default to Y, sodium level / position / drink dose
  default to X.
- **(b) Strict:** tags are X only, deltas and vitals are Y only.

**Default:** (a).

**Status:** ANSWERED (2026-09-03)

**Decision:** (a). Every new measure appears in both the X and Y
pickers. Preselection: tags (`sodiumLevel`, `positionStarted`,
`positionAtWake`, `electrolyteDose`, `wiredWake`) default to X;
deltas and vitals (overnight weight delta, neck delta, orthostatic
systolic/diastolic drop and pulse rise for AM and PM) default to Y.
Ordinal tags map to numbers for the scatter (`normal=0, more=1,
much_more=2`; `side=0, back=1`, `unknown` excluded; `none=0, half=1,
full=2`).

---

## Q16. Rules: which new `ConditionClause` kinds, and what recommendation text?

**Affects:** `insights-and-rules.md`

Options considered:

- **(a) Two kinds:** `high_salt_and_supine` and
  `orthostatic_flag_today`, seeded rules "Sleep on your side tonight"
  and "Bring today's orthostatic reading to the doctor."
- **(b) Also `sodium_level_at_least: { level }`** so the salt rule can
  fire on `'more'` without requiring a position, and
  `overnight_weight_gain_above: { lbs }`.

**Default:** (a). Note that pack-acceptance item 6 says the seeded
"side" rule must fire when `sodiumLevel !== 'normal'` *tonight*, which
is before position is known, so the evaluator for `high_salt_and_supine`
must treat "position unknown" as supine-risk (fires on sodium alone).

**Status:** ANSWERED (2026-09-03)

**Decision:** (a). Two new clause kinds, both added as a UI option and
an evaluator case together per the `types.ts` rule:

- `{ kind: 'high_salt_and_supine' }` — true when tonight's
  `sodiumLevel !== 'normal'` AND `positionStarted` is `'back'` or
  `'unknown'`. Seeded rule "Salt night — side sleep", priority high,
  recommendation **"Sleep on your side tonight."**
- `{ kind: 'orthostatic_flag_today' }` — true when any orthostatic
  reading dated today carries a systolic-drop, diastolic-drop or
  pulse-rise flag. Seeded rule "Orthostatic flag", priority high,
  recommendation **"Bring today's orthostatic reading to the doctor."**

Both seeded rules are added for upgraders in the v12 migration using
the existing name-dedupe pattern from v5.

---

## Q17. Samsung import: keep the screenshot-JSON path, or add a bulk importer?

**Affects:** none in this pack (follow-up)

Options considered:

- **(a) Out of scope;** record a follow-up pack for the Samsung Health
  personal-data export (`com.samsung.*.csv` + `jsons/` per-minute
  HR/SpO2) so pre-event traces can be analyzed in-app.
- **(b) In scope** for this pack.

**Default:** (a).

**Status:** ANSWERED (2026-09-03)

**Decision:** (b) — **in scope for this pack.** New workstream
**`samsung-bulk-import.md`**: parse the Samsung Health personal-data
export (`com.samsung.shealth.*.csv` for sleep sessions and the
`jsons/` per-minute heart-rate and SpO2 files), store per-minute
samples in a new `vitalSamples` table keyed by `(nightLogId, kind,
timestamp)`, and render a pre-episode trace (HR + SpO2 for the 60 min
before each episode timestamp) on the episode detail and in the
clinician summary. Depends on `schema` and `episode-capture`; runs in
parallel with `insights-and-rules`. Because the export format is only
documented by example, **Q21** (below) asks Jonathan which files he
actually has.

---

## Q18. Test bar per workstream

**Affects:** all workstreams

Options considered:

- **(a) Same as recommender-v2 Q8** (unit-test pure functions, UI tests
  nice-to-have) **plus a stricter bar for blinding:** a rendered-DOM
  test that mounts every page and asserts the allocation string
  appears nowhere pre-reveal, and a property-style test over random
  experiment states.
- **(b) recommender-v2 Q8 bar everywhere.**

**Default:** (a).

**Status:** ANSWERED (2026-09-03)

**Decision:** (a) as re-framed without blinding. Bar per workstream:

- Every pure function (flag computation, deltas, allocators of dates
  to nights, CSV builders, parsers) has Vitest unit tests written from
  the Given/When/Then scenarios **before** implementation.
- **Required, not nice-to-have:** (1) a v11 → v12 upgrade test on a
  realistic fixture (weight rows, `high_salt` nights, wake-up events)
  asserting no `undefined` reads and exact row counts; (2) an
  episode-draft crash-recovery test (draft written, page remounted,
  record attached to the right night); (3) a clinician-CSV round-trip
  test (build → parse → equals); (4) fixture-based Samsung parser
  tests with real anonymized files; (5) a Testing Library test that
  one tap on the Episode button persists a record.
- UI tests elsewhere stay nice-to-have; flag any untested behavior
  change in the PR body (recommender-v2 escape hatch still applies).

---

## Q19. Notifications for AM/PM vitals and bedtime weigh-in?

**Affects:** `vitals.md` · `body-measurements.md`

Options considered:

- **(a) Yes, opt-in in Settings,** using the existing `notifications`
  service (which schedules from the alarm time) with two new
  preference keys.
- **(b) No.**

**Default:** (a).

**Status:** ANSWERED (2026-09-03)

**Decision:** (a). Three new keys under
`AppSettings.notificationPreferences`: `amVitals`, `pmVitals`,
`bedtimeWeighIn`, all **default `false`** (opt-in) and backfilled in
v12. AM vitals fires at alarm + 15 min; PM vitals at target bedtime −
60 min; bedtime weigh-in at target bedtime − 10 min. All scheduled by
the existing `notifications` service alongside the current five.

---

## Q20. What must be on the phone tonight, and what should *not* be built before Friday?

**Affects:** execution order

**Context.** The endocrinology visit is Friday Sept 5. Today is
Wednesday Sept 3. The dependency graph puts `schema` first, then the
four capture workstreams in parallel, then blinding, insights and
export.

Options considered (minimum-for-tonight sets):

- **(a) Episode capture + night tags** (the two things that can't be
  reconstructed later), with vitals and weight/neck entered by hand
  into notes until their UIs land.
- **(b) (a) + orthostatic vitals + AM/PM weight & neck.**
- **(c) Everything except blinding and export.**

**Default:** (b) for tonight; clinician export by Thursday night;
blinding and insights after Friday.

**Status:** ANSWERED (2026-09-03)

**Decision:** **Everything, start now.** No priority cut before
Friday. Jonathan's first answer was "Do evening now"; when asked
whether that meant evening-side capture first, the Routine app first,
or everything, he chose everything. Execution follows the dependency
graph in `README.md`: `schema` → `app-shell` → the capture
workstreams in parallel (`episode-capture`, `vitals`,
`body-measurements`, `night-tags`) → `samsung-bulk-import`,
`insights-and-rules`, `clinician-export`. The orchestrator still
merges in dependency order so that a partial state on Thursday night
is always a working app.

---

## Questions added during research

## Q21. Samsung bulk import: which export files exist, and is there a sample?

**Affects:** `samsung-bulk-import.md`

**Context.** Q17 pulled the bulk importer into scope. Samsung Health's
"Download personal data" produces a folder of
`com.samsung.shealth.*.<timestamp>.csv` files plus a `jsons/`
directory of per-record JSON blobs (per-minute heart-rate binning,
SpO2 samples, sleep-stage segments). The exact columns vary by app
version and are only documented by example.

Options considered:

- **(a)** Sleep CSV + per-minute HR and SpO2 JSON exist; Jonathan
  commits a one-night anonymized sample under
  `analysis/samsung-export-sample/`.
- **(b)** Sleep CSV only.
- **(c)** Not sure what is in the export yet.

**Status:** ANSWERED (2026-09-03)

**Decision:** (c). The parser is written against Samsung's publicly
documented file names and column names (`com.samsung.shealth.sleep`,
`com.samsung.shealth.tracker.heart_rate`,
`com.samsung.shealth.tracker.oxygen_saturation`, and their `jsons/`
binning files), **tolerant of missing files and unknown columns**, and
its spec carries an explicit "UNVERIFIED against a real export" banner
plus a checklist for Jonathan to run on his first real export. The
importer UI must show a per-file "recognized / skipped" report so a
format mismatch is visible, never silent. Fixture tests use
hand-written files that follow the documented shape; the first real
sample replaces them.

**Update (2026-09-03, real export inspected):** option (a) holds —
sleep CSV, sleep-stage CSV, per-minute HR binning JSON, per-session
SpO2 rows with ~10-minute binning JSON, plus per-session respiratory
rate and skin temperature CSVs. Stage codes are 40001–40004 (awake,
light, deep, REM), not 40000–40003. Findings and the verified column
map live in `samsung-bulk-import.md`. Blood pressure not yet recorded.
