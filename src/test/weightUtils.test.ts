import { describe, it, expect } from 'vitest';
import {
  lbsToKg,
  kgToLbs,
  inchesToCm,
  cmToInches,
  formatWeight,
  formatHeight,
  calculateIdealWeightLbs,
  resolveDefaultWeightLbs,
  parseFeetInchesToInches,
  inchesToFeetInches,
  roundWeightLbs,
  recalculateCalculatedWeights,
  recalculateAllCalculatedWeights,
} from '../weightUtils';
import type { WeightEntry } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

function makeEntry(
  id: string,
  timestamp: number,
  weightLbs: number,
  measured: boolean,
): WeightEntry {
  return {
    id,
    nightLogId: null,
    date: '2026-01-01',
    time: '07:00',
    timestamp,
    weightLbs,
    period: 'morning',
    createdAt: timestamp,
    measured,
  };
}

describe('unit conversions', () => {
  it('converts lbs ↔ kg round-trip', () => {
    const kg = lbsToKg(165);
    expect(kg).toBeCloseTo(74.84, 2);
    expect(kgToLbs(kg)).toBeCloseTo(165, 5);
  });

  it('converts inches ↔ cm round-trip', () => {
    const cm = inchesToCm(70);
    expect(cm).toBeCloseTo(177.8, 1);
    expect(cmToInches(cm)).toBeCloseTo(70, 5);
  });
});

describe('formatWeight', () => {
  it('formats US as lb with 1 decimal', () => {
    expect(formatWeight(165.37, 'us')).toBe('165.4 lb');
  });

  it('formats metric as kg with 1 decimal', () => {
    expect(formatWeight(165.0, 'metric')).toMatch(/74\.8 kg/);
  });
});

describe('formatHeight', () => {
  it('formats US as feet and inches', () => {
    expect(formatHeight(70, 'us')).toBe('5\'10"');
    expect(formatHeight(72, 'us')).toBe('6\'0"');
  });

  it('rounds US edge case when inches round up to 12', () => {
    expect(formatHeight(71.6, 'us')).toBe('6\'0"');
  });

  it('formats metric as cm rounded', () => {
    expect(formatHeight(70, 'metric')).toBe('178 cm');
  });
});

describe('calculateIdealWeightLbs (Devine formula)', () => {
  it('computes male at 5ft', () => {
    // 50 kg → ~110.23 lb
    expect(calculateIdealWeightLbs('m', 60)).toBeCloseTo(110.23, 1);
  });

  it('computes male at 5ft 10in', () => {
    // 50 + 2.3*10 = 73 kg → ~160.94 lb
    expect(calculateIdealWeightLbs('m', 70)).toBeCloseTo(160.94, 1);
  });

  it('computes female at 5ft 5in', () => {
    // 45.5 + 2.3*5 = 57 kg → ~125.66 lb
    expect(calculateIdealWeightLbs('f', 65)).toBeCloseTo(125.66, 1);
  });

  it('clamps heights under 5ft to the base weight', () => {
    expect(calculateIdealWeightLbs('m', 48)).toBeCloseTo(110.23, 1);
  });
});

describe('resolveDefaultWeightLbs', () => {
  it('prefers previous weight when available', () => {
    const result = resolveDefaultWeightLbs({
      previousWeightLbs: 172.4,
      startingWeightLbs: 180,
      sex: 'm',
      heightInches: 70,
    });
    expect(result).toBe(172.4);
  });

  it('falls back to starting weight if no previous', () => {
    const result = resolveDefaultWeightLbs({
      previousWeightLbs: null,
      startingWeightLbs: 180,
      sex: 'm',
      heightInches: 70,
    });
    expect(result).toBe(180);
  });

  it('falls back to ideal weight if no previous or starting', () => {
    const result = resolveDefaultWeightLbs({
      previousWeightLbs: null,
      startingWeightLbs: null,
      sex: 'm',
      heightInches: 70,
    });
    expect(result).toBeCloseTo(160.94, 1);
  });

  it('falls back to hardcoded 150 lb if nothing is known', () => {
    const result = resolveDefaultWeightLbs({});
    expect(result).toBe(150);
  });

  it('uses ideal only when both sex and height are present', () => {
    expect(resolveDefaultWeightLbs({ sex: 'm' })).toBe(150);
    expect(resolveDefaultWeightLbs({ heightInches: 70 })).toBe(150);
  });
});

