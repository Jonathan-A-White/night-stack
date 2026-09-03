# Workstream: episode-capture

**Blocked by:** `schema`, `app-shell`. **Runs in parallel with:**
`vitals`, `body-measurements`, `night-tags`. **Blocks:**
`samsung-bulk-import` (trace anchors), `insights-and-rules`,
`clinician-export`.

Decisions: Q6 (auto-create a minimal `NightLog`), Q7 (one tap saves),
Q12 (episode carries its own position). Research: §5 (WakeUpEvent
lifecycle and the overwrite hazard), §6 (date keying, non-unique
`date`), §7 (draft pattern).

## Scope

1. **`/experiments/episode`** — a full-screen, force-dark page. The
   first render shows one giant button "Episode now". Tapping it:
   - resolves the night date with `getEveningLogDate(now)`;
   - in a `db.transaction('rw', db.nightLogs)`: finds the log by date
     or creates one via `createBlankNightLog` + alarm from
     `AlarmSchedule` for that day, with `autoCreated: true`;
   - appends a `WakeUpEvent` `{ id, startTime: HH:MM(now), endTime:
     '', cause: '', fellBackAsleep: 'no', minutesToFallBackAsleep:
     null, notes: '', wasSweating: false, feltCold: false,
     racingHeart: true, positionAtWake: 'unknown', ecgTaken: false,
     ecgVerdict: 'not_taken', rhythmFelt: null, lyingBp: null,
     minutesToSettle: null, wired: false, capturedAt: now, source:
     'episode' }`;
   - writes the draft `{ nightDate, nightLogId, eventId, step: 1 }`;
   - shows "Saved 4:31 AM" and the first optional follow-up.
2. **Follow-ups**, one per screen, each with a ≥ 64 px "Skip" and
   auto-save of the event on every change (a `db.nightLogs.update`
   that replaces only the matching event by id):
   1. Position at wake: Side / Back / Unknown.
   2. ECG on watch: Not taken / Sinus / AFib / Inconclusive (sets
      `ecgTaken` and `ecgVerdict` together).
   3. Rhythm as felt: Fast-regular / Irregular / Unsure.
   4. Lying BP + pulse (optional numeric, cuff at hand): S / D / P.
   5. Wired? Yes / No.
   6. "Done for now" → returns to Experiments home. The
      **settle-time and back-to-sleep** fields are asked in the
      **morning**, not at 4am: `minutesToSettle`, `fellBackAsleep`,
      `endTime`.
3. **Morning reconciliation.** `MorningLog` hydrates episode rows into
   its `wakeUpEvents` state, shows them with an "Episode ⚡" badge and
   the 4am-captured values read-only plus the three morning fields;
   the `hadWakeUps` toggle is forced on when episode rows exist and the
   save path never drops `source: 'episode'` rows (research §5).
4. **Evening merge.** When `EveningLog` finds an `autoCreated` row for
   its date it spreads it (already does) and sets `autoCreated: false`
   on save. `CalendarPage` shows auto-created nights with a
   "partial" marker.
5. **Draft** in `src/pages/experiments/episodeDraftStorage.ts`
   (pattern from `routineWipStorage`): key `episode-draft`, holds
   `{ nightDate, nightLogId, eventId, step, startedAt }`; offered on
   re-entry to `/experiments/episode` and on `ExperimentsHome` as
   "Finish episode details"; cleared when the morning log for that
   night is saved or the user taps Done.
