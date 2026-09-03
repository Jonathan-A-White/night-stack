import { describe, it, expect, beforeEach } from 'vitest';
import { db, seedDatabase } from '../db';
import { createBlankNightLog } from '../utils';
import {
  attachEpisode,
  updateEpisode,
  episodesForNight,
  hasEpisode,
  mergeEveningIntoAutoCreated,
  REOPEN_WINDOW_MS,
} from '../services/episodes';

const ALARM = {
  expectedAlarmTime: '04:43', actualAlarmTime: '04:43', isOverridden: false,
  targetBedtime: '21:13', eatingCutoff: '18:43', supplementTime: '20:28',
};

// 2026-09-04 04:31 local — a Friday morning, so the night is Thursday 09-03.
const T_0431 = new Date(2026, 8, 4, 4, 31).getTime();

describe('attachEpisode', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await seedDatabase();
  });

  it('appends an episode event to the existing night log', async () => {
    await db.nightLogs.put(createBlankNightLog('2026-09-03', ALARM));
    const res = await attachEpisode(T_0431);
    expect(res.nightDate).toBe('2026-09-03');
    expect(res.created).toBe(false);
    const log = (await db.nightLogs.where('date').equals('2026-09-03').first())!;
    expect(log.autoCreated).toBe(false);
    expect(log.wakeUpEvents).toHaveLength(1);
    const ev = log.wakeUpEvents[0];
    expect(ev.id).toBe(res.eventId);
    expect(ev.source).toBe('episode');
    expect(ev.capturedAt).toBe(T_0431);
    expect(ev.startTime).toBe('04:31');
    expect(ev.racingHeart).toBe(true);
    expect(ev.fellBackAsleep).toBe('no');
    expect(ev.positionAtWake).toBe('unknown');
    expect(ev.ecgVerdict).toBe('not_taken');
  });

  it('auto-creates a minimal night log when none exists', async () => {
    const res = await attachEpisode(T_0431);
    expect(res.created).toBe(true);
    const log = (await db.nightLogs.where('date').equals('2026-09-03').first())!;
    expect(log.autoCreated).toBe(true);
    expect(log.loggedBedtime).toBeNull();
    expect(log.thermalComfort).toBeNull();
    // Thursday 2026-09-03 evening → Friday alarm (dayOfWeek 5) is 06:15 in the seed.
    expect(log.alarm.actualAlarmTime).toBe('06:15');
    expect(log.alarm.expectedAlarmTime).toBe('06:15');
    expect(log.wakeUpEvents).toHaveLength(1);
    expect(log.wakeUpEvents[0].source).toBe('episode');
  });

  it('two concurrent taps create one night and one event', async () => {
    const [a, b] = await Promise.all([attachEpisode(T_0431), attachEpisode(T_0431)]);
    const logs = await db.nightLogs.where('date').equals('2026-09-03').toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0].wakeUpEvents).toHaveLength(1);
    expect(a.eventId).toBe(b.eventId);
  });

  it('a tap within the reopen window returns the same event; after it, appends a second', async () => {
    const first = await attachEpisode(T_0431);
    const again = await attachEpisode(T_0431 + REOPEN_WINDOW_MS - 1);
    expect(again.eventId).toBe(first.eventId);
    expect(again.reopened).toBe(true);
    const later = await attachEpisode(T_0431 + REOPEN_WINDOW_MS + 60_000);
    expect(later.eventId).not.toBe(first.eventId);
    const log = (await db.nightLogs.where('date').equals('2026-09-03').first())!;
    expect(log.wakeUpEvents).toHaveLength(2);
    expect(log.wakeUpEvents[1].startTime).toBe('04:42');
  });

  it('early-morning taps attach to the previous evening; evening taps to today', async () => {
    const late = new Date(2026, 8, 3, 23, 50).getTime();
    const res = await attachEpisode(late);
    expect(res.nightDate).toBe('2026-09-03');
  });
});

