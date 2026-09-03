import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { db, seedDatabase } from '../db';
import { EpisodeCapture } from '../pages/experiments/EpisodeCapture';
import { loadEpisodeDraft, saveEpisodeDraft } from '../pages/experiments/episodeDraftStorage';
import { attachEpisode } from '../services/episodes';

function mount() {
  return render(
    <MemoryRouter initialEntries={['/experiments/episode']}>
      <Routes>
        <Route path="/experiments/episode" element={<EpisodeCapture />} />
        <Route path="/experiments" element={<div>home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const T_0431 = new Date(2026, 8, 4, 4, 31);

describe('EpisodeCapture', () => {
  beforeEach(async () => {
    cleanup();
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T_0431);
    await db.delete();
    await db.open();
    await seedDatabase();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('one tap persists an episode and moves to the first follow-up', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /episode now/i }));
    await waitFor(async () => {
      const log = await db.nightLogs.where('date').equals('2026-09-03').first();
      expect(log?.wakeUpEvents).toHaveLength(1);
    });
    const log = (await db.nightLogs.where('date').equals('2026-09-03').first())!;
    expect(log.autoCreated).toBe(true);
    expect(log.wakeUpEvents[0].source).toBe('episode');
    expect(log.wakeUpEvents[0].startTime).toBe('04:31');
    // Draft written, follow-up shown.
    expect(loadEpisodeDraft()?.eventId).toBe(log.wakeUpEvents[0].id);
    await screen.findByText(/position/i);
  });

  it('a follow-up tap persists the field immediately', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /episode now/i }));
    const backBtn = await screen.findByRole('button', { name: /^back$/i });
    fireEvent.click(backBtn);
    await waitFor(async () => {
      const log = (await db.nightLogs.where('date').equals('2026-09-03').first())!;
      expect(log.wakeUpEvents[0].positionAtWake).toBe('back');
    });
    // Next screen is the ECG question.
    await screen.findByText(/ECG/i);
  });

  it('resumes from a draft on the follow-up step instead of the big button', async () => {
    const res = await attachEpisode(T_0431.getTime());
    saveEpisodeDraft({ nightDate: res.nightDate, nightLogId: res.nightLogId, eventId: res.eventId, step: 2, startedAt: T_0431.getTime() });
    mount();
    await screen.findByText(/ECG/i);
    expect(screen.queryByRole('button', { name: /episode now/i })).toBeNull();
  });
});
