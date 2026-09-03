/**
 * Hand-written Samsung Health export fixtures following the publicly
 * documented layout (see specs/home-experiments/research.md §13).
 * UNVERIFIED against a real export (Q21) — replace with one anonymized
 * night once Jonathan has his export. Line 1 of every CSV is Samsung's
 * metadata line; the real header is line 2; core columns carry the
 * `com.samsung.health.*.` prefix.
 */

export const SLEEP_CSV = [
  'com.samsung.shealth.sleep,84,1',
  'com.samsung.health.sleep.start_time,com.samsung.health.sleep.end_time,com.samsung.health.sleep.time_offset,sleep_score,efficiency,sleep_duration,mental_recovery,physical_recovery,sleep_cycle,com.samsung.health.sleep.datauuid,mystery_col',
  // Night of 2026-09-03 (local 22:53 → 04:44), stored in UTC with a -4h offset.
  '2026-09-04 02:53:00.000,2026-09-04 08:44:00.000,UTC-0400,79,93,351,60,70,4,uuid-night-1,x',
  // Night of 2026-09-04.
  '2026-09-05 03:10:00.000,2026-09-05 08:40:00.000,UTC-0400,82,95,330,65,72,4,uuid-night-2,y',
  '',
].join('\n');

export const SLEEP_STAGE_CSV = [
  'com.samsung.health.sleep_stage,12,1',
  'com.samsung.health.sleep_stage.start_time,com.samsung.health.sleep_stage.end_time,com.samsung.health.sleep_stage.stage,com.samsung.health.sleep_stage.sleep_id',
  // night 1: deep 63, light 159, rem 112, awake 17 (minutes)
  '2026-09-04 02:53:00.000,2026-09-04 03:56:00.000,40002,uuid-night-1',
  '2026-09-04 03:56:00.000,2026-09-04 06:35:00.000,40001,uuid-night-1',
  '2026-09-04 06:35:00.000,2026-09-04 08:27:00.000,40003,uuid-night-1',
  '2026-09-04 08:27:00.000,2026-09-04 08:44:00.000,40000,uuid-night-1',
  '',
].join('\n');

export const HEART_RATE_CSV = [
  'com.samsung.shealth.tracker.heart_rate,20,1',
  'com.samsung.health.heart_rate.start_time,com.samsung.health.heart_rate.end_time,com.samsung.health.heart_rate.time_offset,com.samsung.health.heart_rate.heart_rate,com.samsung.health.heart_rate.min,com.samsung.health.heart_rate.max,com.samsung.health.heart_rate.binning_data,com.samsung.health.heart_rate.datauuid',
  '2026-09-04 08:00:00.000,2026-09-04 08:10:00.000,UTC-0400,52,44,98,jsons/com.samsung.shealth.tracker.heart_rate/abc.binning_data.json,uuid-hr-1',
  '',
].join('\n');

/** Per-minute heart-rate binning JSON referenced from HEART_RATE_CSV. UTC timestamps in epoch ms. */
export const HEART_RATE_BINNING_JSON = JSON.stringify([
  { start_time: Date.UTC(2026, 8, 4, 8, 0, 0), end_time: Date.UTC(2026, 8, 4, 8, 1, 0), heart_rate: 52, heart_rate_min: 50, heart_rate_max: 55 },
  { start_time: Date.UTC(2026, 8, 4, 8, 1, 0), end_time: Date.UTC(2026, 8, 4, 8, 2, 0), heart_rate: 61, heart_rate_min: 58, heart_rate_max: 66 },
  { start_time: Date.UTC(2026, 8, 4, 8, 2, 0), end_time: Date.UTC(2026, 8, 4, 8, 3, 0), heart_rate: 98, heart_rate_min: 90, heart_rate_max: 104 },
]);

export const SPO2_CSV = [
  'com.samsung.shealth.tracker.oxygen_saturation,7,1',
  'com.samsung.health.oxygen_saturation.start_time,com.samsung.health.oxygen_saturation.end_time,com.samsung.health.oxygen_saturation.time_offset,com.samsung.health.oxygen_saturation.spo2,com.samsung.health.oxygen_saturation.spo2_min,com.samsung.health.oxygen_saturation.spo2_max',
  '2026-09-04 08:01:00.000,2026-09-04 08:02:00.000,UTC-0400,96,95,97',
  '2026-09-04 08:05:00.000,2026-09-04 08:06:00.000,UTC-0400,88,87,90',
  '',
].join('\n');

export const UNKNOWN_CSV = [
  'com.samsung.shealth.food_info,3,1',
  'name,calorie',
  'apple,95',
  '',
].join('\n');
