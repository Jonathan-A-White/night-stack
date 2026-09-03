import type { BodyMeasurement, NightLog, OrthostaticReading, SleepRating } from '../types';
import { getEffectiveSleepData } from '../utils';
import { deltasForNight, measurementsForNight } from './bodyMeasurements';
import { computeOrthostatic, readingsForNight, type OrthostaticDerived } from './orthostatic';
import { computeCoolingRate1to4F, computeHoursSinceLastMeal } from './recommender';
import { getOvernightLow } from './weather';

/**
 * One registry of per-night metrics shared by Correlations, MetricDetail,
 * the Experiments home and the clinician export
 * (specs/home-experiments/insights-and-rules.md, Q15).
 *
 * `side` says where a metric may appear in the correlations pickers;
 * `defaultSide` where it is preselected. Tags default to X, deltas and
 * vitals to Y, and all of them are selectable on either axis.
 */

export interface NightMetricCtx {
  log: NightLog;
  body: {
    weightDeltaLbs: number | null;
    neckDeltaIn: number | null;
    pmWeight: number | null;
    amWeight: number | null;
    pmNeck: number | null;
    amNeck: number | null;
  };
  ortho: {
    am: (OrthostaticDerived & { reading: OrthostaticReading }) | null;
    pm: (OrthostaticDerived & { reading: OrthostaticReading }) | null;
  };
}

export type MetricSide = 'x' | 'y' | 'both';
export type MetricGroup = 'tags' | 'body' | 'vitals' | 'sleep' | 'environment';

export interface NightMetric {
  key: string;
  label: string;
  group: MetricGroup;
  side: MetricSide;
  defaultSide: 'x' | 'y';
  extract: (ctx: NightMetricCtx) => number | null;
  format?: (v: number) => string;
}

export function buildNightMetricCtx(
  log: NightLog,
  bodyRows: readonly BodyMeasurement[],
  readings: readonly OrthostaticReading[],
  watchBpCalibratedAt: number | null,
): NightMetricCtx {
  const deltas = deltasForNight(log.date, bodyRows);
  const m = measurementsForNight(log.date, bodyRows);
  const { am, pm } = readingsForNight(log.date, readings);
  return {
    log,
    body: {
      weightDeltaLbs: deltas.weightDeltaLbs,
      neckDeltaIn: deltas.neckDeltaIn,
      pmWeight: m.pmWeight?.value ?? null,
      amWeight: m.amWeight?.value ?? null,
      pmNeck: m.pmNeck?.value ?? null,
      amNeck: m.amNeck?.value ?? null,
    },
    ortho: {
      am: am ? { ...computeOrthostatic(am, watchBpCalibratedAt), reading: am } : null,
      pm: pm ? { ...computeOrthostatic(pm, watchBpCalibratedAt), reading: pm } : null,
    },
  };
}

/** 1 when the night had an episode capture or was labelled wired (Q10 note). */
export function adrenergicNight(log: Pick<NightLog, 'wakeUpEvents' | 'wiredWake'>): 0 | 1 {
  return log.wiredWake || log.wakeUpEvents.some((e) => e.source === 'episode') ? 1 : 0;
}

