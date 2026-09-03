import { db } from '../db';
import type { ImportBatch, ImportBatchFile, NightLog, SleepData, VitalSample, VitalSampleKind } from '../types';
import { toLocalDateString } from '../utils';
import { buildAutoCreatedNightLog } from './episodes';
import { findDuplicateSleepData } from './sleepDataDedupe';

/**
 * Samsung Health "Download personal data" bulk importer
 * (specs/home-experiments/samsung-bulk-import.md).
 *
 * Format verified against a real export (2026-09-03, Samsung Health
 * 7006003): ~30 top-level CSVs plus a `jsons/<dataset>/<hex>/` tree of
 * ~10k per-record JSON blobs. Only a handful of those files matter to
 * the app, so the plan classifies every file by name first and reads
 * only the ones it will parse. Every parser stays tolerant — unknown
 * files are reported as skipped, unknown columns are listed, missing
 * values become 0/null — and the UI shows the report before writing.
 */

// ---------- file classification ----------

export type SamsungFileKind =
  | 'sleep'
  | 'sleep_stage'
  | 'heart_rate'
  | 'spo2'
  | 'respiratory_rate'
  | 'skin_temperature'
  | 'hr_binning'
  | 'spo2_binning';

export function classifyFile(name: string): SamsungFileKind | null {
  const base = name.split('/').pop() ?? name;
  const lower = name.toLowerCase();
  // `*.raw` datasets (e.g. oxygen_saturation.raw: 28 MB of per-second
  // sensor channels) carry no values the app can use.
  if (lower.includes('.raw/') || lower.includes('.raw.')) return null;
  if (lower.endsWith('.json')) {
    if (lower.includes('heart_rate') && lower.endsWith('binning_data.json')) return 'hr_binning';
    if (lower.includes('oxygen_saturation') && lower.endsWith('binning.json')) return 'spo2_binning';
    return null;
  }
  if (!base.toLowerCase().endsWith('.csv')) return null;
  if (base.includes('sleep_stage')) return 'sleep_stage';
  if (base.includes('.sleep.')) return 'sleep';
  if (base.includes('heart_rate')) return 'heart_rate';
  if (base.includes('oxygen_saturation')) return 'spo2';
  if (base.includes('respiratory_rate')) return 'respiratory_rate';
  if (base.includes('skin_temperature')) return 'skin_temperature';
  return null;
}

// ---------- CSV envelope ----------

export interface SamsungCsv {
  columns: string[];
  rows: Record<string, string>[];
  unrecognized: string[];
}

function stripPrefix(col: string): string {
  // "com.samsung.health.sleep.start_time" → "start_time"
  const m = col.match(/^com\.samsung\.[a-z_.]*\.([a-z_0-9]+)$/i);
  return (m ? m[1] : col).trim();
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cell); cell = ''; }
    else cell += ch;
  }
  out.push(cell);
  return out;
}

/** Skip Samsung's metadata line 1; header is line 2; strip column prefixes. */
export function parseSamsungCsv(text: string, known: readonly string[] = []): SamsungCsv {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { columns: [], rows: [], unrecognized: [] };
  const first = lines[0];
  const headerIdx = first.startsWith('com.samsung.') && !first.includes('start_time') ? 1 : 0;
  const columns = splitCsvLine(lines[headerIdx]).map(stripPrefix);
  const rows: Record<string, string>[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const row: Record<string, string> = {};
    columns.forEach((c, j) => { row[c] = (cells[j] ?? '').trim(); });
    rows.push(row);
  }
  const unrecognized = known.length ? columns.filter((c) => !known.includes(c)) : [];
  return { columns, rows, unrecognized };
}

// ---------- time helpers ----------

/** "UTC-0400" → -240; anything unparseable → 0. */
export function parseOffsetMinutes(v: string | undefined): number {
  const m = (v ?? '').match(/UTC([+-])(\d{2})(\d{2})/i);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/** Samsung "YYYY-MM-DD HH:MM:SS.sss" (UTC) → epoch ms; NaN when unparseable. */
export function parseUtcMs(v: string | undefined): number {
  if (!v) return NaN;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?/);
  if (m) {
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0), +((m[7] ?? '0').slice(0, 3).padEnd(3, '0')));
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function localParts(utcMs: number, offsetMin: number) {
  const d = new Date(utcMs + offsetMin * 60_000);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
}

