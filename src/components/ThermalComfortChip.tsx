import { useNavigate } from 'react-router-dom';
import type { NightLog, ThermalComfort } from '../types';

/**
 * Thermal-comfort chip used in MorningReview and the Insights dashboard
 * (backfill.md T4). Proxy-sourced labels render with a dashed border and
 * a tooltip so the user can see which labels need review; clicking a
 * proxy chip jumps back to the morning log so they can correct it.
 *
 * Mixed nights are dimmed because they're low-signal for neighbor voting
 * (see questions.md Q5 downstream note) — the chip is informational.
 */

const LABELS: Record<ThermalComfort, string> = {
  too_hot: 'Too hot',
  too_cold: 'Too cold',
  just_right: 'Just right',
  mixed: 'Mixed',
};

const MODIFIERS: Record<ThermalComfort, string> = {
  too_hot: 'thermal-chip--hot',
  too_cold: 'thermal-chip--cold',
  just_right: 'thermal-chip--just',
  mixed: 'thermal-chip--mixed',
};

interface Props {
  log: Pick<NightLog, 'id' | 'date' | 'thermalComfort' | 'thermalComfortSource'>;
  /** Disable the click-to-edit jump (e.g. already on the morning log). */
  readOnly?: boolean;
}

export function ThermalComfortChip({ log, readOnly = false }: Props) {
  const navigate = useNavigate();
  if (!log.thermalComfort) return null;

  const isProxy = log.thermalComfortSource === 'proxy';
  const classes = [
    'thermal-chip',
    MODIFIERS[log.thermalComfort],
    isProxy ? 'thermal-chip--proxy' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const title = isProxy
    ? 'Inferred from wake events — click to confirm or edit in the morning log.'
    : LABELS[log.thermalComfort];

  function handleClick(e: React.MouseEvent) {
    if (readOnly) return;
    // Stop event bubbling so this doesn't also trigger the parent row's
    // own click handler (e.g. Dashboard list items navigate to review).
    e.stopPropagation();
    // MorningLog supports ?date=YYYY-MM-DD for editing a specific night.
    navigate(`/morning?date=${encodeURIComponent(log.date)}`);
  }

  return (
    <span
      className={classes}
      title={title}
      role={readOnly ? undefined : 'button'}
      tabIndex={readOnly ? undefined : 0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (!readOnly && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          handleClick(e as unknown as React.MouseEvent);
        }
      }}
    >
      {LABELS[log.thermalComfort]}
      {isProxy && <span style={{ marginLeft: 6, opacity: 0.7 }}>•</span>}
    </span>
  );
}
