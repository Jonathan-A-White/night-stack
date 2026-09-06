import { describe, it, expect, beforeEach } from 'vitest';
import {
  countPendingSteps,
  finishRemaining,
  inFlightPauseMs,
  isPaused,
  loadWip,
  mergeReorderedActiveStepIds,
  pauseWip,
  reconcileWipWithVariant,
  resumeWip,
  saveWip,
  sessionElapsedMs,
  stepElapsedMs,
  stepIdsEqual,
  totalPausedMs,
  WIP_KEY,
  wipKeyFor,
  type WipSession,
  type WipStep,
  type WipStepStatus,
} from '../pages/tonight/routineWipStorage';
import type { RoutineStep, RoutineVariant } from '../types';

function makeStep(partial: Partial<RoutineStep>): RoutineStep {
  return {
    id: partial.id ?? 'step-1',
    routineId: partial.routineId ?? 'evening',
    name: partial.name ?? 'Step',
    description: partial.description ?? '',
    secretNames: partial.secretNames ?? [],
    sortOrder: partial.sortOrder ?? 0,
    isActive: partial.isActive ?? true,
    createdAt: partial.createdAt ?? 0,
  };
}

function makeVariant(partial: Partial<RoutineVariant>): RoutineVariant {
  return {
    id: partial.id ?? 'var-1',
    routineId: partial.routineId ?? 'evening',
    name: partial.name ?? 'Full',
    description: partial.description ?? '',
    stepIds: partial.stepIds ?? [],
    isDefault: partial.isDefault ?? true,
    sortOrder: partial.sortOrder ?? 0,
    createdAt: partial.createdAt ?? 0,
  };
}

function makeWipStep(
  stepId: string,
  name: string,
  status: WipStepStatus = 'pending',
  extra: Partial<WipStep> = {},
): WipStep {
  return {
    stepId,
    stepName: name,
    status,
    startedAt: null,
    endedAt: null,
    durationMs: null,
    pbAtStartMs: null,
    notes: '',
    lastDurationMs: null,
    pausedMs: 0,
    ...extra,
  };
}

function makeWip(partial: Partial<WipSession> & { steps: WipStep[] }): WipSession {
  return {
    id: partial.id ?? 'wip-1',
    routineId: partial.routineId ?? 'evening',
    variantId: partial.variantId ?? 'var-1',
    variantName: partial.variantName ?? 'Full',
    startedAt: partial.startedAt ?? 0,
    currentStepIndex: partial.currentStepIndex ?? 0,
    currentStepStartedAt: partial.currentStepStartedAt ?? null,
    steps: partial.steps,
    pausedMs: partial.pausedMs ?? 0,
    pausedAt: partial.pausedAt ?? null,
  };
}

