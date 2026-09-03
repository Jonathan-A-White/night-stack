import type { UnitSystem } from '../types';
import { NeckStepper } from './NeckStepper';

interface NeckFieldProps {
  valueIn: number | null;
  onChange: (v: number | null) => void;
  unitSystem: UnitSystem;
  /** Seed when the user opts in: last recorded neck, else 15.0 in. */
  defaultIn: number | null;
}

/**
 * Optional neck-circumference entry for the evening and morning logs.
 * Skipped by default (no row written); one tap opts in with the last
 * value pre-filled.
 */
export function NeckField({ valueIn, onChange, unitSystem, defaultIn }: NeckFieldProps) {
  if (valueIn == null) {
    return (
      <button
        type="button"
        className="btn btn-secondary btn-full mb-8"
        onClick={() => onChange(defaultIn ?? 15)}
      >
        Add neck circumference
      </button>
    );
  }
  return (
    <div className="mb-8">
      <NeckStepper valueIn={valueIn} onChange={onChange} unitSystem={unitSystem} label="Neck circumference" />
      <button type="button" className="btn btn-secondary btn-full mt-8" onClick={() => onChange(null)}>
        Skip neck
      </button>
    </div>
  );
}
