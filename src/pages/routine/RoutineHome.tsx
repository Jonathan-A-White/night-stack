import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import { calculateSchedule, getEveningLogDate, getTomorrowDayOfWeek } from '../../utils';
import { sortRoutines } from '../../services/routineSchedule';
import { ROUTINES_SETTINGS_PATH, VAULT_SETTINGS_PATH } from '../../services/routinePaths';
import { RoutineStartCard } from '../tonight/RoutineStartCard';

/**
 * Routine app home: one start card per active routine. The target
 * bedtime (only the evening routine's 'bedtime' anchor uses it) comes
 * from tonight's log if it exists, else from the alarm schedule for
 * tomorrow (same derivation TonightPlan uses).
 */
export function RoutineHome() {
  const eveningDate = getEveningLogDate();
  const tonightLog = useLiveQuery(
    async () => (await db.nightLogs.where('date').equals(eveningDate).first()) ?? null,
    [eveningDate],
  );
  const tomorrowSchedule = useLiveQuery(
    () => db.alarmSchedules.where('dayOfWeek').equals(getTomorrowDayOfWeek()).first(),
    [],
  );
  const routines = useLiveQuery(() => db.routines.toArray(), []);

  const targetBedtime =
    tonightLog?.alarm.targetBedtime ??
    (tomorrowSchedule ? calculateSchedule(tomorrowSchedule.alarmTime).targetBedtime : null);

  const active = routines ? sortRoutines(routines).filter((r) => r.isActive) : null;

  return (
    <div>
      <div className="page-header">
        <h1>Routines</h1>
        <p className="subtitle">Timed checklists with a start-by countdown</p>
      </div>

      {active == null ? (
        <div className="empty-state"><h3>Loading…</h3></div>
      ) : active.length === 0 ? (
        <div className="empty-state">
          <h3>No routines</h3>
          <p className="text-secondary text-sm">
            <Link to={ROUTINES_SETTINGS_PATH}>Add one in Settings.</Link>
          </p>
        </div>
      ) : (
        active.map((routine) => (
          <RoutineStartCard
            key={routine.id}
            routine={routine}
            targetBedtimeHHMM={targetBedtime}
            showEditLink
          />
        ))
      )}

      <div className="card">
        <Link to={ROUTINES_SETTINGS_PATH} className="btn btn-secondary btn-full mb-8">
          Manage routines
        </Link>
        <Link to={VAULT_SETTINGS_PATH} className="btn btn-secondary btn-full">
          Password vault
        </Link>
      </div>
    </div>
  );
}

export default RoutineHome;
