import type { SleepData, SleepRating, RoomReading } from '../types';

const VALID_RATINGS: SleepRating[] = ['Excellent', 'Good', 'Fair', 'Attention'];

export interface ParsedWakeUpEvent {
  startTime: string;
  endTime: string;
  cause: string; // label text from JSON (matched to WakeUpCause ID in component)
  notes: string;
}

export interface SamsungHealthParseResult {
  data: SleepData | null;
  wakeUpEvents: ParsedWakeUpEvent[];
  error: string | null;
  /**
   * The date the parser believes the sleep session belongs to, in local
   * "YYYY-MM-DD" form (the evening the user went to bed). Null when the JSON
   * carries no date-bearing fields (only HH:MM times), in which case the
   * caller can't verify the session lines up with the intended night log.
   * Used by the save handler to warn on date mismatches.
   */
  sessionDate: string | null;
}

/**
 * Normalize a string that encodes a date into a local "YYYY-MM-DD". Returns
 * null if we can't extract a date. Accepts full ISO strings, date-only
 * strings, or "YYYY-MM-DD HH:MM[:SS]" forms.
 */
function extractLocalDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  // Fast path: already "YYYY-MM-DD..."
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // Fall back to Date parsing for other ISO-like forms.
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const mo = (d.getMonth() + 1).toString().padStart(2, '0');
  const da = d.getDate().toString().padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/**
 * Pull a "belongs-to-this-evening" date out of a Samsung Health sleep record.
 * Samsung exports vary: some carry a full `sleepStartTime` / `startTime`
 * timestamp, some carry only the HH:MM `sleepTime`. When we have a full
 * start timestamp we shift early-morning starts (before noon) back to the
 * prior day so the returned date matches how `NightLog.date` is stored (the
 * evening you went to bed).
 */
function deriveSessionDate(raw: Record<string, unknown>): string | null {
  const startCandidates = [
    raw.sleepStartTime,
    raw.startTime,
    raw.sleepStart,
    raw.bedtime,
    raw.date,
    raw.sleepDate,
    raw.sessionDate,
  ];
  for (const candidate of startCandidates) {
    if (typeof candidate !== 'string' || !candidate) continue;
    const d = new Date(candidate);
    if (!isNaN(d.getTime()) && candidate.includes('T')) {
      // Time-carrying timestamp: start-before-noon → previous evening.
      const target = new Date(d);
      if (d.getHours() < 12) target.setDate(target.getDate() - 1);
      const y = target.getFullYear();
      const mo = (target.getMonth() + 1).toString().padStart(2, '0');
      const da = target.getDate().toString().padStart(2, '0');
      return `${y}-${mo}-${da}`;
    }
    const localDate = extractLocalDate(candidate);
    if (localDate) return localDate;
  }
  return null;
}

