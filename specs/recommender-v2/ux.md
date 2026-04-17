# Workstream: UX surfacing

**Goal:** ship the user-facing half of the recommender tune-up.
Includes the forecast-low → starting-room prefill, the "pressure"
indicator, the opposite-of-failure exploratory fallback, and new
tonight-form inputs matching the reshaped `RecommenderInputs`.

**Priority:** P2. Blocked by `distance-function.md` (inputs shape) and
`derived-features.md` (metrics to surface).

## Baseline from the analysis

- Linear fit for prefill:
  `startingRoom ≈ 0.436 × weatherLow + 49.91`, R²=0.831.
- "Pressure" metric: `weatherLow − startingRoom`. Not added as a
  distance dimension (redundant with its inputs) but surfacing it
  educates the user about how tonight cools.
- Opposite-of-failure fallback: when there are no `just_right`
  neighbors, but ≥60% of top-K neighbors failed the *same* way (all
  too_hot or all too_cold), recommend the stack from the *least-bad*
  neighbor as a starting point, labeled as exploratory.

## Tasks

### T1. Update the Tonight form to match the new `RecommenderInputs`

**File:** `src/pages/tonight/TonightPlan.tsx`

**Current form controls (recent commit):**
- Starting room temp (number)
- Planned AC curve (select)
- AC setpoint (number, conditional on curve)
- Toggles: Ate late, Overate, Alcohol

**New form controls:**
- Starting room temp (number) — prefilled from forecast low (see T2)
- Planned AC curve (select) — unchanged; only visible when
  `settings.acInstalled === true` (ties into `logging-fixes.md` T4)
- AC setpoint (number) — unchanged
- Hours since last meal (number, step=0.25) — **replaces the
  "Ate late" toggle.** Prefilled from today's pending evening log if
  the user has already filled in `lastMealTime`, otherwise empty.
- Room humidity (number) — optional, prefilled from today's pending
  environment reading if available
- Alcohol (toggle) — unchanged

**Do:**
- Remove the `ateLate`, `overate` toggles.
- Add the `hoursSinceLastMeal` and `roomHumidity` inputs.
- Rewire the `inputs` object constructed in the `recommendation`
  computation (around line ~155) to match the new
  `RecommenderInputs` shape.
- Pass `coolingRate1to4F: null` — it's a derived-from-past feature
  that the user can't plan tonight. Leave the distance function's
  half-penalty to handle it.

**Acceptance:**
- `npm run build` succeeds.
- Adjusting `hoursSinceLastMeal` changes the returned neighbors in a
  manual test (same inputs, different hours).
- No lingering references to `ateLate` / `overate` / `highSalt` in
  the file.

### T2. Prefill starting room temp from forecast low

**File:** `src/pages/tonight/TonightPlan.tsx`

**Do:**
- Add a helper `estimateStartingRoomTemp(overnightLowF: number): number`
  implementing `Math.round(0.436 * overnightLowF + 49.91)`. Place it
  in `src/services/recommender.ts` as an exported utility or in
  `src/utils.ts` — prefer `recommender.ts` so the fit lives next to
  the analysis provenance.
- When the Tonight page loads with `overnightLow !== null` and the
  `plannedRoomTemp` state is empty, seed the state via the estimate.
- Show a small helper text below the field: "Estimated from tonight's
  forecast low (±3°F). Measure if you can." Make the field fully
  editable.
- If the user clears the field manually, don't re-auto-fill it — the
  prefill is one-shot.

**Acceptance:**
- With a known forecast low, the field prefills with the right value
  on first render.
- Clearing the field and navigating away and back does not re-fill.
- Unit test: `estimateStartingRoomTemp(50)` returns `72` (≈
  `0.436*50 + 49.91 = 71.71 → 72`).

**Open question (flagged in README):** bootstrap with the hardcoded
coefficients, then swap to per-user learning once the user has ≥10
nights with both fields populated. Per-user learning can be added in
a follow-up task; keep the interface simple here.

### T3. Add a "pressure" indicator

**File:** `src/pages/tonight/TonightPlan.tsx`

**Do:** when both `overnightLow` and `plannedRoomTemp` are set,
render a small metric below the form: `pressure = overnightLow -
plannedRoomTemp`, with a plain-English suffix:

- pressure ≥ −5: "Little cooling pressure tonight — room won't drop
  much."
- −15 < pressure < −5: "Moderate cooling — expect the room to fall a
  few degrees."
- −30 < pressure ≤ −15: "Strong cooling — room will fall sharply."
- pressure ≤ −30: "Extreme cooling — consider closing the window /
  running the heater early."

The thresholds are rough; tune after the agent's manual review of
user's export (cold nights had pressure around −30, hot around
−17).

**Acceptance:**
- Indicator renders only when both inputs are set.
- Recomputes on input change.

### T4. Implement the opposite-of-failure fallback

**Files:**
- `src/services/recommender.ts` (`recommendForTonight`)
- `src/pages/tonight/TonightPlan.tsx` (render the fallback with a
  different visual treatment)