describe('reconcileWipWithVariant', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('returns the same reference when nothing changed', () => {
    const stepA = makeStep({ id: 'a', name: 'A' });
    const stepB = makeStep({ id: 'b', name: 'B' });
    const variant = makeVariant({ stepIds: ['a', 'b'] });
    const wip = makeWip({
      steps: [
        makeWipStep('a', 'A'),
        makeWipStep('b', 'B'),
      ],
    });
    const result = reconcileWipWithVariant(
      wip,
      variant,
      [stepA, stepB],
      new Map(),
      1000,
    );
    expect(result).toBe(wip);
  });

  it('appends a step added to the variant mid-session', () => {
    const stepA = makeStep({ id: 'a', name: 'A' });
    const stepB = makeStep({ id: 'b', name: 'B' });
    const stepC = makeStep({ id: 'c', name: 'C' });
    const variant = makeVariant({ stepIds: ['a', 'b', 'c'] });
    const wip = makeWip({
      currentStepIndex: 0,
      currentStepStartedAt: 500,
      steps: [
        makeWipStep('a', 'A', 'pending', { startedAt: 500 }),
        makeWipStep('b', 'B'),
      ],
    });
    const pbs = new Map<string, number>([['c', 7_500]]);
    const result = reconcileWipWithVariant(
      wip,
      variant,
      [stepA, stepB, stepC],
      pbs,
      1_000,
    );
    expect(result).not.toBe(wip);
    expect(result.steps).toHaveLength(3);
    expect(result.steps.map((s) => s.stepId)).toEqual(['a', 'b', 'c']);
    // The new step comes in as pending with pbAtStartMs from the pbs map.
    expect(result.steps[2].status).toBe('pending');
    expect(result.steps[2].pbAtStartMs).toBe(7_500);
    // The currently-running step (a) is unchanged.
    expect(result.currentStepIndex).toBe(0);
    expect(result.currentStepStartedAt).toBe(500);
    expect(result.steps[0].startedAt).toBe(500);
  });

  it('preserves mid-session drag reorder when appending new steps', () => {
    // User reordered the running session so B comes before A. Now a
    // new step C is added to the variant. The existing order must not
    // be re-sorted to variant order.
    const stepA = makeStep({ id: 'a', name: 'A' });
    const stepB = makeStep({ id: 'b', name: 'B' });
    const stepC = makeStep({ id: 'c', name: 'C' });
    const variant = makeVariant({ stepIds: ['a', 'b', 'c'] });
    const wip = makeWip({
      currentStepIndex: 0,
      steps: [
        makeWipStep('b', 'B'),
        makeWipStep('a', 'A'),
      ],
    });
    const result = reconcileWipWithVariant(
      wip,
      variant,
      [stepA, stepB, stepC],
      new Map(),
      1_000,
    );
    expect(result.steps.map((s) => s.stepId)).toEqual(['b', 'a', 'c']);
  });

  it('refreshes stepName when an underlying step is renamed', () => {
    const stepA = makeStep({ id: 'a', name: 'Angel' });
    const variant = makeVariant({ stepIds: ['a'] });
    const wip = makeWip({
      steps: [makeWipStep('a', 'A')],
    });
    const result = reconcileWipWithVariant(
      wip,
      variant,
      [stepA],
      new Map(),
      1_000,
    );
    expect(result).not.toBe(wip);
    expect(result.steps[0].stepName).toBe('Angel');
  });

  it('drops steps whose underlying RoutineStep was deleted', () => {
    const stepA = makeStep({ id: 'a', name: 'A' });
    // stepB is gone from allSteps
    const variant = makeVariant({ stepIds: ['a'] });
    const wip = makeWip({
      currentStepIndex: 0,
      steps: [
        makeWipStep('a', 'A'),
        makeWipStep('b', 'B'),
      ],
    });
    const result = reconcileWipWithVariant(
      wip,
      variant,
      [stepA],
      new Map(),
      1_000,
    );
    expect(result.steps.map((s) => s.stepId)).toEqual(['a']);
  });

  it('drops steps whose underlying RoutineStep is marked inactive', () => {
    const stepA = makeStep({ id: 'a', name: 'A' });
    const stepB = makeStep({ id: 'b', name: 'B', isActive: false });
    const variant = makeVariant({ stepIds: ['a', 'b'] });
    const wip = makeWip({
      currentStepIndex: 0,
      steps: [
        makeWipStep('a', 'A'),
        makeWipStep('b', 'B'),
      ],
    });
    const result = reconcileWipWithVariant(
      wip,
      variant,
      [stepA, stepB],
      new Map(),
      1_000,
    );
    expect(result.steps.map((s) => s.stepId)).toEqual(['a']);
  });

  it('advances to the next pending step when the current step is removed', () => {
    const stepA = makeStep({ id: 'a', name: 'A' });
    // current step b is deleted
    const stepC = makeStep({ id: 'c', name: 'C' });
    const variant = makeVariant({ stepIds: ['a', 'c'] });
    const wip = makeWip({
      currentStepIndex: 1,
      currentStepStartedAt: 500,
      steps: [
        makeWipStep('a', 'A', 'completed', {
          startedAt: 0,
          endedAt: 100,
          durationMs: 100,
        }),
        makeWipStep('b', 'B', 'pending', { startedAt: 500 }),
        makeWipStep('c', 'C'),
      ],
    });
    const result = reconcileWipWithVariant(
      wip,
      variant,
      [stepA, stepC],
      new Map(),
      2_000,
    );
    expect(result.steps.map((s) => s.stepId)).toEqual(['a', 'c']);
    expect(result.currentStepIndex).toBe(1); // now pointing at c
    expect(result.currentStepStartedAt).toBe(2_000);
    expect(result.steps[1].startedAt).toBe(2_000);
  });

  it('falls through to completion when removing the current step leaves no pending', () => {
    const stepA = makeStep({ id: 'a', name: 'A' });
    const variant = makeVariant({ stepIds: ['a'] });
    const wip = makeWip({
      currentStepIndex: 1,
      currentStepStartedAt: 500,
      steps: [
        makeWipStep('a', 'A', 'completed', {
          startedAt: 0,
          endedAt: 100,
          durationMs: 100,
        }),
        makeWipStep('b', 'B', 'pending', { startedAt: 500 }),
      ],
    });
    const result = reconcileWipWithVariant(
      wip,
      variant,
      [stepA],
      new Map(),
      2_000,
    );
    expect(result.steps.map((s) => s.stepId)).toEqual(['a']);
    expect(result.currentStepIndex).toBe(1); // = length → completion screen
    expect(result.currentStepStartedAt).toBeNull();
  });

  it('recomputes currentStepIndex by stepId when earlier step removals shift positions', () => {
    const stepB = makeStep({ id: 'b', name: 'B' });
    const stepC = makeStep({ id: 'c', name: 'C' });
    // stepA got deleted; user was working on c (index 2) — should shift to index 1
    const variant = makeVariant({ stepIds: ['b', 'c'] });
    const wip = makeWip({
      currentStepIndex: 2,
      currentStepStartedAt: 500,
      steps: [
        makeWipStep('a', 'A'),
        makeWipStep('b', 'B', 'completed', {
          startedAt: 0,
          endedAt: 100,
          durationMs: 100,
        }),
        makeWipStep('c', 'C', 'pending', { startedAt: 500 }),
      ],
    });
    const result = reconcileWipWithVariant(
      wip,
      variant,
      [stepB, stepC],
      new Map(),
      2_000,
    );
    expect(result.steps.map((s) => s.stepId)).toEqual(['b', 'c']);
    expect(result.currentStepIndex).toBe(1);
    // startedAt for c preserved (step wasn't removed, just shifted).
    expect(result.currentStepStartedAt).toBe(500);
    expect(result.steps[1].startedAt).toBe(500);
  });

  it('resumes from the completion screen when new pending steps arrive', () => {
    const stepA = makeStep({ id: 'a', name: 'A' });
    const stepB = makeStep({ id: 'b', name: 'B' });
    const variant = makeVariant({ stepIds: ['a', 'b'] });
    const wip = makeWip({
      currentStepIndex: 1, // = length → completion screen
      currentStepStartedAt: null,
      steps: [
        makeWipStep('a', 'A', 'completed', {
          startedAt: 0,
          endedAt: 100,
          durationMs: 100,
        }),
      ],
    });
    const result = reconcileWipWithVariant(
      wip,
      variant,
      [stepA, stepB],
      new Map(),
      5_000,
    );
    expect(result.steps.map((s) => s.stepId)).toEqual(['a', 'b']);
    expect(result.currentStepIndex).toBe(1); // pointing at the new pending b
    expect(result.currentStepStartedAt).toBe(5_000);
    expect(result.steps[1].startedAt).toBe(5_000);
  });

  it('does nothing when the wip belongs to a different variant', () => {
    const stepA = makeStep({ id: 'a', name: 'A' });
    const stepB = makeStep({ id: 'b', name: 'B' });
    const variant = makeVariant({ id: 'var-2', stepIds: ['a', 'b'] });
    const wip = makeWip({
      variantId: 'var-1',
      steps: [makeWipStep('a', 'A')],
    });
    const result = reconcileWipWithVariant(
      wip,
      variant,
      [stepA, stepB],
      new Map(),
      1_000,
    );
    expect(result).toBe(wip);
  });

  it('survives a simulated app kill and reload', () => {
    // Simulate the user starting a routine, the app being killed, and the
    // page being re-loaded fresh. localStorage persists across reloads
    // (sessionStorage does not), so loadWip() must be able to recover the
    // session it just saved.
    localStorage.clear();
    sessionStorage.clear();
    const startedAt = new Date('2026-04-11T22:00:00').getTime();
    const wip = makeWip({
      startedAt,
      currentStepIndex: 0,
      currentStepStartedAt: startedAt,
      steps: [
        makeWipStep('a', 'Wash Dishes', 'pending', { startedAt }),
        makeWipStep('b', 'Do Vitamins'),
      ],
    });
    saveWip('evening', wip);
    // Nothing in sessionStorage — that's the bug we're fixing.
    expect(sessionStorage.getItem(WIP_KEY)).toBeNull();
    // localStorage holds the WIP across the simulated kill.
    const reloaded = loadWip('evening', new Date('2026-04-11T22:05:00'));
    expect(reloaded).not.toBeNull();
    expect(reloaded?.id).toBe(wip.id);
    expect(reloaded?.steps).toHaveLength(2);
    expect(reloaded?.steps[0].stepName).toBe('Wash Dishes');
    expect(reloaded?.currentStepIndex).toBe(0);
  });

  it('resumes a routine that crossed midnight when reopened in the early morning', () => {
    // 11:50pm start, user kills app, comes back at 7am next morning. Both
    // moments belong to the same evening (per getEveningLogDate semantics),
    // so the WIP should still resume.
    localStorage.clear();
    const startedAt = new Date('2026-04-11T23:50:00').getTime();
    saveWip(
      'evening',
      makeWip({
        startedAt,
        currentStepIndex: 0,
        currentStepStartedAt: startedAt,
        steps: [makeWipStep('a', 'A', 'pending', { startedAt })],
      }),
    );
    const reloaded = loadWip('evening', new Date('2026-04-12T07:00:00'));
    expect(reloaded).not.toBeNull();
    expect(reloaded?.startedAt).toBe(startedAt);
  });

  it('drops a stale WIP from a previous evening', () => {
    // Routine started two evenings ago and never finished. Reopening the
    // app the next afternoon should NOT silently resurface it.
    localStorage.clear();
    const startedAt = new Date('2026-04-09T22:00:00').getTime();
    saveWip(
      'evening',
      makeWip({
        startedAt,
        steps: [makeWipStep('a', 'A')],
      }),
    );
    const reloaded = loadWip('evening', new Date('2026-04-11T15:00:00'));
    expect(reloaded).toBeNull();
    // And the stale entry has been cleaned out of storage.
    expect(localStorage.getItem(wipKeyFor('evening'))).toBeNull();
  });

  it('saveWip(null) clears the persisted WIP', () => {
    localStorage.clear();
    saveWip(
      'evening',
      makeWip({
        startedAt: Date.now(),
        steps: [makeWipStep('a', 'A')],
      }),
    );
    expect(localStorage.getItem(wipKeyFor('evening'))).not.toBeNull();
    saveWip('evening', null);
    expect(localStorage.getItem(wipKeyFor('evening'))).toBeNull();
  });

  it('preserves per-step progress fields on kept steps', () => {
    const stepA = makeStep({ id: 'a', name: 'A' });
    const stepB = makeStep({ id: 'b', name: 'B' });
    const stepC = makeStep({ id: 'c', name: 'C' });
    const variant = makeVariant({ stepIds: ['a', 'b', 'c'] });
    const wip = makeWip({
      currentStepIndex: 1,
      currentStepStartedAt: 500,
      steps: [
        makeWipStep('a', 'A', 'completed', {
          startedAt: 0,
          endedAt: 150,
          durationMs: 150,
          notes: 'first',
          pbAtStartMs: 200,
        }),
        makeWipStep('b', 'B', 'pending', {
          startedAt: 500,
          notes: 'working on it',
          pbAtStartMs: 300,
        }),
      ],
    });
    const result = reconcileWipWithVariant(
      wip,
      variant,
      [stepA, stepB, stepC],
      new Map(),
      1_000,
    );
    expect(result.steps[0]).toEqual(wip.steps[0]);
    expect(result.steps[1]).toEqual(wip.steps[1]);
    // New step appended.
    expect(result.steps[2].stepId).toBe('c');
    expect(result.currentStepIndex).toBe(1);
    expect(result.currentStepStartedAt).toBe(500);
  });

  it('preserves lastDurationMs on a kept skipped step across reconcile', () => {
    // A step that was skipped during the session (with its previous time
    // stashed onto lastDurationMs) must keep that stash when the variant
    // is reconciled — otherwise a mid-session settings change would clobber
    // the user's restorable time.
    const stepA = makeStep({ id: 'a', name: 'A' });
    const stepB = makeStep({ id: 'b', name: 'B' });
    const variant = makeVariant({ stepIds: ['a', 'b'] });
    const wip = makeWip({
      currentStepIndex: 1,
      steps: [
        makeWipStep('a', 'A', 'skipped', {
          startedAt: 0,
          endedAt: 150,
          durationMs: null,
          lastDurationMs: 7_500, // PB stashed before the skip
        }),
        makeWipStep('b', 'B', 'pending', { startedAt: 200 }),
      ],
    });
    const result = reconcileWipWithVariant(
      wip,
      variant,
      [stepA, stepB],
      new Map(),
      1_000,
    );
    expect(result.steps[0].lastDurationMs).toBe(7_500);
    expect(result.steps[0].status).toBe('skipped');
  });
});

