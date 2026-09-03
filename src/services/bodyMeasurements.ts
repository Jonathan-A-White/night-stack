import { db } from '../db';
import type { BodyMeasurement, BodyMeasurementKind, NightLog, UnitSystem, WeighInPeriod } from '../types';
import { addDaysToDate, getCurrentTime } from '../utils';
import { cmToInches, inchesToCm } from '../weightUtils';

/**
 * Body measurements (specs/home-experiments/body-measurements.md, Q4/Q5).
 * Weight and neck circumference share one table; AM and PM are both
 * first-class and the overnight delta (PM → next AM, both measured) is
 * the primary metric.
 */

export function roundMeasurement(kind: BodyMeasurementKind, value: number): number {
  // Both kinds display at 0.1 resolution in imperial units.
  void kind;
  return Math.round(value * 10) / 10;
}

export function formatNeck(neckIn: number, unitSystem: UnitSystem): string {
  if (unitSystem === 'metric') return `${inchesToCm(neckIn).toFixed(1)} cm`;
  return `${neckIn.toFixed(1)} in`;
}

export function neckInputToInches(value: number, unitSystem: UnitSystem): number {
  return unitSystem === 'metric' ? cmToInches(value) : value;
}

export function neckInchesToInput(neckIn: number, unitSystem: UnitSystem): number {
  return unitSystem === 'metric' ? Math.round(inchesToCm(neckIn) * 10) / 10 : neckIn;
}

/** Step for the neck stepper in the display unit: 0.1 in or 0.25 cm. */
export function getNeckStepIn(unitSystem: UnitSystem): number {
  return unitSystem === 'metric' ? cmToInches(0.25) : 0.1;
}

function find(rows: readonly BodyMeasurement[], kind: BodyMeasurementKind, date: string, period: WeighInPeriod) {
  return rows.find((r) => r.kind === kind && r.date === date && r.period === period) ?? null;
}

/** AM(nightDate+1) − PM(nightDate), both measured; else null. */
export function overnightDelta(
  kind: BodyMeasurementKind,
  nightDate: string,
  rows: readonly BodyMeasurement[],
): number | null {
  const pm = find(rows, kind, nightDate, 'evening');
  const am = find(rows, kind, addDaysToDate(nightDate, 1), 'morning');
  if (!pm || !am || !pm.measured || !am.measured) return null;
  return roundMeasurement(kind, am.value - pm.value);
}

export interface NightDeltas {
  weightDeltaLbs: number | null;
  neckDeltaIn: number | null;
}

export function deltasForNight(nightDate: string, rows: readonly BodyMeasurement[]): NightDeltas {
  return {
    weightDeltaLbs: overnightDelta('weight', nightDate, rows),
    neckDeltaIn: overnightDelta('neck', nightDate, rows),
  };
}

/** The four values that frame a night, for tables and the export. */
export function measurementsForNight(nightDate: string, rows: readonly BodyMeasurement[]) {
  const next = addDaysToDate(nightDate, 1);
  return {
    pmWeight: find(rows, 'weight', nightDate, 'evening'),
    amWeight: find(rows, 'weight', next, 'morning'),
    pmNeck: find(rows, 'neck', nightDate, 'evening'),
    amNeck: find(rows, 'neck', next, 'morning'),
  };
}

/** PM rows link to that evening's log; AM rows to the previous evening's. */
export function nightLogIdForMeasurement(
  date: string,
  period: WeighInPeriod,
  logs: readonly Pick<NightLog, 'id' | 'date'>[],
): string | null {
  const nightDate = period === 'morning' ? addDaysToDate(date, -1) : date;
  return logs.find((l) => l.date === nightDate)?.id ?? null;
}

export interface UpsertInput {
  kind: BodyMeasurementKind;
  date: string;
  period: WeighInPeriod;
  value: number;
  nightLogId: string | null;
  measured: boolean;
  time?: string;
  timestamp?: number;
}

/** One row per (kind, date, period); re-saving updates the existing row. */
export async function upsertMeasurement(input: UpsertInput): Promise<BodyMeasurement> {
  return db.transaction('rw', db.bodyMeasurements, async () => {
    const existing = await db.bodyMeasurements
      .where('[kind+date+period]')
      .equals([input.kind, input.date, input.period])
      .first();
    const now = Date.now();
    const row: BodyMeasurement = {
      id: existing?.id ?? crypto.randomUUID(),
      kind: input.kind,
      nightLogId: input.nightLogId ?? existing?.nightLogId ?? null,
      date: input.date,
      time: input.time ?? existing?.time ?? getCurrentTime(),
      timestamp: input.timestamp ?? existing?.timestamp ?? now,
      period: input.period,
      value: roundMeasurement(input.kind, input.value),
      measured: input.measured,
      createdAt: existing?.createdAt ?? now,
    };
    await db.bodyMeasurements.put(row);
    return row;
  });
}

/** Newest measured row of a kind, or null. */
export async function latestMeasurement(kind: BodyMeasurementKind): Promise<BodyMeasurement | null> {
  const rows = await db.bodyMeasurements.where('kind').equals(kind).toArray();
  const measured = rows.filter((r) => r.measured).sort((a, b) => b.timestamp - a.timestamp);
  return measured[0] ?? null;
}

export async function measurementsForLog(nightLogId: string): Promise<BodyMeasurement[]> {
  return db.bodyMeasurements.where('nightLogId').equals(nightLogId).toArray();
}
