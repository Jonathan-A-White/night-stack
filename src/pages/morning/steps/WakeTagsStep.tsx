import type { SleepPosition } from '../../../types';
import { POSITION_OPTIONS } from '../../../services/nightTags';
import { formatTime12h } from '../../../utils';

interface Props {
  positionAtWake: Exclude<SleepPosition, 'unknown'> | null;
  onPositionAtWake: (v: Exclude<SleepPosition, 'unknown'> | null) => void;
  wiredWake: boolean;
  onWiredWake: (v: boolean) => void;
  /** sleepData.wakeTime "HH:MM" when imported; shown read-only. */
  watchWakeTime: string | null;
}

/**
 * Morning wake-tags card (night-tags.md): position at the final wake,
 * "woke wired?", and the watch's wake time. Rendered inside the Wake-Up
 * Events step.
 */
export function WakeTagsStep(p: Props) {
  return (
    <div className="card">
      <div className="card-title">Position &amp; wired</div>

      <div className="form-group">
        <div className="form-label">Position at final wake</div>
        <div className="toggle-grid">
          {POSITION_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`toggle-btn${p.positionAtWake === o.value ? ' active' : ''}`}
              aria-pressed={p.positionAtWake === o.value}
              onClick={() => p.onPositionAtWake(p.positionAtWake === o.value ? null : o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="switch-row">
        <span>Woke wired at any point?</span>
        <label className="switch">
          <input type="checkbox" checked={p.wiredWake} onChange={(e) => p.onWiredWake(e.target.checked)} />
          <span className="switch-slider" />
        </label>
      </div>

      {p.watchWakeTime && (
        <div className="summary-row">
          <span className="summary-label">Watch wake time</span>
          <span className="summary-value">{formatTime12h(p.watchWakeTime)}</span>
        </div>
      )}
    </div>
  );
}
