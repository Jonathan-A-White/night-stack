# Evening Routine Import Guide

You are a data-authoring agent. Your job is to produce a JSON file the user
can import into NightStack (Settings → Data Management → **Import Data**) that
creates or replaces their evening routine — the ordered list of steps they run
each night, plus one or more variants (e.g., Full, Quick, Travel) that pick a
subset and order of those steps.

> **Heads up:** NightStack's import is a full replace. Importing a file wipes
> *every* table in the app (night logs, weights, supplements, clothing, all of
> it) and repopulates only what is present in the file. If you only want to
> swap routines, start from a recent export of the user's data and modify the
> routine sections in place. See [Modify an existing export](#modify-an-existing-export)
> below.

## Output format

Return **only** a valid JSON object (no markdown fences, no commentary). There
are two acceptable shapes:

### Shape A — routine-only import (fresh install / wipe and replace)

Use this when the user has no data they care about keeping, or has confirmed
they're OK with wiping everything else.

```json
{
  "routineSteps": [ /* RoutineStep, ... */ ],
  "routineVariants": [ /* RoutineVariant, ... */ ],
  "routineSessions": []
}
```

The importer also accepts routine data nested under a `config` key (this is
what the "Full Export (AI-ready)" button produces):

```json
{
  "config": {
    "routineSteps": [ /* ... */ ],
    "routineVariants": [ /* ... */ ]
  },
  "routineSessions": []
}
```

Either shape works. Top-level is simpler for authoring from scratch.

### Shape B — modify an existing export

Ask the user for a recent export file (Export All Data or Full Export). Parse
it, replace only the `routineSteps` and `routineVariants` arrays (and the
parallel arrays under `config` if present), leave everything else untouched,
and return the modified file. This preserves night logs, weight history, etc.

## Field reference

### `RoutineStep`

Represents a single thing to do as part of the routine (e.g., "Brush teeth",
"Set out clothes", "10 min stretch").

| Field         | Type              | Required | Notes |
|---------------|-------------------|----------|-------|
| `id`          | string (UUID)     | yes      | Any unique string. Use `crypto.randomUUID()`-style v4 UUIDs. Must be unique across all steps. Variants reference steps by this id. |
| `name`        | string            | yes      | Short label shown in the tracker, e.g., `"Brush teeth"`. Keep under ~40 chars. |
| `description` | string            | yes      | Optional long text. Use `""` if none — the field must be present. |
| `sortOrder`   | integer           | yes      | 1-based. Controls the default order of steps in the settings list. Unique recommended but not enforced. |
| `isActive`    | boolean           | yes      | `true` for normal steps. `false` hides the step from every session until re-enabled. Use `true` unless the user explicitly wants a step parked. |
| `createdAt`   | number (epoch ms) | yes      | `Date.now()` at authoring time. Any integer works; used only for bookkeeping. |

### `RoutineVariant`

A named selection + ordering of steps. The user picks one variant to run each
night. Think of each variant as a playlist of step ids.

| Field         | Type              | Required | Notes |
|---------------|-------------------|----------|-------|
| `id`          | string (UUID)     | yes      | Unique across variants. |
| `name`        | string            | yes      | Short label, e.g., `"Full"`, `"Quick"`, `"Travel"`, `"Sick day"`. |
| `description` | string            | yes      | Optional long text. Use `""` if none. |
| `stepIds`     | string[]          | yes      | Ordered list of `RoutineStep.id` values. Order in this array is the order the user runs the steps when this variant is active. Every id **must** match an id in `routineSteps`. |
| `isDefault`   | boolean           | yes      | **Exactly one** variant must have `isDefault: true`. The default is the one preselected on the Tonight tab. |
| `sortOrder`   | integer           | yes      | 1-based. Controls the order variants appear in the picker. |
| `createdAt`   | number (epoch ms) | yes      | `Date.now()` at authoring time. |

### `RoutineSession`

Historical per-night run data. **Do not author these by hand.** They are
written by the tracker when the user finishes a session. When building a
routine file from scratch, set `"routineSessions": []` so existing session
history is wiped (since imports replace everything) without adding fake runs
that would pollute stats and personal bests.

If the user is modifying an existing export and wants to keep their history,
leave the existing `routineSessions` array in place untouched.

## Invariants the importer expects

These are not all enforced at import time, but violating them will break the
UI or skew stats:

1. **Every `stepIds` entry in every variant must match an existing
   `routineSteps[].id`.** Dangling ids cause steps to silently disappear from
   that variant.
2. **Exactly one variant has `isDefault: true`.** Zero defaults means nothing
   is preselected on Tonight; multiple defaults means the behavior is
   undefined (first-default-wins in practice, but don't rely on it).
3. **All step and variant ids are unique** across their respective arrays.
   Duplicate ids cause `bulkAdd` to fail and the entire import to roll back.
4. **`sortOrder` values are positive integers**, ideally starting at 1 and
   increasing. Gaps are fine; negatives and zero are not.
5. **`isActive: false` steps are allowed** but should not appear in any
   variant's `stepIds` — an inactive step included in a variant is hidden from
   the session anyway, so it just clutters the data.
6. **`routineSessions` should be `[]`** unless you are deliberately preserving
   prior history from a real export. Never fabricate sessions.

## Worked example

A minimal but realistic routine with two variants — a full 7-step evening and
a quick 3-step version for late or low-energy nights.

```json
{
  "routineSteps": [
    {
      "id": "8a1b6f4e-2c0d-4a11-8e91-3f2b0c5a7d01",
      "name": "Dishes + kitchen reset",
      "description": "Load dishwasher, wipe counters, start it.",
      "sortOrder": 1,
      "isActive": true,
      "createdAt": 1728604800000
    },
    {
      "id": "8a1b6f4e-2c0d-4a11-8e91-3f2b0c5a7d02",
      "name": "Set out clothes",
      "description": "",
      "sortOrder": 2,
      "isActive": true,
      "createdAt": 1728604800000
    },
    {
      "id": "8a1b6f4e-2c0d-4a11-8e91-3f2b0c5a7d03",
      "name": "Pack bag",
      "description": "Laptop, charger, water bottle.",
      "sortOrder": 3,
      "isActive": true,
      "createdAt": 1728604800000
    },
    {
      "id": "8a1b6f4e-2c0d-4a11-8e91-3f2b0c5a7d04",
      "name": "10 min stretch",
      "description": "Hips, shoulders, neck.",
      "sortOrder": 4,
      "isActive": true,
      "createdAt": 1728604800000
    },
    {
      "id": "8a1b6f4e-2c0d-4a11-8e91-3f2b0c5a7d05",
      "name": "Supplements",
      "description": "",
      "sortOrder": 5,
      "isActive": true,
      "createdAt": 1728604800000
    },
    {
      "id": "8a1b6f4e-2c0d-4a11-8e91-3f2b0c5a7d06",
      "name": "Wash face + brush teeth",
      "description": "",
      "sortOrder": 6,
      "isActive": true,
      "createdAt": 1728604800000
    },
    {
      "id": "8a1b6f4e-2c0d-4a11-8e91-3f2b0c5a7d07",
      "name": "Read 10 min",
      "description": "Paper book, lights down.",
      "sortOrder": 7,
      "isActive": true,
      "createdAt": 1728604800000
    }
  ],
  "routineVariants": [
    {
      "id": "b3e52b5a-1f7c-4a8d-9c02-9a3e8b2f1100",
      "name": "Full",
      "description": "Standard weeknight routine.",
      "stepIds": [
        "8a1b6f4e-2c0d-4a11-8e91-3f2b0c5a7d01",
        "8a1b6f4e-2c0d-4a11-8e91-3f2b0c5a7d02",
        "8a1b6f4e-2c0d-4a11-8e91-3f2b0c5a7d03",
        "8a1b6f4e-2c0d-4a11-8e91-3f2b0c5a7d04",
        "8a1b6f4e-2c0d-4a11-8e91-3f2b0c5a7d05",
        "8a1b6f4e-2c0d-4a11-8e91-3f2b0c5a7d06",
        "8a1b6f4e-2c0d-4a11-8e91-3f2b0c5a7d07"
      ],
      "isDefault": true,
      "sortOrder": 1,
      "createdAt": 1728604800000
    },
    {
      "id": "b3e52b5a-1f7c-4a8d-9c02-9a3e8b2f1101",
      "name": "Quick",
      "description": "Minimum viable night. Use when running late or low energy.",
      "stepIds": [
        "8a1b6f4e-2c0d-4a11-8e91-3f2b0c5a7d05",
        "8a1b6f4e-2c0d-4a11-8e91-3f2b0c5a7d06",
        "8a1b6f4e-2c0d-4a11-8e91-3f2b0c5a7d02"
      ],
      "isDefault": false,
      "sortOrder": 2,
      "createdAt": 1728604800000
    }
  ],
  "routineSessions": []
}
```

Notes on the example:

- Both variants reference real step ids; no dangling references.
- `Full` has `isDefault: true`, `Quick` has `isDefault: false` — exactly one
  default.
- `Quick` deliberately reorders steps (supplements first, brush second, clothes
  last) rather than matching the default `sortOrder`. That is fine — a
  variant's `stepIds` order wins for that variant's session.
- `createdAt` values are identical because all rows were authored together;
  any reasonable epoch-ms timestamp is accepted.
- `routineSessions` is `[]`, so the import will wipe any prior session history
  rather than fabricating runs.

## Modify an existing export

If the user hands you an existing export file and asks you to change the
routine in place:

1. Parse the file as JSON.
2. Locate `routineSteps` and `routineVariants`. Depending on which export
   button the user clicked they may be at the top level (Export All Data) or
   nested under `config` (Full Export). Handle both.
3. Replace those two arrays with your new values, keeping all other fields
   (`nightLogs`, `weightEntries`, `appSettings`, etc.) exactly as they were.
4. Leave `routineSessions` alone — the user presumably wants their history.
5. Return the whole modified JSON. The user re-imports it via Settings → Data
   Management → Import Data.

**Caveat when preserving history:** if you delete or rename a step, existing
`routineSessions[].steps[]` entries still reference the old `stepId` and carry
a snapshot `stepName`, so history displays correctly but per-step stats
(averages, personal bests) tied to the deleted id will disappear from the
settings stats view. That is usually desired behavior for a cleanup; flag it
to the user if they were expecting otherwise.

## Questions to ask the user before generating

Ask anything you're unsure about before producing the file:

- What steps does your evening routine include, in order?
- Do any steps need longer descriptions or instructions?
- Do you want more than one variant (e.g., Full + Quick + Travel)? If so, what
  does each variant include and in what order?
- Which variant should be the default (preselected each night)?
- Are you starting fresh, or should I modify an existing export file so your
  night logs and weights are preserved?
