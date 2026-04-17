# Sleep recommender tuning — evidence-first report

n=11 nights (2026-04-06 → 2026-04-16). Analysis in `/home/user/analyze.mjs` against `/home/user/nightstack-export.json`. All numbers below come from the script.

---

## a) Proxy label coverage + failure-mode separation

### Proxy rule (from `wakeUpEvents[].cause` + `wasSweating/feltCold/racingHeart`)
- hot-wake cause OR wasSweating → **too_hot**
- cold-wake cause OR feltCold → **too_cold**
- both → **mixed**
- only non-thermal causes (Bathroom/Noise/Bed-too-late) + sleepScore ≥ 60 → **just_right**
- else → ambiguous

The per-wake flags (`wasSweating/feltCold/racingHeart`) **never fire in the dataset** (0/18 wakes). The proxy falls back to `cause` entirely.

### Coverage

| label | n | nights |
|---|---|---|
| too_hot | 5 | 4/9, 4/10, 4/14, 4/15, 4/16 |
| too_cold | 3 | 4/6, 4/8, 4/12 |
| just_right | **0** | — |
| mixed | 0 | — |
| ambiguous | 3 | 4/7 (Unknown+Bathroom), 4/11 (Bed-too-late ×2, score 44), 4/13 (Unknown, no sleep data) |

**8/11 nights label confidently. The critical gap is zero `just_right` nights.** The current recommender has no positive exemplars to vote from, so `recommendForTonight` returns `items: []` on every call right now.

### Failure-mode separation — wake time

| proxy | wake times |
|---|---|
| too_hot (n=5) | 03:10, 03:18, 03:36, 03:36, 03:45 — **median 03:36, all in 03:10–03:45** |
| too_cold (n=3, 8 wakes) | 23:15, 00:10, 00:40, 01:00, 02:00, 03:15, 04:30, 23:15 — mostly **pre-02:00**, plus one 04:30 |

Hot pattern matches the "~3am sweating" hypothesis perfectly. Cold pattern is **earlier than the "~2am" hypothesis** — cold wakes cluster at 23:15–01:00 and then fragment forward. The fragmentation part is real (4/12 had 5 wakes starting at 23:15 and trailing to 03:15). The initial-wake timing should be described as "first hours after bedtime," not 2am.

### Separation by room temp / weather

| metric | too_cold median | too_hot median | separation |
|---|---|---|---|
| startingRoomTempF | 65 | 77 | AUC 0.867 |
| weatherLow | 28.6 | 61.2 | **AUC 0.933** |
| forecastLow − startingRoom ("pressure") | −33 | −17 | AUC 0.867 |
| roomHumidity | ~44 | 52 | AUC 0.800 (n_cold=2) |
| cooling rate 1→4am (°F/h) | −0.5 (1 night) | ~0 | AUC 1.0 but n_cold=1 |
| minHR | 40 (n=1) | 40 (n=3) | AUC 0.667, effectively unpowered |
| sleepScore | 76 | 83 | AUC 0.600 |

