import type { BodyMeasurement, NightLog, OrthostaticReading, SodiumLevel, SleepPosition, VitalSample, WakeUpEvent } from '../types';
import { addDaysToDate, toLocalDateString } from '../utils';
import { buildNightMetricCtx, adrenergicNight } from './nightMetrics';
import { formatBp } from './orthostatic';

/**
 * Clinician export (specs/home-experiments/clinician-export.md, Q14):
 * one flat row per night with every column always present (blank when
 * missing), an RFC 4180 CSV with a UTF-8 BOM so Excel opens it cleanly,
 * and summary statistics for the printable page. No interpretation —
 * flags carry their threshold names only.
 */

const EPISODE_COLS = 3;

const BASE_COLUMNS = [
  'night_date', 'watch_sleep_time', 'watch_wake_time', 'sleep_score', 'total_sleep_min', 'awake_min', 'avg_hr', 'min_hr', 'spo2_avg',
  'sodium_level', 'sodium_source', 'sodium_sources', 'electrolyte_dose', 'alcohol', 'last_meal_time',
  'position_started', 'position_at_wake', 'wired_wake',
  'pm_weight_lb', 'am_weight_lb', 'weight_delta_lb', 'pm_neck_in', 'am_neck_in', 'neck_delta_in',
  'episode_count',
] as const;

const EPISODE_FIELDS = ['time', 'position', 'ecg', 'rhythm', 'lying_bp', 'minutes_to_settle', 'back_to_sleep', 'wired'] as const;

const TAIL_COLUMNS = [
  'pm_ortho_source', 'pm_supine', 'pm_stand1', 'pm_stand3', 'pm_sys_drop3', 'pm_dia_drop3', 'pm_pulse_rise3', 'pm_flags', 'pm_recalibrate',
  'am_ortho_source', 'am_supine', 'am_stand1', 'am_stand3', 'am_sys_drop3', 'am_dia_drop3', 'am_pulse_rise3', 'am_flags', 'am_recalibrate',
  'spo2_nadir_pre_episode', 'hr_peak_pre_episode',
  'thermal_comfort', 'evening_notes', 'morning_notes', 'experiment_notes',
] as const;

function episodeColumns(): string[] {
  const out: string[] = [];
  for (let i = 1; i <= EPISODE_COLS; i++) for (const f of EPISODE_FIELDS) out.push(`episode_${i}_${f}`);
  return out;
}

export const CLINICIAN_COLUMNS: readonly string[] = [...BASE_COLUMNS, ...episodeColumns(), ...TAIL_COLUMNS];

export type ClinicianRow = Record<(typeof BASE_COLUMNS)[number] | (typeof TAIL_COLUMNS)[number] | `episode_${1 | 2 | 3}_${(typeof EPISODE_FIELDS)[number]}`, string>;

const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const num = (v: number | null | undefined, digits = 1): string => (v === null || v === undefined ? '' : String(Math.round(v * 10 ** digits) / 10 ** digits));
const yn = (v: boolean): string => (v ? 'yes' : 'no');

export interface TraceStats {
  spo2Nadir: number | null;
  hrPeak: number | null;
}

/** SpO2 nadir and HR peak in [capturedAt − 60 min, capturedAt + 30 min]. */
export function traceStats(capturedAt: number, samples: readonly VitalSample[]): TraceStats {
  const lo = capturedAt - 60 * 60_000;
  const hi = capturedAt + 30 * 60_000;
  let spo2Nadir: number | null = null;
  let hrPeak: number | null = null;
  for (const smp of samples) {
    if (smp.timestamp < lo || smp.timestamp > hi) continue;
    if (smp.kind === 'spo2' && (spo2Nadir === null || smp.value < spo2Nadir)) spo2Nadir = smp.value;
    if (smp.kind === 'hr' && (hrPeak === null || smp.value > hrPeak)) hrPeak = smp.value;
  }
  return { spo2Nadir, hrPeak };
}

export interface ClinicianInput {
  logs: readonly NightLog[];
  bodyRows: readonly BodyMeasurement[];
  readings: readonly OrthostaticReading[];
  samples: readonly VitalSample[];
  watchBpCalibratedAt: number | null;
}

