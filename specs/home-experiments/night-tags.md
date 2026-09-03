# Workstream: night-tags

**Blocked by:** `schema`, `app-shell`. **Runs in parallel with:**
`episode-capture`, `vitals`, `body-measurements`. **Blocks:**
`insights-and-rules`, `clinician-export`.

Decisions: Q11 (`sodiumLevel` replaces the flag), Q12 (positions),
Q13 (`electrolyteDose` field). Research: §2 (provenance chip), §3
(reader list), §15 item 6 (`anyFlag` semantics).

## Scope

1. **Evening log — `NightTagsStep`** (new step component, inserted
   after Food & Drink): sodium level segmented control (Normal / More
   than usual / Much more), sodium-source chips (free text + recent
   chips from the last 30 nights' `sodiumSources`), electrolyte drink
   dose (None / Half / Full), position started (Side / Back). Touching
   the sodium control sets `sodiumLevelSource: 'user'`.
2. **Morning log — `WakeTagsStep`** (after wake-up events): position at
   final wake (Side / Back / Unknown), "Woke wired?" (Yes / No), and a
   read-only line "Watch wake time: 04:44" from
   `sleepData.wakeTime` when present.
3. **`SodiumLevelChip`** mirroring `ThermalComfortChip` (label +
   "(inferred)" for proxy) used by `EveningReview`, `MorningReview`,
   `CalendarPage` day cell (a small "salt" dot for `more`/`much_more`).
4. **Retarget `high_salt` readers** per research §3: `ThermalFit`
   intake filters become `sodium_more` / `sodium_much_more`;
   `recommender.test.ts` flag loop; `DataManagementPage` import runs
   `backfillNightLogV12` on each imported night so old backups load.
5. `Correlations`: add X option "Sodium level (0/1/2)" now (the rest of
   the picker refactor is insights-and-rules) and note in the label
   that "Any flag" no longer includes salt.

## Non-goals

- Rules, dashboard cards, export columns (insights-and-rules,
  clinician-export).
- Editing proxy labels in bulk (a night is corrected by editing it).

## Data changes

Uses `sodiumLevel`, `sodiumLevelSource`, `sodiumSources`,
`electrolyteDose`, `positionStarted`, `positionAtWake`, `wiredWake`
from `schema.md`. No further schema changes.

## UI changes

- `src/pages/tonight/steps/NightTagsStep.tsx`,
  `src/pages/morning/steps/WakeTagsStep.tsx`,
  `src/components/SodiumLevelChip.tsx`.
- Evening wizard: step list + draft fields + save block
  (`eveningIntake.sodiumLevel/Source/Sources`, `electrolyteDose`,
  `positionStarted`).
- Morning wizard: step list + draft fields + save block
  (`positionAtWake`, `wiredWake`).
- Review pages and calendar: chip / dot.

## Given / When / Then

```gherkin
Feature: Evening tags

  Scenario: Default state for a new night
    When the evening log opens for a night with no existing row
    Then sodium level shows Normal, dose shows unset, position shows unset
    And saving without touching them stores sodiumLevel 'normal', sodiumLevelSource 'user', electrolyteDose null, positionStarted 'unknown'

  Scenario: Editing a proxy-labelled night
    Given a historical night with sodiumLevel 'more' and sodiumLevelSource 'proxy'
    When the evening log opens it via ?date and the user does not touch the sodium control
    Then on save sodiumLevelSource is still 'proxy'
    When the user taps "Much more"
    Then on save sodiumLevel is 'much_more' and sodiumLevelSource is 'user'

  Scenario: Sodium sources chips
    Given the last 30 nights include sources "pretzels" (3 nights) and "soy sauce" (1 night)
    When the tags step renders
    Then "pretzels" and "soy sauce" are offered as chips, most frequent first
    When "pretzels" is tapped and "ramen" typed
    Then sodiumSources saved is ['pretzels', 'ramen']

  Scenario: Draft round trip
    Given sodium 'more', dose 'half', position 'back' entered and the app killed
    When the evening log reopens
    Then the three values are restored from the draft

Feature: Morning tags

  Scenario: Position at wake and wired
    When the morning log is saved with position 'side' and wired Yes
    Then the night has positionAtWake 'side' and wiredWake true

  Scenario: Watch wake time is displayed, never edited
    Given sleepData.wakeTime '04:44'
    Then the wake tags step shows "Watch wake time 4:44 AM" as text with no input

Feature: Chip and readers

  Scenario: Chip shows provenance
    Given sodiumLevelSource 'proxy' and level 'more'
    Then SodiumLevelChip renders "More salt (inferred)"

  Scenario: ThermalFit filter by sodium
    Given nights with levels normal, more, much_more
    When the "Sodium: more or much more" filter is applied
    Then only the last two nights match

  Scenario: Old backup import
    Given a JSON backup whose nights still carry the high_salt flag
    When it is imported
    Then each night has sodiumLevel derived from the flag with source 'proxy' and no high_salt flag remains
```

## Acceptance criteria

- `src/test/nightTags.test.ts` covers the pure pieces: chip label
  function, chip-suggestion ranking, import normalization, ThermalFit
  predicate.
- Save-path scenarios covered with fake-indexeddb by driving the same
  pure `buildEveningIntakeForSave` / `buildMorningTagsForSave` helpers
  the wizards call (extract them so they are testable without
  mounting the 1400-line component).
- Lint, typecheck, tests, build green; the `recommender.test.ts`
  change is described in the PR.

## Open questions

- Whether `positionStarted` deserves an "unknown" button in the
  evening UI or only defaults to it when skipped. Default: no button;
  skip = unknown.
