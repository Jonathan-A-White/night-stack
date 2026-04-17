import { describe, it, expect } from 'vitest';
import { parseSamsungHealthJSON, parseGoveeCSV } from '../services/importers';

describe('parseSamsungHealthJSON', () => {
  const validJSON = {
    sleepTime: '22:31',
    wakeTime: '04:43',
    totalSleepDuration: 372,
    actualSleepDuration: 351,
    sleepScore: 82,
    sleepScoreDelta: 5,
    deepSleep: 64,
    remSleep: 108,
    lightSleep: 179,
    awakeDuration: 21,
    avgHeartRate: 48,
    minHeartRate: 42,
    avgRespiratoryRate: 15.1,
    bloodOxygenAvg: 93,
    skinTempRange: '-2.5 to +2.1°F',
    sleepLatencyRating: 'Excellent',
    restfulnessRating: 'Excellent',
    deepSleepRating: 'Excellent',
    remSleepRating: 'Excellent',
  };

  it('parses valid JSON successfully', () => {
    const result = parseSamsungHealthJSON(JSON.stringify(validJSON));
    expect(result.error).toBeNull();
    expect(result.data).not.toBeNull();
    expect(result.data!.sleepScore).toBe(82);
    expect(result.data!.sleepTime).toBe('22:31');
    expect(result.data!.deepSleep).toBe(64);
    expect(result.data!.minHeartRate).toBe(42);
    expect(result.data!.importedAt).toBeGreaterThan(0);
    expect(result.wakeUpEvents).toEqual([]);
  });

  it('treats minHeartRate as optional (null when missing)', () => {
    const withoutMin = { ...validJSON };
    delete (withoutMin as Record<string, unknown>).minHeartRate;
    const result = parseSamsungHealthJSON(JSON.stringify(withoutMin));
    expect(result.error).toBeNull();
    expect(result.data!.minHeartRate).toBeNull();
  });

  it('rejects JSON with missing required fields', () => {
    const incomplete = { sleepTime: '22:00', wakeTime: '06:00' };
    const result = parseSamsungHealthJSON(JSON.stringify(incomplete));
    expect(result.error).toContain('Missing required fields');
    expect(result.data).toBeNull();
  });

  it('rejects invalid rating values', () => {
    const bad = { ...validJSON, sleepLatencyRating: 'Terrible' };
    const result = parseSamsungHealthJSON(JSON.stringify(bad));
    expect(result.error).toContain('Invalid rating');
    expect(result.data).toBeNull();
  });

  it('rejects sleep score out of range', () => {
    const bad = { ...validJSON, sleepScore: 150 };
    const result = parseSamsungHealthJSON(JSON.stringify(bad));
    expect(result.error).toContain('Sleep score must be between');
    expect(result.data).toBeNull();
  });

  it('rejects invalid JSON string', () => {
    const result = parseSamsungHealthJSON('not json at all');
    expect(result.error).toBe('Invalid JSON format');
    expect(result.data).toBeNull();
  });

  it('handles missing optional fields gracefully', () => {
    const minimal = { ...validJSON };
    delete (minimal as Record<string, unknown>).skinTempRange;
    delete (minimal as Record<string, unknown>).sleepScoreDelta;
    const result = parseSamsungHealthJSON(JSON.stringify(minimal));
    expect(result.error).toBeNull();
    expect(result.data!.skinTempRange).toBe('');
    expect(result.data!.sleepScoreDelta).toBe(0);
  });

  it('parses wake-up events from JSON', () => {
    const withEvents = {
      ...validJSON,
      wakeUpEvents: [
        { startTime: '00:40', endTime: '00:55', cause: 'Too cold', notes: 'Had to add blanket' },
        { startTime: '03:15', endTime: '03:25', cause: 'Bathroom' },
      ],
    };
    const result = parseSamsungHealthJSON(JSON.stringify(withEvents));
    expect(result.error).toBeNull();
    expect(result.wakeUpEvents).toHaveLength(2);
    expect(result.wakeUpEvents[0]).toEqual({
      startTime: '00:40',
      endTime: '00:55',
      cause: 'Too cold',
      notes: 'Had to add blanket',
    });
    expect(result.wakeUpEvents[1]).toEqual({
      startTime: '03:15',
      endTime: '03:25',
      cause: 'Bathroom',
      notes: '',
    });
  });

  it('skips wake-up events without startTime', () => {
    const withBadEvent = {
      ...validJSON,
      wakeUpEvents: [
        { endTime: '01:00', cause: 'Noise' },
        { startTime: '02:30', endTime: '02:45', cause: 'Too hot' },
      ],
    };
    const result = parseSamsungHealthJSON(JSON.stringify(withBadEvent));
    expect(result.wakeUpEvents).toHaveLength(1);
    expect(result.wakeUpEvents[0].startTime).toBe('02:30');
  });
});

