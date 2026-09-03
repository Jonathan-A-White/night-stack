import { describe, it, expect } from 'vitest';
import {
  backfillNightLogV12,
  backfillWakeUpEventV12,
  backfillAppSettingsV12,
  weightEntryToBodyMeasurement,
} from '../services/schemaBackfill';
import type { WeightEntry } from '../types';

// Loosely-typed v11 shapes so the fixtures can omit the v12 fields.
type Loose = Record<string, unknown>;

function v11Night(overrides: Loose = {}): Loose {
  return {
    id: 'n1',
    date: '2026-04-06',
    eveningIntake: {
      lastMealTime: '18:30',
      foodDescription: '',
      flags: [
        { type: 'overate', label: 'Overate', active: false },
        { type: 'high_salt', label: 'High salt', active: true },
        { type: 'nitrates', label: 'Nitrates', active: false },
      ],
      alcohol: null,
      liquidIntake: '',
    },
    wakeUpEvents: [],
    ...overrides,
  };
}

describe('backfillNightLogV12', () => {
  it('derives sodiumLevel "more" from an active high_salt flag and removes the flag', () => {
    const log = v11Night();
    backfillNightLogV12(log);
    const intake = log.eveningIntake as Loose;
    expect(intake.sodiumLevel).toBe('more');
    expect(intake.sodiumLevelSource).toBe('proxy');
    expect(intake.sodiumSources).toEqual([]);
    const flags = intake.flags as { type: string }[];
    expect(flags.some((f) => f.type === 'high_salt')).toBe(false);
    expect(flags.map((f) => f.type)).toEqual(['overate', 'nitrates']);
  });

  it('derives sodiumLevel "normal" from an inactive high_salt flag', () => {
    const log = v11Night({
      eveningIntake: {
        lastMealTime: '',
        foodDescription: '',
        flags: [{ type: 'high_salt', label: 'High salt', active: false }],
        alcohol: null,
        liquidIntake: '',
      },
    });
    backfillNightLogV12(log);
    const intake = log.eveningIntake as Loose;
    expect(intake.sodiumLevel).toBe('normal');
    expect(intake.sodiumLevelSource).toBe('proxy');
    expect(intake.flags).toEqual([]);
  });

  it('handles a night with no flags array at all', () => {
    const log = v11Night({ eveningIntake: { lastMealTime: '', foodDescription: '' } });
    backfillNightLogV12(log);
    const intake = log.eveningIntake as Loose;
    expect(intake.sodiumLevel).toBe('normal');
    expect(intake.sodiumSources).toEqual([]);
    expect(intake.flags).toEqual([]);
  });

  it('handles a night with no eveningIntake at all', () => {
    const log = v11Night({ eveningIntake: undefined });
    backfillNightLogV12(log);
    const intake = log.eveningIntake as Loose;
    expect(intake.sodiumLevel).toBe('normal');
    expect(intake.alcohol).toBeNull();
    expect(intake.lastMealTime).toBe('');
  });

  it('is idempotent and never overwrites user-set values', () => {
    const log = v11Night({
      eveningIntake: {
        lastMealTime: '',
        foodDescription: '',
        flags: [],
        alcohol: null,
        liquidIntake: '',
        sodiumLevel: 'much_more',
        sodiumLevelSource: 'user',
        sodiumSources: ['ramen'],
      },
      electrolyteDose: 'full',
      positionStarted: 'side',
      positionAtWake: 'back',
      wiredWake: true,
      autoCreated: true,
      experimentNotes: 'pinch: salt',
    });
    backfillNightLogV12(log);
    backfillNightLogV12(log);
    const intake = log.eveningIntake as Loose;
    expect(intake.sodiumLevel).toBe('much_more');
    expect(intake.sodiumLevelSource).toBe('user');
    expect(intake.sodiumSources).toEqual(['ramen']);
    expect(log.electrolyteDose).toBe('full');
    expect(log.positionStarted).toBe('side');
    expect(log.positionAtWake).toBe('back');
    expect(log.wiredWake).toBe(true);
    expect(log.autoCreated).toBe(true);
    expect(log.experimentNotes).toBe('pinch: salt');
  });

  it('backfills the night-tag defaults', () => {
    const log = v11Night();
    backfillNightLogV12(log);
    expect(log.electrolyteDose).toBeNull();
    expect(log.positionStarted).toBe('unknown');
    expect(log.positionAtWake).toBe('unknown');
    expect(log.wiredWake).toBe(false);
    expect(log.autoCreated).toBe(false);
    expect(log.experimentNotes).toBe('');
  });

  it('backfills every wake-up event with episode defaults', () => {
    const log = v11Night({
      wakeUpEvents: [
        { id: 'w1', startTime: '03:10', endTime: '03:30', cause: 'c', fellBackAsleep: 'yes', minutesToFallBackAsleep: 20, notes: '', wasSweating: false, feltCold: false, racingHeart: true },
        { id: 'w2', startTime: '04:40', endTime: '', cause: '', fellBackAsleep: 'no', minutesToFallBackAsleep: null, notes: '' },
      ],
    });
    backfillNightLogV12(log);
    const events = log.wakeUpEvents as Loose[];
    for (const ev of events) {
      expect(ev.positionAtWake).toBe('unknown');
      expect(ev.ecgTaken).toBe(false);
      expect(ev.ecgVerdict).toBe('not_taken');
      expect(ev.rhythmFelt).toBeNull();
      expect(ev.lyingBp).toBeNull();
      expect(ev.minutesToSettle).toBeNull();
      expect(ev.wired).toBe(false);
      expect(ev.capturedAt).toBeNull();
      expect(ev.source).toBe('morning');
    }
    // Pre-existing values survive.
    expect(events[0].racingHeart).toBe(true);
    // v8 thermal flags are also filled when missing (w2 lacked them).
    expect(events[1].wasSweating).toBe(false);
  });
});

