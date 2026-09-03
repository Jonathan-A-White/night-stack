import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import { calculateSchedule, getEveningLogDate, getTomorrowDayOfWeek } from '../../utils';
import { RoutineStartCard } from '../tonight/RoutineStartCard';

/**
 * Routine app home: the evening-routine start card plus shortcuts. The
 * target bedtime comes from tonight's log if it exists, else from the
 * alarm schedule for tomorrow (same derivation TonightPlan uses).
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

  const targetBedtime =
    tonightLog?.alarm.targetBedtime ??
    (tomorrowSchedule ? calculateSchedule(tomorrowSchedule.alarmTime).targetBedtime : null);

  return (
    <div>
      <div className="page-header">
        <h1>Routine</h1>
        <p className="subtitle">Evening routine tracker</p>
      </div>

      {targetBedtime ? (
        <RoutineStartCard targetBedtimeHHMM={targetBedtime} />
      ) : (
        <div className="empty-state"><h3>Loading…</h3></div>
      )}

      <div className="card">
        <Link to="/settings/evening-routine" className="btn btn-secondary btn-full">
          Edit steps and variants
        </Link>
      </div>
    </div>
  );
}

export default RoutineHome;
