# Workstream: Data-integrity bugfixes

**Goal:** root-cause and fix the two data-hygiene defects the analysis
surfaced. Both corrupt the training signal for the recommender.

**Priority:** P1 (can run in parallel with `logging-fixes.md`).

## Baseline from the analysis

Two linked defects visible in the 2026-04-17 export:

1. **4/15 and 4/16 share byte-identical `sleepData`.** Both show
   `sleepScore === 93`, the same 422 min total duration, the same
   `skinTempRange`, and the same 03:36 wake time. One of these is a
   duplicate.

2. **4/15's `roomTimeline` contains timestamps dated 2026-04-17.**
   First sample on `2026-04-17T01:00:00` — outside the 4/15 evening
   window by two days. The timeline was overwritten on export day.

Both defects inflate the too_hot neighbor count by 1 and skew
cooling-rate derivations. Fixing them is a prerequisite for trusting
any re-run of the analysis.

## Tasks

### T1. Reproduce the duplicate `sleepData` write

**Files:**
- `src/pages/morning/MorningLog.tsx` (import + save paths)
- `src/services/importers.ts` (`parseSamsungHealthJSON`)

**Hypothesis A (most likely):** the user imported the same Samsung
Health JSON on 4/16 *and* on 4/17, each time while viewing the morning
log for "the most recent night." `MorningLog` resolves `nightLog` via
`targetDate || today || yesterday` (lines ~70–79). If the user was on
the 4/17 morning log view when they re-imported a file covering the
4/16 night, the sleepData would write to the 4/16 log. But then how
did 4/15 end up identical? Possibly the user had opened the 4/15 log
via `?date=` at some point and pasted / re-imported there.

**Hypothesis B:** `parseSamsungHealthJSON` picks the "most recent sleep
session" from the JSON and applies it regardless of the nightLog's
date, so any re-import on any morning log view writes the same data.

**Do:**
- Read `parseSamsungHealthJSON` end-to-end. Determine whether it
  returns exactly one session or a list, and whether the caller
  filters by date.
- If the JSON contains multiple sessions and the parser returns the
  most recent one, add a date filter: match the session whose
  sleep window overlaps `nightLog.date` evening. Log a clear error
  when no session matches.
- If the JSON contains exactly one session, add a guard in the save
  path: if the parsed session's sleep window is more than 12 hours
  away from the target `nightLog.date`, show a confirmation banner:
  "This sleep data is for a different night. Save anyway?"

**Acceptance:**
- Re-importing a JSON for the wrong night log raises a visible
  warning.
- A new unit test in `src/test/` covers: given a JSON with sessions
  for 4/16 and 4/17, calling `parseSamsungHealthJSON(..., '2026-04-15')`
  (or however the date is threaded) returns the correct session or
  `null`, never the wrong one.

### T2. Add a cross-log dedupe on sleepData write

**Files:**
- `src/pages/morning/MorningLog.tsx` (save handler)

**Why:** even if T1 fully fixes the write path, existing exports are
corrupted and users may make the same mistake again. Cheap
defense-in-depth.

**Do:** in the save handler, before writing `sleepData` to the
`nightLog`, check whether any *other* nightLog within ±3 days already
has byte-identical `sleepData` (compare `sleepTime`, `wakeTime`,
`sleepScore`, `totalSleepDuration`). If yes, show a blocking banner
"This sleep data is already saved to the 2026-04-16 night log. Saving
it here too will create a duplicate." with "Overwrite anyway" and
"Cancel" buttons. Default-select Cancel.

**Acceptance:**
- Attempting to save duplicate sleepData across two nearby nights
  triggers the banner.
- Unit test: writing a known-duplicate `SleepData` via the save
  handler short-circuits unless the user has confirmed overwrite.

### T3. Reproduce the `roomTimeline` overwrite

**Files:**
- `src/services/importers.ts` (`parseGoveeCSV`)
- `src/pages/morning/MorningLog.tsx` (`handleGoveeFileSelect`)

**Status from code read:** `parseGoveeCSV(csvStr, nightDate)` already
constructs the overnight window from `nightDate` (21:00 that evening
through 07:00 the next morning) and filters rows to that window. So
importing a Govee CSV into a morning log for 4/15 *should* reject any
rows timestamped on 4/17. The overwrite can happen only if:

- (a) The caller passes the wrong `nightDate`. Check
  `handleGoveeFileSelect` — it reads `nightLog.date`. If `nightLog`
  was somehow loaded for the wrong date at that moment, the filter
  runs against the wrong window.
- (b) The CSV has timestamps the parser doesn't recognize as being
  outside the window (timezone bug). `new Date(timestamp)` parses
  ISO strings in UTC if suffixed with `Z`; the filter compares
  against a local-time constructed window. Possible off-by-hours.

**Do:**
- Add a console log (or test assertion) at the start of
  `handleGoveeFileSelect`: print `nightLog.date`, the first and last
  timestamps in the CSV, and the number of rows that pass the filter.
  Run against a sample CSV that reproduces the 4/15-got-4/17-data
  state.
- Fix whichever branch was actually triggered:
  - (a) means the morning log was open on the wrong `nightLog`; the
    fix belongs in how `nightLog` is resolved, and there's likely a
    race between the Dexie `useLiveQuery` result and the file input
    click.
  - (b) means `parseGoveeCSV` should normalize both the window and
    the parsed timestamps to the same timezone before comparing.

**Acceptance:**
- Importing a Govee CSV whose rows are all outside the target night's
  window produces zero readings and a clear error ("No readings found
  for the overnight window").
- Unit test in `src/test/`: feed `parseGoveeCSV` a CSV with rows on
  2026-04-17 and a `nightDate === '2026-04-15'`, assert zero
  readings.

### T4. One-time cleanup migration for the known bad rows

**File:** `src/db.ts` (add as a one-time script, not a versioned
migration, since it only affects one user's data)

**Why:** the export shows 4/15 sleepData is a duplicate of 4/16, and
4/15's `roomTimeline` is from 4/17. The user should be given a chance
to clean this up without losing legitimate data.

**Do:** add a "Data cleanup" button to the settings page (or to the
insights page — wherever an admin affordance fits) that:

1. Scans `nightLogs` for pairs of logs within ±3 days with identical
   `sleepData.sleepTime`, `sleepScore`, and `totalSleepDuration`.
2. Scans `nightLogs` for any `roomTimeline` where >10% of samples
   fall outside the log's evening window.
3. Lists matches in a modal with the date, the conflict summary, and
   three radio options per row: "Keep", "Clear sleepData", "Clear
   roomTimeline".
4. On confirm, applies the user's choices and writes back via
   `db.nightLogs.bulkPut`.

**Acceptance:**
- Button is idempotent — running it twice on clean data lists no
  matches.
- No deletion without explicit user confirmation.
- Existing tests continue to pass.

**Alternative if a UI is too much scope:** ship only the diagnostic
listing (no delete). The user or a future agent can then do manual
cleanup. Call this out in the PR description.

### T5. Guard against `loggedBedtime` timestamps that precede `alarm.eatingCutoff`

**File:** `src/pages/tonight/EveningLog.tsx` (save handler)

**Why:** a downstream derivation in `derived-features.md`
(`hoursSinceLastMeal`) uses `loggedBedtime` or `alarm.targetBedtime`
as the bedtime anchor. A bogus `loggedBedtime` (e.g. user finished
the evening log well before bed, then went back and edited) produces a
negative or implausibly-large hours-since-meal. Add a sanity check.

**Do:** if the save handler computes `loggedBedtime < alarm.eatingCutoff`
(i.e. finished the evening log before the eating cutoff time), show a
warning banner before save: "The evening log was finished before your
eating cutoff. Is that really bedtime?" with "Yes, save" and "Cancel".

**Acceptance:**
- Warning fires only on save when the condition is true; no-op
  otherwise.
- Skip this check in backfill mode (`isBackfill === true`).

## Known unknowns / gaps to resolve before coding

- **Is T1 hypothesis A or B the actual cause?** The reproduction
  step is listed above but needs to be run against the user's
  existing JSON files (which the agent likely doesn't have). If
  agents can't reproduce, they should land T2 and T3 as-is and flag
  T1 as "root cause not reproduced — defense-in-depth only."
- **Does Govee CSV have `Z`-suffixed or local timestamps?** Look at
  a sample file. If it's local, the `parseDate` in `parseGoveeCSV`
  is constructing local times against a local-time window, which
  matches — no bug. If it's `Z`, there's a latent TZ bug.
- **Is there existing schema for "admin" UI?** T4 assumes there's
  somewhere reasonable to put a "Data cleanup" action. If not,
  adding it to settings is fine, but flag the scope increase.
