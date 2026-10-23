# Routine exits — spec pack

A running routine had exactly one way out: **discard**. This pack adds
the two exits that were missing — **Pause / Resume**, for an
interruption that shouldn't count against your time, and **Finish
here**, for a routine you finished away from the app and want on the
record rather than in the bin.

Workflow: issue → research → plan → implement → validate, tracked in
HumanLayer. `questions.md` records the gaps found while building; each
carries the default that was applied, so the branch is a working app
while answers come in.

## The problem (research)

Asked plainly: *can I cancel out of a routine — say I finished
independently of it — or pause it?* Reading the tracker as it stood:

| Want | What existed |
|---|---|
| Cancel | Yes, but discard-only. `handleBailout` (the `× Close` button), the resume banner's **Discard**, and the completion screen's **Discard session** all confirm and then drop the WIP. Nothing reaches `routineSessions`. |
| Finish early, keep the credit | No single action. Long-press each remaining step → Skip or Punt until you fall off the end into the completion screen, then Save. The data model was already willing — `handleSave` coerces a leftover `pending` step to `skipped` — but there was no way to *reach* the completion screen without walking every step. |
| Pause | Nothing. Leaving the page is not a substitute: the WIP is persisted on every change, so navigating away with the tab bar keeps it, but the step timer is `Date.now() - startedAt` and the session total is `latestStepEndedAt - startedAt`, both pure wall-clock. A 40-minute interruption lands entirely on the active step and on the session total — and from there into `computeStepTargets` (per-step targets are built from past `durationMs`) and `computeSessionStats` → `computeBufferedTotalMs` → the recommended start time. |

So an interruption silently poisoned the two numbers the app exists to
produce, and the only way to leave a routine early was to throw the
evening's record away.

## What was built (branch `claude/routine-cancel-pause-6kxoqa`)

| Area | Change |
|---|---|
| Pause model | `WipSession.pausedAt` (epoch ms, `null` when running) + `WipSession.pausedMs` and `WipStep.pausedMs` (settled accumulators). Pure helpers in `routineWipStorage.ts`: `pauseWip` / `resumeWip` (`:125`, `:137`), `inFlightPauseMs` / `totalPausedMs` / `isPaused` (`:106`, `:117`), `stepElapsedMs` / `sessionElapsedMs` (`:153`, `:164`). Elapsed = wall clock − settled pause − any pause still in flight, so the display freezes the moment you pause. |
| Tracker UI | **Pause** beside **Finish here** under the primary button; while paused the timer greys out (`.routine-timer-display.paused`), its label reads `paused`, and **Done** is replaced by **Resume** (`RoutineTracker.tsx:1223`, `:1300`, `:1317`). The deadline countdown above it keeps running. |
| Finish here | A sheet asking how to mark the remaining N steps — **Skipped** or **Punted to morning** ("Punted (do later)" off the evening routine) — then straight to the completion screen, notes and **Save session** (`RoutineTracker.tsx:697`, `:1406`). `finishRemaining` (`routineWipStorage.ts:187`) does the marking. |
| Persistence | `pausedMs?: number \| null` on `RoutineSession` and on each `RoutineStepLog` (`types.ts:665`, `:685`). Both optional and non-indexed, so **no Dexie version bump**: an older session simply reads as never-paused. `handleSave` writes the session total as `endedAt − startedAt − pausedMs`. |
| Recompute parity | The tracker's all-time-best comparison deliberately recomputes from `endedAt − startedAt` rather than trusting `totalDurationMs` (older sessions stored a sum of steps). It now subtracts `pausedMs ?? 0` too, so old and new sessions are compared on one scale. |
| Sub-session inheritance | `computeTodaySessionPausedMs` (`routineAnalytics.ts:71`) mirrors `computeTodaySessionStartedAt`: a follow-up routine the same evening seeds its `pausedMs` from tonight's saved sessions. Without it, re-saving tonight as one merged record would put the earlier pauses back into the total. |
| Start card | The in-progress timer subtracts pause and freezes with the tracker, and reads *routine paused* / **Resume routine** instead of racing ahead of the screen it links to. |
| Migration | `normalizeWip` (`routineWipStorage.ts:80`) fills the new fields on load, so a routine that was mid-flight across the app update keeps running instead of rendering `NaN`. |

## Design decisions

- **The deadline does not pause.** Bedtime is a wall-clock fact; only
  the routine's own clocks stop. The "time until bed" countdown keeps
  ticking above the frozen step timer. (Q1.)
- **Finish here stamps `endedAt` on the active step only.** Steps that
  never started stay unstamped, so `computeLatestStepEndedAt` keeps the
  session's effective end at the last thing actually tracked. Stamping
  them all with `now` would stretch the saved total across however long
  the user was away finishing up on their own — exactly the pollution
  pausing exists to prevent.
- **Two accumulators, one source of truth.** `WipSession.pausedMs` is
  what the session total subtracts; `WipStep.pausedMs` keeps each step's
  own clock honest and is written to the log as a record (a step's
  `durationMs` already excludes it). They are never summed together.
- **Acting on a paused routine resumes it.** `handleDone`, skip, punt,
  restart and save all call `resumeWip` first, so the pause is banked
  rather than dangling. `resumeWip` returns the same reference when the
  routine is already running, so those call sites pay nothing.
- **A pause survives a kill.** `pausedAt` is persisted, so a routine
  paused when the app is force-stopped comes back paused and the pause
  keeps accruing. That is the honest reading — the user has not resumed.
- **Deleting the active step mid-pause re-anchors the pause.** Editing a
  variant in Settings can retire the running step; reconcile starts the
  next pending one at `now`. The in-flight pause belonged to the step
  that just went away, so it is banked on the session and restarted
  against the new step (`routineWipStorage.ts:451`), which keeps the
  session total right and starts the new step's clock at zero.
- **Discard is untouched.** `× Close` still means "throw this away".
  Finish here is the additive answer, not a replacement.

## Tests

| File | Covers |
|---|---|
| `routineWipStorage.test.ts` | 23 new cases: pause/resume accumulation across several pauses; no-ops (double pause, pause on the completion screen, resume while running returning the same reference); the step timer freezing and the session elapsed freezing; non-active steps ignoring an in-flight pause; `finishRemaining` marking, stamping, stashing and settling; loading a pre-pause WIP; round-tripping pause state through storage; reconcile re-anchoring a pause when the active step is deleted, and leaving it alone when it isn't. |
| `routineTracker.test.tsx` | New. Drives the real tracker on a seeded database with a faked clock: pause for 60 s across an 8 s step and assert the display freezes, the recorded `durationMs` is 8 s and the saved session carries `pausedMs: 60000`; finish-here-and-punt writing a session with the right per-step stamps; finish-here-immediately saving an all-skipped session instead of discarding. |
| `routineAnalytics.test.ts` | `computeTodaySessionPausedMs`: sums tonight's sub-sessions, ignores other days, treats a pre-pause session as never paused. |

Validated with `npx tsc -b`, `npm test` (551 passing, 36 files), `npm
run lint` (37 warnings, 0 errors — identical to the pre-change baseline)
and `npm run build`.

## Not in scope here

- Surfacing pause time anywhere but the completion screen ("Excludes
  MM:SS paused") — history and the step stats don't show it (Q6).
- Auto-pausing on backgrounding, or any pause the user didn't ask for (Q3).
- A resting place for punted steps: "Punt to morning" still only
  increments a counter in the step stats (Q5).
- Per-step choice when finishing — the sheet applies one status to
  everything still pending (Q2).
- Changing WIP expiry, so a routine paused overnight is still dropped by
  the existing evening-boundary rule (Q4).
