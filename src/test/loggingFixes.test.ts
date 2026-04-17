import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db';
import { createBlankNightLog, resolveLastMealTimeForSave } from '../utils';
import type { NightLog, WakeUpEvent } from '../types';

/**
 * Tests for the logging-fixes workstream. These focus on DB round-trips and
 * save-handler outputs rather than UI rendering, since the morning/evening
 * log components are large and side-effectful. The invariants the
 * recommender relies on (thermalComfort persisted, per-wake thermal flags
 * preserved, `acInstalled` gating) are what matters, so that's what's
 * asserted here.
 */

function makeNightLog(date: string): NightLog {
  return createBlankNightLog(date, {
    expectedAlarmTime: '06:00',
    actualAlarmTime: '06:00',
    isOverridden: false,
    targetBedtime: '22:30',
    eatingCutoff: '20:00',
    supplementTime: '21:45',
  });
}

describe('logging-fixes T1: thermalComfort round-trip', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('persists a user-set thermalComfort through save/reload', async () => {
    const log = makeNightLog('2026-04-15');
    await db.nightLogs.put(log);

    // Simulate the MorningLog save handler's update call.
    await db.nightLogs.update(log.id, {
      thermalComfort: 'too_hot',
      updatedAt: Date.now(),
    });

    const reloaded = await db.nightLogs.get(log.id);
    expect(reloaded?.thermalComfort).toBe('too_hot');
  });

  it('allows thermalComfort even when there are no wake-ups', async () => {
    const log = makeNightLog('2026-04-15');
    await db.nightLogs.put(log);

    await db.nightLogs.update(log.id, {
      thermalComfort: 'just_right',
      wakeUpEvents: [],
      updatedAt: Date.now(),
    });

    const reloaded = await db.nightLogs.get(log.id);
    expect(reloaded?.thermalComfort).toBe('just_right');
    expect(reloaded?.wakeUpEvents).toHaveLength(0);
  });
});

describe('logging-fixes T3: lastMealTime prefill on save', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('writes the prefilled eatingCutoff when the user never touched the field', async () => {
    const log = makeNightLog('2026-04-15');
    await db.nightLogs.put(log);

    // Simulate the EveningLog save path — user left the field blank, never
    // interacted. The resolved value should be the eating cutoff.
    const resolved = resolveLastMealTimeForSave({
      currentValue: '',
      eatingCutoff: log.alarm.eatingCutoff,
      userInteracted: false,
    });

    await db.nightLogs.update(log.id, {
      eveningIntake: {
        ...log.eveningIntake,
        lastMealTime: resolved,
      },
      updatedAt: Date.now(),
    });

    const reloaded = await db.nightLogs.get(log.id);
    expect(reloaded?.eveningIntake.lastMealTime).toBe(log.alarm.eatingCutoff);
    expect(reloaded?.eveningIntake.lastMealTime).toBe('20:00');
  });

  it('respects a user-entered time over the cutoff prefill', async () => {
    const log = makeNightLog('2026-04-15');
    await db.nightLogs.put(log);

    const resolved = resolveLastMealTimeForSave({
      currentValue: '18:15',
      eatingCutoff: log.alarm.eatingCutoff,
      userInteracted: true,
    });

    await db.nightLogs.update(log.id, {
      eveningIntake: {
        ...log.eveningIntake,
        lastMealTime: resolved,
      },
      updatedAt: Date.now(),
    });

    const reloaded = await db.nightLogs.get(log.id);
    expect(reloaded?.eveningIntake.lastMealTime).toBe('18:15');
  });

  it('keeps blank when the user intentionally cleared the field', async () => {
    const log = makeNightLog('2026-04-15');
    await db.nightLogs.put(log);

    const resolved = resolveLastMealTimeForSave({
      currentValue: '',
      eatingCutoff: log.alarm.eatingCutoff,
      userInteracted: true,
    });

    await db.nightLogs.update(log.id, {
      eveningIntake: {
        ...log.eveningIntake,
        lastMealTime: resolved,
      },
      updatedAt: Date.now(),
    });

    const reloaded = await db.nightLogs.get(log.id);
    expect(reloaded?.eveningIntake.lastMealTime).toBe('');
  });
});

