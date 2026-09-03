import type { UnitSystem } from '../types';
import { formatWeight, getWeightStepLbs, roundWeightLbs } from '../weightUtils';
import { ValueStepper } from './ValueStepper';

interface WeightStepperProps {
  valueLbs: number;
  onChange: (nextLbs: number) => void;
  unitSystem: UnitSystem;
  label?: string;
  helpText?: string;
}

export function WeightStepper({ valueLbs, onChange, unitSystem, label, helpText }: WeightStepperProps) {
  return (
    <ValueStepper
      value={valueLbs}
      onChange={onChange}
      step={getWeightStepLbs(unitSystem)}
      round={(v) => roundWeightLbs(v, unitSystem)}
      format={(v) => formatWeight(v, unitSystem)}
      decreaseLabel="Decrease weight"
      increaseLabel="Increase weight"
      label={label}
      helpText={helpText}
    />
  );
}
