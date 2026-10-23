// formSpecs.ts (mw-cb24ai.6) — the forms of Night Stack as the tutor sees them (@voice-kit/forms). One list of fields for each form, with
// the page's own label for each, cut into pages of at most 8 fields (the kit's request carries 8): the door walks a page at a time, and the
// form's one command takes all of the fields. formSpecs.test.ts reads each page's source and fails when a labelled field is missing here.
import type { FormField, FormSpec } from 'voice-kit/forms';

/** The most fields the tutor is shown at once: the kit's request limit. */
export const PAGE_SIZE = 8;

/** The form's fields cut into pages of at most PAGE_SIZE, in screen order, each named for its place ('Evening log (1 of 2)'). */
export function pagesOf(form: FormSpec, size = PAGE_SIZE): FormSpec[] {
  const count = Math.max(1, Math.ceil(form.fields.length / size));
  return Array.from({ length: count }, (_, i) => ({
    name: count === 1 ? form.name : `${form.name} (${i + 1} of ${count})`,
    fields: form.fields.slice(i * size, (i + 1) * size),
  }));
}

export const RATINGS = ['Excellent', 'Good', 'Fair', 'Attention'] as const;
export const AC_CURVES = ['Off', 'Steady', 'Cool early', 'Hold cold', 'Warm late', 'Custom'] as const;
export const FAN_SPEEDS = ['Off', 'Low', 'Medium', 'High', 'Auto'] as const;
export const INTENSITIES = ['Low', 'Medium', 'High'] as const;
export const FLAG_LABELS = ['Overate', 'Nitrates', 'Questionable food', 'Late meal'] as const;
export const DRINKS = ['Alcohol', 'Nothing'] as const;

const text = (name: string, label: string, hint: string, required = false, maxLength?: number): FormField => ({
  name,
  label,
  hint,
  required,
  kind: 'text',
  ...(maxLength ? { maxLength } : {}),
});
const choice = (name: string, label: string, hint: string, options: readonly string[], required = false): FormField => ({ name, label, hint, required, kind: 'choice', options });

const TIME = '24-hour time, like 22:30';
const MINUTES = 'in minutes';

/** The Morning log's manual sleep data entry: the keys are the page's own `manualFields`. */
export const MORNING_FORM: FormSpec = {
  name: 'Morning sleep data',
  fields: [
    text('sleepTime', 'Sleep time', `When he fell asleep: ${TIME}`, true, 5),
    text('wakeTime', 'Wake time', `When he woke: ${TIME}`, true, 5),
    text('totalSleepDuration', 'Total sleep duration (min)', `Time in bed, ${MINUTES}`, true, 5),
    text('actualSleepDuration', 'Actual sleep duration (min)', `Time asleep, ${MINUTES}`, true, 5),
    text('sleepScore', 'Sleep score (0-100)', 'The watch score, 0 to 100', true, 3),
    text('sleepScoreDelta', 'Score delta', 'Change in the score from the usual, a number', false, 4),
    text('deepSleep', 'Deep sleep (min)', `Deep sleep ${MINUTES}`, false, 5),
    text('remSleep', 'REM sleep (min)', `REM sleep ${MINUTES}`, false, 5),
    text('lightSleep', 'Light sleep (min)', `Light sleep ${MINUTES}`, false, 5),
    text('awakeDuration', 'Awake duration (min)', `Time awake ${MINUTES}`, false, 5),
    text('avgHeartRate', 'Avg heart rate (bpm)', 'Average heart rate overnight', false, 3),
    text('minHeartRate', "Night's low HR (bpm)", 'Lowest heart rate overnight', false, 3),
    text('avgRespiratoryRate', 'Avg respiratory rate (br/min)', 'Average breaths a minute', false, 5),
    text('bloodOxygenAvg', 'Blood oxygen avg (%)', 'Average blood oxygen, a percent', false, 5),
    text('skinTempRange', 'Skin temp range', 'As the watch shows it, like 91-95F', false, 20),
    choice('sleepLatencyRating', 'Sleep latency rating', 'The watch rating for how fast he fell asleep. The page starts at Good: ask once', RATINGS),
    choice('restfulnessRating', 'Restfulness rating', 'The watch rating for restfulness. The page starts at Good: ask once', RATINGS),
    choice('deepSleepRating', 'Deep sleep rating', 'The watch rating for deep sleep. The page starts at Good: ask once', RATINGS),
    choice('remSleepRating', 'REM sleep rating', 'The watch rating for REM sleep. The page starts at Good: ask once', RATINGS),
  ],
};

