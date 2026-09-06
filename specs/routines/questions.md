# Open questions — routines pack

Gaps exposed while generalizing the evening routine into multiple
routines, adding the vault and seeding the sound booth SOP. Each has the
**default that is currently built** so the branch works while answers
come in; a different answer is a follow-up change, not a blocker.

Status legend: `ANSWERED` · `DEFERRED (default applies)` · `PENDING`

---

## Q1. Sound booth: is 9:45 the deadline, or an earlier "ready for practice" time?

**Affects:** `routineSeeds.ts`

**Context.** The SOP's only hard time is "At 9:45 the board MUST be fully
muted except the mp3" — but that is the *last* step. The setup work
(lights, mics, scenes, music) needs to be done before practice starts,
which the SOP doesn't time-stamp. The start card counts back from the
deadline using the average total duration, so if practice starts at,
say, 9:00, the countdown should target 9:00 and the 9:45 step is a
reminder inside the routine.

**Default:** deadline `09:45` on Sundays; the whole routine, including
the final mute, counts toward the average.

**Status:** PENDING

---

## Q2. Which days, and what about special services?

**Affects:** `routineSeeds.ts`, `routineSchedule.ts`

**Context.** The schedule is Sunday-only. Christmas Eve, Good Friday or a
Saturday wedding would show "next Sunday" on the card. "Start routine
now" is always available regardless of the countdown, so nothing is
blocked, but the notification and countdown would be wrong.

Options: (a) Sunday only (current); (b) every day with a 9:45 deadline;
(c) add a one-off "next run at" override on the card.

**Default:** (a).

**Status:** PENDING

---

## Q3. One vault for the whole app, or per routine?

**Affects:** `vault.ts`, `SecretReveal.tsx`, `RoutineEditorPage.tsx`

**Context.** Secrets are keyed by name in one vault and referenced by
name from any step of any routine. Simple, and the same iPad password can
be shared by two routines. A per-routine vault would let a future
"share this routine" feature carry its secrets along.

**Default:** one vault, global names.

**Status:** DEFERRED (default applies)

---

## Q4. Fingerprint: which browser is the PWA installed from, and is a PIN fallback acceptable?

**Affects:** `webauthnPrf.ts`, `VaultSettingsPage.tsx`

**Context.** Biometric unlock uses the WebAuthn **PRF extension** on a
platform passkey. That works in Chrome on Android (Google Password
Manager passkeys, Chrome 116+) and recent Safari; Samsung Internet and
older WebViews may create the passkey but return no PRF output, in which
case the page reports "unsupported" and the vault stays PIN-only. The
PIN is always required at setup and remains a fallback. There is no
"fingerprint only" mode: without a PIN there would be no way to recover
if the passkey is deleted.

Sub-questions: should the vault also lock when the app goes to the
background (currently: time-based auto-lock only, default 5 min)? Should
a revealed password auto-hide sooner than 60 s?

**Default:** PIN required, PRF optional, 5-minute auto-lock, 60-second
reveal.

**Status:** PENDING

---

## Q5. Should the vault be included in backups?

**Affects:** `backup.ts`

**Context.** The vault (wrapped key + ciphertext) is deliberately
excluded from every export, including "Full Export (AI-ready)", so
pasting an export into a chat never carries the passwords even in
encrypted form. The cost: a phone wipe or a move to the future
standalone app loses the stored passwords and they must be re-typed.
An "Export vault (encrypted, needs PIN to restore)" button is a small
addition if wanted.

**Default:** never exported.

**Status:** PENDING

---

## Q6. Copy-to-clipboard on reveal?

**Affects:** `SecretReveal.tsx`

**Context.** The passwords are typed into *another* device (the iPads),
so clipboard copy on the phone doesn't help and would leave the value in
the clipboard history. The reveal shows the value large and monospace.

**Default:** display only, no clipboard.

**Status:** DEFERRED (default applies)

---

## Q7. Sound booth wording: keep the SOP's labels verbatim?

**Affects:** `routineSeeds.ts`

