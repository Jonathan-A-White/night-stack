# Open questions — routine exits pack

Gaps exposed while adding pause/resume and "Finish here" to the routine
tracker. Each carries the **default that is currently built**, so the
branch is a working app while answers come in; a different answer is a
follow-up change, not a blocker.

Status legend: `ANSWERED` · `DEFERRED (default applies)` · `PENDING`

---

## Q1. Should the deadline countdown pause too?

**Affects:** `RoutineTracker.tsx` (the "until bed" readout)

**Context.** Pausing stops the step timer and the session total. The
countdown above them — time until tonight's target bedtime, or a fixed
routine deadline — keeps running, because it measures a wall-clock fact
that an interruption doesn't move. The argument the other way is
consistency: two clocks on one screen behaving differently could read as
a bug rather than a distinction, especially at a glance at 11pm.

If it should visibly *look* different rather than behave differently,
the cheap version is dimming the countdown while paused, the same way
the step timer greys out.

**Default:** the deadline countdown keeps running, undimmed.

**Status:** PENDING

---

## Q2. Finish here applies one status to everything still pending — enough?

**Affects:** `finishRemaining` in `routineWipStorage.ts`, the finish sheet

**Context.** The sheet asks once: mark the remaining N steps **Skipped**
or **Punted to morning**. In practice a bail-out is often mixed — two of
the five got done off-app, one is genuinely tomorrow's problem. Today
that's recoverable but clunky: mark them all one way, save, then use the
start screen's long-press to correct individual steps in the saved
session.

Options: (a) one status for all (current); (b) a checklist in the sheet;
(c) one status now, plus a "which of these did you actually do?" pass on
the completion screen.

**Default:** (a). (c) is the most likely follow-up — the completion
screen already lists every step, so it's the natural place to correct
one, and unlike (b) it doesn't put a form between the user and leaving.

**Status:** PENDING

---

## Q3. Should the app ever pause on its own?

**Affects:** `RoutineTracker.tsx`

**Context.** The most common real interruption is walking away without
touching the app, which is exactly the case an explicit Pause button
misses. A `visibilitychange` handler could pause when the app is
backgrounded, or an idle rule could pause a step running far past its
target.

Both guess. Backgrounding is routine mid-step (checking the iPad
password, replying to a text) and would produce constant spurious
pauses; an idle rule would quietly rewrite the number the user is trying
to measure. An automatic pause that guesses wrong is worse than a
missing one, because it silently *shortens* a recorded time — the user
has no way to notice.

**Default:** explicit only. Pause happens when the user taps Pause.

**Status:** DEFERRED (default applies)

---

## Q4. What should happen to a routine left paused overnight?

**Affects:** `loadWip` / `isExpired` in `routineWipStorage.ts`

**Context.** WIP expiry is unchanged: a WIP older than six hours whose
`startedAt` falls on a different evening (per `getEveningLogDate`) is
silently dropped on load. Pausing makes that easier to hit — a routine
paused at 10pm and never resumed is gone by the next evening, with the
completed steps in it.

Options: (a) unchanged (current); (b) never expire a *paused* WIP, on
the grounds that it was deliberately suspended rather than abandoned;
(c) on expiry, save what was done instead of dropping it — effectively
an automatic Finish here.

(c) is tempting now that the machinery exists, but it writes a session
the user never confirmed, dated to an evening they've moved past.

**Default:** (a).

**Status:** PENDING

---

## Q5. Where do punted steps actually go?

**Affects:** `MorningLog.tsx`, `routineAnalytics.ts`

**Context.** Not introduced here, but Finish here makes it much easier
to punt a batch of steps at once, which sharpens it. "Punt to morning"
currently has no morning-side consumer: a punted step increments
`puntedCount` in the step stats on the routine editor page and is
otherwise indistinguishable from skipped. Nothing surfaces "you punted
three things to this morning" anywhere in the morning flow.

**Default:** unchanged — punt is a status, not a queue.

**Status:** PENDING

---

## Q6. Should pause time be visible outside the completion screen?

**Affects:** `RoutineEditorPage.tsx` stats, session history

**Context.** `pausedMs` is recorded on the session and on every step
log, but the only place it's shown is the completion screen ("Excludes
MM:SS paused"). Session history and the per-step stats show totals and
targets with the pause already subtracted and never mention it. That's
right for the averages — the whole point is to keep interruptions out of
them — but it means a night that took 20 minutes of wall clock and 8 of
work looks, in history, exactly like a clean 8-minute night.

**Default:** completion screen only.

**Status:** DEFERRED (default applies)

---

## Q7. Do older sessions need a pause backfill?

**Affects:** `db.ts`

**Context.** `pausedMs` is optional and absent on every session saved
before this change; every read site uses `?? 0`, so they behave as
never-paused, which is true — there was no way to pause. No migration,
no Dexie version bump, and the field is not indexed.

**Default:** no backfill.

**Status:** ANSWERED — nothing to do.

---

## Q8. Should Finish here be reachable before the routine starts?

**Affects:** `RoutineTracker.tsx` (start screen)

**Context.** The button only exists inside a running session. Finishing
a routine you never opened — "I did the whole thing tonight, log it" —
would need a start-screen equivalent that starts and immediately
finishes, producing a session with no real times in it.

That record would be honest about what happened but useless to the
targets and averages, which is the tension: it's a *logging* feature
wearing a tracker's clothes.

**Default:** running sessions only.

**Status:** PENDING
