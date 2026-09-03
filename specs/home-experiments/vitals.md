# Workstream: vitals (orthostatic)

**Blocked by:** `schema`, `app-shell`. **Runs in parallel with:**
`episode-capture`, `body-measurements`, `night-tags`.
**Blocks:** `insights-and-rules`, `clinician-export`.

## Scope

Twice-daily orthostatic vitals in the **Experiments** app:

1. A **Vitals tab** (`/experiments/vitals`) listing today's AM/PM
   readings and the last 14 days, with derived deltas and flags.
2. A **coached entry flow** (`/experiments/vitals/new?slot=am|pm`):
   supine 5:00 timer → supine reading → "stand up" → 1:00 timer →
   reading → 3:00 timer → reading → save. Every timer skippable; a
   "Just enter numbers" shortcut on the first screen jumps to a single
   six-field form (Q2).
3. **Source** per reading (`cuff` / `watch`, Q3) and
   `AppSettings.watchBpCalibratedAt` with a "Calibrated today" button
   in Settings → Vitals; watch readings >28 days after calibration
   show a "Recalibrate" chip.
4. **Derived values** (pure functions, `src/services/orthostatic.ts`):
   systolic drop, diastolic drop, pulse rise for each standing point
   vs supine; flags: systolic drop ≥ 20, diastolic drop ≥ 10, pulse
   rise ≥ 30 **without** either drop. Flags are labelled "bring this
   to your doctor" — never interpreted.
5. **Reminders** (Q19): `amVitals` at alarm + 15 min, `pmVitals` at
   target bedtime − 60 min, both off by default, toggled in the
   existing notifications settings UI.
6. A read-only **summary card** for Tracking's Morning and Evening
   review pages ("AM vitals: 112/70 → 104/66 at 3 min, pulse +18") —
   render-only, no entry.

## Non-goals

- Reading BP from the watch programmatically.
- Trend analysis beyond the 14-day list (owned by
  `insights-and-rules`).
- Any medical interpretation text.

## Data changes

Uses `orthostaticReadings` and `AppSettings.watchBpCalibratedAt` from
`schema.md`. No further schema changes.

Derived types (not stored):

```ts
export interface OrthostaticDerived {
  drop1: { systolic: number; diastolic: number; pulseRise: number } | null;
  drop3: { systolic: number; diastolic: number; pulseRise: number } | null;
  flags: OrthostaticFlag[];      // deduped across the two standing points
  needsRecalibration: boolean;   // source === 'watch' && (timestamp - calibratedAt) > 28 days, or calibratedAt null
}
export type OrthostaticFlag = 'systolic_drop' | 'diastolic_drop' | 'pulse_rise_without_drop';
```

`computeOrthostatic(reading, watchBpCalibratedAt): OrthostaticDerived`.

Reading `date` is the **calendar date** of the reading. Joining to a
night: an `am` reading on date D belongs to night D−1; a `pm` reading
on D belongs to night D. Helper `nightDateForReading(reading)`.

## UI changes

- **Experiments › Vitals tab.** Header with two large buttons "AM
  reading" / "PM reading" (disabled with "done ✓" once that slot has
  a reading today; tapping opens it for edit). Below: a list of the
  last 14 days, one row per reading: slot, source chip, `S/D (p)` at
  supine → 1 min → 3 min, flag chips, recalibrate chip.
- **Coached flow.** Full-screen cards, one per stage, dark-friendly.
  Timer is computed from a `startedAt` stored in the draft (not
  interval state) so locking the screen doesn't drift it. Stage
  card: big mm:ss, "Skip timer", and when the timer hits zero the
  three inputs appear (numeric keypad, `inputmode="numeric"`, pulse
  auto-focus order S → D → P). "Skip this reading" leaves
  `standing1`/`standing3` null. Draft persists to `localStorage`
  under `vitals-draft-<date>-<slot>` and is offered on re-entry.
- **Direct form.** Six inputs in two rows (supine / 1 min / 3 min),
  source segmented control, notes, Save.
- **Settings › Vitals** (new page under `/settings/vitals`): watch
  calibration date with "Calibrated today", link to reminders.
- **Summary card** component `OrthostaticSummaryCard` used by
  `MorningReview` (AM reading of the next morning) and
  `EveningReview` (PM reading of that evening).

## Given / When / Then

