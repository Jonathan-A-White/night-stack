import { describe, it, expect } from 'vitest';
import {
  NIGHT_METRICS,
  getMetric,
  metricsForSide,
  buildNightMetricCtx,
  adrenergicNight,
} from '../services/nightMetrics';
import { createBlankNightLog, createBlankWakeUpEvent } from '../utils';
import type { BodyMeasurement, NightLog, OrthostaticReading } from '../types';

const ALARM = { expectedAlarmTime: '', actualAlarmTime: '', isOverridden: false, targetBedtime: '', eatingCutoff: '', supplementTime: '' };

function night(overrides: Partial<NightLog> = {}): NightLog {
  return { ...createBlankNightLog('2026-09-03', ALARM), ...overrides };
}

function bm(kind: 'weight' | 'neck', date: string, period: 'morning' | 'evening', value: number): BodyMeasurement {
  return { id: `${kind}-${date}-${period}`, kind, nightLogId: null, date, time: '07:00', timestamp: 1, period, value, measured: true, createdAt: 1 };
}

function ortho(date: string, slot: 'am' | 'pm', standing3: { systolic: number; diastolic: number; pulse: number } | null): OrthostaticReading {
  return { id: `${date}-${slot}`, date, slot, timestamp: 1, source: 'cuff', supine: { systolic: 120, diastolic: 78, pulse: 60 }, standing1: null, standing3, notes: '', createdAt: 1 };
}

describe('night metrics registry', () => {
  it('encodes ordinal tags', () => {
    const log = night({ positionStarted: 'back', wiredWake: true, electrolyteDose: 'half' });
    log.eveningIntake.sodiumLevel = 'much_more';
    const ctx = buildNightMetricCtx(log, [], [], null);
    expect(getMetric('sodiumLevel').extract(ctx)).toBe(2);
    expect(getMetric('electrolyteDose').extract(ctx)).toBe(1);
    expect(getMetric('positionStarted').extract(ctx)).toBe(1);
    expect(getMetric('wiredWake').extract(ctx)).toBe(1);
  });

  it('unknown position and unset dose are null', () => {
    const ctx = buildNightMetricCtx(night(), [], [], null);
    expect(getMetric('positionStarted').extract(ctx)).toBeNull();
    expect(getMetric('positionAtWake').extract(ctx)).toBeNull();
    expect(getMetric('electrolyteDose').extract(ctx)).toBeNull();
    expect(getMetric('sodiumLevel').extract(ctx)).toBe(0);
  });

  it('adrenergicNight composite', () => {
    expect(adrenergicNight(night())).toBe(0);
    expect(adrenergicNight(night({ wiredWake: true }))).toBe(1);
    const withEpisode = night({ wakeUpEvents: [createBlankWakeUpEvent({ source: 'episode', capturedAt: 1 })] });
    expect(adrenergicNight(withEpisode)).toBe(1);
    const ctx = buildNightMetricCtx(withEpisode, [], [], null);
    expect(getMetric('episodeCount').extract(ctx)).toBe(1);
    expect(getMetric('adrenergicNight').extract(ctx)).toBe(1);
  });

  it('deltas and vitals come from the context', () => {
    const rows = [bm('weight', '2026-09-03', 'evening', 172.4), bm('weight', '2026-09-04', 'morning', 174.2), bm('neck', '2026-09-03', 'evening', 15.6)];
    const readings = [ortho('2026-09-04', 'am', { systolic: 98, diastolic: 66, pulse: 92 }), ortho('2026-09-03', 'pm', { systolic: 118, diastolic: 78, pulse: 90 })];
    const ctx = buildNightMetricCtx(night(), rows, readings, null);
    expect(getMetric('weightDelta').extract(ctx)).toBeCloseTo(1.8, 5);
    expect(getMetric('neckDelta').extract(ctx)).toBeNull();
    expect(getMetric('orthoAmSystolicDrop3').extract(ctx)).toBe(22);
    expect(getMetric('orthoAmDiastolicDrop3').extract(ctx)).toBe(12);
    expect(getMetric('orthoAmPulseRise3').extract(ctx)).toBe(32);
    expect(getMetric('orthoPmPulseRise3').extract(ctx)).toBe(30);
    expect(getMetric('orthoFlagCount').extract(ctx)).toBe(3);
  });

  it('missing readings give null vitals', () => {
    const ctx = buildNightMetricCtx(night(), [], [], null);
    expect(getMetric('orthoAmSystolicDrop3').extract(ctx)).toBeNull();
    expect(getMetric('orthoFlagCount').extract(ctx)).toBe(0);
  });

  it('sides: deltas and vitals default Y, tags default X, both selectable either side', () => {
    expect(getMetric('weightDelta').defaultSide).toBe('y');
    expect(getMetric('neckDelta').side).toBe('both');
    expect(getMetric('sodiumLevel').defaultSide).toBe('x');
    expect(getMetric('sodiumLevel').side).toBe('both');
    expect(getMetric('sleepScore').side).toBe('y');
    expect(metricsForSide('x').map((m) => m.key)).toContain('neckDelta');
    expect(metricsForSide('y').map((m) => m.key)).toContain('sodiumLevel');
    expect(metricsForSide('x').map((m) => m.key)).not.toContain('sleepScore');
  });

  it('every metric has a unique key and a label', () => {
    const keys = NIGHT_METRICS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(NIGHT_METRICS.every((m) => m.label.length > 0)).toBe(true);
  });

  it('sleep metrics still read sleepData', () => {
    const log = night({ sleepData: { sleepTime: '22:30', wakeTime: '04:43', totalSleepDuration: 360, actualSleepDuration: 340, sleepScore: 81, sleepScoreDelta: 0, deepSleep: 60, remSleep: 100, lightSleep: 180, awakeDuration: 20, avgHeartRate: 48, minHeartRate: 40, avgRespiratoryRate: 14, bloodOxygenAvg: 95, skinTempRange: '', sleepLatencyRating: 'Good', restfulnessRating: 'Good', deepSleepRating: 'Good', remSleepRating: 'Good', importedAt: 1 } });
    const ctx = buildNightMetricCtx(log, [], [], null);
    expect(getMetric('sleepScore').extract(ctx)).toBe(81);
    expect(getMetric('minHR').extract(ctx)).toBe(40);
    expect(getMetric('sleepScore').extract(buildNightMetricCtx(night(), [], [], null))).toBeNull();
  });
});