function hhmm(utcMs: number, offsetMin: number): string {
  const p = localParts(utcMs, offsetMin);
  return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
}

/** Evening date a session belongs to: local start before noon → previous day. */
export function toLocalNightDate(startUtc: string | number, offsetMin: number): string {
  const ms = typeof startUtc === 'number' ? startUtc : parseUtcMs(startUtc);
  const p = localParts(ms, offsetMin);
  const local = new Date(p.y, p.mo, p.d);
  if (p.h < 12) local.setDate(local.getDate() - 1);
  return toLocalDateString(local);
}

const num = (v: string | undefined): number | null => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

// ---------- sleep ----------

export interface SleepSession {
  datauuid: string;
  startUtcMs: number;
  endUtcMs: number;
  offsetMin: number;
  nightDate: string;
  sleepTime: string;
  wakeTime: string;
  sleepScore: number;
  efficiency: number | null;
  durationMin: number;
}

const COMMON_COLS = ['start_time', 'end_time', 'time_offset', 'datauuid', 'update_time', 'create_time', 'pkg_name', 'deviceuuid', 'comment', 'custom', 'create_sh_ver', 'modify_sh_ver', 'client_data_id', 'client_data_ver', 'binning_data', 'binning'];

/** Columns the importer reads or knowingly ignores; the rest of the sleep CSV (score factors, weights, latency) is listed in the report as ignored. */
const SLEEP_KNOWN = [...COMMON_COLS, 'sleep_score', 'efficiency', 'sleep_duration', 'has_sleep_data', 'combined_id', 'original_efficiency', 'original_bed_time', 'original_wake_up_time', 'quality', 'extra_data', 'data_version', 'sleep_type', 'goal_bed_time', 'goal_wake_up_time', 'integrated_id', 'is_integrated', 'stage_analyzed_type'];

function sessionsFromRows(rows: readonly Record<string, string>[]): SleepSession[] {
  const out: SleepSession[] = [];
  for (const r of rows) {
    const start = parseUtcMs(r.start_time);
    const end = parseUtcMs(r.end_time);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const offsetMin = parseOffsetMinutes(r.time_offset);
    const durationRaw = num(r.sleep_duration);
    out.push({
      datauuid: r.datauuid || `${start}`,
      startUtcMs: start,
      endUtcMs: end,
      offsetMin,
      nightDate: toLocalNightDate(start, offsetMin),
      sleepTime: hhmm(start, offsetMin),
      wakeTime: hhmm(end, offsetMin),
      sleepScore: num(r.sleep_score) ?? 0,
      efficiency: num(r.efficiency),
      durationMin: durationRaw !== null ? Math.round(durationRaw) : Math.round((end - start) / 60_000),
    });
  }
  return out.sort((a, b) => a.startUtcMs - b.startUtcMs);
}

export function parseSleepSessions(text: string): SleepSession[] {
  return sessionsFromRows(parseSamsungCsv(text, SLEEP_KNOWN).rows);
}

/**
 * Stage codes, verified against the 2026-09-03 export: summing each
 * code's minutes per `sleep_id` reproduces the sleep CSV's
 * `total_light_duration` (40002) and `total_rem_duration` (40004)
 * exactly, and `sleep_duration` is the sum of all four.
 */
export const STAGE_CODES: Record<string, 'awake' | 'light' | 'deep' | 'rem'> = {
  '40001': 'awake',
  '40002': 'light',
  '40003': 'deep',
  '40004': 'rem',
};

export interface SleepStage {
  startUtcMs: number;
  endUtcMs: number;
  stage: 'awake' | 'light' | 'deep' | 'rem' | 'unknown';
  sleepId: string;
}

