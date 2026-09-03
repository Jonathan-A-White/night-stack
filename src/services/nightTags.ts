import type {
  ElectrolyteDose,
  EveningFlag,
  NightLog,
  ProvenanceSource,
  SleepPosition,
  SodiumLevel,
} from '../types';

/**
 * Night tags (specs/home-experiments/night-tags.md): pure helpers behind
 * the evening and morning tag steps, the sodium chip, and the ThermalFit
 * intake filters. Kept out of the 1400-line wizards so they are testable.
 */

export const SODIUM_LEVEL_OPTIONS: { value: SodiumLevel; label: string; hint: string }[] = [
  { value: 'normal', label: 'Normal', hint: 'Usual day' },
  { value: 'more', label: 'More than usual', hint: 'A salty meal or snack' },
  { value: 'much_more', label: 'Much more', hint: 'Clearly heavy sodium day' },
];

const LEVEL_LABEL: Record<SodiumLevel, string> = {
  normal: 'Normal salt',
  more: 'More salt',
  much_more: 'Much more salt',
};

export function sodiumLevelLabel(level: SodiumLevel, source: ProvenanceSource): string {
  return source === 'proxy' ? `${LEVEL_LABEL[level]} (inferred)` : LEVEL_LABEL[level];
}

export const ELECTROLYTE_DOSE_OPTIONS: { value: ElectrolyteDose; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'half', label: 'Half' },
  { value: 'full', label: 'Full' },
];

export const POSITION_OPTIONS: { value: Exclude<SleepPosition, 'unknown'>; label: string }[] = [
  { value: 'side', label: 'Side' },
  { value: 'back', label: 'Back' },
];

/** Most-used sodium sources across recent nights, for the chip row. */
export function rankSodiumSourceChips(logs: readonly Pick<NightLog, 'eveningIntake'>[], limit = 8): string[] {
  const counts = new Map<string, { label: string; n: number }>();
  for (const log of logs) {
    for (const raw of log.eveningIntake.sodiumSources ?? []) {
      const label = raw.trim();
      if (!label) continue;
      const key = label.toLowerCase();
      const cur = counts.get(key);
      if (cur) cur.n += 1;
      else counts.set(key, { label, n: 1 });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map((c) => c.label);
}

export type IntakeKey = EveningFlag['type'] | 'alcohol' | 'sodium_more' | 'sodium_much_more';

/** ThermalFit intake predicate; the sodium keys replace the old high_salt flag. */
export function intakeMatches(log: NightLog, key: IntakeKey): boolean {
  if (key === 'alcohol') return log.eveningIntake.alcohol !== null;
  if (key === 'sodium_more') return log.eveningIntake.sodiumLevel !== 'normal';
  if (key === 'sodium_much_more') return log.eveningIntake.sodiumLevel === 'much_more';
  return log.eveningIntake.flags.some((f) => f.type === key && f.active);
}

function cleanSources(sources: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of sources) {
    const s = raw.trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

export interface EveningTagsInput {
  existing: Pick<NightLog['eveningIntake'], 'sodiumLevel' | 'sodiumLevelSource' | 'sodiumSources'> | null;
  sodiumLevel: SodiumLevel;
  /** True once the user tapped the sodium control this session. */
  sodiumTouched: boolean;
  sodiumSources: readonly string[];
  electrolyteDose: ElectrolyteDose | null;
  positionStarted: Exclude<SleepPosition, 'unknown'> | null;
}

/**
 * Sodium provenance rule: an untouched picker on a proxy-labelled night
 * keeps 'proxy'; any tap stamps 'user'; a new night is 'user'.
 */
export function buildEveningTagsForSave(input: EveningTagsInput): {
  eveningIntake: Pick<NightLog['eveningIntake'], 'sodiumLevel' | 'sodiumLevelSource' | 'sodiumSources'>;
  electrolyteDose: ElectrolyteDose | null;
  positionStarted: SleepPosition;
} {
  const source: ProvenanceSource =
    input.sodiumTouched || !input.existing ? 'user' : input.existing.sodiumLevelSource;
  return {
    eveningIntake: {
      sodiumLevel: input.sodiumLevel,
      sodiumLevelSource: source,
      sodiumSources: cleanSources(input.sodiumSources),
    },
    electrolyteDose: input.electrolyteDose,
    positionStarted: input.positionStarted ?? 'unknown',
  };
}

export function buildMorningTagsForSave(input: {
  positionAtWake: Exclude<SleepPosition, 'unknown'> | null;
  wiredWake: boolean;
}): { positionAtWake: SleepPosition; wiredWake: boolean } {
  return { positionAtWake: input.positionAtWake ?? 'unknown', wiredWake: input.wiredWake };
}
