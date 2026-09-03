import { describe, it, expect } from 'vitest';
import {
  CLINICIAN_COLUMNS,
  buildClinicianRows,
  toCsv,
  parseCsv,
  summaryStats,
  defaultRange,
  type ClinicianRow,
} from '../services/clinicianExport';
import { createBlankNightLog, createBlankWakeUpEvent } from '../utils';
import type { BodyMeasurement, NightLog, OrthostaticReading, SodiumLevel, SleepPosition } from '../types';

const ALARM = { expectedAlarmTime: '04:43', actualAlarmTime: '04:43', isOverridden: false, targetBedtime: '21:13', eatingCutoff: '18:43', supplementTime: '20:28' };

function night(date: string, overrides: Partial<NightLog> = {}, sodium: SodiumLevel = 'normal', pos: SleepPosition = 'unknown'): NightLog {
  const l = { ...createBlankNightLog(date, ALARM), ...overrides };
  l.eveningIntake.sodiumLevel = sodium;
  l.positionStarted = pos;
  return l;
}

function bm(kind: 'weight' | 'neck', date: string, period: 'morning' | 'evening', value: number): BodyMeasurement {
  return { id: `${kind}-${date}-${period}`, kind, nightLogId: null, date, time: '07:00', timestamp: 1, period, value, measured: true, createdAt: 1 };
}

function ortho(date: string, slot: 'am' | 'pm', source: 'cuff' | 'watch', standing3: { systolic: number; diastolic: number; pulse: number } | null, timestamp = 1): OrthostaticReading {
  return { id: `${date}-${slot}`, date, slot, timestamp, source, supine: { systolic: 120, diastolic: 78, pulse: 60 }, standing1: null, standing3, notes: '', createdAt: 1 };
}

function dates(n: number, start = '2026-08-21'): string[] {
  const [y, m, d] = start.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const dt = new Date(y, m - 1, d + i);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  });
}

