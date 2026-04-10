import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import {
  getTomorrowDayOfWeek,
  calculateSchedule,
  formatTime12h,
  getCurrentTime,
  getTodayDate,
  isTimeAfter,
  DAY_NAMES,
} from '../../utils';
import { fetchOvernightWeather, getOvernightLow } from '../../services/weather';
import { evaluateRules, type EvaluatedRule } from '../../services/rules';
import type { ExternalWeather, MiddayCopingItem } from '../../types';
import { RoutineStartCard } from './RoutineStartCard';

export function TonightPlan() {
  const navigate = useNavigate();
  const tomorrowDow = getTomorrowDayOfWeek();

  const alarmSchedule = useLiveQuery(
    () => db.alarmSchedules.where('dayOfWeek').equals(tomorrowDow).first(),
    [tomorrowDow]
  );

  const settings = useLiveQuery(() => db.appSettings.get('default'));
  const rules = useLiveQuery(() => db.sleepRules.toArray());
  const recentLogs = useLiveQuery(
    () => db.nightLogs.orderBy('date').reverse().limit(7).toArray(),
    []
  );
  // Today's night log (if already logged) — drives midday-coping rules.
  const todayLog = useLiveQuery(
    () => db.nightLogs.where('date').equals(getTodayDate()).first(),
    []
  );
  const middayCopingItems = useLiveQuery(() => db.middayCopingItems.toArray());

  const [overrideTime, setOverrideTime] = useState('');
  const [weather, setWeather] = useState<ExternalWeather | null>(null);
  const [weatherError, setWeatherError] = useState('');
  const [evaluatedRules, setEvaluatedRules] = useState<EvaluatedRule[]>([]);

  const defaultAlarm = alarmSchedule?.hasAlarm
    ? alarmSchedule.alarmTime
    : alarmSchedule?.naturalWakeTime ?? '07:00';

  const activeAlarm = overrideTime || defaultAlarm;
  const schedule = calculateSchedule(activeAlarm);
  const currentTime = getCurrentTime();
  const isPastCutoff = isTimeAfter(currentTime, schedule.eatingCutoff);

  // Fetch weather on mount
  useEffect(() => {
    if (!settings) return;
    fetchOvernightWeather(settings.latitude, settings.longitude)
      .then(setWeather)
      .catch(() => setWeatherError('Could not load weather data'));
  }, [settings]);

  // Evaluate rules when data is ready
  useEffect(() => {
    if (!rules) return;
    const itemMap = new Map<string, MiddayCopingItem>(
      (middayCopingItems ?? []).map((m) => [m.id, m]),
    );
    const result = evaluateRules(rules, {
      weather,
      currentRoomTemp: null,
      recentLogs: recentLogs ?? [],
      currentLog: todayLog ?? null,
      middayCopingItems: itemMap,
    });
    setEvaluatedRules(result);
  }, [rules, weather, recentLogs, todayLog, middayCopingItems]);

  const overnightLow = weather ? getOvernightLow(weather) : null;

  if (!alarmSchedule) {
    return <div className="empty-state"><h3>Loading...</h3></div>;
  }

  return (
    <div>
      <div className="page-header">
        <h1>Tonight</h1>
        <p className="subtitle">
          Alarm for {DAY_NAMES[tomorrowDow]}
        </p>
      </div>

      {/* Alarm card */}
      <div className="card">
        <div className="card-title">Alarm</div>
        <div className="flex items-center justify-between mb-8">
          <span className="text-secondary">
            {alarmSchedule.hasAlarm ? 'Scheduled' : 'Natural wake'}
          </span>
          <span className="fs-20 fw-600 text-accent">
            {formatTime12h(defaultAlarm)}
          </span>
        </div>
        <div className="form-group">
          <label className="form-label">Override alarm time</label>
          <input
            type="time"
            className="form-input"
            value={overrideTime}
            onChange={(e) => setOverrideTime(e.target.value)}
          />
        </div>
      </div>

      {/* Calculated schedule */}
      <div className="card">
        <div className="card-title">Schedule</div>
        <div className="metrics-row">
          <div className="metric-card">
            <div className="metric-value">{formatTime12h(schedule.targetBedtime)}</div>
            <div className="metric-label">Bedtime</div>
          </div>
          <div className="metric-card">
            <div className="metric-value">{formatTime12h(schedule.eatingCutoff)}</div>
            <div className="metric-label">Eating Cutoff</div>
          </div>
          <div className="metric-card">
            <div className="metric-value">{formatTime12h(schedule.supplementTime)}</div>
            <div className="metric-label">Supplements</div>
          </div>
        </div>
      </div>

      {/* Past cutoff warning */}
      {isPastCutoff && (
        <div className="banner banner-danger">
          Eating cutoff has passed ({formatTime12h(schedule.eatingCutoff)}). Avoid food from now on for better sleep.
        </div>
      )}

      {/* Evening routine start card */}
      <RoutineStartCard targetBedtimeHHMM={schedule.targetBedtime} />

      {/* Weather */}
      <div className="card">
        <div className="card-title">Overnight Weather</div>
        {weatherError && (
          <p className="text-secondary text-sm">{weatherError}</p>
        )}
        {overnightLow !== null && (
          <div className="flex items-center justify-between">
            <span className="text-secondary">Overnight low</span>
            <span className="fs-20 fw-600 text-accent">
              {Math.round(overnightLow)}&deg;F
            </span>
          </div>
        )}
        {!weather && !weatherError && (
          <p className="text-secondary text-sm">Loading weather...</p>
        )}
      </div>

      {/* Rules / Recommendations */}
      {evaluatedRules.length > 0 && (
        <div className="card">
          <div className="card-title">Recommendations</div>
          {evaluatedRules
            .filter((er) => er.triggered)
            .map((er) => (
              <div
                key={er.rule.id}
                className={`rec-card rec-${er.rule.priority}`}
              >
                <div className="rec-name">{er.rule.name}</div>
                <div className="rec-text">{er.rule.recommendation}</div>
              </div>
            ))}
        </div>
      )}

      {/* Start Evening Log */}
      <button
        className="btn btn-primary btn-full mt-16"
        onClick={() => navigate('/tonight/log')}
      >
        Start Evening Log
      </button>
    </div>
  );
}
