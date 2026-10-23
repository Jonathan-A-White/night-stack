// formCommands.ts (mw-cb24ai.6) — what the door's Send does for each form. The Governor's rule (mw-t3xu9a Q3): the buttons and the tutor call
// the same path. Each page's own Save is made of the pure functions here (the Morning log builds its SleepData with sleepDataFromManualFields,
// the Evening log saves what applyEveningFill gives, Tonight's plan sets the dials applyTonightFill gives), and the form's Command calls the
// page's own save with the values he gave. A value out of range is refused (the command throws) before the page's save is called, so before
// anything is written.
import { formCommand, type FormSpec } from 'voice-kit/forms';
import type { Command } from 'voice-kit/talks';
import type { AcCurveProfile, AlcoholEntry, EveningFlag, FanSpeed, SleepData, SleepRating, StruggleIntensity } from '../types';
import { AC_CURVES, EVENING_FORM, FAN_SPEEDS, FLAG_LABELS, INTENSITIES, MORNING_FORM, RATINGS, TONIGHT_FORM } from './formSpecs';

/** The values of a form as its command takes them: a field name to the text. */
export type Values = Readonly<Record<string, string>>;

// ---- checks ------------------------------------------------------------------------------------------------------------------------------

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

type Check = (v: Values) => string | undefined;

const time = (key: string, label: string): Check => (v) => (v[key] && !TIME.test(v[key]) ? `${label} must be a time like 22:30, not ${v[key]}.` : undefined);
const range = (key: string, label: string, min: number, max: number): Check => (v) => {
  const raw = v[key];
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? undefined : `${label} must be a number from ${min} to ${max}, not ${raw}.`;
};
const oneOf = (key: string, label: string, options: readonly string[]): Check => (v) =>
  v[key] && !options.includes(v[key]) ? `${label} must be one of ${options.join(', ')}, not ${v[key]}.` : undefined;

/** The first thing wrong with `values`, if anything. */
const firstRefusal = (checks: readonly Check[]) => (values: Values): string | undefined => {
  for (const check of checks) {
    const why = check(values);
    if (why) return why;
  }
  return undefined;
};

// ---- Morning log: the manual sleep data entry --------------------------------------------------------------------------------------------

/** The Morning log's `manualFields` state. */
export type ManualFields = {
  sleepTime: string;
  wakeTime: string;
  totalSleepDuration: string;
  actualSleepDuration: string;
  sleepScore: string;
  sleepScoreDelta: string;
  deepSleep: string;
  remSleep: string;
  lightSleep: string;
  awakeDuration: string;
  avgHeartRate: string;
  minHeartRate: string;
  avgRespiratoryRate: string;
  bloodOxygenAvg: string;
  skinTempRange: string;
  sleepLatencyRating: SleepRating;
  restfulnessRating: SleepRating;
  deepSleepRating: SleepRating;
  remSleepRating: SleepRating;
};

export const DEFAULT_MANUAL_FIELDS: ManualFields = {
  sleepTime: '',
  wakeTime: '',
  totalSleepDuration: '',
  actualSleepDuration: '',
  sleepScore: '',
  sleepScoreDelta: '',
  deepSleep: '',
  remSleep: '',
  lightSleep: '',
  awakeDuration: '',
  avgHeartRate: '',
  minHeartRate: '',
  avgRespiratoryRate: '',
  bloodOxygenAvg: '',
  skinTempRange: '',
  sleepLatencyRating: 'Good',
  restfulnessRating: 'Good',
  deepSleepRating: 'Good',
  remSleepRating: 'Good',
};

/** `current` with the values over it; a key the form does not have is ignored. */
export function manualFieldsWith(current: ManualFields, values: Values): ManualFields {
  const next: Record<string, string> = { ...current };
  for (const key of Object.keys(current)) if (values[key] !== undefined) next[key] = values[key];
  return next as unknown as ManualFields;
}