export function parseSleepStages(text: string): SleepStage[] {
  const { rows } = parseSamsungCsv(text, ['start_time', 'end_time', 'stage', 'sleep_id', 'datauuid', 'update_time', 'create_time', 'time_offset', 'pkg_name', 'deviceuuid']);
  const out: SleepStage[] = [];
  for (const r of rows) {
    const s = parseUtcMs(r.start_time);
    const e = parseUtcMs(r.end_time);
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
    out.push({ startUtcMs: s, endUtcMs: e, stage: STAGE_CODES[r.stage] ?? 'unknown', sleepId: r.sleep_id ?? '' });
  }
  return out;
}

/** Per-session vitals from the sibling CSVs and the per-minute HR samples. */
export interface SessionVitals {
  avgHeartRate?: number | null;
  minHeartRate?: number | null;
  avgRespiratoryRate?: number | null;
  bloodOxygenAvg?: number | null;
  skinTempRange?: string;
}

export function buildSleepData(session: SleepSession, stages: readonly SleepStage[], vitals: SessionVitals = {}): SleepData {
  const byId = stages.filter((st) => st.sleepId === session.datauuid);
  const mine = byId.length > 0 ? byId : stages.filter((st) => st.startUtcMs >= session.startUtcMs && st.endUtcMs <= session.endUtcMs);
  const mins = (kind: SleepStage['stage']) =>
    Math.round(mine.filter((st) => st.stage === kind).reduce((a, st) => a + (st.endUtcMs - st.startUtcMs), 0) / 60_000);
  const deep = mins('deep');
  const light = mins('light');
  const rem = mins('rem');
  const awake = mins('awake');
  const hasStages = mine.length > 0;
  const total = hasStages ? deep + light + rem + awake : session.durationMin;
  const actual = hasStages ? deep + light + rem : session.durationMin;
  return {
    sleepTime: session.sleepTime,
    wakeTime: session.wakeTime,
    totalSleepDuration: total,
    actualSleepDuration: actual,
    sleepScore: session.sleepScore,
    sleepScoreDelta: 0,
    deepSleep: deep,
    remSleep: rem,
    lightSleep: light,
    awakeDuration: awake,
    avgHeartRate: vitals.avgHeartRate ?? 0,
    minHeartRate: vitals.minHeartRate ?? null,
    avgRespiratoryRate: vitals.avgRespiratoryRate ?? 0,
    bloodOxygenAvg: vitals.bloodOxygenAvg ?? 0,
    skinTempRange: vitals.skinTempRange ?? '',
    sleepLatencyRating: 'Good',
    restfulnessRating: 'Good',
    deepSleepRating: 'Good',
    remSleepRating: 'Good',
    importedAt: Date.now(),
  };
}

// ---------- per-session vitals CSVs ----------

/** A row of a per-session vitals CSV; `startUtcMs` equals the sleep session's start in real exports. */
export interface VitalsRow {
  startUtcMs: number;
  endUtcMs: number;
  values: Record<string, number | null>;
}

function parseVitalsRows(text: string, known: readonly string[], fields: readonly string[]): { rows: VitalsRow[]; unrecognized: string[] } {
  const env = parseSamsungCsv(text, known);
  const rows: VitalsRow[] = [];
  for (const r of env.rows) {
    const s = parseUtcMs(r.start_time);
    if (!Number.isFinite(s)) continue;
    const e = parseUtcMs(r.end_time);
    const values: Record<string, number | null> = {};
    for (const f of fields) values[f] = num(r[f]);
    rows.push({ startUtcMs: s, endUtcMs: Number.isFinite(e) ? e : s, values });
  }
  return { rows, unrecognized: env.unrecognized };
}

/** `com.samsung.health.respiratory_rate`: one row per sleep session, `average` breaths/min. */
export function parseRespiratoryRates(text: string) {
  return parseVitalsRows(text, [...COMMON_COLS, 'average', 'lower_limit', 'upper_limit', 'is_outlier', 'pplib_version'], ['average']);
}

