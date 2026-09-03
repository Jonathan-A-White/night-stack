import type { UnitSystem } from '../types';
import { formatNeck, getNeckStepIn, roundMeasurement } from '../services/bodyMeasurements';
import { ValueStepper } from './ValueStepper';

interface NeckStepperProps {
  valueIn: number;
  onChange: (nextIn: number) => void;
  unitSystem: UnitSystem;
  label?: string;
  helpText?: string;
}

/** Neck circumference stepper: canonical inches, 0.1 in / 0.25 cm steps. */
export function NeckStepper({ valueIn, onChange, unitSystem, label, helpText }: NeckStepperProps) {
  return (
    <ValueStepper
      value={valueIn}
      onChange={onChange}
      step={getNeckStepIn(unitSystem)}
      round={(v) => roundMeasurement('neck', v)}
      format={(v) => formatNeck(v, unitSystem)}
      decreaseLabel="Decrease neck circumference"
      increaseLabel="Increase neck circumference"
      label={label}
      helpText={helpText}
    />
  );
}