/** What the manual entry's Save keeps: a blank time is 22:00 / 06:00, a blank number 0, a blank low heart rate none. */
export function sleepDataFromManualFields(f: ManualFields, now: number = Date.now()): SleepData {
  return {
    sleepTime: f.sleepTime || '22:00',
    wakeTime: f.wakeTime || '06:00',
    totalSleepDuration: Number(f.totalSleepDuration) || 0,
    actualSleepDuration: Number(f.actualSleepDuration) || 0,
    sleepScore: Number(f.sleepScore) || 0,
    sleepScoreDelta: Number(f.sleepScoreDelta) || 0,
    deepSleep: Number(f.deepSleep) || 0,
    remSleep: Number(f.remSleep) || 0,
    lightSleep: Number(f.lightSleep) || 0,
    awakeDuration: Number(f.awakeDuration) || 0,
    avgHeartRate: Number(f.avgHeartRate) || 0,
    minHeartRate: f.minHeartRate === '' ? null : Number(f.minHeartRate),
    avgRespiratoryRate: Number(f.avgRespiratoryRate) || 0,
    bloodOxygenAvg: Number(f.bloodOxygenAvg) || 0,
    skinTempRange: f.skinTempRange,
    sleepLatencyRating: f.sleepLatencyRating,
    restfulnessRating: f.restfulnessRating,
    deepSleepRating: f.deepSleepRating,
    remSleepRating: f.remSleepRating,
    importedAt: now,
  };
}

export const morningRefusal = firstRefusal([
  time('sleepTime', 'Sleep time'),
  time('wakeTime', 'Wake time'),
  range('totalSleepDuration', 'Total sleep duration', 0, 1440),
  range('actualSleepDuration', 'Actual sleep duration', 0, 1440),
  range('sleepScore', 'Sleep score', 0, 100),
  range('sleepScoreDelta', 'Score delta', -100, 100),
  range('deepSleep', 'Deep sleep', 0, 1440),
  range('remSleep', 'REM sleep', 0, 1440),
  range('lightSleep', 'Light sleep', 0, 1440),
  range('awakeDuration', 'Awake duration', 0, 1440),
  range('avgHeartRate', 'Avg heart rate', 20, 250),
  range('minHeartRate', "Night's low heart rate", 20, 250),
  range('avgRespiratoryRate', 'Avg respiratory rate', 4, 60),
  range('bloodOxygenAvg', 'Blood oxygen avg', 50, 100),
  oneOf('sleepLatencyRating', 'Sleep latency rating', RATINGS),
  oneOf('restfulnessRating', 'Restfulness rating', RATINGS),
  oneOf('deepSleepRating', 'Deep sleep rating', RATINGS),
  oneOf('remSleepRating', 'REM sleep rating', RATINGS),
]);

// ---- the commands --------------------------------------------------------------------------------------------------------------------------

function checked(form: FormSpec, options: { name: string; tell: string; refusal: (v: Values) => string | undefined; offer: (v: Values) => string; run: (v: Values) => Promise<string> }): Command {
  return formCommand(form, {
    name: options.name,
    tell: options.tell,
    offer: options.offer,
    async send(values) {
      const why = options.refusal(values);
      if (why) throw new Error(why);
      return { said: await options.run(values) };
    },
  });
}

export const MORNING_COMMAND = 'saveMorningSleepData';
export const EVENING_COMMAND = 'saveEveningLog';
export const TONIGHT_COMMAND = 'planTonight';

/** Enters the sleep data as the manual entry's Save does: `apply` is the page's own (it keeps the fields and closes the entry). */
export function morningCommand(apply: (fields: ManualFields) => void | Promise<void>): Command {
  return checked(MORNING_FORM, {
    name: MORNING_COMMAND,
    tell: "Enters the morning's sleep data the way the Enter manually Save does, with the values given",
    refusal: morningRefusal,
    offer: (v) => `Use this sleep data (score ${v.sleepScore ?? '?'}, ${v.sleepTime ?? '?'} to ${v.wakeTime ?? '?'})?`,
    async run(values) {
      await apply(manualFieldsWith(DEFAULT_MANUAL_FIELDS, values));
      return 'Sleep data entered. Look it over and tap Looks right.';
    },
  });
}

// ---- Evening log -----------------------------------------------------------------------------------------------------------------------------

/** The Evening log's state that its Save reads from the 16 fields (a switch and a touched flag included). */
export interface EveningInputs {
  overrideTime: string;
  lastMealTime: string;
  lastMealTimeTouched: boolean;
  foodDescription: string;
  flags: EveningFlag[];
  hasAlcohol: boolean;
  alcohol: AlcoholEntry;
  liquidIntake: string;
  hadStruggle: boolean;
  struggleTime: string;
  struggleIntensity: StruggleIntensity | '';
  struggleNotes: string;
  roomTempF: string;
  roomHumidity: string;
  acCurveProfile: AcCurveProfile;
  acSetpointF: string;
  fanSpeed: FanSpeed;
}

