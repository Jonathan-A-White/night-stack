import type {
  SleepRule,
  NightLog,
  ExternalWeather,
  SleepCondition,
  ConditionClause,
  ConditionClauseKind,
  MiddayCopingItem,
} from '../types';
import { getOvernightLow } from './weather';

export interface RuleEvalContext {
  weather: ExternalWeather | null;
  currentRoomTemp: number | null;
  recentLogs: NightLog[]; // last 7 days
  currentLog: NightLog | null;
  /**
   * Lookup of midday coping items by id. Needed so clause evaluators can
   * translate the IDs stored on a night log into their type (food/drink/
   * exercise/nap). Callers that don't touch midday rules can pass an empty
   * map or omit the field.
   */
  middayCopingItems?: Map<string, MiddayCopingItem>;
}

export interface EvaluatedRule {
  rule: SleepRule;
  triggered: boolean;
}

/**
 * Metadata for each clause kind. Used by the UI to build the structured
 * condition editor and by `formatClause` to render human-readable text.
 *
 * Adding a new clause kind requires:
 *   1. Adding the kind to the `ConditionClause` union in types.ts
 *   2. Adding an entry here
 *   3. Adding a case in `evaluateClause`
 * These three touchpoints are linked by the TypeScript discriminant, so the
 * compiler will flag any missing case.
 */
export interface ClauseMeta {
  kind: ConditionClauseKind;
  label: string;
  /** If true, the clause carries a numeric Fahrenheit threshold. */
  hasThreshold: boolean;
  /** Default threshold for newly-created clauses of this kind. */
  defaultThreshold?: number;
}

export const CLAUSE_KINDS: ClauseMeta[] = [
  { kind: 'always', label: 'Always', hasThreshold: false },
  { kind: 'room_temp_above', label: 'Room temp above', hasThreshold: true, defaultThreshold: 68 },
  { kind: 'external_temp_above', label: 'Overnight low above', hasThreshold: true, defaultThreshold: 50 },
  { kind: 'food_after_cutoff', label: 'Food logged after eating cutoff', hasThreshold: false },
  { kind: 'alcohol_logged', label: 'Alcohol logged', hasThreshold: false },
  { kind: 'peanuts_logged', label: 'Peanuts / PB logged', hasThreshold: false },
  { kind: 'recurrent_night_wakeup', label: 'Recurrent 3 AM wake-ups (3+ of last 7 nights)', hasThreshold: false },
  { kind: 'iron_supplement_day', label: 'Iron supplement day', hasThreshold: false },
  { kind: 'feeling_cold', label: 'Feeling cold at bedtime', hasThreshold: false },
  { kind: 'midday_food_coping', label: 'Midday slump: food used to cope', hasThreshold: false },
  { kind: 'midday_nap_logged', label: 'Midday slump: nap logged', hasThreshold: false },
];

const CLAUSE_META_BY_KIND: Record<ConditionClauseKind, ClauseMeta> = Object.fromEntries(
  CLAUSE_KINDS.map((m) => [m.kind, m])
) as Record<ConditionClauseKind, ClauseMeta>;

export function getClauseMeta(kind: ConditionClauseKind): ClauseMeta {
  return CLAUSE_META_BY_KIND[kind];
}

/** Build a fresh clause with sensible defaults for the given kind. */
export function makeClause(kind: ConditionClauseKind): ConditionClause {
  const meta = CLAUSE_META_BY_KIND[kind];
  if (meta.hasThreshold) {
    return { kind, thresholdF: meta.defaultThreshold ?? 0 } as ConditionClause;
  }
  return { kind } as ConditionClause;
}

/** Format a single clause as human-readable text (e.g. "Room temp > 68°F"). */
export function formatClause(clause: ConditionClause): string {
  switch (clause.kind) {
    case 'always':
      return 'Always';
    case 'room_temp_above':
      return `Room temp > ${clause.thresholdF}°F`;
    case 'external_temp_above':
      return `Overnight low > ${clause.thresholdF}°F`;
    case 'food_after_cutoff':
      return 'Food logged after eating cutoff';
    case 'alcohol_logged':
      return 'Alcohol logged';
    case 'peanuts_logged':
      return 'Peanuts / PB logged';
    case 'recurrent_night_wakeup':
      return 'Recurrent 3 AM wake-ups';
    case 'iron_supplement_day':
      return 'Iron supplement day';
    case 'feeling_cold':
      return 'Feeling cold at bedtime';
    case 'midday_food_coping':
      return 'Midday slump: food used to cope';
    case 'midday_nap_logged':
      return 'Midday slump: nap logged';
  }
}

/** Format a full condition as human-readable text. */
export function formatCondition(condition: SleepCondition): string {
  if (condition.clauses.length === 0) return '';
  const joiner = condition.combinator === 'or' ? ' OR ' : ' AND ';
  return condition.clauses.map(formatClause).join(joiner);
}

export function evaluateRules(
  rules: SleepRule[],
  ctx: RuleEvalContext
): EvaluatedRule[] {
  return rules
    .filter((r) => r.isActive)
    .map((rule) => ({
      rule,
      triggered: evaluateCondition(rule.condition, ctx),
    }))
    .sort((a, b) => {
      const prio = { high: 0, medium: 1, low: 2 };
      return prio[a.rule.priority] - prio[b.rule.priority];
    });
}