describe('mergeReorderedActiveStepIds', () => {
  it('applies a straight reorder when every existing id is in the reorder', () => {
    const merged = mergeReorderedActiveStepIds(
      ['a', 'b', 'c'],
      ['c', 'a', 'b'],
    );
    expect(merged).toEqual(['c', 'a', 'b']);
  });

  it('preserves the positions of ids not in the reorder list (e.g. inactive steps)', () => {
    // `b` is hidden from the drag UI (inactive), so only a, c, d appear in
    // the reorder list. `b` should stay in its original slot while the
    // others are permuted in-place.
    const merged = mergeReorderedActiveStepIds(
      ['a', 'b', 'c', 'd'],
      ['d', 'a', 'c'],
    );
    expect(merged).toEqual(['d', 'b', 'a', 'c']);
  });

  it('appends ids from the reorder list that were not in the variant', () => {
    const merged = mergeReorderedActiveStepIds(
      ['a', 'b'],
      ['b', 'a', 'new1', 'new2'],
    );
    expect(merged).toEqual(['b', 'a', 'new1', 'new2']);
  });

  it('is a no-op when the reorder matches the existing order', () => {
    const merged = mergeReorderedActiveStepIds(['a', 'b', 'c'], ['a', 'b', 'c']);
    expect(merged).toEqual(['a', 'b', 'c']);
  });

  it('leaves any id not in the reorder list at its original slot', () => {
    // `d` isn't in the reorder list (e.g. it's inactive, or got filtered
    // out of the drag UI for another reason), so it keeps its original
    // position while a/b/c are permuted around it.
    const merged = mergeReorderedActiveStepIds(
      ['a', 'b', 'c', 'd'],
      ['c', 'a', 'b'],
    );
    expect(merged).toEqual(['c', 'a', 'b', 'd']);
  });

  it('handles empty inputs', () => {
    expect(mergeReorderedActiveStepIds([], [])).toEqual([]);
    expect(mergeReorderedActiveStepIds([], ['x'])).toEqual(['x']);
    expect(mergeReorderedActiveStepIds(['a', 'b'], [])).toEqual(['a', 'b']);
  });
});

