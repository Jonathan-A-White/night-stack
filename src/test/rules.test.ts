import { describe, it, expect } from 'vitest';
import { evaluateRules, type RuleEvalContext } from '../services/rules';
import type { SleepRule, NightLog, ExternalWeather } from '../types';

function makeRule(overrides: Partial<SleepRule> = {}): SleepRule {
  return {
    id: crypto.randomUUID(),
    name: 'Test Rule',
    condition: 'Always',
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

describe('evaluateRules', () => {
  it('triggers "Always" rules', () => {
    const rules = [makeRule({ condition: 'Always' })];
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
    const rules = [makeRule({ condition: 'Room temp > 68°F OR external temp > 50°F' })];
    const result = evaluateRules(rules, makeContext({ currentRoomTemp: 72 }));
    expect(result[0].triggered).toBe(true);
  });

  it('does not trigger room temp rule when below threshold', () => {
    const rules = [makeRule({ condition: 'Room temp > 68°F OR external temp > 50°F' })];
    const result = evaluateRules(rules, makeContext({ currentRoomTemp: 65 }));
    expect(result[0].triggered).toBe(false);
  });

  it('triggers room temp rule on external temp', () => {
    const weather: ExternalWeather = {
      overnightTemps: [{ hour: '2026-04-06T22:00', value: 55 }],
      overnightHumidity: [],
      fetchedAt: Date.now(),
    };
    const rules = [makeRule({ condition: 'Room temp > 68°F OR external temp > 50°F' })];
    const result = evaluateRules(rules, makeContext({ weather }));
    expect(result[0].triggered).toBe(true);
  });

  it('triggers alcohol rule when alcohol is logged', () => {
    const rules = [makeRule({ condition: 'Alcohol logged in evening intake' })];
    const log = {
      eveningIntake: { alcohol: { type: 'wine', amount: '4oz', time: '19:00' } },
    } as unknown as NightLog;
    const result = evaluateRules(rules, makeContext({ currentLog: log }));
    expect(result[0].triggered).toBe(true);
  });

  it('does not trigger alcohol rule when no alcohol', () => {
    const rules = [makeRule({ condition: 'Alcohol logged in evening intake' })];
    const log = {
      eveningIntake: { alcohol: null },
    } as unknown as NightLog;
    const result = evaluateRules(rules, makeContext({ currentLog: log }));
    expect(result[0].triggered).toBe(false);
  });
});