```gherkin
Feature: Orthostatic derived values

  Scenario: Standard drop computation
    Given supine 120/78 pulse 60, standing 1 min 104/70 pulse 84, standing 3 min 98/66 pulse 92
    When computeOrthostatic runs
    Then drop1 is { systolic: 16, diastolic: 8, pulseRise: 24 }
    And drop3 is { systolic: 22, diastolic: 12, pulseRise: 32 }
    And flags contain 'systolic_drop' and 'diastolic_drop'
    And flags do not contain 'pulse_rise_without_drop'

  Scenario: Pulse rise without a drop is flagged
    Given supine 118/76 pulse 58 and standing 3 min 116/78 pulse 90
    When computeOrthostatic runs
    Then flags equal ['pulse_rise_without_drop']

  Scenario: Pulse rise with a drop is not double-flagged
    Given supine 120/80 pulse 60 and standing 3 min 96/70 pulse 95
    When computeOrthostatic runs
    Then flags equal ['systolic_drop', 'diastolic_drop']

  Scenario: Threshold boundaries are inclusive
    Given a systolic drop of exactly 20, a diastolic drop of exactly 10, a pulse rise of exactly 30 with no drop
    Then each respective flag is raised

  Scenario: Skipped standing point yields null delta and no flag from it
    Given standing1 is null and standing3 shows a 25 systolic drop
    Then drop1 is null and flags equal ['systolic_drop']

  Scenario: Watch reading older than 28 days since calibration needs recalibration
    Given source 'watch', calibratedAt 30 days before the reading timestamp
    Then needsRecalibration is true
    Given source 'watch', calibratedAt 27 days before
    Then needsRecalibration is false
    Given source 'watch' and calibratedAt null
    Then needsRecalibration is true
    Given source 'cuff' and calibratedAt null
    Then needsRecalibration is false

  Scenario: Night assignment
    Given an 'am' reading dated 2026-09-04
    Then nightDateForReading returns 2026-09-03
    Given a 'pm' reading dated 2026-09-03
    Then nightDateForReading returns 2026-09-03

Feature: Coached entry

  Scenario: Timer is clock-based
    Given the supine stage started at T
    When 5 minutes of wall clock pass while the tab was hidden
    Then the stage shows 0:00 and reveals the inputs on the next render

  Scenario: Skip timer reveals inputs immediately
    When "Skip timer" is tapped on the 1-minute stage
    Then the systolic input is focused

  Scenario: Draft survives a reload
    Given supine 120/78/60 entered and the 1-minute timer running
    When the page is remounted
    Then the flow resumes at the 1-minute stage with the supine values intact

  Scenario: Save writes one reading per date+slot
    Given no reading for today 'am'
    When the flow saves supine, 1 min, 3 min with source 'cuff'
    Then orthostaticReadings has exactly one row for [today, 'am'] with those points
    When the same slot is saved again after editing
    Then the row is updated, not duplicated

  Scenario: Direct form path
    When "Just enter numbers" is tapped and six values plus source 'watch' are saved
    Then the reading is stored identically to the coached path

Feature: Reminders

  Scenario: AM vitals reminder
    Given amVitals is true and tomorrow's alarm is 04:43
    When notifications are scheduled
    Then a notification "Time for your AM orthostatic reading" is scheduled for 04:58
    Given amVitals is false
    Then no such notification is scheduled

  Scenario: PM vitals reminder
    Given pmVitals is true and target bedtime is 21:13
    Then a notification is scheduled for 20:13
```

## Acceptance criteria

- `src/test/orthostatic.test.ts` covers every scenario in the first
  feature (pure functions).
- `src/test/vitalsEntry.test.tsx` covers save-once-per-slot, draft
  resume and the direct path with Testing Library + fake-indexeddb.
- `src/test/notifications.test.ts` gains the two reminder scenarios
  (extend the existing test file if one exists, else create).
- A full coached entry with timers skipped completes in **under 60
  seconds** of interaction on the phone (pack acceptance 2) — measured
  manually, noted in the PR.
- Flag copy contains no interpretation. Grep the workstream's files
  for "hypotension", "POTS", "dysautonomia": zero hits.

## Open questions

- Whether the existing `notifications.ts` schedules via `setTimeout`
  only (page must be open) or via the service worker; if the former,
  the AM reminder is unlikely to fire and the PR notes that limitation
  rather than working around it. Confirm in `research.md` §9.
- Whether to show the Tracking summary card at all when no reading
  exists for that night (default: hide the card entirely).