describe('updateEpisode', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await seedDatabase();
  });

  it('patches only the matching event and leaves siblings intact', async () => {
    await db.nightLogs.put(createBlankNightLog('2026-09-03', ALARM));
    const first = await attachEpisode(T_0431);
    const second = await attachEpisode(T_0431 + REOPEN_WINDOW_MS + 60_000);
    await updateEpisode(first.nightLogId, first.eventId, { positionAtWake: 'back' });
    await updateEpisode(first.nightLogId, first.eventId, { ecgTaken: true, ecgVerdict: 'afib' });
    await updateEpisode(first.nightLogId, second.eventId, { wired: true });
    const log = (await db.nightLogs.get(first.nightLogId))!;
    const a = log.wakeUpEvents.find((e) => e.id === first.eventId)!;
    const b = log.wakeUpEvents.find((e) => e.id === second.eventId)!;
    expect(a.positionAtWake).toBe('back');
    expect(a.ecgTaken).toBe(true);
    expect(a.ecgVerdict).toBe('afib');
    expect(a.wired).toBe(false);
    expect(b.positionAtWake).toBe('unknown');
    expect(b.wired).toBe(true);
    expect(a.lyingBp).toBeNull();
  });

  it('is a no-op for an unknown event id', async () => {
    await db.nightLogs.put(createBlankNightLog('2026-09-03', ALARM));
    const first = await attachEpisode(T_0431);
    const before = (await db.nightLogs.get(first.nightLogId))!;
    await updateEpisode(first.nightLogId, 'nope', { wired: true });
    const after = (await db.nightLogs.get(first.nightLogId))!;
    expect(after.wakeUpEvents).toEqual(before.wakeUpEvents);
  });
});

describe('episode helpers', () => {
  it('episodesForNight / hasEpisode only count source episode rows', () => {
    const log = createBlankNightLog('2026-09-03', ALARM);
    expect(hasEpisode(log)).toBe(false);
    log.wakeUpEvents = [
      { ...log.wakeUpEvents[0], id: 'x', startTime: '02:00', endTime: '', cause: '', fellBackAsleep: 'yes', minutesToFallBackAsleep: null, notes: '', wasSweating: false, feltCold: false, racingHeart: false, positionAtWake: 'unknown', ecgTaken: false, ecgVerdict: 'not_taken', rhythmFelt: null, lyingBp: null, minutesToSettle: null, wired: false, capturedAt: null, source: 'morning' },
      { id: 'y', startTime: '04:31', endTime: '', cause: '', fellBackAsleep: 'no', minutesToFallBackAsleep: null, notes: '', wasSweating: false, feltCold: false, racingHeart: true, positionAtWake: 'back', ecgTaken: false, ecgVerdict: 'not_taken', rhythmFelt: null, lyingBp: null, minutesToSettle: null, wired: true, capturedAt: 1, source: 'episode' },
    ];
    expect(episodesForNight(log).map((e) => e.id)).toEqual(['y']);
    expect(hasEpisode(log)).toBe(true);
  });

  it('mergeEveningIntoAutoCreated keeps id and episode rows and clears the flag', () => {
    const auto = createBlankNightLog('2026-09-03', ALARM);
    auto.autoCreated = true;
    auto.positionAtWake = 'side';
    auto.wiredWake = true;
    auto.wakeUpEvents = [
      { id: 'y', startTime: '04:31', endTime: '', cause: '', fellBackAsleep: 'no', minutesToFallBackAsleep: null, notes: '', wasSweating: false, feltCold: false, racingHeart: true, positionAtWake: 'back', ecgTaken: false, ecgVerdict: 'not_taken', rhythmFelt: null, lyingBp: null, minutesToSettle: null, wired: true, capturedAt: 1, source: 'episode' },
    ];
    const merged = mergeEveningIntoAutoCreated(auto, { eveningNotes: 'late dinner', clothing: ['c1'] });
    expect(merged.id).toBe(auto.id);
    expect(merged.autoCreated).toBe(false);
    expect(merged.wakeUpEvents).toHaveLength(1);
    expect(merged.positionAtWake).toBe('side');
    expect(merged.wiredWake).toBe(true);
    expect(merged.eveningNotes).toBe('late dinner');
    expect(merged.clothing).toEqual(['c1']);
  });
});
