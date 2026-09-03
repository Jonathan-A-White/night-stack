# Workstream: body-measurements

**Blocked by:** `schema`, `app-shell`. **Runs in parallel with:**
`episode-capture`, `vitals`, `night-tags`. **Blocks:**
`insights-and-rules`, `clinician-export`.

Decisions: Q4 (AM and PM weigh-ins first-class, overnight delta
primary), Q5 (weight migrated into `bodyMeasurements`), Q19 (bedtime
weigh-in reminder). Research: §4 (reader list and adapter strategy),
§10 (import never restored weights), §15 (step components).

## Scope

1. **Retarget every `weightEntries` reader** to `bodyMeasurements`
   (research §4 table), including the `weightUtils` generalization
   with old-name adapters and the `DataManagementPage` export/import
   fix.
2. **Evening log** gets a `BodyMeasurementStep` (PM weight + PM neck)
   replacing the conditional weight step; **morning log** gets the
   same step for AM. Both always shown (Q4), each field skippable
   (skipped → no row, never a fabricated `measured: false` row for
   neck; weight keeps its existing fill-forward behaviour).
3. **Neck circumference**: `NeckStepper` in inches (0.1 step) or cm
   (0.25 step) per `unitSystem`; canonical storage inches.
4. **Overnight deltas** in `src/services/bodyMeasurements.ts`:
   `overnightDelta(kind, nightDate, rows)` = AM(nightDate+1) −
   PM(nightDate), both `measured: true`, else null.
   `deltasForNight(log, rows)` returns `{ weightDeltaLbs, neckDeltaIn }`.
5. **Experiments › Body tab** (`/experiments/body`): today's PM and
   tomorrow's AM entry buttons, last 14 nights table of PM / AM /
   delta for weight and neck, tagged with that night's `sodiumLevel`
   chip (read-only; night-tags owns the chip component, use a plain
   label until it lands).
6. **Bedtime weigh-in reminder** (`bedtimeWeighIn`, target bedtime −
   10 min), toggled on the Reminders settings page that `vitals` adds
   (if `vitals` has not merged yet, add the toggle to
   `WeightProfilePage` and move it later).
7. `WeightProfilePage`: read `kind === 'weight'`; `weighInPeriod`
   now only filters the trend series; add a neck trend below it.

## Non-goals

- Dropping `weightEntries`.
- Goal/ideal-weight features.
- Correlations/MetricDetail entries (insights-and-rules).

## Data changes

Uses `bodyMeasurements` from `schema.md`. No further schema changes.
Write rules:

- One row per `(kind, date, period)`; saving again for the same slot
  **updates** the existing row (find via `[kind+date+period]`).
- `nightLogId` links a PM row to that evening's log and an AM row to
  the **previous** evening's log (the night it closes).

## UI changes

- `src/pages/tonight/steps/BodyMeasurementStep.tsx` and
  `src/pages/morning/steps/BodyMeasurementStep.tsx` (thin wrappers over
  one shared `BodyMeasurementFields` component with `period` prop).
- `BodyMeasurementEditCard` replaces `WeightEditCard` on both review
  pages, showing weight and neck side by side.
- `BodyTab.tsx`; `WeightProfilePage` neck trend.

## Given / When / Then

```gherkin
Feature: Overnight deltas

  Scenario: Delta from PM to next AM
    Given weight PM 2026-09-03 172.4 measured and AM 2026-09-04 174.2 measured
    When overnightDelta('weight', '2026-09-03') runs
    Then it returns 1.8

  Scenario: Missing AM yields null
    Given only a PM weight for 2026-09-03
    Then overnightDelta returns null

  Scenario: Interpolated rows never feed a delta
    Given PM measured and AM with measured false
    Then overnightDelta returns null

  Scenario: Neck delta in inches
    Given neck PM 15.6 and AM 16.1
    Then overnightDelta('neck', date) returns 0.5

Feature: Saving measurements

  Scenario: Evening log saves PM weight and neck
    When the evening log for 2026-09-03 is saved with weight 172.4 and neck 15.6
    Then bodyMeasurements has a weight row and a neck row, both period 'evening', date 2026-09-03, nightLogId = that log's id

  Scenario: Re-saving the evening log updates rather than duplicates
    Given the PM rows above exist
    When the evening log is saved again with weight 172.6
    Then there is still one weight row for (weight, 2026-09-03, evening) with value 172.6

  Scenario: Morning AM rows link to the previous evening's log
    When the morning log for night 2026-09-03 is saved on 2026-09-04 with weight 174.2
    Then the weight row has date 2026-09-04, period 'morning', nightLogId = the 2026-09-03 log id

  Scenario: Skipping neck writes no neck row
    When the evening log is saved with weight entered and neck skipped
    Then no neck row exists for that date

  Scenario: Metric display
    Given unitSystem 'metric' and a stored neck value of 15.6 in
    Then the Body tab shows 39.6 cm

Feature: Weight utilities keep their behaviour

  Scenario: Existing interpolation tests pass on BodyMeasurement rows
    Given the weightUtils fixtures converted to kind 'weight' rows
    Then every existing assertion in weightUtils.test.ts still holds

Feature: Backup round trip

  Scenario: Full export includes bodyMeasurements and import restores them
    Given 3 weight rows and 2 neck rows
    When a full export is taken and imported
    Then bodyMeasurements has the same 5 rows

  Scenario: Importing a pre-v12 backup translates weightEntries
    Given a backup JSON with a weightEntries array of 4 rows and no bodyMeasurements
    When it is imported
    Then bodyMeasurements has 4 rows of kind 'weight' with the same ids

Feature: Reminder

  Scenario: Bedtime weigh-in reminder
    Given bedtimeWeighIn true and target bedtime 21:13
    When notifications are scheduled
    Then "Bedtime weigh-in and neck measurement" is scheduled for 21:03
```

## Acceptance criteria

- `src/test/bodyMeasurements.test.ts` covers deltas, saving, backup
  round trip (fake-indexeddb).
- `weightUtils.test.ts` passes with fixture-only changes.
- Manual: Weight Profile trend renders the same series before and
  after upgrade on a real backup (pack acceptance 1). Noted in PR.
- Lint, typecheck, tests, build green.

## Open questions

- Whether the evening weight step should be **before** the night-tags
  step or after. Default: after tags, before notes (last thing before
  bed).
- Fill-forward for neck: default **off** (no synthetic rows) since the
  delta must reflect real measurements.
