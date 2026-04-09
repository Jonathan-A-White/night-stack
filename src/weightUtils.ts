import type { Sex, UnitSystem, WeightEntry } from './types';

// === Conversions ===

const LBS_PER_KG = 2.2046226218;
const CM_PER_INCH = 2.54;

export function lbsToKg(lbs: number): number {
  return lbs / LBS_PER_KG;
}

export function kgToLbs(kg: number): number {
  return kg * LBS_PER_KG;
}

export function inchesToCm(inches: number): number {
  return inches * CM_PER_INCH;
}

export function cmToInches(cm: number): number {
  return cm / CM_PER_INCH;
}

// === Formatting ===

/**
 * Format a weight value (stored as lbs) for display.
 * US: "165.4 lb"
 * Metric: "75.0 kg"
 */
export function formatWeight(weightLbs: number, unitSystem: UnitSystem): string {
  if (unitSystem === 'metric') {
    return `${lbsToKg(weightLbs).toFixed(1)} kg`;
  }
  return `${weightLbs.toFixed(1)} lb`;
}

/**
 * Format a height (stored as inches) for display.
 * US: 5'10"
 * Metric: 178 cm
 */
export function formatHeight(heightInches: number, unitSystem: UnitSystem): string {
  if (unitSystem === 'metric') {
    return `${Math.round(inchesToCm(heightInches))} cm`;
  }
  const feet = Math.floor(heightInches / 12);
  const inches = Math.round(heightInches - feet * 12);
  if (inches === 12) return `${feet + 1}'0"`;
  return `${feet}'${inches}"`;
}

/**
 * Step size used by the weight stepper, in canonical lbs.
 * Metric system rounds to match ~0.1 kg visual steps.
 */
export function getWeightStepLbs(unitSystem: UnitSystem): number {
  if (unitSystem === 'metric') {
    // 0.1 kg ≈ 0.22 lb — round to 0.2 lb so metric display steps evenly by 0.1 kg
    return 0.2;
  }
  return 0.2;
}

/**
 * Round a weight value to the display precision for the given unit.
 */
export function roundWeightLbs(weightLbs: number, unitSystem: UnitSystem): number {
  if (unitSystem === 'metric') {
    // Round so the displayed kg value is at 0.1 kg resolution
    const kg = lbsToKg(weightLbs);
    const roundedKg = Math.round(kg * 10) / 10;
    return kgToLbs(roundedKg);
  }
  return Math.round(weightLbs * 10) / 10;
}

// === Ideal weight ===

/**
 * Devine formula (1974) — ideal body weight.
 * Men:   50.0 kg + 2.3 kg per inch over 5 ft
 * Women: 45.5 kg + 2.3 kg per inch over 5 ft
 *
 * Returns a value in pounds.
 */
export function calculateIdealWeightLbs(sex: Sex, heightInches: number): number {
  const inchesOver5Ft = Math.max(0, heightInches - 60);
  const baseKg = sex === 'm' ? 50 : 45.5;
  const idealKg = baseKg + 2.3 * inchesOver5Ft;
  return kgToLbs(idealKg);
}

// === Default weight for the stepper ===

export interface DefaultWeightOptions {
  previousWeightLbs?: number | null;
  startingWeightLbs?: number | null;
  sex?: Sex | null;
  heightInches?: number | null;
}

/**
 * Resolve the default weight to seed the stepper with.
 * Priority:
 *   1. Previous most recent weight entry
 *   2. Starting weight from settings
 *   3. Ideal weight (Devine) if sex + height are set
 *   4. Hardcoded fallback (150 lb — a neutral anchor)
 */
export function resolveDefaultWeightLbs(opts: DefaultWeightOptions): number {
  if (opts.previousWeightLbs != null) return opts.previousWeightLbs;
  if (opts.startingWeightLbs != null) return opts.startingWeightLbs;
  if (opts.sex && opts.heightInches != null) {
    return calculateIdealWeightLbs(opts.sex, opts.heightInches);
  }
  return 150;
}

/**
 * Parse a feet/inches pair into inches. Returns null if both are empty.
 */
export function parseFeetInchesToInches(feet: string, inches: string): number | null {
  const f = feet.trim() === '' ? 0 : parseFloat(feet);
  const i = inches.trim() === '' ? 0 : parseFloat(inches);
  if (feet.trim() === '' && inches.trim() === '') return null;
  if (isNaN(f) || isNaN(i)) return null;
  return f * 12 + i;
}

/**
 * Split inches into feet + inches components for form display.
 */
export function inchesToFeetInches(totalInches: number): { feet: number; inches: number } {
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round((totalInches - feet * 12) * 10) / 10;
  return { feet, inches };
}

// === Calculated / measured weight recalculation ===

/**
 * Linear interpolation helper for a calculated entry between two measurements.
 * If tA === tB (shouldn't happen in practice), returns wA as a guard.
 */
function interpolateWeight(tA: number, wA: number, tB: number, wB: number, t: number): number {
  if (tA === tB) return wA;
  return wA + (wB - wA) * (t - tA) / (tB - tA);
}

/**
 * Recalculate calculated (non-measured) weights around a just-added/edited
 * measurement anchor. The anchor must have `measured === true`.
 *
 * Returns a NEW array (no mutation of input). Measured entries are never
 * modified. Calculated entries between the previous measurement and anchor,
 * and between the anchor and the next measurement, are linearly interpolated
 * by timestamp. Calculated entries after the last measurement fill-forward;
 * calculated entries before the first measurement fill-backward.
 */
