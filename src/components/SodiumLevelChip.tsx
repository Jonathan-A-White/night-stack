import type { NightLog } from '../types';
import { sodiumLevelLabel } from '../services/nightTags';

/** Compact label for a night's sodium level, mirroring ThermalComfortChip. */
export function SodiumLevelChip({ log }: { log: Pick<NightLog, 'eveningIntake'> }) {
  const { sodiumLevel, sodiumLevelSource } = log.eveningIntake;
  const tone = sodiumLevel === 'normal' ? 'text-secondary' : 'text-warning';
  return <span className={`text-sm ${tone}`}>{sodiumLevelLabel(sodiumLevel, sodiumLevelSource)}</span>;
}