describe('stepIdsEqual', () => {
  it('returns true for identical arrays', () => {
    expect(stepIdsEqual(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(true);
    expect(stepIdsEqual([], [])).toBe(true);
  });

  it('returns false when order differs', () => {
    expect(stepIdsEqual(['a', 'b'], ['b', 'a'])).toBe(false);
  });

  it('returns false when length differs', () => {
    expect(stepIdsEqual(['a', 'b'], ['a', 'b', 'c'])).toBe(false);
  });
});

describe('pause / resume', () => {
  /** Step a done, step b running since 5000, step c untouched. */
  function makeRunning(extra: Partial<WipSession> = {}): WipSession {
    return makeWip({
      startedAt: 1000,
      currentStepIndex: 1,
      currentStepStartedAt: 5000,
      steps: [
        makeWipStep('a', 'A', 'completed', {
          startedAt: 1000,
          endedAt: 5000,
          durationMs: 4000,
        }),
        makeWipStep('b', 'B', 'pending', { startedAt: 5000 }),
        makeWipStep('c', 'C'),
      ],
      ...extra,
    });
  }

  it('stamps pausedAt and reports paused', () => {
    const paused = pauseWip(makeRunning(), 7000);
    expect(paused.pausedAt).toBe(7000);
    expect(isPaused(paused)).toBe(true);
  });

  it('pausing an already-paused session is a no-op', () => {
    const paused = pauseWip(makeRunning(), 7000);
    expect(pauseWip(paused, 9000)).toBe(paused);
  });

  it('does not pause a session sitting on the completion screen', () => {
    const done = makeRunning({ currentStepIndex: 3, currentStepStartedAt: null });
    expect(pauseWip(done, 7000)).toBe(done);
  });

  it('banks the pause onto the session and the active step on resume', () => {
    const resumed = resumeWip(pauseWip(makeRunning(), 7000), 9000);
    expect(resumed.pausedAt).toBeNull();
    expect(resumed.pausedMs).toBe(2000);
    expect(resumed.steps[1].pausedMs).toBe(2000);
    // Steps that weren't running are untouched.
    expect(resumed.steps[0].pausedMs).toBe(0);
    expect(resumed.steps[2].pausedMs).toBe(0);
  });

  it('accumulates across several pauses', () => {
    let wip = resumeWip(pauseWip(makeRunning(), 7000), 9000);
    wip = resumeWip(pauseWip(wip, 10_000), 10_500);
    expect(wip.pausedMs).toBe(2500);
    expect(wip.steps[1].pausedMs).toBe(2500);
  });

  it('resuming a running session returns the same reference', () => {
    const running = makeRunning();
    expect(resumeWip(running, 9000)).toBe(running);
  });

  it('reports in-flight pause time only while paused', () => {
    const running = makeRunning();
    expect(inFlightPauseMs(running, 9000)).toBe(0);
    const paused = pauseWip(running, 7000);
    expect(inFlightPauseMs(paused, 9000)).toBe(2000);
    expect(totalPausedMs(paused, 9000)).toBe(2000);
  });

  it('freezes the active step timer while paused', () => {
    const paused = pauseWip(makeRunning(), 7000);
    // Whatever "now" is, the step reads as it did at the moment of pausing.
    expect(stepElapsedMs(paused, 1, 7000)).toBe(2000);
    expect(stepElapsedMs(paused, 1, 9000)).toBe(2000);
    expect(stepElapsedMs(paused, 1, 60_000)).toBe(2000);
  });

  it('subtracts banked pause from the active step timer', () => {
    const resumed = resumeWip(pauseWip(makeRunning(), 7000), 9000);
    // 9000 → 12000 is 3s of real running on top of the 2s already elapsed.
    expect(stepElapsedMs(resumed, 1, 12_000)).toBe(5000);
  });

  it('ignores an in-flight pause for steps that are not active', () => {
    const paused = pauseWip(makeRunning(), 7000);
    expect(stepElapsedMs(paused, 0, 9000)).toBe(8000); // 9000 - 1000
    expect(stepElapsedMs(paused, 2, 9000)).toBe(0);    // never started
  });

  it('subtracts pause from the session elapsed, and freezes it while paused', () => {
    const resumed = resumeWip(pauseWip(makeRunning(), 7000), 9000);
    expect(sessionElapsedMs(resumed, 9000)).toBe(6000); // 8000 wall - 2000 paused
    const repaused = pauseWip(resumed, 10_000);
    expect(sessionElapsedMs(repaused, 10_000)).toBe(7000);
    expect(sessionElapsedMs(repaused, 30_000)).toBe(7000);
  });

  it('defaults pause fields when loading a WIP saved before pausing existed', () => {
    const startedAt = Date.now() - 60_000;
    // Hand-rolled legacy payload: no pausedMs/pausedAt anywhere.
    localStorage.setItem(
      wipKeyFor('evening'),
      JSON.stringify({
        id: 'wip-legacy',
        routineId: 'evening',
        variantId: 'var-1',
        variantName: 'Full',
        startedAt,
        currentStepIndex: 0,
        currentStepStartedAt: startedAt,
        steps: [
          {
            stepId: 'a',
            stepName: 'A',
            status: 'pending',
            startedAt,
            endedAt: null,
            durationMs: null,
            pbAtStartMs: null,
            notes: '',
            lastDurationMs: null,
          },
        ],
      }),
    );
    const loaded = loadWip('evening');
    expect(loaded).not.toBeNull();
    expect(loaded!.pausedMs).toBe(0);
    expect(loaded!.pausedAt).toBeNull();
    expect(loaded!.steps[0].pausedMs).toBe(0);
  });

  it('round-trips pause state through storage', () => {
    const paused = pauseWip(makeRunning({ startedAt: Date.now() - 60_000 }), 7000);
    saveWip('evening', paused);
    const loaded = loadWip('evening');
    expect(loaded!.pausedAt).toBe(7000);
    expect(isPaused(loaded!)).toBe(true);
  });
});

describe('finishRemaining', () => {
  function makeMidRoutine(): WipSession {
    return makeWip({
      startedAt: 1000,
      currentStepIndex: 1,
      currentStepStartedAt: 5000,
      steps: [
        makeWipStep('a', 'A', 'completed', {
          startedAt: 1000,
          endedAt: 5000,
          durationMs: 4000,
        }),
        makeWipStep('b', 'B', 'pending', { startedAt: 5000 }),
        makeWipStep('c', 'C'),
        makeWipStep('d', 'D', 'skipped', { endedAt: 4000 }),
      ],
    });
  }

  it('counts the steps still pending', () => {
    expect(countPendingSteps(makeMidRoutine())).toBe(2);
  });

  it('marks every pending step and jumps to the completion screen', () => {
    const finished = finishRemaining(makeMidRoutine(), 'skipped', 9000);
    expect(finished.steps.map((s) => s.status)).toEqual([
      'completed',
      'skipped',
      'skipped',
      'skipped',
    ]);
    expect(finished.currentStepIndex).toBe(finished.steps.length);
    expect(finished.currentStepStartedAt).toBeNull();
  });

  it('stamps endedAt on the active step only', () => {
    const finished = finishRemaining(makeMidRoutine(), 'skipped', 9000);
    // The step that was actually running ended now...
    expect(finished.steps[1].endedAt).toBe(9000);
    expect(finished.steps[1].startedAt).toBe(5000);
    // ...but one that never started stays unstamped, so the saved session's
    // effective end doesn't stretch to cover time nothing was tracked in.
    expect(finished.steps[2].endedAt).toBeNull();
    expect(finished.steps[2].startedAt).toBeNull();
  });

  it('leaves already-handled steps alone', () => {
    const before = makeMidRoutine();
    const finished = finishRemaining(before, 'punted', 9000);
    expect(finished.steps[0]).toEqual(before.steps[0]);
    expect(finished.steps[3]).toEqual(before.steps[3]);
  });

  it('supports punting the remainder', () => {
    const finished = finishRemaining(makeMidRoutine(), 'punted', 9000);
    expect(finished.steps[1].status).toBe('punted');
    expect(finished.steps[2].status).toBe('punted');
  });

  it('records no duration for the steps it marks', () => {
    const finished = finishRemaining(makeMidRoutine(), 'skipped', 9000);
    expect(finished.steps[1].durationMs).toBeNull();
    expect(finished.steps[2].durationMs).toBeNull();
  });

  it('settles an in-flight pause before finishing', () => {
    const paused = pauseWip(makeMidRoutine(), 7000);
    const finished = finishRemaining(paused, 'skipped', 9000);
    expect(finished.pausedAt).toBeNull();
    expect(finished.pausedMs).toBe(2000);
    expect(finished.steps[1].pausedMs).toBe(2000);
  });

  it('stashes a recorded time so it can still be restored', () => {
    const wip = makeWip({
      currentStepIndex: 0,
      currentStepStartedAt: 5000,
      steps: [
        makeWipStep('a', 'A', 'pending', { startedAt: 5000, durationMs: 3000 }),
      ],
    });
    const finished = finishRemaining(wip, 'skipped', 9000);
    expect(finished.steps[0].durationMs).toBeNull();
    expect(finished.steps[0].lastDurationMs).toBe(3000);
  });
});

describe('reconcileWipWithVariant + pause', () => {
  it('re-anchors an in-flight pause when the active step is deleted', () => {
    const stepA = makeStep({ id: 'a', name: 'A' });
    // The paused step b is deleted from the variant mid-pause.
    const stepC = makeStep({ id: 'c', name: 'C' });
    const variant = makeVariant({ stepIds: ['a', 'c'] });
    const wip = makeWip({
      currentStepIndex: 1,
      currentStepStartedAt: 500,
      pausedAt: 1_000,
      steps: [
        makeWipStep('a', 'A', 'completed', {
          startedAt: 0,
          endedAt: 100,
          durationMs: 100,
        }),
        makeWipStep('b', 'B', 'pending', { startedAt: 500 }),
        makeWipStep('c', 'C'),
      ],
    });
    const result = reconcileWipWithVariant(
      wip,
      variant,
      [stepA, stepC],
      new Map(),
      3_000,
    );
    // c is now the active step, started at `now` and still paused — but the
    // pause is measured from `now`, not from when b was paused, so c's timer
    // reads 0 and the 2s already spent paused is banked on the session.
    expect(result.steps.map((s) => s.stepId)).toEqual(['a', 'c']);
    expect(result.currentStepIndex).toBe(1);
    expect(result.pausedMs).toBe(2_000);
    expect(result.pausedAt).toBe(3_000);
    expect(result.steps[1].pausedMs).toBe(0);
    expect(stepElapsedMs(result, 1, 3_000)).toBe(0);
    expect(stepElapsedMs(result, 1, 60_000)).toBe(0);
    // Resuming later charges c only the time it was actually paused for.
    const resumed = resumeWip(result, 5_000);
    expect(resumed.steps[1].pausedMs).toBe(2_000);
    expect(stepElapsedMs(resumed, 1, 6_000)).toBe(1_000);
  });

  it('leaves pause state alone when the active step survives', () => {
    const stepA = makeStep({ id: 'a', name: 'A' });
    const stepB = makeStep({ id: 'b', name: 'B' });
    const stepC = makeStep({ id: 'c', name: 'C' });
    const variant = makeVariant({ stepIds: ['a', 'b', 'c'] });
    const wip = makeWip({
      currentStepIndex: 0,
      currentStepStartedAt: 500,
      pausedAt: 1_000,
      pausedMs: 250,
      steps: [
        makeWipStep('a', 'A', 'pending', { startedAt: 500 }),
        makeWipStep('b', 'B'),
      ],
    });
    const result = reconcileWipWithVariant(
      wip,
      variant,
      [stepA, stepB, stepC],
      new Map(),
      3_000,
    );
    expect(result.steps).toHaveLength(3);
    expect(result.pausedAt).toBe(1_000);
    expect(result.pausedMs).toBe(250);
  });
});
