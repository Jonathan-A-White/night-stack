# Workstream: Derived features

**Goal:** add three new inputs the analysis identified as higher-signal
than what the recommender uses today. All three are derived from
existing logged fields — no new data entry required.

**Priority:** P1. Blocks `distance-function.md`.

## Baseline from the analysis

Ranked by separation power (AUC on too_hot vs too_cold, n=5 vs n=3):

| Feature | AUC | Notes |
|---|---|---|
| `overnightLowF` | 0.933 | Already in inputs — keep |
| `startingRoomTempF` | 0.867 | Already in inputs — raise weight |
| `roomHumidity` | 0.800 | **Not in inputs today** — add |
| `hoursSinceLastMeal` (continuous) | 0.750 | **Replaces the binary `ateLate`**. Binary AUC is 0.500 |
| `coolingRate1to4F` | 1.0 (n_cold=1) | **Speculative but cheap**; add with a caveat in docs |

Features to *stop* using (all currently weighted; all show AUC ≈
0.500 or zero variance): `ateLate`, `overate`, `highSalt`.

## Tasks

### T1. Add `hoursSinceLastMeal` derivation

**Files:**
- `src/services/recommender.ts` (`logToInputs`)
- New small helper in `src/utils.ts` if the bedtime-anchor selection
  gets >5 lines (see below)

**Semantics:**
- Compute `hoursSinceLastMeal = (bedtimeAnchorMs - lastMealTimeMs) /
  3_600_000`.
- `bedtimeAnchorMs`: prefer `log.loggedBedtime` when non-null; else
  derive from `log.alarm.targetBedtime` combined with `log.date`;
  else `log.sleepData?.sleepTime` combined with `log.date` (crossing
  midnight: if the HH:MM is before 12:00 the anchor is the day after
  `log.date`).
- `lastMealTimeMs`: derive from `log.eveningIntake.lastMealTime`
  combined with `log.date` (same midnight rule).
- Return `null` if either side is missing or if the computed hours are
  outside `[0, 12]` (sanity bound; negatives or absurd gaps indicate
  malformed data).

**Do:**
- Write a pure helper `computeHoursSinceLastMeal(log: NightLog): number
  | null` either inline in `recommender.ts` or factored into
  `src/utils.ts`. Prefer `utils.ts` if it lets you share the bedtime-
  anchor selection with other derivations.
- Use it in the updated `logToInputs` (see `distance-function.md`).

**Acceptance:**
- Unit tests in `src/test/`:
  - `lastMealTime = "18:00"`, `loggedBedtime = 2026-04-15T21:30` → 3.5
  - `lastMealTime` blank → `null`
  - `loggedBedtime = null`, `alarm.targetBedtime = "21:00"`,
    `date = "2026-04-15"` → correctly uses the target bedtime
  - `lastMealTime = "02:00"`, `bedtime = "21:30"` on the same date →
    crosses midnight correctly (breakfast next morning scenario —
    should return `null` via the `[0, 12]` bound, not a negative)
- `logToInputs` includes `hoursSinceLastMeal` in its return.

### T2. Add `coolingRate1to4F` derivation

**Files:**
- `src/services/recommender.ts` (`logToInputs`)
- `src/utils.ts` (leverage existing `findNearestRoomReading`)

**Semantics:**
- Let `t1 = findNearestRoomReading("01:00", roomTimeline)` and
  `t4 = findNearestRoomReading("04:00", roomTimeline)`.
- Require both non-null *and* the actual wall-clock gap between them
  to be ≥ 2 hours (guard against a timeline that only has 2am–3am
  coverage). If the gap is <2h, return `null`.
- Compute `rate = (t4.tempF - t1.tempF) / hoursBetween(t1, t4)`.
- Negative = room cooling; positive = warming.

**Do:**
- Add a pure helper `computeCoolingRate1to4F(log: NightLog): number |
  null`.
