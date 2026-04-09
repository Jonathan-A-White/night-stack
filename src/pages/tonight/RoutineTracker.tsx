import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import {
  computeStepPBs,
  formatStopwatch,
  formatTotal,
} from '../../services/routineAnalytics';
import { getTodayDate } from '../../utils';
import type {
  RoutineSession,
  RoutineStep,
  RoutineStepLog,
  RoutineStepStatus,
  RoutineVariant,
} from '../../types';

export { RoutineTracker };

type WipStepStatus = 'pending' | RoutineStepStatus;

interface WipStep {
  stepId: string;
  stepName: string;
  status: WipStepStatus;
  startedAt: number | null;
  endedAt: number | null;
  durationMs: number | null;
  pbAtStartMs: number | null;
  notes: string;
}

interface WipSession {
  id: string;
  variantId: string | null;
  variantName: string;
  startedAt: number;
  currentStepIndex: number;
  currentStepStartedAt: number | null;
  steps: WipStep[];
}

const WIP_KEY = 'routine-session-wip';
const LONGPRESS_MS = 500;

function msToMMSS(ms: number): string {
  const abs = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  const seconds = abs % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

function formatDelta(ms: number): string {
  const sign = ms >= 0 ? '+' : '-';
  return `${sign}${msToMMSS(Math.abs(ms))}`;
}

function loadWip(): WipSession | null {
  try {
    const raw = sessionStorage.getItem(WIP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WipSession;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.steps)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveWip(wip: WipSession | null): void {
  try {
    if (wip == null) {
      sessionStorage.removeItem(WIP_KEY);
      return;
    }
    sessionStorage.setItem(WIP_KEY, JSON.stringify(wip));
  } catch {
    // best-effort — storage quota / private mode
  }
}

function formatClockHHMM(ts: number): string {
  const d = new Date(ts);
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const period = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${h12}:${minutes.toString().padStart(2, '0')} ${period}`;
}

function buildWipSteps(
  steps: RoutineStep[],
  pbs: Map<string, number>,
): WipStep[] {
  return steps.map((s) => ({
    stepId: s.id,
    stepName: s.name,
    status: 'pending' as WipStepStatus,
    startedAt: null,
    endedAt: null,
    durationMs: null,
    pbAtStartMs: pbs.get(s.id) ?? null,
    notes: '',
  }));
}

export default function RoutineTracker() {
  const navigate = useNavigate();

  const variants = useLiveQuery(
    () => db.routineVariants.orderBy('sortOrder').toArray(),
    [],
  );
  const allSteps = useLiveQuery(() => db.routineSteps.toArray(), []);
  const sessions = useLiveQuery(() => db.routineSessions.toArray(), []);

  // Selected variant id (starts as null, resolved once variants load).
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);

  // Work-in-progress session.
  const [wip, setWip] = useState<WipSession | null>(() => loadWip());

  // Tick for timer rendering (every 200ms while a step is active).
  const [, setTick] = useState(0);

  // Long-press menu target step index.
  const [longPressStepIndex, setLongPressStepIndex] = useState<number | null>(null);

  // Session-level notes (only used on completion screen).
  const [sessionNotes, setSessionNotes] = useState('');

  // "Resume" banner hides after the user interacts with it.
  const [showResumeBanner, setShowResumeBanner] = useState<boolean>(() => loadWip() != null);

  // Refs for long-press timers.
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist WIP to sessionStorage on every change.
  useEffect(() => {
    saveWip(wip);
  }, [wip]);

  // Tick interval — run only while a step is active (and completion screen
  // not reached). Keeps the timer readout moving.
  useEffect(() => {
    if (!wip) return;
    if (wip.currentStepStartedAt == null) return;
    if (wip.currentStepIndex >= wip.steps.length) return;
    const id = setInterval(() => setTick((t) => (t + 1) % 1_000_000), 200);
    return () => clearInterval(id);
  }, [wip]);

  // Ensure any pending long-press timer is cleared if the component unmounts
  // mid-press. Without this the timer would still fire and call setState on
  // an unmounted component.
  useEffect(() => {
    return () => {
      if (longPressTimer.current != null) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    };
  }, []);

  // Resolve default variant selection once variants load.
  useEffect(() => {
    if (!variants || variants.length === 0) return;
    if (selectedVariantId != null) {
      // Make sure the selection still exists.
      if (variants.some((v) => v.id === selectedVariantId)) return;
    }
    // Prefer WIP variant, then default, then first.
    if (wip && wip.variantId && variants.some((v) => v.id === wip.variantId)) {
      setSelectedVariantId(wip.variantId);
      return;
    }
    const def = variants.find((v) => v.isDefault);
    setSelectedVariantId((def ?? variants[0]).id);
  }, [variants, selectedVariantId, wip]);

  const selectedVariant: RoutineVariant | null = useMemo(() => {
    if (!variants || !selectedVariantId) return null;
    return variants.find((v) => v.id === selectedVariantId) ?? null;
  }, [variants, selectedVariantId]);

  // Resolve the ordered list of steps for the selected variant.
  const orderedSteps: RoutineStep[] = useMemo(() => {
    if (!selectedVariant || !allSteps) return [];
    const stepMap = new Map(allSteps.map((s) => [s.id, s]));
    const ordered: RoutineStep[] = [];
    for (const id of selectedVariant.stepIds) {
      const s = stepMap.get(id);
      if (s && s.isActive) ordered.push(s);
    }
    return ordered;
  }, [selectedVariant, allSteps]);

  // PBs per step across all sessions.
  const pbs = useMemo(() => computeStepPBs(sessions ?? []), [sessions]);

  // Best total of all completed sessions (for completion screen delta).
  const bestCompletedTotalMs = useMemo(() => {
    if (!sessions) return null;
    let best: number | null = null;
    for (const s of sessions) {
      if (s.completedAt != null && s.totalDurationMs != null) {
        if (best == null || s.totalDurationMs < best) best = s.totalDurationMs;
      }
    }
    return best;
  }, [sessions]);

  // Loading guard.
  if (!variants || !allSteps || !sessions) {
    return <div className="empty-state"><h3>Loading&hellip;</h3></div>;
  }

  if (variants.length === 0) {
    return (
      <div className="empty-state">
        <h3>No variants configured</h3>
        <p className="text-secondary text-sm">
          <Link to="/settings/evening-routine">Configure in Settings</Link>
        </p>
      </div>
    );
  }

  if (!selectedVariant) {
    return <div className="empty-state"><h3>Loading&hellip;</h3></div>;
  }

  const isRunning = wip != null;
  const isComplete =
    wip != null &&
    wip.steps.length > 0 &&
    wip.currentStepIndex >= wip.steps.length;

  // ===== Handlers =====

  const handleSelectVariant = (variantId: string) => {
    if (variantId === selectedVariantId) return;
    if (wip) {
      const ok = window.confirm(
        'Switching variant will discard the in-progress routine. Continue?',
      );
      if (!ok) return;
      setWip(null);
      setShowResumeBanner(false);
    }
    setSelectedVariantId(variantId);
  };

  const handleStart = () => {
    if (orderedSteps.length === 0) return;
    const now = Date.now();
    const newWip: WipSession = {
      id: crypto.randomUUID(),
      variantId: selectedVariant.id,
      variantName: selectedVariant.name,
      startedAt: now,
      currentStepIndex: 0,
      currentStepStartedAt: now,
      steps: buildWipSteps(orderedSteps, pbs),
    };
    // Stamp the first step's startedAt.
    newWip.steps[0] = {
      ...newWip.steps[0],
      startedAt: now,
    };
    setWip(newWip);
    setShowResumeBanner(false);
  };

  /** Mutate the WIP by index, producing a new WipSession. */
  const updateStep = (
    current: WipSession,
    index: number,
    patch: Partial<WipStep>,
  ): WipSession => {
    const nextSteps = current.steps.slice();
    nextSteps[index] = { ...nextSteps[index], ...patch };
    return { ...current, steps: nextSteps };
  };

  /** Advance to the next pending step (or completion screen). */
  const advanceAfter = (current: WipSession, completedIndex: number): WipSession => {
    // Look for the next step whose status is still 'pending'.
    const nextIndex = current.steps.findIndex(
      (s, i) => i > completedIndex && s.status === 'pending',
    );
    if (nextIndex === -1) {
      // No more pending — jump to completion.
      return {
        ...current,
        currentStepIndex: current.steps.length,
        currentStepStartedAt: null,
      };
    }
    const now = Date.now();
    const next: WipSession = {
      ...current,
      currentStepIndex: nextIndex,
      currentStepStartedAt: now,
    };
    return updateStep(next, nextIndex, { startedAt: now });
  };

  const handleDone = () => {
    if (!wip) return;
    const idx = wip.currentStepIndex;
    if (idx >= wip.steps.length) return;
    const now = Date.now();
    const step = wip.steps[idx];
    const startedAt = step.startedAt ?? wip.currentStepStartedAt ?? now;
    const duration = Math.max(0, now - startedAt);
    let next = updateStep(wip, idx, {
      status: 'completed',
      endedAt: now,
      durationMs: duration,
    });
    next = advanceAfter(next, idx);
    setWip(next);
  };

  const applyStatusToStep = (
    index: number,
    status: 'skipped' | 'punted',
  ) => {
    if (!wip) return;
    const now = Date.now();
    const step = wip.steps[index];
    const isCurrent = index === wip.currentStepIndex;

    let patch: Partial<WipStep>;
    if (isCurrent) {
      const startedAt = step.startedAt ?? wip.currentStepStartedAt ?? now;
      patch = {
        status,
        startedAt,
        endedAt: now,
        durationMs: null,
      };
    } else {
      patch = {
        status,
        endedAt: now,
        durationMs: null,
      };
    }

    let next = updateStep(wip, index, patch);
    if (isCurrent) {
      next = advanceAfter(next, index);
    }
    setWip(next);
  };

  const handleLongPressSkip = () => {
    if (longPressStepIndex == null) return;
    applyStatusToStep(longPressStepIndex, 'skipped');
    setLongPressStepIndex(null);
  };

  const handleLongPressPunt = () => {
    if (longPressStepIndex == null) return;
    applyStatusToStep(longPressStepIndex, 'punted');
    setLongPressStepIndex(null);
  };

  const cancelLongPressTimer = () => {
    if (longPressTimer.current != null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const startLongPress = (index: number) => {
    cancelLongPressTimer();
    longPressTimer.current = setTimeout(() => {
      setLongPressStepIndex(index);
      longPressTimer.current = null;
    }, LONGPRESS_MS);
  };

  const handleNotesChange = (value: string) => {
    if (!wip) return;
    setWip(updateStep(wip, wip.currentStepIndex, { notes: value }));
  };

  const handleBailout = () => {
    if (wip) {
      const ok = window.confirm('Discard in-progress routine?');
      if (!ok) return;
    }
    setWip(null);
    setShowResumeBanner(false);
    navigate('/tonight');
  };

  const handleDiscardResume = () => {
    const ok = window.confirm('Discard in-progress routine?');
    if (!ok) return;
    setWip(null);
    setShowResumeBanner(false);
  };

  const handleContinueResume = () => {
    setShowResumeBanner(false);
  };

  const handleSave = async () => {
    if (!wip) return;
    const now = Date.now();
    const stepLogs: RoutineStepLog[] = wip.steps.map((s) => ({
      stepId: s.stepId,
      stepName: s.stepName,
      status: (s.status === 'pending' ? 'skipped' : s.status) as RoutineStepStatus,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      durationMs: s.durationMs,
      pbAtStartMs: s.pbAtStartMs,
      notes: s.notes,
    }));
    const totalDurationMs = stepLogs
      .filter((s) => s.status === 'completed' && s.durationMs != null)
      .reduce((acc, s) => acc + (s.durationMs as number), 0);

    const session: RoutineSession = {
      id: wip.id,
      date: getTodayDate(),
      variantId: wip.variantId,
      variantName: wip.variantName,
      startedAt: wip.startedAt,
      endedAt: now,
      completedAt: now,
      totalDurationMs,
      steps: stepLogs,
      sessionNotes,
      createdAt: now,
    };

    await db.routineSessions.add(session);
    saveWip(null);
    setWip(null);
    setSessionNotes('');
    navigate('/tonight');
  };

  const handleDiscardCompletion = () => {
    const ok = window.confirm('Discard this session?');
    if (!ok) return;
    saveWip(null);
    setWip(null);
    setSessionNotes('');
    navigate('/tonight');
  };

  // ===== Render helpers =====

  const renderVariantChips = () => (
    <div className="flex gap-8 mb-8" style={{ flexWrap: 'wrap' }}>
      {variants.map((v) => (
        <button
          key={v.id}
          type="button"
          className={`routine-variant-chip${v.id === selectedVariantId ? ' active' : ''}`}
          onClick={() => handleSelectVariant(v.id)}
        >
          {v.name}
        </button>
      ))}
    </div>
  );

  // ===== State 3: Completion screen =====
  if (isComplete && wip) {
    const completedSteps = wip.steps.filter((s) => s.status === 'completed');
    const totalMs = completedSteps.reduce(
      (acc, s) => acc + (s.durationMs ?? 0),
      0,
    );
    const bestDelta =
      bestCompletedTotalMs != null ? totalMs - bestCompletedTotalMs : null;

    return (
      <div>
        <div className="page-header">
          <button
            type="button"
            className="btn btn-sm btn-secondary mb-8"
            onClick={handleBailout}
            aria-label="Close"
          >
            &times; Close
          </button>
          <h1>Routine complete!</h1>
        </div>

        <div className="card">
          <div className="card-title">Total</div>
          <div className="routine-timer-display">{formatTotal(totalMs)}</div>
          {bestDelta != null && (
            <div
              className={`routine-timer-label${bestDelta > 0 ? ' negative' : ''}`}
              style={{
                color:
                  bestDelta < 0
                    ? 'var(--color-success)'
                    : bestDelta > 0
                      ? 'var(--color-danger)'
                      : undefined,
              }}
            >
              {formatDelta(bestDelta)} vs. all-time best
            </div>
          )}
          {bestDelta == null && (
            <div className="routine-timer-label">First completed session!</div>
          )}
        </div>

        <div className="card">
          <div className="card-title">Step recap</div>
          {wip.steps.map((s, i) => {
            const pb = s.pbAtStartMs;
            let deltaNode: React.ReactNode = null;
            if (s.status === 'completed' && s.durationMs != null && pb != null) {
              const delta = s.durationMs - pb;
              deltaNode = (
                <span
                  className={`routine-step-time${delta > 0 ? ' negative' : ''}`}
                  style={{
                    color:
                      delta < 0
                        ? 'var(--color-success)'
                        : delta > 0
                          ? 'var(--color-danger)'
                          : undefined,
                  }}
                >
                  {formatDelta(delta)}
                </span>
              );
            }
            const rowClass =
              s.status === 'completed'
                ? 'routine-step-row done'
                : s.status === 'skipped'
                  ? 'routine-step-row skipped'
                  : s.status === 'punted'
                    ? 'routine-step-row punted'
                    : 'routine-step-row';
            return (
              <div key={`${s.stepId}-${i}`} className={rowClass}>
                <span className="routine-step-name">
                  {i + 1}. {s.stepName}
                </span>
                {s.status === 'completed' && s.durationMs != null && (
                  <span className="routine-step-time">
                    {msToMMSS(s.durationMs)}
                  </span>
                )}
                {s.status === 'skipped' && (
                  <span className="text-secondary text-sm">Skipped</span>
                )}
                {s.status === 'punted' && (
                  <span className="text-secondary text-sm">Punted</span>
                )}
                {deltaNode}
              </div>
            );
          })}
        </div>

        <div className="card">
          <div className="card-title">Session notes</div>
          <textarea
            className="form-input routine-step-notes-input"
            placeholder="What went well or poorly tonight?"
            value={sessionNotes}
            onChange={(e) => setSessionNotes(e.target.value)}
            rows={3}
          />
        </div>

        <button
          className="btn btn-primary btn-full mt-16"
          onClick={handleSave}
        >
          Save session
        </button>
        <button
          className="btn btn-danger btn-full mt-16"
          onClick={handleDiscardCompletion}
        >
          Discard session
        </button>
      </div>
    );
  }

  // ===== State 2: Session in progress =====
  if (isRunning && wip && wip.currentStepIndex < wip.steps.length) {
    const idx = wip.currentStepIndex;
    const currentStep = wip.steps[idx];
    const pb = currentStep.pbAtStartMs;
    const startedAt = currentStep.startedAt ?? wip.currentStepStartedAt ?? Date.now();
    const elapsed = Date.now() - startedAt;
    // Counting down from PB if available; otherwise counting up.
    const timerMs = pb != null ? pb - elapsed : elapsed;
    const isNegative = timerMs < 0;

    return (
      <div>
        <div className="page-header">
          <button
            type="button"
            className="btn btn-sm btn-secondary mb-8"
            onClick={handleBailout}
            aria-label="Close"
          >
            &times; Close
          </button>
          <h1>
            Step {idx + 1} of {wip.steps.length} &mdash; {currentStep.stepName}
          </h1>
        </div>

        <div className="card">
          <div className={`routine-timer-display${isNegative ? ' negative' : ''}`}>
            {formatStopwatch(timerMs)}
          </div>
          <div className="routine-timer-label">
            {pb != null ? 'remaining vs. best' : 'elapsed (no best yet)'}
          </div>
          <textarea
            className="form-input routine-step-notes-input"
            placeholder="Notes for this step (optional)"
            value={currentStep.notes}
            onChange={(e) => handleNotesChange(e.target.value)}
            rows={2}
          />
          <button
            className="btn btn-primary btn-full mt-16"
            onClick={handleDone}
          >
            Done
          </button>
          <p className="text-secondary text-sm mt-16" style={{ textAlign: 'center' }}>
            Long-press any step for options
          </p>
        </div>

        <div className="card">
          <div className="card-title">Steps</div>
          {wip.steps.map((s, i) => {
            const rowClass = (() => {
              if (i === idx) return 'routine-step-row active';
              if (s.status === 'completed') return 'routine-step-row done';
              if (s.status === 'skipped') return 'routine-step-row skipped';
              if (s.status === 'punted') return 'routine-step-row punted';
              return 'routine-step-row';
            })();
            return (
              <div
                key={`${s.stepId}-${i}`}
                className={rowClass}
                onMouseDown={() => startLongPress(i)}
                onMouseUp={cancelLongPressTimer}
                onMouseLeave={cancelLongPressTimer}
                onTouchStart={() => startLongPress(i)}
                onTouchEnd={cancelLongPressTimer}
                onTouchCancel={cancelLongPressTimer}
              >
                <span className="routine-step-name">
                  {i + 1}. {s.stepName}
                </span>
                {s.status === 'completed' && s.durationMs != null && (
                  <span className="routine-step-time">
                    {msToMMSS(s.durationMs)}
                  </span>
                )}
                {s.status === 'skipped' && (
                  <span className="text-secondary text-sm">Skipped</span>
                )}
                {s.status === 'punted' && (
                  <span className="text-secondary text-sm">Punted</span>
                )}
                {i === idx && s.status === 'pending' && (
                  <span className="routine-step-time">
                    {formatStopwatch(elapsed)}
                  </span>
                )}
                {i !== idx &&
                  s.status === 'pending' &&
                  s.pbAtStartMs != null && (
                    <span className="routine-step-time">
                      {msToMMSS(s.pbAtStartMs)}
                    </span>
                  )}
              </div>
            );
          })}
        </div>

        {longPressStepIndex != null && (
          <div
            className="routine-longpress-menu"
            onClick={(e) => {
              if (e.target === e.currentTarget) setLongPressStepIndex(null);
            }}
          >
            <div className="card">
              <div className="card-title">
                {wip.steps[longPressStepIndex]?.stepName}
              </div>
              <button
                className="btn btn-secondary btn-full mt-16"
                onClick={handleLongPressSkip}
              >
                Skip this step
              </button>
              <button
                className="btn btn-secondary btn-full mt-16"
                onClick={handleLongPressPunt}
              >
                Punt to morning
              </button>
              <button
                className="btn btn-danger btn-full mt-16"
                onClick={() => setLongPressStepIndex(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ===== State 1: No session started =====
  return (
    <div>
      <div className="page-header">
        <button
          type="button"
          className="btn btn-sm btn-secondary mb-8"
          onClick={handleBailout}
          aria-label="Close"
        >
          &times; Close
        </button>
        <h1>Evening Routine</h1>
        {selectedVariant && (
          <p className="subtitle">{selectedVariant.name}</p>
        )}
      </div>

      {showResumeBanner && wip && (
        <div className="banner banner-warning">
          Resuming routine started at {formatClockHHMM(wip.startedAt)}
          <div className="flex gap-8 mt-16">
            <button
              className="btn btn-sm btn-primary"
              onClick={handleContinueResume}
            >
              Continue
            </button>
            <button
              className="btn btn-sm btn-danger"
              onClick={handleDiscardResume}
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {renderVariantChips()}

      <div className="card">
        <div className="card-title">Steps</div>
        {orderedSteps.length === 0 ? (
          <p className="text-secondary text-sm">
            No steps in this variant.{' '}
            <Link to="/settings/evening-routine">Configure in Settings.</Link>
          </p>
        ) : (
          orderedSteps.map((step, i) => {
            const pb = pbs.get(step.id) ?? null;
            return (
              <div key={step.id} className="routine-step-row">
                <span className="routine-step-name">
                  {i + 1}. {step.name}
                </span>
                {pb != null ? (
                  <span className="routine-step-time">{msToMMSS(pb)}</span>
                ) : (
                  <span className="text-secondary text-sm">no best yet</span>
                )}
              </div>
            );
          })
        )}
      </div>

      <button
        className="btn btn-primary btn-full mt-16"
        onClick={handleStart}
        disabled={orderedSteps.length === 0}
      >
        Start Routine
      </button>
    </div>
  );
}
