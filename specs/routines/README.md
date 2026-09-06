# Routines — spec pack

The Routine app used to be one thing: the evening wind-down, timed back
from tonight's target bedtime. This pack generalizes it to **any number
of routines**, each with its own steps, variants, history and start-by
countdown, adds an **encrypted password vault** so a step can show an
iPad unlock code behind a PIN or fingerprint, and seeds the **Brookfield
First sound booth SOP** as the second routine.

Jonathan's stated direction: the routines feature will eventually move
into its own general-purpose app. Everything here is built so that split
is a file move, not a rewrite — see "Extraction notes" below and
`questions.md` Q12.

Workflow: issue → research → plan → implement → validate, tracked in
HumanLayer. `questions.md` records the gaps found while building; each
carries the default that was applied so the branch is a working app
while answers come in.

## What was built (branch `claude/routines-generalization-password-p4khz2`)

| Area | Change |
|---|---|
| Schema (Dexie **v13**) | New `routines` table; `routineId` on `routineSteps`, `routineVariants`, `routineSessions` (indexed, plus `[routineId+date]`); `secretNames: string[]` on steps; new `secrets` (pk `name`) and `vaultConfig` tables. Upgrade stamps every existing row with the evening routine (`id: "evening"`) and seeds the sound booth once, deduped by name. |
| Schedule model | `Routine.schedule`: `bedtime` (the old behavior), `time` (fixed HH:MM on given weekdays, 3 h grace after the deadline), `none`. `services/routineSchedule.ts` resolves the concrete deadline; `computeRecommendedStartFromDeadline` in `routineAnalytics.ts` replaces the HH:MM-only path (the old function is kept as a wrapper). |
| Routine home | One start card per active routine; cards show the next deadline ("Sunday 9:45 AM") and count down in days when it is far off. Links to manage routines and the vault. |
| Tracker | `/tonight/routine` stays the evening tracker; `/routine/:id/track` for the rest. Per-routine WIP key (`routine-session-wip:<id>`, legacy key migrated). Shows the step's **instructions** (pre-wrap) and a **Show password** button per referenced secret under the timer. Labels generalize ("until deadline", "Punt (do later)"). |
| Settings | `/settings/routines` (list, add, reorder, hide, delete), `/settings/routines/:id` (name, description, schedule editor, steps with instructions + password refs, variants, stats), `/settings/vault`. `/settings/evening-routine` redirects to the evening editor. |
| Vault | `services/vault.ts`: AES-GCM secrets under a random DEK; DEK wrapped by PBKDF2(PIN) and optionally by HKDF(WebAuthn PRF). In-memory unlock with auto-lock (default 5 min). `services/webauthnPrf.ts`: platform-passkey enrollment and assertion, fully feature-detected. Never exported. |
| Import / export | Routine files are **version 2** (`routines` array, `routineId` on rows). v1 files and pre-v13 full backups import as the evening routine. `docs/routine-import-guide.md` rewritten. |
| Seed | `services/routineSeeds.ts`: the evening routine and the sound booth SOP (13 steps, Sunday 9:45 deadline, two password references, no password values). |

## Tests

| File | Covers |
|---|---|
| `schemaV13.test.ts` | Real v12 → v13 upgrade on fake-indexeddb: stamping, indexes, sound booth seeded once, fresh install. |
| `vault.test.ts` | Envelope: create / unlock / wrong PIN / change PIN / PRF enroll + unlock + remove / AAD binding / cross-vault isolation / session cache. |
| `routineSchedule.test.ts` | Deadline resolution for every anchor, grace window, weekday rollover, labels, parity with the old bedtime path. |
| `routineImport.test.ts` | v1 and v2 normalization, round trip, full backup excludes the vault and leaves it untouched on import. |
| `routineWipStorage.test.ts` | Updated for per-routine keys. |
| `appRoutes.test.tsx` | Mounts the new routes on a seeded database. |

Validated with `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run
build`. Two pre-existing failures in `episodeDraftStorage.test.ts` are
unrelated (a hard-coded 2026-09-03 draft that has aged past the 48 h
expiry); they need a relative date, not a code change.

## Extraction notes (for the future standalone app)

Files that would move as-is: `services/{routineAnalytics, routineSchedule,
routineSeeds, routinePaths, routineNotifications, vault, webauthnPrf}.ts`,
`pages/tonight/{RoutineTracker, RoutineStartCard, routineWipStorage}.ts*`,
`pages/routine/RoutineHome.tsx`, `pages/settings/{RoutinesSettingsPage,
RoutineEditorPage, VaultSettingsPage}.tsx`, `components/SecretReveal.tsx`,
the routine/vault types, and the `.routine-*` / `.secret-*` CSS.

Dependencies on the rest of NightStack, all small:

- The **bedtime anchor** reads the alarm schedule / tonight's log to get
  a target bedtime. `RoutineStartCard` and the tracker take it as a
  `targetBedtimeHHMM` prop, so the standalone app can pass `null` (or a
  user-set time) and drop the anchor.
- `utils.ts`: `getTodayDate`, `getEveningLogDate` (WIP expiry),
  `formatTime12h`, `DAY_NAMES`.
- `db.ts` owns the tables and the v13 upgrade; a standalone app would
  start at version 1 with the same store definitions.
- `apps.tsx` route prefixes and the Tonight tab's card.

## Not in scope here

- Markdown or sub-checklists inside step instructions (Q14).
- Per-routine vaults, vault export/sync (Q3, Q5).
- Service-worker notifications; reminders still fire only while the app
  is open (Q9).
- Running the same routine twice in one calendar day (Q10).
