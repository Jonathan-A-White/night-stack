/**
 * Crash-safe draft for the 4am episode flow. Same shape as
 * `routineWipStorage` (localStorage, best-effort, validated on load) with
 * one difference: the draft is keyed by the night it belongs to and does
 * NOT expire on evening rollover — a 4am draft is legitimately finished at
 * 1pm. It expires after 48 h, or when the morning log for that night is
 * saved (`clearEpisodeDraftForNight`).
 */
export interface EpisodeDraft {
  nightDate: string;
  nightLogId: string;
  eventId: string;
  /** Follow-up step to resume on (1 = first follow-up). */
  step: number;
  startedAt: number;
}

export const EPISODE_DRAFT_KEY = 'episode-draft';
const EXPIRY_MS = 48 * 60 * 60 * 1000;

export function loadEpisodeDraft(now: Date = new Date()): EpisodeDraft | null {
  try {
    const raw = localStorage.getItem(EPISODE_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<EpisodeDraft> | null;
    if (
      !parsed || typeof parsed !== 'object' ||
      typeof parsed.nightDate !== 'string' ||
      typeof parsed.nightLogId !== 'string' ||
      typeof parsed.eventId !== 'string' ||
      typeof parsed.step !== 'number' ||
      typeof parsed.startedAt !== 'number'
    ) {
      localStorage.removeItem(EPISODE_DRAFT_KEY);
      return null;
    }
    if (now.getTime() - parsed.startedAt > EXPIRY_MS) {
      localStorage.removeItem(EPISODE_DRAFT_KEY);
      return null;
    }
    return parsed as EpisodeDraft;
  } catch {
    return null;
  }
}

export function saveEpisodeDraft(draft: EpisodeDraft): void {
  try {
    localStorage.setItem(EPISODE_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // best-effort — storage quota / private mode
  }
}

export function clearEpisodeDraft(): void {
  try {
    localStorage.removeItem(EPISODE_DRAFT_KEY);
  } catch {
    // best-effort
  }
}

/** Clear the draft only if it belongs to `nightDate`. */
export function clearEpisodeDraftForNight(nightDate: string): void {
  const d = loadEpisodeDraft();
  if (d && d.nightDate === nightDate) clearEpisodeDraft();
}
