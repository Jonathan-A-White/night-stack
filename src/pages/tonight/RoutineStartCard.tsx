import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import {
  computeBufferedTotalMs,
  computeRecommendedStart,
  computeSessionStats,
} from '../../services/routineAnalytics';
import {
  getNotificationPermission,
  requestNotificationPermission,
  scheduleRoutineStartNotification,
  type NotificationPermissionState,
} from '../../services/routineNotifications';
import { formatTime12h } from '../../utils';

interface Props {
  targetBedtimeHHMM: string;
}

/** Format a ms value as "MM:SS" for small durations, or "H:MM:SS" at ≥1h. */
function msToClock(ms: number): string {
  const abs = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  const seconds = abs % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

/** Format a ms value as "MM:SS" regardless of length (for sub-line averages). */
function msToMMSS(ms: number): string {
  const abs = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(abs / 60);
  const seconds = abs % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(minutes)}:${pad(seconds)}`;
}

export function RoutineStartCard({ targetBedtimeHHMM }: Props) {
  const navigate = useNavigate();
  const sessions = useLiveQuery(() => db.routineSessions.toArray(), []);

  const [now, setNow] = useState<number>(Date.now());
  const [permission, setPermission] = useState<NotificationPermissionState>(() =>
    getNotificationPermission(),
  );

  // Tick every second for countdown updates.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const sessionStats = computeSessionStats(sessions ?? []);
  const bufferedTotalMs = computeBufferedTotalMs(sessionStats);
  const startAt = computeRecommendedStart(
    targetBedtimeHHMM,
    bufferedTotalMs,
    new Date(now),
  );
  const startAtMs = startAt ? startAt.getTime() : null;

  // (Re)schedule start-time notification whenever the target moves.
  useEffect(() => {
    if (startAtMs == null) return;
    if (startAtMs <= Date.now()) return;
    scheduleRoutineStartNotification(new Date(startAtMs), {
      title: 'Evening routine',
      body: 'Time to start your routine to hit bedtime.',
    });
  }, [startAtMs]);

  const goToTracker = () => navigate('/tonight/routine');

  const handleEnableNotifications = async () => {
    const result = await requestNotificationPermission();
    setPermission(result);
  };

  // Render states.
  const noData = bufferedTotalMs == null;
  const isOverdue = startAtMs != null && startAtMs <= now;

  return (
    <div className="card">
      <div className="card-title">EVENING ROUTINE</div>

      {noData && (
        <>
          <p className="text-secondary text-sm">
            No routine data yet &mdash; run your first session.
          </p>
          <button
            className="btn btn-primary btn-full mt-16"
            onClick={goToTracker}
          >
            Start routine now
          </button>
        </>
      )}

      {!noData && startAt && !isOverdue && (
        <>
          <div className="routine-start-card-countdown">
            {msToClock(startAtMs! - now)}
          </div>
          <div className="routine-timer-label">until routine start time</div>
          <p className="text-secondary text-sm mt-16">
            Start at {formatTime12h(
              `${startAt.getHours().toString().padStart(2, '0')}:${startAt
                .getMinutes()
                .toString()
                .padStart(2, '0')}`,
            )}
            {' '}&bull; avg {msToMMSS(sessionStats.avgTotalMs30d ?? sessionStats.avgTotalMs ?? 0)},
            buffer {msToMMSS(bufferedTotalMs!)}
          </p>
          <button
            className="btn btn-secondary btn-full mt-16"
            onClick={goToTracker}
          >
            Start early
          </button>
        </>
      )}

      {!noData && startAt && isOverdue && (
        <>
          <div className="routine-start-card-countdown overdue">
            -{msToClock(now - startAtMs!)}
          </div>
          <div className="routine-timer-label">past recommended start time</div>
          <button
            className="btn btn-primary btn-full mt-16"
            onClick={goToTracker}
          >
            Start routine
          </button>
        </>
      )}

      {permission === 'default' && (
        <button
          className="btn btn-secondary btn-sm mt-16"
          onClick={handleEnableNotifications}
        >
          Enable notifications
        </button>
      )}
    </div>
  );
}

export default RoutineStartCard;