describe('parseFeetInchesToInches', () => {
  it('parses feet and inches', () => {
    expect(parseFeetInchesToInches('5', '10')).toBe(70);
  });

  it('treats empty inches as zero', () => {
    expect(parseFeetInchesToInches('6', '')).toBe(72);
  });

  it('returns null when both are empty', () => {
    expect(parseFeetInchesToInches('', '')).toBeNull();
  });

  it('returns null on non-numeric input', () => {
    expect(parseFeetInchesToInches('abc', '10')).toBeNull();
  });
});

describe('inchesToFeetInches', () => {
  it('splits evenly', () => {
    expect(inchesToFeetInches(70)).toEqual({ feet: 5, inches: 10 });
  });

  it('handles 6 ft exactly', () => {
    expect(inchesToFeetInches(72)).toEqual({ feet: 6, inches: 0 });
  });
});

describe('roundWeightLbs', () => {
  it('rounds US to 0.1 lb', () => {
    expect(roundWeightLbs(165.37, 'us')).toBe(165.4);
  });

  it('rounds metric so kg displays cleanly at 0.1 kg', () => {
    // 75.0 kg exactly
    const raw = kgToLbs(75.04);
    const rounded = roundWeightLbs(raw, 'metric');
    expect(lbsToKg(rounded)).toBeCloseTo(75.0, 1);
  });
});

