import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import {
  getTomorrowDayOfWeek,
  calculateSchedule,
  formatTime12h,
  isTimeAfter,
  getTodayDate,
  createBlankNightLog,
  getCurrentTime,
  DAY_NAMES,
} from '../../utils';
import { fetchOvernightWeather, getOvernightLow } from '../../services/weather';
import { scheduleNotifications } from '../../services/notifications';
import type {
  StackDeviation,
  EveningFlag,
  AlcoholEntry,
  ExternalWeather,
  ClothingItem,
  BeddingItem,
  SupplementDef,
} from '../../types';

const TOTAL_STEPS = 7;

export function EveningLog() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  // DB queries
  const tomorrowDow = getTomorrowDayOfWeek();
  const alarmSchedule = useLiveQuery(
    () => db.alarmSchedules.where('dayOfWeek').equals(tomorrowDow).first(),
    [tomorrowDow]
  );
  const settings = useLiveQuery(() => db.appSettings.get('default'));
  const supplements = useLiveQuery(
    () => db.supplementDefs.orderBy('sortOrder').toArray()
  );
  const clothingItems = useLiveQuery(
    () => db.clothingItems.orderBy('sortOrder').filter((c) => c.isActive).toArray()
  );
  const beddingItems = useLiveQuery(
    () => db.beddingItems.orderBy('sortOrder').filter((b) => b.isActive).toArray()
  );
  const lastLog = useLiveQuery(
    () => db.nightLogs.orderBy('date').reverse().first(),
    []
  );

  // Step 1: Alarm
  const [overrideTime, setOverrideTime] = useState('');

  // Step 2: Supplements
  const [baseStackUsed, setBaseStackUsed] = useState(true);
  const [deviations, setDeviations] = useState<StackDeviation[]>([]);

  // Step 3: Food & Drink
  const [lastMealTime, setLastMealTime] = useState('');
  const [foodDescription, setFoodDescription] = useState('');
  const [flags, setFlags] = useState<EveningFlag[]>([
    { type: 'overate', label: 'Overate', active: false },
    { type: 'high_salt', label: 'High salt', active: false },
    { type: 'nitrates', label: 'Nitrates', active: false },
    { type: 'questionable_food', label: 'Questionable food', active: false },
    { type: 'late_meal', label: 'Late meal', active: false },
  ]);
  const [hasAlcohol, setHasAlcohol] = useState(false);
  const [alcohol, setAlcohol] = useState<AlcoholEntry>({
    type: '',
    amount: '',
    time: '',
  });
  const [liquidIntake, setLiquidIntake] = useState('');

  // Step 4: Environment
  const [roomTempF, setRoomTempF] = useState<string>('');
  const [roomHumidity, setRoomHumidity] = useState<string>('');
  const [weather, setWeather] = useState<ExternalWeather | null>(null);

  // Step 5: Clothing
  const [selectedClothing, setSelectedClothing] = useState<string[]>([]);

  // Step 6: Bedding
  const [selectedBedding, setSelectedBedding] = useState<string[]>([]);

  // Step 7: Notes
  const [eveningNotes, setEveningNotes] = useState('');

  // Derived alarm values
  const defaultAlarm = alarmSchedule?.hasAlarm
    ? alarmSchedule.alarmTime
    : alarmSchedule?.naturalWakeTime ?? '07:00';
  const activeAlarm = overrideTime || defaultAlarm;
  const schedule = calculateSchedule(activeAlarm);

  // Fetch weather
  useEffect(() => {
    if (!settings) return;
    fetchOvernightWeather(settings.latitude, settings.longitude)
      .then(setWeather)
      .catch(() => {});
  }, [settings]);

  // Helper: is supplement on today for every_other_day
  function isEveryOtherDayOn(supp: SupplementDef): boolean {
    if (!lastLog) return true; // default to "on" if no prior log
    const lastDeviations = lastLog.stack.deviations;
    const wasSkipped = lastDeviations.some(
      (d) => d.supplementId === supp.id && d.deviation === 'skipped'
    );
    // If it was skipped last time, it's on today; if taken last time, off today
    return wasSkipped || !lastLog.stack.baseStackUsed;
  }

  function toggleFlag(index: number) {
    setFlags((prev) =>
      prev.map((f, i) => (i === index ? { ...f, active: !f.active } : f))
    );
  }

  function toggleClothing(id: string) {
    setSelectedClothing((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  }

  function toggleBedding(id: string) {
    setSelectedBedding((prev) =>
      prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]
    );
  }

  function addDeviation(supplementId: string) {
    setDeviations((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        supplementId,
        deviation: 'skipped',
        notes: '',
      },
    ]);
  }

  function updateDeviation(
    id: string,
    field: keyof StackDeviation,
    value: string
  ) {
    setDeviations((prev) =>
      prev.map((d) => (d.id === id ? { ...d, [field]: value } : d))
    );
  }

  function removeDeviation(id: string) {
    setDeviations((prev) => prev.filter((d) => d.id !== id));
  }

  async function handleSave() {
    const date = getTodayDate();
    const isOverridden = overrideTime !== '' && overrideTime !== defaultAlarm;

    const nightLog = createBlankNightLog(date, {
      expectedAlarmTime: defaultAlarm,
      actualAlarmTime: activeAlarm,
      isOverridden,
      targetBedtime: schedule.targetBedtime,
      eatingCutoff: schedule.eatingCutoff,
      supplementTime: schedule.supplementTime,
    });

    nightLog.stack = { baseStackUsed, deviations };
    nightLog.eveningIntake = {
      lastMealTime,
      foodDescription,
      flags,
      alcohol: hasAlcohol ? alcohol : null,
      liquidIntake,
    };
    nightLog.environment = {
      roomTempF: roomTempF ? parseFloat(roomTempF) : null,
      roomHumidity: roomHumidity ? parseFloat(roomHumidity) : null,
      externalWeather: weather,
    };
    nightLog.clothing = selectedClothing;
    nightLog.bedding = selectedBedding;
    nightLog.eveningNotes = eveningNotes;

    await db.nightLogs.put(nightLog);

    // Schedule notifications
    if (settings) {
      scheduleNotifications(nightLog.alarm, settings.notificationPreferences);
    }

    navigate(`/tonight/review/${date}`);
  }

  const overnightLow = weather ? getOvernightLow(weather) : null;
  const isMealAfterCutoff =
    lastMealTime && isTimeAfter(lastMealTime, schedule.eatingCutoff);

  if (!alarmSchedule || !supplements) {
    return (
      <div className="empty-state">
        <h3>Loading...</h3>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>Evening Log</h1>
        <p className="subtitle">Step {step} of {TOTAL_STEPS}</p>
      </div>

      {/* Step progress bar */}
      <div className="step-progress">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <div
            key={i}
            className={`step-dot${i + 1 < step ? ' completed' : ''}${i + 1 === step ? ' active' : ''}`}
          />
        ))}
      </div>

      {/* Step 1: Alarm Confirmation */}
      {step === 1 && (
        <div>
          <div className="card">
            <div className="card-title">Alarm for {DAY_NAMES[tomorrowDow]}</div>
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
          <div className="card">
            <div className="card-title">Calculated Schedule</div>
            <div className="metrics-row">
              <div className="metric-card">
                <div className="metric-value">
                  {formatTime12h(schedule.targetBedtime)}
                </div>
                <div className="metric-label">Bedtime</div>
              </div>
              <div className="metric-card">
                <div className="metric-value">
                  {formatTime12h(schedule.eatingCutoff)}
                </div>
                <div className="metric-label">Eating Cutoff</div>
              </div>
              <div className="metric-card">
                <div className="metric-value">
                  {formatTime12h(schedule.supplementTime)}
                </div>
                <div className="metric-label">Supplements</div>
              </div>
            </div>
          </div>
          {isTimeAfter(getCurrentTime(), schedule.eatingCutoff) && (
            <div className="banner banner-warning">
              Current time is past your eating cutoff ({formatTime12h(schedule.eatingCutoff)}). Avoid eating from now on.
            </div>
          )}
        </div>
      )}

      {/* Step 2: Supplement Stack */}
      {step === 2 && (
        <div>
          <div className="card">
            <div className="card-title">Supplement Stack</div>
            <div className="switch-row">
              <span>Took as planned</span>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={baseStackUsed}
                  onChange={(e) => setBaseStackUsed(e.target.checked)}
                />
                <span className="switch-slider" />
              </label>
            </div>
          </div>

          {!baseStackUsed && (
            <div className="card">
              <div className="card-title">Deviations</div>
              {supplements
                .filter((s) => s.isActive)
                .map((supp) => {
                  const isEOD = supp.frequency === 'every_other_day';
                  const isOnDay = isEOD ? isEveryOtherDayOn(supp) : true;
                  const existing = deviations.find(
                    (d) => d.supplementId === supp.id
                  );
                  return (
                    <div key={supp.id} className="mb-8">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="fw-600">{supp.name}</span>
                          <span className="text-secondary text-sm">
                            {' '}({supp.defaultDose})
                          </span>
                          {isEOD && (
                            <span
                              className={`text-sm ${isOnDay ? 'text-success' : 'text-secondary'}`}
                            >
                              {' '} - {isOnDay ? 'ON day' : 'OFF day'}
                            </span>
                          )}
                        </div>
                        {!existing && (
                          <button
                            className="btn btn-sm btn-secondary"
                            onClick={() => addDeviation(supp.id)}
                          >
                            Log deviation
                          </button>
                        )}
                      </div>
                      {existing && (
                        <div className="mt-8">
                          <div className="form-group">
                            <select
                              className="form-input"
                              value={existing.deviation}
                              onChange={(e) =>
                                updateDeviation(
                                  existing.id,
                                  'deviation',
                                  e.target.value
                                )
                              }
                            >
                              <option value="skipped">Skipped</option>
                              <option value="reduced">Reduced</option>
                              <option value="increased">Increased</option>
                              <option value="substituted">Substituted</option>
                              <option value="added">Added</option>
                            </select>
                          </div>
                          <div className="form-group">
                            <input
                              type="text"
                              className="form-input"
                              placeholder="Notes (optional)"
                              value={existing.notes}
                              onChange={(e) =>
                                updateDeviation(
                                  existing.id,
                                  'notes',
                                  e.target.value
                                )
                              }
                            />
                          </div>
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={() => removeDeviation(existing.id)}
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* Step 3: Evening Food & Drink */}
      {step === 3 && (
        <div>
          <div className="card">
            <div className="card-title">Evening Food &amp; Drink</div>
            <div className="form-group">
              <label className="form-label">Last meal time</label>
              <input
                type="time"
                className="form-input"
                value={lastMealTime}
                onChange={(e) => setLastMealTime(e.target.value)}
              />
            </div>
            {isMealAfterCutoff && (
              <div className="banner banner-danger">
                Meal time is after eating cutoff (
                {formatTime12h(schedule.eatingCutoff)}).
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Food description</label>
              <textarea
                className="form-input"
                value={foodDescription}
                onChange={(e) => setFoodDescription(e.target.value)}
                placeholder="What did you eat?"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Flags</label>
              <div className="toggle-grid">
                {flags.map((flag, i) => (
                  <button
                    key={flag.type}
                    className={`toggle-btn${flag.active ? ' active' : ''}`}
                    onClick={() => toggleFlag(i)}
                  >
                    {flag.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-title">Alcohol</div>
            <div className="switch-row">
              <span>Had alcohol</span>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={hasAlcohol}
                  onChange={(e) => setHasAlcohol(e.target.checked)}
                />
                <span className="switch-slider" />
              </label>
            </div>
            {hasAlcohol && (
              <div>
                <div className="form-group">
                  <label className="form-label">Type</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Red wine"
                    value={alcohol.type}
                    onChange={(e) =>
                      setAlcohol((a) => ({ ...a, type: e.target.value }))
                    }
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Amount</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. 4oz"
                    value={alcohol.amount}
                    onChange={(e) =>
                      setAlcohol((a) => ({ ...a, amount: e.target.value }))
                    }
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Time</label>
                  <input
                    type="time"
                    className="form-input"
                    value={alcohol.time}
                    onChange={(e) =>
                      setAlcohol((a) => ({ ...a, time: e.target.value }))
                    }
                  />
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <div className="form-group">
              <label className="form-label">Liquid intake</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. 3 glasses water, 1 tea"
                value={liquidIntake}
                onChange={(e) => setLiquidIntake(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Room Environment */}
      {step === 4 && (
        <div>
          <div className="card">
            <div className="card-title">Room Environment</div>
            <div className="form-group">
              <label className="form-label">Room temperature (F)</label>
              <input
                type="number"
                className="form-input"
                placeholder="e.g. 67"
                value={roomTempF}
                onChange={(e) => setRoomTempF(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Room humidity (%)</label>
              <input
                type="number"
                className="form-input"
                placeholder="e.g. 45"
                value={roomHumidity}
                onChange={(e) => setRoomHumidity(e.target.value)}
              />
            </div>
          </div>
          <div className="card">
            <div className="card-title">External Weather</div>
            {overnightLow !== null ? (
              <div className="flex items-center justify-between">
                <span className="text-secondary">Overnight low</span>
                <span className="fs-20 fw-600 text-accent">
                  {Math.round(overnightLow)}&deg;F
                </span>
              </div>
            ) : (
              <p className="text-secondary text-sm">
                {weather === null ? 'Loading weather...' : 'No weather data'}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Step 5: Clothing */}
      {step === 5 && (
        <div>
          <div className="card">
            <div className="card-title">Clothing</div>
            <div className="toggle-grid">
              {(clothingItems ?? []).map((item: ClothingItem) => (
                <button
                  key={item.id}
                  className={`toggle-btn${selectedClothing.includes(item.id) ? ' active' : ''}`}
                  onClick={() => toggleClothing(item.id)}
                >
                  {item.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Step 6: Bedding */}
      {step === 6 && (
        <div>
          <div className="card">
            <div className="card-title">Bedding</div>
            {(beddingItems ?? []).map((item: BeddingItem) => (
              <button
                key={item.id}
                className={`toggle-btn${selectedBedding.includes(item.id) ? ' active' : ''}`}
                onClick={() => toggleBedding(item.id)}
                style={{ width: '100%', marginBottom: 8 }}
              >
                {item.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 7: Notes & Summary */}
      {step === 7 && (
        <div>
          <div className="card">
            <div className="card-title">Evening Notes</div>
            <div className="form-group">
              <textarea
                className="form-input"
                placeholder="Anything else to note about this evening..."
                value={eveningNotes}
                onChange={(e) => setEveningNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="card">
            <div className="card-title">Summary</div>
            <div className="summary-row">
              <span className="summary-label">Alarm</span>
              <span className="summary-value">
                {formatTime12h(activeAlarm)}
              </span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Target bedtime</span>
              <span className="summary-value">
                {formatTime12h(schedule.targetBedtime)}
              </span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Stack</span>
              <span className="summary-value">
                {baseStackUsed
                  ? 'Took as planned'
                  : `${deviations.length} deviation(s)`}
              </span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Last meal</span>
              <span className="summary-value">
                {lastMealTime ? formatTime12h(lastMealTime) : 'Not logged'}
              </span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Room temp</span>
              <span className="summary-value">
                {roomTempF ? `${roomTempF}F` : '--'}
              </span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Clothing</span>
              <span className="summary-value">
                {selectedClothing.length} item(s)
              </span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Bedding</span>
              <span className="summary-value">
                {selectedBedding.length} layer(s)
              </span>
            </div>
          </div>

          <button
            className="btn btn-primary btn-full mt-16"
            onClick={handleSave}
          >
            Save Evening Log
          </button>
        </div>
      )}

      {/* Step navigation */}
      <div className="step-nav">
        {step > 1 && (
          <button
            className="btn btn-secondary"
            onClick={() => setStep((s) => s - 1)}
          >
            Back
          </button>
        )}
        {step < TOTAL_STEPS && (
          <button
            className="btn btn-primary"
            onClick={() => setStep((s) => s + 1)}
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
}