/** What the tutor's values say, typed. Only what was given is there. */
export interface EveningFill {
  overrideTime?: string;
  lastMealTime?: string;
  foodDescription?: string;
  /** the labels of the standard flags that are on */
  flags?: string[];
  alcohol?: Partial<AlcoholEntry>;
  liquidIntake?: string;
  struggle?: { time?: string; intensity?: StruggleIntensity; notes?: string };
  roomTempF?: string;
  roomHumidity?: string;
  acCurveProfile?: AcCurveProfile;
  acSetpointF?: string;
  fanSpeed?: FanSpeed;
}

const AC_VALUE: Record<(typeof AC_CURVES)[number], AcCurveProfile> = {
  Off: 'off',
  Steady: 'steady',
  'Cool early': 'cool_early',
  'Hold cold': 'hold_cold',
  'Warm late': 'warm_late',
  Custom: 'custom',
};
const acLabelOf = (value: AcCurveProfile): string => AC_CURVES.find((l) => AC_VALUE[l] === value) ?? '';
const acValueOf = (label: string): AcCurveProfile | undefined => (AC_CURVES as readonly string[]).includes(label) ? AC_VALUE[label as (typeof AC_CURVES)[number]] : undefined;

const has = (v: Values, key: string): boolean => v[key] !== undefined && v[key] !== '';

/** The standard flag labels in a "Nitrates, late meal" answer; 'none' is no flag at all. Unknown names are left out (flagsRefusal says so). */
function flagLabelsIn(text: string): string[] {
  const named = text.split(',').map((s) => s.trim().toLowerCase());
  return FLAG_LABELS.filter((l) => named.includes(l.toLowerCase()));
}

const flagsRefusal: Check = (v) => {
  if (!v.flags) return undefined;
  const named = v.flags.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const unknown = named.filter((n) => n !== 'none' && !FLAG_LABELS.some((l) => l.toLowerCase() === n));
  return unknown.length ? `Flags must be some of ${FLAG_LABELS.join(', ')}, or none; not ${unknown.join(', ')}.` : undefined;
};

/** The tutor's values read into a fill. Lenient: eveningRefusal says what is wrong. */
export function eveningFillFrom(v: Values): EveningFill {
  const fill: EveningFill = {};
  if (has(v, 'overrideTime')) fill.overrideTime = v.overrideTime;
  if (has(v, 'lastMealTime')) fill.lastMealTime = v.lastMealTime;
  if (has(v, 'foodDescription')) fill.foodDescription = v.foodDescription;
  if (has(v, 'flags')) fill.flags = flagLabelsIn(v.flags);
  const alcohol: Partial<AlcoholEntry> = {};
  if (has(v, 'alcoholType')) alcohol.type = v.alcoholType;
  if (has(v, 'alcoholAmount')) alcohol.amount = v.alcoholAmount;
  if (has(v, 'alcoholTime')) alcohol.time = v.alcoholTime;
  if (Object.keys(alcohol).length) fill.alcohol = alcohol;
  if (has(v, 'liquidIntake')) fill.liquidIntake = v.liquidIntake;
  const struggle: NonNullable<EveningFill['struggle']> = {};
  if (has(v, 'struggleTime')) struggle.time = v.struggleTime;
  const intensity = has(v, 'struggleIntensity') ? v.struggleIntensity.toLowerCase() : '';
  if ((INTENSITIES as readonly string[]).map((s) => s.toLowerCase()).includes(intensity)) struggle.intensity = intensity as StruggleIntensity;
  if (has(v, 'struggleNotes')) struggle.notes = v.struggleNotes;
  if (Object.keys(struggle).length) fill.struggle = struggle;
  if (has(v, 'roomTempF')) fill.roomTempF = v.roomTempF;
  if (has(v, 'roomHumidity')) fill.roomHumidity = v.roomHumidity;
  const curve = has(v, 'acCurveProfile') ? acValueOf(v.acCurveProfile) : undefined;
  if (curve) fill.acCurveProfile = curve;
  if (has(v, 'acSetpointF')) fill.acSetpointF = v.acSetpointF;
  const fan = has(v, 'fanSpeed') ? v.fanSpeed.toLowerCase() : '';
  if ((FAN_SPEEDS as readonly string[]).map((s) => s.toLowerCase()).includes(fan)) fill.fanSpeed = fan as FanSpeed;
  return fill;
}