6. **Entry points:** PWA shortcut, `ExperimentsHome` button, and a
   small "Episode" affordance on `TonightPlan` after 10 PM (Tracking
   users shouldn't have to switch apps at 4am).
7. `src/services/episodes.ts` — pure/DB helpers:
   `attachEpisode(now, deps)`, `updateEpisode(nightLogId, eventId,
   patch)`, `episodesForNight(log)`, `hasEpisode(log)`.

## Non-goals

- Reading ECG results from the watch; the verdict is typed.
- Any interpretation ("this looks like AFib").
- Multi-episode UI polish beyond appending a second event if the
  button is tapped again ≥ 10 minutes after the last one (a tap within
  10 minutes re-opens the same event's follow-ups instead).

## Data changes

Uses `WakeUpEvent` episode fields and `NightLog.autoCreated` from
`schema.md`. No further schema changes.

## UI changes

- New page `EpisodeCapture.tsx` under `.force-dark`, `#0f0f1a`
  background, amber accent, 20 px+ type, no header chrome, `screen.
  orientation` untouched. Buttons are full-width, ≥ 64 px tall.
- `MorningLog` wake-up step: episode rows rendered by a new
  `EpisodeWakeCard` (read-only 4am fields, editable morning fields).
- `MorningReview` wake list: badge + captured fields.
- `TonightPlan`: late-night "Episode" button.
- `ExperimentsHome`: button + "Finish episode details" resume card.

## Given / When / Then

```gherkin
Feature: One-tap episode save

  Scenario: Episode with an existing evening log
    Given a NightLog exists for 2026-09-03 with no wake-up events
    And the clock reads 2026-09-04 04:31
    When "Episode now" is tapped
    Then that NightLog has exactly one wakeUpEvent with source 'episode', capturedAt = now, startTime '04:31', racingHeart true
    And autoCreated is still false

  Scenario: Episode with no evening log auto-creates one
    Given no NightLog exists for 2026-09-03
    And the alarm schedule says Thursday alarm 04:43
    When "Episode now" is tapped at 2026-09-04 04:31
    Then a NightLog for 2026-09-03 exists with autoCreated true, alarm.actualAlarmTime '04:43', loggedBedtime null
    And it has one wakeUpEvent with source 'episode'

  Scenario: Double tap does not create two nights or two events
    Given no NightLog for the date
    When attachEpisode runs twice concurrently
    Then exactly one NightLog for the date exists and it has exactly one episode event

  Scenario: A second tap 15 minutes later appends a second episode
    Given an episode captured at 03:10
    When "Episode now" is tapped at 03:25
    Then the night has two episode events
    When "Episode now" is tapped at 03:27
    Then the night still has two episode events and the follow-ups for the 03:25 one reopen

Feature: Follow-ups auto-save

  Scenario: Each follow-up writes immediately
    Given an episode was just saved
    When "Back" is tapped on the position screen
    Then the stored event has positionAtWake 'back' before the next screen renders
    When "AFib" is tapped on the ECG screen
    Then ecgTaken is true and ecgVerdict is 'afib'
    When the lying BP screen is skipped
    Then lyingBp stays null

Feature: Crash safety

  Scenario: App killed after the first tap
    Given an episode was saved and the draft stored with step 1
    When the app is relaunched to /experiments/episode
    Then the page opens on the position follow-up for the same eventId, not on the "Episode now" button

  Scenario: Draft survives evening rollover until the morning log is saved
    Given a draft for night 2026-09-03 created at 04:31
    When the app is opened at 13:00 the same day
    Then the draft is still offered
    When the morning log for 2026-09-03 is saved
    Then the draft is cleared

Feature: Morning reconciliation

  Scenario: Episode rows survive the morning save
    Given a night with one episode event and hadWakeUps rendered off by default
    When the morning log is opened
    Then the wake-up toggle is on and the episode card is shown
    When the user enters minutesToSettle 25, fellBackAsleep 'eventually', endTime '05:10' and saves
    Then the stored event keeps source 'episode', positionAtWake, ecgVerdict, lyingBp, capturedAt
    And has minutesToSettle 25, fellBackAsleep 'eventually', endTime '05:10'

  Scenario: Blank cause on an episode is stamped Unknown on save
    Given an episode event with cause ''
    When the morning log is saved and "Save anyway" is confirmed
    Then the event's cause is the 'Unknown' WakeUpCause id

Feature: Evening merge

  Scenario: Evening log fills an auto-created row
    Given an autoCreated NightLog for tonight with one episode event
    When the evening log is saved
    Then the row keeps the same id and the episode event
    And autoCreated is false
```

## Acceptance criteria

- `src/test/episodes.test.ts` (fake-indexeddb) covers every scenario
  under "One-tap" and "Evening merge"; concurrency scenario uses
  `Promise.all` on two `attachEpisode` calls.
- `src/test/episodeDraftStorage.test.ts` covers "Crash safety".
- `src/test/episodeCapture.test.tsx` (Testing Library) covers: one tap
  persists a record; follow-up tap persists a field. (Q18 required
  test 5.)
- Manual on the phone: from a killed app, shortcut → one tap → record
  visible in the morning log (pack acceptance 3). Noted in PR.
- Force-dark verified with the light theme selected.

## Open questions

- Whether `racingHeart: true` should be the default on an episode row.
  Default yes (the flow exists for adrenergic arousals) with a toggle
  in the morning card.
- Whether to vibrate on save (`navigator.vibrate(50)`) as tactile
  confirmation at 4am with the screen dim. Default yes, guarded by
  feature detection.
