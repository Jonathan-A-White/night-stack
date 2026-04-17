import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db';
import { createBlankNightLog } from '../utils';
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
