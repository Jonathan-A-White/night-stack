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
} from '../weightUtils';

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
