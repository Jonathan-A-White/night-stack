# NightStack

A sleep log, a nightly recommender and a set of home experiments, kept on the phone (React, TypeScript, Dexie, a PWA). Specs are in
`spec-20.md`, `specs/` and `docs/`; `docs/README.md` indexes the docs.

```
npm ci
npm run dev        # the app
npm test           # vitest (set TZ=UTC as the gate does)
npm run lint
npm run build
```

## Let the tutor do it

A form should never need typing. A form that has the door shows a **Let the tutor do it** button above its fields. Tap it and the
tutor asks one question at a time, in plain words, and fills the form's own fields as he answers, a page of at most 8 fields at a time.
It never saves anything itself: when every required field holds something the panel offers **Send**, and Send runs the same save the
page's own button runs, with the same checks (a value out of range, such as a sleep score over 100, is refused before anything is
written). The code is in `src/tutor/`; the talk is the `night-stack` / `form-talk` grind in `grinds/` (answered by the mill, through
`bsv-kit/grist`), and the form description, the Send command and the panel come from `@voice-kit/forms` (`voice-kit/forms`).

Where the door is today:

| Form | Where | Send does |
| --- | --- | --- |
| Morning log, manual sleep data (19 fields, 3 pages) | Morning log, step 1, after **Enter manually** | what the manual **Save** does: keeps the sleep data on the page (the log itself is saved at the end, as always) |
| Evening log (16 fields, 2 pages) | the top of the Evening log, every step | **Save Evening Log**, with the same early-bedtime warning |
| Tonight's plan (7 fields, 1 page) | Tonight | sets the plan's dials; nothing is saved, as when typing |

Not yet on: the settings editors (Routine, Sleep rules, Supplement stack, Weight profile, Midday coping items, Clothing items,
Wake-up causes, Vault PIN), and the parts of the logs that are not text, time, number or a choice (the supplement stack's
deviations, the coping, clothing and bedding pickers, the weight and neck steppers, the sodium and position tags).

**The door is drawn only when there is a mill to talk to.** Night Stack has no licence and holds no key of its own yet; where the
door's key comes from and who pays for the tutor are not decided. Until an app calls `setMillSource` (`src/tutor/mill.ts`) with a
connection, no button is drawn and nothing leaves the phone.