function parseSingleSession(raw: Record<string, unknown>): SamsungHealthParseResult {
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
    return {
      data: null,
      wakeUpEvents: [],
      error: `Missing required fields: ${missing.join(', ')}`,
      sessionDate: null,
    };
  }

  // Validate ratings
  for (const field of ['sleepLatencyRating', 'restfulnessRating', 'deepSleepRating', 'remSleepRating'] as const) {
    if (raw[field] && !VALID_RATINGS.includes(raw[field] as SleepRating)) {
      return {
        data: null,
        wakeUpEvents: [],
        error: `Invalid rating for ${field}: ${raw[field]}. Must be one of: ${VALID_RATINGS.join(', ')}`,
        sessionDate: null,
      };
    }
  }

  // Validate numeric ranges
  const rawScore = Number(raw.sleepScore);
  if (rawScore < 0 || rawScore > 100) {
    return {
      data: null,
      wakeUpEvents: [],
      error: 'Sleep score must be between 0 and 100',
      sessionDate: null,
    };
  }

  const data: SleepData = {
    sleepTime: raw.sleepTime as string,
    wakeTime: raw.wakeTime as string,
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
    skinTempRange: (raw.skinTempRange as string) ?? '',
    sleepLatencyRating: (raw.sleepLatencyRating as SleepRating) ?? 'Good',
    restfulnessRating: (raw.restfulnessRating as SleepRating) ?? 'Good',
    deepSleepRating: (raw.deepSleepRating as SleepRating) ?? 'Good',
    remSleepRating: (raw.remSleepRating as SleepRating) ?? 'Good',
    importedAt: Date.now(),
  };

  // Parse optional wake-up events
  const wakeUpEvents: ParsedWakeUpEvent[] = [];
  if (Array.isArray(raw.wakeUpEvents)) {
    for (const ev of raw.wakeUpEvents as Record<string, unknown>[]) {
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

  return {
    data,
    wakeUpEvents,
    error: null,
    sessionDate: deriveSessionDate(raw),
  };
}

/**
 * Parse a Samsung Health sleep export into a SleepData record.
 *
 * The historical shape is a single-session JSON object; we also accept an
 * object with a top-level `sessions` array (newer exports) and a bare array.
 * When `targetDate` is supplied, multi-session inputs are filtered down to
 * the session whose sleep window belongs to that evening, so a user
 * re-importing a file on the morning of 4/17 while viewing the 4/15 morning
 * log no longer silently picks up the 4/16 session. (bugfixes T1 guard.)
 *
 * `targetDate` is the `NightLog.date` — the evening the user went to bed.
 * It's optional for backwards compat with the single-session callers.
 */
export function parseSamsungHealthJSON(
  jsonStr: string,
  targetDate?: string,
): SamsungHealthParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonStr);
  } catch {
    return { data: null, wakeUpEvents: [], error: 'Invalid JSON format', sessionDate: null };
  }

  // Normalize input shape into a list of candidate sessions.
  let sessions: Record<string, unknown>[];
  if (Array.isArray(raw)) {
    sessions = raw as Record<string, unknown>[];
  } else if (
    raw &&
    typeof raw === 'object' &&
    Array.isArray((raw as { sessions?: unknown }).sessions)
  ) {
    sessions = (raw as { sessions: unknown[] }).sessions as Record<string, unknown>[];
  } else if (raw && typeof raw === 'object') {
    sessions = [raw as Record<string, unknown>];
  } else {
    return { data: null, wakeUpEvents: [], error: 'Invalid JSON format', sessionDate: null };
  }

  if (sessions.length === 0) {
    return { data: null, wakeUpEvents: [], error: 'No sleep sessions in JSON', sessionDate: null };
  }

  if (sessions.length === 1) {
    return parseSingleSession(sessions[0]);
  }

  // Multi-session input: filter by targetDate if we can. Without a target,
  // or if no session carries a date we can check, refuse to guess — the
  // caller has to pick explicitly rather than silently writing the wrong
  // night's data. This is the T1 root-cause guard-rail for Hypothesis B
  // ("parser always returns most recent session").
  if (!targetDate) {
    return {
      data: null,
      wakeUpEvents: [],
      error:
        'Multiple sleep sessions in JSON but no target date to match against. ' +
        'Re-import with a specific night log open.',
      sessionDate: null,
    };
  }

  const matched: Record<string, unknown>[] = [];
  let anyDated = false;
  for (const s of sessions) {
    const sd = deriveSessionDate(s);
    if (sd !== null) anyDated = true;
    if (sd === targetDate) matched.push(s);
  }

  if (!anyDated) {
    return {
      data: null,
      wakeUpEvents: [],
      error:
        'Multiple sleep sessions in JSON but none carry a date we can match. ' +
        'Enter manually or re-export with dated timestamps.',
      sessionDate: null,
    };
  }

  if (matched.length === 0) {
    return {
      data: null,
      wakeUpEvents: [],
      error: `No sleep session found matching ${targetDate}. Check you're on the right morning log.`,
      sessionDate: null,
    };
  }

  // If more than one session matches (same night double-logged), take the
  // one with the highest sleepScore as a tiebreaker.
  matched.sort((a, b) => Number(b.sleepScore ?? 0) - Number(a.sleepScore ?? 0));
  return parseSingleSession(matched[0]);
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

    // Parse overnight window for the night date. `NightLog.date` is the
    // evening the user went to bed, so the window runs from 21:00 local on
    // `nightDate` through 07:00 local the next morning. Both bounds are
    // built as local Date objects (no `Z` suffix) and compared numerically
    // against each row's `new Date(timestamp)`. For a bare
    // "YYYY-MM-DD HH:MM" row, `new Date` interprets it as local time and
    // everything lines up. For a Z-suffixed row the Date is parsed as UTC
    // and then compared as absolute milliseconds against the local-zone
    // window — consistent, though possibly off by an hour near DST
    // boundaries. (bugfixes T3 comment.)
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
