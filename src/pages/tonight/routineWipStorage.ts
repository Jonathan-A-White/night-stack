import type { RoutineStepStatus } from '../../types';

export type WipStepStatus = 'pending' | RoutineStepStatus;

export interface WipStep {
  stepId: string;
  stepName: string;
  status: WipStepStatus;
  startedAt: number | null;
  endedAt: number | null;
  durationMs: number | null;
  pbAtStartMs: number | null;
  notes: string;
}

export interface WipSession {
  id: string;
  variantId: string | null;
  variantName: string;
  startedAt: number;
  currentStepIndex: number;
  currentStepStartedAt: number | null;
  steps: WipStep[];
}

export const WIP_KEY = 'routine-session-wip';

export function loadWip(): WipSession | null {
  try {
    const raw = sessionStorage.getItem(WIP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WipSession;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.steps)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveWip(wip: WipSession | null): void {
  try {
    if (wip == null) {
      sessionStorage.removeItem(WIP_KEY);
      return;
    }
    sessionStorage.setItem(WIP_KEY, JSON.stringify(wip));
  } catch {
    // best-effort — storage quota / private mode
  }
}
