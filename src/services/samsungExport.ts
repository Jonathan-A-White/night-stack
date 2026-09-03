import { db } from '../db';
import type { ImportBatch, ImportBatchFile, NightLog, SleepData, VitalSample, VitalSampleKind } from '../types';
import { toLocalDateString } from '../utils';
import { buildAutoCreatedNightLog } from './episodes';
import { findDuplicateSleepData } from './sleepDataDedupe';

/**
 * Samsung Health "Download personal data" bulk importer
 * (specs/home-experiments/samsung-bulk-import.md).
 *
 * UNVERIFIED FORMAT (Q21): file and column names follow public
 * descriptions of the export. Every parser is tolerant — unknown files
 * are skipped with a note, unknown columns are reported, missing
 * values become 0/null — and the UI shows the per-file report before
 * anything is written.
 */

// ---------- file classification ----------

export type SamsungFileKind = 'sleep' | 'sleep_stage' | 'heart_rate' | 'spo2' | 'hr_binning' | 'spo2_binning';

export function classifyFile(name: string): SamsungFileKind | null {
  const base = name.split('/').pop() ?? name;
  const lower = name.toLowerCase();
  if (lower.endsWith('.json')) {
    if (lower.includes('heart_rate')) return 'hr_binning';
    if (lower.includes('oxygen_saturation') || lower.includes('spo2')) return 'spo2_binning';
    return null;
  }
  if (!base.toLowerCase().endsWith('.csv')) return null;
  if (base.includes('sleep_stage')) return 'sleep_stage';
  if (base.includes('.sleep.')) return 'sleep';
  if (base.includes('heart_rate')) return 'heart_rate';
  if (base.includes('oxygen_saturation')) return 'spo2';
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

const SLEEP_KNOWN = ['start_time', 'end_time', 'time_offset', 'sleep_score', 'efficiency', 'sleep_duration', 'datauuid', 'update_time', 'create_time', 'pkg_name', 'deviceuuid', 'comment', 'custom', 'has_sleep_data', 'combined_id', 'original_efficiency', 'original_bed_time', 'original_wake_up_time', 'quality', 'extra_data', 'data_version', 'sleep_type', 'goal_bed_time', 'goal_wake_up_time'];

export function parseSleepSessions(text: string): SleepSession[] {
  const { rows } = parseSamsungCsv(text, SLEEP_KNOWN);
  const out: SleepSession[] = [];
  for (const r of rows) {
    const start = parseUtcMs(r.start_time);
    const end = parseUtcMs(r.end_time);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const offsetMin = parseOffsetMinutes(r.time_offset);
    const durationRaw = Number(r.sleep_duration);
    out.push({
      datauuid: r.datauuid || `${start}`,
      startUtcMs: start,
      endUtcMs: end,
      offsetMin,
      nightDate: toLocalNightDate(start, offsetMin),
      sleepTime: hhmm(start, offsetMin),
      wakeTime: hhmm(end, offsetMin),
      sleepScore: Number.isFinite(Number(r.sleep_score)) && r.sleep_score !== '' ? Number(r.sleep_score) : 0,
      efficiency: r.efficiency !== '' && Number.isFinite(Number(r.efficiency)) ? Number(r.efficiency) : null,
      durationMin: Number.isFinite(durationRaw) && r.sleep_duration !== '' ? Math.round(durationRaw) : Math.round((end - start) / 60_000),
    });
  }
  return out.sort((a, b) => a.startUtcMs - b.startUtcMs);
}

/** Stage codes per public descriptions — UNVERIFIED. */
export const STAGE_CODES: Record<string, 'awake' | 'light' | 'deep' | 'rem'> = {
  '40000': 'awake',
  '40001': 'light',
  '40002': 'deep',
  '40003': 'rem',
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

export function buildSleepData(session: SleepSession, stages: readonly SleepStage[]): SleepData {
  const mine = stages.filter((st) => st.sleepId === session.datauuid || (st.startUtcMs >= session.startUtcMs && st.endUtcMs <= session.endUtcMs));
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
    // Not in the sleep CSV; per-minute samples carry the detail.
    avgHeartRate: 0,
    minHeartRate: null,
    avgRespiratoryRate: 0,
    bloodOxygenAvg: 0,
    skinTempRange: '',
    sleepLatencyRating: 'Good',
    restfulnessRating: 'Good',
    deepSleepRating: 'Good',
    remSleepRating: 'Good',
    importedAt: Date.now(),
  };
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

export function parseHeartRateCsv(text: string): HeartRateRow[] {
  const { rows } = parseSamsungCsv(text, ['start_time', 'end_time', 'time_offset', 'heart_rate', 'min', 'max', 'binning_data', 'datauuid', 'update_time', 'create_time', 'pkg_name', 'deviceuuid', 'comment', 'custom', 'heart_beat_count', 'tag_id', 'source_type']);
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
      min: r.min ? Number(r.min) : null,
      max: r.max ? Number(r.max) : null,
      binningFile: r.binning_data ? (r.binning_data.split('/').pop() ?? r.binning_data) : null,
    });
  }
  return out;
}

