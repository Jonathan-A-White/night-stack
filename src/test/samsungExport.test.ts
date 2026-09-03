import { describe, it, expect, beforeEach } from 'vitest';
import { db, seedDatabase } from '../db';
import { createBlankNightLog } from '../utils';
import {
  classifyFile,
  parseSamsungCsv,
  parseSleepSessions,
  parseSleepStages,
  parseHeartRateCsv,
  parseHeartRateBinning,
  parseSpo2Csv,
  parseOffsetMinutes,
  toLocalNightDate,
  buildSleepData,
  assignNight,
  planImport,
  runImport,
  type ImportFile,
} from '../services/samsungExport';
import {
  SLEEP_CSV, SLEEP_STAGE_CSV, HEART_RATE_CSV, HEART_RATE_BINNING_JSON, SPO2_CSV, UNKNOWN_CSV,
} from './fixtures/samsung';

const ALARM = { expectedAlarmTime: '', actualAlarmTime: '', isOverridden: false, targetBedtime: '', eatingCutoff: '', supplementTime: '' };

describe('CSV envelope', () => {
  it('skips the metadata line, strips prefixes, reports unknown columns', () => {
    const r = parseSamsungCsv(SLEEP_CSV, ['start_time', 'end_time', 'time_offset', 'sleep_score', 'efficiency', 'sleep_duration', 'datauuid']);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].start_time).toBe('2026-09-04 02:53:00.000');
    expect(r.rows[0].sleep_score).toBe('79');
    expect(r.unrecognized).toEqual(['mental_recovery', 'physical_recovery', 'sleep_cycle', 'mystery_col']);
  });

  it('classifies files by name', () => {
    expect(classifyFile('com.samsung.shealth.sleep.202609041200.csv')).toBe('sleep');
    expect(classifyFile('com.samsung.health.sleep_stage.202609041200.csv')).toBe('sleep_stage');
    expect(classifyFile('com.samsung.shealth.tracker.heart_rate.202609041200.csv')).toBe('heart_rate');
    expect(classifyFile('com.samsung.shealth.tracker.oxygen_saturation.202609041200.csv')).toBe('spo2');
    expect(classifyFile('jsons/com.samsung.shealth.tracker.heart_rate/abc.binning_data.json')).toBe('hr_binning');
    expect(classifyFile('com.samsung.shealth.food_info.202609041200.csv')).toBeNull();
  });
});

describe('time handling', () => {
  it('parses offsets', () => {
    expect(parseOffsetMinutes('UTC-0400')).toBe(-240);
    expect(parseOffsetMinutes('UTC+0530')).toBe(330);
    expect(parseOffsetMinutes('garbage')).toBe(0);
  });
  it('UTC start with offset maps to the evening date', () => {
    expect(toLocalNightDate('2026-09-04 02:53:00.000', -240)).toBe('2026-09-03');
  });
  it('a session starting after local noon is the same day', () => {
    expect(toLocalNightDate('2026-09-03 23:10:00.000', -240)).toBe('2026-09-03');
  });
});

describe('sleep sessions and stages', () => {
  it('parses sessions', () => {
    const sessions = parseSleepSessions(SLEEP_CSV);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({ nightDate: '2026-09-03', sleepScore: 79, efficiency: 93, durationMin: 351, datauuid: 'uuid-night-1', offsetMin: -240 });
    expect(sessions[0].sleepTime).toBe('22:53');
    expect(sessions[0].wakeTime).toBe('04:44');
  });

  it('stages sum into SleepData', () => {
    const [session] = parseSleepSessions(SLEEP_CSV);
    const stages = parseSleepStages(SLEEP_STAGE_CSV);
    expect(stages).toHaveLength(4);
    const sd = buildSleepData(session, stages);
    expect(sd.deepSleep).toBe(63);
    expect(sd.lightSleep).toBe(159);
    expect(sd.remSleep).toBe(112);
    expect(sd.awakeDuration).toBe(17);
    expect(sd.actualSleepDuration).toBe(334);
    expect(sd.totalSleepDuration).toBe(351);
    expect(sd.sleepScore).toBe(79);
    expect(sd.sleepTime).toBe('22:53');
    expect(sd.wakeTime).toBe('04:44');
    expect(sd.avgHeartRate).toBe(0);
  });

  it('a session without stages falls back to the session duration', () => {
    const [, session2] = parseSleepSessions(SLEEP_CSV);
    const sd = buildSleepData(session2, []);
    expect(sd.totalSleepDuration).toBe(330);
    expect(sd.actualSleepDuration).toBe(330);
    expect(sd.deepSleep).toBe(0);
  });
});

