import type { StepGrid } from '../types';
import { gridRows } from '../services/stepGrid';

/**
 * A step's grid, drawn as rows and columns the way the device shows it,
 * each cell its name and its level. An empty cell leaves a gap.
 */
export function StepGridView({ grid, label }: { grid: StepGrid; label?: string }) {
  const columns = Math.max(1, Math.floor(grid.columns) || 1);
  return (
    <div className="step-grid" role="grid" aria-label={label}>
      {gridRows(grid).map((row, r) => (
        <div
          key={r}
          className="step-grid-row"
          role="row"
          data-grid-row={r + 1}
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {row.map((cell, c) => {
            const empty = !cell.name && !cell.level;
            return (
              <div
                key={c}
                className={`step-grid-cell${empty ? ' empty' : ''}`}
                role="gridcell"
              >
                <span className="step-grid-name">{cell.name}</span>
                <span className="step-grid-level">{cell.level}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