**The two failure modes ARE separable** — primarily by starting room temp and forecast low. They do NOT separate on minHR at this sample size (both cluster at 40 bpm; the only cold night with an HR reading matches the hot nights' floor). So:
- The app's built-in "minHR is a hot-signal" assumption is not supported yet.
- The hot-wake-temperature pattern is clear: at 3am the room is 64.9 / 68.5 / 77.5 / 82.4 / 82.4 °F — the bottom-three were the user's own over-bedding, not hot weather.

### Noise in the labeled set to flag
- **4/15 and 4/16 share identical sleepData** (score 93, 422 min, same skinTempRange, same 03:36 wake). Both roomTimelines are timestamped 2026-04-17. The 4/15 log's timeline was overwritten at export time (first `tF` sample is on 04-17 01:00, not 04-16 01:00). Treat 4/16 as the real record; 4/15 sleep/timeline is stale. This duplicate inflates too_hot n by 1.

---

## b) Ranked list of features to add or re-weight

Ranking is AUC on too_hot vs too_cold, n=5 vs n=3. With this n, treat AUC as rank-order, not probability.

### Features the recommender currently uses

| feature | current weight | AUC | verdict |
|---|---|---|---|
| startingRoomTempF | 3 | 0.867 | **keep, maybe raise** |
| overnightLowF | 3 | 0.933 | **keep** (top signal) |
| plannedAcSetpointF | 1 | n/a — 0 variance (all null) | **drop until AC logged** |
| plannedAcCurve | 1.5 | n/a — 0 variance (all 'off') | **drop until AC logged** |
| ateLate (binary) | 1 | 0.500 | **replace with continuous** |
| overate (binary) | 1 | 0.500 (1 night only) | **drop/park** |
| highSalt (binary) | 0.5 | 0.500 (0 nights) | **drop/park** |
| alcohol (binary) | 1 | 0.500 (0 nights) | **drop/park** |

Today ~35% of the distance weight (`acCurve 1.5 + setpoint 1 + overate 1 + highSalt 0.5 + alcohol 1 = 5 out of ~14`) is spent on dimensions with zero variance or zero signal. That's the biggest fixable thing.

### Features to add (in priority order)

1. **`hoursBetweenMealAndBed`** (continuous, replaces `ateLate` binary) — AUC 0.750 vs 0.500 for the binary. Derive from `eveningIntake.lastMealTime` and `alarm.targetBedtime`. Scale ~3 hours.
2. **`roomHumidity`** — AUC 0.800. Already logged on 10/11 nights. Scale ~10 pp.
3. **`cooling_rate_1_4am`** (°F/hour from `roomTimeline`, clocks 01:00 and 04:00) — AUC 1.0 with n_cold=1, so still speculative but cheap to add. A negative cooling rate below ~−0.3°F/h reliably accompanied both hot-clustering patterns here, and the flat (~0°F/h) trajectory on 4/10 / 4/14 is exactly when over-bedding trapped heat.
4. **`pressure = weatherLow − startingRoom`** — AUC 0.867, but redundant with the two inputs it combines; only add if we also decide to *drop one* of them for parsimony. Not recommended as an additional dim; instead use it for UI surfacing, e.g. "tonight cools 25°F below your starting room."

### Features that don't earn their keep yet
- `minHeartRate` — only 5/11 nights have it; AUC 0.667 with n_hot=3, n_cold=1. Re-evaluate at n=25.
- `sleepScore` — AUC 0.600, and it's downstream of comfort (post-hoc). Don't use as input.
- `skinTempRange` — parsed as a string today, not trivially comparable. Park.
- `avgHeartRate` — AUC 0.467 (noise).
- `overate` / `alcohol` / `highSalt` — zero variance in this dataset. Leave the schema, don't weight.

### Forecast-low → starting-room estimator

Linear fit `startingRoom ≈ 0.436 × weatherLow + 49.91`, R² = 0.831, residuals ±0.3–6.4°F (one +6.4°F outlier on 4/7). Useful as a **default prefill** when `startingRoomTempF` is null, with a visible ±3°F hint; not good enough to make the room-temp input optional. Recommend keeping `startingRoomTempF` required and using the fit only to prefill the UI control.

---

## c) Specific edits to `src/services/recommender.ts`

Recommended `RecommenderInputs` shape change:

```ts
export interface RecommenderInputs {
  overnightLowF: number | null;
  startingRoomTempF: number | null;
  roomHumidity: number | null;            // NEW
  hoursSinceLastMeal: number | null;      // NEW (replaces ateLate)
  coolingRate1to4F: number | null;        // NEW (derived from roomTimeline)
  alcohol: boolean;                       // keep (zero variance today, but cheap)
  plannedAcCurve: AcCurveProfile | null;
  plannedAcSetpointF: number | null;
}
```

- Drop `ateLate`, `overate`, `highSalt` from the inputs/distance. They pull weight with no signal at this n.
- Keep `alcohol` as a single food-side flag (cheap, will matter once logged).

Inside `nightDistance` (`src/services/recommender.ts:91`):

```ts
addDim(a.overnightLowF,        b.overnightLowF,        3, 15);
addDim(a.startingRoomTempF,    b.startingRoomTempF,    4, 5);   // was 3; top non-weather signal
addDim(a.roomHumidity,         b.roomHumidity,         1, 10);  // NEW
addDim(a.hoursSinceLastMeal,   b.hoursSinceLastMeal,   1, 3);   // NEW; replaces addBool(ateLate)
addDim(a.coolingRate1to4F,     b.coolingRate1to4F,     1, 0.6); // NEW; treat >60% of a °F/h diff as "very different"
addDim(a.plannedAcSetpointF,   b.plannedAcSetpointF,   1, 5);   // keep

addBool(a.alcohol, b.alcohol, 0.5);                              // was 1
// remove addBool(ateLate), addBool(overate), addBool(highSalt)

// acCurve block: only count it when BOTH sides are non-'off'; current "half
// penalty when either is null" pays for nothing because acCurve is 'off' on
// every past night, so the penalty is a fixed constant in every comparison.
if (a.plannedAcCurve && b.plannedAcCurve && a.plannedAcCurve !== 'off' && b.plannedAcCurve !== 'off') {
  totalWeight += 1.5;
  if (a.plannedAcCurve !== b.plannedAcCurve) d += 1.5;
}
```

In `logToInputs` (`src/services/recommender.ts:125`):
- Derive `hoursSinceLastMeal` from `log.eveningIntake.lastMealTime` and `log.alarm.targetBedtime` (or `loggedBedtime`, falling back to `sleepData.sleepTime`). Return null if either side missing.
- Derive `coolingRate1to4F` by picking the two `roomTimeline` entries nearest 01:00 and 04:00 (skip if window is <2h or either point is missing).
- Pull `roomHumidity` directly.

Handling the empty-`just_right` set (`recommendForTonight`, `src/services/recommender.ts:168`):
- Current `buildSummary` already handles `good.length === 0` correctly. Good.
- But `items` stays empty, which leaves the UI silent. Add a *conservative* fallback: when there are no `just_right` neighbors but the bad neighbors lean strongly one way (e.g. ≥60% too_hot among top-K), surface the stack from the *least-bad* neighbor as an "opposite-of-failure" starting point, flagged as exploratory. Don't claim consensus.

Keep the distance weights under `totalWeight` normalization as today; the change is in which dims enter the sum.

---

## d) Logging-gap punch list for the UI

Sorted by impact on the recommender.

1. **`thermalComfort` is unset on 11/11 nights.** The recommender's *entire* ground truth is missing. Morning UI needs to make this one tap. Without it, the recommender cannot return `items` regardless of how the distance function is tuned.
2. **`wasSweating` / `feltCold` / `racingHeart` never set (0/18 wakes).** Either the wake form doesn't expose the checkboxes, or they default off and aren't surfaced. The cause dropdown is currently doing 100% of the thermal signal; these per-wake flags are dead fields.
3. **AC fields are always `off` / `null`.** `acCurveProfile`, `acSetpointF`, `fanSpeed` all zero variance → they contribute nothing to distance. Either the user isn't using AC in this April window and the recommender should gracefully skip, or the form isn't wired up on the evening entry.
4. **`loggedBedtime` is null on every row** (confirmed by schema migration comment) and `alarm.targetBedtime` is the only bedtime anchor available. `hoursSinceLastMeal` depends on having *some* trustworthy bedtime — prioritize capturing `loggedBedtime` on finalize.
5. **`lastMealTime` missing on 3/11 nights** (4/12, 4/13, 4/14 — two of which are thermal nights). Blocks the best food-side signal. Either make the field required, or prefill from `alarm.eatingCutoff` with an edit.
6. **`roomTimeline` missing on 3/11 nights** (all three earliest logs). Blocks cooling-rate and room-at-wake features. Also: **4/15's roomTimeline was overwritten with the export-day timestamps** (first sample on 2026-04-17, not 2026-04-16) and the sleepData for 4/15 and 4/16 are byte-identical. Investigate whether the "current-day sensor snapshot" is being written to the most recent log on each edit; timeline writes need to key on the log's date range, not "now."
7. **Wakes with blank cause: 4/18** (all on 4/12, 5-wake fragmented night). Either auto-require a cause on each wake or default the blank entries to "Unknown" so the proxy classifier doesn't have to choose between blank and `null`.
8. **`minHeartRate` missing on 6/11 nights** — it's an import-dependent field, so this is a bar-height problem with the watch import. If the import can populate it retroactively, do so; otherwise stop promising features that lean on it.
9. **`roomHumidity` missing on 1/11 nights** (4/8). Minor.
10. **Duplicate-record risk (4/15 ≡ 4/16).** Before any training-style work lands, add a dedupe check on sleepData import: if the new sleepTime/wakeTime + sleepScore match an existing log within 24h, flag it.

---

**Net takeaway:** The two failure modes are real and clearly separable by `startingRoomTempF` and `weatherLow` (AUC 0.87 / 0.93). The recommender's biggest defect isn't its distance function — it's that there are no `just_right` labels to vote from and ~35% of distance weight is spent on zero-variance or zero-signal dimensions. Fix logging first (thermalComfort + wake flags + AC), then trim the distance function to `{overnightLow, startingRoom, humidity, hoursSinceLastMeal, cooling_1_4am}`.