describe('parseSamsungHealthJSON — multi-session / date guard (bugfixes T1)', () => {
  const baseSession = {
    sleepTime: '22:31',
    wakeTime: '04:43',
    totalSleepDuration: 372,
    actualSleepDuration: 351,
    sleepScore: 82,
    sleepScoreDelta: 5,
    deepSleep: 64,
    remSleep: 108,
    lightSleep: 179,
    awakeDuration: 21,
    avgHeartRate: 48,
    minHeartRate: 42,
    avgRespiratoryRate: 15.1,
    bloodOxygenAvg: 93,
  };

  it('returns sessionDate when the JSON carries a sleepStartTime', () => {
    const session = { ...baseSession, sleepStartTime: '2026-04-16T22:31:00' };
    const result = parseSamsungHealthJSON(JSON.stringify(session));
    expect(result.error).toBeNull();
    expect(result.sessionDate).toBe('2026-04-16');
  });

  it('shifts an early-morning start back to the previous evening', () => {
    // 02:30 on 4/17 is really the 4/16 night.
    const session = { ...baseSession, sleepStartTime: '2026-04-17T02:30:00' };
    const result = parseSamsungHealthJSON(JSON.stringify(session));
    expect(result.sessionDate).toBe('2026-04-16');
  });

  it('picks the session that matches the targetDate in a multi-session JSON', () => {
    const payload = {
      sessions: [
        { ...baseSession, sleepStartTime: '2026-04-16T22:00:00', sleepScore: 82 },
        { ...baseSession, sleepStartTime: '2026-04-17T22:00:00', sleepScore: 93 },
      ],
    };
    const result = parseSamsungHealthJSON(JSON.stringify(payload), '2026-04-16');
    expect(result.error).toBeNull();
    expect(result.data!.sleepScore).toBe(82);
    expect(result.sessionDate).toBe('2026-04-16');
  });

  it('returns null + error when no session matches the targetDate (bugfixes T1 acceptance)', () => {
    const payload = {
      sessions: [
        { ...baseSession, sleepStartTime: '2026-04-16T22:00:00', sleepScore: 82 },
        { ...baseSession, sleepStartTime: '2026-04-17T22:00:00', sleepScore: 93 },
      ],
    };
    const result = parseSamsungHealthJSON(JSON.stringify(payload), '2026-04-15');
    expect(result.data).toBeNull();
    expect(result.error).toContain('No sleep session found matching 2026-04-15');
  });

  it('refuses to silently pick when a multi-session JSON has no target date', () => {
    const payload = {
      sessions: [
        { ...baseSession, sleepStartTime: '2026-04-16T22:00:00' },
        { ...baseSession, sleepStartTime: '2026-04-17T22:00:00' },
      ],
    };
    const result = parseSamsungHealthJSON(JSON.stringify(payload));
    expect(result.data).toBeNull();
    expect(result.error).toContain('no target date to match');
  });

  it('accepts a bare array of sessions', () => {
    const payload = [
      { ...baseSession, sleepStartTime: '2026-04-15T22:00:00', sleepScore: 75 },
      { ...baseSession, sleepStartTime: '2026-04-16T22:00:00', sleepScore: 82 },
    ];
    const result = parseSamsungHealthJSON(JSON.stringify(payload), '2026-04-15');
    expect(result.error).toBeNull();
    expect(result.data!.sleepScore).toBe(75);
  });

  it('returns a null sessionDate for a single-session JSON with no date fields (legacy path)', () => {
    const result = parseSamsungHealthJSON(JSON.stringify(baseSession));
    expect(result.error).toBeNull();
    expect(result.sessionDate).toBeNull();
  });
});

describe('parseGoveeCSV', () => {
  it('parses valid CSV with overnight readings', () => {
    const csv = `Timestamp,Temperature(°F),Humidity(%)
2026-04-06 21:00,68.2,45
2026-04-06 22:00,67.8,46
2026-04-06 23:00,67.5,47
2026-04-07 01:00,66.9,48
2026-04-07 06:00,66.5,49`;

    const result = parseGoveeCSV(csv, '2026-04-06');
    expect(result.error).toBeNull();
    expect(result.data).not.toBeNull();
    expect(result.data!.length).toBe(5);
    expect(result.data![0].tempF).toBe(68.2);
    expect(result.data![0].humidity).toBe(45);
  });

  it('filters out readings outside overnight window', () => {
    const csv = `Timestamp,Temperature(°F),Humidity(%)
2026-04-06 10:00,72.0,40
2026-04-06 22:00,67.8,46
2026-04-07 12:00,73.0,42`;

    const result = parseGoveeCSV(csv, '2026-04-06');
    expect(result.error).toBeNull();
    expect(result.data!.length).toBe(1);
    expect(result.data![0].tempF).toBe(67.8);
  });

  it('rejects empty CSV', () => {
    const result = parseGoveeCSV('', '2026-04-06');
    expect(result.error).toContain('empty');
  });

  it('rejects CSV without required columns', () => {
    const csv = `Name,Value\nfoo,bar`;
    const result = parseGoveeCSV(csv, '2026-04-06');
    expect(result.error).toContain('Could not find');
  });

  it('handles tab-delimited CSV', () => {
    const csv = `Timestamp\tTemperature(°F)\tHumidity(%)\n2026-04-06 22:00\t67.8\t46`;
    const result = parseGoveeCSV(csv, '2026-04-06');
    expect(result.error).toBeNull();
    expect(result.data!.length).toBe(1);
  });

  // bugfixes T3 acceptance: rows from 2026-04-17 must not end up attached to
  // the 2026-04-15 night log. The 2026-04-17 `nightstack-export.json`
  // surfaced exactly this corruption — 4/15's roomTimeline contained
  // 4/17-dated samples — and the fix has to hold against the regression
  // fixture regardless of which hypothesis (wrong nightDate / TZ) caused it.
  it('returns zero readings when all CSV rows are outside the target night window', () => {
    const csv = `Timestamp,Temperature(°F),Humidity(%)
2026-04-17 01:00,68.2,45
2026-04-17 02:00,67.8,46
2026-04-17 03:00,67.5,47`;
    const result = parseGoveeCSV(csv, '2026-04-15');
    expect(result.error).toBeNull();
    expect(result.data).not.toBeNull();
    expect(result.data!.length).toBe(0);
  });
});