export function recalculateCalculatedWeights(
  entries: WeightEntry[],
  anchorId: string,
): WeightEntry[] {
  const anchor = entries.find((e) => e.id === anchorId);
  if (!anchor) {
    throw new Error(`recalculateCalculatedWeights: unknown anchorId "${anchorId}"`);
  }
  if (!anchor.measured) {
    throw new Error(
      `recalculateCalculatedWeights: anchor "${anchorId}" is not a measured entry`,
    );
  }

  // Clone shallowly so we never mutate input objects or the input array
  const sorted = entries
    .map((e) => ({ ...e }))
    .sort((a, b) => a.timestamp - b.timestamp);

  const anchorIdx = sorted.findIndex((e) => e.id === anchorId);

  // Previous measured entry strictly before the anchor
  let prevMeasured: WeightEntry | null = null;
  for (let i = anchorIdx - 1; i >= 0; i--) {
    if (sorted[i].measured) {
      prevMeasured = sorted[i];
      break;
    }
  }

  // Next measured entry strictly after the anchor
  let nextMeasured: WeightEntry | null = null;
  for (let i = anchorIdx + 1; i < sorted.length; i++) {
    if (sorted[i].measured) {
      nextMeasured = sorted[i];
      break;
    }
  }

  // First/last measured (for fill-backward/forward of edges)
  let firstMeasured: WeightEntry | null = null;
  let lastMeasured: WeightEntry | null = null;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].measured) {
      if (firstMeasured === null) firstMeasured = sorted[i];
      lastMeasured = sorted[i];
    }
  }

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    if (entry.measured) continue;

    // Before the first measurement: fill-backward
    if (firstMeasured && entry.timestamp < firstMeasured.timestamp) {
      entry.weightLbs = roundWeightLbs(firstMeasured.weightLbs, 'us');
      continue;
    }

    // After the last measurement: fill-forward
    if (lastMeasured && entry.timestamp > lastMeasured.timestamp) {
      entry.weightLbs = roundWeightLbs(lastMeasured.weightLbs, 'us');
      continue;
    }

    // Between previous measurement and anchor: interpolate
    if (
      prevMeasured &&
      entry.timestamp >= prevMeasured.timestamp &&
      entry.timestamp <= anchor.timestamp
    ) {
      const w = interpolateWeight(
        prevMeasured.timestamp,
        prevMeasured.weightLbs,
        anchor.timestamp,
        anchor.weightLbs,
        entry.timestamp,
      );
      entry.weightLbs = roundWeightLbs(w, 'us');
      continue;
    }

    // Between anchor and next measurement: interpolate
    if (
      nextMeasured &&
      entry.timestamp >= anchor.timestamp &&
      entry.timestamp <= nextMeasured.timestamp
    ) {
      const w = interpolateWeight(
        anchor.timestamp,
        anchor.weightLbs,
        nextMeasured.timestamp,
        nextMeasured.weightLbs,
        entry.timestamp,
      );
      entry.weightLbs = roundWeightLbs(w, 'us');
      continue;
    }

    // Outside the local neighborhood of the anchor (other segments of the
    // timeline that this targeted recalculation doesn't reach). Leave as-is.
  }

  return sorted;
}

/**
 * Full recalculation of all calculated entries across the timeline, without
 * needing an anchor. Useful for data export and the calendar view.
 *
 * Sort ascending, find all measured entries, interpolate between adjacent
 * measured anchors, fill-forward after the last, fill-backward before the
 * first. If there are zero measured entries, calculated entries are left
 * unchanged. Returns a new array; the input is not mutated.
 */
export function recalculateAllCalculatedWeights(entries: WeightEntry[]): WeightEntry[] {
  const sorted = entries
    .map((e) => ({ ...e }))
    .sort((a, b) => a.timestamp - b.timestamp);

  const measured = sorted.filter((e) => e.measured);
  if (measured.length === 0) {
    return sorted;
  }

  const first = measured[0];
  const last = measured[measured.length - 1];

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    if (entry.measured) continue;

    // Before the first measurement: fill-backward
    if (entry.timestamp < first.timestamp) {
      entry.weightLbs = roundWeightLbs(first.weightLbs, 'us');
      continue;
    }

    // After the last measurement: fill-forward
    if (entry.timestamp > last.timestamp) {
      entry.weightLbs = roundWeightLbs(last.weightLbs, 'us');
      continue;
    }

    // Between two adjacent measured anchors: linearly interpolate
    // Find the latest measured with timestamp <= entry.timestamp
    // and the earliest measured with timestamp >= entry.timestamp.
    let prev: WeightEntry | null = null;
    let next: WeightEntry | null = null;
    for (let j = 0; j < measured.length; j++) {
      if (measured[j].timestamp <= entry.timestamp) prev = measured[j];
      if (measured[j].timestamp >= entry.timestamp) {
        next = measured[j];
        break;
      }
    }
    if (prev && next) {
      const w = interpolateWeight(
        prev.timestamp,
        prev.weightLbs,
        next.timestamp,
        next.weightLbs,
        entry.timestamp,
      );
      entry.weightLbs = roundWeightLbs(w, 'us');
    }
  }

  return sorted;
}