export function buildClinicianRows(input: ClinicianInput): ClinicianRow[] {
  const logs = [...input.logs].sort((a, b) => a.date.localeCompare(b.date));
  return logs.map((log) => {
    const ctx = buildNightMetricCtx(log, input.bodyRows, input.readings, input.watchBpCalibratedAt);
    const episodes = log.wakeUpEvents.filter((e) => e.source === 'episode');
    const row: Record<string, string> = {};

    row.night_date = log.date;
    row.watch_sleep_time = s(log.sleepData?.sleepTime);
    row.watch_wake_time = s(log.sleepData?.wakeTime);
    row.sleep_score = s(log.sleepData?.sleepScore);
    row.total_sleep_min = s(log.sleepData?.totalSleepDuration);
    row.awake_min = s(log.sleepData?.awakeDuration);
    row.avg_hr = s(log.sleepData?.avgHeartRate);
    row.min_hr = s(log.sleepData?.minHeartRate);
    row.spo2_avg = s(log.sleepData?.bloodOxygenAvg);

    row.sodium_level = log.eveningIntake.sodiumLevel;
    row.sodium_source = log.eveningIntake.sodiumLevelSource;
    row.sodium_sources = log.eveningIntake.sodiumSources.join('; ');
    row.electrolyte_dose = s(log.electrolyteDose);
    row.alcohol = log.eveningIntake.alcohol ? `${log.eveningIntake.alcohol.type} ${log.eveningIntake.alcohol.amount}`.trim() : '';
    row.last_meal_time = log.eveningIntake.lastMealTime;

    row.position_started = log.positionStarted;
    row.position_at_wake = log.positionAtWake;
    row.wired_wake = yn(log.wiredWake);

    row.pm_weight_lb = num(ctx.body.pmWeight);
    row.am_weight_lb = num(ctx.body.amWeight);
    row.weight_delta_lb = num(ctx.body.weightDeltaLbs);
    row.pm_neck_in = num(ctx.body.pmNeck);
    row.am_neck_in = num(ctx.body.amNeck);
    row.neck_delta_in = num(ctx.body.neckDeltaIn);

    row.episode_count = String(episodes.length);
    for (let i = 0; i < EPISODE_COLS; i++) {
      const e: WakeUpEvent | undefined = episodes[i];
      const p = `episode_${i + 1}_`;
      row[`${p}time`] = e ? e.startTime : '';
      row[`${p}position`] = e ? e.positionAtWake : '';
      row[`${p}ecg`] = e ? e.ecgVerdict : '';
      row[`${p}rhythm`] = e ? s(e.rhythmFelt) : '';
      row[`${p}lying_bp`] = e && e.lyingBp ? formatBp(e.lyingBp) : '';
      row[`${p}minutes_to_settle`] = e ? s(e.minutesToSettle) : '';
      row[`${p}back_to_sleep`] = e ? e.fellBackAsleep : '';
      row[`${p}wired`] = e ? yn(e.wired) : '';
    }

    for (const slot of ['pm', 'am'] as const) {
      const o = ctx.ortho[slot];
      row[`${slot}_ortho_source`] = o ? o.reading.source : '';
      row[`${slot}_supine`] = o ? formatBp(o.reading.supine) : '';
      row[`${slot}_stand1`] = o && o.reading.standing1 ? formatBp(o.reading.standing1) : '';
      row[`${slot}_stand3`] = o && o.reading.standing3 ? formatBp(o.reading.standing3) : '';
      row[`${slot}_sys_drop3`] = o ? s(o.drop3?.systolic) : '';
      row[`${slot}_dia_drop3`] = o ? s(o.drop3?.diastolic) : '';
      row[`${slot}_pulse_rise3`] = o ? s(o.drop3?.pulseRise) : '';
      row[`${slot}_flags`] = o ? o.flags.join('; ') : '';
      row[`${slot}_recalibrate`] = o && o.needsRecalibration ? 'yes' : '';
    }

    const first = episodes.find((e) => e.capturedAt !== null);
    if (first && first.capturedAt !== null && input.samples.length > 0) {
      const t = traceStats(first.capturedAt, input.samples);
      row.spo2_nadir_pre_episode = s(t.spo2Nadir);
      row.hr_peak_pre_episode = s(t.hrPeak);
    } else {
      row.spo2_nadir_pre_episode = '';
      row.hr_peak_pre_episode = '';
    }

    row.thermal_comfort = s(log.thermalComfort);
    row.evening_notes = log.eveningNotes;
    row.morning_notes = log.morningNotes;
    row.experiment_notes = log.experimentNotes;

    // Guarantee every column exists exactly once, in order.
    const ordered: Record<string, string> = {};
    for (const c of CLINICIAN_COLUMNS) ordered[c] = row[c] ?? '';
    return ordered as ClinicianRow;
  });
}

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** RFC 4180, CRLF line endings, UTF-8 BOM prefix. */
export function toCsv(rows: readonly ClinicianRow[]): string {
  const lines = [CLINICIAN_COLUMNS.map(csvCell).join(',')];
  for (const r of rows) lines.push(CLINICIAN_COLUMNS.map((c) => csvCell(r[c as keyof ClinicianRow] ?? '')).join(','));
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

/** Minimal RFC 4180 reader (used by tests and the import preview). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell); cell = '';
    } else if (ch === '\r') {
      // handled with \n
    } else if (ch === '\n') {
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

export type GridCell = { adrenergic: number; total: number };
export type SodiumGrid = Record<SodiumLevel, Record<SleepPosition, GridCell>>;
export type MeanByLevel = Record<SodiumLevel, { mean: number | null; n: number }>;

export interface ClinicianSummary {
  nights: number;
  episodes: number;
  adrenergicNights: number;
  grid: SodiumGrid;
  meanWeightDelta: MeanByLevel;
  meanNeckDelta: MeanByLevel;
  flaggedReadings: number;
  recalibrationWarnings: number;
}

const LEVELS: SodiumLevel[] = ['normal', 'more', 'much_more'];
const POSITIONS: SleepPosition[] = ['side', 'back', 'unknown'];

function emptyGrid(): SodiumGrid {
  const g = {} as SodiumGrid;
  for (const l of LEVELS) {
    g[l] = {} as Record<SleepPosition, GridCell>;
    for (const p of POSITIONS) g[l][p] = { adrenergic: 0, total: 0 };
  }
  return g;
}

function meanBy(rows: readonly ClinicianRow[], col: 'weight_delta_lb' | 'neck_delta_in'): MeanByLevel {
  const out = {} as MeanByLevel;
  for (const l of LEVELS) {
    const vals = rows.filter((r) => r.sodium_level === l && r[col] !== '').map((r) => Number(r[col]));
    out[l] = vals.length ? { mean: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10, n: vals.length } : { mean: null, n: 0 };
  }
  return out;
}

export function summaryStats(rows: readonly ClinicianRow[]): ClinicianSummary {
  const grid = emptyGrid();
  let episodes = 0;
  let adrenergicNights = 0;
  let flaggedReadings = 0;
  let recalibrationWarnings = 0;
  for (const r of rows) {
    const n = Number(r.episode_count);
    episodes += n;
    const adrenergic = adrenergicNight({ wiredWake: r.wired_wake === 'yes', wakeUpEvents: n > 0 ? [{ source: 'episode' } as WakeUpEvent] : [] });
    adrenergicNights += adrenergic;
    const level = (LEVELS.includes(r.sodium_level as SodiumLevel) ? r.sodium_level : 'normal') as SodiumLevel;
    const pos = (POSITIONS.includes(r.position_started as SleepPosition) ? r.position_started : 'unknown') as SleepPosition;
    grid[level][pos].total += 1;
    grid[level][pos].adrenergic += adrenergic;
    if (r.am_flags) flaggedReadings += 1;
    if (r.pm_flags) flaggedReadings += 1;
    if (r.am_recalibrate === 'yes') recalibrationWarnings += 1;
    if (r.pm_recalibrate === 'yes') recalibrationWarnings += 1;
  }
  return {
    nights: rows.length,
    episodes,
    adrenergicNights,
    grid,
    meanWeightDelta: meanBy(rows, 'weight_delta_lb'),
    meanNeckDelta: meanBy(rows, 'neck_delta_in'),
    flaggedReadings,
    recalibrationWarnings,
  };
}

/** The 14 nights ending yesterday (last night is the most recent complete one). */
export function defaultRange(now: Date = new Date()): { start: string; end: string } {
  const end = addDaysToDate(toLocalDateString(now), -1);
  return { start: addDaysToDate(end, -13), end };
}
