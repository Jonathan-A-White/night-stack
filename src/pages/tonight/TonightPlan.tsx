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
  getEveningLogDate,
  isTimeAfter,
  DAY_NAMES,
} from '../../utils';
import { fetchOvernightWeather, getOvernightLow } from '../../services/weather';
import { evaluateRules, type EvaluatedRule } from '../../services/rules';
import {
  describePressure,
  estimateStartingRoomTemp,
  recommendForTonight,
  type Recommendation,
  type RecommenderInputs,
} from '../../services/recommender';
import type { ExternalWeather, MiddayCopingItem, AcCurveProfile } from '../../types';
import { RoutineStartCard } from './RoutineStartCard';

const RECOMMENDATION_CATEGORY_LABEL: Record<Recommendation['items'][number]['category'], string> = {
  clothing: 'Clothing',
  bedding: 'Bedding',
  ac: 'AC',
  fan: 'Fan',
};

export function TonightPlan() {
  const navigate = useNavigate();

  // Late bedtime detection: if it's early morning (before 6 AM) and there's
  // no evening log for last night yet, the user is probably still up and
  // going to bed late. Show this morning's alarm instead of tomorrow's.
  const eveningDate = getEveningLogDate();
  const existingEveningLog = useLiveQuery(
    async () =>
      (await db.nightLogs.where('date').equals(eveningDate).first()) ?? null,
    [eveningDate],
  );
  const now = new Date();
  const isLateBedtime = now.getHours() < 6 && existingEveningLog === null;
  const alarmDow = isLateBedtime ? now.getDay() : getTomorrowDayOfWeek();

  const alarmSchedule = useLiveQuery(
    () => db.alarmSchedules.where('dayOfWeek').equals(alarmDow).first(),
    [alarmDow],
  );

  const settings = useLiveQuery(() => db.appSettings.get('default'));
  const rules = useLiveQuery(() => db.sleepRules.toArray());
  const recentLogs = useLiveQuery(
    () => db.nightLogs.orderBy('date').reverse().limit(7).toArray(),
    []
  );
  // All logs feed the recommender. Dexie returns a small number, so pulling
  // the full history is fine; the filter to "labeled" nights happens inside.
  const allLogs = useLiveQuery(() => db.nightLogs.toArray(), []);
  const clothingItems = useLiveQuery(() => db.clothingItems.toArray(), []);
  const beddingItems = useLiveQuery(() => db.beddingItems.toArray(), []);
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

  // Inputs for the recommender that the user adjusts before bed. These aren't
  // persisted — they're a dial you turn to see what tonight should look like.
  const [plannedRoomTemp, setPlannedRoomTemp] = useState<string>('');
  const [plannedAcCurve, setPlannedAcCurve] = useState<AcCurveProfile | ''>('');
  const [plannedAcSetpoint, setPlannedAcSetpoint] = useState<string>('');
  const [hadAlcohol, setHadAlcohol] = useState(false);
  // Recommender v2 inputs (ux.md T1): continuous replacements for the
  // dropped ateLate/overate toggles + optional humidity input.
  const [hoursSinceLastMeal, setHoursSinceLastMeal] = useState<string>('');
  const [plannedRoomHumidity, setPlannedRoomHumidity] = useState<string>('');
  // ux.md T2: the forecast-low → starting-room prefill is one-shot. Once
  // seeded (or once the user edits the field), don't auto-fill again even
  // if the weather fetch bounces or the user clears the input.
  const [hasPrefilledRoomTemp, setHasPrefilledRoomTemp] = useState(false);

  // Detect an in-progress evening log draft so the CTA can read
  // "Resume Evening Log" instead of "Start Evening Log". EveningLog persists
  // its wizard state to localStorage under this key and clears it on submit.
  const [hasEveningLogDraft, setHasEveningLogDraft] = useState(() => {
    try {
      return (
        localStorage.getItem(`evening-log-draft-${getEveningLogDate()}`) !==
        null
      );
    } catch {
      return false;
    }
  });

  // Re-check on window focus in case the draft was cleared/created in another
  // tab or after completing the log and returning via the back button.
  useEffect(() => {
    function refresh() {
      try {
        setHasEveningLogDraft(
          localStorage.getItem(
            `evening-log-draft-${getEveningLogDate()}`,
          ) !== null,
        );
      } catch {
        setHasEveningLogDraft(false);
      }
    }
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  const defaultAlarm = alarmSchedule?.hasAlarm
    ? alarmSchedule.alarmTime
    : alarmSchedule?.naturalWakeTime ?? '07:00';

  const activeAlarm = overrideTime || defaultAlarm;
  const schedule = calculateSchedule(activeAlarm);
  const currentTime = getCurrentTime();
  const isPastCutoff = isTimeAfter(currentTime, schedule.eatingCutoff);

  // In late mode, compute approximate time until alarm
  const alarmCountdown = (() => {
    if (!isLateBedtime) return null;
    const [h, m] = activeAlarm.split(':').map(Number);
    const target = new Date();
    target.setHours(h, m, 0, 0);
    if (target.getTime() <= Date.now()) target.setDate(target.getDate() + 1);
    const diffMs = target.getTime() - Date.now();
    const hours = Math.floor(diffMs / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  })();

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

  // ux.md T2: one-shot prefill of starting room temp from the forecast low.
  // Runs once per mount as soon as both the overnight low and an empty
  // `plannedRoomTemp` are available. Doesn't re-fire if the user clears the
  // field; `hasPrefilledRoomTemp` latches the "we already tried" state.
  useEffect(() => {
    if (hasPrefilledRoomTemp) return;
    if (plannedRoomTemp !== '') {
      // User typed something — don't touch, but mark as "handled" so we
      // won't pave over a later clear.
      setHasPrefilledRoomTemp(true);
      return;
    }
    if (overnightLow === null) return;
    setPlannedRoomTemp(String(estimateStartingRoomTemp(overnightLow)));
    setHasPrefilledRoomTemp(true);
  }, [overnightLow, plannedRoomTemp, hasPrefilledRoomTemp]);

  const parsedRoomTemp = plannedRoomTemp ? parseFloat(plannedRoomTemp) : null;
  const parsedHoursSinceLastMeal = hoursSinceLastMeal
    ? parseFloat(hoursSinceLastMeal)
    : null;
  const parsedRoomHumidity = plannedRoomHumidity
    ? parseFloat(plannedRoomHumidity)
    : null;

  // ux.md T3: pressure = overnightLow - plannedRoomTemp. Only surfaced when
  // both are set; helps the user reason about how hard tonight will cool.
  const pressure =
    overnightLow !== null && parsedRoomTemp !== null && Number.isFinite(parsedRoomTemp)
      ? overnightLow - parsedRoomTemp
      : null;
  const pressureDescription = pressure !== null ? describePressure(pressure) : null;

  // Compute the tonight recommendation from user-adjusted inputs + past logs.
  const recommendation = (() => {
    if (!allLogs || !clothingItems || !beddingItems) return null;
    const inputs: RecommenderInputs = {
      overnightLowF: overnightLow,
      startingRoomTempF:
        parsedRoomTemp !== null && Number.isFinite(parsedRoomTemp) ? parsedRoomTemp : null,
      roomHumidity:
        parsedRoomHumidity !== null && Number.isFinite(parsedRoomHumidity)
          ? parsedRoomHumidity
          : null,
      hoursSinceLastMeal:
        parsedHoursSinceLastMeal !== null && Number.isFinite(parsedHoursSinceLastMeal)
          ? parsedHoursSinceLastMeal
          : null,
      // Always null at plan time — cooling rate is a derived-from-past
      // feature the user can't plan tonight. Distance function's
      // missing-dimension half-penalty handles it.
      coolingRate1to4F: null,
      alcohol: hadAlcohol,
      plannedAcCurve: plannedAcCurve || null,
      plannedAcSetpointF: plannedAcSetpoint ? parseFloat(plannedAcSetpoint) : null,
    };
    return recommendForTonight(inputs, allLogs, clothingItems, beddingItems);
  })();

  if (!alarmSchedule) {
    return <div className="empty-state"><h3>Loading...</h3></div>;
  }

  return (
    <div>
      <div className="page-header">
        <h1>Tonight</h1>
        <p className="subtitle">
          {isLateBedtime
            ? 'Going to bed late'
            : `Alarm for ${DAY_NAMES[alarmDow]}`}
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

      {/* Late bedtime banner */}
      {isLateBedtime && (
        <div className="banner banner-warning">
          It's late &mdash; your {DAY_NAMES[alarmDow]} alarm rings in {alarmCountdown}.
          Log your evening before bed.
        </div>
      )}

      {/* Calculated schedule (hidden in late mode — all times have passed) */}
      {!isLateBedtime && (
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
      )}

      {/* Past cutoff warning */}
      {!isLateBedtime && isPastCutoff && (
        <div className="banner banner-danger">
          Eating cutoff has passed ({formatTime12h(schedule.eatingCutoff)}). Avoid food from now on for better sleep.
        </div>
      )}

      {/* Evening routine start card (hidden in late mode) */}
      {!isLateBedtime && (
        <RoutineStartCard targetBedtimeHHMM={schedule.targetBedtime} />
      )}

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

      {/* Tonight's Recommendation (nearest-neighbor retrieval) */}
      <div className="card">
        <div className="card-title">Tonight's Recommendation</div>
        <p className="text-secondary text-sm mb-8">
          Based on past nights with similar inputs. Adjust the dials to match
          what you know about tonight, then see what worked historically.
        </p>

        <div className="form-group">
          <label className="form-label">Starting room temp (F)</label>
          <input
            type="number"
            className="form-input"
            placeholder={overnightLow !== null ? 'e.g. 67' : 'e.g. 67'}
            value={plannedRoomTemp}
            onChange={(e) => {
              setPlannedRoomTemp(e.target.value);
              // Any user edit (including clearing) means "I've handled
              // this field" — don't re-auto-fill from the forecast later.
              setHasPrefilledRoomTemp(true);
            }}
          />
          {overnightLow !== null && (
            <p className="text-secondary text-sm mt-8">
              Estimated from tonight's forecast low (&plusmn;3&deg;F). Measure if you can.
            </p>
          )}
        </div>

        {/* Pressure indicator (ux.md T3). Renders only when both inputs are
            set; band thresholds tuned from the 2026-04-17 n=11 export. */}
        {pressureDescription && (
          <div className="form-group">
            <div className="flex items-center justify-between">
              <span className="text-secondary">Cooling pressure</span>
              <span className="fw-600">
                {pressure! > 0 ? '+' : ''}{Math.round(pressure!)}&deg;F
              </span>
            </div>
            <p className="text-secondary text-sm mt-8">{pressureDescription.text}</p>
          </div>
        )}

        {/* AC curve only renders when the user owns a window AC (Q1 +
            logging-fixes T4). Hidden entirely when `settings.acInstalled`
            is false so we're not asking them to pick a curve they can't
            run. */}
        {settings?.acInstalled && (
          <>
            <div className="form-group">
              <label className="form-label">Planned AC curve</label>
              <select
                className="form-input"
                value={plannedAcCurve}
                onChange={(e) => setPlannedAcCurve(e.target.value as AcCurveProfile | '')}
              >
                <option value="">-- match any --</option>
                <option value="off">Off</option>
                <option value="steady">Steady</option>
                <option value="cool_early">Cool early</option>
                <option value="hold_cold">Hold cold</option>
                <option value="warm_late">Warm late</option>
                <option value="custom">Custom</option>
              </select>
            </div>

            {plannedAcCurve && plannedAcCurve !== 'off' && (
              <div className="form-group">
                <label className="form-label">AC setpoint (F)</label>
                <input
                  type="number"
                  className="form-input"
                  placeholder="e.g. 64"
                  value={plannedAcSetpoint}
                  onChange={(e) => setPlannedAcSetpoint(e.target.value)}
                />
              </div>
            )}
          </>
        )}

        {/*
         * Recommender v2 evening-intake dials. The old `ateLate`/`overate`
         * toggles were removed (distance-function.md T1 + T7) — they were
         * zero-signal in the 2026-04-17 analysis. The continuous
         * replacements (`hoursSinceLastMeal`, `roomHumidity`) go below.
         * Alcohol stays as a boolean nudge.
         */}
        <div className="form-group">
          <label className="form-label">Hours since last meal</label>
          <input
            type="number"
            step="0.25"
            min="0"
            className="form-input"
            placeholder="e.g. 3"
            value={hoursSinceLastMeal}
            onChange={(e) => setHoursSinceLastMeal(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Room humidity (%) — optional</label>
          <input
            type="number"
            step="1"
            min="0"
            max="100"
            className="form-input"
            placeholder="e.g. 45"
            value={plannedRoomHumidity}
            onChange={(e) => setPlannedRoomHumidity(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label">What you drank tonight</label>
          <div className="toggle-grid">
            <button
              className={`toggle-btn${hadAlcohol ? ' active' : ''}`}
              onClick={() => setHadAlcohol((v) => !v)}
            >
              Alcohol
            </button>
          </div>
        </div>

        {recommendation && (
          <div className="mt-8">
            {recommendation.warning && (
              <div className="banner banner-warning mb-8">
                {recommendation.warning}
              </div>
            )}
            <p className="text-sm text-secondary mb-8">
              {recommendation.summary}
            </p>

            {recommendation.items.length > 0 ? (
              <div>
                <div className="card-title">
                  {recommendation.mode === 'exploratory'
                    ? 'Starting point (experimental)'
                    : 'Stack that worked'}
                </div>
                {recommendation.items.map((item, i) => (
                  <div key={`${item.category}-${i}`} className="summary-row">
                    <span className="summary-label">
                      {RECOMMENDATION_CATEGORY_LABEL[item.category]}
                    </span>
                    <span className="summary-value">
                      {item.label}
                      {recommendation.mode === 'consensus' && (
                        <span className="text-secondary text-sm">
                          {' '}— {Math.round(item.support * 100)}% of {item.n}
                        </span>
                      )}
                      {recommendation.mode === 'exploratory' && (
                        <span className="text-secondary text-sm">
                          {' '}— from 1 similar night
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              recommendation.totalLabeledNights === 0 && (
                <p className="text-secondary text-sm">
                  Label a few mornings with "too hot / too cold / just right"
                  to start seeing a prescription here.
                </p>
              )
            )}

            {recommendation.neighbors.length > 0 && (
              <div className="mt-8">
                <div className="card-title">Similar past nights</div>
                {recommendation.neighbors.map((n) => (
                  <div key={n.log.id} className="summary-row">
                    <span className="summary-label">{n.log.date}</span>
                    <span
                      className={`summary-value ${
                        n.comfort === 'just_right'
                          ? 'text-success'
                          : n.comfort === 'too_hot' || n.comfort === 'too_cold'
                            ? 'text-danger'
                            : ''
                      }`}
                    >
                      {n.comfort ?? '--'}
                      <span className="text-secondary text-sm">
                        {' '}(d={n.distance.toFixed(2)})
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
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

      {/* Start / Resume Evening Log */}
      <button
        className="btn btn-primary btn-full mt-16"
        onClick={() => navigate('/tonight/log')}
      >
        {hasEveningLogDraft ? 'Resume Evening Log' : 'Start Evening Log'}
      </button>
    </div>
  );
}
