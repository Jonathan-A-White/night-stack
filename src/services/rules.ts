import type { SleepRule, NightLog, ExternalWeather } from '../types';
import { getOvernightLow } from './weather';

export interface RuleEvalContext {
  weather: ExternalWeather | null;
  currentRoomTemp: number | null;
  recentLogs: NightLog[]; // last 7 days
  currentLog: NightLog | null;
}

export interface EvaluatedRule {
  rule: SleepRule;
  triggered: boolean;
}

export function evaluateRules(
  rules: SleepRule[],
  ctx: RuleEvalContext
): EvaluatedRule[] {
  return rules
    .filter((r) => r.isActive)
    .map((rule) => ({
      rule,
      triggered: evaluateCondition(rule, ctx),
    }))
    .sort((a, b) => {
      const prio = { high: 0, medium: 1, low: 2 };
      return prio[a.rule.priority] - prio[b.rule.priority];
    });
}

function evaluateCondition(rule: SleepRule, ctx: RuleEvalContext): boolean {
  const cond = rule.condition.toLowerCase();

  // "Always" rules
  if (cond === 'always') return true;

  // Room temp rules
  if (cond.includes('room temp >')) {
    const match = cond.match(/room temp > (\d+)/);
    if (match) {
      const threshold = parseInt(match[1], 10);
      const roomTemp = ctx.currentRoomTemp;
      const externalTemp = ctx.weather ? getOvernightLow(ctx.weather) : null;

      if (cond.includes(' or ')) {
        // "Room temp > 68°F OR external temp > 50°F"
        const extMatch = cond.match(/external temp > (\d+)/);
        const extThreshold = extMatch ? parseInt(extMatch[1], 10) : 50;
        return (roomTemp !== null && roomTemp > threshold) ||
               (externalTemp !== null && externalTemp > extThreshold);
      }
      return roomTemp !== null && roomTemp > threshold;
    }
  }

  // Food logged after eating cutoff
  if (cond.includes('food logged after eating cutoff')) {
    if (!ctx.currentLog) return false;
    const { lastMealTime } = ctx.currentLog.eveningIntake;
    const { eatingCutoff } = ctx.currentLog.alarm;
    if (lastMealTime && eatingCutoff) {
      return lastMealTime > eatingCutoff;
    }
    return false;
  }

  // Alcohol logged
  if (cond.includes('alcohol logged')) {
    if (!ctx.currentLog) return false;
    return ctx.currentLog.eveningIntake.alcohol !== null;
  }

  // Peanuts/PB flagged
  if (cond.includes('peanuts') || cond.includes('pb flagged')) {
    if (!ctx.currentLog) return false;
    const food = ctx.currentLog.eveningIntake.foodDescription.toLowerCase();
    return food.includes('peanut') || food.includes('pb');
  }

  // Recurrent 3 AM wake-up events
  if (cond.includes('recurrent') && cond.includes('wake-up')) {
    const recentWakeUps = ctx.recentLogs.filter((log) =>
      log.wakeUpEvents.some((e) => {
        const [h] = e.startTime.split(':').map(Number);
        return h >= 2 && h <= 4;
      })
    );
    return recentWakeUps.length >= 3; // 3+ nights in last 7
  }

  // Iron supplement days
  if (cond.includes('iron supplement days')) {
    // Check if today is an "on" day for iron (every other day)
    return true; // Show on iron days — the supplement step handles the logic
  }

  // Feeling cold at bedtime — user-triggered, always show as advice
  if (cond.includes('feeling cold')) {
    return true; // General advice
  }

  // Default: show the rule
  return true;
}
