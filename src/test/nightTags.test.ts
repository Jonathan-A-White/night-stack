import { describe, it, expect } from 'vitest';
import {
  sodiumLevelLabel,
  rankSodiumSourceChips,
  intakeMatches,
  buildEveningTagsForSave,
  buildMorningTagsForSave,
  SODIUM_LEVEL_OPTIONS,
} from '../services/nightTags';
import { createBlankNightLog } from '../utils';
import type { NightLog } from '../types';

const ALARM = { expectedAlarmTime: '', actualAlarmTime: '', isOverridden: false, targetBedtime: '', eatingCutoff: '', supplementTime: '' };

function night(date: string, sources: string[] = [], level: NightLog['eveningIntake']['sodiumLevel'] = 'normal'): NightLog {
  const log = createBlankNightLog(date, ALARM);
  log.eveningIntake.sodiumSources = sources;
  log.eveningIntake.sodiumLevel = level;
  return log;
}

describe('sodiumLevelLabel', () => {
  it('labels each level and marks proxy rows as inferred', () => {
    expect(sodiumLevelLabel('normal', 'user')).toBe('Normal salt');
    expect(sodiumLevelLabel('more', 'user')).toBe('More salt');
    expect(sodiumLevelLabel('much_more', 'user')).toBe('Much more salt');
    expect(sodiumLevelLabel('more', 'proxy')).toBe('More salt (inferred)');
  });
  it('offers the three levels in order', () => {
    expect(SODIUM_LEVEL_OPTIONS.map((o) => o.value)).toEqual(['normal', 'more', 'much_more']);
  });
});

describe('rankSodiumSourceChips', () => {
  it('orders chips by frequency, most frequent first, deduped and case-insensitive', () => {
    const logs = [
      night('2026-09-01', ['pretzels', 'soy sauce']),
      night('2026-09-02', ['Pretzels']),
      night('2026-09-03', ['pretzels', 'ramen']),
    ];
    expect(rankSodiumSourceChips(logs)).toEqual(['pretzels', 'ramen', 'soy sauce']);
  });
  it('caps the list', () => {
    const logs = Array.from({ length: 20 }, (_, i) => night(`2026-08-${String(i + 1).padStart(2, '0')}`, [`s${i}`]));
    expect(rankSodiumSourceChips(logs, 8)).toHaveLength(8);
  });
});

describe('intakeMatches (ThermalFit predicate)', () => {
  it('sodium_more matches more and much_more; sodium_much_more only the latter', () => {
    const n = night('2026-09-01', [], 'normal');
    const m = night('2026-09-02', [], 'more');
    const mm = night('2026-09-03', [], 'much_more');
    expect([n, m, mm].filter((l) => intakeMatches(l, 'sodium_more')).map((l) => l.date)).toEqual(['2026-09-02', '2026-09-03']);
    expect([n, m, mm].filter((l) => intakeMatches(l, 'sodium_much_more')).map((l) => l.date)).toEqual(['2026-09-03']);
  });
  it('still matches flags and alcohol', () => {
    const l = night('2026-09-01');
    l.eveningIntake.flags[0].active = true; // overate
    l.eveningIntake.alcohol = { type: 'wine', amount: '4oz', time: '19:00' };
    expect(intakeMatches(l, 'overate')).toBe(true);
    expect(intakeMatches(l, 'late_meal')).toBe(false);
    expect(intakeMatches(l, 'alcohol')).toBe(true);
  });
});

describe('buildEveningTagsForSave', () => {
  const existingProxy = { sodiumLevel: 'more' as const, sodiumLevelSource: 'proxy' as const, sodiumSources: [] as string[] };

  it('untouched picker on a proxy night keeps proxy provenance', () => {
    const out = buildEveningTagsForSave({
      existing: existingProxy,
      sodiumLevel: 'more',
      sodiumTouched: false,
      sodiumSources: ['pretzels'],
      electrolyteDose: 'half',
      positionStarted: 'back',
    });
    expect(out.eveningIntake.sodiumLevel).toBe('more');
    expect(out.eveningIntake.sodiumLevelSource).toBe('proxy');
    expect(out.eveningIntake.sodiumSources).toEqual(['pretzels']);
    expect(out.electrolyteDose).toBe('half');
    expect(out.positionStarted).toBe('back');
  });

  it('touching the picker stamps user provenance', () => {
    const out = buildEveningTagsForSave({
      existing: existingProxy,
      sodiumLevel: 'much_more',
      sodiumTouched: true,
      sodiumSources: [],
      electrolyteDose: null,
      positionStarted: null,
    });
    expect(out.eveningIntake.sodiumLevel).toBe('much_more');
    expect(out.eveningIntake.sodiumLevelSource).toBe('user');
    expect(out.electrolyteDose).toBeNull();
    expect(out.positionStarted).toBe('unknown');
  });

  it('a brand-new night defaults to normal with user provenance', () => {
    const out = buildEveningTagsForSave({
      existing: null,
      sodiumLevel: 'normal',
      sodiumTouched: false,
      sodiumSources: [],
      electrolyteDose: null,
      positionStarted: null,
    });
    expect(out.eveningIntake).toEqual({ sodiumLevel: 'normal', sodiumLevelSource: 'user', sodiumSources: [] });
  });

  it('trims, dedupes and drops blank sources', () => {
    const out = buildEveningTagsForSave({
      existing: null,
      sodiumLevel: 'normal',
      sodiumTouched: false,
      sodiumSources: [' ramen ', 'ramen', '', 'Soy sauce'],
      electrolyteDose: null,
      positionStarted: null,
    });
    expect(out.eveningIntake.sodiumSources).toEqual(['ramen', 'Soy sauce']);
  });
});

describe('buildMorningTagsForSave', () => {
  it('maps position and wired', () => {
    expect(buildMorningTagsForSave({ positionAtWake: 'side', wiredWake: true })).toEqual({ positionAtWake: 'side', wiredWake: true });
    expect(buildMorningTagsForSave({ positionAtWake: null, wiredWake: false })).toEqual({ positionAtWake: 'unknown', wiredWake: false });
  });
});
