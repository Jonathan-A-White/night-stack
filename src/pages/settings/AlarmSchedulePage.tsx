import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import { DAY_NAMES, formatTime12h } from '../../utils';

export { AlarmSchedulePage };

export default function AlarmSchedulePage() {
  const schedules = useLiveQuery(
    () => db.alarmSchedules.orderBy('dayOfWeek').toArray()
  );

  if (!schedules) {
    return <div className="empty-state"><h3>Loading...</h3></div>;
  }

  const handleToggleAlarm = async (id: string, hasAlarm: boolean) => {
    await db.alarmSchedules.update(id, { hasAlarm: !hasAlarm });
  };

  const handleAlarmTimeChange = async (id: string, alarmTime: string) => {
    await db.alarmSchedules.update(id, { alarmTime });
  };

  const handleNaturalWakeTimeChange = async (id: string, naturalWakeTime: string) => {
    await db.alarmSchedules.update(id, { naturalWakeTime: naturalWakeTime || null });
  };

  return (
    <div>
      <div className="page-header">
        <Link to="/settings" className="text-accent" style={{ textDecoration: 'none', fontSize: 14 }}>
          &lsaquo; Settings
        </Link>
        <h1>Alarm Schedule</h1>
      </div>

      {schedules.map((sched) => (
        <div key={sched.id} className="card">
          <div className="flex items-center justify-between mb-8">
            <span className="fw-600">{DAY_NAMES[sched.dayOfWeek]}</span>
            <label className="switch">
              <input
                type="checkbox"
                checked={sched.hasAlarm}
                onChange={() => handleToggleAlarm(sched.id, sched.hasAlarm)}
              />
              <span className="switch-slider" />
            </label>
          </div>

          {sched.hasAlarm ? (
            <div className="form-group">
              <label className="form-label">Alarm Time</label>
              <input
                type="time"
                className="form-input"
                value={sched.alarmTime}
                onChange={(e) => handleAlarmTimeChange(sched.id, e.target.value)}
              />
              <span className="text-secondary text-sm mt-8" style={{ display: 'block' }}>
                {formatTime12h(sched.alarmTime)}
              </span>
            </div>
          ) : (
            <div className="form-group">
              <label className="form-label">Expected Natural Wake Time</label>
              <input
                type="time"
                className="form-input"
                value={sched.naturalWakeTime ?? ''}
                onChange={(e) => handleNaturalWakeTimeChange(sched.id, e.target.value)}
              />
              {sched.naturalWakeTime && (
                <span className="text-secondary text-sm mt-8" style={{ display: 'block' }}>
                  {formatTime12h(sched.naturalWakeTime)}
                </span>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
