import type { NightLog, ThermalComfort, WakeUpCause } from '../types';

/**
 * Proxy-derive a thermalComfort label for a historical NightLog from its
 * wake-cause IDs and sleep score. Lets the recommender have ground-truth
 * labels on day one instead of waiting weeks for the user to morning-log
 * every past night.
 *
 * Rules (from recommender-tuning-2026-04-17.md §a, Q5 decision is option a
 * — "≥1 hot wake AND ≥1 cold wake in the same night" counts as mixed):
 *
 *   hot-wake cause (Sweating / Heart racing)  OR wasSweating  → 'too_hot'
 *   cold-wake cause (Too cold)                OR feltCold     → 'too_cold'
 *   both                                                      → 'mixed'
 *   only non-thermal causes (Bathroom / Noise / Pain / etc.)
 *     AND sleepScore >= AMBIGUITY_THRESHOLD                   → 'just_right'
 *   else                                                      → null (ambiguous)
 *
 * Ambiguity threshold: held at 60 per `backfill.md` "Known unknowns" option
 * (a). Revisit if >20% of just_right proposals feel wrong to the user.
 *
 * The classifier is deliberately a pure function so it's trivially
 * unit-testable and can be re-run from the backfill review UI without
 * side effects.
 */

export const AMBIGUITY_THRESHOLD = 60;

/**
 * Wake-cause labels that indicate a hot wake. Matched case-insensitively
 * against `WakeUpCause.label` — the IDs are random UUIDs so we can't bake
 * them in as constants. If the user renames a cause, update this list.
 */
const HOT_CAUSE_LABELS = ['Sweating / too hot', 'Heart racing / palpitations'];

/** Wake-cause labels that indicate a cold wake. */
const COLD_CAUSE_LABELS = ['Too cold'];

/**
 * Resolve the "hot" and "cold" cause-ID sets from the user's WakeUpCause
 * table. Matching is case-insensitive on `label`. Causes the user has
 * renamed won't match — that's acceptable; the classifier will just not
 * fire on those rows and the review UI will show "ambiguous".
 */
export function resolveThermalCauseIds(
  causes: readonly WakeUpCause[],
): { hot: Set<string>; cold: Set<string> } {
  const hot = new Set<string>();
  const cold = new Set<string>();
  const hotLower = new Set(HOT_CAUSE_LABELS.map((l) => l.toLowerCase()));
  const coldLower = new Set(COLD_CAUSE_LABELS.map((l) => l.toLowerCase()));
  for (const cause of causes) {
    const key = cause.label.toLowerCase();
    if (hotLower.has(key)) hot.add(cause.id);
    else if (coldLower.has(key)) cold.add(cause.id);
  }
  return { hot, cold };
}

/**
 * Classify a single NightLog's thermal comfort from its wake events and
 * sleep score. Returns `null` when the data is ambiguous — the review UI
 * shows these rows as "—" so the user can pick a label or dismiss.
 *
 * The `wasSweating` / `feltCold` per-wake flags are consulted (T5 rule)
 * but the April 2026 export showed them always false, so in practice the
 * cause-ID path does all the work today. Once `logging-fixes.md` T2
 * starts capturing those flags in the UI, they'll start firing here too.
 * TODO(flags): keep this hook in sync with the flag-capture UI.
 */
export function classifyThermalComfortFromWakes(
  log: NightLog,
  hotCauseIds: Set<string>,
  coldCauseIds: Set<string>,
): ThermalComfort | null {
  const wakes = log.wakeUpEvents;

  // Per-night aggregates: was there any hot-signal wake, any cold-signal
  // wake? A single wake can contribute to both (rare — e.g. palpitations
  // wake marked feltCold) which still resolves to 'mixed' below.
  let anyHot = false;
  let anyCold = false;
  for (const w of wakes) {
    if (hotCauseIds.has(w.cause) || w.wasSweating || w.racingHeart) {
      anyHot = true;
    }
    if (coldCauseIds.has(w.cause) || w.feltCold) {
      anyCold = true;
    }
  }

  if (anyHot && anyCold) return 'mixed';
  if (anyHot) return 'too_hot';
  if (anyCold) return 'too_cold';

  // No thermal-signal wakes. If the sleep score cleared the ambiguity
  // threshold, the night is probably just_right. Otherwise we bail out —
  // a low-score night with only "Bathroom" wakes could still be thermally
  // rough in ways we can't detect from causes alone.
  const score = log.sleepData?.sleepScore;
  if (score != null && score >= AMBIGUITY_THRESHOLD) {
    return 'just_right';
  }

  return null;
}
