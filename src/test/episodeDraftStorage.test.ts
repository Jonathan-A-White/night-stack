import { describe, it, expect, beforeEach } from 'vitest';
import {
  EPISODE_DRAFT_KEY,
  loadEpisodeDraft,
  saveEpisodeDraft,
  clearEpisodeDraft,
  clearEpisodeDraftForNight,
  type EpisodeDraft,
} from '../pages/experiments/episodeDraftStorage';

const draft: EpisodeDraft = {
  nightDate: '2026-09-03',
  nightLogId: 'n1',
  eventId: 'e1',
  step: 1,
  startedAt: new Date(2026, 8, 4, 4, 31).getTime(),
};

describe('episodeDraftStorage', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a draft', () => {
    saveEpisodeDraft(draft);
    expect(localStorage.getItem(EPISODE_DRAFT_KEY)).not.toBeNull();
    expect(loadEpisodeDraft()).toEqual(draft);
  });

  it('survives evening rollover (still offered at 13:00 the same day)', () => {
    saveEpisodeDraft(draft);
    const now = new Date(2026, 8, 4, 13, 0);
    expect(loadEpisodeDraft(now)).toEqual(draft);
  });

  it('expires after 48 hours', () => {
    saveEpisodeDraft(draft);
    const now = new Date(draft.startedAt + 49 * 60 * 60 * 1000);
    expect(loadEpisodeDraft(now)).toBeNull();
    expect(localStorage.getItem(EPISODE_DRAFT_KEY)).toBeNull();
  });

  it('clearEpisodeDraftForNight only clears a draft for that night', () => {
    saveEpisodeDraft(draft);
    clearEpisodeDraftForNight('2026-09-02');
    expect(loadEpisodeDraft()).toEqual(draft);
    clearEpisodeDraftForNight('2026-09-03');
    expect(loadEpisodeDraft()).toBeNull();
  });

  it('clearEpisodeDraft removes it and garbage is ignored', () => {
    saveEpisodeDraft(draft);
    clearEpisodeDraft();
    expect(loadEpisodeDraft()).toBeNull();
    localStorage.setItem(EPISODE_DRAFT_KEY, '{nope');
    expect(loadEpisodeDraft()).toBeNull();
    localStorage.setItem(EPISODE_DRAFT_KEY, JSON.stringify({ step: 'x' }));
    expect(loadEpisodeDraft()).toBeNull();
  });
});