/** `[{start_time, end_time, heart_rate, ...}]` with epoch-ms or UTC-string times. */
export function parseHeartRateBinning(json: string): ParsedSample[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  const arr = Array.isArray(raw) ? raw : (raw as { binning_data?: unknown[] })?.binning_data;
  if (!Array.isArray(arr)) return [];
  const out: ParsedSample[] = [];
  for (const item of arr as Record<string, unknown>[]) {
    const t = typeof item.start_time === 'number' ? item.start_time : parseUtcMs(String(item.start_time ?? ''));
    const v = Number(item.heart_rate);
    if (!Number.isFinite(t) || !Number.isFinite(v) || v <= 0) continue;
    out.push({ kind: 'hr', timestamp: Math.floor(t / 60_000) * 60_000, value: v });
  }
  return out;
}

export function parseSpo2Csv(text: string): ParsedSample[] {
  const { rows } = parseSamsungCsv(text, ['start_time', 'end_time', 'time_offset', 'spo2', 'spo2_min', 'spo2_max', 'heart_rate', 'datauuid', 'update_time', 'create_time', 'pkg_name', 'deviceuuid', 'comment', 'custom', 'binning', 'binning_data']);
  const out: ParsedSample[] = [];
  for (const r of rows) {
    const t = parseUtcMs(r.start_time);
    const v = Number(r.spo2);
    if (!Number.isFinite(t) || !Number.isFinite(v) || v <= 0) continue;
    out.push({ kind: 'spo2', timestamp: Math.floor(t / 60_000) * 60_000, value: v });
  }
  return out;
}

export function parseSpo2Binning(json: string): ParsedSample[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  const arr = Array.isArray(raw) ? raw : (raw as { binning_data?: unknown[] })?.binning_data;
  if (!Array.isArray(arr)) return [];
  const out: ParsedSample[] = [];
  for (const item of arr as Record<string, unknown>[]) {
    const t = typeof item.start_time === 'number' ? item.start_time : parseUtcMs(String(item.start_time ?? ''));
    const v = Number(item.spo2 ?? item.oxygen_saturation);
    if (!Number.isFinite(t) || !Number.isFinite(v) || v <= 0) continue;
    out.push({ kind: 'spo2', timestamp: Math.floor(t / 60_000) * 60_000, value: v });
  }
  return out;
}

/** Night whose overnight window (21:00 local on `date` → 12:00 next day) contains `ts`. */
export function assignNight(ts: number, nights: readonly { id: string; date: string }[]): string | null {
  for (const n of nights) {
    const [y, m, d] = n.date.split('-').map(Number);
    const start = new Date(y, m - 1, d, 21, 0, 0, 0).getTime();
    const end = new Date(y, m - 1, d + 1, 12, 0, 0, 0).getTime();
    if (ts >= start && ts < end) return n.id;
  }
  return null;
}

