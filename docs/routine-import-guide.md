# Routine Import Guide

You are a data-authoring agent. Your job is to produce a JSON file the user
can import into NightStack (Settings → Data Management → **Import Routines**)
that creates or replaces their routines. A routine is an ordered list of
timed steps (an evening wind-down, a Sunday-morning sound booth SOP, a
packing checklist) plus one or more variants (e.g., Full, Quick, Travel)
that pick a subset and order of those steps.

> **Pick the right import button.** NightStack's Data Management page has two
> import paths:
>
> - **Import Routines** (under the "Routines Only" card) — replaces only the
>   routine tables (routines, steps, variants, sessions). Night logs, weights,
>   supplements, vault passwords and everything else are untouched. **This is
>   the right target for files produced by this guide.**
> - **Import Data** (under the "Export / Import" card) — full replace. Wipes
>   every table in the app (except the password vault) and rebuilds from the
>   file. Only use this if the user is intentionally restoring a full backup.
>
> A routine-only file works with either button, but the full-replace path will
> erase the user's other data, so prefer Import Routines.

## Output format

Return **only** a valid JSON object (no markdown fences, no commentary).

### Recommended shape — routine-only file (version 2)

This is the shape produced by the "Export Routines" button and consumed
cleanly by the "Import Routines" button.

```json
{
  "exportedAt": "2026-09-06T03:14:00.000Z",
  "version": 2,
  "kind": "nightstack-routines",
  "includesSessions": false,
  "routines": [ /* Routine, ... */ ],
  "routineSteps": [ /* RoutineStep, ... */ ],
  "routineVariants": [ /* RoutineVariant, ... */ ]
}
```

- `exportedAt`, `version`, `kind`, and `includesSessions` are advisory — the
  importer doesn't require them, but including them makes the file
  self-describing and matches what the app itself produces.
