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
  parseSpo2Rows,
  parseSpo2Binning,
  parseRespiratoryRates,
  parseSkinTemperatures,
  parseOffsetMinutes,
  toLocalNightDate,
  buildSleepData,
  assignNight,
  makeNightAssigner,
  reportGroup,
  planImport,
  runImport,
  type ImportFile,
} from '../services/samsungExport';
import {
  SLEEP_CSV, SLEEP_STAGE_CSV, HEART_RATE_CSV, HEART_RATE_BINNING_JSON, SPO2_CSV, SPO2_SESSION_CSV, SPO2_BINNING_JSON,
  RESPIRATORY_RATE_CSV, SKIN_TEMPERATURE_CSV, UNKNOWN_CSV,
} from './fixtures/samsung';

const ALARM = { expectedAlarmTime: '', actualAlarmTime: '', isOverridden: false, targetBedtime: '', eatingCutoff: '', supplementTime: '' };
const HR_BINNING_NAME = 'jsons/com.samsung.shealth.tracker.heart_rate/0/abc.com.samsung.health.heart_rate.binning_data.json';

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
    expect(classifyFile('com.samsung.health.respiratory_rate.202609041200.csv')).toBe('respiratory_rate');
    expect(classifyFile('com.samsung.health.skin_temperature.202609041200.csv')).toBe('skin_temperature');
    expect(classifyFile(HR_BINNING_NAME)).toBe('hr_binning');
    expect(classifyFile('jsons/com.samsung.shealth.tracker.oxygen_saturation/0/def.com.samsung.health.oxygen_saturation.binning.json')).toBe('spo2_binning');
    expect(classifyFile('com.samsung.shealth.food_info.202609041200.csv')).toBeNull();
    expect(classifyFile('com.samsung.shealth.sleep_combined.202609041200.csv')).toBeNull();
  });

  it('ignores the *.raw sensor datasets and unrelated json blobs', () => {
    expect(classifyFile('com.samsung.health.oxygen_saturation.raw.202609041200.csv')).toBeNull();
    expect(classifyFile('jsons/com.samsung.health.oxygen_saturation.raw/1/x.binning_data.json')).toBeNull();
    expect(classifyFile('jsons/com.samsung.health.movement/5/x.binning_data.json')).toBeNull();
    expect(classifyFile('jsons/com.samsung.health.hrv/0/x.binning_data.json')).toBeNull();
  });

  it('groups per-record json blobs by dataset for the report; CSVs stay individual', () => {
    expect(reportGroup('export/jsons/com.samsung.health.movement/5/x.binning_data.json')).toBe('export/jsons/com.samsung.health.movement');
    expect(reportGroup('jsons/com.samsung.health.movement/x.json')).toBe('jsons/com.samsung.health.movement');
    expect(reportGroup('export/com.samsung.shealth.sleep.csv')).toBeNull();
    expect(reportGroup('lonely.json')).toBeNull();
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

  it('maps the real stage codes (40001 awake, 40002 light, 40003 deep, 40004 rem)', () => {
    expect(parseSleepStages(SLEEP_STAGE_CSV).map((s) => s.stage)).toEqual(['deep', 'light', 'rem', 'awake']);
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

  it('vitals passed in land on SleepData', () => {
    const [session] = parseSleepSessions(SLEEP_CSV);
    const sd = buildSleepData(session, [], { avgHeartRate: 55, minHeartRate: 44, avgRespiratoryRate: 15.3, bloodOxygenAvg: 95, skinTempRange: '32.9-35.9°C' });
    expect(sd).toMatchObject({ avgHeartRate: 55, minHeartRate: 44, avgRespiratoryRate: 15.3, bloodOxygenAvg: 95, skinTempRange: '32.9-35.9°C' });
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
    expect(rows[0].binningFile).toBe('abc.com.samsung.health.heart_rate.binning_data.json');
    expect(rows[0].heartRate).toBe(52);
  });
  it('spo2 csv yields samples in UTC ms', () => {
    const samples = parseSpo2Csv(SPO2_CSV);
    expect(samples).toHaveLength(2);
    expect(samples[1]).toEqual({ kind: 'spo2', timestamp: Date.UTC(2026, 8, 4, 8, 5, 0), value: 88 });
  });
  it('real-shaped spo2 rows carry the session average and a binning reference', () => {
    const [row] = parseSpo2Rows(SPO2_SESSION_CSV);
    expect(row).toMatchObject({ spo2: 95, min: 80, max: 98, binningFile: 'def.com.samsung.health.oxygen_saturation.binning.json' });
    expect(parseSpo2Binning(SPO2_BINNING_JSON)).toEqual([
      { kind: 'spo2', timestamp: Date.UTC(2026, 8, 4, 3, 0, 0), value: 96 },
      { kind: 'spo2', timestamp: Date.UTC(2026, 8, 4, 3, 10, 0), value: 91 },
    ]);
  });
  it('respiratory rate and skin temperature rows parse with no unknown columns', () => {
    const rr = parseRespiratoryRates(RESPIRATORY_RATE_CSV);
    expect(rr.unrecognized).toEqual([]);
    expect(rr.rows[0].values.average).toBeCloseTo(15.347, 3);
    const st = parseSkinTemperatures(SKIN_TEMPERATURE_CSV);
    expect(st.unrecognized).toEqual([]);
    expect(st.rows[0].values).toMatchObject({ min: 32.89848, max: 35.90499 });
  });
  it('samples are assigned to nights by overnight window (21:00 local → 12:00 next day)', () => {
    const nights = [{ id: 'n1', date: '2026-09-03' }];
    expect(assignNight(new Date(2026, 8, 4, 4, 20).getTime(), nights)).toBe('n1');
    expect(assignNight(new Date(2026, 8, 3, 15, 0).getTime(), nights)).toBeNull();
    expect(assignNight(new Date(2026, 8, 3, 21, 30).getTime(), nights)).toBe('n1');
  });
  it('the precomputed assigner agrees with assignNight over many unsorted nights', () => {
    const nights = Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, date: `2026-08-${String(i + 1).padStart(2, '0')}` })).reverse();
    const assign = makeNightAssigner(nights);
    for (let day = 1; day <= 40; day++) {
      for (const hour of [0, 4, 11, 12, 15, 21, 23]) {
        const ts = new Date(2026, 7, day, hour, 30).getTime();
        expect(assign(ts)).toBe(assignNight(ts, nights));
      }
    }
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
      { name: HR_BINNING_NAME, text: HEART_RATE_BINNING_JSON },
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
    expect(byName['jsons/com.samsung.shealth.tracker.heart_rate']).toMatchObject({ recognized: true });
    expect(byName['jsons/com.samsung.shealth.tracker.heart_rate'].note).toMatch(/1 file/);
    expect(plan.nights.map((n) => n.nightDate)).toEqual(['2026-09-03', '2026-09-04']);
    expect(plan.nights.every((n) => n.status === 'new' && n.selected)).toBe(true);
    expect(plan.samples).toHaveLength(5);
  });

  it('fills the night vitals from HR samples inside the session and the per-session CSVs', async () => {
    const plan = await planImport(
      [
        ...files().filter((f) => !f.name.includes('oxygen_saturation')),
        { name: 'com.samsung.shealth.tracker.oxygen_saturation.202609041200.csv', text: SPO2_SESSION_CSV },
        { name: 'jsons/com.samsung.shealth.tracker.oxygen_saturation/0/def.com.samsung.health.oxygen_saturation.binning.json', text: SPO2_BINNING_JSON },
        { name: 'com.samsung.health.respiratory_rate.202609041200.csv', text: RESPIRATORY_RATE_CSV },
        { name: 'com.samsung.health.skin_temperature.202609041200.csv', text: SKIN_TEMPERATURE_CSV },
      ],
      [],
    );
    const n1 = plan.nights.find((n) => n.nightDate === '2026-09-03')!;
    // HR binning samples 52/61/98 at 08:00–08:02 UTC sit inside the 02:53–08:44 session.
    expect(n1.sleepData.avgHeartRate).toBe(70);
    expect(n1.sleepData.minHeartRate).toBe(52);
    expect(n1.sleepData.avgRespiratoryRate).toBe(15.3);
    expect(n1.sleepData.bloodOxygenAvg).toBe(95);
    expect(n1.sleepData.skinTempRange).toBe('32.9-35.9°C');
    const n2 = plan.nights.find((n) => n.nightDate === '2026-09-04')!;
    expect(n2.sleepData.avgHeartRate).toBe(0);
    expect(n2.sleepData.minHeartRate).toBeNull();
    expect(n2.sleepData.skinTempRange).toBe('');
    // SpO2 per-bin samples come from the binning file, not one-per-row.
    expect(plan.samples.filter((s) => s.kind === 'spo2').map((s) => s.value)).toEqual([96, 91]);
  });

  it('reads only recognised files, lazily, and reports progress', async () => {
    const read: string[] = [];
    const progress: [number, number][] = [];
    const lazy = (name: string, text: string): ImportFile => ({ name, text: async () => { read.push(name); return text; } });
    const input: ImportFile[] = [
      ...files().map((f) => lazy(f.name, f.text as string)),
      ...Array.from({ length: 30 }, (_, i) => lazy(`jsons/com.samsung.health.movement/${i % 4}/blob-${i}.binning_data.json`, '[]')),
      lazy('jsons/com.samsung.health.oxygen_saturation.raw/1/x.binning_data.json', '[]'),
    ];
    const plan = await planImport(input, [], { onProgress: (d, t) => progress.push([d, t]), concurrency: 3 });
    expect(read.sort()).toEqual(files().filter((f) => !f.name.includes('food_info')).map((f) => f.name).sort());
    expect(progress[0]).toEqual([0, 4]); // CSVs first
    expect(progress[progress.length - 1]).toEqual([5, 5]); // then the one referenced binning file
    const byName = Object.fromEntries(plan.report.map((r) => [r.name, r]));
    expect(plan.report).toHaveLength(8); // 6 named + movement group + raw group
    expect(byName['jsons/com.samsung.health.movement']).toMatchObject({ recognized: false });
    expect(byName['jsons/com.samsung.health.movement'].note).toMatch(/30 files/);
    expect(byName['jsons/com.samsung.health.oxygen_saturation.raw'].note).toMatch(/1 file · not used/);
    expect(plan.samples).toHaveLength(5);
  });

  it('sinceMs keeps only sessions and samples in range and never reads binning files older rows reference', async () => {
    const read: string[] = [];
    const lazy = (name: string, text: string): ImportFile => ({ name, text: async () => { read.push(name); return text; } });
    const oldBinning = 'jsons/com.samsung.shealth.tracker.heart_rate/1/old.com.samsung.health.heart_rate.binning_data.json';
    const hrCsv = HEART_RATE_CSV.replace(/\n$/, '') + '\n2026-08-01 08:00:00.000,2026-08-01 09:00:00.000,UTC-0400,50,45,60,old.com.samsung.health.heart_rate.binning_data.json,uuid-hr-old\n';
    const input: ImportFile[] = [
      ...files().filter((f) => !f.name.includes('heart_rate')).map((f) => lazy(f.name, f.text as string)),
      lazy('com.samsung.shealth.tracker.heart_rate.202609041200.csv', hrCsv),
      lazy(HR_BINNING_NAME, HEART_RATE_BINNING_JSON),
      lazy(oldBinning, JSON.stringify([{ start_time: Date.UTC(2026, 7, 1, 8, 0, 0), end_time: Date.UTC(2026, 7, 1, 8, 0, 59), heart_rate: 50 }])),
    ];
    // Range starts on the morning of 09-05 (UTC 06:00): night 09-04 only.
    const plan = await planImport(input, [], { sinceMs: Date.UTC(2026, 8, 5, 6, 0, 0) });
    expect(plan.nights.map((n) => n.nightDate)).toEqual(['2026-09-04']);
    expect(plan.samples).toEqual([]);
    expect(read).not.toContain(HR_BINNING_NAME);
    expect(read).not.toContain(oldBinning);
    const byName = Object.fromEntries(plan.report.map((r) => [r.name, r]));
    expect(byName['com.samsung.shealth.sleep.202609041200.csv']).toMatchObject({ rows: 2 });
    expect(byName['com.samsung.shealth.sleep.202609041200.csv'].note).toMatch(/1 in range/);
    expect(byName['com.samsung.shealth.tracker.heart_rate.202609041200.csv'].note).toMatch(/0 in range/);
    expect(byName['jsons/com.samsung.shealth.tracker.heart_rate'].note).toMatch(/2 files · 0 read/);

    // Widening to include night 09-03 reads the referenced binning file but still not the August one.
    read.length = 0;
    const wider = await planImport(input, [], { sinceMs: Date.UTC(2026, 8, 4, 0, 0, 0) });
    expect(wider.nights.map((n) => n.nightDate)).toEqual(['2026-09-03', '2026-09-04']);
    expect(wider.samples).toHaveLength(5);
    expect(read).toContain(HR_BINNING_NAME);
    expect(read).not.toContain(oldBinning);

    // No range: everything, including the August sample.
    const all = await planImport(input, []);
    expect(all.samples).toHaveLength(6);
  });

  it('a night that already has sleepData is unchecked by default; a duplicate fingerprint is flagged', async () => {
    const existing = createBlankNightLog('2026-09-03', ALARM);
    existing.sleepData = { sleepTime: '22:00', wakeTime: '05:00', totalSleepDuration: 400, actualSleepDuration: 380, sleepScore: 70, sleepScoreDelta: 0, deepSleep: 50, remSleep: 90, lightSleep: 240, awakeDuration: 20, avgHeartRate: 50, minHeartRate: 42, avgRespiratoryRate: 14, bloodOxygenAvg: 95, skinTempRange: '', sleepLatencyRating: 'Good', restfulnessRating: 'Good', deepSleepRating: 'Good', remSleepRating: 'Good', importedAt: 1 };
    const first = await planImport(files(), []);
    const dup = createBlankNightLog('2026-09-05', ALARM);
    dup.sleepData = first.nights.find((n) => n.nightDate === '2026-09-03')!.sleepData;
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