/** `com.samsung.health.skin_temperature`: one row per sleep session, `min`/`max`/`temperature` in °C. */
export function parseSkinTemperatures(text: string) {
  return parseVitalsRows(text, [...COMMON_COLS, 'min', 'max', 'temperature', 'baseline', 'stat_m1', 'stat_m2', 'stat_n', 'tag_id', 'lower_bound', 'upper_bound'], ['min', 'max', 'temperature']);
}

/** Row of the session-level vitals CSV whose start lies inside the session (exact start match preferred). */
export function pickForSession(rows: readonly VitalsRow[], session: SleepSession): VitalsRow | null {
  let inside: VitalsRow | null = null;
  for (const r of rows) {
    if (r.startUtcMs === session.startUtcMs) return r;
    if (!inside && r.startUtcMs >= session.startUtcMs && r.startUtcMs < session.endUtcMs) inside = r;
  }
  return inside;
}

export function formatSkinTempRange(row: VitalsRow | null): string {
  if (!row) return '';
  const lo = row.values.min;
  const hi = row.values.max;
  if (lo !== null && hi !== null) return `${lo.toFixed(1)}-${hi.toFixed(1)}°C`;
  const t = row.values.temperature;
  return t !== null ? `${t.toFixed(1)}°C` : '';
}

// ---------- per-minute samples ----------

export type ParsedSample = Pick<VitalSample, 'kind' | 'timestamp' | 'value'>;

export interface HeartRateRow {
  startUtcMs: number;
  endUtcMs: number;
  offsetMin: number;
  heartRate: number;
  min: number | null;
  max: number | null;
  binningFile: string | null;
}

const baseName = (p: string) => p.split('/').pop() ?? p;

export function parseHeartRateCsv(text: string): HeartRateRow[] {
  const { rows } = parseSamsungCsv(text, [...COMMON_COLS, 'heart_rate', 'min', 'max', 'heart_beat_count', 'tag_id', 'source', 'source_type']);
  const out: HeartRateRow[] = [];
  for (const r of rows) {
    const s = parseUtcMs(r.start_time);
    if (!Number.isFinite(s)) continue;
    const e = parseUtcMs(r.end_time);
    out.push({
      startUtcMs: s,
      endUtcMs: Number.isFinite(e) ? e : s,
      offsetMin: parseOffsetMinutes(r.time_offset),
      heartRate: Number(r.heart_rate) || 0,
      min: num(r.min),
      max: num(r.max),
      binningFile: r.binning_data ? baseName(r.binning_data) : null,
    });
  }
  return out;
}

function parseBinningArray(json: string): Record<string, unknown>[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const arr = Array.isArray(raw) ? raw : (raw as { binning_data?: unknown[] })?.binning_data;
  return Array.isArray(arr) ? (arr as Record<string, unknown>[]) : null;
}

const minuteFloor = (t: number) => Math.floor(t / 60_000) * 60_000;

/** `[{start_time, end_time, heart_rate, heart_rate_min, heart_rate_max}]` with epoch-ms times, one entry per minute. */
export function parseHeartRateBinning(json: string): ParsedSample[] {
  const arr = parseBinningArray(json);
  if (!arr) return [];
  const out: ParsedSample[] = [];
  for (const item of arr) {
    const t = typeof item.start_time === 'number' ? item.start_time : parseUtcMs(String(item.start_time ?? ''));
    const v = Number(item.heart_rate);
    if (!Number.isFinite(t) || !Number.isFinite(v) || v <= 0) continue;
    out.push({ kind: 'hr', timestamp: minuteFloor(t), value: v });
  }
  return out;
}

export interface Spo2Row {
  startUtcMs: number;
  endUtcMs: number;
  offsetMin: number;
  spo2: number | null;
  min: number | null;
  max: number | null;
  binningFile: string | null;
}

