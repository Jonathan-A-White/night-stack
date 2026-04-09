import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import { formatTime12h, getCurrentTime, getTodayDate } from '../../utils';
import type { NightLog, ClothingItem, BeddingItem, SupplementDef } from '../../types';

export function EveningReview() {
  const { date } = useParams<{ date: string }>();
  const navigate = useNavigate();

  const nightLog = useLiveQuery(
    () => (date ? db.nightLogs.where('date').equals(date).first() : undefined),
    [date]
  );

  const clothingItems = useLiveQuery(() => db.clothingItems.toArray());
  const beddingItems = useLiveQuery(() => db.beddingItems.toArray());
  const supplements = useLiveQuery(() => db.supplementDefs.toArray());

  if (!nightLog) {
    return (
      <div className="empty-state">
        <h3>Loading...</h3>
      </div>
    );
  }

  const clothingMap = new Map(
    (clothingItems ?? []).map((c: ClothingItem) => [c.id, c.name])
  );
  const beddingMap = new Map(
    (beddingItems ?? []).map((b: BeddingItem) => [b.id, b.name])
  );
  const supplementMap = new Map(
    (supplements ?? []).map((s: SupplementDef) => [s.id, s.name])
  );

  const { alarm, stack, eveningIntake, environment, clothing, bedding, eveningNotes } =
    nightLog;

  // Dynamic bedtime awareness for today's review
  const isToday = date === getTodayDate();
  const [currentTime, setCurrentTime] = useState(getCurrentTime());

  useEffect(() => {
    if (!isToday) return;
    const interval = setInterval(() => setCurrentTime(getCurrentTime()), 60000);
    return () => clearInterval(interval);
  }, [isToday]);

  const minutesPastBedtime = (() => {
    if (!isToday) return null;
    const [ch, cm] = currentTime.split(':').map(Number);
    const [bh, bm] = alarm.targetBedtime.split(':').map(Number);
    let diff = (ch * 60 + cm) - (bh * 60 + bm);
    if (diff < 0) diff += 24 * 60;
    // More than 12 hours means we're before bedtime, not after
    if (diff > 12 * 60 || diff === 0) return null;
    return diff;
  })();

  function formatDuration(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m} minute${m !== 1 ? 's' : ''}`;
    if (m === 0) return `${h} hour${h !== 1 ? 's' : ''}`;
    return `${h}h ${m}m`;
  }

  return (
    <div>
      <div className="page-header">
        <h1>Evening Review</h1>
        <p className="subtitle">{date}</p>
      </div>

      {/* Bedtime recommendation */}
      {minutesPastBedtime !== null ? (
        <div className="banner banner-warning">
          Your ideal bedtime was {formatTime12h(alarm.targetBedtime)} ({formatDuration(minutesPastBedtime)} ago). Head to bed now!
        </div>
      ) : (
        <div className="banner banner-success">
          Head to bed at {formatTime12h(alarm.targetBedtime)} for optimal sleep.
        </div>
      )}

      {/* Alarm */}
      <div className="card">
        <div className="card-title">Alarm</div>
        <div className="summary-row">
          <span className="summary-label">Alarm time</span>
          <span className="summary-value">
            {formatTime12h(alarm.actualAlarmTime)}
          </span>
        </div>
        {alarm.isOverridden && (
          <div className="summary-row">
            <span className="summary-label">Default was</span>
            <span className="summary-value">
              {formatTime12h(alarm.expectedAlarmTime)}
            </span>
          </div>
        )}
        <div className="summary-row">
          <span className="summary-label">Target bedtime</span>
          <span className="summary-value">
            {formatTime12h(alarm.targetBedtime)}
          </span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Eating cutoff</span>
          <span className="summary-value">
            {formatTime12h(alarm.eatingCutoff)}
          </span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Supplement time</span>
          <span className="summary-value">
            {formatTime12h(alarm.supplementTime)}
          </span>
        </div>
      </div>

      {/* Supplement Stack */}
      <div className="card">
        <div className="card-title">Supplement Stack</div>
        <div className="summary-row">
          <span className="summary-label">Status</span>
          <span className="summary-value">
            {stack.baseStackUsed ? 'Took as planned' : 'Modified'}
          </span>
        </div>
        {stack.deviations.length > 0 &&
          stack.deviations.map((dev) => (
            <div key={dev.id} className="summary-row">
              <span className="summary-label">
                {supplementMap.get(dev.supplementId) ?? dev.supplementId}
              </span>
              <span className="summary-value">
                {dev.deviation}
                {dev.notes ? ` - ${dev.notes}` : ''}
              </span>
            </div>
          ))}
      </div>

      {/* Food & Drink */}
      <div className="card">
        <div className="card-title">Evening Food &amp; Drink</div>
        <div className="summary-row">
          <span className="summary-label">Last meal</span>
          <span className="summary-value">
            {eveningIntake.lastMealTime
              ? formatTime12h(eveningIntake.lastMealTime)
              : 'Not logged'}
          </span>
        </div>
        {eveningIntake.foodDescription && (
          <div className="summary-row">
            <span className="summary-label">Food</span>
            <span className="summary-value">
              {eveningIntake.foodDescription}
            </span>
          </div>
        )}
        {eveningIntake.flags.filter((f) => f.active).length > 0 && (
          <div className="summary-row">
            <span className="summary-label">Flags</span>
            <span className="summary-value">
              {eveningIntake.flags
                .filter((f) => f.active)
                .map((f) => f.label)
                .join(', ')}
            </span>
          </div>
        )}
        {eveningIntake.alcohol && (
          <div className="summary-row">
            <span className="summary-label">Alcohol</span>
            <span className="summary-value">
              {eveningIntake.alcohol.amount} {eveningIntake.alcohol.type}
              {eveningIntake.alcohol.time
                ? ` at ${formatTime12h(eveningIntake.alcohol.time)}`
                : ''}
            </span>
          </div>
        )}
        {eveningIntake.liquidIntake && (
          <div className="summary-row">
            <span className="summary-label">Liquids</span>
            <span className="summary-value">{eveningIntake.liquidIntake}</span>
          </div>
        )}
      </div>

      {/* Environment */}
      <div className="card">
        <div className="card-title">Environment</div>
        <div className="summary-row">
          <span className="summary-label">Room temp</span>
          <span className="summary-value">
            {environment.roomTempF !== null
              ? `${environment.roomTempF}F`
              : '--'}
          </span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Room humidity</span>
          <span className="summary-value">
            {environment.roomHumidity !== null
              ? `${environment.roomHumidity}%`
              : '--'}
          </span>
        </div>
        {environment.externalWeather &&
          environment.externalWeather.overnightTemps.length > 0 && (
            <div className="summary-row">
              <span className="summary-label">Overnight low</span>
              <span className="summary-value">
                {Math.round(
                  Math.min(
                    ...environment.externalWeather.overnightTemps.map(
                      (r) => r.value
                    )
                  )
                )}
                &deg;F
              </span>
            </div>
          )}
      </div>

      {/* Clothing */}
      <div className="card">
        <div className="card-title">Clothing</div>
        {clothing.length > 0 ? (
          clothing.map((id) => (
            <div key={id} className="summary-row">
              <span className="summary-value">
                {clothingMap.get(id) ?? id}
              </span>
            </div>
          ))
        ) : (
          <p className="text-secondary text-sm">None selected</p>
        )}
      </div>

      {/* Bedding */}
      <div className="card">
        <div className="card-title">Bedding</div>
        {bedding.length > 0 ? (
          bedding.map((id) => (
            <div key={id} className="summary-row">
              <span className="summary-value">
                {beddingMap.get(id) ?? id}
              </span>
            </div>
          ))
        ) : (
          <p className="text-secondary text-sm">None selected</p>
        )}
      </div>

      {/* Notes */}
      {eveningNotes && (
        <div className="card">
          <div className="card-title">Notes</div>
          <p>{eveningNotes}</p>
        </div>
      )}

      <button
        className="btn btn-secondary btn-full mt-16"
        onClick={() => navigate('/tonight')}
      >
        Back to Tonight
      </button>
    </div>
  );
}