/** The flags with the standard ones on exactly when their label is in `on`; a custom flag is left as it is. */
export function flagsWith(flags: EveningFlag[], on: readonly string[]): EveningFlag[] {
  return flags.map((f) => ((FLAG_LABELS as readonly string[]).includes(f.label) ? { ...f, active: on.includes(f.label) } : f));
}

/** The page's values with the fill over them: what its Save saves, and what the page shows once the tutor has filled it. */
export function applyEveningFill(current: EveningInputs, fill: EveningFill): EveningInputs {
  const next: EveningInputs = { ...current };
  if (fill.overrideTime !== undefined) next.overrideTime = fill.overrideTime;
  if (fill.lastMealTime !== undefined) {
    next.lastMealTime = fill.lastMealTime;
    next.lastMealTimeTouched = true;
  }
  if (fill.foodDescription !== undefined) next.foodDescription = fill.foodDescription;
  if (fill.flags !== undefined) {
    next.flags = flagsWith(current.flags, fill.flags);
  }
  if (fill.alcohol) {
    next.hasAlcohol = true;
    next.alcohol = { ...current.alcohol, ...fill.alcohol };
  }
  if (fill.liquidIntake !== undefined) next.liquidIntake = fill.liquidIntake;
  if (fill.struggle) {
    next.hadStruggle = true;
    if (fill.struggle.time !== undefined) next.struggleTime = fill.struggle.time;
    if (fill.struggle.intensity !== undefined) next.struggleIntensity = fill.struggle.intensity;
    if (fill.struggle.notes !== undefined) next.struggleNotes = fill.struggle.notes;
  }
  if (fill.roomTempF !== undefined) next.roomTempF = fill.roomTempF;
  if (fill.roomHumidity !== undefined) next.roomHumidity = fill.roomHumidity;
  if (fill.acCurveProfile !== undefined) next.acCurveProfile = fill.acCurveProfile;
  if (fill.acSetpointF !== undefined) next.acSetpointF = fill.acSetpointF;
  if (fill.fanSpeed !== undefined) next.fanSpeed = fill.fanSpeed;
  return next;
}

const capital = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The page's values as the form's fields hold them: what the tutor is told is filled in. */
export function eveningValuesOf(i: EveningInputs): Record<string, string> {
  return {
    overrideTime: i.overrideTime,
    lastMealTime: i.lastMealTime,
    foodDescription: i.foodDescription,
    flags: i.flags.filter((f) => f.active).map((f) => f.label).join(', '),
    alcoholType: i.hasAlcohol ? i.alcohol.type : '',
    alcoholAmount: i.hasAlcohol ? i.alcohol.amount : '',
    alcoholTime: i.hasAlcohol ? i.alcohol.time : '',
    liquidIntake: i.liquidIntake,
    struggleTime: i.hadStruggle ? i.struggleTime : '',
    struggleIntensity: i.hadStruggle ? capital(i.struggleIntensity) : '',
    struggleNotes: i.hadStruggle ? i.struggleNotes : '',
    roomTempF: i.roomTempF,
    roomHumidity: i.roomHumidity,
    acCurveProfile: acLabelOf(i.acCurveProfile),
    acSetpointF: i.acSetpointF,
    fanSpeed: capital(i.fanSpeed),
  };
}

export const eveningRefusal = firstRefusal([
  time('overrideTime', 'Override alarm time'),
  time('lastMealTime', 'Last meal time'),
  flagsRefusal,
  time('alcoholTime', 'Alcohol time'),
  time('struggleTime', 'When it hit'),
  oneOf('struggleIntensity', 'Intensity', INTENSITIES),
  range('roomTempF', 'Room temperature', 30, 120),
  range('roomHumidity', 'Room humidity', 0, 100),
  oneOf('acCurveProfile', 'AC sleep-curve profile', AC_CURVES),
  range('acSetpointF', 'AC setpoint', 40, 95),
  oneOf('fanSpeed', 'Fan speed', FAN_SPEEDS),
]);

