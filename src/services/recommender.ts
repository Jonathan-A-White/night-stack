import type {
  NightLog,
  AcCurveProfile,
  ClothingItem,
  BeddingItem,
  ThermalComfort,
} from '../types';
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
  /** Today's evening food flags that matter for thermal load. */
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

export function logToInputs(log: NightLog): RecommenderInputs {
  const flagsOn = (type: string) =>
    log.eveningIntake.flags.some((f) => f.type === type && f.active);
  const overnightLowF = log.environment.externalWeather
    ? getOvernightLow(log.environment.externalWeather)
    : null;
  return {
    overnightLowF,
    startingRoomTempF: log.environment.roomTempF,
    ateLate: flagsOn('late_meal'),
    overate: flagsOn('overate'),
    highSalt: flagsOn('high_salt'),
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
  // Q3 decision (recommender-v2/questions.md): proxy-derived labels
  // (thermalComfortSource === 'proxy') vote equally with user-entered labels
  // here. If the user's own labels start disagreeing with proxy labels,
  // revisit and add a weighting factor (e.g. proxy × 0.5 + user × 1.0) to
  // the neighbor-support calculation below.
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
