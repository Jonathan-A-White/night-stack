import type { Sex, UnitSystem } from './types';

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
