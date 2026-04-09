import { useCallback, useEffect, useRef } from 'react';
import type { UnitSystem } from '../types';
import { formatWeight, getWeightStepLbs, roundWeightLbs } from '../weightUtils';

interface WeightStepperProps {
  valueLbs: number;
  onChange: (nextLbs: number) => void;
  unitSystem: UnitSystem;
  label?: string;
  helpText?: string;
}

// Long-press acceleration profile (ms between repeats).
// Starts slow, ramps to fast repeats for bigger jumps.
const PRESS_INITIAL_DELAY_MS = 350;
const PRESS_MIN_INTERVAL_MS = 30;
const PRESS_RAMP_FACTOR = 0.85;
// After this many fast repeats, multiply the step size to move even faster.
const TURBO_AFTER_REPEATS = 20;
const TURBO_STEP_MULTIPLIER = 5;

export function WeightStepper({
  valueLbs,
  onChange,
  unitSystem,
  label,
  helpText,
}: WeightStepperProps) {
  const valueRef = useRef(valueLbs);
  valueRef.current = valueLbs;

  const timerRef = useRef<number | null>(null);
  const repeatCountRef = useRef(0);
  const intervalRef = useRef(PRESS_INITIAL_DELAY_MS);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    repeatCountRef.current = 0;
    intervalRef.current = PRESS_INITIAL_DELAY_MS;
  }, []);

  useEffect(() => {
    return () => clearTimer();
  }, [clearTimer]);

  const applyStep = useCallback(
    (direction: 1 | -1) => {
      const base = getWeightStepLbs(unitSystem);
      const turbo = repeatCountRef.current >= TURBO_AFTER_REPEATS;
      const step = base * (turbo ? TURBO_STEP_MULTIPLIER : 1);
      const next = roundWeightLbs(valueRef.current + direction * step, unitSystem);
      onChange(next);
    },
    [unitSystem, onChange],
  );

  const startPress = useCallback(
    (direction: 1 | -1) => {
      clearTimer();
      // Immediate single step on press.
      applyStep(direction);

      const tick = () => {
        applyStep(direction);
        repeatCountRef.current += 1;
        intervalRef.current = Math.max(
          PRESS_MIN_INTERVAL_MS,
          intervalRef.current * PRESS_RAMP_FACTOR,
        );
        timerRef.current = window.setTimeout(tick, intervalRef.current);
      };

      timerRef.current = window.setTimeout(tick, PRESS_INITIAL_DELAY_MS);
    },
    [applyStep, clearTimer],
  );

  const endPress = useCallback(() => {
    clearTimer();
  }, [clearTimer]);

  const handlePointerDown = (direction: 1 | -1) => (e: React.PointerEvent<HTMLButtonElement>) => {
    // Capture so pointerup outside the button still fires.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    startPress(direction);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    endPress();
  };

  return (
    <div className="weight-stepper">
      {label && <div className="form-label">{label}</div>}
      <div className="weight-stepper-row">
        <button
          type="button"
          className="btn btn-secondary weight-stepper-btn"
          aria-label="Decrease weight"
          onPointerDown={handlePointerDown(-1)}
          onPointerUp={handlePointerUp}
          onPointerCancel={endPress}
          onPointerLeave={endPress}
          onContextMenu={(e) => e.preventDefault()}
        >
          &minus;
        </button>

        <div className="weight-stepper-value">
          {formatWeight(valueLbs, unitSystem)}
        </div>

        <button
          type="button"
          className="btn btn-secondary weight-stepper-btn"
          aria-label="Increase weight"
          onPointerDown={handlePointerDown(1)}
          onPointerUp={handlePointerUp}
          onPointerCancel={endPress}
          onPointerLeave={endPress}
          onContextMenu={(e) => e.preventDefault()}
        >
          +
        </button>
      </div>
      {helpText && (
        <div className="text-secondary text-sm mt-8" style={{ textAlign: 'center' }}>
          {helpText}
        </div>
      )}
    </div>
  );
}
