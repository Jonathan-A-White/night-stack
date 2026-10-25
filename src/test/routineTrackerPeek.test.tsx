import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { db, seedDatabase } from '../db';
import RoutineTracker from '../pages/tonight/RoutineTracker';
import { loadWip, wipKeyFor } from '../pages/tonight/routineWipStorage';
import { createVault, encryptSecret, lockVault } from '../services/vault';
import type { RoutineStep, StepGrid } from '../types';

/**
 * In a running routine a tap on any step shows it (name, instructions, grid,
 * passwords) without moving the routine on: the current step and the saved
 * progress stay exactly as they were, and one tap goes back.
 */

const ROUTINE_ID = 'r-peek';
const VARIANT_ID = 'v-peek';
const SECRET_NAME = 'Cased iPad password';

const GRID: StepGrid = {
  columns: 2,
  cells: [
    { name: 'Cross Chandelier', level: '100%' },
    { name: 'Left Wall Spots', level: '50%' },
  ],
};

function step(partial: Partial<RoutineStep> & Pick<RoutineStep, 'id' | 'name'>): RoutineStep {
  return {
    routineId: ROUTINE_ID,
    description: '',
    secretNames: [],
    sortOrder: 1,
    isActive: true,
    createdAt: 1,
    ...partial,
  };
}

const STEPS: RoutineStep[] = [
  step({ id: 's1', name: 'Brush teeth', description: 'Two minutes, both rows' }),
  step({ id: 's2', name: 'Done pills', description: 'Morning bottle only' }),
  step({
    id: 's3',
    name: 'House light levels',
    description: 'Lutron on the Cased iPad',
    secretNames: [SECRET_NAME],
    grid: GRID,
  }),
];

async function seed() {
  await db.routines.put({
    id: ROUTINE_ID, name: 'Peek', description: '', schedule: { anchor: 'none' },
    isActive: true, sortOrder: 5, createdAt: 1,
  });
  await db.routineSteps.bulkPut(STEPS);
  await db.routineVariants.put({
    id: VARIANT_ID, routineId: ROUTINE_ID, name: 'Full', description: '',
    stepIds: STEPS.map((s) => s.id), isDefault: true, sortOrder: 1, createdAt: 1,
  });
  const { config, dek } = await createVault('2468');
  await db.vaultConfig.put(config);
  await db.secrets.put(await encryptSecret(dek, SECRET_NAME, 'hunter2-wifi'));
  lockVault();
}

function startWip() {
  const now = Date.now();
  localStorage.setItem(wipKeyFor(ROUTINE_ID), JSON.stringify({
    id: 'wip', routineId: ROUTINE_ID, variantId: VARIANT_ID, variantName: 'Full',
    startedAt: now, currentStepIndex: 0, currentStepStartedAt: now,
    steps: STEPS.map((s, i) => ({
      stepId: s.id, stepName: s.name, status: 'pending',
      startedAt: i === 0 ? now : null, endedAt: null, durationMs: null,
      pbAtStartMs: null, notes: '', lastDurationMs: null,
    })),
  }));
}

function mountTracker() {
  return render(
    <MemoryRouter initialEntries={[`/routine/${ROUTINE_ID}/track`]}>
      <Routes>
        <Route path="/routine/:routineId/track" element={<RoutineTracker />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('tapping a step in a running routine', () => {
  beforeEach(async () => {
    cleanup();
    localStorage.clear();
    await db.delete();
    await db.open();
    await seedDatabase();
    await seed();
    startWip();
  });
  afterEach(() => {
    cleanup();
    lockVault();
  });

  it('shows a step not reached yet, with its passwords, and leaves the routine where it was', async () => {
    mountTracker();
    expect(await screen.findByRole('heading', { name: /Step 1 of 3/ })).toHaveTextContent('Brush teeth');
    const before = loadWip(ROUTINE_ID);
    expect(before?.currentStepIndex).toBe(0);

    fireEvent.click(screen.getByText('3. House light levels'));

    expect(await screen.findByRole('heading', { name: /Step 3 of 3/ })).toHaveTextContent('House light levels');
    expect(screen.getByText('Lutron on the Cased iPad')).toBeInTheDocument();
    expect(await screen.findByRole('grid', { name: 'House light levels' })).toBeInTheDocument();
    // The password is still behind the vault PIN: a button, not the value.
    expect(await screen.findByRole('button', { name: `Show ${SECRET_NAME}` })).toBeInTheDocument();
    expect(screen.queryByText('hunter2-wifi')).toBeNull();
    // Looking is not doing: the current step's instructions are not on screen
    // and there is no Done for the step being looked at.
    expect(screen.queryByText('Two minutes, both rows')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();

    // The routine's saved progress is exactly as it was.
    expect(loadWip(ROUTINE_ID)).toEqual(before);
  });

  it('asks for the PIN before showing the password of a step being looked at', async () => {
    mountTracker();
    fireEvent.click(await screen.findByText('3. House light levels'));
    fireEvent.click(await screen.findByRole('button', { name: `Show ${SECRET_NAME}` }));
    expect(await screen.findByPlaceholderText('Vault PIN')).toBeInTheDocument();
    expect(screen.queryByText('hunter2-wifi')).toBeNull();
  });

  it('goes back to the current step in one tap', async () => {
    mountTracker();
    await screen.findByRole('heading', { name: /Step 1 of 3/ });
    const before = loadWip(ROUTINE_ID);

    fireEvent.click(screen.getByText('2. Done pills'));
    expect(await screen.findByText('Morning bottle only')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Back to current step/ }));

    await waitFor(() => expect(screen.queryByText('Morning bottle only')).toBeNull());
    expect(screen.getByRole('heading', { name: /Step 1 of 3/ })).toHaveTextContent('Brush teeth');
    expect(screen.getByText('Two minutes, both rows')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Back to current step/ })).toBeNull();
    expect(loadWip(ROUTINE_ID)).toEqual(before);
  });

  it('can look at one step after another, and a tap on the current step shows no way back', async () => {
    mountTracker();
    await screen.findByRole('heading', { name: /Step 1 of 3/ });

    fireEvent.click(screen.getByText('2. Done pills'));
    expect(await screen.findByRole('heading', { name: /Step 2 of 3/ })).toBeInTheDocument();
    fireEvent.click(screen.getByText('3. House light levels'));
    expect(await screen.findByRole('heading', { name: /Step 3 of 3/ })).toBeInTheDocument();
    expect(screen.queryByText('Morning bottle only')).toBeNull();

    // Tapping the row of the step that is running returns to it.
    fireEvent.click(screen.getByText('1. Brush teeth'));
    expect(await screen.findByRole('heading', { name: /Step 1 of 3/ })).toHaveTextContent('Brush teeth');
    expect(screen.queryByRole('button', { name: /Back to current step/ })).toBeNull();
  });

  it('keeps the routine going: Done after looking completes the current step, not the one looked at', async () => {
    mountTracker();
    await screen.findByRole('heading', { name: /Step 1 of 3/ });
    fireEvent.click(screen.getByText('3. House light levels'));
    fireEvent.click(await screen.findByRole('button', { name: /Back to current step/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));

    await waitFor(() => expect(loadWip(ROUTINE_ID)?.currentStepIndex).toBe(1));
    const wip = loadWip(ROUTINE_ID)!;
    expect(wip.steps.map((s) => s.status)).toEqual(['completed', 'pending', 'pending']);
    const list = screen.getByText('Steps').closest('.card') as HTMLElement;
    expect(within(list).getByText('2. Done pills')).toBeInTheDocument();
  });
});
