# Workstream: Distance function

**Goal:** reshape `RecommenderInputs`, re-weight `nightDistance`, and
fix the AC-curve conditional so ~35% of distance weight stops being
spent on zero-variance or zero-signal dimensions.

**Priority:** P1. Blocked by `derived-features.md` (needs new
derivations in `logToInputs`).

## Baseline from the analysis

See `analysis/recommender-tuning-2026-04-17.md` §b and §c.

Current state (`src/services/recommender.ts:83-121`):
- `addDim(overnightLowF, 3, 15)` — keep
- `addDim(startingRoomTempF, 3, 5)` — keep, raise to 4
- `addDim(plannedAcSetpointF, 1, 5)` — keep
- `addBool(ateLate, 1)` — **drop**
- `addBool(overate, 1)` — **drop**
- `addBool(highSalt, 0.5)` — **drop**
- `addBool(alcohol, 1)` — **keep, lower to 0.5**
- AC curve block (1.5) — **fix conditional**
- **Add:** `addDim(roomHumidity, 1, 10)`
- **Add:** `addDim(hoursSinceLastMeal, 1, 3)`
- **Add:** `addDim(coolingRate1to4F, 1, 0.6)`

## Tasks

### T1. Reshape `RecommenderInputs`

**File:** `src/services/recommender.ts`

**Do:** update the interface to match the analysis's proposed shape:

```ts
export interface RecommenderInputs {
  overnightLowF: number | null;
  startingRoomTempF: number | null;
  roomHumidity: number | null;            // NEW
  hoursSinceLastMeal: number | null;      // NEW (replaces ateLate)
  coolingRate1to4F: number | null;        // NEW (derived from roomTimeline)
  alcohol: boolean;                       // keep
  plannedAcCurve: AcCurveProfile | null;
  plannedAcSetpointF: number | null;
}
```

Remove: `ateLate`, `overate`, `highSalt`.

Keep the `RecommenderInputs` export. `logToInputs` returns this
shape; `TonightPlan.tsx` constructs it from user dial state (see
`ux.md`).

**Acceptance:**
- `src/services/recommender.ts` compiles after this change only when
  `logToInputs` and `TonightPlan.tsx` are updated to match (see T5
  and `ux.md`).
- No other module imports `RecommenderInputs` fields that were
  removed. Grep `ateLate|overate|highSalt` to confirm.

### T2. Re-weight `nightDistance`

**File:** `src/services/recommender.ts` (`nightDistance`)

**New body (only the weighted-sum lines change; the `addDim`/`addBool`
helpers stay):**

```ts
addDim(a.overnightLowF,       b.overnightLowF,       3, 15);
addDim(a.startingRoomTempF,   b.startingRoomTempF,   4, 5);   // was 3
addDim(a.roomHumidity,        b.roomHumidity,        1, 10);  // NEW
addDim(a.hoursSinceLastMeal,  b.hoursSinceLastMeal,  1, 3);   // NEW
addDim(a.coolingRate1to4F,    b.coolingRate1to4F,    1, 0.6); // NEW
addDim(a.plannedAcSetpointF,  b.plannedAcSetpointF,  1, 5);   // unchanged

addBool(a.alcohol, b.alcohol, 0.5);  // was 1

// AC curve block — see T3
```

**Scales rationale (document in code comments):**
- humidity scale 10 pp: matches the observed between-night spread.
- hoursSinceLastMeal scale 3: a 3-hour difference is about the full
  range observed.
- coolingRate1to4F scale 0.6: a ±0.6 °F/h difference is ~"very
  different" per the analysis's rank separation.

**Acceptance:**
- All existing tests in the recommender unit-test file pass.
- New unit tests (see T6) cover the new dimensions.

### T3. Fix the AC-curve conditional

**File:** `src/services/recommender.ts` (`nightDistance`, lines
~113–118)

**Current behavior:** always adds 1.5 to `totalWeight`; if either
side's `plannedAcCurve` is null, adds 0.75 (half-penalty). Against
today's dataset (`'off'` on 11/11 nights, never null), this penalty is
a *fixed constant* applied to every comparison. It doesn't
discriminate — it just shifts the absolute distance scale.

**New behavior:** only add weight and distance when *both* sides are
non-null and non-`'off'`. Two logs that both have the AC off contribute
nothing to distance or totalWeight for this dimension. One side `off`
and the other running also contributes nothing — we don't penalize
mismatched AC use on a curve we have no data to compare.

```ts
if (
  a.plannedAcCurve && b.plannedAcCurve &&
  a.plannedAcCurve !== 'off' && b.plannedAcCurve !== 'off'
) {
  totalWeight += 1.5;
  if (a.plannedAcCurve !== b.plannedAcCurve) d += 1.5;
}
```

**Acceptance:**
- New unit test: `nightDistance` between two `inputs` with
  `plannedAcCurve === 'off'` on both sides does not contribute any AC
  distance. Verify by comparing against the same inputs with
  `plannedAcCurve === null` on both sides — they should produce the
  same distance.
