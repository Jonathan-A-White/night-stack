import type { SleepData, SleepRating, RoomReading, WakeUpEvent } from '../types';

const VALID_RATINGS: SleepRating[] = ['Excellent', 'Good', 'Fair', 'Attention'];

export interface ParsedWakeUpEvent {
  startTime: string;
  endTime: string;
  cause: string; // label text from JSON (matched to WakeUpCause ID in component)
  notes: string;
}

export function parseSamsungHealthJSON(jsonStr: string): { data: SleepData | null; wakeUpEvents: ParsedWakeUpEvent[]; error: string | null } {
  try {
    const raw = JSON.parse(jsonStr);
    const missing: string[] = [];

    const requiredFields = [
      'sleepTime', 'wakeTime', 'totalSleepDuration', 'actualSleepDuration',
      'sleepScore', 'deepSleep', 'remSleep', 'lightSleep', 'awakeDuration',
      'avgHeartRate', 'avgRespiratoryRate', 'bloodOxygenAvg',
    ];

    for (const field of requiredFields) {
      if (raw[field] === undefined || raw[field] === null) {
        missing.push(field);
      }
    }

    if (missing.length > 0) {
      return { data: null, wakeUpEvents: [], error: `Missing required fields: ${missing.join(', ')}` };
    }

    // Validate ratings
    for (const field of ['sleepLatencyRating', 'restfulnessRating', 'deepSleepRating', 'remSleepRating'] as const) {
      if (raw[field] && !VALID_RATINGS.includes(raw[field])) {
        return { data: null, wakeUpEvents: [], error: `Invalid rating for ${field}: ${raw[field]}. Must be one of: ${VALID_RATINGS.join(', ')}` };
      }
    }

    // Validate numeric ranges
    if (raw.sleepScore < 0 || raw.sleepScore > 100) {
      return { data: null, wakeUpEvents: [], error: 'Sleep score must be between 0 and 100' };
    }

    const data: SleepData = {
      sleepTime: raw.sleepTime,
      wakeTime: raw.wakeTime,
      totalSleepDuration: Number(raw.totalSleepDuration),
      actualSleepDuration: Number(raw.actualSleepDuration),
      sleepScore: Number(raw.sleepScore),
      sleepScoreDelta: Number(raw.sleepScoreDelta ?? 0),
      deepSleep: Number(raw.deepSleep),
      remSleep: Number(raw.remSleep),
      lightSleep: Number(raw.lightSleep),
      awakeDuration: Number(raw.awakeDuration),
      avgHeartRate: Number(raw.avgHeartRate),
      minHeartRate:
        raw.minHeartRate === undefined || raw.minHeartRate === null
          ? null
          : Number(raw.minHeartRate),
      avgRespiratoryRate: Number(raw.avgRespiratoryRate),
      bloodOxygenAvg: Number(raw.bloodOxygenAvg),
      skinTempRange: raw.skinTempRange ?? '',
      sleepLatencyRating: raw.sleepLatencyRating ?? 'Good',
      restfulnessRating: raw.restfulnessRating ?? 'Good',
      deepSleepRating: raw.deepSleepRating ?? 'Good',
      remSleepRating: raw.remSleepRating ?? 'Good',
      importedAt: Date.now(),
    };

    // Parse optional wake-up events
    const wakeUpEvents: ParsedWakeUpEvent[] = [];
    if (Array.isArray(raw.wakeUpEvents)) {
      for (const ev of raw.wakeUpEvents) {
        if (ev.startTime) {
          wakeUpEvents.push({
            startTime: String(ev.startTime),
            endTime: String(ev.endTime ?? ''),
            cause: String(ev.cause ?? ''),
            notes: String(ev.notes ?? ''),
          });
        }
      }
    }

    return { data, wakeUpEvents, error: null };
  } catch {
    return { data: null, wakeUpEvents: [], error: 'Invalid JSON format' };
  }
}

export function parseGoveeCSV(csvStr: string, nightDate: string): { data: RoomReading[] | null; error: string | null } {
  try {
    const lines = csvStr.trim().split('\n');
    if (lines.length < 2) {
      return { data: null, error: 'CSV file is empty or has no data rows' };
    }

    // Detect delimiter
    const header = lines[0];
    const delimiter = header.includes('\t') ? '\t' : ',';
    const cols = header.split(delimiter).map((c) => c.trim());

    // Find column indices
    const tsIdx = cols.findIndex((c) => c.toLowerCase().includes('timestamp'));
    const tempIdx = cols.findIndex((c) => c.toLowerCase().includes('temperature'));
    const humIdx = cols.findIndex((c) => c.toLowerCase().includes('humidity'));

    if (tsIdx === -1 || tempIdx === -1) {
      return { data: null, error: 'Could not find Timestamp and Temperature columns' };
    }

    const isCelsius = cols[tempIdx].includes('C') || cols[tempIdx].includes('\u2103');

    // Parse overnight window for the night date
    const eveningStart = new Date(`${nightDate}T21:00:00`);
    const morningEnd = new Date(eveningStart);
    morningEnd.setDate(morningEnd.getDate() + 1);
    morningEnd.setHours(7, 0, 0, 0);

    const readings: RoomReading[] = [];

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(delimiter).map((p) => p.trim());
      if (parts.length < Math.max(tsIdx, tempIdx) + 1) continue;

      const timestamp = parts[tsIdx];
      const parsedDate = new Date(timestamp);
      if (isNaN(parsedDate.getTime())) continue;

      if (parsedDate >= eveningStart && parsedDate <= morningEnd) {
        let tempF = parseFloat(parts[tempIdx]);
        if (isNaN(tempF)) continue;

        if (isCelsius) {
          tempF = tempF * 9 / 5 + 32;
        }

        const humidity = humIdx !== -1 ? parseFloat(parts[humIdx]) : 0;

        readings.push({
          timestamp: parsedDate.toISOString(),
          tempF: Math.round(tempF * 10) / 10,
          humidity: isNaN(humidity) ? 0 : Math.round(humidity * 10) / 10,
        });
      }
    }

    return { data: readings, error: null };
  } catch {
    return { data: null, error: 'Failed to parse CSV file' };
  }
}
