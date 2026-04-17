# Workstream: Logging fixes

**Goal:** make the UI reliably capture the fields the recommender
already depends on. The analysis (`analysis/recommender-tuning-2026-04-17.md`
§d) shows every thermal-signal field is underpopulated or dead.

**Priority:** P0. Every other workstream is gated on this.

## Baseline from the analysis

| Field | Coverage | Root cause (suspected) |
|---|---|---|
| `thermalComfort` | 0/11 nights | Recently shipped; user hasn't used it yet, but also needs prominence |
| `wakeUpEvents[].wasSweating/feltCold/racingHeart` | 0/18 wakes | Same — check the checkboxes actually render in the wake card |
| `environment.acCurveProfile` / `acSetpointF` / `fanSpeed` | 11/11 `'off'`/null | User doesn't have AC yet; fields shouldn't be dead, but shouldn't require input either |
| `loggedBedtime` | 0/11 rows (all null per migration backfill) | Legacy pre-v7 rows are null by design; new rows after v7 should be non-null — verify this is working for logs created after 2026-04-05 |
| `eveningIntake.lastMealTime` | 8/11 (missing 4/12, 4/13, 4/14) | Field is optional; no prompt if blank |
| `wakeUpEvents[].cause` | 1 blank wake in 4/12 cluster | Field is optional |

## Tasks

### T1. Audit that `thermalComfort` UI is visible and prominent

**File:** `src/pages/morning/MorningLog.tsx` (step 3)

**Check first:** open the morning log in the dev server, advance to
step 3. Confirm the four `THERMAL_COMFORT_OPTIONS` buttons render at
the *top* of the step and before the wake-up events section. If the
picker is below wake events, move it up — it's the primary label and
should get primary placement.

**Second check:** confirm the picker is not gated on `hadWakeUps`.
A night with zero wakes still needs a thermal tag (it might be
`just_right` precisely *because* there were no wakes).

**Acceptance:**
- Picker renders unconditionally at step 3, top of the step.
- `thermalComfort` is persisted on save (already wired at
  `MorningLog.tsx:432` — verify with a manual round-trip).
- No TypeScript errors; no console warnings about controlled-input
  state.

### T2. Verify per-wake thermal flags actually render inside each wake card

**File:** `src/pages/morning/MorningLog.tsx` (step 3, inside each wake
event card, around line ~960 after the recent edits)

**Check:** open the morning log, add a wake event, confirm the
"What did your body feel?" row with three toggles (`Sweating`,
`Felt cold`, `Racing heart`) is visible. The analysis found 0/18 wakes
with any of these set — either the UI isn't surfacing them or users
aren't toggling them. Most likely UI.

**Acceptance:**
- All three toggles render inside every wake card, regardless of the
  selected `cause`.
- Toggling a flag persists across step navigation and save.
- If tests exist for wake-event persistence, add one asserting a
  round-trip preserves `wasSweating === true`.

### T3. Make `lastMealTime` visibly required

**File:** `src/pages/tonight/EveningLog.tsx` (step 3)

**Why:** 3/11 logs have it blank, two of which were thermal nights.
`hoursSinceLastMeal` (the continuous replacement for `ateLate`; see
`derived-features.md`) can't be computed without it.

**Do:**
- Add a red asterisk + subtitle "Required for the recommender" next
  to the "Last meal time" label.
- Prefill with `alarm.eatingCutoff` (already computed) when the field
  is empty and the user advances past step 3 without entering one.
  Flag the prefilled value with a subtle "prefilled" indicator so the
  user can edit before saving.
- Do **not** block save on a blank value — the user can override. But
  surface a banner on step 8 summary if the field is still blank:
  "Last meal time is missing — hours-since-meal won't factor into
  tonight's recommendation."

**Acceptance:**
- New logs created after this lands always have a non-empty
  `lastMealTime` unless the user explicitly cleared it with intent.
- Unit test: `EveningLog` save path sets `lastMealTime` to the
  prefilled `eatingCutoff` when the user never touched the field.

### T4. Gate AC inputs on an `acInstalled` setting

**Files:**
- `src/types.ts` (add `acInstalled: boolean` to `AppSettings`)
- `src/db.ts` (v9 migration: default existing settings to `false`)
- `src/pages/settings/...` (add a toggle — locate the existing
  settings page)
