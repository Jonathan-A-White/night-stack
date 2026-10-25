import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { db, seedDatabase } from '../db';
import RoutineTracker from '../pages/tonight/RoutineTracker';
import RoutineEditorPage from '../pages/settings/RoutineEditorPage';
import { StepGridView } from '../components/StepGridView';
import { gridRows, normalizeStepGrid, DEFAULT_GRID_COLUMNS } from '../services/stepGrid';
import { normalizeRoutinePayload } from '../services/backup';
import { wipKeyFor } from '../pages/tonight/routineWipStorage';
import type { RoutineStep, StepGrid } from '../types';

/**
 * A step's instructions can carry a grid laid out like the device's own
 * screen: columns across, cells in reading order, each cell a name and a
 * level. Steps stored without a grid keep loading and running unchanged.
 */

const ROUTINE_ID = 'r-grid';
const STEP_ID = 's-grid';
const OLD_STEP_ID = 's-old';
const VARIANT_ID = 'v-grid';

const SEVEN: StepGrid = {
  columns: 5,
  cells: [
    { name: 'Left Front Track Row 1', level: '35%' },
    { name: 'Left Second Row Track', level: '35%' },
    { name: '4th Row Track Left', level: 'Off' },
    { name: '3rd Row Track Left', level: 'Off' },
    { name: 'Left Wall Spots', level: '50%' },
    { name: 'Cross Chandelier', level: '100%' },
    { name: 'Unknown 5', level: 'Off' },
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

async function seedRoutine(steps: RoutineStep[]) {
  await db.routines.put({
    id: ROUTINE_ID, name: 'Booth', description: '', schedule: { anchor: 'none' },
    isActive: true, sortOrder: 5, createdAt: 1,
  });
  await db.routineSteps.bulkPut(steps);
  await db.routineVariants.put({
    id: VARIANT_ID, routineId: ROUTINE_ID, name: 'Full', description: '',
    stepIds: steps.map((s) => s.id), isDefault: true, sortOrder: 1, createdAt: 1,
  });
}

function startWip(stepIds: Array<[string, string]>) {
  const now = Date.now();
  localStorage.setItem(wipKeyFor(ROUTINE_ID), JSON.stringify({
    id: 'wip', routineId: ROUTINE_ID, variantId: VARIANT_ID, variantName: 'Full',
    startedAt: now, currentStepIndex: 0, currentStepStartedAt: now,
    steps: stepIds.map(([stepId, stepName], i) => ({
      stepId, stepName, status: 'pending',
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

describe('step grid helpers', () => {
  it('splits 7 cells in 5 columns into 2 rows, in order', () => {
    const rows = gridRows(SEVEN);
    expect(rows).toHaveLength(2);
    expect(rows[0].map((c) => c.name)).toEqual(SEVEN.cells.slice(0, 5).map((c) => c.name));
    expect(rows[1].map((c) => c.name)).toEqual(['Cross Chandelier', 'Unknown 5']);
  });

  it('defaults to five columns, like the Lutron Devices tab', () => {
    expect(DEFAULT_GRID_COLUMNS).toBe(5);
    expect(normalizeStepGrid({ cells: [{ name: 'A', level: '1' }] })?.columns).toBe(5);
  });

  it('keeps an empty cell so a layout can skip a tile', () => {
    const g = normalizeStepGrid({ columns: 3, cells: [{ name: 'A', level: '1' }, { name: '', level: '' }, { name: 'B', level: '2' }] })!;
    expect(g.cells.map((c) => c.name)).toEqual(['A', '', 'B']);
  });

  it('drops a malformed grid and coerces bad columns and cells', () => {
    expect(normalizeStepGrid(undefined)).toBeUndefined();
    expect(normalizeStepGrid('nope')).toBeUndefined();
    expect(normalizeStepGrid({ columns: 5, cells: [] })).toBeUndefined();
    const g = normalizeStepGrid({ columns: 0, cells: [{ name: 7, level: null }, 'x'] })!;
    expect(g.columns).toBe(5);
    expect(g.cells).toEqual([{ name: '', level: '' }, { name: '', level: '' }]);
  });
});

describe('a step with a grid', () => {
  beforeEach(async () => {
    cleanup();
    localStorage.clear();
    await db.delete();
    await db.open();
    await seedDatabase();
  });
  afterEach(() => cleanup());

  it('reads back with the same cells in order and renders 2 rows', async () => {
    await db.routineSteps.put(step({ id: STEP_ID, name: 'House light levels', grid: SEVEN }));
    const stored = await db.routineSteps.get(STEP_ID);
    expect(stored?.grid?.columns).toBe(5);
    expect(stored?.grid?.cells).toEqual(SEVEN.cells);

    const { container } = render(<StepGridView grid={stored!.grid!} />);
    expect(container.querySelectorAll('[data-grid-row]')).toHaveLength(2);
  });

  it('is shown by the running step as rows and columns, each cell with name and level', async () => {
    await seedRoutine([step({ id: STEP_ID, name: 'House light levels', description: 'Lutron on the Cased iPad', grid: SEVEN })]);
    startWip([[STEP_ID, 'House light levels']]);
    mountTracker();

    const grid = await screen.findByRole('grid', { name: 'House light levels' });
    expect(screen.getByText('Lutron on the Cased iPad')).toBeInTheDocument();
    const rows = within(grid).getAllByRole('row');
    expect(rows).toHaveLength(2);
    const firstRow = within(rows[0]).getAllByRole('gridcell');
    expect(firstRow).toHaveLength(5);
    expect(firstRow[0]).toHaveTextContent('Left Front Track Row 1');
    expect(firstRow[0]).toHaveTextContent('35%');
    expect(firstRow[4]).toHaveTextContent('Left Wall Spots');
    const secondRow = within(rows[1]).getAllByRole('gridcell');
    expect(secondRow).toHaveLength(2);
    expect(secondRow[0]).toHaveTextContent('Cross Chandelier');
    expect(secondRow[0]).toHaveTextContent('100%');
  });
});

describe('a step stored without a grid', () => {
  beforeEach(async () => {
    cleanup();
    localStorage.clear();
    await db.delete();
    await db.open();
    await seedDatabase();
  });
  afterEach(() => cleanup());

  it('loads unchanged and runs with its text instructions and no grid', async () => {
    const old = step({ id: OLD_STEP_ID, name: 'Old step', description: 'Cross chandelier - 100%' });
    expect('grid' in old).toBe(false);
    await seedRoutine([old]);
    const stored = await db.routineSteps.get(OLD_STEP_ID);
    expect(stored?.grid).toBeUndefined();
    expect(stored?.description).toBe('Cross chandelier - 100%');

    startWip([[OLD_STEP_ID, 'Old step']]);
    mountTracker();
    await waitFor(() => expect(screen.getByText('Cross chandelier - 100%')).toBeInTheDocument());
    expect(screen.queryByRole('grid')).toBeNull();
  });

  it('an imported step without a grid gains none; a good grid is kept; a bad one is dropped', () => {
    const n = normalizeRoutinePayload({
      routineSteps: [
        { id: 'a', name: 'A', description: '', sortOrder: 1, isActive: true, createdAt: 1 },
        { id: 'b', name: 'B', description: '', sortOrder: 2, isActive: true, createdAt: 1, grid: SEVEN },
        { id: 'c', name: 'C', description: '', sortOrder: 3, isActive: true, createdAt: 1, grid: 'junk' },
      ],
      routineVariants: [{ id: 'v', name: 'Full', description: '', stepIds: ['a', 'b', 'c'], isDefault: true, sortOrder: 1, createdAt: 1 }],
    })!;
    expect('grid' in n.routineSteps[0]).toBe(false);
    expect(n.routineSteps[1].grid).toEqual(SEVEN);
    expect('grid' in n.routineSteps[2]).toBe(false);
  });
});

describe('the step editor', () => {
  beforeEach(async () => {
    cleanup();
    localStorage.clear();
    await db.delete();
    await db.open();
    await seedDatabase();
  });
  afterEach(() => cleanup());

  it('saves a grid with a blank tile kept in place, and clears it when emptied', async () => {
    await seedRoutine([step({ id: STEP_ID, name: 'House light levels' })]);
    render(
      <MemoryRouter initialEntries={[`/settings/routines/${ROUTINE_ID}`]}>
        <Routes>
          <Route path="/settings/routines/:routineId" element={<RoutineEditorPage />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByText('House light levels'));
    const add = await screen.findByRole('button', { name: 'Add cell' });
    fireEvent.click(add);
    fireEvent.click(add);
    fireEvent.click(add);
    fireEvent.change(screen.getByLabelText('Cell 1 name'), { target: { value: 'Cross Chandelier' } });
    fireEvent.change(screen.getByLabelText('Cell 1 level'), { target: { value: '100%' } });
    fireEvent.change(screen.getByLabelText('Cell 3 name'), { target: { value: 'Unknown 5' } });
    fireEvent.change(screen.getByLabelText('Cell 3 level'), { target: { value: 'Off' } });
    fireEvent.change(screen.getByLabelText('Columns'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await db.routineSteps.get(STEP_ID))?.grid).toBeDefined());
    expect((await db.routineSteps.get(STEP_ID))?.grid).toEqual({
      columns: 2,
      cells: [
        { name: 'Cross Chandelier', level: '100%' },
        { name: '', level: '' },
        { name: 'Unknown 5', level: 'Off' },
      ],
    });

    // Clearing every cell removes the grid.
    fireEvent.click(await screen.findByText('House light levels'));
    for (let i = 0; i < 3; i += 1) {
      fireEvent.click(await screen.findByRole('button', { name: 'Remove cell 1' }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await db.routineSteps.get(STEP_ID))?.grid).toBeUndefined());
  });
});