- New unit test: one side `'cool_early'`, other side `'hold_cold'`
  adds 1.5 to `d`. Both `'cool_early'` adds 0.

**Open question (flagged in README):** is `'off'` intentionally
excluded from discriminating, or should it? Default here is "yes,
exclude" — revisit after the user has enough AC-on nights to measure
AC-on vs AC-off separation.

### T4. Keep the missing-dimension half-penalty semantics

**File:** `src/services/recommender.ts` (`nightDistance`, `addDim`)

**Do:** no change. The existing `addDim` half-penalty (`d += weight *
0.5` when either side is null) is correct behavior for the new
dimensions — we don't want to free-match logs with missing data.

Document this explicitly in a comment above `addDim` so the next
contributor doesn't "fix" it.

### T5. Update `logToInputs` to match the new shape

**File:** `src/services/recommender.ts` (`logToInputs`)

**Do:**
- Remove `flagsOn('late_meal')` / `flagsOn('overate')` /
  `flagsOn('high_salt')` derivations.
- Add `roomHumidity: log.environment.roomHumidity`.
- Add `hoursSinceLastMeal: computeHoursSinceLastMeal(log)` (see
  `derived-features.md` T1).
- Add `coolingRate1to4F: computeCoolingRate1to4F(log)` (see
  `derived-features.md` T2).
- Keep `alcohol: log.eveningIntake.alcohol != null`.

**Acceptance:**
- Unit test: calling `logToInputs` on a fixture `NightLog` with all
  new fields populated returns the expected shape with no missing
  keys.
- Unit test: calling `logToInputs` on a minimal fixture (most fields
  null) returns an object with the new numeric fields as `null`, not
  `0` or `undefined`.

### T6. Unit tests for the new distance function

**File:** `src/test/recommender.test.ts` (create if missing)

Minimum coverage:

1. **Identity:** `nightDistance(a, a) === 0` for a realistic `a`.
2. **AC-off symmetry:** two inputs identical except both have
   `plannedAcCurve === 'off'` and `plannedAcSetpointF === null` yield
   the same distance as both `plannedAcCurve === null`. (Verifies T3.)
3. **Raised room-temp weight:** changing `startingRoomTempF` by 5°F
   now contributes proportionally more than changing `overnightLowF`
   by 5°F times (15/5) — i.e. verify the weight change landed.
4. **Humidity penalty:** 10 pp humidity difference contributes
   approximately `1 / totalWeight` to distance.
5. **Hours-since-meal penalty:** 3-hour diff contributes `1 /
   totalWeight`.
6. **Cooling-rate penalty:** 0.6 °F/h diff contributes `1 /
   totalWeight`.
7. **Missing dimension:** null on one side of humidity contributes
   `0.5 / totalWeight` (half-penalty).
8. **No dropped flags contribute:** a fixture where
   `eveningIntake.flags` includes `overate: true` on one night and
   `false` on the other produces the same distance as when both are
   false. Guards against future re-introduction of zero-signal dims.

### T7. Regression-check the Tonight recommendation panel

**File:** `src/pages/tonight/TonightPlan.tsx`

**Why:** the panel constructs a `RecommenderInputs` object inline.
After T1, the shape is different. `ux.md` covers the UI form
changes; this task is just "make sure the construction compiles and
passes the right thing to `recommendForTonight`."

**Do:** audit the `recommendation` block in `TonightPlan.tsx` (~line
155 after the recent edits). Replace the old binary flags with the
new numeric inputs, even if they default to `null` on the
user-facing side. Detailed UX changes land in `ux.md`.

**Acceptance:**
- `npm run build` succeeds.
- The Tonight page renders without errors after manual QA.

## Known unknowns / gaps to resolve before coding

- **Does raising `startingRoomTempF` weight from 3 → 4 require a
  corresponding scale change?** The scale is already 5. Leaving it at
  5 means "5°F difference now contributes (4/5 = 0.8) to raw distance
  before normalization" — more than the prior (3/5 = 0.6). That's
  the intended effect. No scale change.

- **Is `coolingRate1to4F`'s scale of 0.6 right?** The analysis found
  ≤−0.3 °F/h separated hot from cold clustering. Scale 0.6 means a
  1.2 °F/h difference fully saturates the dimension. Given the
  observed range (roughly −1 to 0), this feels right. Re-tune if
  cooling rates in a bigger sample are tighter than expected.

- **Normalization is `d / totalWeight`.** After dropping three `addBool`
  weights totaling 2.5 and adding three `addDim` weights totaling 3,
  total weight rises from ~14 to ~13.5 (approximate — depends on the
  AC block now triggering less). Absolute distances will shift. None
  of the recommender's downstream callers rely on a specific
  distance magnitude — they only compare distances relatively, so
  this is fine. Flag if any future work depends on absolute values.

- **Does `recommendForTonight`'s K=5 neighbor cap still make sense?**
  Unchanged here. Revisit when `totalLabeledNights` crosses 30.
