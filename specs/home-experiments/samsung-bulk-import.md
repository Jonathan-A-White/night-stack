# Workstream: samsung-bulk-import

**Blocked by:** `schema`, `episode-capture`. **Runs in parallel with:**
`insights-and-rules`, `clinician-export`.

> **UNVERIFIED FORMAT.** Q21: Jonathan has not yet inspected his
> Samsung Health export. Everything about file and column names below
> comes from public descriptions of the export (research §13) and must
> be checked against the first real export. The importer is built to
> be **loud about what it does not recognize**, and the fixtures are
> hand-written to the documented shape. First-real-export checklist at
> the end.

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

- Stage code values (40000–40003) and the SpO2 file's exact name.
- Whether `sleep_score` exists on older rows; when missing, the
  night's `sleepScore` is 0 and flagged in `morningNotes`.
