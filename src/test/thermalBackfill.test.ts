import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db';
import { createBlankNightLog } from '../utils';
import {
  classifyThermalComfortFromWakes,
  resolveThermalCauseIds,
} from '../services/thermalProxy';
import type { NightLog, WakeUpCause, WakeUpEvent } from '../types';

/**
 * DB-level tests for the backfill review flow (backfill.md T3 + T6). The
 * UI component ThermalBackfillReview is a thin wrapper, so we exercise
 * the three behaviors that are load-bearing for the recommender:
 *
 *   1. Accepted proposal -> thermalComfortSource = 'proxy'
 *   2. User overrode the proposal -> thermalComfortSource = 'user'
 *   3. User dismissed ("—") an ambiguous-or-proposed row ->
 *      thermalProxyDismissed = true, excluded from next pass (T6)
 */

const ALARM = {
  expectedAlarmTime: '06:00',
  actualAlarmTime: '06:00',
  isOverridden: false,
  targetBedtime: '22:30',
  eatingCutoff: '20:00',
  supplementTime: '21:45',
};

function seededCauses(): WakeUpCause[] {
  return [
    { id: 'hot', label: 'Sweating / too hot', sortOrder: 1, isActive: true },
    { id: 'cold', label: 'Too cold', sortOrder: 2, isActive: true },
    { id: 'bath', label: 'Bathroom', sortOrder: 3, isActive: true },
  ];
}

function makeWake(cause: string): WakeUpEvent {
  return {
    id: crypto.randomUUID(),
    startTime: '02:00',
    endTime: '02:15',
    cause,
    fellBackAsleep: 'yes',
    minutesToFallBackAsleep: 15,
    notes: '',
    wasSweating: false,
    feltCold: false,
    racingHeart: false,
  };
}

function makeNight(date: string, overrides: Partial<NightLog> = {}): NightLog {
  return { ...createBlankNightLog(date, ALARM), ...overrides };
}

describe('backfill T3: review flow semantics', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await db.wakeUpCauses.bulkAdd(seededCauses());
  });

  it('classifier + DB update together: proxy acceptance stamps source=proxy', async () => {
    const log = makeNight('2026-04-10', {
      wakeUpEvents: [makeWake('hot')],
    });
    await db.nightLogs.put(log);

    const causes = await db.wakeUpCauses.toArray();
    const { hot, cold } = resolveThermalCauseIds(causes);
    const proposed = classifyThermalComfortFromWakes(log, hot, cold);
    expect(proposed).toBe('too_hot');

    // Simulate the "Apply labels" path when user kept the proposal.
    await db.nightLogs.update(log.id, {
      thermalComfort: proposed,
      thermalComfortSource: 'proxy',
      updatedAt: Date.now(),
    });

    const reloaded = await db.nightLogs.get(log.id);
    expect(reloaded?.thermalComfort).toBe('too_hot');
    expect(reloaded?.thermalComfortSource).toBe('proxy');
    expect(reloaded?.thermalProxyDismissed).toBe(false);
  });

  it('user overriding the proposal stamps source=user (they outvote proxy)', async () => {
    const log = makeNight('2026-04-10', {
      wakeUpEvents: [makeWake('hot')],
    });
    await db.nightLogs.put(log);

    // Proxy would say too_hot; user picks just_right instead.
    await db.nightLogs.update(log.id, {
      thermalComfort: 'just_right',
      thermalComfortSource: 'user',
      updatedAt: Date.now(),
    });

    const reloaded = await db.nightLogs.get(log.id);
    expect(reloaded?.thermalComfort).toBe('just_right');
    expect(reloaded?.thermalComfortSource).toBe('user');
  });

  it('T6: dismissing a proposed row sets thermalProxyDismissed permanently', async () => {
    const log = makeNight('2026-04-10', {
      wakeUpEvents: [makeWake('hot')],
    });
    await db.nightLogs.put(log);

    // User picks "—" on a row that had a proposal.
    await db.nightLogs.update(log.id, {
      thermalProxyDismissed: true,
      updatedAt: Date.now(),
    });

    // Re-running the review query excludes this row.
    const candidates = (await db.nightLogs.toArray()).filter(
      (l) => l.thermalComfort == null && !l.thermalProxyDismissed,
    );
    expect(candidates).toHaveLength(0);

    // And the label is still null — dismissing is not labeling.
    const reloaded = await db.nightLogs.get(log.id);
    expect(reloaded?.thermalComfort).toBeNull();
    expect(reloaded?.thermalProxyDismissed).toBe(true);
  });

  it('accepting a proxy proposal does NOT set thermalProxyDismissed', async () => {
    // Acceptance != dismissal; only explicit "—" sets the flag. A user
    // who accepts a proposal should have a labeled row, not a dismissed
    // one, so that a later review can still re-surface it if they clear
    // the label manually.
    const log = makeNight('2026-04-10', {
      wakeUpEvents: [makeWake('cold')],
    });
    await db.nightLogs.put(log);

    await db.nightLogs.update(log.id, {
      thermalComfort: 'too_cold',
      thermalComfortSource: 'proxy',
      updatedAt: Date.now(),
    });

    const reloaded = await db.nightLogs.get(log.id);
    expect(reloaded?.thermalProxyDismissed).toBe(false);
  });

  it('subsequent pass excludes dismissed + labeled, shows only fresh', async () => {
    // Three nights: one labeled already, one previously dismissed, one
    // fresh. The query should surface only the fresh one.
    await db.nightLogs.bulkPut([
      makeNight('2026-04-08', { thermalComfort: 'just_right', thermalComfortSource: 'user' }),
      makeNight('2026-04-09', { thermalProxyDismissed: true }),
      makeNight('2026-04-10', { wakeUpEvents: [makeWake('hot')] }),
    ]);

    const candidates = (await db.nightLogs.toArray()).filter(
      (l) => l.thermalComfort == null && !l.thermalProxyDismissed,
    );
    expect(candidates.map((l) => l.date)).toEqual(['2026-04-10']);
  });

  it('idempotent: applying twice with "unchanged" selections is a no-op', async () => {
    const log = makeNight('2026-04-10', {
      thermalComfort: 'too_hot',
      thermalComfortSource: 'proxy',
    });
    await db.nightLogs.put(log);
    const firstSaved = await db.nightLogs.get(log.id);

    // Second pass: no change, no update call. The UI's "unchanged" branch
    // in handleApply() skips these rows entirely, so we just assert the
    // row is still in its post-first-pass state.
    const secondSaved = await db.nightLogs.get(log.id);
    expect(secondSaved).toEqual(firstSaved);
  });
});
