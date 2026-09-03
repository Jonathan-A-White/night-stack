import type { BpPoint, OrthostaticSlot, VitalsSource } from '../../types';

/**
 * Draft for the coached orthostatic flow (vitals.md). Timers are computed
 * from `stageStartedAt`, not interval state, so a locked screen or a
 * killed app resumes at the right remaining time.
 */
export type VitalsStage = 'supine' | 'standing1' | 'standing3';

export interface VitalsDraft {
  date: string;
  slot: OrthostaticSlot;
  stage: VitalsStage;
  stageStartedAt: number;
  /** Timer skipped / elapsed for the current stage → inputs visible. */
  inputsRevealed: boolean;
  supine: BpPoint | null;
  standing1: BpPoint | null;
  standing3: BpPoint | null;
  source: VitalsSource;
  notes: string;
}

export function vitalsDraftKey(date: string, slot: OrthostaticSlot): string {
  return `vitals-draft-${date}-${slot}`;
}

export function loadVitalsDraft(date: string, slot: OrthostaticSlot): VitalsDraft | null {
  try {
    const raw = localStorage.getItem(vitalsDraftKey(date, slot));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<VitalsDraft> | null;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.stage !== 'string' || typeof parsed.stageStartedAt !== 'number') {
      return null;
    }
    return parsed as VitalsDraft;
  } catch {
    return null;
  }
}

export function saveVitalsDraft(draft: VitalsDraft): void {
  try {
    localStorage.setItem(vitalsDraftKey(draft.date, draft.slot), JSON.stringify(draft));
  } catch {
    // best-effort
  }
}

export function clearVitalsDraft(date: string, slot: OrthostaticSlot): void {
  try {
    localStorage.removeItem(vitalsDraftKey(date, slot));
  } catch {
    // best-effort
  }
}
