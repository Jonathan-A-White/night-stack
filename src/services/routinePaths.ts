import { EVENING_ROUTINE_ID } from './routineSeeds';

/**
 * Route helpers for the Routine app. The evening routine keeps its
 * pre-v13 tracker path (`/tonight/routine`, the Routine app's Tracker
 * tab); every other routine is tracked at `/routine/:id/track`.
 */
export function trackerPathFor(routineId: string): string {
  return routineId === EVENING_ROUTINE_ID ? '/tonight/routine' : `/routine/${routineId}/track`;
}

export function editorPathFor(routineId: string): string {
  return `/settings/routines/${routineId}`;
}

export const ROUTINES_SETTINGS_PATH = '/settings/routines';
export const VAULT_SETTINGS_PATH = '/settings/vault';
export const ROUTINE_HOME_PATH = '/routine';
