import { describe, expect, it, vi } from 'vitest';
import { defineRegistry } from 'voice-kit/talks';
import { argsOf } from 'voice-kit/forms';
import {
  DEFAULT_MANUAL_FIELDS,
  applyEveningFill,
  applyTonightFill,
  eveningCommand,
  eveningFillFrom,
  eveningRefusal,
  eveningValuesOf,
  manualFieldsWith,
  morningCommand,
  morningRefusal,
  sleepDataFromManualFields,
  tonightCommand,
  tonightFillFrom,
  tonightRefusal,
  type EveningInputs,
  type TonightInputs,
} from './formCommands';
import { EVENING_FORM, MORNING_FORM, TONIGHT_FORM } from './formSpecs';

const MORNING_VALUES = {
  sleepTime: '23:10',
  wakeTime: '06:45',
  totalSleepDuration: '455',
  actualSleepDuration: '410',
  sleepScore: '82',
};

describe('the Morning log command', () => {
  it('builds the same SleepData the manual Save builds, filling the rest as the page does', () => {
    const fields = manualFieldsWith(DEFAULT_MANUAL_FIELDS, { ...MORNING_VALUES, minHeartRate: '48', deepSleepRating: 'Fair' });
    expect(sleepDataFromManualFields(fields, 1000)).toEqual({
      sleepTime: '23:10',
      wakeTime: '06:45',
      totalSleepDuration: 455,
      actualSleepDuration: 410,
      sleepScore: 82,
      sleepScoreDelta: 0,
      deepSleep: 0,
      remSleep: 0,
      lightSleep: 0,
      awakeDuration: 0,
      avgHeartRate: 0,
      minHeartRate: 48,
      avgRespiratoryRate: 0,
      bloodOxygenAvg: 0,
      skinTempRange: '',
      sleepLatencyRating: 'Good',
      restfulnessRating: 'Good',
      deepSleepRating: 'Fair',
      remSleepRating: 'Good',
      importedAt: 1000,
    });
    // the page's own defaults: a blank time is 22:00 / 06:00 and a blank low heart rate is null
    const blank = sleepDataFromManualFields(DEFAULT_MANUAL_FIELDS, 1);
    expect([blank.sleepTime, blank.wakeTime, blank.minHeartRate]).toEqual(['22:00', '06:00', null]);
  });

  it('runs the page\'s save once with the values, and says so', async () => {
    const apply = vi.fn();
    const command = morningCommand(apply);
    const result = await command.run(MORNING_VALUES);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(manualFieldsWith(DEFAULT_MANUAL_FIELDS, MORNING_VALUES));
    expect(result.said).toMatch(/sleep data/i);
  });

  it.each([
    [{ sleepScore: '150' }, /sleep score.*0 to 100/i],
    [{ sleepScore: 'great' }, /sleep score/i],
    [{ sleepTime: '25:00' }, /sleep time/i],
    [{ wakeTime: '6am' }, /wake time/i],
    [{ totalSleepDuration: '-5' }, /total sleep duration/i],
    [{ bloodOxygenAvg: '120' }, /blood oxygen/i],
    [{ avgHeartRate: '400' }, /heart rate/i],
  ])('refuses %j before the page saves anything', async (bad, why) => {
    const apply = vi.fn();
    const command = morningCommand(apply);
    expect(morningRefusal({ ...MORNING_VALUES, ...bad })).toMatch(why);
    await expect(command.run({ ...MORNING_VALUES, ...bad })).rejects.toThrow(why);
    expect(apply).not.toHaveBeenCalled();
  });

  it('is a confirm command the registry checks: a missing required value never runs', async () => {
    const apply = vi.fn();
    const registry = defineRegistry({ commands: [morningCommand(apply)] });
    expect(registry.command('saveMorningSleepData')?.kind).toBe('confirm');
    const missing = argsOf(MORNING_FORM, { sleepTime: '23:00' });
    expect(registry.refuses('saveMorningSleepData', missing)).toMatch(/wakeTime|required/i);
    expect(await registry.run('saveMorningSleepData', missing)).toMatchObject({ ok: false });
    expect(apply).not.toHaveBeenCalled();
    expect(await registry.run('saveMorningSleepData', argsOf(MORNING_FORM, MORNING_VALUES))).toMatchObject({ ok: true });
    expect(apply).toHaveBeenCalledTimes(1);
    const over = await registry.run('saveMorningSleepData', argsOf(MORNING_FORM, { ...MORNING_VALUES, sleepScore: '101' }));
    expect(over).toMatchObject({ ok: false });
    expect((over as { why: string }).why).toMatch(/0 to 100/);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('offers a line that names the form and what he gave', () => {
    const command = morningCommand(vi.fn());
    expect(command.offer?.(MORNING_VALUES)).toMatch(/^Use this sleep data/i);
  });
});

const EVENING: EveningInputs = {
  overrideTime: '',
  lastMealTime: '',
  lastMealTimeTouched: false,
  foodDescription: '',
  flags: [
    { type: 'overate', label: 'Overate', active: false },
    { type: 'nitrates', label: 'Nitrates', active: false },
    { type: 'questionable_food', label: 'Questionable food', active: false },
    { type: 'late_meal', label: 'Late meal', active: false },
  ],
  hasAlcohol: false,
  alcohol: { type: '', amount: '', time: '' },
  liquidIntake: '',
  hadStruggle: false,
  struggleTime: '',
  struggleIntensity: '',
  struggleNotes: '',
  roomTempF: '',
  roomHumidity: '',
  acCurveProfile: 'off',
  acSetpointF: '',
  fanSpeed: 'off',
};

describe('the Evening log command', () => {
  const values = {
    lastMealTime: '19:30',
    foodDescription: 'Salmon and rice',
    flags: 'Nitrates, late meal',
    alcoholType: 'Red wine',
    alcoholAmount: '4oz',
    alcoholTime: '20:00',
    liquidIntake: 'Water, 1 L',
    struggleIntensity: 'High',
    roomTempF: '67',
    acCurveProfile: 'Cool early',
    acSetpointF: '64',
    fanSpeed: 'Low',
  };

  it('reads the values into the typed fill the page saves', () => {
    expect(eveningFillFrom(values)).toEqual({
      lastMealTime: '19:30',
      foodDescription: 'Salmon and rice',
      flags: ['Nitrates', 'Late meal'],
      alcohol: { type: 'Red wine', amount: '4oz', time: '20:00' },
      liquidIntake: 'Water, 1 L',
      struggle: { intensity: 'high' },
      roomTempF: '67',
      acCurveProfile: 'cool_early',
      acSetpointF: '64',
      fanSpeed: 'low',
    });
  });

  it('applies a fill over the page\'s own values, touching only what it names', () => {
    const next = applyEveningFill({ ...EVENING, roomHumidity: '41', foodDescription: 'old' }, eveningFillFrom(values));
    expect(next.lastMealTime).toBe('19:30');
    expect(next.lastMealTimeTouched).toBe(true);
    expect(next.foodDescription).toBe('Salmon and rice');
    expect(next.flags.filter((f) => f.active).map((f) => f.type)).toEqual(['nitrates', 'late_meal']);
    expect(next.hasAlcohol).toBe(true);
    expect(next.alcohol).toEqual({ type: 'Red wine', amount: '4oz', time: '20:00' });
    expect(next.hadStruggle).toBe(true);
    expect(next.struggleIntensity).toBe('high');
    expect(next.roomHumidity).toBe('41');
    expect(next.acCurveProfile).toBe('cool_early');
    expect(next.fanSpeed).toBe('low');
    expect(applyEveningFill(EVENING, {})).toEqual(EVENING);
  });

  it('shows the page\'s values back to the tutor as the spec\'s fields', () => {
    const shown = eveningValuesOf(applyEveningFill(EVENING, eveningFillFrom(values)));
    expect(shown).toMatchObject({ lastMealTime: '19:30', flags: 'Nitrates, Late meal', alcoholType: 'Red wine', struggleIntensity: 'High', acCurveProfile: 'Cool early', fanSpeed: 'Low' });
    expect(eveningValuesOf(EVENING).flags).toBe('');
    expect(Object.keys(shown).every((k) => EVENING_FORM.fields.some((f) => f.name === k))).toBe(true);
  });

  it('saves through the page once with the fill, and refuses a bad value before it does', async () => {
    const save = vi.fn(async () => {});
    const command = eveningCommand(save);
    await command.run({ lastMealTime: '19:30', fanSpeed: 'Low' });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ lastMealTime: '19:30', fanSpeed: 'low' });
    for (const bad of [{ roomTempF: '300' }, { roomHumidity: '140' }, { lastMealTime: '7:30pm' }, { flags: 'Overate, Garlic' }, { acSetpointF: 'cold' }] as Record<string, string>[]) {
      expect(eveningRefusal({ lastMealTime: '19:30', ...bad })).toBeTruthy();
      await expect(command.run({ lastMealTime: '19:30', ...bad })).rejects.toThrow();
    }
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('needs the last meal time, as the registry checks it', () => {
    const registry = defineRegistry({ commands: [eveningCommand(vi.fn(async () => {}))] });
    expect(registry.refuses('saveEveningLog', {})).toMatch(/lastMealTime/);
    expect(registry.refuses('saveEveningLog', argsOf(EVENING_FORM, { lastMealTime: '19:30' }))).toBeUndefined();
  });
});

const TONIGHT: TonightInputs = {
  overrideTime: '',
  plannedRoomTemp: '',
  plannedAcCurve: '',
  plannedAcSetpoint: '',
  hoursSinceLastMeal: '',
  plannedRoomHumidity: '',
  hadAlcohol: false,
};

describe("Tonight's plan command", () => {
  const values = { plannedRoomTemp: '68', hoursSinceLastMeal: '3.5', plannedAcCurve: 'Steady', plannedAcSetpoint: '65', plannedRoomHumidity: '45', hadAlcohol: 'Alcohol', overrideTime: '06:15' };

  it('reads the values and sets the plan\'s dials', () => {
    expect(applyTonightFill(TONIGHT, tonightFillFrom(values))).toEqual({
      overrideTime: '06:15',
      plannedRoomTemp: '68',
      plannedAcCurve: 'steady',
      plannedAcSetpoint: '65',
      hoursSinceLastMeal: '3.5',
      plannedRoomHumidity: '45',
      hadAlcohol: true,
    });
    expect(applyTonightFill({ ...TONIGHT, hadAlcohol: true }, tonightFillFrom({ hadAlcohol: 'Nothing' })).hadAlcohol).toBe(false);
  });

  it('applies the dials once, and refuses a value out of range before it does', async () => {
    const apply = vi.fn();
    const command = tonightCommand(apply);
    await command.run({ plannedRoomTemp: '68', hoursSinceLastMeal: '3' });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({ plannedRoomTemp: '68', hoursSinceLastMeal: '3' });
    for (const bad of [{ plannedRoomTemp: '500' }, { hoursSinceLastMeal: '-1' }, { plannedRoomHumidity: '200' }, { overrideTime: 'early' }] as Record<string, string>[]) {
      expect(tonightRefusal({ plannedRoomTemp: '68', hoursSinceLastMeal: '3', ...bad })).toBeTruthy();
      await expect(command.run({ plannedRoomTemp: '68', hoursSinceLastMeal: '3', ...bad })).rejects.toThrow();
    }
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('is described by the same fields the spec lists', () => {
    const registry = defineRegistry({ commands: [tonightCommand(vi.fn())] });
    expect(registry.refuses('planTonight', argsOf(TONIGHT_FORM, { plannedRoomTemp: '68', hoursSinceLastMeal: '3' }))).toBeUndefined();
  });
});
