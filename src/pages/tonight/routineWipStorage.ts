import type { RoutineStep, RoutineStepStatus, RoutineVariant } from '../../types';
import { getEveningLogDate } from '../../utils';

export type WipStepStatus = 'pending' | RoutineStepStatus;

export interface WipStep {
  stepId: string;
  stepName: string;
  status: WipStepStatus;
  startedAt: number | null;
  endedAt: number | null;
  durationMs: number | null;
  pbAtStartMs: number | null;
  notes: string;
  /**
   * Stashed copy of the step's previous `durationMs` saved when the step
   * is skipped, so a later unskip can restore the recorded time. `null`
   * means there's nothing to restore (the step was never completed before
   * being skipped). See the long-press skip/unskip handlers in
   * `RoutineTracker.tsx` for how this is consumed.
   */
  lastDurationMs: number | null;
  /**
   * Total ms this step spent paused, already settled (i.e. excluding a
   * pause that is still in flight — see `inFlightPauseMs`). Subtracted
   * from the step's wall-clock elapsed so an interruption never lands in
   * `durationMs`, which is what the per-step targets are built from.
   */
  pausedMs: number;
}

export interface WipSession {
  id: string;
  routineId: string;
  variantId: string | null;
  variantName: string;
  startedAt: number;
  currentStepIndex: number;
  currentStepStartedAt: number | null;
  steps: WipStep[];
  /**
   * Total ms this session spent paused, already settled. Seeded from any
   * sub-sessions already saved today (their pauses happened inside the same
   * inherited `startedAt` window) and grown on every resume. Subtracted
   * from the session's wall-clock total on save.
   */
  pausedMs: number;
  /**
   * Epoch ms when the current pause began, or null when the routine is
   * running. Survives a reload — a routine paused when the app was killed
   * comes back paused, and the pause keeps accumulating in the meantime.
   */
  pausedAt: number | null;
}

/**
 * Legacy single-routine key. Still read (and migrated) for the evening
 * routine so an upgrade mid-routine does not lose progress.
 */
export const WIP_KEY = 'routine-session-wip';

/** Per-routine key. Each routine can have its own in-progress session. */
export function wipKeyFor(routineId: string): string {
  return `${WIP_KEY}:${routineId}`;
}

/**
 * A WIP younger than this always resumes, whatever the evening-date rule
 * says. Keeps a daytime routine that spans noon (the evening-date
 * boundary) from being dropped on resume.
 */
const RECENT_WIP_MS = 6 * 60 * 60 * 1000;

/**
 * Fill in fields added after a WIP may have been written, so a routine that
 * was in progress across an app update keeps running instead of producing
 * NaN timers. Pause tracking (`pausedMs` / `pausedAt`) is the current
 * example: a session started before it existed resumes as never-paused.
 */
function normalizeWip(parsed: Partial<WipSession>, routineId: string): WipSession {
  const steps = (parsed.steps ?? []).map((s) =>
    typeof s.pausedMs === 'number' ? s : { ...s, pausedMs: 0 },
  );
  return {
    ...(parsed as WipSession),
    routineId: parsed.routineId ?? routineId,
    steps,
    pausedMs: typeof parsed.pausedMs === 'number' ? parsed.pausedMs : 0,
    pausedAt: typeof parsed.pausedAt === 'number' ? parsed.pausedAt : null,
  };
}

function parseWip(raw: string | null, routineId: string): WipSession | null {
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Partial<WipSession>;
  if (!parsed || typeof parsed !== 'object') return null;
  if (!Array.isArray(parsed.steps)) return null;
  if (typeof parsed.startedAt !== 'number') return null;
  return normalizeWip(parsed, routineId);
}

/**
 * Ms elapsed in a pause that has not been settled into the accumulators
 * yet — i.e. the pause currently in flight. 0 while the routine is running.
 */
export function inFlightPauseMs(wip: WipSession, now: number): number {
  if (wip.pausedAt == null) return 0;
  return Math.max(0, now - wip.pausedAt);
}

/** True while the routine's clocks are stopped. */
export function isPaused(wip: WipSession): boolean {
  return wip.pausedAt != null;
}

/** Total paused ms including any pause still in flight. */
export function totalPausedMs(wip: WipSession, now: number): number {
  return wip.pausedMs + inFlightPauseMs(wip, now);
}

/**
 * Stop the clocks. No-op if already paused, or if the session has reached
 * the completion screen (nothing is running to pause).
 */
export function pauseWip(wip: WipSession, now: number): WipSession {
  if (wip.pausedAt != null) return wip;
  if (wip.currentStepIndex >= wip.steps.length) return wip;
  return { ...wip, pausedAt: now };
}

/**
 * Settle an in-flight pause: fold its duration into the session total and
 * into the step that was active when it started, then start the clocks
 * again. No-op (same reference) when the routine is already running, so
 * every mutating handler can call it unconditionally.
 */
