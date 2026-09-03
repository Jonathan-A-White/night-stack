# Workstream: insights-and-rules

**Blocked by:** `episode-capture`, `vitals`, `body-measurements`,
`night-tags`. **Runs in parallel with:** `samsung-bulk-import`,
`clinician-export`.

Decisions: Q15 (either axis, deltas default Y), Q16 (two clause kinds
and their text), Q10 note (`adrenergicNight` derived boolean).
Research: §11 (Correlations/MetricDetail/Dashboard shapes), §12 (rules
engine touch points), §15 item 5 (placeholder cases).

## Scope

1. **`src/services/nightMetrics.ts`** — one shared, pure registry:

   ```ts
   interface NightMetricCtx {
     log: NightLog;
     body: { weightDeltaLbs: number | null; neckDeltaIn: number | null;
             pmWeight: number | null; amWeight: number | null; pmNeck: number | null; amNeck: number | null };
     ortho: { am: OrthostaticDerived | null; pm: OrthostaticDerived | null };
   }
   interface NightMetric { key: string; label: string; side: 'x' | 'y' | 'both'; defaultSide: 'x' | 'y'; extract(ctx): number | null; format?(v): string }
   ```

   New metrics: `sodiumLevel` (0/1/2), `electrolyteDose` (0/1/2, null
   when unset), `positionStarted` (side 0 / back 1, unknown null),
   `positionAtWake`, `wiredWake` (0/1), `episodeCount`,
   `adrenergicNight` (1 if `episodeCount > 0 || wiredWake`),
   `weightDelta`, `neckDelta`, `orthoAmSystolicDrop3`,
   `orthoAmDiastolicDrop3`, `orthoAmPulseRise3`, same for PM,
   `orthoFlagCount` (AM + PM flags). Existing Correlations extractors
   move into the registry unchanged.
2. **Correlations** derives `X_OPTIONS` / `Y_OPTIONS` from the
   registry (`side` and `defaultSide`), keeps the 90-day window, and
   builds `NightMetricCtx` per night from `bodyMeasurements` and
   `orthostaticReadings` maps.
3. **MetricDetail** widens `extract` to `(ctx)` and adds `weightDelta`,
   `neckDelta`, `orthoAm`, `orthoPm`, `episodes` types; Experiments
   home cards deep-link to them.
4. **Experiments home cards** (`ExperimentsHome`): last 7 nights ×
   (sodium chip, position, weight Δ, neck Δ, episode ⚡, AM/PM flag
   chips) as a compact grid; tap → morning review.
5. **Rules**: `high_salt_and_supine` and `orthostatic_flag_today`
   evaluator cases + `CLAUSE_KINDS` entries + `formatClause` text;
   `RuleEvalContext.todayOrthostatic?: OrthostaticReading[]`;
   `TonightPlan` passes today's readings and the current draft's
   `sodiumLevel`/`positionStarted` (the draft is in `localStorage`
   until saved — read the draft's values so the rule can fire
   **before** the evening log is saved, matching pack acceptance 6).
   Seeded rule text per Q16. The Tonight plan renders the two
   recommendations with a "bring this to your doctor" style for the
   orthostatic one and no interpretation.

## Non-goals

- Recommender (`recommender.ts`) feature changes.
- Statistical tests beyond Pearson r; no p-values.

## Data changes

None beyond `schema.md` (the clause union members already exist).

## UI changes

`Correlations` pickers (grouped `<optgroup>`s: Tags / Body / Vitals /
Sleep), `MetricDetail` new types, `ExperimentsHome` grid,
`SleepRulesPage` picker gains the two kinds automatically from
`CLAUSE_KINDS`, `TonightPlan` context wiring.

## Given / When / Then

```gherkin
Feature: Night metrics registry

  Scenario: Ordinal encodings
    Given sodiumLevel 'much_more', electrolyteDose 'half', positionStarted 'back', wiredWake true
    Then extract yields 2, 1, 1, 1 respectively
    Given positionStarted 'unknown'
    Then positionStarted extract yields null

  Scenario: adrenergicNight composite
    Given no episodes and wiredWake false → 0
    Given one episode event → 1
    Given no episodes and wiredWake true → 1

  Scenario: Deltas and vitals come from context
    Given ctx.body.weightDeltaLbs 1.8 and ctx.ortho.am.drop3.systolic 22
    Then weightDelta yields 1.8 and orthoAmSystolicDrop3 yields 22
    Given ctx.ortho.am is null
    Then orthoAmSystolicDrop3 yields null

  Scenario: Sides
    Then weightDelta and neckDelta have side 'both' and defaultSide 'y'
    And sodiumLevel has side 'both' and defaultSide 'x'
    And sleepScore keeps side 'y'

Feature: Correlations

  Scenario: Neck delta vs sodium level plots
    Given 5 nights with sodium levels and neck deltas
    When X = sodiumLevel and Y = neckDelta
    Then 5 points render and Pearson r is shown

  Scenario: A Y metric can be moved to X
    When X = neckDelta and Y = adrenergicNight
    Then the plot renders (both pickers list neckDelta)

Feature: Rules

  Scenario: high_salt_and_supine fires on sodium alone before bed
    Given currentLog (or the evening draft) has sodiumLevel 'more' and positionStarted 'unknown'
    Then the clause evaluates true

  Scenario: Side sleeper suppresses it
    Given sodiumLevel 'more' and positionStarted 'side'
    Then false

  Scenario: Normal sodium suppresses it
    Given sodiumLevel 'normal' and positionStarted 'back'
    Then false

  Scenario: orthostatic_flag_today
    Given todayOrthostatic contains an AM reading with flags ['systolic_drop']
    Then true
    Given todayOrthostatic is [] or undefined
    Then false

  Scenario: Seeded rule text
    Then the rule named 'Salt night — side sleep' recommends "Sleep on your side tonight."
    And 'Orthostatic flag' recommends "Bring today's orthostatic reading to the doctor."

  Scenario: Editor offers the new kinds
    When the rule editor's clause picker renders
    Then it lists "Salt above normal and not side-sleeping" and "Orthostatic flag today"
```

## Acceptance criteria

- `src/test/nightMetrics.test.ts` covers the registry scenarios.
- `src/test/rules.test.ts` gains the rule scenarios.
- Manual: Tonight plan shows "Sleep on your side tonight." after
  picking "More than usual" in the evening draft (pack acceptance 6).
- Copy audit: no diagnostic wording (grep for "hypotension", "POTS",
  "apnea", "AFib is"). Zero hits.
- Lint, typecheck, tests, build green.

## Open questions

- Whether `orthostatic_flag_today` should also consider yesterday's PM
  reading when evaluated before today's AM exists. Default: today only.