/** `com.samsung.shealth.tracker.oxygen_saturation`: one row per sleep session with session avg/min/max and a `binning` file of ~10-minute bins. */
export function parseSpo2Rows(text: string): Spo2Row[] {
  const { rows } = parseSamsungCsv(text, [...COMMON_COLS, 'spo2', 'spo2_min', 'spo2_max', 'min', 'max', 'heart_rate', 'low_duration', 'coverage_rate', 'integrated_id', 'source', 'tag_id']);
  const out: Spo2Row[] = [];
  for (const r of rows) {
    const s = parseUtcMs(r.start_time);
    if (!Number.isFinite(s)) continue;
    const e = parseUtcMs(r.end_time);
    const ref = r.binning || r.binning_data;
    out.push({
      startUtcMs: s,
      endUtcMs: Number.isFinite(e) ? e : s,
      offsetMin: parseOffsetMinutes(r.time_offset),
      spo2: num(r.spo2),
      min: num(r.min) ?? num(r.spo2_min),
      max: num(r.max) ?? num(r.spo2_max),
      binningFile: ref ? baseName(ref) : null,
    });
  }
  return out;
}

/** One sample per CSV row (the session average); binning files add the per-bin detail in `planImport`. */
export function parseSpo2Csv(text: string): ParsedSample[] {
  const out: ParsedSample[] = [];
  for (const r of parseSpo2Rows(text)) {
    if (r.spo2 === null || r.spo2 <= 0) continue;
    out.push({ kind: 'spo2', timestamp: minuteFloor(r.startUtcMs), value: r.spo2 });
  }
  return out;
}

/** `[{start_time, end_time, spo2, spo2_min, spo2_max}]` with epoch-ms times. */
export function parseSpo2Binning(json: string): ParsedSample[] {
  const arr = parseBinningArray(json);
  if (!arr) return [];
  const out: ParsedSample[] = [];
  for (const item of arr) {
    const t = typeof item.start_time === 'number' ? item.start_time : parseUtcMs(String(item.start_time ?? ''));
    const v = Number(item.spo2 ?? item.oxygen_saturation);
    if (!Number.isFinite(t) || !Number.isFinite(v) || v <= 0) continue;
    out.push({ kind: 'spo2', timestamp: minuteFloor(t), value: v });
  }
  return out;
}

// ---------- night assignment ----------

/** Precomputed overnight windows (21:00 local on `date` → 12:00 next day), sorted for binary search. */
export function makeNightAssigner(nights: readonly { id: string; date: string }[]): (ts: number) => string | null {
  const windows = nights
    .map((n) => {
      const [y, m, d] = n.date.split('-').map(Number);
      return { id: n.id, start: new Date(y, m - 1, d, 21, 0, 0, 0).getTime(), end: new Date(y, m - 1, d + 1, 12, 0, 0, 0).getTime() };
    })
    .sort((a, b) => a.start - b.start);
  return (ts: number) => {
    let lo = 0;
    let hi = windows.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const w = windows[mid];
      if (ts < w.start) hi = mid - 1;
      else if (ts >= w.end) lo = mid + 1;
      else return w.id;
    }
    return null;
  };
}

/** Night whose overnight window (21:00 local on `date` → 12:00 next day) contains `ts`. */
export function assignNight(ts: number, nights: readonly { id: string; date: string }[]): string | null {
  return makeNightAssigner(nights)(ts);
}

// ---------- plan + run ----------

/**
 * A file offered to the importer. `text` may be a loader so the plan
 * reads only the files it recognises — a real export holds ~10k JSON
 * blobs (140 MB) of which ~1,200 (15 MB) are used.
 */
export interface ImportFile {
  name: string;
  text: string | (() => Promise<string>);
}

export interface NightPlan {
  nightDate: string;
  session: SleepSession;
  sleepData: SleepData;
  status: 'new' | 'has_data';
  duplicateOf: string | null;
  selected: boolean;
  existingLogId: string | null;
}

export interface ImportPlan {
  report: ImportBatchFile[];
  nights: NightPlan[];
  samples: ParsedSample[];
}

export interface PlanOptions {
  /** Called as recognised files finish loading; `total` grows once the CSVs reveal which binning files are needed. */
  onProgress?: (done: number, total: number) => void;
  /** Parallel file reads (browser `File.text()` calls). */
  concurrency?: number;
  /**
   * Only sessions ending at or after this epoch-ms instant (and samples
   * at or after it) are planned; binning files referenced only by older
   * rows are never read. Samsung can only export the full history, so
   * the page defaults this to the last night. `null`/undefined = all.
   */
  sinceMs?: number | null;
}

