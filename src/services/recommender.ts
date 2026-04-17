import type {
  NightLog,
  AcCurveProfile,
  ClothingItem,
  BeddingItem,
  ThermalComfort,
} from '../types';
import { findNearestRoomReading } from '../utils';
import { getOvernightLow } from './weather';

/**
 * The inputs the user (approximately) can't change by bedtime: forecast low,
 * current room temp, what they ate. The recommender finds past nights that
 * looked like this and surfaces the controllable choices (layers, blankets,
 * AC profile, fan speed) from the nights that ended with thermalComfort =
 * "just_right".
 *
 * Small-n friendly: no training, pure nearest-neighbor retrieval. With ~10
 * past nights, a regression would overfit; ranking + voting is more honest.
 */
export interface RecommenderInputs {
  /** Forecast overnight low in °F. Null when weather isn't available. */
  overnightLowF: number | null;
  /** Starting room temp at bedtime, °F. Null when not measured. */
  startingRoomTempF: number | null;
  /**
   * Room humidity (%) at bedtime, 0–100. Null when not measured. Added in
   * recommender v2 (AUC 0.800 in the 2026-04-17 analysis — higher signal
   * than any of the dropped binary food flags).
   */
  roomHumidity: number | null;
  /**
   * Continuous replacement for the binary `ateLate` flag — hours between
   * the last meal and the bedtime anchor. See
   * `specs/recommender-v2/derived-features.md` T1.
   */
  hoursSinceLastMeal: number | null;
  /**
   * °F/hour drift of the room temp between ~01:00 and ~04:00 local. Derived
   * from `roomTimeline`. Negative = cooling; positive = warming. See
   * `specs/recommender-v2/derived-features.md` T2. EXPLORATORY.
   */
  coolingRate1to4F: number | null;
  /**
   * DEPRECATED binary food flags — dropped from `logToInputs` in
   * derived-features T4 (always false now). The interface still lists
   * them so downstream callers (TonightPlan) compile until
   * `distance-function.md` T1 lands the interface reshape.
   */
  ateLate: boolean;
  overate: boolean;
  highSalt: boolean;
  /** Alcohol consumed this evening. */
  alcohol: boolean;
  /** Planned AC curve + setpoint for tonight. Null = undecided. */
  plannedAcCurve: AcCurveProfile | null;
  plannedAcSetpointF: number | null;
}

export interface RecommendationItem {
  /** Category the item belongs in. */
  category: 'clothing' | 'bedding' | 'ac' | 'fan';
  /** Human label (item name, or description for ac/fan). */
  label: string;
  /**
   * Fraction of "just_right" neighbors that used this item. For ac/fan this
   * is the fraction that chose this category value.
   */
  support: number;
  /** How many neighbors this support is drawn from. */
  n: number;
}

export interface ScoredNight {
  log: NightLog;
  distance: number;
  comfort: ThermalComfort | null;
}

export interface Recommendation {
  /** Neighbors considered, closest first. */
  neighbors: ScoredNight[];
  /** The subset that ended in "just_right" (what we learn from). */
  goodNeighbors: ScoredNight[];
  /** The subset that ended in "too_hot" / "too_cold" / "mixed" (what to avoid). */
  badNeighbors: ScoredNight[];
  /** Consensus recommendations, sorted by support × category priority. */
  items: RecommendationItem[];
  /** A one-line summary of what the good neighbors tended to do. */
  summary: string;
  /**
   * If the bad neighbors lean strongly one way, a targeted warning — e.g.
   * "3 of 4 similar nights ended too hot; drop a blanket." Empty string if
   * no clear pattern.
   */
  warning: string;
  /** Count of total past nights with a thermalComfort label. */
  totalLabeledNights: number;
}

const K_NEIGHBORS = 5;

/**
 * Weighted L1 distance. Weights come from how directly each input drives
 * thermal comfort: room temp and forecast low dominate, food flags nudge.
 */
