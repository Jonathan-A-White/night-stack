# Recommender v2 — spec pack

Derived from `analysis/recommender-tuning-2026-04-17.md` (n=11 nights,
2026-04-06 → 2026-04-16). Read the analysis first — these specs assume
its findings and don't restate the numbers.

## What this spec pack is for

An agent team implementing a second pass on the comfort-tuning
recommender that shipped in commit `6ea1ca3`. The analysis exposed three
blocking problems: zero `just_right` ground-truth labels, ~35% of
distance weight spent on zero-variance dimensions, and a duplicate-log
data bug. This pack turns each into a workstream with concrete tasks.

## Workstreams

Each file below is self-contained and picks up from the analysis. Files
are ordered by dependency, not priority.

| File | Scope | Blocks / Blocked by |
|---|---|---|
| `logging-fixes.md` | Ensure the UI actually captures the fields the recommender needs. Zero defects caused all the dead-field findings in §d of the analysis. | Blocks every other workstream |
| `bugfixes.md` | Root-cause the duplicate `sleepData` + overwritten `roomTimeline` on 4/15 ≡ 4/16. Without fixing this, historical nights double-count and fresh data gets stale on re-import. | Independent; do in parallel with logging-fixes |
| `derived-features.md` | New feature derivations: `hoursSinceLastMeal`, `coolingRate1to4F`, pulling `roomHumidity` through. | Blocked by logging-fixes for `lastMealTime` coverage. Blocks distance-function. |
| `distance-function.md` | Reshape `RecommenderInputs`, re-weight `nightDistance`, fix the AC-curve conditional. | Blocked by derived-features |
| `ux.md` | User-facing deliverables: starting-room prefill, "pressure" indicator, opposite-of-failure fallback, correlations picker updates. | Blocked by distance-function (inputs) + derived-features (surfaceable metrics) |
| `backfill.md` | One-time historical labeler: proxy-derive `thermalComfort` from wake-cause IDs, add provenance. Unlocks the recommender on day one instead of waiting weeks for user labels. | Blocked by logging-fixes (provenance field schema) |

## Suggested execution order

```
          ┌── logging-fixes ──┬── derived-features ── distance-function ── ux
          │                   │
start ────┤                   └── backfill
          │
          └── bugfixes  (parallel)
```

Agents 1 and 2 can start immediately on `logging-fixes.md` and
`bugfixes.md`. Agent 3 picks up `derived-features.md` as soon as
`logging-fixes.md` lands the `lastMealTime` and `loggedBedtime`
improvements. Agents 4 and 5 branch off once the new feature shape is
landed.

## Acceptance for the pack as a whole

1. A new `nightstack-export.json` taken a week after these land shows:
   - ≥5 nights with `thermalComfort !== null`, at least one `just_right`.
   - ≥5 nights with `eveningIntake.lastMealTime` set.
   - Zero nights where `roomTimeline` timestamps fall outside the log's
     own evening window.
   - No two nights sharing byte-identical `sleepData`.
2. `recommendForTonight` returns a non-empty `items` array for a
   realistic tonight input against that export.
3. `nightDistance` has unit tests covering: both-sides-present, one-side
   missing, and the AC-off symmetry (two `off` logs should not accrue
   any AC-curve distance).

## Cross-cutting open questions

These affect multiple workstreams. Resolve before the relevant agent
starts.

1. **Is the window AC installed yet?** The user's original framing said
   "we *will* have a window AC." The April export shows `acCurveProfile
   === 'off'` on 11/11 nights. If AC isn't live:
   - `distance-function.md` already gates AC distance on both sides
     non-`off`, which handles this gracefully.
   - `logging-fixes.md` should *not* make AC fields required.
   - Consider a `settings.acInstalled: boolean` so the UI can hide AC
     inputs until the user opts in. Not currently specced — flag for
     decision.

2. **Proxy-derived labels: auto-apply or ask?** `backfill.md` proposes
   deriving `thermalComfort` from wake-cause IDs for historical nights.
   Two options:
   - (a) Automatically stamp every historical night with the derived
     label and mark `thermalComfortSource === 'proxy'`.
   - (b) Offer the user a one-screen "review and confirm" flow where
     each proposed label is editable before commit.
   Recommendation: (b). Decide before starting `backfill.md`.

3. **`thermalComfortSource` provenance field.** If we keep
   proxy-derived labels distinct from user-entered ones, the schema
   needs a new field. Questions:
   - Values: `'user' | 'proxy'` — enough, or do we also need `'import'`
     for future third-party tags?
   - Does the recommender weight them the same, or discount proxy
     labels (lower weight in neighbor voting)?

4. **Starting-room-from-forecast-low fit.** Analysis gives
   `startingRoom ≈ 0.436·weatherLow + 49.91, R²=0.831`. Options:
   - (a) Hardcode the coefficients as a constant in the UX prefill.
   - (b) Recompute per-user from their own past logs once they have
     ≥10 nights with both fields populated.
   - (c) Skip the prefill entirely and keep the field required.
   Recommendation: (b) with (a) as the bootstrap. Decide before
   starting `ux.md`.

5. **"Mixed" `thermalComfort` — operational definition.** Schema has
   `'mixed'` but nothing in the code classifies anything as mixed. For
   the proxy rule in `backfill.md` and for user guidance in the morning
   log: is "mixed" = (≥1 hot wake AND ≥1 cold wake in the same night)?
   Should mixed nights be excluded from recommender neighbor voting,
   used as negative examples, or just labeled and surfaced?

6. **Tests.** The existing codebase runs `vitest` and has 170 tests.
   Should each workstream ship unit tests? Recommendation: yes — at
   minimum `nightDistance`, `logToInputs`, and the derivation helpers.
   Individual specs call this out but don't prescribe coverage
   percentages.

7. **`plannedAcCurve` with value `'off'` in the tonight form.** Today
   the dropdown includes `'off'`, and the recommender treats `'off'` ≠
   `'off'` matches as a match. Under the new AC-curve conditional
   (both must be non-`off`), a user who selects `'off'` intentionally
   will get *no* AC-curve distance contribution. Is that the right
   semantic — "AC off is the baseline and not a discriminating
   feature" — or should `'off'` vs a running curve add distance? Flag
   for UX review.

## Not in scope

The following came up in the analysis but are deliberately out of scope
here:

- `skinTempRange` parsing (currently a string) — revisit at n≥25.
- `minHeartRate` as a recommender feature — revisit at n≥25.
- Per-clothing / per-bedding "warmth rating" (thermal insulation score)
  — a bigger UX change; file its own spec when ready.
- Pre-committed "tonight's plan" log distinct from the evening log's
  final stack — same note.

## Files touched

See each workstream spec. Hotspots:

- `src/services/recommender.ts` (distance, derivations, fallback)
- `src/pages/morning/MorningLog.tsx` (thermalComfort prominence, wake
  flags)
- `src/pages/tonight/EveningLog.tsx` (AC gating, lastMealTime required)
- `src/pages/tonight/TonightPlan.tsx` (new inputs, pressure display,
  fallback rendering)
- `src/services/importers.ts` (dedupe on import)
- `src/db.ts` (v9 migration for provenance field if added)
- `src/types.ts` (new fields on `RecommenderInputs`, optional
  `thermalComfortSource`)
