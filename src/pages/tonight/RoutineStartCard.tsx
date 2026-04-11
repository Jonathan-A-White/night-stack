import { useEffect, useMemo, useState } from 'react';
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
import { formatTime12h, getTodayDate } from '../../utils';
import { loadWip } from './routineWipStorage';

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

function formatClockHHMM(ts: number): string {
  const d = new Date(ts);
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const period = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${h12}:${minutes.toString().padStart(2, '0')} ${period}`;
}

export function RoutineStartCard({ targetBedtimeHHMM }: Props) {
  const navigate = useNavigate();
  const sessions = useLiveQuery(() => db.routineSessions.toArray(), []);
  const variants = useLiveQuery(
    () => db.routineVariants.orderBy('sortOrder').toArray(),
    [],
  );
  const allSteps = useLiveQuery(() => db.routineSteps.toArray(), []);

  const [now, setNow] = useState<number>(Date.now());
  const [permission, setPermission] = useState<NotificationPermissionState>(() =>
    getNotificationPermission(),
  );
  // Tracks the in-progress session stored in localStorage by RoutineTracker.
  // Re-read on mount and whenever the window regains focus so navigating back
  // from the tracker surfaces the current state without a full reload.
  const [wip, setWip] = useState(() => loadWip());

  // Tick every second for countdown / running-timer updates.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Re-read WIP whenever the tab regains focus (e.g. after returning from the
  // tracker route). localStorage is synchronous and cheap to poll.
  useEffect(() => {
    const refresh = () => setWip(loadWip());
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
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

  // Resolve the default variant's active step ids — used to decide whether a
  // saved session covers every step the user expects to run tonight, or if
  // there are newly-added / still-pending steps.
  const defaultVariantStepIds = useMemo<string[] | null>(() => {
    if (!variants || !allSteps) return null;
    const variant = variants.find((v) => v.isDefault) ?? variants[0];
    if (!variant) return null;
    const activeIds = new Set(
      allSteps.filter((s) => s.isActive).map((s) => s.id),
    );
    return variant.stepIds.filter((id) => activeIds.has(id));
  }, [variants, allSteps]);

  // Today's saved session (handleSave in the tracker upserts a single session
  // per day, so there's at most one).
  const todaySession = useMemo(() => {
    if (!sessions) return null;
    const today = getTodayDate();
    return sessions.find((s) => s.date === today) ?? null;
  }, [sessions]);

  // Render states.
  const noData = bufferedTotalMs == null;

  // Is the routine actively running? (WIP session persisted by the tracker.)
  const isRunning = wip != null;

  // Is there a saved session from tonight, and does it cover every step in
  // the current default variant? If not, there's still work to do.
  const savedCoversAllSteps = useMemo(() => {
    if (!todaySession || !defaultVariantStepIds) return false;
    const handled = new Set(todaySession.steps.map((s) => s.stepId));
    return defaultVariantStepIds.every((id) => handled.has(id));
  }, [todaySession, defaultVariantStepIds]);

  const isDone = !isRunning && todaySession != null && savedCoversAllSteps;
  const isIncomplete =
    !isRunning && todaySession != null && !savedCoversAllSteps;
  const hasStartedTonight = isRunning || todaySession != null;

  // Unified "in progress" state: either the tracker has an active WIP, or
  // there's a saved session from tonight that doesn't yet cover every step.
  // Both render the same "running timer + continue routine" UI.
  const inProgressStartedAt: number | null = isRunning
    ? wip.startedAt
    : isIncomplete && todaySession
      ? todaySession.startedAt
      : null;

  const isOverdue = startAtMs != null && startAtMs <= now;

  return (
    <div className="card">
      <div className="card-title">EVENING ROUTINE</div>

      {inProgressStartedAt != null && (
        <>
          <div className="routine-start-card-countdown">
            {msToClock(now - inProgressStartedAt)}
          </div>
          <div className="routine-timer-label">routine in progress</div>
          <p className="text-secondary text-sm mt-16">
            Started at {formatClockHHMM(inProgressStartedAt)}
          </p>
          <button
            className="btn btn-primary btn-full mt-16"
            onClick={goToTracker}
          >
            Continue routine
          </button>
        </>
      )}

      {isDone && todaySession && (
        <>
          <div className="routine-start-card-countdown">
            {msToClock(
              todaySession.totalDurationMs ??
                (todaySession.endedAt != null
                  ? todaySession.endedAt - todaySession.startedAt
                  : 0),
            )}
          </div>
          <div className="routine-timer-label">routine complete</div>
          <p className="text-secondary text-sm mt-16">
            Started at {formatClockHHMM(todaySession.startedAt)}
            {todaySession.endedAt != null && (
              <> &bull; finished at {formatClockHHMM(todaySession.endedAt)}</>
            )}
          </p>
        </>
      )}

      {!hasStartedTonight && noData && (
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

      {!hasStartedTonight && !noData && startAt && !isOverdue && (
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

      {!hasStartedTonight && !noData && startAt && isOverdue && (
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