export function nightDistance(a: RecommenderInputs, b: RecommenderInputs): number {
  let d = 0;
  let totalWeight = 0;

  function addDim(av: number | null, bv: number | null, weight: number, scale: number) {
    totalWeight += weight;
    if (av == null || bv == null) {
      // Missing dimension gets half-penalty so logs with missing data aren't
      // free-matched but also aren't ruled out.
      d += weight * 0.5;
      return;
    }
    d += (weight * Math.abs(av - bv)) / scale;
  }

  addDim(a.overnightLowF, b.overnightLowF, 3, 15); // 15°F = "very different"
  addDim(a.startingRoomTempF, b.startingRoomTempF, 3, 5);
  addDim(a.plannedAcSetpointF, b.plannedAcSetpointF, 1, 5);

  // Boolean flags — distance 0 or 1.
  function addBool(av: boolean, bv: boolean, weight: number) {
    totalWeight += weight;
    if (av !== bv) d += weight;
  }
  addBool(a.ateLate, b.ateLate, 1);
  addBool(a.overate, b.overate, 1);
  addBool(a.highSalt, b.highSalt, 0.5);
  addBool(a.alcohol, b.alcohol, 1);

  // AC curve profile — 0 if same, 1 if different, skipped if either side null.
  totalWeight += 1.5;
  if (a.plannedAcCurve && b.plannedAcCurve) {
    if (a.plannedAcCurve !== b.plannedAcCurve) d += 1.5;
  } else {
    d += 0.75;
  }

  return d / totalWeight;
}

/**
 * Combine a "YYYY-MM-DD" evening date and a "HH:MM" local time into an
 * epoch ms anchor. If the HH:MM is before noon, the anchor lands on the
 * day *after* the evening date (the meal/bedtime happened across midnight
 * into the morning). Returns null for malformed inputs.
 */
function anchorMsFromDateAndTime(dateStr: string, hhmm: string): number | null {
  if (!dateStr || !hhmm) return null;
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!dateMatch || !timeMatch) return null;
  const [, y, mo, d] = dateMatch;
  const [, hh, mm] = timeMatch;
  const hours = Number(hh);
  const minutes = Number(mm);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  // Midnight rule: HH:MM before 12:00 means the *next* local calendar day.
  const dayOffset = hours < 12 ? 1 : 0;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d) + dayOffset, hours, minutes);
  const ms = dt.getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Pick the bedtime anchor in ms for a night log. Precedence:
 *   1. `loggedBedtime` (epoch ms, when the user finalized the evening log)
 *   2. `alarm.targetBedtime` combined with `log.date` (planned bedtime)
 *   3. `sleepData.sleepTime` combined with `log.date` (watch-detected onset)
 *
 * Known error bound (±45 min): `loggedBedtime` is the moment the evening log
 * was saved, which can precede actual lights-out. `targetBedtime` is a plan.
 * `sleepData.sleepTime` is the watch's estimate. None is exact — they're all
 * within ~45 minutes of real bedtime for this user, which is fine for the
 * hours-since-meal derivation (a coarse bucket).
 */
function pickBedtimeAnchorMs(log: NightLog): number | null {
  if (log.loggedBedtime != null) return log.loggedBedtime;
  const fromTarget = anchorMsFromDateAndTime(log.date, log.alarm?.targetBedtime ?? '');
  if (fromTarget != null) return fromTarget;
  const sleepTime = log.sleepData?.sleepTime ?? '';
  return anchorMsFromDateAndTime(log.date, sleepTime);
}

/**
 * Hours between the evening's last meal and the bedtime anchor, as a
 * continuous feature replacing the binary `ateLate` flag (see
 * `specs/recommender-v2/derived-features.md` T1, AUC 0.75 vs 0.50 for the
 * binary). Returns null when either side is missing or when the computed
 * value falls outside `[0, 12]` (sanity bound — negatives or absurd gaps
 * indicate malformed / cross-day-mismatched data).
 */
export function computeHoursSinceLastMeal(log: NightLog): number | null {
  const bedtimeMs = pickBedtimeAnchorMs(log);
  const lastMealMs = anchorMsFromDateAndTime(log.date, log.eveningIntake?.lastMealTime ?? '');
  if (bedtimeMs == null || lastMealMs == null) return null;
  const hours = (bedtimeMs - lastMealMs) / 3_600_000;
  if (!Number.isFinite(hours)) return null;
  if (hours < 0 || hours > 12) return null;
  return hours;
}