export function resumeWip(wip: WipSession, now: number): WipSession {
  if (wip.pausedAt == null) return wip;
  const delta = inFlightPauseMs(wip, now);
  const steps = wip.steps.slice();
  const idx = wip.currentStepIndex;
  if (idx < steps.length) {
    steps[idx] = { ...steps[idx], pausedMs: steps[idx].pausedMs + delta };
  }
  return { ...wip, steps, pausedMs: wip.pausedMs + delta, pausedAt: null };
}

/**
 * Ms the given step has been running, excluding paused time. Freezes while
 * the session is paused (the in-flight pause grows at the same rate as the
 * wall clock). Returns 0 for a step that never started.
 */
export function stepElapsedMs(wip: WipSession, index: number, now: number): number {
  const step = wip.steps[index];
  if (!step) return 0;
  const isCurrent = index === wip.currentStepIndex;
  const startedAt = step.startedAt ?? (isCurrent ? wip.currentStepStartedAt : null);
  if (startedAt == null) return 0;
  const paused = step.pausedMs + (isCurrent ? inFlightPauseMs(wip, now) : 0);
  return Math.max(0, now - startedAt - paused);
}

/** Wall-clock ms since the session started, minus all paused time. */
export function sessionElapsedMs(wip: WipSession, now: number): number {
  return Math.max(0, now - wip.startedAt - totalPausedMs(wip, now));
}

/** Number of steps still pending (the active step included). */
export function countPendingSteps(wip: WipSession): number {
  return wip.steps.reduce((n, s) => (s.status === 'pending' ? n + 1 : n), 0);
}

/**
 * End the routine where it stands: mark every still-pending step with
 * `status` and jump to the completion screen, so the work already done can
 * be saved as a real session instead of discarded.
 *
 * Only the active step gets an `endedAt` stamp — it was genuinely running
 * until now. Steps that never started keep `endedAt: null` so the session's
 * effective end (see `computeLatestStepEndedAt`) stays anchored to the last
 * thing actually tracked, rather than stretching the saved total to cover
 * however long the user was away before finishing up on their own.
 *
 * Any in-flight pause is settled first, so a routine finished while paused
 * doesn't leave the pause dangling.
 */
export function finishRemaining(
  wip: WipSession,
  status: 'skipped' | 'punted',
  now: number,
): WipSession {
  const settled = resumeWip(wip, now);
  const steps = settled.steps.map((s, i) => {
    if (s.status !== 'pending') return s;
    // Preserve a previously-recorded time the same way an in-session skip
    // does, so it can still be restored later.
    const stashed = s.durationMs != null ? s.durationMs : s.lastDurationMs;
    if (i === settled.currentStepIndex) {
      return {
        ...s,
        status,
        startedAt: s.startedAt ?? settled.currentStepStartedAt ?? now,
        endedAt: now,
        durationMs: null,
        lastDurationMs: stashed,
      };
    }
    return { ...s, status, durationMs: null, lastDurationMs: stashed };
  });
  return {
    ...settled,
    steps,
    currentStepIndex: steps.length,
    currentStepStartedAt: null,
  };
}

function isExpired(wip: WipSession, now: Date): boolean {
  if (now.getTime() - wip.startedAt < RECENT_WIP_MS) return false;
  return getEveningLogDate(new Date(wip.startedAt)) !== getEveningLogDate(now);
}

/**
 * Persist the in-progress routine in localStorage so it survives the app
 * being killed (PWA force-stopped from Android recents, browser tab closed,
 * device restarted, etc). sessionStorage was previously used here, but it
 * gets wiped whenever the page session ends — which is exactly what happens
 * when the user kills the app mid-routine, defeating the resume affordance.
 *
 * To keep stale sessions from a previous evening from resurfacing days
 * later, the WIP is treated as expired if its `startedAt` falls on a
 * different evening (per `getEveningLogDate`) than "now" — unless it is
 * less than six hours old. This is the same evening-rollover semantics
 * the rest of the app uses, so a routine started at 10pm and resumed the
 * next morning at 8am still counts as the same evening — but a routine
 * left dangling for a full day or more is silently dropped.
 *
 * `routineId` selects the per-routine key. For the evening routine the
 * pre-v13 single key is consulted as a fallback and migrated in place.
 */
export function loadWip(routineId: string, now: Date = new Date()): WipSession | null {
  try {
    const key = wipKeyFor(routineId);
    let wip = parseWip(localStorage.getItem(key), routineId);
    if (!wip && routineId === LEGACY_WIP_ROUTINE_ID) {
      wip = parseWip(localStorage.getItem(WIP_KEY), routineId);
      if (wip) {
        localStorage.removeItem(WIP_KEY);
        localStorage.setItem(key, JSON.stringify(wip));
      }
    }
    if (!wip) return null;
    if (isExpired(wip, now)) {
      localStorage.removeItem(key);
      return null;
    }
    return wip;
  } catch {
    return null;
  }
}

