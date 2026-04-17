# Workstream: Historical backfill

**Goal:** give the recommender ground-truth labels on day one by
proxy-deriving `thermalComfort` from existing wake-cause IDs, with a
user confirmation step and a provenance flag so proxy labels are
distinguishable from user-entered ones.

**Priority:** P2. Blocked by the provenance-field decision (see
README Q2, Q3).

## Baseline from the analysis

The analysis (§a) derived a proxy rule:

- hot-wake cause OR `wasSweating` → `too_hot`
- cold-wake cause OR `feltCold` → `too_cold`
- both → `mixed`
- only non-thermal causes (Bathroom / Noise / Bed-too-late) + sleep
  score ≥ 60 → `just_right`
- else → ambiguous

8 of 11 nights labeled confidently. Critically, the analysis ran
against a dataset where **no `just_right` labels exist yet**, which is
why the recommender returns `items: []` today. Backfilling delivers
those labels.

## Tasks

### T1. Add `thermalComfortSource` to the schema

**Files:**
- `src/types.ts` (`NightLog`)
- `src/db.ts` (v9 migration)

**Do:**
- Add `thermalComfortSource: 'user' | 'proxy' | null` to `NightLog`.
  Null when `thermalComfort` is also null; otherwise set to whoever
  wrote the label.
- Migration v9 sets `thermalComfortSource = null` on all existing
  rows.
- `MorningLog.tsx` save handler sets `thermalComfortSource = 'user'`
  whenever it writes a non-null `thermalComfort`.

**Acceptance:**
- Types compile.
- Migration runs without errors; existing rows unchanged except for
  the new field.

**Open question (flagged in README):** should proxy labels be weighted
lower in `recommendForTonight`? Default here is "no weighting
difference" — a proxy `just_right` and a user-entered `just_right` vote
equally. If a future agent wants to discount proxy labels (e.g.
`support: proxyLabels × 0.5 + userLabels × 1.0`), revisit. Document
this default in a code comment.

### T2. Implement the proxy classifier

**File:** `src/services/thermalProxy.ts` (new)

**Do:** write a pure function
`classifyThermalComfortFromWakes(log: NightLog, hotCauseIds: Set<string>,
coldCauseIds: Set<string>): ThermalComfort | null`.

- Inputs: a single `NightLog`, plus the resolved cause IDs for "hot"
  causes (`Sweating / too hot`, `Heart racing / palpitations`) and
  "cold" causes (`Too cold`).
- Returns the label per the analysis rule, or `null` when ambiguous.

Include an exported helper
`resolveThermalCauseIds(causes: WakeUpCause[]): { hot: Set<string>, cold:
Set<string> }` that looks up causes by label (case-insensitive).

**Acceptance:**
- Unit tests in `src/test/thermalProxy.test.ts` covering each branch:
  - All wakes hot → `too_hot`.
  - All wakes cold → `too_cold`.
  - One hot + one cold → `mixed`.
  - No wakes, sleep score 80 → `just_right`.
  - No wakes, sleep score 50 → `null` (ambiguous, low score).
  - Only bathroom wake, sleep score 75 → `just_right`.
  - Only Unknown cause → `null`.
- Proxy doesn't read `wasSweating` / `feltCold` yet (the analysis
  showed they're always false). Add them once the data fills in.
  Flag in a code comment.

### T3. Build the backfill review UI

**Files:**
- `src/pages/insights/...` or `src/pages/settings/...` — pick the
  more fitting location based on the app's existing navigation
- New component `ThermalBackfillReview.tsx`

**Flow:**
1. User opens the review screen.
2. Component queries all `NightLog`s with `thermalComfort === null`,
   runs the proxy on each, and displays a list:
   ```
   2026-04-09   proposed: too_hot    [too_hot ▼]
   2026-04-10   proposed: too_hot    [too_hot ▼]
   2026-04-07   proposed: null       [—      ▼]   (ambiguous — skip)
   ```
3. Each row has a dropdown defaulting to the proposed label (or "—"
   for ambiguous / unlabeled). User can change any row.
4. "Apply labels" button writes:
   - `thermalComfort = selection` (or leave null for "—")
   - `thermalComfortSource = 'proxy'`
   - `updatedAt = Date.now()`

