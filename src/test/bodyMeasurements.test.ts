import { describe, it, expect, beforeEach } from 'vitest';
import { db, seedDatabase } from '../db';
import type { BodyMeasurement } from '../types';
import {
  overnightDelta,
  deltasForNight,
  upsertMeasurement,
  nightLogIdForMeasurement,
  formatNeck,
  roundMeasurement,
  latestMeasurement,
} from '../services/bodyMeasurements';
import { buildFullExport, importBackup } from '../services/backup';
import { createBlankNightLog } from '../utils';

function bm(overrides: Partial<BodyMeasurement>): BodyMeasurement {
  return {
    id: crypto.randomUUID(),
    kind: 'weight',
    nightLogId: null,
    date: '2026-09-03',
    time: '21:00',
    timestamp: new Date(2026, 8, 3, 21, 0).getTime(),
    period: 'evening',
    value: 172.4,
    measured: true,
    createdAt: 0,
    ...overrides,
  };
}

describe('overnight deltas', () => {
  it('PM to next AM', () => {
    const rows = [
      bm({ value: 172.4 }),
      bm({ date: '2026-09-04', period: 'morning', value: 174.2, timestamp: new Date(2026, 8, 4, 7, 0).getTime() }),
    ];
    expect(overnightDelta('weight', '2026-09-03', rows)).toBeCloseTo(1.8, 5);
  });

  it('missing AM yields null', () => {
    expect(overnightDelta('weight', '2026-09-03', [bm({})])).toBeNull();
  });

  it('interpolated rows never feed a delta', () => {
    const rows = [
      bm({ value: 172.4 }),
      bm({ date: '2026-09-04', period: 'morning', value: 174.2, measured: false }),
    ];
    expect(overnightDelta('weight', '2026-09-03', rows)).toBeNull();
  });

  it('neck delta in inches', () => {
    const rows = [
      bm({ kind: 'neck', value: 15.6 }),
      bm({ kind: 'neck', date: '2026-09-04', period: 'morning', value: 16.1 }),
    ];
    expect(overnightDelta('neck', '2026-09-03', rows)).toBeCloseTo(0.5, 5);
  });

  it('deltasForNight returns both kinds', () => {
    const rows = [
      bm({ value: 170 }),
      bm({ date: '2026-09-04', period: 'morning', value: 171 }),
      bm({ kind: 'neck', value: 15.0 }),
    ];
    expect(deltasForNight('2026-09-03', rows)).toEqual({ weightDeltaLbs: 1, neckDeltaIn: null });
  });
});

describe('rounding and formatting', () => {
  it('weight rounds to 0.1 lb, neck to 0.1 in', () => {
    expect(roundMeasurement('weight', 172.44)).toBe(172.4);
    expect(roundMeasurement('neck', 15.66)).toBe(15.7);
  });
  it('formatNeck converts to cm for metric', () => {
    expect(formatNeck(15.6, 'us')).toBe('15.6 in');
    expect(formatNeck(15.6, 'metric')).toBe('39.6 cm');
  });
});

describe('nightLogIdForMeasurement', () => {
  it('links PM rows to that evening and AM rows to the previous evening', () => {
    const logs = [
      createBlankNightLog('2026-09-03', { expectedAlarmTime: '', actualAlarmTime: '', isOverridden: false, targetBedtime: '', eatingCutoff: '', supplementTime: '' }),
    ];
    expect(nightLogIdForMeasurement('2026-09-03', 'evening', logs)).toBe(logs[0].id);
    expect(nightLogIdForMeasurement('2026-09-04', 'morning', logs)).toBe(logs[0].id);
    expect(nightLogIdForMeasurement('2026-09-04', 'evening', logs)).toBeNull();
  });
});