describe('per-minute samples', () => {
  it('heart-rate binning json produces one sample per minute', () => {
    const samples = parseHeartRateBinning(HEART_RATE_BINNING_JSON);
    expect(samples).toHaveLength(3);
    expect(samples[0]).toEqual({ kind: 'hr', timestamp: Date.UTC(2026, 8, 4, 8, 0, 0), value: 52 });
  });
  it('heart-rate csv rows reference their binning file', () => {
    const rows = parseHeartRateCsv(HEART_RATE_CSV);
    expect(rows[0].binningFile).toBe('abc.binning_data.json');
    expect(rows[0].heartRate).toBe(52);
  });
  it('spo2 csv yields samples in UTC ms', () => {
    const samples = parseSpo2Csv(SPO2_CSV);
    expect(samples).toHaveLength(2);
    expect(samples[1]).toEqual({ kind: 'spo2', timestamp: Date.UTC(2026, 8, 4, 8, 5, 0), value: 88 });
  });
  it('samples are assigned to nights by overnight window (21:00 local → 12:00 next day)', () => {
    const nights = [{ id: 'n1', date: '2026-09-03' }];
    expect(assignNight(new Date(2026, 8, 4, 4, 20).getTime(), nights)).toBe('n1');
    expect(assignNight(new Date(2026, 8, 3, 15, 0).getTime(), nights)).toBeNull();
    expect(assignNight(new Date(2026, 8, 3, 21, 30).getTime(), nights)).toBe('n1');
  });
});

describe('planImport + runImport', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await seedDatabase();
  });

  function files(): ImportFile[] {
    return [
      { name: 'com.samsung.shealth.sleep.202609041200.csv', text: SLEEP_CSV },
      { name: 'com.samsung.health.sleep_stage.202609041200.csv', text: SLEEP_STAGE_CSV },
      { name: 'com.samsung.shealth.tracker.heart_rate.202609041200.csv', text: HEART_RATE_CSV },
      { name: 'jsons/com.samsung.shealth.tracker.heart_rate/abc.binning_data.json', text: HEART_RATE_BINNING_JSON },
      { name: 'com.samsung.shealth.tracker.oxygen_saturation.202609041200.csv', text: SPO2_CSV },
      { name: 'com.samsung.shealth.food_info.202609041200.csv', text: UNKNOWN_CSV },
    ];
  }

  it('reports every file and previews nights', async () => {
    const plan = await planImport(files(), []);
    const byName = Object.fromEntries(plan.report.map((r) => [r.name, r]));
    expect(byName['com.samsung.shealth.sleep.202609041200.csv']).toMatchObject({ recognized: true, rows: 2 });
    expect(byName['com.samsung.shealth.food_info.202609041200.csv']).toMatchObject({ recognized: false });
    expect(byName['com.samsung.shealth.food_info.202609041200.csv'].note).toMatch(/not used/i);
    expect(plan.nights.map((n) => n.nightDate)).toEqual(['2026-09-03', '2026-09-04']);
    expect(plan.nights.every((n) => n.status === 'new' && n.selected)).toBe(true);
    expect(plan.samples).toHaveLength(5);
  });

  it('a night that already has sleepData is unchecked by default; a duplicate fingerprint is flagged', async () => {
    const existing = createBlankNightLog('2026-09-03', ALARM);
    existing.sleepData = { sleepTime: '22:00', wakeTime: '05:00', totalSleepDuration: 400, actualSleepDuration: 380, sleepScore: 70, sleepScoreDelta: 0, deepSleep: 50, remSleep: 90, lightSleep: 240, awakeDuration: 20, avgHeartRate: 50, minHeartRate: 42, avgRespiratoryRate: 14, bloodOxygenAvg: 95, skinTempRange: '', sleepLatencyRating: 'Good', restfulnessRating: 'Good', deepSleepRating: 'Good', remSleepRating: 'Good', importedAt: 1 };
    const [s1] = parseSleepSessions(SLEEP_CSV);
    const dup = createBlankNightLog('2026-09-05', ALARM);
    dup.sleepData = buildSleepData(s1, parseSleepStages(SLEEP_STAGE_CSV));
    const plan = await planImport(files(), [existing, dup]);
    const n1 = plan.nights.find((n) => n.nightDate === '2026-09-03')!;
    expect(n1.status).toBe('has_data');
    expect(n1.selected).toBe(false);
    expect(n1.duplicateOf).toBe('2026-09-05');
  });

  it('runImport writes sleepData, samples, and a batch; re-import is idempotent', async () => {
    const plan = await planImport(files(), []);
    await runImport(plan);
    const logs = await db.nightLogs.orderBy('date').toArray();
    expect(logs.map((l) => l.date)).toEqual(['2026-09-03', '2026-09-04']);
    expect(logs[0].autoCreated).toBe(true);
    expect(logs[0].sleepData?.deepSleep).toBe(63);
    expect(await db.vitalSamples.count()).toBe(5);
    const early = await db.vitalSamples.where('kind').equals('hr').toArray();
    // 08:00 UTC = 04:00 local on 09-04 → night 2026-09-03
    expect(early.every((s) => s.nightLogId === logs[0].id)).toBe(true);
    expect(await db.importBatches.count()).toBe(1);

    const again = await planImport(files(), await db.nightLogs.toArray());
    expect(again.nights.every((n) => n.status === 'has_data' && !n.selected)).toBe(true);
    await runImport(again);
    expect(await db.vitalSamples.count()).toBe(5);
    expect(await db.importBatches.count()).toBe(2);
    expect(await db.nightLogs.count()).toBe(2);
  });
});
