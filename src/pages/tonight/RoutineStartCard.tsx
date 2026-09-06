import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import {
  computeBufferedTotalMs,
  computeRecommendedStartFromDeadline,
  computeSessionStats,
} from '../../services/routineAnalytics';
import {
  getNotificationPermission,
  requestNotificationPermission,
  scheduleRoutineStartNotification,
  type NotificationPermissionState,
} from '../../services/routineNotifications';
import { describeDeadline, describeSchedule, resolveDeadline } from '../../services/routineSchedule';
import { editorPathFor, trackerPathFor } from '../../services/routinePaths';
import { getTodayDate } from '../../utils';
import type { Routine } from '../../types';
import { loadWip } from './routineWipStorage';

interface Props {
  routine: Routine;
  /**
   * Tonight's target bedtime ("HH:MM") as already resolved by the caller
   * from the night log or the alarm schedule. Only the 'bedtime' anchor
   * reads it; pass null when unknown.
   */
  targetBedtimeHHMM: string | null;
  /** Show a link to the routine's editor under the card. */
  showEditLink?: boolean;
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

/** Countdown that switches to days when the deadline is far off. */
function formatCountdown(ms: number): string {
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days >= 1) {
    const rest = ms - days * 24 * 60 * 60 * 1000;
    return `${days}d ${msToClock(rest)}`;
  }
  return msToClock(ms);
}

