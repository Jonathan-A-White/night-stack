# Workstream: samsung-bulk-import

**Blocked by:** `schema`, `episode-capture`. **Runs in parallel with:**
`insights-and-rules`, `clinician-export`.

> **VERIFIED 2026-09-03** against Jonathan's real export (Samsung
> Health 7006003, ~6 months, 10,660 files / 140 MB). Findings are in
> "What the real export looks like" below; the importer stays **loud
> about what it does not recognize**. The fixtures follow the real
> shape (stage codes, binning file names, per-session vitals CSVs).

## What the real export looks like (verified)

- Layout: ~30 top-level `com.samsung.<health|shealth>.<type>.<ts>.csv`
  plus `jsons/<dataset>/<0-f>/<uuid>.<suffix>.json` — 10,660 files, of
  which the app uses 4–6 CSVs and ~1,200 JSON blobs. Everything else
  (`movement`, `pedometer_*`, `floors_climbed`, `hrv`, `exercise`,
  `*.raw` sensor channels, …) is reported as skipped by dataset.
- Every CSV: line 1 metadata (`com.samsung.shealth.sleep,7006003,11`),
  line 2 header, core columns prefixed `com.samsung.health.<type>.`.
  Times are UTC `YYYY-MM-DD HH:MM:SS.sss`; `time_offset` is `UTC-0400`.
- `com.samsung.shealth.sleep`: one row per session; `sleep_duration`
  (min), `sleep_score`, `efficiency`, `sleep_latency` (ms),
  `total_light_duration`, `total_rem_duration`, `mental_recovery`,
  `physical_recovery`, `sleep_cycle` and ~30 score-factor columns
  (listed as ignored in the report). Naps appear as extra sessions;
  the earliest session per night wins.
- `com.samsung.health.sleep_stage`: `sleep_id` = sleep `datauuid`;
  **stage codes 40001 awake, 40002 light, 40003 deep, 40004 REM**
  (cross-checked: per-session sums reproduce `total_light_duration`,
  `total_rem_duration` and `sleep_duration` exactly).
- `com.samsung.shealth.tracker.heart_rate`: ~12k rows. Rows with
  `tag_id` 21313 reference
  `jsons/com.samsung.shealth.tracker.heart_rate/<x>/<uuid>.com.samsung.health.heart_rate.binning_data.json`
  = `[{heart_rate, heart_rate_min, heart_rate_max, start_time, end_time}]`
  with epoch-ms times, one entry per minute (~54k samples over 6
  months). Rows without a binning file are single spot readings.
- `com.samsung.shealth.tracker.oxygen_saturation`: one row per sleep
  session (`start_time` = sleep start) with `spo2`/`min`/`max` and a
  `binning` file `…oxygen_saturation.binning.json` of ~10-minute bins
  `[{spo2, spo2_min, spo2_max, start_time, end_time}]`.
- `com.samsung.health.respiratory_rate` (`average` breaths/min) and
  `com.samsung.health.skin_temperature` (`min`/`max`/`temperature`
  °C): one row per sleep session, `start_time` = sleep start. These
  fill `avgRespiratoryRate` and `skinTempRange`; `avgHeartRate` /
  `minHeartRate` come from the HR samples inside the session and
  `bloodOxygenAvg` from the SpO2 row.
- Not present yet: blood pressure (Jonathan has not recorded any).
  When it appears it will be listed as skipped until a parser exists.

Performance (the export can only be downloaded as full history):
`planImport` classifies by name first, reads the CSVs, then reads only
the binning files referenced by rows in the selected range. The page
defaults to **last night** and offers 7 / 30 nights / all history
without re-picking the folder. Measured on the real export: last night
reads 14 files (5 MB); all history reads 1,238 files (12 MB) and plans
in well under a second; the per-file report is ~60 lines (JSON blobs
grouped by dataset) instead of 10,660.

Decision: Q17 (in scope). Research: §13.

## Scope

1. `src/services/samsungExport.ts` — pure parsers, one per file kind,
   each `(text: string) => { rows: T[]; report: FileReport }`:
   - `parseSamsungCsv(text)`: skips the metadata line, reads the
     header from line 2, strips the `com.samsung.health.*.` prefixes,
     returns `Record<string,string>[]` plus the unrecognized-column
     list.
   - `parseSleepSessions(text)`: → `{ startUtc, endUtc, offsetMin,
     sleepScore, efficiency, durationMin, datauuid }[]`.
   - `parseSleepStages(text)`: → `{ startUtc, endUtc, stage, sleepId }[]`
     with stage code map (awake/light/deep/rem) marked UNVERIFIED.
   - `parseHeartRateCsv(text)` + `parseHeartRateBinning(json)`: →
     per-minute `{ ts, bpm }`.
   - `parseSpo2Csv(text)` (+ binning if present): → `{ ts, pct }`.
   - `toLocalNightDate(startUtc, offsetMin)`: evening date per the
     app's rule (start before noon local → previous day).
   - `buildSleepData(session, stages)`: a `SleepData` with durations
     from stages, ratings `'Good'` placeholders flagged in `notes`.
2. `src/pages/experiments/SamsungImportPage.tsx` (`/experiments/import`):
   a folder/multi-file picker (`<input type="file" multiple
   webkitdirectory>`), a **per-file report table** (name, recognized
   as, rows, note), a preview of nights to be filled vs skipped
   (existing `sleepData` is never overwritten unless "Replace" is
   ticked per night; `findDuplicateSleepData` guards re-imports), and
   Import.