The user can re-run the flow; rows already labeled (by user or by
prior proxy) are shown with their current label and an option to
leave unchanged.

**Acceptance:**
- Manual QA: opening the flow against the analysis dataset shows the
  labels matching §a of the analysis (5 hot, 3 cold, 3 unlabeled
  proposed).
- Rows where the user changed the dropdown persist the new label
  with `thermalComfortSource = 'user'` (the user overrode the proxy,
  so their choice wins with user provenance).
- Clicking "Apply labels" is idempotent.

### T4. Show proxy-labeled nights distinctly in the UI

**Files:**
- `src/pages/insights/Dashboard.tsx` or wherever thermal comfort
  chips render (aligns with `ux.md` T6)
- `src/pages/morning/MorningReview.tsx`

**Do:** when rendering the `thermalComfort` chip, if
`thermalComfortSource === 'proxy'`, add a small icon or dashed border
and a tooltip: "Inferred from wake events — edit to confirm."
Clicking it can jump to the morning log for that night so the user
can correct the label.

**Acceptance:**
- Chips are visually distinct by source.
- Tooltip renders on hover / long-press.

### T5. Integrate `wasSweating` / `feltCold` / `racingHeart` once populated

**File:** `src/services/thermalProxy.ts`

**Do:** once `logging-fixes.md` T2 lands and the per-wake flags start
getting set, extend the proxy rule to include them (as the analysis
specifies):

- hot-wake cause OR `wasSweating` → `too_hot`
- cold-wake cause OR `feltCold` → `too_cold`

This task is a follow-up once flags are actually being captured. For
the initial backfill, the data doesn't exist, so the flags are inert.
Leave a `TODO(flags)` comment and a unit test that exercises the
flag-aware branches with synthetic data.

**Acceptance:**
- Unit test `wasSweating: true, no hot cause → too_hot` passes.
- No production behavior change until flags are populated in real
  logs.

### T6. Don't re-propose labels the user has already rejected

**Files:**
- `src/types.ts` (`NightLog`)
- `ThermalBackfillReview.tsx`

**Why:** if a user reviews 11 nights, accepts 8 and explicitly skips 3
(picks "—"), the next time they run the flow those 3 shouldn't
re-appear with proxy labels, or they'll have to decline them again.

**Do:**
- Add `thermalProxyDismissed: boolean` to `NightLog` (default
  `false`; migration sets it on existing rows).
- When the user saves the review with "—" selected for a row that
  had a proposed label, set `thermalProxyDismissed = true` on that
  row.
- The review UI queries where `thermalComfort === null AND
  thermalProxyDismissed === false`.

**Acceptance:**
- Running the flow twice against the same data: round 1 proposes, user
  dismisses some; round 2 shows only nights the user hasn't acted on.
- A user-accepted proxy label *does not* set
  `thermalProxyDismissed = true` — accepting is not dismissing.

## Known unknowns / gaps to resolve before coding

- **Ambiguity threshold.** The analysis classifies "no thermal wakes +
  sleepScore ≥ 60" as `just_right`. 60 is arbitrary. Options:
  - (a) Keep 60 for simplicity.
  - (b) Use the user's 7-day median minus 10 points (relative
    threshold).
  - (c) Keep 60 but show ambiguous-score nights in the review UI with
    a "confidence: low" flag.
  Recommendation: (a) for the first pass; revisit if >20% of
  just_right proposals feel wrong to the user.

- **How does `wasSweating` reshape the rule once populated?** The
  current rule weights cause-labels equally with the per-wake flag.
  If the user has two wakes — one "Bathroom" with `wasSweating: true`,
  one "Sweating / too hot" without — should both flag hot? (Yes, per
  the analysis.) Double-check with the user before shipping T5.

- **Does the proxy look at `minHeartRate` or `skinTempRange`?** The
  analysis says no — minHR has AUC 0.667 and skinTempRange is
  unparsed. Revisit once those are useful features.

- **UI placement.** The review flow doesn't naturally fit the
  evening/morning/calendar/insights/settings tabs. Candidates:
  - Insights → "Label past nights" button on the dashboard.
  - Settings → "Data" section.
  - A one-time onboarding card the first time the user visits
    Insights after this lands.
  Pick whichever is closest to existing UX patterns. Flag the choice
  in the PR.