**Semantics (copy from analysis §c):**

Today, when `goodNeighbors.length === 0`, `recommendForTonight`
returns `items: []`. Under the fallback:

1. If there are no `just_right` neighbors but `badNeighbors.length >=
   0.6 * neighbors.length` AND the bad neighbors skew predominantly
   one direction (≥60% `too_hot` or ≥60% `too_cold`):
   - Pick the neighbor with the highest sleep score among the *less-
     skewed* direction. Example: if 3 of 5 neighbors were `too_hot`,
     pick the neighbor with the highest score that was NOT `too_hot`
     (or, if none exist, the neighbor with the mildest "too_hot"
     signature — fewest hot wakes, lowest in-bed minutes at the
     hot-wake times).
   - Return that neighbor's clothing/bedding/AC/fan as exploratory
     items with `support: 1 / 1` and a new `Recommendation` field
     `mode: 'consensus' | 'exploratory'` (default `'consensus'`).
2. Otherwise return `items: []` as today.

**Do:**
- Add a `mode` field to the `Recommendation` type.
- Implement the neighbor selection.
- Update `buildSummary`/`buildWarning` to communicate
  "exploratory" mode: "No past nights with inputs this similar
  ended 'just right.' Starting point below is from the least-bad
  similar night — treat it as a guess."
- In `TonightPlan.tsx`, render the "Stack that worked" section with
  a warning banner when `mode === 'exploratory'`. Different title —
  e.g. "Starting point (experimental)".

**Acceptance:**
- Unit tests:
  - `recommendForTonight` with 5 neighbors all `too_hot` returns a
    non-empty `items` in `exploratory` mode.
  - Same call with 5 neighbors split 3 hot / 2 cold (no strong
    direction) returns `items: []`.
  - With 1 `just_right` neighbor and 4 mixed, `mode === 'consensus'`
    (unchanged behavior).
- UI renders the exploratory mode with a distinct banner.

### T5. Wire new features into the Correlations picker

**File:** `src/pages/insights/Correlations.tsx`

**Do:** add these as selectable X-axis / Y-axis options, computed on
the fly from existing logs:
- Room humidity (already stored; just expose if not already)
- Hours since last meal (via the new helper from `derived-features.md`)
- Cooling rate 1→4am (via the new helper)
- Pressure (weatherLow − startingRoomTempF)

**Acceptance:**
- All four appear in the picker dropdowns.
- Selecting each renders a scatter with Pearson r and n like the
  existing options.
- Unit test: given a fixture set of logs, the derived metric values
  match what the new helpers return.

### T6. Surface the thermal-comfort label on the insights dashboard

**File:** `src/pages/insights/Dashboard.tsx` (or wherever the
"Best Nights" view lives)

**Why:** small visibility win. The user just started tagging mornings;
seeing those tags reflected in the dashboard reinforces the loop.

**Do:** for each night displayed, show the `thermalComfort` as a small
colored chip next to the date (green `just_right`, red
`too_hot`/`too_cold`, amber `mixed`, grey `null`).

**Acceptance:**
- Chip renders on every night row.
- Null thermalComfort shows a grey "—" chip, not absent.

### T7. Morning log: surface "your thermal pattern last night"

**File:** `src/pages/morning/MorningReview.tsx`

**Why:** closes the loop right after the user tags the night — they
should see which recommender neighbors they resemble in hindsight.

**Do:** add a new section "How last night compared" showing:
- Last night's thermalComfort chip.
- Top 3 most similar past nights (by `nightDistance` from last
  night's own inputs). For each: date, distance, thermalComfort.
- A one-line insight: "2 of your 3 closest matches also ended [label]"
  when applicable.

**Acceptance:**
- Section renders only when last night has `thermalComfort` set.
- Doesn't self-include (last night isn't a "past match" of itself).
- Unit test not strictly required; manual QA against the data export
  is sufficient.

## Known unknowns / gaps to resolve before coding

- **Should we hide the recommendation card until ≥3 labeled nights
  exist?** Today it renders a "seed the recommender" empty state. An
  alternative: a collapsed card with a "Show when ready" CTA. Default
  here is keep the empty state; more friction isn't obviously helpful.

- **Where does Correlations.tsx compute X/Y values?** Before T5 starts,
  read the file to see whether derived metrics fit its pattern. If
  Correlations expects pre-computed fields on `NightLog`, we may
  need to memoize the derived values instead of re-deriving per
  scatter point.

- **Exploratory-mode visual treatment.** This spec says "distinct
  banner." If the codebase has a design system beyond the generic
  `.banner .banner-warning` class, use whatever matches "experimental
  / low-confidence" messaging. Flag if unclear.

- **Per-user linear fit.** Out of scope here (see README Q3). If the
  agent sees a trivially-small extension to land it in the same
  commit (e.g. compute from `allLogs` when `n ≥ 10` with both fields
  populated, else fall back), that's fine — but don't block T2 on
  it.