describe('recalculateCalculatedWeights', () => {
  it('linearly interpolates between two measurements (2-day gap in a 4-day span)', () => {
    // Anchor at t=4 days = 178, previous measurement at t=0 = 170
    // Calculated at t=2 days should be 174
    const t0 = 1_700_000_000_000;
    const entries: WeightEntry[] = [
      makeEntry('a', t0, 170, true),
      makeEntry('c1', t0 + 1 * DAY_MS, 0, false),
      makeEntry('c2', t0 + 2 * DAY_MS, 0, false),
      makeEntry('c3', t0 + 3 * DAY_MS, 0, false),
      makeEntry('b', t0 + 4 * DAY_MS, 178, true),
    ];
    const result = recalculateCalculatedWeights(entries, 'b');
    const byId = Object.fromEntries(result.map((e) => [e.id, e]));
    expect(byId['c1'].weightLbs).toBe(172);
    expect(byId['c2'].weightLbs).toBe(174);
    expect(byId['c3'].weightLbs).toBe(176);
    // Measured values unchanged
    expect(byId['a'].weightLbs).toBe(170);
    expect(byId['b'].weightLbs).toBe(178);
  });

  it('fill-forwards calculated entries after the last measurement', () => {
    const t0 = 1_700_000_000_000;
    const entries: WeightEntry[] = [
      makeEntry('m1', t0, 165, true),
      makeEntry('m2', t0 + 2 * DAY_MS, 169, true),
      makeEntry('c1', t0 + 3 * DAY_MS, 0, false),
      makeEntry('c2', t0 + 5 * DAY_MS, 0, false),
    ];
    const result = recalculateCalculatedWeights(entries, 'm2');
    const byId = Object.fromEntries(result.map((e) => [e.id, e]));
    expect(byId['c1'].weightLbs).toBe(169);
    expect(byId['c2'].weightLbs).toBe(169);
  });

  it('fill-backwards calculated entries before the first measurement', () => {
    const t0 = 1_700_000_000_000;
    const entries: WeightEntry[] = [
      makeEntry('c1', t0, 0, false),
      makeEntry('c2', t0 + 1 * DAY_MS, 0, false),
      makeEntry('m1', t0 + 2 * DAY_MS, 160, true),
      makeEntry('m2', t0 + 4 * DAY_MS, 164, true),
    ];
    const result = recalculateCalculatedWeights(entries, 'm1');
    const byId = Object.fromEntries(result.map((e) => [e.id, e]));
    expect(byId['c1'].weightLbs).toBe(160);
    expect(byId['c2'].weightLbs).toBe(160);
  });

  it('never modifies measured entries', () => {
    const t0 = 1_700_000_000_000;
    const entries: WeightEntry[] = [
      makeEntry('a', t0, 170, true),
      makeEntry('c', t0 + 1 * DAY_MS, 999, false),
      makeEntry('b', t0 + 2 * DAY_MS, 180, true),
    ];
    const result = recalculateCalculatedWeights(entries, 'b');
    const byId = Object.fromEntries(result.map((e) => [e.id, e]));
    expect(byId['a'].weightLbs).toBe(170);
    expect(byId['b'].weightLbs).toBe(180);
    // Calculated entry was overwritten by interpolation (175 at midpoint)
    expect(byId['c'].weightLbs).toBe(175);
  });

  it('returns a new array and does not mutate the input', () => {
    const t0 = 1_700_000_000_000;
    const original: WeightEntry[] = [
      makeEntry('a', t0, 170, true),
      makeEntry('c', t0 + 1 * DAY_MS, 999, false),
      makeEntry('b', t0 + 2 * DAY_MS, 180, true),
    ];
    const snapshot = original.map((e) => ({ ...e }));
    const result = recalculateCalculatedWeights(original, 'b');
    // New array reference
    expect(result).not.toBe(original);
    // Elements are new objects too (not the same references)
    for (const entry of original) {
      const matched = result.find((r) => r.id === entry.id)!;
      expect(matched).not.toBe(entry);
    }
    // Original array content untouched
    for (let i = 0; i < original.length; i++) {
      expect(original[i]).toEqual(snapshot[i]);
    }
  });

  it('throws when anchorId refers to a non-measured entry', () => {
    const t0 = 1_700_000_000_000;
    const entries: WeightEntry[] = [
      makeEntry('a', t0, 170, true),
      makeEntry('c', t0 + 1 * DAY_MS, 999, false),
    ];
    expect(() => recalculateCalculatedWeights(entries, 'c')).toThrow(
      /not a measured entry/,
    );
  });

  it('throws when anchorId is unknown', () => {
    const t0 = 1_700_000_000_000;
    const entries: WeightEntry[] = [makeEntry('a', t0, 170, true)];
    expect(() => recalculateCalculatedWeights(entries, 'does-not-exist')).toThrow(
      /unknown anchorId/,
    );
  });
});