describe('backfillWakeUpEventV12', () => {
  it('does not overwrite episode fields already present', () => {
    const ev: Loose = {
      id: 'e', positionAtWake: 'back', ecgTaken: true, ecgVerdict: 'afib',
      rhythmFelt: 'irregular', lyingBp: { systolic: 110, diastolic: 70, pulse: 95 },
      minutesToSettle: 25, wired: true, capturedAt: 123, source: 'episode',
    };
    backfillWakeUpEventV12(ev);
    expect(ev.positionAtWake).toBe('back');
    expect(ev.ecgVerdict).toBe('afib');
    expect(ev.lyingBp).toEqual({ systolic: 110, diastolic: 70, pulse: 95 });
    expect(ev.capturedAt).toBe(123);
    expect(ev.source).toBe('episode');
  });
});

describe('backfillAppSettingsV12', () => {
  it('adds the three reminder preferences (off) and the calibration date (null)', () => {
    const s: Loose = {
      id: 'default',
      notificationPreferences: {
        eatingCutoff: true, supplementReminder: false, bedtimeWarning: true, bedtime: true, morningLog: false,
      },
    };
    backfillAppSettingsV12(s);
    const prefs = s.notificationPreferences as Loose;
    expect(prefs.amVitals).toBe(false);
    expect(prefs.pmVitals).toBe(false);
    expect(prefs.bedtimeWeighIn).toBe(false);
    // existing values untouched
    expect(prefs.supplementReminder).toBe(false);
    expect(prefs.bedtime).toBe(true);
    expect(s.watchBpCalibratedAt).toBeNull();
  });

  it('keeps user-set values on re-run', () => {
    const s: Loose = {
      notificationPreferences: { amVitals: true, pmVitals: true, bedtimeWeighIn: true },
      watchBpCalibratedAt: 42,
    };
    backfillAppSettingsV12(s);
    expect((s.notificationPreferences as Loose).amVitals).toBe(true);
    expect(s.watchBpCalibratedAt).toBe(42);
  });

  it('creates notificationPreferences when the object is missing', () => {
    const s: Loose = {};
    backfillAppSettingsV12(s);
    const prefs = s.notificationPreferences as Loose;
    expect(prefs.eatingCutoff).toBe(true);
    expect(prefs.amVitals).toBe(false);
  });
});

describe('weightEntryToBodyMeasurement', () => {
  it('copies every field, preserves the id, and maps weightLbs to value', () => {
    const w: WeightEntry = {
      id: 'w-1', nightLogId: 'n-1', date: '2026-04-06', time: '07:10', timestamp: 1_000,
      weightLbs: 172.4, period: 'morning', createdAt: 999, measured: true,
    };
    const bm = weightEntryToBodyMeasurement(w);
    expect(bm).toEqual({
      id: 'w-1', kind: 'weight', nightLogId: 'n-1', date: '2026-04-06', time: '07:10',
      timestamp: 1_000, period: 'morning', value: 172.4, measured: true, createdAt: 999,
    });
  });
});
