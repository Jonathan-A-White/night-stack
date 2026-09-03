import { describe, it, expect } from 'vitest';
import {
  computeOrthostatic,
  nightDateForReading,
  stageRemainingMs,
  RECALIBRATION_DAYS,
  STAGE_DURATIONS_MS,
} from '../services/orthostatic';
import type { OrthostaticReading } from '../types';

const DAY = 24 * 60 * 60 * 1000;

function reading(overrides: Partial<OrthostaticReading> = {}): OrthostaticReading {
  return {
    id: 'r1',
    date: '2026-09-04',
    slot: 'am',
    timestamp: new Date(2026, 8, 4, 7, 0).getTime(),
    source: 'cuff',
    supine: { systolic: 120, diastolic: 78, pulse: 60 },
    standing1: { systolic: 104, diastolic: 70, pulse: 84 },
    standing3: { systolic: 98, diastolic: 66, pulse: 92 },
    notes: '',
    createdAt: 0,
    ...overrides,
  };
}

describe('computeOrthostatic', () => {
  it('computes drops and pulse rise for both standing points', () => {
    const d = computeOrthostatic(reading(), null);
    expect(d.drop1).toEqual({ systolic: 16, diastolic: 8, pulseRise: 24 });
    expect(d.drop3).toEqual({ systolic: 22, diastolic: 12, pulseRise: 32 });
    expect(d.flags).toEqual(['systolic_drop', 'diastolic_drop']);
  });

  it('flags a pulse rise without a drop', () => {
    const d = computeOrthostatic(
      reading({ supine: { systolic: 118, diastolic: 76, pulse: 58 }, standing1: null, standing3: { systolic: 116, diastolic: 78, pulse: 90 } }),
      null,
    );
    expect(d.drop1).toBeNull();
    expect(d.flags).toEqual(['pulse_rise_without_drop']);
  });

  it('does not add the pulse flag when a drop is present', () => {
    const d = computeOrthostatic(
      reading({ supine: { systolic: 120, diastolic: 80, pulse: 60 }, standing1: null, standing3: { systolic: 96, diastolic: 70, pulse: 95 } }),
      null,
    );
    expect(d.flags).toEqual(['systolic_drop', 'diastolic_drop']);
  });

  it('thresholds are inclusive', () => {
    const sys = computeOrthostatic(reading({ standing1: null, standing3: { systolic: 100, diastolic: 75, pulse: 60 } }), null);
    expect(sys.flags).toEqual(['systolic_drop']);
    const dia = computeOrthostatic(reading({ standing1: null, standing3: { systolic: 115, diastolic: 68, pulse: 60 } }), null);
    expect(dia.flags).toEqual(['diastolic_drop']);
    const pulse = computeOrthostatic(reading({ standing1: null, standing3: { systolic: 118, diastolic: 76, pulse: 90 } }), null);
    expect(pulse.flags).toEqual(['pulse_rise_without_drop']);
    const under = computeOrthostatic(reading({ standing1: null, standing3: { systolic: 101, diastolic: 69, pulse: 89 } }), null);
    expect(under.flags).toEqual([]);
  });

  it('a skipped standing point yields a null delta and no flag from it', () => {
    const d = computeOrthostatic(reading({ standing1: null, standing3: { systolic: 95, diastolic: 74, pulse: 70 } }), null);
    expect(d.drop1).toBeNull();
    expect(d.flags).toEqual(['systolic_drop']);
  });

  it('flags are deduped across the two standing points', () => {
    const d = computeOrthostatic(reading({ standing1: { systolic: 95, diastolic: 74, pulse: 70 }, standing3: { systolic: 94, diastolic: 74, pulse: 70 } }), null);
    expect(d.flags).toEqual(['systolic_drop']);
  });

  describe('recalibration', () => {
    const ts = reading().timestamp;
    it('watch reading more than 28 days after calibration needs recalibration', () => {
      expect(computeOrthostatic(reading({ source: 'watch' }), ts - 30 * DAY).needsRecalibration).toBe(true);
    });
    it('watch reading within 28 days does not', () => {
      expect(computeOrthostatic(reading({ source: 'watch' }), ts - 27 * DAY).needsRecalibration).toBe(false);
      expect(computeOrthostatic(reading({ source: 'watch' }), ts - RECALIBRATION_DAYS * DAY).needsRecalibration).toBe(false);
    });
    it('watch reading with no calibration recorded needs recalibration', () => {
      expect(computeOrthostatic(reading({ source: 'watch' }), null).needsRecalibration).toBe(true);
    });
    it('cuff readings never need recalibration', () => {
      expect(computeOrthostatic(reading({ source: 'cuff' }), null).needsRecalibration).toBe(false);
    });
  });
});

describe('nightDateForReading', () => {
  it('am readings belong to the previous evening', () => {
    expect(nightDateForReading({ date: '2026-09-04', slot: 'am' })).toBe('2026-09-03');
  });
  it('pm readings belong to the same evening', () => {
    expect(nightDateForReading({ date: '2026-09-03', slot: 'pm' })).toBe('2026-09-03');
  });
  it('handles month boundaries', () => {
    expect(nightDateForReading({ date: '2026-10-01', slot: 'am' })).toBe('2026-09-30');
  });
});

describe('stageRemainingMs (clock-based timer)', () => {
  it('counts down from the stored start, not from render', () => {
    const start = 1_000_000;
    expect(stageRemainingMs(start, STAGE_DURATIONS_MS.supine, start)).toBe(STAGE_DURATIONS_MS.supine);
    expect(stageRemainingMs(start, STAGE_DURATIONS_MS.supine, start + 2 * 60_000)).toBe(3 * 60_000);
    // Five minutes of wall clock while hidden → zero, never negative.
    expect(stageRemainingMs(start, STAGE_DURATIONS_MS.supine, start + 5 * 60_000)).toBe(0);
    expect(stageRemainingMs(start, STAGE_DURATIONS_MS.supine, start + 9 * 60_000)).toBe(0);
  });
  it('stage durations are 5 min, 1 min, 3 min', () => {
    expect(STAGE_DURATIONS_MS).toEqual({ supine: 300_000, standing1: 60_000, standing3: 180_000 });
  });
});