/**
 * Report key for a file: CSVs are listed individually; the per-record
 * JSON blobs under `jsons/<dataset>/<hex>/` collapse to one line per
 * dataset so a 10k-file export yields a report of a few dozen lines.
 */
export function reportGroup(name: string): string | null {
  if (!name.toLowerCase().endsWith('.json')) return null;
  const parts = name.split('/');
  if (parts.length < 2) return null;
  const i = parts.findIndex((p) => p.toLowerCase() === 'jsons');
  if (i >= 0 && i + 1 < parts.length - 1) return parts.slice(0, i + 2).join('/');
  return parts.slice(0, -1).join('/');
}

async function loadText(f: ImportFile): Promise<string> {
  return typeof f.text === 'string' ? f.text : f.text();
}

/** Bounded-concurrency loader that reports cumulative progress across phases. */
class Loader {
  private done = 0;
  private total = 0;
  constructor(private readonly opts: PlanOptions) {}

  async load(files: readonly ImportFile[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    this.total += files.length;
    this.opts.onProgress?.(this.done, this.total);
    const workers = Math.max(1, this.opts.concurrency ?? 8);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(workers, files.length) }, async () => {
        while (next < files.length) {
          const f = files[next++];
          out.set(f.name, await loadText(f));
          this.done++;
          this.opts.onProgress?.(this.done, this.total);
        }
      }),
    );
    return out;
  }
}

function average(values: readonly number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** Samples (sorted by timestamp) of `kind` inside [start, end]. */
function samplesWithin(sorted: readonly ParsedSample[], kind: VitalSampleKind, start: number, end: number): number[] {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].timestamp < start) lo = mid + 1;
    else hi = mid;
  }
  const out: number[] = [];
  for (let i = lo; i < sorted.length && sorted[i].timestamp <= end; i++) {
    if (sorted[i].kind === kind) out.push(sorted[i].value);
  }
  return out;
}

const columnsNote = (unrecognized: readonly string[]) => (unrecognized.length ? `ignored columns: ${unrecognized.join(', ')}` : '');

/**
 * Two-phase plan: read the handful of CSVs first, then only the binning
 * JSON files that in-range rows reference. Nothing is written.
 */
