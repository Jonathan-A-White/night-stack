import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { db, seedDatabase } from '../db';
import RoutineTracker from '../pages/tonight/RoutineTracker';
import { loadWip } from '../pages/tonight/routineWipStorage';
import { EVENING_ROUTINE_ID } from '../services/routineSeeds';
import type { RoutineStep } from '../types';

const T0 = new Date(2026, 8, 4, 21, 0); // Fri 4 Sep 2026, 9:00 PM

function makeStep(id: string, name: string, sortOrder: number): RoutineStep {
  return {
    id,
    routineId: EVENING_ROUTINE_ID,
    name,
    description: '',
    secretNames: [],
    sortOrder,
    isActive: true,
    createdAt: T0.getTime(),
  };
}

function mount() {
  return render(
    <MemoryRouter initialEntries={['/tonight/routine']}>
      <Routes>
        <Route path="/tonight/routine" element={<RoutineTracker />} />
        <Route path="/tonight" element={<div>tonight home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Move the (faked) clock forward without touching real timers. */
function advance(ms: number) {
  vi.setSystemTime(new Date(Date.now() + ms));
}

function timerText(container: HTMLElement): string {
  return container.querySelector('.routine-timer-display')?.textContent ?? '';
}

async function startRoutine() {
  const btn = await screen.findByRole('button', { name: /start routine/i });
  fireEvent.click(btn);
  await screen.findByRole('button', { name: /^done$/i });
}

describe('RoutineTracker — pause and finish here', () => {
  beforeEach(async () => {
    cleanup();
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    await db.delete();
    await db.open();
    await seedDatabase();
    // The seeded evening routine has no steps — give it three.
    await db.routineSteps.bulkAdd([
      makeStep('s1', 'Step one', 1),
      makeStep('s2', 'Step two', 2),
      makeStep('s3', 'Step three', 3),
    ]);
    const variant = await db.routineVariants
      .where('routineId')
      .equals(EVENING_ROUTINE_ID)
      .first();
    await db.routineVariants.update(variant!.id, {
      stepIds: ['s1', 's2', 's3'],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('freezes the step timer while paused and keeps the pause out of the recorded time', async () => {
    const { container } = mount();
    await startRoutine();
    expect(timerText(container)).toBe('00:00');

    advance(5_000);
    fireEvent.click(screen.getByRole('button', { name: /^pause$/i }));

    // Paused: the clock reads what it did at the moment of pausing, the
    // label says so, and "Done" gives way to "Resume".
    expect(timerText(container)).toBe('00:05');
    expect(screen.getByText('paused')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^resume$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^done$/i })).toBeNull();

    // A minute goes by paused — the step timer must not move.
    advance(60_000);
    fireEvent.click(screen.getByRole('button', { name: /^resume$/i }));
    expect(timerText(container)).toBe('00:05');
    expect(screen.getByRole('button', { name: /^done$/i })).toBeInTheDocument();

    // Three more seconds of real work, then finish the step.
    advance(3_000);
    fireEvent.click(screen.getByRole('button', { name: /^done$/i }));

    const wip = loadWip(EVENING_ROUTINE_ID)!;
    expect(wip.steps[0].status).toBe('completed');
    // 5s + 3s of running — not the 68s of wall clock.
    expect(wip.steps[0].durationMs).toBe(8_000);
    expect(wip.steps[0].pausedMs).toBe(60_000);
    expect(wip.pausedMs).toBe(60_000);
    expect(wip.pausedAt).toBeNull();
  });

  it('finishes where it stands, marking the remaining steps and saving the session', async () => {
    mount();
    await startRoutine();

    advance(5_000);
    fireEvent.click(screen.getByRole('button', { name: /^pause$/i }));
    advance(60_000);
    fireEvent.click(screen.getByRole('button', { name: /^resume$/i }));
    advance(3_000);
    fireEvent.click(screen.getByRole('button', { name: /^done$/i }));

    // Step two is now running; the user did the rest away from the app.
    fireEvent.click(screen.getByRole('button', { name: /finish here/i }));
    expect(
      screen.getByText(/mark the 2 remaining steps as/i),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /punted to morning/i }));

    await screen.findByText(/routine complete/i);
    fireEvent.click(screen.getByRole('button', { name: /save session/i }));

    await waitFor(async () => {
      expect(await db.routineSessions.count()).toBe(1);
    });
    const session = (await db.routineSessions.toArray())[0];

    // Total is the 8s actually spent, not the 68s the clock advanced.
    expect(session.totalDurationMs).toBe(8_000);
    expect(session.pausedMs).toBe(60_000);
    expect(session.completedAt).not.toBeNull();
    expect(session.steps.map((s) => s.status)).toEqual([
      'completed',
      'punted',
      'punted',
    ]);
    expect(session.steps[0].durationMs).toBe(8_000);
    // The step that was running when the user bailed ended now; the one that
    // never started stays unstamped so the total isn't stretched.
    expect(session.steps[1].endedAt).toBe(T0.getTime() + 68_000);
    expect(session.steps[2].endedAt).toBeNull();
    // The WIP is cleared, so the routine won't offer to resume.
    expect(loadWip(EVENING_ROUTINE_ID)).toBeNull();
    await screen.findByText('tonight home');
  });

  it('can finish immediately, skipping everything, without discarding the session', async () => {
    mount();
    await startRoutine();
    advance(2_000);

    fireEvent.click(screen.getByRole('button', { name: /finish here/i }));
    expect(
      screen.getByText(/mark the 3 remaining steps as/i),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^skipped$/i }));

    await screen.findByText(/routine complete/i);
    fireEvent.click(screen.getByRole('button', { name: /save session/i }));

    await waitFor(async () => {
      expect(await db.routineSessions.count()).toBe(1);
    });
    const session = (await db.routineSessions.toArray())[0];
    expect(session.steps.map((s) => s.status)).toEqual([
      'skipped',
      'skipped',
      'skipped',
    ]);
    expect(session.pausedMs).toBe(0);
    expect(session.totalDurationMs).toBe(2_000);
  });
});