**Context.** The Lutron slider list is seeded as written ("Alter track
recess", "Rear alter recess", "Unknown 4/5") on the assumption that
those are the labels shown in the app; obvious typos ("hangimng",
"2cd") were fixed. The mic steps mention Ewan by name. Everything is
editable in Settings → Routines, so this is only about the seed.

**Default:** verbatim labels, typos fixed.

**Status:** PENDING

---

## Q8. Sound booth variants: singer count?

**Affects:** `routineSeeds.ts`

**Context.** "Depending on how many singers there are, take Vocal 1 and
Vocal 2 also." The seed has one "Full" variant; the mic step's
instructions carry the conditional. Variants "One singer" / "Two
singers" would only differ in instructions, not steps, so they don't
buy much — unless placing each extra mic should be its own timed step.

**Default:** single "Full" variant.

**Status:** DEFERRED (default applies)

---

## Q9. Notifications for a Sunday 7:30 AM start — is "only while the app is open" acceptable?

**Affects:** `routineNotifications.ts`

**Context.** Start-time reminders are a `setTimeout` armed when a start
card is on screen; the app must be open (or at least not killed) for
the notification to fire, and nothing is armed more than 24 h ahead.
For the evening routine that is usually fine because the app is open in
the evening; for a Sunday morning start it means opening the app
Saturday night or relying on a separate alarm. Real background delivery
needs a service worker with Periodic Background Sync or push, which is
a different project. This pack fixed one concrete bug: the scheduler
now keeps one timer **per routine**, so several cards on the home page
no longer overwrite each other's reminder.

**Default:** in-app timers only, one per routine.

**Status:** PENDING

---

## Q10. Same routine twice in one day?

**Affects:** `RoutineTracker.tsx`, `RoutineStartCard.tsx`

**Context.** Sessions are one-per-calendar-day per routine: a second run
the same day merges into the first (steps already done are pre-marked,
the start time is inherited). That was designed for "I forgot a step
and came back". A church with two services, or a routine like "pack the
car" run morning and evening, would want separate sessions and separate
averages.

**Default:** one merged session per day (unchanged behavior).

**Status:** PENDING

---

## Q11. What should the Routine app's "Tracker" tab open?

**Affects:** `apps.tsx`

**Context.** The tab bar's Tracker tab still opens the evening tracker.
With several routines the more useful target is "the routine that is in
progress, else the one whose deadline is next". The Start tab lists
every routine, so nothing is unreachable.

**Default:** evening tracker (unchanged).

**Status:** PENDING

---

## Q12. Standalone app: when, and what happens to the bedtime anchor?

**Affects:** everything under "Extraction notes" in `README.md`

**Context.** The routine module's only real dependency on NightStack is
the `bedtime` schedule anchor, which reads the alarm schedule. In a
standalone app that anchor either goes away (the evening routine becomes
a `time` routine with a user-set deadline) or the standalone app grows a
"bedtime" setting. Also: should routine data move to its own Dexie
database name now, so the split is a copy of one IndexedDB rather than
a table extraction?

**Default:** stays inside NightStack; same database; `targetBedtimeHHMM`
passed down as a prop so the anchor can be removed without touching the
tracker.

**Status:** PENDING

---

## Q13. Deleting a routine deletes its history?

**Affects:** `RoutinesSettingsPage.tsx`

**Context.** Delete removes the routine, its steps, variants **and
sessions** after a confirm that states the session count. The evening
routine cannot be deleted (hide it instead). An "archive" that keeps
history but hides the routine is what the `isActive` toggle already
does.

**Default:** hard delete with confirm; hide via `isActive`.

**Status:** DEFERRED (default applies)

---

## Q14. Richer step instructions: markdown, or sub-steps that can be checked off?

**Affects:** `RoutineTracker.tsx`, `RoutineStep`

**Context.** Instructions are plain text with newlines preserved. The
Lutron step is 28 sliders in one step; a sub-checklist (each line its
own checkbox, not timed) would make it easier to keep your place, and
markdown would allow bold for the "MUST" at 9:45. Both are UI-only
changes on top of `description`.

**Default:** plain text.

**Status:** PENDING

---

## Q15. Grace after a missed deadline: 3 hours, then next occurrence?

**Affects:** `routineSchedule.ts`

**Context.** After 9:45 passes on Sunday the card shows "past
recommended start" until 12:45, then flips to next Sunday. For the
evening routine the old behavior (bedtime rolls to tomorrow after noon)
is unchanged.

**Default:** 3 h grace.

**Status:** DEFERRED (default applies)

---

## Q16. Routine import: replace all, or merge?

**Affects:** `backup.ts`, `DataManagementPage.tsx`

**Context.** Import Routines replaces every routine (it always did; there
was only one). Adding a routine from a file now means exporting first
and appending. A "merge by id" import would keep unknown routines and
replace matching ones.

**Default:** replace all, with the confirm stating the routine count.

**Status:** PENDING

---

## Q17. Where should a shared password live when the routine is shared with someone else?

**Affects:** future sharing

**Context.** Steps reference secrets by name precisely so a routine file
can be shared without the values; the receiver types the values once.
If routines are ever shared between phones (the standalone app), that
is the intended model — confirm it is acceptable that each phone holds
its own copy of the passwords.

**Default:** per-device vault, references by name.

**Status:** DEFERRED (default applies)