/**
 * Cooling rate (°F per hour) from a ~01:00 reading to a ~04:00 reading on
 * the `roomTimeline`. Negative = room cooling; positive = room warming.
 *
 * EXPLORATORY FEATURE: the analysis found this to have AUC 1.0 for
 * separating too_hot vs too_cold, but that was computed against n_cold = 1.
 * Expect to re-weight / re-tune this once more labels accumulate. See
 * `specs/recommender-v2/derived-features.md` T2.
 *
 * Fixed window 01:00–04:00: chosen because hot wakes cluster at 03:00–03:45
 * in the observed data. Revisit if the feature drops in ranked importance.
 *
 * Guards:
 * - Returns null when `roomTimeline` is null or has fewer than two readings
 *   in the 00:00–06:00 window.
 * - Requires the chosen t1 reading to fall in [00:30, 02:00] local time so
 *   `findNearestRoomReading`'s modular-distance quirk doesn't pick a 23:00
 *   reading for a 01:00 target.
 * - Requires the chosen t4 reading to fall in [03:00, 05:00].
 * - Requires the wall-clock gap between t1 and t4 to be ≥ 2 hours; rejects
 *   sparse timelines.
 * - Rejects the degenerate case where `findNearestRoomReading` returns the
 *   same reading for both targets.
 */
export function computeCoolingRate1to4F(log: NightLog): number | null {
  const timeline = log.roomTimeline;
  if (timeline == null) return null;

  // Require at least two readings in the 00:00–06:00 early-morning window.
  const inEarlyWindow = timeline.filter((r) => {
    const d = new Date(r.timestamp);
    const min = d.getHours() * 60 + d.getMinutes();
    return min >= 0 && min < 6 * 60;
  });
  if (inEarlyWindow.length < 2) return null;

  const t1 = findNearestRoomReading('01:00', timeline);
  const t4 = findNearestRoomReading('04:00', timeline);
  if (!t1 || !t4) return null;
  if (t1 === t4) return null;

  const t1Date = new Date(t1.timestamp);
  const t4Date = new Date(t4.timestamp);
  const t1Min = t1Date.getHours() * 60 + t1Date.getMinutes();
  const t4Min = t4Date.getHours() * 60 + t4Date.getMinutes();

  // Tighten the selector: t1 must be in [00:30, 02:00], t4 in [03:00, 05:00].
  if (t1Min < 30 || t1Min > 2 * 60) return null;
  if (t4Min < 3 * 60 || t4Min > 5 * 60) return null;

  const hoursBetween = (t4Date.getTime() - t1Date.getTime()) / 3_600_000;
  if (!Number.isFinite(hoursBetween) || hoursBetween < 2) return null;

  return (t4.tempF - t1.tempF) / hoursBetween;
}

export function logToInputs(log: NightLog): RecommenderInputs {
  const overnightLowF = log.environment.externalWeather
    ? getOvernightLow(log.environment.externalWeather)
    : null;
  return {
    overnightLowF,
    startingRoomTempF: log.environment.roomTempF,
    roomHumidity: log.environment.roomHumidity,
    hoursSinceLastMeal: computeHoursSinceLastMeal(log),
    coolingRate1to4F: computeCoolingRate1to4F(log),
    // Keep the three binary food flags in the output (hardcoded false) to
    // avoid breaking the build until `distance-function.md` T1 reshapes
    // `RecommenderInputs`. The underlying derivations are dropped now —
    // the flags no longer contribute any signal regardless of log state.
    ateLate: false,
    overate: false,
    highSalt: false,
    alcohol: log.eveningIntake.alcohol != null,
    plannedAcCurve: log.environment.acCurveProfile,
    plannedAcSetpointF: log.environment.acSetpointF,
  };
}

const AC_CURVE_LABEL: Record<AcCurveProfile, string> = {
  off: 'AC off',
  steady: 'Steady setpoint',
  cool_early: 'Cool early (warmer by morning)',
  hold_cold: 'Hold cold all night',
  warm_late: 'Warm early, cold late',
  custom: 'Custom curve',
};

const FAN_LABEL = {
  off: 'Fan off',
  low: 'Fan low',
  medium: 'Fan medium',
  high: 'Fan high',
  auto: 'Fan auto',
};

/**
 * Given tonight's inputs and past night logs, return the top-K nearest
 * neighbors and a consensus prescription drawn from the "just_right" subset.
 */