/** Routine the legacy single WIP key belongs to (`EVENING_ROUTINE_ID`). */
export const LEGACY_WIP_ROUTINE_ID = 'evening';

export function saveWip(routineId: string, wip: WipSession | null): void {
  try {
    const key = wipKeyFor(routineId);
    if (wip == null) {
      localStorage.removeItem(key);
      if (routineId === LEGACY_WIP_ROUTINE_ID) localStorage.removeItem(WIP_KEY);
      return;
    }
    localStorage.setItem(key, JSON.stringify({ ...wip, routineId }));
  } catch {
    // best-effort — storage quota / private mode
  }
}

/** Ids of routines that currently have a live (unexpired) WIP. */
export function listRoutinesWithWip(now: Date = new Date()): string[] {
  const out: string[] = [];
  try {
    const prefix = `${WIP_KEY}:`;
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      const routineId = key.slice(prefix.length);
      if (loadWip(routineId, now)) out.push(routineId);
    }
    if (localStorage.getItem(WIP_KEY) && !out.includes(LEGACY_WIP_ROUTINE_ID)) {
      if (loadWip(LEGACY_WIP_ROUTINE_ID, now)) out.push(LEGACY_WIP_ROUTINE_ID);
    }
  } catch {
    // best-effort
  }
  return out;
}

/**
 * Reconcile a running WIP session with the latest state of its variant,
 * so edits made in settings mid-session (adding, renaming, deleting, or
 * deactivating steps) are reflected in the running routine without losing
 * progress on steps the user has already handled.
 *
 * Rules:
 *  - Existing WIP steps stay in place (preserves any mid-session drag
 *    reorder and any completed/skipped/punted state) as long as the
 *    underlying RoutineStep still exists and is active.
 *  - If the underlying step was deleted or marked inactive, it's dropped.
 *  - stepName is refreshed from the latest RoutineStep in case of rename.
 *  - Any active step in the variant that isn't already in the WIP is
 *    appended to the end as a new pending step, with pbAtStartMs taken
 *    from the current pbs map.
 *  - currentStepIndex is re-resolved by stepId so the user keeps tracking
 *    the same step even if insertions/removals shifted its position. If
 *    the current step itself got removed, we advance to the next pending
 *    step, or to the completion screen if none remain.
 *  - If the session was on the completion screen and new pending steps
 *    arrived, we resume on the first newly-added pending step so the
 *    user can run it.
 *
 * Returns the original wip reference if nothing actually changed, so
 * callers can detect no-op updates with identity equality and avoid
 * unnecessary renders or an infinite update loop.
 */
