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
  /**
   * When true, render a neutral "—" chip for nights with no label instead
   * of returning null. Used on the Insights dashboard (ux.md T6) where
   * every night row should have a chip, even unlabeled ones, so the row
   * layout stays consistent. Defaults to false so existing callers
   * (e.g. MorningReview) continue to hide the chip on unlabeled nights.
   */
  renderEmpty?: boolean;
}

export function ThermalComfortChip({ log, readOnly = false, renderEmpty = false }: Props) {
  const navigate = useNavigate();

  // Empty-state chip (ux.md T6): keeps the dashboard row layout aligned
  // and invites the user to click through and label the night.
  if (!log.thermalComfort) {
    if (!renderEmpty) return null;
    const emptyClasses = ['thermal-chip', 'thermal-chip--empty']
      .filter(Boolean)
      .join(' ');
    const emptyHandle = (e: React.MouseEvent) => {
      if (readOnly) return;
      e.stopPropagation();
      navigate(`/morning?date=${encodeURIComponent(log.date)}`);
    };
    return (
      <span
        className={emptyClasses}
        title="Not labeled yet — click to set in the morning log."
        role={readOnly ? undefined : 'button'}
        tabIndex={readOnly ? undefined : 0}
        onClick={emptyHandle}
        onKeyDown={(e) => {
          if (!readOnly && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            emptyHandle(e as unknown as React.MouseEvent);
          }
        }}
      >
        &mdash;
      </span>
    );
  }

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