3. Writes: `vitalSamples` in 1,000-row `bulkPut` chunks (compound key
   makes re-import idempotent), `importBatches` one row per run,
   `nightLogs.sleepData` for nights the user accepted (creating an
   `autoCreated` night via the episode helper when none exists).
4. `VitalTraceChart` (recharts line): HR and SpO2 for a window; used
   by the episode card in `MorningReview` (60 min before `capturedAt`
   to 30 min after) and by the clinician summary (SpO2 nadir + HR peak
   in that window, computed by `traceStats`).

## Non-goals

- Automatic download from Samsung; the user exports from the app and
  moves the folder to the phone/laptop.
- Parsing sleep-score factor columns beyond `sleep_score`.
- Replacing the screenshot-JSON path (still supported).

## Data changes

Uses `vitalSamples`, `importBatches` from `schema.md`.

## UI changes

`SamsungImportPage`, `VitalTraceChart`, episode card in
`MorningReview` gains the trace when samples exist; Experiments home
links to import and shows the last batch date.

## Given / When / Then

```gherkin
Feature: CSV envelope

  Scenario: Metadata line is skipped and prefixes stripped
    Given a file whose line 1 is "com.samsung.shealth.sleep,84,1" and line 2 is the header with com.samsung.health.sleep.start_time
    When parseSamsungCsv runs
    Then rows are keyed by "start_time"
    And the report lists no unrecognized columns for the known set

  Scenario: Unknown columns are reported, not fatal
    Given a header containing "mystery_col"
    Then rows still parse and report.unrecognized includes "mystery_col"

  Scenario: Unknown file is skipped with a note
    Given a file named com.samsung.shealth.food_info.csv
    When the import runs
    Then the report marks it recognized false with note "not used"

Feature: Sleep sessions

  Scenario: UTC start with offset maps to the evening date
    Given start_time "2026-09-04 02:53:00.000" and time_offset "UTC-0400"
    Then toLocalNightDate returns "2026-09-03"

  Scenario: Session after local noon is the same day
    Given start_time "2026-09-03 23:10:00.000" and offset "UTC-0400" (19:10 local)
    Then it returns "2026-09-03"

  Scenario: Stages sum into SleepData
    Given a session with stages deep 63, light 159, rem 112, awake 17 minutes
    Then buildSleepData returns deepSleep 63, lightSleep 159, remSleep 112, awakeDuration 17, actualSleepDuration 334, totalSleepDuration 351

Feature: Per-minute samples

  Scenario: Heart-rate binning json produces one sample per minute
    Given a binning file with 3 entries
    Then parseHeartRateBinning yields 3 samples with kind 'hr'

  Scenario: Re-import is idempotent
    Given 500 samples already stored
    When the same files are imported again
    Then vitalSamples count is still 500 and a second importBatches row exists

  Scenario: Samples are assigned to nights by overnight window
    Given a night 2026-09-03 and a sample at 2026-09-04 04:20 local
    Then the sample's nightLogId is that night's id
    Given a sample at 2026-09-03 15:00 local
    Then nightLogId is null

Feature: Existing data is protected

  Scenario: Night with sleepData is skipped by default
    Given night 2026-09-03 already has sleepData
    When the preview builds
    Then that night is listed as "already has data" and unchecked

  Scenario: Duplicate fingerprint blocks silent overwrite
    Given a parsed session byte-identical to a stored night two days away
    Then the preview flags it as a duplicate

Feature: Trace

  Scenario: Trace window stats
    Given hr and spo2 samples around an episode capturedAt 04:31
    When traceStats(capturedAt, samples) runs
    Then it returns spo2Nadir, spo2NadirAt, hrPeak, hrPeakAt within [capturedAt-60min, capturedAt+30min]
```

## Acceptance criteria

- `src/test/samsungExport.test.ts` with fixtures under
  `src/test/fixtures/samsung/` covering every scenario (Q18 required
  test 4).
- Import of a 6-month fixture (generated, ~260k HR rows) completes in
  under 30 s in the browser on the phone (manual, noted in PR).
- The per-file report is visible before anything is written.
- Lint, typecheck, tests, build green.

## First-real-export checklist (Jonathan)

1. Unzip; list file names — do they match
   `com.samsung.shealth.sleep.*.csv`,
   `com.samsung.shealth.tracker.heart_rate.*.csv`,
   `com.samsung.shealth.tracker.oxygen_saturation.*.csv`,
   `com.samsung.health.sleep_stage.*.csv`?
2. Open the sleep CSV: is line 1 metadata and line 2 the header? Copy
   the header into the PR.
3. Are there `jsons/` folders and do heart-rate rows reference a
   binning file?
4. Run the import; paste the per-file report into the PR. Replace the
   hand-written fixtures with one anonymized night.

## Open questions

- ~~Stage code values and the SpO2 file's exact name.~~ Verified above.
- Whether `sleep_score` exists on older rows; when missing, the
  night's `sleepScore` is 0 and flagged in `morningNotes`.
- Blood-pressure export shape (no readings recorded yet).
- `sleep_latency`, `mental_recovery`, `physical_recovery` are present
  and unused; candidates for the night-metric registry.
