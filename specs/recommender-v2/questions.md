# Open questions

Cross-cutting questions that affect multiple workstreams. **Resolve
before the relevant agent starts** — each question is tagged with the
spec files that depend on the answer.

Per-workstream "Known unknowns" sections stay in each spec file for
questions that are scoped to that workstream alone.

---

## Q1. Is the window AC installed yet?

**Affects:** `logging-fixes.md` T4 · `distance-function.md` T3 ·
`ux.md` T1

The user's original framing said "we *will* have a window AC." The
April 2026 export shows `acCurveProfile === 'off'` on 11/11 nights. If
AC isn't live yet:

- `distance-function.md` T3 already gates AC distance on both sides
  non-`off`, which handles this gracefully.
- `logging-fixes.md` T4 adds an `acInstalled: boolean` setting so the
  evening-log AC card stays hidden until the user opts in. **Don't
  ship T4 without this decision** — if AC is already installed, T4 is
  noise.

**Default if not answered:** ship T4; assume AC is not yet in use.

---

## Q2. Proxy-derived labels: auto-apply or "review and confirm"?

**Affects:** `backfill.md` T3

Two options for the one-time historical labeler:

- **(a) Auto-apply.** Stamp every historical night with the derived
  label and `thermalComfortSource === 'proxy'`. User edits any wrong
  ones after the fact.
- **(b) Review and confirm.** Show the proposed labels in a list;
  user accepts per-row before anything is written.

**Default:** (b). Proxy-derivations are wrong often enough (~20% on
ambiguous nights) that auto-applying risks poisoning the recommender
with incorrect labels on day one.

---

## Q3. Does the recommender weight `'proxy'` labels the same as `'user'` labels?

**Affects:** `backfill.md` T1 · `distance-function.md` (indirect)

If `thermalComfortSource` is added (per `backfill.md` T1), we could
either:

- **(a) Weight equally.** A proxy `just_right` and a user-entered
  `just_right` vote with the same weight in
  `recommendForTonight`.
- **(b) Discount proxy.** Vote proxy labels at 0.5× user labels in
  the `items` support calculation.

**Default:** (a). If/when the user's own labels start disagreeing with
proxy labels, revisit.

---

## Q4. Forecast-low → starting-room prefill: hardcoded or per-user?

**Affects:** `ux.md` T2

Analysis fit: `startingRoom ≈ 0.436 × weatherLow + 49.91`, R²=0.831.

- **(a) Hardcode** the coefficients as constants in
  `src/services/recommender.ts`.
- **(b) Per-user learning.** Compute the fit per user once they have
  ≥10 nights with both fields populated; fall back to (a) before
  then.
- **(c) Skip the prefill entirely** and keep `startingRoomTempF`
  required input on the Tonight form.

**Default:** (a) first, land (b) as a follow-up. The hardcoded
coefficients fit this user's data well and a bootstrap is fine.

**Follow-up risk:** the hardcoded coefficients are specific to this
user's apartment / weather pattern. If the app gets more users, the
constants are wrong for everyone else. Flag this before shipping to
anyone besides the original user.

---

## Q5. "Mixed" thermalComfort — operational definition?

**Affects:** `backfill.md` T2 · `logging-fixes.md` T1

The `ThermalComfort` type includes `'mixed'`, but nothing in the code
classifies anything as mixed today. For the proxy rule and user
guidance:

- **(a) "≥1 hot wake AND ≥1 cold wake in the same night."**
  Clearest rule; easiest to implement.
- **(b) "User swung both ways subjectively."** Rely only on the
  user-entered label; never auto-classify as mixed.
- **(c) Drop `'mixed'` from the type.** Force everything into the
  other three bins.

**Default:** (a) for the proxy classifier; the user can still pick
`'mixed'` manually in the morning log for any night.

**Downstream question:** should mixed nights be excluded from
neighbor voting in `recommendForTonight`, or used as negative
examples? Currently they're just ignored (neither `goodNeighbors` nor
`badNeighbors`). Default is "leave as-is" — mixed is low-signal
either direction.

---

## Q6. `plannedAcCurve === 'off'` semantics — inert baseline or discriminating?