- Set `includesSessions` to `true` and add a `routineSessions` array if and
  only if you are deliberately shipping history (rare for hand-authored
  files — see the [`RoutineSession`](#routinesession) note below).
- **Importing replaces every routine.** If the user wants to add one routine
  and keep the others, start from their current export (Export Routines) and
  append to it.

### Legacy shape — version 1 (single routine, no `routines` array)

Files without a `routines` array and without `routineId` on the rows are
still accepted: every row is assigned to the built-in evening routine
(`id: "evening"`). Don't produce this shape for new files.

### Alternate shape — nested under `config`

The importer also accepts routine data nested under a `config` key. This is
what the "Full Export (AI-ready)" button produces:

```json
{
  "config": {
    "routines": [ /* ... */ ],
    "routineSteps": [ /* ... */ ],
    "routineVariants": [ /* ... */ ]
  }
}
```

Only use this shape if you're modifying an existing full export in place —
otherwise prefer the top-level shape above.

## Field reference

### `Routine`

One checklist. The evening routine has the reserved id `"evening"`; keep
that id when you re-author it so the Tonight tab's card, its history and
its notification keep pointing at it.

| Field         | Type              | Required | Notes |
|---------------|-------------------|----------|-------|
| `id`          | string            | yes      | Unique across routines. `"evening"` is reserved for the evening routine; use v4 UUIDs for others. |
| `name`        | string            | yes      | Shown on the Routine home card and tracker header. |
| `description` | string            | yes      | One or two sentences. `""` if none. |
| `schedule`    | object            | yes      | How the start-by countdown is computed. See below. |
| `isActive`    | boolean           | yes      | `false` hides the routine from the Routine home but keeps its history. |
| `sortOrder`   | integer           | yes      | 1-based order on the Routine home. |
| `createdAt`   | number (epoch ms) | yes      | `Date.now()` at authoring time. |

`schedule` is one of:

| Shape | Meaning |
|---|---|
| `{ "anchor": "bedtime" }` | Deadline is tonight's target bedtime (alarm schedule − 7.5 h). The evening routine. |
| `{ "anchor": "time", "deadlineHHMM": "09:45", "daysOfWeek": [0] }` | Fixed wall-clock deadline. `daysOfWeek` uses 0 = Sunday … 6 = Saturday; `[]` means every day. |
| `{ "anchor": "none" }` | No deadline; the tracker still times steps and keeps personal bests. |

The recommended start time is the deadline minus the routine's 30-day
average duration plus a buffer (one standard deviation, or 25 % until there
are five sessions).

### `RoutineStep`

Represents a single thing to do as part of a routine (e.g., "Brush teeth",
"Stage lights on", "Recall the Sunday Morning scene").

| Field         | Type              | Required | Notes |
|---------------|-------------------|----------|-------|
| `id`          | string (UUID)     | yes      | Any unique string. Must be unique across all steps of all routines. Variants reference steps by this id. |
| `routineId`   | string            | yes      | The owning `Routine.id`. |
| `name`        | string            | yes      | Short label shown in the tracker, e.g., `"Brush teeth"`. Keep under ~40 chars. |
| `description` | string            | yes      | Instructions shown under the timer while the step runs. Newlines are preserved, so a list of slider values can be one line each. Use `""` if none. |
| `secretNames` | string[]          | yes      | Names of vault passwords this step needs (e.g. `["Cased iPad password"]`). The tracker shows a "Show …" button per name. Never put the password itself in the file — the user stores it in Settings → Password Vault. `[]` if none. |
| `sortOrder`   | integer           | yes      | 1-based. Controls the default order of steps in the settings list. |
| `isActive`    | boolean           | yes      | `true` for normal steps. `false` hides the step from every session until re-enabled. |
| `createdAt`   | number (epoch ms) | yes      | `Date.now()` at authoring time. |

### `RoutineVariant`

A named selection + ordering of steps within one routine. The user picks
one variant to run each time. Think of each variant as a playlist of step
ids.

| Field         | Type              | Required | Notes |
|---------------|-------------------|----------|-------|
| `id`          | string (UUID)     | yes      | Unique across variants. |
| `routineId`   | string            | yes      | The owning `Routine.id`. Every `stepIds` entry must belong to the same routine. |
| `name`        | string            | yes      | Short label, e.g., `"Full"`, `"Quick"`, `"Travel"`, `"Two singers"`. |
| `description` | string            | yes      | Optional long text. Use `""` if none. |
| `stepIds`     | string[]          | yes      | Ordered list of `RoutineStep.id` values from the same routine. Order here is the order the user runs the steps. |
| `isDefault`   | boolean           | yes      | **Exactly one** variant per routine must have `isDefault: true`. |
| `sortOrder`   | integer           | yes      | 1-based. Controls the order variants appear in the picker. |
| `createdAt`   | number (epoch ms) | yes      | `Date.now()` at authoring time. |

### `RoutineSession`

Historical per-run data. **Do not author these by hand.** They are written
by the tracker when the user finishes a session and carry a `routineId`.
When building a routine file from scratch, omit `routineSessions` (or set it
to `[]`) so existing session history is wiped without adding fake runs that
would pollute stats and personal bests.

## Invariants the importer expects

The importer repairs some of these (missing `routineId` → evening routine,
missing `secretNames` → `[]`, a routine with no variant gets an empty
default one, a routine with no default gets its first variant promoted) but
violating the rest will break the UI or skew stats:

1. **Every `stepIds` entry in every variant must match an existing
   `routineSteps[].id` with the same `routineId`.** Dangling ids silently
   disappear from that variant.
2. **Exactly one variant per routine has `isDefault: true`.**
3. **All routine, step and variant ids are unique** across their respective
   arrays. Duplicate ids cause `bulkAdd` to fail and the entire import to
   roll back.
4. **`sortOrder` values are positive integers**, ideally starting at 1.
5. **`isActive: false` steps are allowed** but should not appear in any
   variant's `stepIds`.
6. **`secretNames` are references only.** A name that isn't stored in the
   vault shows as "not stored yet" with a link to add it.
7. **Keep `"evening"` as the evening routine's id** if the file includes it.

## Worked example

A version-2 file with two routines: the evening routine (two variants) and
a Sunday-morning sound booth routine with a fixed 9:45 deadline and one
step that needs a vault password.

```json
{
  "version": 2,
  "kind": "nightstack-routines",
  "includesSessions": false,
  "routines": [
    {
      "id": "evening",
      "name": "Evening routine",
      "description": "Wind-down checklist timed back from tonight’s target bedtime.",
      "schedule": { "anchor": "bedtime" },
      "isActive": true,
      "sortOrder": 1,
      "createdAt": 1757100000000
    },
    {
      "id": "6d1f0a5c-3b1e-4c8a-9f2e-0b7c1d2e3f40",
      "name": "Sound booth",
      "description": "Sunday-morning setup from a dark room; muted by 9:45 for the livestream.",
      "schedule": { "anchor": "time", "deadlineHHMM": "09:45", "daysOfWeek": [0] },
      "isActive": true,
      "sortOrder": 2,
      "createdAt": 1757100000000
    }
  ],
  "routineSteps": [
    { "id": "8a1b6f4e-2c0d-4a11-8e91-3f2b0c5a7d01", "routineId": "evening", "name": "Dishes + kitchen reset", "description": "Load dishwasher, wipe counters, start it.", "secretNames": [], "sortOrder": 1, "isActive": true, "createdAt": 1757100000000 },
    { "id": "8a1b6f4e-2c0d-4a11-8e91-3f2b0c5a7d02", "routineId": "evening", "name": "Supplements", "description": "", "secretNames": [], "sortOrder": 2, "isActive": true, "createdAt": 1757100000000 },
    { "id": "8a1b6f4e-2c0d-4a11-8e91-3f2b0c5a7d03", "routineId": "evening", "name": "Wash face + brush teeth", "description": "", "secretNames": [], "sortOrder": 3, "isActive": true, "createdAt": 1757100000000 },
    { "id": "c0ffee00-0000-4000-8000-000000000001", "routineId": "6d1f0a5c-3b1e-4c8a-9f2e-0b7c1d2e3f40", "name": "House lights on", "description": "Press the All On button on the white lighting plate on the right wall of the booth.", "secretNames": [], "sortOrder": 1, "isActive": true, "createdAt": 1757100000000 },
    { "id": "c0ffee00-0000-4000-8000-000000000002", "routineId": "6d1f0a5c-3b1e-4c8a-9f2e-0b7c1d2e3f40", "name": "Stage lights scene (BTAIR)", "description": "Unlock the Uncased iPad, force close BTAIR, reopen, Pair Now, tab 3, Sunday Morning.", "secretNames": ["Uncased iPad password"], "sortOrder": 2, "isActive": true, "createdAt": 1757100000000 }
  ],
  "routineVariants": [
    { "id": "b3e52b5a-1f7c-4a8d-9c02-9a3e8b2f1100", "routineId": "evening", "name": "Full", "description": "Standard weeknight routine.", "stepIds": ["8a1b6f4e-2c0d-4a11-8e91-3f2b0c5a7d01", "8a1b6f4e-2c0d-4a11-8e91-3f2b0c5a7d02", "8a1b6f4e-2c0d-4a11-8e91-3f2b0c5a7d03"], "isDefault": true, "sortOrder": 1, "createdAt": 1757100000000 },
    { "id": "b3e52b5a-1f7c-4a8d-9c02-9a3e8b2f1101", "routineId": "evening", "name": "Quick", "description": "Minimum viable night.", "stepIds": ["8a1b6f4e-2c0d-4a11-8e91-3f2b0c5a7d02", "8a1b6f4e-2c0d-4a11-8e91-3f2b0c5a7d03"], "isDefault": false, "sortOrder": 2, "createdAt": 1757100000000 },
    { "id": "b3e52b5a-1f7c-4a8d-9c02-9a3e8b2f1200", "routineId": "6d1f0a5c-3b1e-4c8a-9f2e-0b7c1d2e3f40", "name": "Full", "description": "", "stepIds": ["c0ffee00-0000-4000-8000-000000000001", "c0ffee00-0000-4000-8000-000000000002"], "isDefault": true, "sortOrder": 1, "createdAt": 1757100000000 }
  ]
}
```

Notes on the example:

- Both routines have exactly one default variant; every `stepIds` entry
  belongs to a step of the same routine.
- The sound booth step references `"Uncased iPad password"` by name only.
  After importing, the user opens Settings → Password Vault, which lists
  that name under "not stored yet", and types the value in once.
- `routineSessions` is omitted, so the import wipes prior history rather
  than fabricating runs.

## Modify an existing export

If the user hands you a routine export (or a Full Export) and asks you to
change routines in place:

1. Parse the file as JSON.
2. Locate `routines`, `routineSteps` and `routineVariants` — top level for a
   routine export, under `config` for a Full Export. Handle both.
3. Replace or extend those arrays, keeping every other field exactly as it
   was. Keep the `"evening"` id.
4. Leave `routineSessions` alone — the user presumably wants their history.
5. Return the whole modified JSON.

**Caveat when preserving history:** if you delete or rename a step, existing
`routineSessions[].steps[]` entries still reference the old `stepId` and carry
a snapshot `stepName`, so history displays correctly but per-step stats
(averages, personal bests) tied to the deleted id will disappear from the
editor's stats view.

## Questions to ask the user before generating

- Which routines does this file cover — all of them, or one to add to an
  existing export?
- For each routine: what are the steps, in order, and does any step need
  longer instructions (put those in `description`)?
- Does any step need a password? Use a short, stable name in `secretNames`;
  never ask for or write down the value.
- What is the deadline: target bedtime, a fixed time on certain days, or
  none?
- Do you want more than one variant? Which is the default?
- Are you starting fresh, or should I modify an existing export so history
  is preserved?