describe('logging-fixes T5: loggedBedtime on re-save', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('stamps loggedBedtime when editing an existing log whose value is null', async () => {
    // Set up a log that was saved before loggedBedtime was populated
    // (e.g. a pre-v7 row), so existingLog.loggedBedtime === null.
    const log = makeNightLog('2026-04-15');
    log.loggedBedtime = null;
    await db.nightLogs.put(log);

    // Simulate the updated EveningLog save path — existingLog is
    // truthy, isBackfill is false, loggedBedtime is null → stamp now.
    const stamped = Date.now();
    const isBackfill = false;
    const existing = await db.nightLogs.get(log.id);
    const next =
      existing && existing.loggedBedtime == null && !isBackfill
        ? stamped
        : existing?.loggedBedtime ?? null;

    await db.nightLogs.update(log.id, { loggedBedtime: next });
    const reloaded = await db.nightLogs.get(log.id);
    expect(reloaded?.loggedBedtime).toBe(stamped);
  });

  it('preserves an existing non-null loggedBedtime on re-save', async () => {
    const initial = Date.now() - 10_000;
    const log = makeNightLog('2026-04-15');
    log.loggedBedtime = initial;
    await db.nightLogs.put(log);

    // Simulate a re-save — existingLog has loggedBedtime, keep it.
    const isBackfill = false;
    const existing = await db.nightLogs.get(log.id);
    const next =
      existing && existing.loggedBedtime == null && !isBackfill
        ? Date.now()
        : existing?.loggedBedtime ?? null;

    await db.nightLogs.update(log.id, { loggedBedtime: next });
    const reloaded = await db.nightLogs.get(log.id);
    expect(reloaded?.loggedBedtime).toBe(initial);
  });

  it('leaves backfilled saves with a null loggedBedtime', async () => {
    const log = makeNightLog('2026-04-10');
    log.loggedBedtime = null;
    await db.nightLogs.put(log);

    const isBackfill = true;
    const existing = await db.nightLogs.get(log.id);
    const next =
      existing && existing.loggedBedtime == null && !isBackfill
        ? Date.now()
        : existing?.loggedBedtime ?? null;

    await db.nightLogs.update(log.id, { loggedBedtime: next });
    const reloaded = await db.nightLogs.get(log.id);
    expect(reloaded?.loggedBedtime).toBeNull();
  });
});

describe('logging-fixes T4: acInstalled gating', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('save path writes off/null AC fields when acInstalled is false', async () => {
    const log = makeNightLog('2026-04-15');
    await db.nightLogs.put(log);

    // Simulate the EveningLog save path with acInstalled=false — even if
    // the form state still has a non-off profile (e.g. a stale draft),
    // the persisted row should come out as off/null because the UI was
    // hidden and no new value was confirmed by the user.
    const acInstalled = false;
    const formAcCurveProfile = 'cool_early'; // stale draft value
    const formAcSetpointF = '64';

    await db.nightLogs.update(log.id, {
      environment: {
        ...log.environment,
        acCurveProfile: acInstalled ? formAcCurveProfile : 'off',
        acSetpointF:
          acInstalled && formAcSetpointF ? parseFloat(formAcSetpointF) : null,
      },
      updatedAt: Date.now(),
    });

    const reloaded = await db.nightLogs.get(log.id);
    expect(reloaded?.environment.acCurveProfile).toBe('off');
    expect(reloaded?.environment.acSetpointF).toBeNull();
  });

  it('preserves AC values when acInstalled is true', async () => {
    const log = makeNightLog('2026-04-15');
    await db.nightLogs.put(log);

    const acInstalled = true;
    const formAcCurveProfile = 'cool_early';
    const formAcSetpointF = '64';

    await db.nightLogs.update(log.id, {
      environment: {
        ...log.environment,
        acCurveProfile: acInstalled ? formAcCurveProfile : 'off',
        acSetpointF:
          acInstalled && formAcSetpointF ? parseFloat(formAcSetpointF) : null,
      },
      updatedAt: Date.now(),
    });

    const reloaded = await db.nightLogs.get(log.id);
    expect(reloaded?.environment.acCurveProfile).toBe('cool_early');
    expect(reloaded?.environment.acSetpointF).toBe(64);
  });
});

describe('logging-fixes T2: per-wake thermal flags round-trip', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('preserves wasSweating / feltCold / racingHeart through a save', async () => {
    const log = makeNightLog('2026-04-15');
    await db.nightLogs.put(log);

    const wake: WakeUpEvent = {
      id: crypto.randomUUID(),
      startTime: '03:30',
      endTime: '03:50',
      cause: 'some-cause-id',
      fellBackAsleep: 'yes',
      minutesToFallBackAsleep: 20,
      notes: '',
      wasSweating: true,
      feltCold: false,
      racingHeart: true,
    };

    await db.nightLogs.update(log.id, {
      wakeUpEvents: [wake],
      updatedAt: Date.now(),
    });

    const reloaded = await db.nightLogs.get(log.id);
    expect(reloaded?.wakeUpEvents).toHaveLength(1);
    expect(reloaded?.wakeUpEvents[0].wasSweating).toBe(true);
    expect(reloaded?.wakeUpEvents[0].feltCold).toBe(false);
    expect(reloaded?.wakeUpEvents[0].racingHeart).toBe(true);
  });
});
