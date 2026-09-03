import { useState } from 'react';
import type { ElectrolyteDose, SleepPosition, SodiumLevel } from '../../../types';
import {
  ELECTROLYTE_DOSE_OPTIONS,
  POSITION_OPTIONS,
  SODIUM_LEVEL_OPTIONS,
} from '../../../services/nightTags';

interface Props {
  sodiumLevel: SodiumLevel;
  onSodiumLevel: (v: SodiumLevel) => void;
  sodiumSources: string[];
  onSodiumSources: (v: string[]) => void;
  suggestedSources: string[];
  electrolyteDose: ElectrolyteDose | null;
  onElectrolyteDose: (v: ElectrolyteDose | null) => void;
  positionStarted: Exclude<SleepPosition, 'unknown'> | null;
  onPositionStarted: (v: Exclude<SleepPosition, 'unknown'> | null) => void;
  /** True when the current level was inferred by the v12 backfill. */
  isProxy: boolean;
}

/**
 * Evening night-tags card (night-tags.md): sodium level, sodium sources,
 * electrolyte-drink dose, position when getting into bed. Rendered inside
 * the Food & Drink step.
 */
export function NightTagsStep(p: Props) {
  const [newSource, setNewSource] = useState('');

  function toggleSource(s: string) {
    const has = p.sodiumSources.some((x) => x.toLowerCase() === s.toLowerCase());
    p.onSodiumSources(has ? p.sodiumSources.filter((x) => x.toLowerCase() !== s.toLowerCase()) : [...p.sodiumSources, s]);
  }

  function addTyped() {
    const s = newSource.trim();
    if (!s) return;
    if (!p.sodiumSources.some((x) => x.toLowerCase() === s.toLowerCase())) p.onSodiumSources([...p.sodiumSources, s]);
    setNewSource('');
  }

  const chips = [...new Set([...p.suggestedSources, ...p.sodiumSources])];

  return (
    <div className="card">
      <div className="card-title">Salt &amp; position</div>

      <div className="form-group">
        <div className="form-label">
          Sodium today{p.isProxy && <span className="text-secondary"> (inferred — tap to confirm)</span>}
        </div>
        <div className="toggle-grid">
          {SODIUM_LEVEL_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`toggle-btn${p.sodiumLevel === o.value ? ' active' : ''}`}
              aria-pressed={p.sodiumLevel === o.value}
              onClick={() => p.onSodiumLevel(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {p.sodiumLevel !== 'normal' && (
        <div className="form-group">
          <div className="form-label">Where did it come from?</div>
          {chips.length > 0 && (
            <div className="toggle-grid mb-8">
              {chips.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`toggle-btn${p.sodiumSources.some((x) => x.toLowerCase() === s.toLowerCase()) ? ' active' : ''}`}
                  onClick={() => toggleSource(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-8">
            <input
              className="form-input"
              placeholder="e.g. ramen"
              aria-label="Add sodium source"
              value={newSource}
              onChange={(e) => setNewSource(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTyped();
                }
              }}
            />
            <button type="button" className="btn btn-secondary" onClick={addTyped}>
              Add
            </button>
          </div>
        </div>
      )}

      <div className="form-group">
        <div className="form-label">Electrolyte drink today</div>
        <div className="toggle-grid">
          {ELECTROLYTE_DOSE_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`toggle-btn${p.electrolyteDose === o.value ? ' active' : ''}`}
              aria-pressed={p.electrolyteDose === o.value}
              onClick={() => p.onElectrolyteDose(p.electrolyteDose === o.value ? null : o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="form-group">
        <div className="form-label">Position getting into bed</div>
        <div className="toggle-grid">
          {POSITION_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`toggle-btn${p.positionStarted === o.value ? ' active' : ''}`}
              aria-pressed={p.positionStarted === o.value}
              onClick={() => p.onPositionStarted(p.positionStarted === o.value ? null : o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