- Handle the `findNearestRoomReading` quirks: it uses time-of-day
  modular distance, so on a sparse timeline it could return the same
  reading for both 01:00 and 04:00 targets. Detect equality and
  return `null`.
- Return `null` when `roomTimeline` is null or has fewer than 2
  readings in the 0:00–6:00 window.

**Acceptance:**
- Unit tests:
  - Synthetic timeline with one reading at 01:05 (72°F) and one at
    04:10 (68°F): rate ≈ −1.29 °F/h (close to `(68 - 72) / 3.08`).
  - Timeline with only a 23:00 and a 04:00 reading: returns a rate
    using 04:00 as t4 and *what for t1*? Answer in the test: since
    `findNearestRoomReading` wraps modularly, 23:00 is the nearest to
    01:00 by 2h. The function must detect that the chosen t1
    (23:00) is before midnight and reject it (define t1 as "closest
    to 01:00 and within [00:30, 02:00]"). Tighten the selector
    accordingly.
  - Timeline null → null.

**Caveat to document in the code:** separation AUC of 1.0 was computed
against n_cold = 1. This feature is exploratory; expect re-weighting
once labels accumulate. Flag in a code comment.

### T3. Surface `roomHumidity` in the inputs

**File:** `src/services/recommender.ts` (`logToInputs`)

**Do:** add `roomHumidity: log.environment.roomHumidity` to the
returned `RecommenderInputs`. Schema change for the shape is covered
in `distance-function.md` T1.

**Acceptance:**
- `logToInputs` returns `roomHumidity` unchanged from the log
  (including `null` when unset).

### T4. Drop the three zero-signal food flags from `logToInputs`

**File:** `src/services/recommender.ts` (`logToInputs`)

**Do:** remove the derivations of `ateLate`, `overate`, `highSalt`
from `logToInputs`. They don't belong in the output shape after the
refactor. Keep `alcohol` — it's zero-variance today but cheap to
retain for when it matters. Refer to `distance-function.md` T1 for
the exact new shape.

**Acceptance:**
- Removed lines are the only changes in this task (no new state).
- Downstream compile fails until `distance-function.md` lands the
  corresponding `RecommenderInputs` shape update. That's expected and
  forces the two workstreams to land together.

## Tests to add

File: `src/test/recommender.test.ts` (create if missing).

- `computeHoursSinceLastMeal` — 4 cases listed in T1.
- `computeCoolingRate1to4F` — 3 cases listed in T2 plus a
  "degenerate-nearest" test where the timeline is too sparse.
- `logToInputs` integration: given a realistic `NightLog` fixture,
  assert the returned `RecommenderInputs` has the five new/kept
  numeric fields populated correctly and none of the dropped binary
  flags.

## Known unknowns / gaps to resolve before coding

- **Which bedtime anchor wins when multiple are set?** The spec above
  says `loggedBedtime > alarm.targetBedtime > sleepData.sleepTime`.
  But `loggedBedtime` is an epoch ms (the moment the log was
  finalized) while `alarm.targetBedtime` is the *planned* bedtime. If
  the user finished the evening log 45 minutes before they actually
  went to bed, `loggedBedtime` understates hours-since-meal. For a
  first pass this is fine — the error is bounded and consistent. Flag
  if a better anchor surfaces (e.g. a future "I'm in bed" button).

- **Does the cooling-rate window need to adapt to actual sleep time?**
  Someone who goes to bed at 23:30 has 01:00–04:00 mid-sleep; someone
  who goes to bed at 01:30 has 01:00–04:00 covering sleep-onset. The
  analysis picked 01:00–04:00 as a fixed window because hot wakes
  cluster at 03:00–03:45. Keep the window fixed for now; revisit if
  the feature ever drops in ranked importance.

- **Humidity missing on 1/11 nights.** The distance function (via
  `addDim`) half-penalizes missing. No change needed here, but make
  sure `logToInputs` returns `null` (not `0`) when
  `roomHumidity === null` — the scale difference matters.
