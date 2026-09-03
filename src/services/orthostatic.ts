import { db } from '../db';
import type { BpPoint, OrthostaticReading, OrthostaticSlot } from '../types';
import { addDaysToDate } from '../utils';

/**
 * Orthostatic vitals (specs/home-experiments/vitals.md).
 *
 * Everything derived from a reading is computed here at read time and never
 * stored: drops and pulse rise per standing point, the three flags, and the
 * watch-calibration warning. Flags use the common clinical thresholds and
 * are only ever labelled "bring this to your doctor" in the UI.
 */

export type OrthostaticFlag = 'systolic_drop' | 'diastolic_drop' | 'pulse_rise_without_drop';

export interface StandingDelta {
  systolic: number; // supine − standing (positive = drop)
  diastolic: number;
  pulseRise: number; // standing − supine
}

export interface OrthostaticDerived {
  drop1: StandingDelta | null;
  drop3: StandingDelta | null;
  flags: OrthostaticFlag[];
  needsRecalibration: boolean;
}

export const SYSTOLIC_DROP_THRESHOLD = 20;
export const DIASTOLIC_DROP_THRESHOLD = 10;
export const PULSE_RISE_THRESHOLD = 30;
export const RECALIBRATION_DAYS = 28;

export const STAGE_DURATIONS_MS = {
  supine: 5 * 60_000,
  standing1: 60_000,
  standing3: 3 * 60_000,
} as const;

function delta(supine: BpPoint, standing: BpPoint | null): StandingDelta | null {
  if (!standing) return null;
  return {
    systolic: supine.systolic - standing.systolic,
    diastolic: supine.diastolic - standing.diastolic,
    pulseRise: standing.pulse - supine.pulse,
  };
}

export function computeOrthostatic(
  reading: OrthostaticReading,
  watchBpCalibratedAt: number | null,
): OrthostaticDerived {
  const drop1 = delta(reading.supine, reading.standing1);
  const drop3 = delta(reading.supine, reading.standing3);

  const flags = new Set<OrthostaticFlag>();
  for (const d of [drop1, drop3]) {
    if (!d) continue;
    const sys = d.systolic >= SYSTOLIC_DROP_THRESHOLD;
    const dia = d.diastolic >= DIASTOLIC_DROP_THRESHOLD;
    if (sys) flags.add('systolic_drop');
    if (dia) flags.add('diastolic_drop');
    if (!sys && !dia && d.pulseRise >= PULSE_RISE_THRESHOLD) flags.add('pulse_rise_without_drop');
  }
  // Stable order for display and tests.
  const ordered: OrthostaticFlag[] = ['systolic_drop', 'diastolic_drop', 'pulse_rise_without_drop'];

  let needsRecalibration = false;
  if (reading.source === 'watch') {
    if (watchBpCalibratedAt === null) {
      needsRecalibration = true;
    } else {
      const ageDays = (reading.timestamp - watchBpCalibratedAt) / (24 * 60 * 60 * 1000);
      needsRecalibration = ageDays > RECALIBRATION_DAYS;
    }
  }

  return { drop1, drop3, flags: ordered.filter((f) => flags.has(f)), needsRecalibration };
}

export const FLAG_LABELS: Record<OrthostaticFlag, string> = {
  systolic_drop: 'Systolic drop ≥ 20',
  diastolic_drop: 'Diastolic drop ≥ 10',
  pulse_rise_without_drop: 'Pulse rise ≥ 30 without a drop',
};

/** The evening date a reading belongs to: AM readings close the previous night. */
export function nightDateForReading(r: Pick<OrthostaticReading, 'date' | 'slot'>): string {
  return r.slot === 'am' ? addDaysToDate(r.date, -1) : r.date;
}

/** Clock-based countdown so a locked screen never drifts the timer. */
export function stageRemainingMs(stageStartedAt: number, durationMs: number, now: number): number {
  return Math.max(0, durationMs - (now - stageStartedAt));
}

export function formatBp(p: BpPoint | null): string {
  return p ? `${p.systolic}/${p.diastolic} (${p.pulse})` : '—';
}

// --- DB helpers ---

export async function getReading(date: string, slot: OrthostaticSlot): Promise<OrthostaticReading | undefined> {
  return db.orthostaticReadings.where('[date+slot]').equals([date, slot]).first();
}

/** Upsert: one reading per (date, slot). */
export async function saveReading(
  input: Omit<OrthostaticReading, 'id' | 'createdAt'> & { id?: string },
): Promise<OrthostaticReading> {
  return db.transaction('rw', db.orthostaticReadings, async () => {
    const existing = await getReading(input.date, input.slot);
    const row: OrthostaticReading = {
      ...input,
      id: existing?.id ?? input.id ?? crypto.randomUUID(),
      createdAt: existing?.createdAt ?? Date.now(),
    };
    await db.orthostaticReadings.put(row);
    return row;
  });
}

/** AM and PM readings that belong to a given night (evening date). */
export function readingsForNight(
  nightDate: string,
  all: readonly OrthostaticReading[],
): { am: OrthostaticReading | null; pm: OrthostaticReading | null } {
  const pm = all.find((r) => r.slot === 'pm' && r.date === nightDate) ?? null;
  const am = all.find((r) => r.slot === 'am' && r.date === addDaysToDate(nightDate, 1)) ?? null;
  return { am, pm };
}