// ---------- plan + run ----------

export interface ImportFile {
  name: string;
  text: string;
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

export async function planImport(files: readonly ImportFile[], existingLogs: readonly NightLog[]): Promise<ImportPlan> {
  const report: ImportBatchFile[] = [];
  const sessions: SleepSession[] = [];
  const stages: SleepStage[] = [];
  const samples: ParsedSample[] = [];
  const binningByName = new Map<string, string>();

  for (const f of files) {
    const kind = classifyFile(f.name);
    if (kind === 'hr_binning' || kind === 'spo2_binning') binningByName.set(f.name.split('/').pop() ?? f.name, f.text);
  }

  for (const f of files) {
    const kind = classifyFile(f.name);
    if (!kind) {
      report.push({ name: f.name, recognized: false, rows: 0, note: 'not used' });
      continue;
    }
    try {
      switch (kind) {
        case 'sleep': {
          const s = parseSleepSessions(f.text);
          sessions.push(...s);
          const env = parseSamsungCsv(f.text, SLEEP_KNOWN);
          report.push({ name: f.name, recognized: true, rows: s.length, note: env.unrecognized.length ? `ignored columns: ${env.unrecognized.join(', ')}` : '' });
          break;
        }
        case 'sleep_stage': {
          const st = parseSleepStages(f.text);
          stages.push(...st);
          report.push({ name: f.name, recognized: true, rows: st.length, note: st.some((x) => x.stage === 'unknown') ? 'some stage codes unknown' : '' });
          break;
        }
        case 'heart_rate': {
          const rows = parseHeartRateCsv(f.text);
          let binned = 0;
          for (const r of rows) {
            const json = r.binningFile ? binningByName.get(r.binningFile) : undefined;
            if (json) {
              const s = parseHeartRateBinning(json);
              samples.push(...s);
              binned += s.length;
            } else {
              samples.push({ kind: 'hr', timestamp: Math.floor(r.startUtcMs / 60_000) * 60_000, value: r.heartRate });
            }
          }
          report.push({ name: f.name, recognized: true, rows: rows.length, note: binned ? `${binned} per-minute samples from binning files` : 'no binning files matched; one sample per row' });
          break;
        }
        case 'spo2': {
          const s = parseSpo2Csv(f.text);
          samples.push(...s);
          report.push({ name: f.name, recognized: true, rows: s.length, note: '' });
          break;
        }
        case 'hr_binning':
        case 'spo2_binning':
          report.push({ name: f.name, recognized: true, rows: 0, note: 'referenced from a CSV row' });
          break;
      }
    } catch (e) {
      report.push({ name: f.name, recognized: false, rows: 0, note: `parse error: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  const nights: NightPlan[] = [];
  const seen = new Set<string>();
  for (const session of sessions) {
    if (seen.has(session.nightDate)) continue; // first (earliest) session per night wins
    seen.add(session.nightDate);
    const sleepData = buildSleepData(session, stages);
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

  // Dedupe samples on (kind, timestamp).
  const key = (s: ParsedSample) => `${s.kind}:${s.timestamp}`;
  const uniq = new Map<string, ParsedSample>();
  for (const s of samples) uniq.set(key(s), s);

  return { report, nights: nights.sort((a, b) => a.nightDate.localeCompare(b.nightDate)), samples: [...uniq.values()].sort((a, b) => a.timestamp - b.timestamp) };
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
  const nights = (await db.nightLogs.toArray()).map((l) => ({ id: l.id, date: l.date }));
  const rows: VitalSample[] = plan.samples.map((s) => ({
    kind: s.kind as VitalSampleKind,
    timestamp: s.timestamp,
    value: s.value,
    nightLogId: assignNight(s.timestamp, nights),
    importBatchId: batch.id,
  }));
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.vitalSamples.bulkPut(rows.slice(i, i + CHUNK));
  }

  await db.importBatches.add(batch);
  return batch;
}