function ratingToNum(r: SleepRating): number {
  switch (r) {
    case 'Excellent': return 4;
    case 'Good': return 3;
    case 'Fair': return 2;
    case 'Attention': return 1;
  }
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

const position = (p: NightLog['positionStarted']): number | null =>
  p === 'side' ? 0 : p === 'back' ? 1 : null;

const one = (v: number) => v.toFixed(1);

export const NIGHT_METRICS: NightMetric[] = [
  // --- Tags (default X) ---
  { key: 'sodiumLevel', label: 'Sodium level (0 normal / 1 more / 2 much more)', group: 'tags', side: 'both', defaultSide: 'x',
    extract: ({ log }) => (log.eveningIntake.sodiumLevel === 'normal' ? 0 : log.eveningIntake.sodiumLevel === 'more' ? 1 : 2) },
  { key: 'electrolyteDose', label: 'Electrolyte drink (0 none / 1 half / 2 full)', group: 'tags', side: 'both', defaultSide: 'x',
    extract: ({ log }) => (log.electrolyteDose === null ? null : log.electrolyteDose === 'none' ? 0 : log.electrolyteDose === 'half' ? 1 : 2) },
  { key: 'positionStarted', label: 'Position to bed (0 side / 1 back)', group: 'tags', side: 'both', defaultSide: 'x',
    extract: ({ log }) => position(log.positionStarted) },
  { key: 'positionAtWake', label: 'Position at wake (0 side / 1 back)', group: 'tags', side: 'both', defaultSide: 'x',
    extract: ({ log }) => position(log.positionAtWake) },
  { key: 'wiredWake', label: 'Woke wired (1/0)', group: 'tags', side: 'both', defaultSide: 'x',
    extract: ({ log }) => (log.wiredWake ? 1 : 0) },
  { key: 'episodeCount', label: 'Episodes captured', group: 'tags', side: 'both', defaultSide: 'y',
    extract: ({ log }) => log.wakeUpEvents.filter((e) => e.source === 'episode').length },
  { key: 'adrenergicNight', label: 'Adrenergic night (episode or wired, 1/0)', group: 'tags', side: 'both', defaultSide: 'y',
    extract: ({ log }) => adrenergicNight(log) },
  { key: 'alcohol', label: 'Alcohol (1/0)', group: 'tags', side: 'x', defaultSide: 'x',
    extract: ({ log }) => (log.eveningIntake.alcohol ? 1 : 0) },
  { key: 'anyFlag', label: 'Any flag active (1/0, salt excluded)', group: 'tags', side: 'x', defaultSide: 'x',
    extract: ({ log }) => (log.eveningIntake.flags.some((f) => f.active) ? 1 : 0) },
  { key: 'overate', label: 'Overate flag (1/0)', group: 'tags', side: 'x', defaultSide: 'x',
    extract: ({ log }) => (log.eveningIntake.flags.some((f) => f.type === 'overate' && f.active) ? 1 : 0) },

  // --- Body (default Y) ---
  { key: 'weightDelta', label: 'Overnight weight change (lb)', group: 'body', side: 'both', defaultSide: 'y', format: one,
    extract: ({ body }) => body.weightDeltaLbs },
  { key: 'neckDelta', label: 'Overnight neck change (in)', group: 'body', side: 'both', defaultSide: 'y', format: one,
    extract: ({ body }) => body.neckDeltaIn },
  { key: 'pmWeight', label: 'Bedtime weight (lb)', group: 'body', side: 'both', defaultSide: 'x', format: one,
    extract: ({ body }) => body.pmWeight },
  { key: 'weight', label: 'Morning weight (lb)', group: 'body', side: 'both', defaultSide: 'x', format: one,
    extract: ({ body }) => body.amWeight },
  { key: 'pmNeck', label: 'Bedtime neck (in)', group: 'body', side: 'both', defaultSide: 'x', format: one,
    extract: ({ body }) => body.pmNeck },

  // --- Vitals (default Y) ---
  { key: 'orthoAmSystolicDrop3', label: 'AM systolic drop at 3 min', group: 'vitals', side: 'both', defaultSide: 'y',
    extract: ({ ortho }) => ortho.am?.drop3?.systolic ?? null },
  { key: 'orthoAmDiastolicDrop3', label: 'AM diastolic drop at 3 min', group: 'vitals', side: 'both', defaultSide: 'y',
    extract: ({ ortho }) => ortho.am?.drop3?.diastolic ?? null },
  { key: 'orthoAmPulseRise3', label: 'AM pulse rise at 3 min', group: 'vitals', side: 'both', defaultSide: 'y',
    extract: ({ ortho }) => ortho.am?.drop3?.pulseRise ?? null },
  { key: 'orthoPmSystolicDrop3', label: 'PM systolic drop at 3 min', group: 'vitals', side: 'both', defaultSide: 'y',
    extract: ({ ortho }) => ortho.pm?.drop3?.systolic ?? null },
  { key: 'orthoPmDiastolicDrop3', label: 'PM diastolic drop at 3 min', group: 'vitals', side: 'both', defaultSide: 'y',
    extract: ({ ortho }) => ortho.pm?.drop3?.diastolic ?? null },
  { key: 'orthoPmPulseRise3', label: 'PM pulse rise at 3 min', group: 'vitals', side: 'both', defaultSide: 'y',
    extract: ({ ortho }) => ortho.pm?.drop3?.pulseRise ?? null },
  { key: 'orthoFlagCount', label: 'Orthostatic flags (AM + PM)', group: 'vitals', side: 'both', defaultSide: 'y',
    extract: ({ ortho }) => (ortho.am?.flags.length ?? 0) + (ortho.pm?.flags.length ?? 0) },

  // --- Environment (X only, carried over from Correlations) ---
  { key: 'roomTemp', label: 'Room temp (°F)', group: 'environment', side: 'x', defaultSide: 'x',
    extract: ({ log }) => log.environment.roomTempF },
  { key: 'externalLow', label: 'External overnight low (°F)', group: 'environment', side: 'x', defaultSide: 'x',
    extract: ({ log }) => {
      const temps = log.environment.externalWeather?.overnightTemps;
      return temps && temps.length > 0 ? Math.min(...temps.map((t) => t.value)) : null;
    } },
  { key: 'roomHumidity', label: 'Room humidity (%)', group: 'environment', side: 'x', defaultSide: 'x',
    extract: ({ log }) => log.environment.roomHumidity },
  { key: 'lastMealMins', label: 'Last meal (mins before bed)', group: 'environment', side: 'x', defaultSide: 'x',
    extract: ({ log }) => {
      if (!log.eveningIntake.lastMealTime || !log.sleepData?.sleepTime) return null;
      const effectiveSleepTime = getEffectiveSleepData(log)?.sleepTime ?? log.sleepData.sleepTime;
      const mealMins = timeToMinutes(log.eveningIntake.lastMealTime);
      let bedMins = timeToMinutes(effectiveSleepTime);
      if (bedMins < mealMins) bedMins += 24 * 60;
      return bedMins - mealMins;
    } },
  { key: 'hoursSinceLastMeal', label: 'Hours since last meal', group: 'environment', side: 'x', defaultSide: 'x',
    extract: ({ log }) => computeHoursSinceLastMeal(log) },
  { key: 'coolingRate1to4F', label: 'Cooling rate 1–4am (°F/h)', group: 'environment', side: 'x', defaultSide: 'x',
    extract: ({ log }) => computeCoolingRate1to4F(log) },
  { key: 'pressure', label: 'Pressure (weather low − room)', group: 'environment', side: 'x', defaultSide: 'x',
    extract: ({ log }) => {
      const low = log.environment.externalWeather ? getOvernightLow(log.environment.externalWeather) : null;
      const room = log.environment.roomTempF;
      return low !== null && room !== null ? low - room : null;
    } },
  { key: 'beddingLayers', label: 'Number bedding layers', group: 'environment', side: 'x', defaultSide: 'x',
    extract: ({ log }) => log.bedding.length },
  { key: 'clothingLayers', label: 'Number clothing layers', group: 'environment', side: 'x', defaultSide: 'x',
    extract: ({ log }) => log.clothing.length },

  // --- Sleep outputs (Y only) ---
  { key: 'sleepScore', label: 'Sleep score', group: 'sleep', side: 'y', defaultSide: 'y',
    extract: ({ log }) => log.sleepData?.sleepScore ?? null },
  { key: 'deepSleep', label: 'Deep sleep (min)', group: 'sleep', side: 'y', defaultSide: 'y',
    extract: ({ log }) => log.sleepData?.deepSleep ?? null },
  { key: 'remSleep', label: 'REM sleep (min)', group: 'sleep', side: 'y', defaultSide: 'y',
    extract: ({ log }) => log.sleepData?.remSleep ?? null },
  { key: 'awakeMins', label: 'Awake (min)', group: 'sleep', side: 'y', defaultSide: 'y',
    extract: ({ log }) => log.sleepData?.awakeDuration ?? null },
  { key: 'avgHR', label: 'Avg heart rate (bpm)', group: 'sleep', side: 'y', defaultSide: 'y',
    extract: ({ log }) => log.sleepData?.avgHeartRate ?? null },
  { key: 'minHR', label: "Night's low HR (bpm)", group: 'sleep', side: 'y', defaultSide: 'y',
    extract: ({ log }) => log.sleepData?.minHeartRate ?? null },
  { key: 'wakeUpCount', label: 'Wake-up events', group: 'sleep', side: 'y', defaultSide: 'y',
    extract: ({ log }) => log.wakeUpEvents.length },
  { key: 'restfulness', label: 'Restfulness rating', group: 'sleep', side: 'y', defaultSide: 'y',
    extract: ({ log }) => (log.sleepData ? ratingToNum(log.sleepData.restfulnessRating) : null) },
];

const BY_KEY = new Map(NIGHT_METRICS.map((m) => [m.key, m]));

export function getMetric(key: string): NightMetric {
  const m = BY_KEY.get(key);
  if (!m) throw new Error(`Unknown night metric "${key}"`);
  return m;
}

export function metricsForSide(side: 'x' | 'y'): NightMetric[] {
  return NIGHT_METRICS.filter((m) => m.side === 'both' || m.side === side);
}

export const GROUP_LABELS: Record<MetricGroup, string> = {
  tags: 'Night tags',
  body: 'Body',
  vitals: 'Vitals',
  environment: 'Environment & intake',
  sleep: 'Sleep',
};
