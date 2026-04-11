import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadWip,
  reconcileWipWithVariant,
  saveWip,
  WIP_KEY,
  type WipSession,
  type WipStep,
  type WipStepStatus,
} from '../pages/tonight/routineWipStorage';
import type { RoutineStep, RoutineVariant } from '../types';

function makeStep(partial: Partial<RoutineStep>): RoutineStep {
  return {
    id: partial.id ?? 'step-1',
    name: partial.name ?? 'Step',
    description: partial.description ?? '',
    sortOrder: partial.sortOrder ?? 0,
    isActive: partial.isActive ?? true,
    createdAt: partial.createdAt ?? 0,
  };
}

function makeVariant(partial: Partial<RoutineVariant>): RoutineVariant {
  return {
    id: partial.id ?? 'var-1',
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
    ...extra,
  };
}

function makeWip(partial: Partial<WipSession> & { steps: WipStep[] }): WipSession {
  return {
    id: partial.id ?? 'wip-1',
    variantId: partial.variantId ?? 'var-1',
    variantName: partial.variantName ?? 'Full',
    startedAt: partial.startedAt ?? 0,
    currentStepIndex: partial.currentStepIndex ?? 0,
    currentStepStartedAt: partial.currentStepStartedAt ?? null,
    steps: partial.steps,
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
    saveWip(wip);
    // Nothing in sessionStorage — that's the bug we're fixing.
    expect(sessionStorage.getItem(WIP_KEY)).toBeNull();
    // localStorage holds the WIP across the simulated kill.
    const reloaded = loadWip(new Date('2026-04-11T22:05:00'));
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
      makeWip({
        startedAt,
        currentStepIndex: 0,
        currentStepStartedAt: startedAt,
        steps: [makeWipStep('a', 'A', 'pending', { startedAt })],
      }),
    );
    const reloaded = loadWip(new Date('2026-04-12T07:00:00'));
    expect(reloaded).not.toBeNull();
    expect(reloaded?.startedAt).toBe(startedAt);
  });

  it('drops a stale WIP from a previous evening', () => {
    // Routine started two evenings ago and never finished. Reopening the
    // app the next afternoon should NOT silently resurface it.
    localStorage.clear();
    const startedAt = new Date('2026-04-09T22:00:00').getTime();
    saveWip(
      makeWip({
        startedAt,
        steps: [makeWipStep('a', 'A')],
      }),
    );
    const reloaded = loadWip(new Date('2026-04-11T15:00:00'));
    expect(reloaded).toBeNull();
    // And the stale entry has been cleaned out of storage.
    expect(localStorage.getItem(WIP_KEY)).toBeNull();
  });

  it('saveWip(null) clears the persisted WIP', () => {
    localStorage.clear();
    saveWip(
      makeWip({
        startedAt: Date.now(),
        steps: [makeWipStep('a', 'A')],
      }),
    );
    expect(localStorage.getItem(WIP_KEY)).not.toBeNull();
    saveWip(null);
    expect(localStorage.getItem(WIP_KEY)).toBeNull();
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
});
