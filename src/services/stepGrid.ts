import type { StepGrid, StepGridCell } from '../types';

/** Columns on the Lutron app's Devices tab, the first grid this was built for. */
export const DEFAULT_GRID_COLUMNS = 5;
export const MAX_GRID_COLUMNS = 12;

/** Cells split into rows of `columns`, reading order; the last row may be short. */
export function gridRows(grid: StepGrid): StepGridCell[][] {
  const columns = Math.max(1, Math.floor(grid.columns) || DEFAULT_GRID_COLUMNS);
  const rows: StepGridCell[][] = [];
  for (let i = 0; i < grid.cells.length; i += columns) {
    rows.push(grid.cells.slice(i, i + columns));
  }
  return rows;
}

/**
 * Bring anything read from a file or storage to a valid grid, or
 * undefined when there is none worth keeping. Empty cells are kept: they
 * let a layout skip a tile.
 */
export function normalizeStepGrid(raw: unknown): StepGrid | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const { columns, cells } = raw as { columns?: unknown; cells?: unknown };
  if (!Array.isArray(cells) || cells.length === 0) return undefined;
  const cols =
    typeof columns === 'number' && Number.isFinite(columns) && columns >= 1
      ? Math.min(MAX_GRID_COLUMNS, Math.floor(columns))
      : DEFAULT_GRID_COLUMNS;
  return {
    columns: cols,
    cells: cells.map((c) => {
      const cell = (c && typeof c === 'object' ? c : {}) as { name?: unknown; level?: unknown };
      return {
        name: typeof cell.name === 'string' ? cell.name : '',
        level: typeof cell.level === 'string' ? cell.level : '',
      };
    }),
  };
}
