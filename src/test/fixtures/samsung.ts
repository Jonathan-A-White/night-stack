/**
 * Hand-written Samsung Health export fixtures shaped like the real
 * export (verified 2026-09-03, Samsung Health 7006003): line 1 of every
 * CSV is Samsung's metadata line, the real header is line 2, and core
 * columns carry the `com.samsung.health.*.` prefix. Stage codes are the
 * real ones (40001 awake, 40002 light, 40003 deep, 40004 REM). The
 * per-session vitals CSVs (respiratory rate, skin temperature, SpO2)
 * share the sleep session's `start_time`.
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
  '2026-09-04 02:53:00.000,2026-09-04 03:56:00.000,40003,uuid-night-1',
  '2026-09-04 03:56:00.000,2026-09-04 06:35:00.000,40002,uuid-night-1',
  '2026-09-04 06:35:00.000,2026-09-04 08:27:00.000,40004,uuid-night-1',
  '2026-09-04 08:27:00.000,2026-09-04 08:44:00.000,40001,uuid-night-1',
  '',
].join('\n');

export const HEART_RATE_CSV = [
  'com.samsung.shealth.tracker.heart_rate,20,1',
  'com.samsung.health.heart_rate.start_time,com.samsung.health.heart_rate.end_time,com.samsung.health.heart_rate.time_offset,com.samsung.health.heart_rate.heart_rate,com.samsung.health.heart_rate.min,com.samsung.health.heart_rate.max,com.samsung.health.heart_rate.binning_data,com.samsung.health.heart_rate.datauuid',
  '2026-09-04 08:00:00.000,2026-09-04 08:10:00.000,UTC-0400,52,44,98,abc.com.samsung.health.heart_rate.binning_data.json,uuid-hr-1',
  '',
].join('\n');

/** Per-minute heart-rate binning JSON referenced from HEART_RATE_CSV. UTC timestamps in epoch ms. */
export const HEART_RATE_BINNING_JSON = JSON.stringify([
  { start_time: Date.UTC(2026, 8, 4, 8, 0, 0), end_time: Date.UTC(2026, 8, 4, 8, 0, 59), heart_rate: 52, heart_rate_min: 50, heart_rate_max: 55 },
  { start_time: Date.UTC(2026, 8, 4, 8, 1, 0), end_time: Date.UTC(2026, 8, 4, 8, 1, 59), heart_rate: 61, heart_rate_min: 58, heart_rate_max: 66 },
  { start_time: Date.UTC(2026, 8, 4, 8, 2, 0), end_time: Date.UTC(2026, 8, 4, 8, 2, 59), heart_rate: 98, heart_rate_min: 90, heart_rate_max: 104 },
]);

export const SPO2_CSV = [
  'com.samsung.shealth.tracker.oxygen_saturation,7,1',
  'com.samsung.health.oxygen_saturation.start_time,com.samsung.health.oxygen_saturation.end_time,com.samsung.health.oxygen_saturation.time_offset,com.samsung.health.oxygen_saturation.spo2,com.samsung.health.oxygen_saturation.spo2_min,com.samsung.health.oxygen_saturation.spo2_max',
  '2026-09-04 08:01:00.000,2026-09-04 08:02:00.000,UTC-0400,96,95,97',
  '2026-09-04 08:05:00.000,2026-09-04 08:06:00.000,UTC-0400,88,87,90',
  '',
].join('\n');

/** Real-shaped SpO2 CSV: one row per sleep session (start = sleep start) with session avg/min/max and a `binning` file. */
export const SPO2_SESSION_CSV = [
  'com.samsung.shealth.tracker.oxygen_saturation,7006003,5',
  'integrated_id,source,tag_id,coverage_rate,com.samsung.health.oxygen_saturation.start_time,com.samsung.health.oxygen_saturation.binning,com.samsung.health.oxygen_saturation.max,com.samsung.health.oxygen_saturation.min,com.samsung.health.oxygen_saturation.spo2,com.samsung.health.oxygen_saturation.time_offset,com.samsung.health.oxygen_saturation.end_time,com.samsung.health.oxygen_saturation.datauuid',
  ',,31301,99,2026-09-04 02:53:00.000,def.com.samsung.health.oxygen_saturation.binning.json,98.0,80.0,95.0,UTC-0400,2026-09-04 08:44:00.000,uuid-spo2-1',
  '',
].join('\n');

/** ~10-minute SpO2 bins referenced from SPO2_SESSION_CSV. */
export const SPO2_BINNING_JSON = JSON.stringify([
  { spo2: 96, spo2_max: 97, spo2_min: 95, start_time: Date.UTC(2026, 8, 4, 3, 0, 0), end_time: Date.UTC(2026, 8, 4, 3, 9, 59), isIrregular: 0 },
  { spo2: 91, spo2_max: 93, spo2_min: 89, start_time: Date.UTC(2026, 8, 4, 3, 10, 0), end_time: Date.UTC(2026, 8, 4, 3, 19, 59), isIrregular: 0 },
]);

export const RESPIRATORY_RATE_CSV = [
  'com.samsung.health.respiratory_rate,7006003,3',
  'create_sh_ver,start_time,custom,binning_data,modify_sh_ver,average,lower_limit,update_time,create_time,client_data_id,upper_limit,client_data_ver,is_outlier,pplib_version,time_offset,deviceuuid,comment,pkg_name,end_time,datauuid',
  '63070071,2026-09-04 02:53:00.000,,rr1.binning_data.json,63070071,15.347384,0.0,2026-09-04 09:31:33.458,2026-09-04 09:31:33.458,,0.0,,0,1.01.04,UTC-0400,dev,,com.sec.android.app.shealth,2026-09-04 08:44:00.000,uuid-rr-1',
  '',
].join('\n');

export const SKIN_TEMPERATURE_CSV = [
  'com.samsung.health.skin_temperature,7006003,3',
  'create_sh_ver,stat_m1,stat_m2,baseline,start_time,binning_data,stat_n,tag_id,modify_sh_ver,lower_bound,update_time,create_time,client_data_id,upper_bound,max,min,client_data_ver,temperature,time_offset,deviceuuid,comment,pkg_name,end_time,datauuid',
  ',34.89466,1218.2881,,2026-09-04 02:53:00.000,st1.binning_data.json,371,31301,,,2026-09-04 09:30:23.778,2026-09-04 09:30:23.778,,,35.90499,32.89848,,34.89466,UTC-0400,dev,,com.sec.android.app.shealth,2026-09-04 08:44:00.000,uuid-st-1',
  '',
].join('\n');

export const UNKNOWN_CSV = [
  'com.samsung.shealth.food_info,3,1',
  'name,calorie',
  'apple,95',
  '',
].join('\n');