**Affects:** `distance-function.md` T3 · `ux.md` T1

Under `distance-function.md` T3, the AC-curve distance only
contributes when both sides are non-`'off'`. That treats "AC off" as
the inert baseline.

- **(a) Inert baseline.** AC-off nights don't discriminate; only
  AC-on-to-AC-on comparisons matter. *(Current proposal.)*
- **(b) AC-off vs AC-on discriminates.** Running a cool_early curve
  vs no AC at all should produce AC-curve distance.

**Default:** (a). Rationale: with AC in use on 0/11 past nights, the
app has no evidence about how AC-on compares to AC-off — adding a
penalty here is speculative.

**Revisit:** once the user has run AC for ≥5 nights, compute whether
AC-on and AC-off nights produce meaningfully different thermal
comfort outcomes at similar weather. If yes, switch to (b).

---

## Q7. Duplicate-bug root cause (4/15 ≡ 4/16) — what was the user flow?

**Affects:** `bugfixes.md` T1, T3

The analysis surfaced two linked defects: 4/15 and 4/16 share
byte-identical `sleepData`, and 4/15's `roomTimeline` has 4/17
timestamps. `bugfixes.md` T1 lists hypotheses:

- **Hypothesis A:** user re-imported Samsung Health JSON on 4/17
  while viewing the 4/15 morning log, and `parseSamsungHealthJSON`
  doesn't filter by target date.
- **Hypothesis B:** `parseSamsungHealthJSON` always returns the most
  recent session regardless of target date.

The agent can't reproduce without the user's actual JSON files.

**Ask the user:**
- "When you imported sleep data on 4/17, which morning log view were
  you on?"
- "Did you import the same JSON twice, or edit an existing log?"

**Default if unanswered:** land `bugfixes.md` T2 (cross-log dedupe)
and T3 (CSV reproduction) as defense-in-depth. Note in the PR that
T1 root cause wasn't confirmed.

---

## Q8. Test-coverage bar per workstream?

**Affects:** all workstreams

The codebase has 170 passing tests today. Each spec lists tests to
add, but doesn't prescribe a coverage percentage.

**Default:** at minimum, unit-test the pure functions (`nightDistance`,
`logToInputs`, `computeHoursSinceLastMeal`, `computeCoolingRate1to4F`,
`classifyThermalComfortFromWakes`, `estimateStartingRoomTemp`). UI
tests are nice-to-have but not required — prefer manual QA for UI
changes given the small user base.

**Escape hatch:** if an agent lands a behavior change without tests,
flag it in the PR description so a follow-up can add coverage.

---

## Q9. UI placement for the backfill review flow?

**Affects:** `backfill.md` T3

No natural home in the existing nav (Tonight / Morning / Calendar /
Insights / Settings). Candidates:

- **(a) Insights → "Label past nights" button** on the dashboard.
- **(b) Settings → "Data" section.**
- **(c) One-time onboarding card** the first time the user visits
  Insights after backfill ships.

**Default:** (c) for the initial trigger (high visibility), (a) as
the persistent entry point. Flag the choice in the PR.

---

## Q10. `thermalProxyDismissed` and other per-row flags — when do they compound?

**Affects:** `backfill.md` T6

If the user dismisses a proxy proposal ("—") and then later the proxy
rule changes (e.g. adds `wasSweating` support in T5), should
previously-dismissed nights re-surface for review?

- **(a) Never re-surface.** A dismissal is permanent.
- **(b) Re-surface on rule change.** Add a proxy-rule-version field;
  dismissals attached to version N don't apply to version N+1.

**Default:** (a) for simplicity; the user can always re-open a night
via the calendar to set its label manually.

---

## Not in scope for v2

These came up but are deliberately deferred:

- `skinTempRange` parsing (currently a string) — revisit at n≥25.
- `minHeartRate` as a recommender feature — AUC 0.667 at current n;
  revisit at n≥25.
- Per-clothing / per-bedding "warmth rating" — bigger UX change; its
  own spec when ready.
- Pre-committed "tonight's plan" log distinct from the evening log's
  final stack — same note.