/** The Evening log: its 16 labelled fields in screen order. The alcohol and struggle fields have a switch on the page that the tutor does
 * not ask for: a value in one of them turns the switch on. */
export const EVENING_FORM: FormSpec = {
  name: 'Evening log',
  fields: [
    text('overrideTime', 'Override alarm time', `Only if tomorrow's alarm is not the usual one: ${TIME}`, false, 5),
    text('lastMealTime', 'Last meal time', `When he last ate: ${TIME}`, true, 5),
    text('foodDescription', 'Food description', 'What he ate'),
    text('flags', 'Flags', 'Any of: Overate, Nitrates, Questionable food, Late meal, separated by commas; none if none apply', false, 80),
    text('alcoholType', 'Type', 'Alcohol: what he drank; leave empty if no alcohol', false, 60),
    text('alcoholAmount', 'Amount', 'Alcohol: how much, like 4oz', false, 40),
    text('alcoholTime', 'Time', `Alcohol: when he drank it, ${TIME}`, false, 5),
    text('liquidIntake', 'Liquid intake', 'What and how much he drank this evening'),
    text('struggleTime', 'When did it hit (optional)', `The midday energy struggle, if any: when it hit, ${TIME}`, false, 5),
    choice('struggleIntensity', 'Intensity (optional)', 'The midday struggle: how bad it was', INTENSITIES),
    text('struggleNotes', 'Notes (optional)', 'The midday struggle: anything worth noting'),
    text('roomTempF', 'Room temperature at bedtime (F)', 'Degrees Fahrenheit', false, 5),
    text('roomHumidity', 'Room humidity (%)', 'A percent', false, 5),
    choice('acCurveProfile', 'AC sleep-curve profile', 'How the AC runs through the night. The page starts at Off: ask once', AC_CURVES),
    text('acSetpointF', 'AC setpoint (F)', 'The coldest point of the curve, degrees Fahrenheit', false, 5),
    choice('fanSpeed', 'Fan speed', 'The fan, standalone or the AC fan, through the night. The page starts at Off: ask once', FAN_SPEEDS),
  ],
};

/** Tonight's plan: the seven dials the recommender reads. Nothing is saved; the door sets them. */
export const TONIGHT_FORM: FormSpec = {
  name: "Tonight's plan",
  fields: [
    text('overrideTime', 'Override alarm time', `Only if tomorrow's alarm is not the usual one: ${TIME}`, false, 5),
    text('plannedRoomTemp', 'Starting room temp (F)', 'The room at bedtime, degrees Fahrenheit', true, 5),
    choice('plannedAcCurve', 'Planned AC curve', 'How he will run the AC tonight', AC_CURVES),
    text('plannedAcSetpoint', 'AC setpoint (F)', 'Degrees Fahrenheit', false, 5),
    text('hoursSinceLastMeal', 'Hours since last meal', 'At bedtime, hours and quarters like 3.5', true, 5),
    text('plannedRoomHumidity', 'Room humidity (%) — optional', 'A percent', false, 5),
    choice('hadAlcohol', 'What you drank tonight', 'Alcohol tonight, or nothing', DRINKS),
  ],
};

export const MORNING_PAGES = pagesOf(MORNING_FORM);
export const EVENING_PAGES = pagesOf(EVENING_FORM);
export const TONIGHT_PAGES = pagesOf(TONIGHT_FORM);

/** The pages without the fields named: the AC fields, for a phone with no AC installed (the page hides them too). A page left empty goes. */
export function withoutFields(pages: readonly FormSpec[], names: readonly string[]): FormSpec[] {
  return pages.map((p) => ({ ...p, fields: p.fields.filter((f) => !names.includes(f.name)) })).filter((p) => p.fields.length > 0);
}

export const AC_FIELDS: Record<'evening' | 'tonight', readonly string[]> = {
  evening: ['acCurveProfile', 'acSetpointF'],
  tonight: ['plannedAcCurve', 'plannedAcSetpoint'],
};
