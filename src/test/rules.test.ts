import { describe, it, expect } from 'vitest';
import {
  evaluateRules,
  formatCondition,
  parseConditionString,
  type RuleEvalContext,
} from '../services/rules';
import type {
  SleepRule,
  NightLog,
  ExternalWeather,
  SleepCondition,
} from '../types';

function makeRule(overrides: Partial<SleepRule> = {}): SleepRule {
  return {
    id: crypto.randomUUID(),
    name: 'Test Rule',
    condition: { combinator: 'and', clauses: [{ kind: 'always' }] },
    recommendation: 'Do something',
    priority: 'medium',
    isActive: true,
    source: 'seeded',
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeContext(overrides: Partial<RuleEvalContext> = {}): RuleEvalContext {
  return {
    weather: null,
    currentRoomTemp: null,
    recentLogs: [],
    currentLog: null,
    ...overrides,
  };
}

const ROOM_OR_EXT: SleepCondition = {
  combinator: 'or',
  clauses: [
    { kind: 'room_temp_above', thresholdF: 68 },
    { kind: 'external_temp_above', thresholdF: 50 },
  ],
};

describe('evaluateRules', () => {
  it('triggers "Always" rules', () => {
    const rules = [makeRule()];
    const result = evaluateRules(rules, makeContext());
    expect(result).toHaveLength(1);
    expect(result[0].triggered).toBe(true);
  });

  it('skips inactive rules', () => {
    const rules = [makeRule({ isActive: false })];
    const result = evaluateRules(rules, makeContext());
    expect(result).toHaveLength(0);
  });

  it('sorts by priority: high > medium > low', () => {
    const rules = [
      makeRule({ priority: 'low', name: 'Low' }),
      makeRule({ priority: 'high', name: 'High' }),
      makeRule({ priority: 'medium', name: 'Med' }),
    ];
    const result = evaluateRules(rules, makeContext());
    expect(result[0].rule.name).toBe('High');
    expect(result[1].rule.name).toBe('Med');
    expect(result[2].rule.name).toBe('Low');
  });

  it('triggers room temp rule when temp exceeds threshold', () => {
    const rules = [makeRule({ condition: ROOM_OR_EXT })];
    const result = evaluateRules(rules, makeContext({ currentRoomTemp: 72 }));
    expect(result[0].triggered).toBe(true);
  });

  it('does not trigger room temp rule when below threshold', () => {
    const rules = [makeRule({ condition: ROOM_OR_EXT })];
    const result = evaluateRules(rules, makeContext({ currentRoomTemp: 65 }));
    expect(result[0].triggered).toBe(false);
  });

  it('triggers room temp rule on external temp', () => {
    const weather: ExternalWeather = {
      overnightTemps: [{ hour: '2026-04-06T22:00', value: 55 }],
      overnightHumidity: [],
      fetchedAt: Date.now(),
    };
    const rules = [makeRule({ condition: ROOM_OR_EXT })];
    const result = evaluateRules(rules, makeContext({ weather }));
    expect(result[0].triggered).toBe(true);
  });

  it('respects an edited room temp threshold', () => {
    const cond: SleepCondition = {
      combinator: 'and',
      clauses: [{ kind: 'room_temp_above', thresholdF: 72 }],
    };
    const rules = [makeRule({ condition: cond })];
    // 70 is above the old default (68) but below the edited threshold (72)
    const below = evaluateRules(rules, makeContext({ currentRoomTemp: 70 }));
    expect(below[0].triggered).toBe(false);
    const above = evaluateRules(rules, makeContext({ currentRoomTemp: 73 }));
    expect(above[0].triggered).toBe(true);
  });

  it('AND combinator requires every clause to match', () => {
    const cond: SleepCondition = {
      combinator: 'and',
      clauses: [
        { kind: 'room_temp_above', thresholdF: 68 },
        { kind: 'external_temp_above', thresholdF: 50 },
      ],
    };
    const weather: ExternalWeather = {
      overnightTemps: [{ hour: '2026-04-06T22:00', value: 55 }],
      overnightHumidity: [],
      fetchedAt: Date.now(),
    };
    const rules = [makeRule({ condition: cond })];
    // Only external matches → AND is false
    expect(
      evaluateRules(rules, makeContext({ weather }))[0].triggered
    ).toBe(false);
    // Both match → AND is true
    expect(
      evaluateRules(rules, makeContext({ weather, currentRoomTemp: 72 }))[0].triggered
    ).toBe(true);
  });

  it('empty clause list is never triggered', () => {
    const rules = [makeRule({ condition: { combinator: 'and', clauses: [] } })];
    const result = evaluateRules(rules, makeContext());
    expect(result[0].triggered).toBe(false);
  });

  it('triggers alcohol rule when alcohol is logged', () => {
    const rules = [makeRule({
      condition: { combinator: 'and', clauses: [{ kind: 'alcohol_logged' }] },
    })];
    const log = {
      eveningIntake: { alcohol: { type: 'wine', amount: '4oz', time: '19:00' } },
    } as unknown as NightLog;
    const result = evaluateRules(rules, makeContext({ currentLog: log }));
    expect(result[0].triggered).toBe(true);
  });

  it('does not trigger alcohol rule when no alcohol', () => {
    const rules = [makeRule({
      condition: { combinator: 'and', clauses: [{ kind: 'alcohol_logged' }] },
    })];
    const log = {
      eveningIntake: { alcohol: null },
    } as unknown as NightLog;
    const result = evaluateRules(rules, makeContext({ currentLog: log }));
    expect(result[0].triggered).toBe(false);
  });
});

describe('formatCondition', () => {
  it('formats a single "always" clause', () => {
    expect(formatCondition({ combinator: 'and', clauses: [{ kind: 'always' }] })).toBe('Always');
  });

  it('formats a room temp clause with threshold', () => {
    expect(
      formatCondition({
        combinator: 'and',
        clauses: [{ kind: 'room_temp_above', thresholdF: 70 }],
      })
    ).toBe('Room temp > 70°F');
  });

  it('joins OR clauses with OR', () => {
    expect(formatCondition(ROOM_OR_EXT)).toBe('Room temp > 68°F OR Overnight low > 50°F');
  });

  it('joins AND clauses with AND', () => {
    expect(
      formatCondition({
        combinator: 'and',
        clauses: [
          { kind: 'room_temp_above', thresholdF: 68 },
          { kind: 'alcohol_logged' },
        ],
      })
    ).toBe('Room temp > 68°F AND Alcohol logged');
  });
});

describe('parseConditionString (legacy migration)', () => {
  it('parses "Always"', () => {
    expect(parseConditionString('Always')).toEqual({
      combinator: 'and',
      clauses: [{ kind: 'always' }],
    });
  });

  it('parses the light-covers OR rule', () => {
    expect(parseConditionString('Room temp > 68°F OR external temp > 50°F')).toEqual({
      combinator: 'or',
      clauses: [
        { kind: 'room_temp_above', thresholdF: 68 },
        { kind: 'external_temp_above', thresholdF: 50 },
      ],
    });
  });

  it('parses a bare room temp condition', () => {
    expect(parseConditionString('Room temp > 72')).toEqual({
      combinator: 'and',
      clauses: [{ kind: 'room_temp_above', thresholdF: 72 }],
    });
  });

  it('parses the alcohol condition', () => {
    expect(parseConditionString('Alcohol logged in evening intake')).toEqual({
      combinator: 'and',
      clauses: [{ kind: 'alcohol_logged' }],
    });
  });

  it('falls back to Always for unrecognized text', () => {
    expect(parseConditionString('something the engine never knew about')).toEqual({
      combinator: 'and',
      clauses: [{ kind: 'always' }],
    });
  });
});
