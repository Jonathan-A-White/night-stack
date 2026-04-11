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
}

export interface WipSession {
  id: string;
  variantId: string | null;
  variantName: string;
  startedAt: number;
  currentStepIndex: number;
  currentStepStartedAt: number | null;
  steps: WipStep[];
}

export const WIP_KEY = 'routine-session-wip';

/**
 * Persist the in-progress routine in localStorage so it survives the app
 * being killed (PWA force-stopped from Android recents, browser tab closed,
 * device restarted, etc). sessionStorage was previously used here, but it
 * gets wiped whenever the page session ends — which is exactly what happens
 * when the user kills the app mid-routine, defeating the resume affordance.
 *
 * To keep stale sessions from a previous evening from resurfacing days
 * later, the WIP is treated as expired if its `startedAt` falls on a
 * different evening (per `getEveningLogDate`) than "now". This is the
 * same evening-rollover semantics the rest of the app uses, so a routine
 * started at 10pm and resumed the next morning at 8am still counts as the
 * same evening — but a routine left dangling for a full day or more is
 * silently dropped.
 */
export function loadWip(now: Date = new Date()): WipSession | null {
  try {
    const raw = localStorage.getItem(WIP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WipSession;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.steps)) return null;
    if (typeof parsed.startedAt !== 'number') return null;
    if (
      getEveningLogDate(new Date(parsed.startedAt)) !== getEveningLogDate(now)
    ) {
      localStorage.removeItem(WIP_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveWip(wip: WipSession | null): void {
  try {
    if (wip == null) {
      localStorage.removeItem(WIP_KEY);
      return;
    }
    localStorage.setItem(WIP_KEY, JSON.stringify(wip));
  } catch {
    // best-effort — storage quota / private mode
  }
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
        };
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
      };
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

  return {
    ...wip,
    steps: nextSteps,
    currentStepIndex: nextCurrentStepIndex,
    currentStepStartedAt: nextCurrentStepStartedAt,
  };
}
