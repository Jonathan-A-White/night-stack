import type { WakeUpEvent } from '../types';
import { formatTime12h, timestampToHHMM } from '../utils';

const ECG_LABEL: Record<WakeUpEvent['ecgVerdict'], string> = {
  not_taken: 'not taken',
  sinus: 'sinus rhythm',
  afib: 'AFib',
  inconclusive: 'inconclusive',
};

const RHYTHM_LABEL = {
  fast_regular: 'fast, regular',
  irregular: 'irregular',
  unsure: 'unsure',
} as const;

/**
 * Read-only summary of what the 4am episode flow captured, plus the one
 * morning-side field the flow deliberately leaves for later (minutes to
 * settle). Used by the morning log's wake-up card and the morning review.
 */
export function EpisodeWakeDetails({
  event,
  onMinutesToSettle,
}: {
  event: WakeUpEvent;
  onMinutesToSettle?: (v: number | null) => void;
}) {
  return (
    <div className="episode-details">
      <div className="episode-badge">
        ⚡ Episode
        {event.capturedAt !== null && ` · captured ${formatTime12h(timestampToHHMM(event.capturedAt))}`}
      </div>
      <div className="text-secondary text-sm">
        Position: {event.positionAtWake} · ECG: {ECG_LABEL[event.ecgVerdict]}
        {event.rhythmFelt ? ` · felt ${RHYTHM_LABEL[event.rhythmFelt]}` : ''}
        {event.lyingBp
          ? ` · lying BP ${event.lyingBp.systolic}/${event.lyingBp.diastolic} (${event.lyingBp.pulse})`
          : ''}
        {event.wired ? ' · wired' : ''}
      </div>
      {onMinutesToSettle ? (
        <div className="form-group mt-8">
          <label className="form-label">Minutes until it settled</label>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            className="form-input"
            value={event.minutesToSettle ?? ''}
            placeholder="e.g. 25"
            onChange={(e) => {
              const raw = e.target.value;
              onMinutesToSettle(raw === '' ? null : Math.max(0, Math.floor(Number(raw))));
            }}
          />
        </div>
      ) : (
        event.minutesToSettle !== null && (
          <div className="text-secondary text-sm">Settled after {event.minutesToSettle} min</div>
        )
      )}
    </div>
  );
}