describe('recalculateAllCalculatedWeights', () => {
  it('linearly interpolates between adjacent measurements', () => {
    const t0 = 1_700_000_000_000;
    const entries: WeightEntry[] = [
      makeEntry('m1', t0, 170, true),
      makeEntry('c1', t0 + 1 * DAY_MS, 0, false),
      makeEntry('c2', t0 + 2 * DAY_MS, 0, false),
      makeEntry('c3', t0 + 3 * DAY_MS, 0, false),
      makeEntry('m2', t0 + 4 * DAY_MS, 178, true),
    ];
    const result = recalculateAllCalculatedWeights(entries);
    const byId = Object.fromEntries(result.map((e) => [e.id, e]));
    expect(byId['c1'].weightLbs).toBe(172);
    expect(byId['c2'].weightLbs).toBe(174);
    expect(byId['c3'].weightLbs).toBe(176);
  });

  it('fill-forwards after the last measurement', () => {
    const t0 = 1_700_000_000_000;
    const entries: WeightEntry[] = [
      makeEntry('m1', t0, 160, true),
      makeEntry('m2', t0 + 2 * DAY_MS, 164, true),
      makeEntry('c1', t0 + 3 * DAY_MS, 0, false),
      makeEntry('c2', t0 + 10 * DAY_MS, 0, false),
    ];
    const result = recalculateAllCalculatedWeights(entries);
    const byId = Object.fromEntries(result.map((e) => [e.id, e]));
    expect(byId['c1'].weightLbs).toBe(164);
    expect(byId['c2'].weightLbs).toBe(164);
  });

  it('fill-backwards before the first measurement', () => {
    const t0 = 1_700_000_000_000;
    const entries: WeightEntry[] = [
      makeEntry('c1', t0, 0, false),
      makeEntry('c2', t0 + 1 * DAY_MS, 0, false),
      makeEntry('m1', t0 + 2 * DAY_MS, 155, true),
      makeEntry('m2', t0 + 4 * DAY_MS, 159, true),
    ];
    const result = recalculateAllCalculatedWeights(entries);
    const byId = Object.fromEntries(result.map((e) => [e.id, e]));
    expect(byId['c1'].weightLbs).toBe(155);
    expect(byId['c2'].weightLbs).toBe(155);
  });

  it('never modifies measured entries', () => {
    const t0 = 1_700_000_000_000;
    const entries: WeightEntry[] = [
      makeEntry('m1', t0, 170, true),
      makeEntry('c', t0 + 1 * DAY_MS, 999, false),
      makeEntry('m2', t0 + 2 * DAY_MS, 180, true),
    ];
    const result = recalculateAllCalculatedWeights(entries);
    const byId = Object.fromEntries(result.map((e) => [e.id, e]));
    expect(byId['m1'].weightLbs).toBe(170);
    expect(byId['m2'].weightLbs).toBe(180);
  });

  it('returns a new array and does not mutate the input', () => {
    const t0 = 1_700_000_000_000;
    const original: WeightEntry[] = [
      makeEntry('m1', t0, 170, true),
      makeEntry('c', t0 + 1 * DAY_MS, 999, false),
      makeEntry('m2', t0 + 2 * DAY_MS, 180, true),
    ];
    const snapshot = original.map((e) => ({ ...e }));
    const result = recalculateAllCalculatedWeights(original);
    expect(result).not.toBe(original);
    for (const entry of original) {
      const matched = result.find((r) => r.id === entry.id)!;
      expect(matched).not.toBe(entry);
    }
    for (let i = 0; i < original.length; i++) {
      expect(original[i]).toEqual(snapshot[i]);
    }
  });

  it('leaves calculated entries unchanged when there are zero measurements', () => {
    const t0 = 1_700_000_000_000;
    const entries: WeightEntry[] = [
      makeEntry('c1', t0, 150, false),
      makeEntry('c2', t0 + 1 * DAY_MS, 151.5, false),
      makeEntry('c3', t0 + 2 * DAY_MS, 152.7, false),
    ];
    const result = recalculateAllCalculatedWeights(entries);
    const byId = Object.fromEntries(result.map((e) => [e.id, e]));
    expect(byId['c1'].weightLbs).toBe(150);
    expect(byId['c2'].weightLbs).toBe(151.5);
    expect(byId['c3'].weightLbs).toBe(152.7);
  });

  it('sets all calculated entries to the single measurement value', () => {
    const t0 = 1_700_000_000_000;
    const entries: WeightEntry[] = [
      makeEntry('c1', t0, 0, false),
      makeEntry('m1', t0 + 2 * DAY_MS, 168.3, true),
      makeEntry('c2', t0 + 5 * DAY_MS, 0, false),
      makeEntry('c3', t0 + 8 * DAY_MS, 0, false),
    ];
    const result = recalculateAllCalculatedWeights(entries);
    const byId = Object.fromEntries(result.map((e) => [e.id, e]));
    expect(byId['c1'].weightLbs).toBe(168.3);
    expect(byId['c2'].weightLbs).toBe(168.3);
    expect(byId['c3'].weightLbs).toBe(168.3);
    expect(byId['m1'].weightLbs).toBe(168.3);
  });
});