export function recommendForTonight(
  inputs: RecommenderInputs,
  pastLogs: readonly NightLog[],
  clothingItems: readonly ClothingItem[],
  beddingItems: readonly BeddingItem[],
): Recommendation {
  const labeled = pastLogs.filter((l) => l.thermalComfort != null);
  const scored: ScoredNight[] = labeled
    .map((log) => ({
      log,
      distance: nightDistance(inputs, logToInputs(log)),
      comfort: log.thermalComfort,
    }))
    .sort((a, b) => a.distance - b.distance);

  const neighbors = scored.slice(0, K_NEIGHBORS);
  const goodNeighbors = neighbors.filter((n) => n.comfort === 'just_right');
  const badNeighbors = neighbors.filter(
    (n) => n.comfort === 'too_hot' || n.comfort === 'too_cold',
  );

  const clothingById = new Map(clothingItems.map((c) => [c.id, c.name]));
  const beddingById = new Map(beddingItems.map((b) => [b.id, b.name]));

  const items: RecommendationItem[] = [];

  if (goodNeighbors.length > 0) {
    // Vote across clothing items used by just_right neighbors.
    const clothingCounts = new Map<string, number>();
    const beddingCounts = new Map<string, number>();
    const acCurveCounts = new Map<AcCurveProfile, number>();
    const fanCounts = new Map<string, number>();

    for (const n of goodNeighbors) {
      for (const c of n.log.clothing) {
        clothingCounts.set(c, (clothingCounts.get(c) ?? 0) + 1);
      }
      for (const b of n.log.bedding) {
        beddingCounts.set(b, (beddingCounts.get(b) ?? 0) + 1);
      }
      acCurveCounts.set(
        n.log.environment.acCurveProfile,
        (acCurveCounts.get(n.log.environment.acCurveProfile) ?? 0) + 1,
      );
      fanCounts.set(
        n.log.environment.fanSpeed,
        (fanCounts.get(n.log.environment.fanSpeed) ?? 0) + 1,
      );
    }

    const n = goodNeighbors.length;
    for (const [id, count] of clothingCounts) {
      const name = clothingById.get(id);
      if (!name) continue;
      items.push({ category: 'clothing', label: name, support: count / n, n });
    }
    for (const [id, count] of beddingCounts) {
      const name = beddingById.get(id);
      if (!name) continue;
      items.push({ category: 'bedding', label: name, support: count / n, n });
    }
    // AC + fan: surface the plurality winner when it's at least a majority.
    const topAc = [...acCurveCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topAc && topAc[1] / n >= 0.5) {
      const [curve, count] = topAc;
      items.push({
        category: 'ac',
        label: AC_CURVE_LABEL[curve],
        support: count / n,
        n,
      });
    }
    const topFan = [...fanCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topFan && topFan[1] / n >= 0.5) {
      const [fan, count] = topFan;
      items.push({
        category: 'fan',
        label: FAN_LABEL[fan as keyof typeof FAN_LABEL] ?? fan,
        support: count / n,
        n,
      });
    }

    // Rank: higher support first, then clothing/bedding before ac/fan so the
    // most concrete items show first.
    const catOrder: Record<RecommendationItem['category'], number> = {
      clothing: 0,
      bedding: 1,
      ac: 2,
      fan: 3,
    };
    items.sort((a, b) => {
      if (Math.abs(a.support - b.support) > 0.01) return b.support - a.support;
      return catOrder[a.category] - catOrder[b.category];
    });
  }

  const summary = buildSummary(goodNeighbors, badNeighbors, neighbors);
  const warning = buildWarning(badNeighbors, neighbors.length);

  return {
    neighbors,
    goodNeighbors,
    badNeighbors,
    items,
    summary,
    warning,
    totalLabeledNights: labeled.length,
  };
}

function buildSummary(
  good: ScoredNight[],
  _bad: ScoredNight[],
  all: ScoredNight[],
): string {
  if (all.length === 0) {
    return 'No past nights tagged yet — start labeling mornings with "too hot / too cold / just right" to seed recommendations.';
  }
  if (good.length === 0) {
    return `None of the ${all.length} most-similar past nights ended in "just right" — inputs this similar have historically gone sideways. Experiment cautiously.`;
  }
  return `${good.length} of the ${all.length} most-similar past nights ended "just right". The stack below is what those nights had in common.`;
}

function buildWarning(bad: ScoredNight[], neighborCount: number): string {
  if (neighborCount === 0) return '';
  const tooHot = bad.filter((n) => n.comfort === 'too_hot').length;
  const tooCold = bad.filter((n) => n.comfort === 'too_cold').length;
  const total = neighborCount;
  if (tooHot / total >= 0.5) {
    return `${tooHot} of ${total} similar past nights ended too hot. Lean toward fewer layers / lighter bedding / colder AC setpoint than your gut says.`;
  }
  if (tooCold / total >= 0.5) {
    return `${tooCold} of ${total} similar past nights ended too cold. Add a blanket you can kick off rather than heavier layers.`;
  }
  return '';
}