describe('buildClinicianRows + toCsv', () => {
  it('one row per night with every column, in date order', () => {
    const ds = dates(14);
    const logs = ds.map((d, i) => night(d, i % 5 === 0 ? { wakeUpEvents: [createBlankWakeUpEvent({ source: 'episode', capturedAt: 1, startTime: '04:31', positionAtWake: 'back', ecgTaken: true, ecgVerdict: 'sinus', wired: true })] } : {}));
    const body = ds.slice(0, 10).map((d) => bm('weight', d, 'evening', 172));
    const readings = ds.slice(0, 6).map((d) => ortho(d, 'am', 'cuff', { systolic: 100, diastolic: 70, pulse: 80 }));
    const rows = buildClinicianRows({ logs, bodyRows: body, readings, samples: [], watchBpCalibratedAt: null });
    expect(rows).toHaveLength(14);
    expect(rows.map((r) => r.night_date)).toEqual(ds);
    const csv = toCsv(rows);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.replace(/^\uFEFF/, '').split('\r\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(15);
    const headerCount = parseCsv(csv)[0].length;
    expect(headerCount).toBe(CLINICIAN_COLUMNS.length);
    for (const parsed of parseCsv(csv)) expect(parsed).toHaveLength(headerCount);
  });

  it('missing values are blank, never "null" or "undefined"', () => {
    const rows = buildClinicianRows({ logs: [night('2026-09-03')], bodyRows: [], readings: [], samples: [], watchBpCalibratedAt: null });
    const r = rows[0];
    expect(r.pm_weight_lb).toBe('');
    expect(r.am_sys_drop3).toBe('');
    expect(r.episode_1_time).toBe('');
    const csv = toCsv(rows);
    expect(csv).not.toMatch(/null|undefined/);
  });

  it('quotes commas, quotes and newlines and round-trips', () => {
    const l = night('2026-09-03', { morningNotes: 'woke at 4, "wired"\nsecond line', experimentNotes: 'pinch: salt' });
    const rows = buildClinicianRows({ logs: [l], bodyRows: [], readings: [], samples: [], watchBpCalibratedAt: null });
    const csv = toCsv(rows);
    const parsed = parseCsv(csv);
    const header = parsed[0];
    const data = parsed[1];
    const idx = header.indexOf('morning_notes');
    expect(data[idx]).toBe('woke at 4, "wired"\nsecond line');
    expect(data[header.indexOf('experiment_notes')]).toBe('pinch: salt');
    // Full round trip: every cell equals the row's string value.
    for (const [i, col] of header.entries()) {
      expect(data[i]).toBe(String(rows[0][col as keyof ClinicianRow]));
    }
  });

  it('fills tags, deltas, vitals, flags, calibration and episodes', () => {
    const l = night('2026-09-03', { electrolyteDose: 'half', positionAtWake: 'side', wiredWake: true,
      wakeUpEvents: [createBlankWakeUpEvent({ source: 'episode', capturedAt: 1, startTime: '04:31', positionAtWake: 'back', ecgTaken: true, ecgVerdict: 'afib', rhythmFelt: 'irregular', lyingBp: { systolic: 110, diastolic: 70, pulse: 95 }, minutesToSettle: 25, fellBackAsleep: 'eventually', wired: true })] }, 'more', 'back');
    l.eveningIntake.sodiumSources = ['pretzels', 'soy sauce'];
    l.eveningIntake.sodiumLevelSource = 'user';
    const body = [bm('weight', '2026-09-03', 'evening', 172.4), bm('weight', '2026-09-04', 'morning', 174.2), bm('neck', '2026-09-03', 'evening', 15.6), bm('neck', '2026-09-04', 'morning', 16.1)];
    const DAY = 86_400_000;
    const readings = [
      ortho('2026-09-03', 'pm', 'watch', { systolic: 116, diastolic: 76, pulse: 92 }, 40 * DAY),
      ortho('2026-09-04', 'am', 'cuff', { systolic: 98, diastolic: 66, pulse: 92 }, 41 * DAY),
    ];
    const [r] = buildClinicianRows({ logs: [l], bodyRows: body, readings, samples: [], watchBpCalibratedAt: 9 * DAY });
    expect(r.sodium_level).toBe('more');
    expect(r.sodium_source).toBe('user');
    expect(r.sodium_sources).toBe('pretzels; soy sauce');
    expect(r.electrolyte_dose).toBe('half');
    expect(r.position_started).toBe('back');
    expect(r.position_at_wake).toBe('side');
    expect(r.wired_wake).toBe('yes');
    expect(r.pm_weight_lb).toBe('172.4');
    expect(r.am_weight_lb).toBe('174.2');
    expect(r.weight_delta_lb).toBe('1.8');
    expect(r.neck_delta_in).toBe('0.5');
    expect(r.episode_count).toBe('1');
    expect(r.episode_1_time).toBe('04:31');
    expect(r.episode_1_position).toBe('back');
    expect(r.episode_1_ecg).toBe('afib');
    expect(r.episode_1_rhythm).toBe('irregular');
    expect(r.episode_1_lying_bp).toBe('110/70 (95)');
    expect(r.episode_1_minutes_to_settle).toBe('25');
    expect(r.episode_1_back_to_sleep).toBe('eventually');
    expect(r.episode_1_wired).toBe('yes');
    expect(r.pm_ortho_source).toBe('watch');
    expect(r.pm_supine).toBe('120/78 (60)');
    expect(r.pm_stand3).toBe('116/76 (92)');
    expect(r.pm_pulse_rise3).toBe('32');
    expect(r.pm_flags).toBe('pulse_rise_without_drop');
    expect(r.pm_recalibrate).toBe('yes');
    expect(r.am_sys_drop3).toBe('22');
    expect(r.am_dia_drop3).toBe('12');
    expect(r.am_flags).toBe('systolic_drop; diastolic_drop');
    expect(r.am_recalibrate).toBe('');
    expect(r.spo2_nadir_pre_episode).toBe('');
  });

  it('trace columns are filled when samples exist around an episode', () => {
    const capturedAt = new Date(2026, 8, 4, 4, 31).getTime();
    const l = night('2026-09-03', { wakeUpEvents: [createBlankWakeUpEvent({ source: 'episode', capturedAt, startTime: '04:31' })] });
    const samples = [
      { kind: 'spo2' as const, timestamp: capturedAt - 20 * 60_000, value: 96, nightLogId: l.id, importBatchId: 'b' },
      { kind: 'spo2' as const, timestamp: capturedAt - 5 * 60_000, value: 88, nightLogId: l.id, importBatchId: 'b' },
      { kind: 'hr' as const, timestamp: capturedAt - 2 * 60_000, value: 98, nightLogId: l.id, importBatchId: 'b' },
      { kind: 'hr' as const, timestamp: capturedAt - 90 * 60_000, value: 120, nightLogId: l.id, importBatchId: 'b' }, // outside window
    ];
    const [r] = buildClinicianRows({ logs: [l], bodyRows: [], readings: [], samples, watchBpCalibratedAt: null });
    expect(r.spo2_nadir_pre_episode).toBe('88');
    expect(r.hr_peak_pre_episode).toBe('98');
  });
});

describe('summaryStats', () => {
  it('2x3 adrenergic table and mean deltas by sodium level', () => {
    const logs = [
      night('2026-09-01', { wakeUpEvents: [createBlankWakeUpEvent({ source: 'episode', capturedAt: 1 })] }, 'more', 'back'),
      night('2026-09-02', {}, 'more', 'side'),
      night('2026-09-03', {}, 'normal', 'back'),
      night('2026-09-04', { wiredWake: true }, 'much_more', 'unknown'),
    ];
    const body = [bm('weight', '2026-09-01', 'evening', 170), bm('weight', '2026-09-02', 'morning', 171.8), bm('weight', '2026-09-02', 'evening', 170)];
    const rows = buildClinicianRows({ logs, bodyRows: body, readings: [], samples: [], watchBpCalibratedAt: null });
    const s = summaryStats(rows);
    expect(s.nights).toBe(4);
    expect(s.episodes).toBe(1);
    expect(s.adrenergicNights).toBe(2);
    expect(s.grid.more.back).toEqual({ adrenergic: 1, total: 1 });
    expect(s.grid.more.side).toEqual({ adrenergic: 0, total: 1 });
    expect(s.grid.normal.back).toEqual({ adrenergic: 0, total: 1 });
    expect(s.grid.much_more.unknown).toEqual({ adrenergic: 1, total: 1 });
    expect(s.meanWeightDelta.more).toEqual({ mean: 1.8, n: 1 });
    expect(s.meanWeightDelta.normal).toEqual({ mean: null, n: 0 });
  });
});

describe('defaultRange', () => {
  it('is the 14 nights ending yesterday', () => {
    expect(defaultRange(new Date(2026, 8, 4))).toEqual({ start: '2026-08-21', end: '2026-09-03' });
  });
});