export function RoutineStartCard({ routine, targetBedtimeHHMM, showEditLink = false }: Props) {
  const navigate = useNavigate();
  const routineId = routine.id;
  const sessions = useLiveQuery(
    () => db.routineSessions.where('routineId').equals(routineId).toArray(),
    [routineId],
  );
  const variants = useLiveQuery(
    () => db.routineVariants.where('routineId').equals(routineId).sortBy('sortOrder'),
    [routineId],
  );
  const allSteps = useLiveQuery(
    () => db.routineSteps.where('routineId').equals(routineId).toArray(),
    [routineId],
  );

  const [now, setNow] = useState<number>(Date.now());
  const [permission, setPermission] = useState<NotificationPermissionState>(() =>
    getNotificationPermission(),
  );
  // Tracks the in-progress session stored in localStorage by RoutineTracker.
  // Re-read on mount and whenever the window regains focus so navigating back
  // from the tracker surfaces the current state without a full reload.
  const [wip, setWip] = useState(() => loadWip(routineId));

  // Tick every second for countdown / running-timer updates.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Re-read WIP whenever the tab regains focus (e.g. after returning from the
  // tracker route). localStorage is synchronous and cheap to poll.
  useEffect(() => {
    const refresh = () => setWip(loadWip(routineId));
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [routineId]);

  const sessionStats = computeSessionStats(sessions ?? []);
  const bufferedTotalMs = computeBufferedTotalMs(sessionStats);
  const deadline = resolveDeadline(routine.schedule, targetBedtimeHHMM, new Date(now));
  const startAt = computeRecommendedStartFromDeadline(deadline, bufferedTotalMs);
  const startAtMs = startAt ? startAt.getTime() : null;
  const hasDeadline = routine.schedule.anchor !== 'none';

  // (Re)schedule this routine's start-time notification whenever the
  // target moves. Keyed by routine id so sibling cards keep their own.
  useEffect(() => {
    if (startAtMs == null) return;
    if (startAtMs <= Date.now()) return;
    scheduleRoutineStartNotification(new Date(startAtMs), {
      title: routine.name,
      body: 'Time to start your routine to make the deadline.',
    }, routineId);
  }, [startAtMs, routine.name, routineId]);

  const goToTracker = () => navigate(trackerPathFor(routineId));

  const handleEnableNotifications = async () => {
    const result = await requestNotificationPermission();
    setPermission(result);
  };

  // Today's saved session (handleSave in the tracker upserts a single session
  // per day, so there's at most one).
  const todaySession = useMemo(() => {
    if (!sessions) return null;
    const today = getTodayDate();
    return sessions.find((s) => s.date === today) ?? null;
  }, [sessions]);

  // Active step ids for the variant the saved session was actually run with.
  // We check coverage against THIS variant rather than the default — otherwise
  // finishing a non-default variant (e.g. "Friday Night" with 14 steps) would
  // still look incomplete whenever the default variant has more steps, and
  // the card would show "Continue routine" forever.
  const sessionVariantStepIds = useMemo<string[] | null>(() => {
    if (!variants || !allSteps || !todaySession) return null;
    const variant =
      todaySession.variantId != null
        ? variants.find((v) => v.id === todaySession.variantId) ?? null
        : null;
    if (!variant) return null;
    const activeIds = new Set(
      allSteps.filter((s) => s.isActive).map((s) => s.id),
    );
    return variant.stepIds.filter((id) => activeIds.has(id));
  }, [variants, allSteps, todaySession]);

  // Render states.
  const noData = bufferedTotalMs == null;

  // Is the routine actively running? (WIP session persisted by the tracker.)
  const isRunning = wip != null;

  // Is there a saved session from today, and does it cover every step in
  // the variant it was run with? If not, there's still work to do.
  // Ad-hoc sessions (variantId == null) or sessions whose variant has since
  // been deleted are treated as self-contained — we have no other yardstick
  // to measure them against, and stranding them in "Continue routine" forever
  // is worse than calling them done.
  const savedCoversAllSteps = useMemo(() => {
    if (!todaySession) return false;
    if (todaySession.variantId == null) return true;
    if (!variants || !allSteps) return false;
    if (sessionVariantStepIds == null) return true;
    const handled = new Set(todaySession.steps.map((s) => s.stepId));
    return sessionVariantStepIds.every((id) => handled.has(id));
  }, [todaySession, sessionVariantStepIds, variants, allSteps]);

  const isDone = !isRunning && todaySession != null && savedCoversAllSteps;
  const isIncomplete =
    !isRunning && todaySession != null && !savedCoversAllSteps;
  const hasStartedToday = isRunning || todaySession != null;

  // Unified "in progress" state: either the tracker has an active WIP, or
  // there's a saved session from today that doesn't yet cover every step.
  // Both render the same "running timer + continue routine" UI.
  const inProgressStartedAt: number | null = isRunning
    ? wip.startedAt
    : isIncomplete && todaySession
      ? todaySession.startedAt
      : null;

  const isOverdue = startAtMs != null && startAtMs <= now;
  const deadlineIsToday =
    deadline != null &&
    deadline.getFullYear() === new Date(now).getFullYear() &&
    deadline.getMonth() === new Date(now).getMonth() &&
    deadline.getDate() === new Date(now).getDate();
  const avgMs = sessionStats.avgTotalMs30d ?? sessionStats.avgTotalMs ?? null;

  return (
    <div className="card">
      <div className="card-title">{routine.name}</div>
      {routine.description && !hasStartedToday && (
        <p className="text-secondary text-sm" style={{ marginTop: -6, marginBottom: 10 }}>
          {routine.description}
        </p>
      )}

      {inProgressStartedAt != null && (
        <>
          <div className="routine-start-card-countdown">
            {msToClock(now - inProgressStartedAt)}
          </div>
          <div className="routine-timer-label">routine in progress</div>
          <p className="text-secondary text-sm mt-16">
            Started at {formatClockHHMM(inProgressStartedAt)}
            {deadline && <> &bull; finish by {describeDeadline(deadline, new Date(now))}</>}
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

      {!hasStartedToday && (noData || !hasDeadline) && (
        <>
          <p className="text-secondary text-sm">
            {noData
              ? 'No routine data yet — run your first session.'
              : `${describeSchedule(routine.schedule)} • avg ${msToMMSS(avgMs ?? 0)}`}
          </p>
          <button
            className="btn btn-primary btn-full mt-16"
            onClick={goToTracker}
          >
            Start routine now
          </button>
        </>
      )}

      {!hasStartedToday && !noData && hasDeadline && startAt && !isOverdue && (
        <>
          <div className="routine-start-card-countdown">
            {formatCountdown(startAtMs! - now)}
          </div>
          <div className="routine-timer-label">until routine start time</div>
          <p className="text-secondary text-sm mt-16">
            Start {deadlineIsToday ? 'at' : ''} {describeDeadline(startAt, new Date(now))}
            {' '}&bull; finish by {describeDeadline(deadline!, new Date(now))}
            <br />
            avg {msToMMSS(avgMs ?? 0)}, buffer {msToMMSS(bufferedTotalMs!)}
          </p>
          <button
            className="btn btn-secondary btn-full mt-16"
            onClick={goToTracker}
          >
            Start early
          </button>
        </>
      )}

      {!hasStartedToday && !noData && hasDeadline && startAt && isOverdue && (
        <>
          <div className="routine-start-card-countdown overdue">
            -{msToClock(now - startAtMs!)}
          </div>
          <div className="routine-timer-label">past recommended start time</div>
          <p className="text-secondary text-sm mt-16">
            Finish by {describeDeadline(deadline!, new Date(now))}
          </p>
          <button
            className="btn btn-primary btn-full mt-16"
            onClick={goToTracker}
          >
            Start routine
          </button>
        </>
      )}

      {!hasStartedToday && !noData && hasDeadline && !startAt && (
        <>
          <p className="text-secondary text-sm">{describeSchedule(routine.schedule)}</p>
          <button
            className="btn btn-primary btn-full mt-16"
            onClick={goToTracker}
          >
            Start routine now
          </button>
        </>
      )}

      {permission === 'default' && hasDeadline && (
        <button
          className="btn btn-secondary btn-sm mt-16"
          onClick={handleEnableNotifications}
        >
          Enable notifications
        </button>
      )}

      {showEditLink && (
        <div className="mt-16" style={{ textAlign: 'right' }}>
          <Link to={editorPathFor(routineId)} className="text-accent text-sm" style={{ textDecoration: 'none' }}>
            Edit steps and variants &rsaquo;
          </Link>
        </div>
      )}
    </div>
  );
}

export default RoutineStartCard;