export function reconcileWipWithVariant(
  wip: WipSession,
  variant: RoutineVariant,
  allSteps: RoutineStep[],
  pbs: Map<string, number>,
  now: number,
): WipSession {
  if (wip.variantId !== variant.id) return wip;

  const stepMap = new Map(allSteps.map((s) => [s.id, s]));

  const wasOnCompletion =
    wip.steps.length > 0 && wip.currentStepIndex >= wip.steps.length;
  const currentStepId = !wasOnCompletion
    ? wip.steps[wip.currentStepIndex]?.stepId ?? null
    : null;

  // 1. Keep existing WIP steps whose underlying step still exists and is
  //    active. Refresh stepName in case it was renamed in settings.
  const kept: WipStep[] = [];
  const keptIds = new Set<string>();
  for (const wipStep of wip.steps) {
    const underlying = stepMap.get(wipStep.stepId);
    if (!underlying || !underlying.isActive) continue;
    kept.push(
      wipStep.stepName === underlying.name
        ? wipStep
        : { ...wipStep, stepName: underlying.name },
    );
    keptIds.add(wipStep.stepId);
  }

  // 2. Append any active steps from the variant that aren't already in
  //    the WIP.
  const added: WipStep[] = [];
  for (const id of variant.stepIds) {
    if (keptIds.has(id)) continue;
    const s = stepMap.get(id);
    if (!s || !s.isActive) continue;
    added.push({
      stepId: s.id,
      stepName: s.name,
      status: 'pending',
      startedAt: null,
      endedAt: null,
      durationMs: null,
      pbAtStartMs: pbs.get(s.id) ?? null,
      notes: '',
      lastDurationMs: null,
      pausedMs: 0,
    });
  }

  const nextSteps: WipStep[] = [...kept, ...added];

  // Fast path: nothing changed → return the original reference so the
  // caller can identity-check.
  const stepsUnchanged =
    nextSteps.length === wip.steps.length &&
    nextSteps.every((s, i) => s === wip.steps[i]);

  // 3. Re-resolve currentStepIndex by stepId so we keep tracking the same
  //    step regardless of insertions/removals.
  let nextCurrentStepIndex = wip.currentStepIndex;
  let nextCurrentStepStartedAt = wip.currentStepStartedAt;
  // Set when a different step's timer is started below, so a session that
  // is paused right now can re-anchor its pause to the new step (see the
  // return value) instead of charging it time from before it existed.
  let startedNewCurrentStep = false;

  if (currentStepId != null) {
    const foundIdx = nextSteps.findIndex((s) => s.stepId === currentStepId);
    if (foundIdx !== -1) {
      nextCurrentStepIndex = foundIdx;
    } else {
      // Currently-running step was deleted or deactivated — advance to
      // the next still-pending step, or to completion if none remain.
      const nextPending = nextSteps.findIndex((s) => s.status === 'pending');
      if (nextPending === -1) {
        nextCurrentStepIndex = nextSteps.length;
        nextCurrentStepStartedAt = null;
      } else {
        nextCurrentStepIndex = nextPending;
        nextCurrentStepStartedAt = now;
        nextSteps[nextPending] = {
          ...nextSteps[nextPending],
          startedAt: now,
          pausedMs: 0,
        };
        startedNewCurrentStep = true;
      }
    }
  } else if (wasOnCompletion && added.length > 0) {
    // Session had reached the completion screen but new pending steps
    // just arrived — resume on the first newly-added step.
    const nextPending = nextSteps.findIndex((s) => s.status === 'pending');
    if (nextPending !== -1) {
      nextCurrentStepIndex = nextPending;
      nextCurrentStepStartedAt = now;
      nextSteps[nextPending] = {
        ...nextSteps[nextPending],
        startedAt: now,
        pausedMs: 0,
      };
      startedNewCurrentStep = true;
    }
  } else if (wasOnCompletion) {
    // Still on completion, but length may have shrunk (a trailing step
    // got deleted). Keep "on completion" semantics.
    nextCurrentStepIndex = nextSteps.length;
  }

  if (
    stepsUnchanged &&
    nextCurrentStepIndex === wip.currentStepIndex &&
    nextCurrentStepStartedAt === wip.currentStepStartedAt
  ) {
    return wip;
  }

  // A pause that was in flight when the active step changed belongs to the
  // step that just went away, which is no longer here to carry it: bank it
  // on the session and restart the pause against the new step, so the
  // session total stays right and the new step's clock reads 0 on resume.
  const carriedPauseMs = wip.pausedAt != null && startedNewCurrentStep
    ? Math.max(0, now - wip.pausedAt)
    : 0;

  return {
    ...wip,
    steps: nextSteps,
    currentStepIndex: nextCurrentStepIndex,
    currentStepStartedAt: nextCurrentStepStartedAt,
    pausedMs: wip.pausedMs + carriedPauseMs,
    pausedAt: wip.pausedAt != null && startedNewCurrentStep ? now : wip.pausedAt,
  };
}

/**
 * Merge a reordered list of active step IDs back into a variant's full
 * stepIds array so the new order can be persisted to the variant without
 * losing any IDs that weren't visible to the reorder UI (e.g. steps that
 * were filtered out because they're inactive at the global level).
 *
 * Walks the variant's existing stepIds: each slot whose ID appears in
 * `newActiveOrder` is filled with the next ID from that list (in order);
 * slots whose IDs aren't in the reorder list stay exactly where they are.
 * Any IDs in `newActiveOrder` that weren't in `existingStepIds` at all
 * (e.g. a step added to the variant mid-drag) are appended at the end.
 *
 * The helper is defensive about the drag UI handing us fewer IDs than
 * there are matching slots: surplus slots are dropped rather than padded
 * with `undefined`, which keeps the resulting array well-formed even in
 * edge cases that shouldn't normally happen.
 */
export function mergeReorderedActiveStepIds(
  existingStepIds: string[],
  newActiveOrder: string[],
): string[] {
  const reorderSet = new Set(newActiveOrder);
  const existingSet = new Set(existingStepIds);
  const result: string[] = [];
  let activeIdx = 0;
  for (const id of existingStepIds) {
    if (reorderSet.has(id)) {
      if (activeIdx < newActiveOrder.length) {
        result.push(newActiveOrder[activeIdx]);
        activeIdx += 1;
      }
      // else: more matching slots than reordered IDs — drop the slot.
    } else {
      result.push(id);
    }
  }
  // Append any IDs from newActiveOrder that weren't in existingStepIds at all.
  while (activeIdx < newActiveOrder.length) {
    const id = newActiveOrder[activeIdx];
    if (!existingSet.has(id)) result.push(id);
    activeIdx += 1;
  }
  return result;
}

/** True when two stepIds arrays are element-wise equal. */
export function stepIdsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