export function evaluateCondition(
  condition: SleepCondition,
  ctx: RuleEvalContext
): boolean {
  if (condition.clauses.length === 0) return false;
  if (condition.combinator === 'or') {
    return condition.clauses.some((c) => evaluateClause(c, ctx));
  }
  return condition.clauses.every((c) => evaluateClause(c, ctx));
}

function evaluateClause(clause: ConditionClause, ctx: RuleEvalContext): boolean {
  switch (clause.kind) {
    case 'always':
      return true;

    case 'room_temp_above':
      return ctx.currentRoomTemp !== null && ctx.currentRoomTemp > clause.thresholdF;

    case 'external_temp_above': {
      const low = ctx.weather ? getOvernightLow(ctx.weather) : null;
      return low !== null && low > clause.thresholdF;
    }

    case 'food_after_cutoff': {
      if (!ctx.currentLog) return false;
      const { lastMealTime } = ctx.currentLog.eveningIntake;
      const { eatingCutoff } = ctx.currentLog.alarm;
      if (!lastMealTime || !eatingCutoff) return false;
      return lastMealTime > eatingCutoff;
    }

    case 'alcohol_logged':
      if (!ctx.currentLog) return false;
      return ctx.currentLog.eveningIntake.alcohol !== null;

    case 'peanuts_logged': {
      if (!ctx.currentLog) return false;
      const food = ctx.currentLog.eveningIntake.foodDescription.toLowerCase();
      return food.includes('peanut') || food.includes('pb');
    }

    case 'recurrent_night_wakeup': {
      const nightsWithEarlyWake = ctx.recentLogs.filter((log) =>
        log.wakeUpEvents.some((e) => {
          const [h] = e.startTime.split(':').map(Number);
          return h >= 2 && h <= 4;
        })
      );
      return nightsWithEarlyWake.length >= 3;
    }

    case 'iron_supplement_day':
      // The supplement step itself handles iron-day logic; the rule exists to
      // surface the spacing reminder on days iron is scheduled.
      return true;

    case 'feeling_cold':
      // User-triggered advice — always surfaced so it's visible as guidance.
      return true;

    case 'midday_food_coping': {
      if (!ctx.currentLog || !ctx.middayCopingItems) return false;
      const { hadStruggle, copingItemIds } = ctx.currentLog.middayStruggle;
      if (!hadStruggle) return false;
      return copingItemIds.some((id) => ctx.middayCopingItems!.get(id)?.type === 'food');
    }

    case 'midday_nap_logged': {
      if (!ctx.currentLog || !ctx.middayCopingItems) return false;
      const { hadStruggle, copingItemIds } = ctx.currentLog.middayStruggle;
      if (!hadStruggle) return false;
      return copingItemIds.some((id) => ctx.middayCopingItems!.get(id)?.type === 'nap');
    }
  }
}

/**
 * Best-effort parse of the legacy free-form condition string format into the
 * new structured AST. Used exclusively by the Dexie v4 migration for data
 * created under the old schema. New rules are always stored structured.
 *
 * Unrecognized strings become `{ combinator: 'and', clauses: [{ kind: 'always' }] }`,
 * matching the old evaluator's fallback behavior (default true) so migration
 * doesn't silently disable previously-firing rules.
 */
export function parseConditionString(raw: string): SleepCondition {
  const cond = raw.toLowerCase().trim();
  const always: SleepCondition = { combinator: 'and', clauses: [{ kind: 'always' }] };

  if (cond === '' || cond === 'always') return always;

  // Room temp rule, optionally OR'd with an external temp clause
  if (cond.includes('room temp >')) {
    const roomMatch = cond.match(/room temp > (\d+)/);
    if (roomMatch) {
      const roomThreshold = parseInt(roomMatch[1], 10);
      const clauses: ConditionClause[] = [
        { kind: 'room_temp_above', thresholdF: roomThreshold },
      ];
      if (cond.includes(' or ')) {
        const extMatch = cond.match(/external temp > (\d+)/);
        const extThreshold = extMatch ? parseInt(extMatch[1], 10) : 50;
        clauses.push({ kind: 'external_temp_above', thresholdF: extThreshold });
        return { combinator: 'or', clauses };
      }
      return { combinator: 'and', clauses };
    }
  }

  if (cond.includes('food logged after eating cutoff')) {
    return { combinator: 'and', clauses: [{ kind: 'food_after_cutoff' }] };
  }

  if (cond.includes('alcohol logged')) {
    return { combinator: 'and', clauses: [{ kind: 'alcohol_logged' }] };
  }

  if (cond.includes('peanuts') || cond.includes('pb flagged')) {
    return { combinator: 'and', clauses: [{ kind: 'peanuts_logged' }] };
  }

  if (cond.includes('recurrent') && cond.includes('wake-up')) {
    return { combinator: 'and', clauses: [{ kind: 'recurrent_night_wakeup' }] };
  }

  if (cond.includes('iron supplement days')) {
    return { combinator: 'and', clauses: [{ kind: 'iron_supplement_day' }] };
  }

  if (cond.includes('feeling cold')) {
    return { combinator: 'and', clauses: [{ kind: 'feeling_cold' }] };
  }

  return always;
}