/** Saves the evening log as its Save button does: `save` is the page's own, called with what the tutor gave; false means the page has not
 * saved (it asks first) and says so. */
export function eveningCommand(save: (fill: EveningFill) => Promise<boolean | void>): Command {
  return checked(EVENING_FORM, {
    name: EVENING_COMMAND,
    tell: 'Saves the evening log the way the Save Evening Log button does, with the values given',
    refusal: eveningRefusal,
    offer: (v) => `Save the evening log${v.lastMealTime ? ` (last meal at ${v.lastMealTime})` : ''}?`,
    async run(values) {
      const saved = await save(eveningFillFrom(values));
      return saved === false ? 'Not saved yet: read the warning on the page and tap Yes, save, or Cancel.' : 'Evening log saved.';
    },
  });
}

// ---- Tonight's plan --------------------------------------------------------------------------------------------------------------------------

/** The plan's dials. */
export interface TonightInputs {
  overrideTime: string;
  plannedRoomTemp: string;
  plannedAcCurve: AcCurveProfile | '';
  plannedAcSetpoint: string;
  hoursSinceLastMeal: string;
  plannedRoomHumidity: string;
  hadAlcohol: boolean;
}

export type TonightFill = Partial<TonightInputs>;

export function tonightFillFrom(v: Values): TonightFill {
  const fill: TonightFill = {};
  if (has(v, 'overrideTime')) fill.overrideTime = v.overrideTime;
  if (has(v, 'plannedRoomTemp')) fill.plannedRoomTemp = v.plannedRoomTemp;
  const curve = has(v, 'plannedAcCurve') ? acValueOf(v.plannedAcCurve) : undefined;
  if (curve) fill.plannedAcCurve = curve;
  if (has(v, 'plannedAcSetpoint')) fill.plannedAcSetpoint = v.plannedAcSetpoint;
  if (has(v, 'hoursSinceLastMeal')) fill.hoursSinceLastMeal = v.hoursSinceLastMeal;
  if (has(v, 'plannedRoomHumidity')) fill.plannedRoomHumidity = v.plannedRoomHumidity;
  if (has(v, 'hadAlcohol') && (v.hadAlcohol === 'Alcohol' || v.hadAlcohol === 'Nothing')) fill.hadAlcohol = v.hadAlcohol === 'Alcohol';
  return fill;
}

export function applyTonightFill(current: TonightInputs, fill: TonightFill): TonightInputs {
  return { ...current, ...fill };
}

/** The dials as the form's fields hold them. A blank drink is not asked yet: only an answer sets it. */
export function tonightValuesOf(i: TonightInputs): Record<string, string> {
  return {
    overrideTime: i.overrideTime,
    plannedRoomTemp: i.plannedRoomTemp,
    plannedAcCurve: i.plannedAcCurve ? acLabelOf(i.plannedAcCurve) : '',
    plannedAcSetpoint: i.plannedAcSetpoint,
    hoursSinceLastMeal: i.hoursSinceLastMeal,
    plannedRoomHumidity: i.plannedRoomHumidity,
    hadAlcohol: i.hadAlcohol ? 'Alcohol' : '',
  };
}

export const tonightRefusal = firstRefusal([
  time('overrideTime', 'Override alarm time'),
  range('plannedRoomTemp', 'Starting room temp', 30, 120),
  oneOf('plannedAcCurve', 'Planned AC curve', AC_CURVES),
  range('plannedAcSetpoint', 'AC setpoint', 40, 95),
  range('hoursSinceLastMeal', 'Hours since last meal', 0, 48),
  range('plannedRoomHumidity', 'Room humidity', 0, 100),
]);

/** Sets the plan's dials as typing them does: `apply` is the page's own. Nothing is saved. */
export function tonightCommand(apply: (fill: TonightFill) => void | Promise<void>): Command {
  return checked(TONIGHT_FORM, {
    name: TONIGHT_COMMAND,
    tell: "Sets tonight's plan dials the way typing them does, with the values given; nothing is saved",
    refusal: tonightRefusal,
    offer: () => "Set tonight's plan to these values?",
    async run(values) {
      await apply(tonightFillFrom(values));
      return "Tonight's plan updated.";
    },
  });
}
