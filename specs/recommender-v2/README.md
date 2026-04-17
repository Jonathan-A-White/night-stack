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
| `questions.md` | Cross-cutting open questions (Q1–Q10). Read first. | — |
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

Resolved separately in **`questions.md`** (Q1–Q10) to keep this file
focused on orchestration. Read `questions.md` before starting any
workstream — most of its questions have defaults documented, but a
few (Q1, Q2, Q7) should be answered by the user before agents begin.

Per-workstream "Known unknowns" sections remain inside each spec file
for questions scoped to a single workstream.

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
