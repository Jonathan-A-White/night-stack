import { describe, it, expect } from 'vitest';
import { CLAUSE_KINDS, evaluateCondition, formatClause, type RuleEvalContext } from '../services/rules';
import { createBlankNightLog } from '../utils';
import type { NightLog, OrthostaticReading, SodiumLevel, SleepPosition } from '../types';

const ALARM = { expectedAlarmTime: '', actualAlarmTime: '', isOverridden: false, targetBedtime: '', eatingCutoff: '', supplementTime: '' };

function log(sodium: SodiumLevel, position: SleepPosition): NightLog {
  const l = createBlankNightLog('2026-09-03', ALARM);
  l.eveningIntake.sodiumLevel = sodium;
  l.positionStarted = position;
  return l;
}

function ctx(overrides: Partial<RuleEvalContext> = {}): RuleEvalContext {
  return { weather: null, currentRoomTemp: null, recentLogs: [], currentLog: null, ...overrides };
}

const SALT = { combinator: 'and' as const, clauses: [{ kind: 'high_salt_and_supine' as const }] };
const ORTHO = { combinator: 'and' as const, clauses: [{ kind: 'orthostatic_flag_today' as const }] };

function reading(standing3: { systolic: number; diastolic: number; pulse: number }): OrthostaticReading {
  return { id: 'r', date: '2026-09-03', slot: 'am', timestamp: 1, source: 'cuff', supine: { systolic: 120, diastolic: 78, pulse: 60 }, standing1: null, standing3, notes: '', createdAt: 1 };
}

describe('high_salt_and_supine', () => {
  it('fires on sodium alone when position is unknown', () => {
    expect(evaluateCondition(SALT, ctx({ currentLog: log('more', 'unknown') }))).toBe(true);
  });
  it('fires when supine', () => {
    expect(evaluateCondition(SALT, ctx({ currentLog: log('much_more', 'back') }))).toBe(true);
  });
  it('side sleep suppresses it', () => {
    expect(evaluateCondition(SALT, ctx({ currentLog: log('more', 'side') }))).toBe(false);
  });
  it('normal sodium suppresses it', () => {
    expect(evaluateCondition(SALT, ctx({ currentLog: log('normal', 'back') }))).toBe(false);
  });
  it('no current log → false', () => {
    expect(evaluateCondition(SALT, ctx())).toBe(false);
  });
});

describe('orthostatic_flag_today', () => {
  it('true when any reading today carries a flag', () => {
    expect(evaluateCondition(ORTHO, ctx({ todayOrthostatic: [reading({ systolic: 98, diastolic: 70, pulse: 70 })] }))).toBe(true);
  });
  it('false with unflagged readings, none, or undefined', () => {
    expect(evaluateCondition(ORTHO, ctx({ todayOrthostatic: [reading({ systolic: 116, diastolic: 76, pulse: 70 })] }))).toBe(false);
    expect(evaluateCondition(ORTHO, ctx({ todayOrthostatic: [] }))).toBe(false);
    expect(evaluateCondition(ORTHO, ctx())).toBe(false);
  });
});

describe('editor metadata', () => {
  it('offers both kinds with labels and formats them', () => {
    const kinds = CLAUSE_KINDS.map((k) => k.kind);
    expect(kinds).toContain('high_salt_and_supine');
    expect(kinds).toContain('orthostatic_flag_today');
    expect(formatClause({ kind: 'high_salt_and_supine' })).toBe('Salt above normal and not side-sleeping');
    expect(formatClause({ kind: 'orthostatic_flag_today' })).toBe('Orthostatic flag today');
  });
});