export async function planImport(files: readonly ImportFile[], existingLogs: readonly NightLog[], opts: PlanOptions = {}): Promise<ImportPlan> {
  const since = opts.sinceMs ?? -Infinity;
  const report: ImportBatchFile[] = [];
  const csvs: ImportFile[] = [];
  const binningFiles = new Map<string, ImportFile>();
  const groups = new Map<string, { recognized: boolean; count: number; read: number }>();

  for (const f of files) {
    const kind = classifyFile(f.name);
    if (kind === 'hr_binning' || kind === 'spo2_binning') binningFiles.set(baseName(f.name), f);
    else if (kind) csvs.push(f);
    const g = reportGroup(f.name);
    if (!g) {
      if (!kind) report.push({ name: f.name, recognized: false, rows: 0, note: 'not used' });
    } else {
      const cur = groups.get(g);
      if (cur) cur.count++;
      else groups.set(g, { recognized: kind !== null, count: 1, read: 0 });
    }
  }

  // Phase 1: CSVs.
  const loader = new Loader(opts);
  const texts = await loader.load(csvs);

  let sessions: SleepSession[] = [];
  const stages: SleepStage[] = [];
  let hrRows: HeartRateRow[] = [];
  let spo2Rows: Spo2Row[] = [];
  const respRows: VitalsRow[] = [];
  const tempRows: VitalsRow[] = [];
  const pending: { name: string; rows: number; inRange: number; kind: 'heart_rate' | 'spo2' }[] = [];

  for (const f of csvs) {
    const kind = classifyFile(f.name);
    const text = texts.get(f.name) ?? '';
    try {
      switch (kind) {
        case 'sleep': {
          const env = parseSamsungCsv(text, SLEEP_KNOWN);
          const all = sessionsFromRows(env.rows);
          const kept = all.filter((s) => s.endUtcMs >= since);
          sessions = sessions.concat(kept);
          report.push({ name: f.name, recognized: true, rows: all.length, note: [kept.length !== all.length ? `${kept.length} in range` : '', columnsNote(env.unrecognized)].filter(Boolean).join(' · ') });
          break;
        }
        case 'sleep_stage': {
          const st = parseSleepStages(text);
          stages.push(...st);
          report.push({ name: f.name, recognized: true, rows: st.length, note: st.some((x) => x.stage === 'unknown') ? 'some stage codes unknown' : '' });
          break;
        }
        case 'heart_rate': {
          const all = parseHeartRateCsv(text);
          hrRows = hrRows.concat(all.filter((r) => r.endUtcMs >= since));
          pending.push({ name: f.name, rows: all.length, inRange: hrRows.length, kind: 'heart_rate' });
          break;
        }
        case 'spo2': {
          const all = parseSpo2Rows(text);
          spo2Rows = spo2Rows.concat(all.filter((r) => r.endUtcMs >= since));
          pending.push({ name: f.name, rows: all.length, inRange: spo2Rows.length, kind: 'spo2' });
          break;
        }
        case 'respiratory_rate': {
          const { rows, unrecognized } = parseRespiratoryRates(text);
          respRows.push(...rows);
          report.push({ name: f.name, recognized: true, rows: rows.length, note: columnsNote(unrecognized) });
          break;
        }
        case 'skin_temperature': {
          const { rows, unrecognized } = parseSkinTemperatures(text);
          tempRows.push(...rows);
          report.push({ name: f.name, recognized: true, rows: rows.length, note: columnsNote(unrecognized) });
          break;
        }
        case 'hr_binning':
        case 'spo2_binning':
        case null:
          break;
      }
    } catch (e) {
      report.push({ name: f.name, recognized: false, rows: 0, note: `parse error: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  // Phase 2: only the binning files that in-range rows reference.
  const referenced: ImportFile[] = [];
  const seenRef = new Set<string>();
  for (const r of [...hrRows, ...spo2Rows]) {
    const f = r.binningFile ? binningFiles.get(r.binningFile) : undefined;
    if (f && !seenRef.has(f.name)) {
      seenRef.add(f.name);
      referenced.push(f);
    }
  }
  const binning = await loader.load(referenced);
  for (const f of referenced) {
    const g = reportGroup(f.name);
    const cur = g ? groups.get(g) : undefined;
    if (cur) cur.read++;
  }

  const samples: ParsedSample[] = [];
  for (const p of pending) {
    let binned = 0;
    if (p.kind === 'heart_rate') {
      for (const r of hrRows) {
        const json = r.binningFile ? binning.get(binningFiles.get(r.binningFile)?.name ?? '') : undefined;
        if (json) {
          const s = parseHeartRateBinning(json);
          samples.push(...s);
          binned += s.length;
        } else if (r.heartRate > 0) {
          samples.push({ kind: 'hr', timestamp: minuteFloor(r.startUtcMs), value: r.heartRate });
        }
      }
    } else {
      for (const r of spo2Rows) {
        const json = r.binningFile ? binning.get(binningFiles.get(r.binningFile)?.name ?? '') : undefined;
        const s = json ? parseSpo2Binning(json) : [];
        if (s.length) {
          samples.push(...s);
          binned += s.length;
        } else if (r.spo2 !== null && r.spo2 > 0) {
          samples.push({ kind: 'spo2', timestamp: minuteFloor(r.startUtcMs), value: r.spo2 });
        }
      }
    }
    const range = p.inRange !== p.rows ? `${p.inRange} in range` : '';
    const detail = binned ? `${binned} samples from binning files` : 'no binning files matched; one sample per row';
    report.push({ name: p.name, recognized: true, rows: p.rows, note: [range, detail].filter(Boolean).join(' · ') });
  }

  for (const [name, g] of groups) {
    const files = `${g.count} file${g.count === 1 ? '' : 's'}`;
    report.push({ name, recognized: g.recognized, rows: 0, note: g.recognized ? `${files} · ${g.read} read for the selected range` : `${files} · not used` });
  }

  // Dedupe samples on (kind, timestamp), drop out-of-range ones, and sort so per-session lookups can binary-search.
  const uniq = new Map<string, ParsedSample>();
  for (const s of samples) if (s.timestamp >= since) uniq.set(`${s.kind}:${s.timestamp}`, s);
  const sortedSamples = [...uniq.values()].sort((a, b) => a.timestamp - b.timestamp);

  const spo2AsVitals: VitalsRow[] = spo2Rows.map((r) => ({ startUtcMs: r.startUtcMs, endUtcMs: r.endUtcMs, values: { spo2: r.spo2, min: r.min } }));

  const nights: NightPlan[] = [];
  const seen = new Set<string>();
  for (const session of sessions) {
    if (seen.has(session.nightDate)) continue; // first (earliest) session per night wins
    seen.add(session.nightDate);
    const hr = samplesWithin(sortedSamples, 'hr', session.startUtcMs, session.endUtcMs);
    const hrAvg = average(hr);
    const resp = pickForSession(respRows, session);
    const spo2 = pickForSession(spo2AsVitals, session);
    const vitals: SessionVitals = {
      avgHeartRate: hrAvg === null ? null : Math.round(hrAvg),
      minHeartRate: hr.length ? Math.round(Math.min(...hr)) : null,
      avgRespiratoryRate: resp?.values.average != null ? Math.round(resp.values.average * 10) / 10 : null,
      bloodOxygenAvg: spo2?.values.spo2 != null ? Math.round(spo2.values.spo2) : null,
      skinTempRange: formatSkinTempRange(pickForSession(tempRows, session)),
    };
    const sleepData = buildSleepData(session, stages, vitals);
    const existing = existingLogs.find((l) => l.date === session.nightDate) ?? null;
    const hasData = existing !== null && existing.sleepData !== null;
    const dup = findDuplicateSleepData(sleepData, session.nightDate, existingLogs, { excludeLogId: existing?.id });
    nights.push({
      nightDate: session.nightDate,
      session,
      sleepData,
      status: hasData ? 'has_data' : 'new',
      duplicateOf: dup ? dup.date : null,
      selected: !hasData && !dup,
      existingLogId: existing?.id ?? null,
    });
  }

  return { report, nights: nights.sort((a, b) => a.nightDate.localeCompare(b.nightDate)), samples: sortedSamples };
}

const CHUNK = 1000;

export async function runImport(plan: ImportPlan): Promise<ImportBatch> {
  const batch: ImportBatch = {
    id: crypto.randomUUID(),
    importedAt: Date.now(),
    source: 'samsung_export',
    files: plan.report,
  };

  // 1. Nights: create auto-created rows or fill sleepData on selected nights.
  for (const n of plan.nights) {
    if (!n.selected) continue;
    await db.transaction('rw', db.nightLogs, db.alarmSchedules, async () => {
      const existing = await db.nightLogs.where('date').equals(n.nightDate).first();
      if (existing) {
        await db.nightLogs.update(existing.id, { sleepData: n.sleepData, updatedAt: Date.now() });
      } else {
        const log = await buildAutoCreatedNightLog(n.nightDate);
        log.sleepData = n.sleepData;
        await db.nightLogs.put(log);
      }
    });
  }

  // 2. Samples: assign to nights (all nights, not just selected) and bulkPut in chunks.
  const assign = makeNightAssigner((await db.nightLogs.toArray()).map((l) => ({ id: l.id, date: l.date })));
  const rows: VitalSample[] = plan.samples.map((s) => ({
    kind: s.kind as VitalSampleKind,
    timestamp: s.timestamp,
    value: s.value,
    nightLogId: assign(s.timestamp),
    importBatchId: batch.id,
  }));
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.vitalSamples.bulkPut(rows.slice(i, i + CHUNK));
  }

  await db.importBatches.add(batch);
  return batch;
}