- `src/pages/tonight/EveningLog.tsx` (step 5: hide AC card when
  `!settings.acInstalled`)

**Why:** User said "we *will* have a window AC." April export shows
all-`off`. Forcing the AC picker into the evening log is noise for a
user who can't set the fields anyway, and it creates zero-variance
data the recommender drops on the floor.

**Do:**
- New `appSettings.acInstalled` defaults to `false`.
- Evening log step 5 renders the AC card only when `acInstalled`.
  When hidden, writes save `acCurveProfile: 'off'`, `acSetpointF: null`,
  `fanSpeed: 'off'` silently — unchanged from today's behavior.
- Settings page: new "Window AC installed" toggle with a one-sentence
  explainer: "Enables the AC sleep-curve inputs on the evening log."
- When the toggle flips from `false → true`, the user should see a
  one-time tip above the evening log's AC card: "Log the curve profile
  and setpoint tonight — your recommender will start using them once
  you have a few nights of data."

**Acceptance:**
- Migration v9 backfills `acInstalled = false` on existing settings.
- Evening log UI correctly shows/hides AC card.
- Recommender already handles all-`off` gracefully; no recommender
  changes needed for this task.

**Open question:** should `fanSpeed` be gated the same way? A user
could run a fan without AC. Recommend keeping `fanSpeed` always
visible; only the AC curve/setpoint pair is gated. Confirm with UX.

### T5. Audit that `loggedBedtime` is being set on new logs

**File:** `src/pages/tonight/EveningLog.tsx`

**Check:** the save handler at line ~405 sets `nightLog.loggedBedtime =
isBackfill ? null : Date.now()`, but the analysis found 0/11 new-era
logs populated. Two possibilities:
- All 11 logs in the export were backfilled (unlikely — the user's
  been using the app daily).
- `existingLog` branch short-circuits and the `loggedBedtime` set only
  happens for brand-new logs, so *editing* an evening log after the
  fact leaves the old null in place (line ~437: `if (!existingLog)`).

**Do:**
- If the existing log has `loggedBedtime === null` *and* the user is
  not backfilling, set `loggedBedtime = Date.now()` on save even when
  `existingLog` is truthy. Treat the first non-backfill edit as the
  bedtime.
- Document the decision in a code comment at the assignment site.
- Audit: after this change, is there any legitimate reason a
  non-backfilled log should have `loggedBedtime === null`? If not,
  add a console warning when that state is written, so future
  regressions are visible.

**Acceptance:**
- Saving a previously-existing log that has no `loggedBedtime` now
  populates it.
- Backfill saves (with `isBackfill === true`) continue to leave
  `loggedBedtime === null`.

### T6. Prompt for wake cause when blank

**File:** `src/pages/morning/MorningLog.tsx` (step 3, wake event card)

**Check:** the cause dropdown has `<option value="">Select cause...</option>`
as the default. Analysis found at least one blank cause (4/12 wake
cluster). A blank cause starves the proxy classifier (see
`backfill.md`).

**Do:**
- When a user saves the morning log with `hadWakeUps === true` and any
  wake has `cause === ''`, show a confirmation banner: "N wake(s)
  have no cause. Save anyway?" with two buttons: "Save anyway",
  "Back to fix".
- If the user picks "Save anyway," stamp those wakes with the
  `'Unknown'` cause ID so the proxy doesn't see empty strings.

**Acceptance:**
- Save path never writes `wakeUpEvents[].cause === ''` (either the
  user set it or it's `'Unknown'`).
- Existing unit tests for wake-event save continue to pass.

## Tests to add

- `MorningLog.test.tsx` — thermalComfort persists on round-trip.
- `EveningLog.test.tsx` — blank `lastMealTime` gets prefilled with
  `eatingCutoff` on save.
- `EveningLog.test.tsx` — AC card hidden when `acInstalled === false`;
  saved environment has `acCurveProfile === 'off'`.

## Known unknowns / gaps to resolve before coding

- **Where does the settings UI live?** T4 references a settings page
  but doesn't locate it. Confirm the path (look under
  `src/pages/settings/`) and whether there's an existing
  toggle-group pattern.
- **Do we need a settings migration test?** If v9 is introduced for
  `acInstalled`, the existing `db.ts` migration tests (if any) need
  to cover it.
- **Wake-flag tests today:** scan `src/test/` for any wake-event
  round-trip tests to add a flags assertion to without reinventing
  the fixture.