describe('upsertMeasurement', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await seedDatabase();
  });

  it('writes one row per kind+date+period and updates on re-save', async () => {
    await upsertMeasurement({ kind: 'weight', date: '2026-09-03', period: 'evening', value: 172.4, nightLogId: 'n1', measured: true });
    await upsertMeasurement({ kind: 'neck', date: '2026-09-03', period: 'evening', value: 15.6, nightLogId: 'n1', measured: true });
    expect(await db.bodyMeasurements.count()).toBe(2);
    await upsertMeasurement({ kind: 'weight', date: '2026-09-03', period: 'evening', value: 172.6, nightLogId: 'n1', measured: true });
    const rows = await db.bodyMeasurements.where('kind').equals('weight').toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(172.6);
    expect(rows[0].period).toBe('evening');
  });

  it('latestMeasurement returns the newest measured row of a kind', async () => {
    await upsertMeasurement({ kind: 'weight', date: '2026-09-02', period: 'morning', value: 170, nightLogId: null, measured: true, timestamp: 1000 });
    await upsertMeasurement({ kind: 'weight', date: '2026-09-03', period: 'morning', value: 171, nightLogId: null, measured: true, timestamp: 2000 });
    await upsertMeasurement({ kind: 'weight', date: '2026-09-04', period: 'morning', value: 175, nightLogId: null, measured: false, timestamp: 3000 });
    expect((await latestMeasurement('weight'))?.value).toBe(171);
    expect(await latestMeasurement('neck')).toBeNull();
  });
});

describe('backup round trip', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await seedDatabase();
  });

  it('full export includes bodyMeasurements and import restores them', async () => {
    await db.bodyMeasurements.bulkAdd([
      bm({ id: 'a' }), bm({ id: 'b', date: '2026-09-04', period: 'morning' }), bm({ id: 'c', date: '2026-09-05', period: 'morning' }),
      bm({ id: 'd', kind: 'neck' }), bm({ id: 'e', kind: 'neck', date: '2026-09-04', period: 'morning' }),
    ]);
    await db.orthostaticReadings.add({
      id: 'o1', date: '2026-09-04', slot: 'am', timestamp: 1, source: 'cuff',
      supine: { systolic: 120, diastolic: 78, pulse: 60 }, standing1: null, standing3: null, notes: '', createdAt: 1,
    });
    const payload = await buildFullExport();
    expect(payload.bodyMeasurements).toHaveLength(5);
    expect(payload.orthostaticReadings).toHaveLength(1);
    await importBackup(JSON.parse(JSON.stringify(payload)));
    expect(await db.bodyMeasurements.count()).toBe(5);
    expect(await db.orthostaticReadings.count()).toBe(1);
    expect((await db.bodyMeasurements.get('d'))?.kind).toBe('neck');
  });

  it('a pre-v12 backup with weightEntries and high_salt nights is translated on import', async () => {
    const night = createBlankNightLog('2026-04-06', { expectedAlarmTime: '', actualAlarmTime: '', isOverridden: false, targetBedtime: '', eatingCutoff: '', supplementTime: '' }) as unknown as Record<string, unknown>;
    const intake = night.eveningIntake as Record<string, unknown>;
    delete intake.sodiumLevel; delete intake.sodiumLevelSource; delete intake.sodiumSources;
    (intake.flags as { type: string; label: string; active: boolean }[]).push({ type: 'high_salt', label: 'High salt', active: true });
    delete night.positionStarted; delete night.wiredWake;
    const legacy = {
      version: 1,
      nightLogs: [night],
      weightEntries: [
        { id: 'w1', nightLogId: null, date: '2026-04-06', time: '07:00', timestamp: 1, weightLbs: 170, period: 'morning', createdAt: 1, measured: true },
        { id: 'w2', nightLogId: null, date: '2026-04-07', time: '07:00', timestamp: 2, weightLbs: 170.5, period: 'morning', createdAt: 2, measured: true },
        { id: 'w3', nightLogId: null, date: '2026-04-08', time: '07:00', timestamp: 3, weightLbs: 171, period: 'morning', createdAt: 3, measured: false },
        { id: 'w4', nightLogId: null, date: '2026-04-09', time: '07:00', timestamp: 4, weightLbs: 171.2, period: 'morning', createdAt: 4, measured: true },
      ],
      config: { appSettings: null },
    };
    await importBackup(legacy);
    const bms = await db.bodyMeasurements.orderBy('timestamp').toArray();
    expect(bms.map((b) => b.id)).toEqual(['w1', 'w2', 'w3', 'w4']);
    expect(bms.every((b) => b.kind === 'weight')).toBe(true);
    expect(bms[1].value).toBe(170.5);
    const log = (await db.nightLogs.toArray())[0];
    expect(log.eveningIntake.sodiumLevel).toBe('more');
    expect(log.eveningIntake.sodiumLevelSource).toBe('proxy');
    expect(log.eveningIntake.flags.some((f) => (f.type as string) === 'high_salt')).toBe(false);
    expect(log.positionStarted).toBe('unknown');
    expect(log.wiredWake).toBe(false);
  });
});
