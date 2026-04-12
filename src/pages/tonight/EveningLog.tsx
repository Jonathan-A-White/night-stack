import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import {
  calculateSchedule,
  formatTime12h,
  isTimeAfter,
  getTodayDate,
  getEveningLogDate,
  createBlankNightLog,
  getCurrentTime,
  DAY_NAMES,
} from '../../utils';
import { fetchOvernightWeather, getOvernightLow } from '../../services/weather';
import { scheduleNotifications } from '../../services/notifications';
import { WeightStepper } from '../../components/WeightStepper';
import {
  formatWeight,
  recalculateCalculatedWeights,
  resolveDefaultWeightLbs,
  roundWeightLbs,
} from '../../weightUtils';
import type {
  StackDeviation,
  EveningFlag,
  AlcoholEntry,
  ExternalWeather,
  ClothingItem,
  BeddingItem,
  SupplementDef,
  WeightEntry,
  MiddayCopingItem,
  MiddayCopingType,
  StruggleIntensity,
} from '../../types';

const TOTAL_STEPS = 8;

const COPING_TYPE_LABEL: Record<MiddayCopingType, string> = {
  food: 'Food',
  drink: 'Drink',
  exercise: 'Exercise',
  nap: 'Nap',
};

/**
 * Tone class for the coping-item toggle button when it is selected.
 *   food     → danger (bad coping)
 *   drink    → success (good coping)
 *   exercise → success (good coping)
 *   nap      → warning (good action, bad signal)
 */
function copingTone(type: MiddayCopingType): string {
  if (type === 'food') return 'text-danger';
  if (type === 'nap') return 'text-warning';
  return 'text-success';
}

/**
 * Get the day-of-week for the day after a given "YYYY-MM-DD" date string.
 */
function getDayAfterDow(dateStr: string): number {
  const d = new Date(dateStr + 'T12:00:00'); // noon to avoid timezone edge cases
  d.setDate(d.getDate() + 1);
  return d.getDay();
}

export function EveningLog() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Support ?date=YYYY-MM-DD for backfilling a past evening log. Otherwise
  // derive the evening date from the current time (before noon = yesterday's
  // evening, after noon = today's evening). `NightLog.date` is the date of
  // the evening itself per the spec, so an evening logged at 6 AM on April 9
  // belongs to April 8.
  const backfillDate = searchParams.get('date');
  const logDate = backfillDate || getEveningLogDate();
  const isBackfill = backfillDate !== null && backfillDate !== getTodayDate();
  const showLogDate = logDate !== getTodayDate();

  const DRAFT_KEY = `evening-log-draft-${logDate}`;

  // Check if an existing log already exists for this date (editing scenario)
  const existingLog = useLiveQuery(
    () => db.nightLogs.where('date').equals(logDate).first(),
    [logDate]
  );

  // Restore draft from sessionStorage on mount
  const [draft] = useState<Record<string, unknown> | null>(() => {
    try {
      const saved = sessionStorage.getItem(`evening-log-draft-${logDate}`);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [step, setStep] = useState((draft?.step as number) ?? 1);

  // DB queries — use the correct day-of-week for the alarm. The alarm is the
  // one that wakes the user from the night being logged, i.e. the day after
  // `logDate`. This works for both backfill and morning-after logging (where
  // logDate is yesterday).
  const tomorrowDow = getDayAfterDow(logDate);
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
  const middayCopingItems = useLiveQuery(
    () => db.middayCopingItems.orderBy('sortOrder').filter((m) => m.isActive).toArray()
  );
  const lastLog = useLiveQuery(
    () => db.nightLogs.orderBy('date').reverse().first(),
    []
  );
  // Normalize the "no entries" case to `null` so we can distinguish it from
  // "query still loading" (which useLiveQuery represents as `undefined`).
  // Without this, users who have never logged a weight would be stuck with
  // `latestWeight === undefined` forever and the weight stepper would never
  // initialize.
  const latestWeight = useLiveQuery(
    async () => (await db.weightEntries.orderBy('timestamp').reverse().first()) ?? null,
  );

  // Step 1: Alarm
  const [overrideTime, setOverrideTime] = useState((draft?.overrideTime as string) ?? '');

  // Step 2: Supplements
  const [baseStackUsed, setBaseStackUsed] = useState((draft?.baseStackUsed as boolean) ?? true);
  const [deviations, setDeviations] = useState<StackDeviation[]>((draft?.deviations as StackDeviation[]) ?? []);

  // Step 3: Food & Drink
  const [lastMealTime, setLastMealTime] = useState((draft?.lastMealTime as string) ?? '');
  const [foodDescription, setFoodDescription] = useState((draft?.foodDescription as string) ?? '');
  const [flags, setFlags] = useState<EveningFlag[]>((draft?.flags as EveningFlag[]) ?? [
    { type: 'overate', label: 'Overate', active: false },
    { type: 'high_salt', label: 'High salt', active: false },
    { type: 'nitrates', label: 'Nitrates', active: false },
    { type: 'questionable_food', label: 'Questionable food', active: false },
    { type: 'late_meal', label: 'Late meal', active: false },
  ]);
  const [hasAlcohol, setHasAlcohol] = useState((draft?.hasAlcohol as boolean) ?? false);
  const [alcohol, setAlcohol] = useState<AlcoholEntry>((draft?.alcohol as AlcoholEntry) ?? {
    type: '',
    amount: '',
    time: '',
  });
  const [liquidIntake, setLiquidIntake] = useState((draft?.liquidIntake as string) ?? '');

  // Step 4: Midday struggle
  const [hadStruggle, setHadStruggle] = useState((draft?.hadStruggle as boolean) ?? false);
  const [selectedCoping, setSelectedCoping] = useState<string[]>(
    (draft?.selectedCoping as string[]) ?? []
  );
  const [struggleTime, setStruggleTime] = useState((draft?.struggleTime as string) ?? '');
  const [struggleIntensity, setStruggleIntensity] = useState<StruggleIntensity | ''>(
    (draft?.struggleIntensity as StruggleIntensity | '') ?? ''
  );
  const [struggleNotes, setStruggleNotes] = useState((draft?.struggleNotes as string) ?? '');

  // Step 5: Environment
  const [roomTempF, setRoomTempF] = useState<string>((draft?.roomTempF as string) ?? '');
  const [roomHumidity, setRoomHumidity] = useState<string>((draft?.roomHumidity as string) ?? '');
  const [weather, setWeather] = useState<ExternalWeather | null>(null);

  // Step 6: Clothing
  const [selectedClothing, setSelectedClothing] = useState<string[]>((draft?.selectedClothing as string[]) ?? []);

  // Step 7: Bedding
  const [selectedBedding, setSelectedBedding] = useState<string[]>((draft?.selectedBedding as string[]) ?? []);

  // Step 8: Notes
  const [eveningNotes, setEveningNotes] = useState((draft?.eveningNotes as string) ?? '');

  // Prevents the save button from creating a duplicate log if the user
  // double-taps while the async save is in flight.
  const [isSaving, setIsSaving] = useState(false);

  // Weight entry (only surfaced if user weighs in the evening)
  const weighInPeriod = settings?.weighInPeriod ?? 'morning';
  const showWeightStep = weighInPeriod === 'evening';
  const unitSystem = settings?.unitSystem ?? 'us';
  const [weightLbs, setWeightLbs] = useState<number | null>(
    (draft?.weightLbs as number | null) ?? null,
  );
  const [weightSkipped, setWeightSkipped] = useState(
    (draft?.weightSkipped as boolean) ?? false,
  );
  const [weightInitialized, setWeightInitialized] = useState(
    draft?.weightLbs != null,
  );

  useEffect(() => {
    if (weightInitialized) return;
    if (!settings) return;
    if (latestWeight === undefined) return;
    const defaultLbs = resolveDefaultWeightLbs({
      previousWeightLbs: latestWeight ? latestWeight.weightLbs : null,
      startingWeightLbs: settings.startingWeightLbs ?? null,
      sex: settings.sex ?? null,
      heightInches: settings.heightInches ?? null,
    });
    setWeightLbs(defaultLbs);
    setWeightInitialized(true);
  }, [settings, latestWeight, weightInitialized]);

  // Seed form state from an existing log when editing (no draft in
  // sessionStorage). This runs once after the DB query resolves.
  const [seededFromExisting, setSeededFromExisting] = useState(draft != null);
  useEffect(() => {
    if (seededFromExisting) return;
    if (existingLog === undefined) return; // query still loading
    if (!existingLog) {
      // No existing log — nothing to seed from, prevent re-runs.
      setSeededFromExisting(true);
      return;
    }
    setSeededFromExisting(true);

    // Alarm override
    if (existingLog.alarm.isOverridden) {
      setOverrideTime(existingLog.alarm.actualAlarmTime);
    }

    // Stack
    setBaseStackUsed(existingLog.stack.baseStackUsed);
    setDeviations(existingLog.stack.deviations);

    // Food & drink
    setLastMealTime(existingLog.eveningIntake.lastMealTime);
    setFoodDescription(existingLog.eveningIntake.foodDescription);
    setFlags(existingLog.eveningIntake.flags);
    if (existingLog.eveningIntake.alcohol) {
      setHasAlcohol(true);
      setAlcohol(existingLog.eveningIntake.alcohol);
    }
    setLiquidIntake(existingLog.eveningIntake.liquidIntake);

    // Midday struggle
    setHadStruggle(existingLog.middayStruggle.hadStruggle);
    setSelectedCoping(existingLog.middayStruggle.copingItemIds);
    setStruggleTime(existingLog.middayStruggle.struggleTime);
    setStruggleIntensity(existingLog.middayStruggle.intensity ?? '');
    setStruggleNotes(existingLog.middayStruggle.notes);

    // Environment
    setRoomTempF(existingLog.environment.roomTempF?.toString() ?? '');
    setRoomHumidity(existingLog.environment.roomHumidity?.toString() ?? '');

    // Clothing & bedding
    setSelectedClothing(existingLog.clothing);
    setSelectedBedding(existingLog.bedding);

    // Notes
    setEveningNotes(existingLog.eveningNotes);
  }, [existingLog, seededFromExisting]);

  // Persist form state to sessionStorage so it survives navigation
  useEffect(() => {
    const data = {
      step, overrideTime, baseStackUsed, deviations,
      lastMealTime, foodDescription, flags, hasAlcohol, alcohol, liquidIntake,
      hadStruggle, selectedCoping, struggleTime, struggleIntensity, struggleNotes,
      roomTempF, roomHumidity, selectedClothing, selectedBedding, eveningNotes,
      weightLbs, weightSkipped,
    };
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(data));
  }, [
    step, overrideTime, baseStackUsed, deviations,
    lastMealTime, foodDescription, flags, hasAlcohol, alcohol, liquidIntake,
    hadStruggle, selectedCoping, struggleTime, struggleIntensity, struggleNotes,
    roomTempF, roomHumidity, selectedClothing, selectedBedding, eveningNotes,
    weightLbs, weightSkipped,
    DRAFT_KEY,
  ]);

  // Derived alarm values
  const defaultAlarm = alarmSchedule?.hasAlarm
    ? alarmSchedule.alarmTime
    : alarmSchedule?.naturalWakeTime ?? '07:00';
  const activeAlarm = overrideTime || defaultAlarm;
  const schedule = calculateSchedule(activeAlarm);

  // Fetch weather
  useEffect(() => {
    if (!settings) return;
    fetchOvernightWeather(settings.latitude, settings.longitude, logDate)
      .then(setWeather)
      .catch(() => {});
  }, [settings, logDate]);

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

  function toggleCoping(id: string) {
    setSelectedCoping((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
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
    if (isSaving) return; // guard against double-tap
    setIsSaving(true);
    try {
      const date = logDate;
      const isOverridden = overrideTime !== '' && overrideTime !== defaultAlarm;

      // When editing an existing log, preserve its identity and any
      // morning-side data (sleepData, roomTimeline, etc.) that the
      // evening form doesn't touch. For new logs, start blank.
      const nightLog = existingLog
        ? { ...existingLog }
        : createBlankNightLog(date, {
            expectedAlarmTime: defaultAlarm,
            actualAlarmTime: activeAlarm,
            isOverridden,
            targetBedtime: schedule.targetBedtime,
            eatingCutoff: schedule.eatingCutoff,
            supplementTime: schedule.supplementTime,
          });

      nightLog.alarm = {
        expectedAlarmTime: defaultAlarm,
        actualAlarmTime: activeAlarm,
        isOverridden,
        targetBedtime: schedule.targetBedtime,
        eatingCutoff: schedule.eatingCutoff,
        supplementTime: schedule.supplementTime,
      };
      nightLog.updatedAt = Date.now();

      // The moment the user finishes the evening log is treated as their
      // actual bedtime — independent of whatever the watch sleep tracker
      // later reports. Backfilled entries (for a previous date) get null
      // because the finish time doesn't reflect when the user actually
      // went to bed that night. When editing, preserve the original
      // loggedBedtime so it isn't overwritten.
      if (!existingLog) {
        nightLog.loggedBedtime = isBackfill ? null : Date.now();
      }

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
      nightLog.middayStruggle = {
        hadStruggle,
        copingItemIds: hadStruggle ? selectedCoping : [],
        struggleTime: hadStruggle ? struggleTime : '',
        intensity: hadStruggle ? (struggleIntensity || null) : null,
        notes: hadStruggle ? struggleNotes : '',
      };
      nightLog.eveningNotes = eveningNotes;

      await db.nightLogs.put(nightLog);

      // Log evening weight if that's the user's preference
      if (showWeightStep && weightLbs != null) {
        const now = Date.now();
        const entry: WeightEntry = {
          id: crypto.randomUUID(),
          nightLogId: nightLog.id,
          date,
          time: getCurrentTime(),
          timestamp: now,
          weightLbs: roundWeightLbs(weightLbs, 'us'),
          period: 'evening',
          createdAt: now,
          measured: !weightSkipped,
        };
        await db.weightEntries.add(entry);

        if (!weightSkipped) {
          const all = await db.weightEntries.toArray();
          const recalculated = recalculateCalculatedWeights(all, entry.id);
          await db.weightEntries.bulkPut(recalculated);
        }
      }

      // Schedule notifications
      if (settings) {
        scheduleNotifications(nightLog.alarm, settings.notificationPreferences);
      }

      sessionStorage.removeItem(DRAFT_KEY);
      // Navigate by id — multiple night logs can legitimately share a date
      // (e.g. a mis-filed backfill), so routing by id keeps each entry
      // independently addressable.
      navigate(`/tonight/review/${nightLog.id}`);
    } finally {
      setIsSaving(false);
    }
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
        <p className="subtitle">Step {step} of {TOTAL_STEPS}{showLogDate ? ` \u2014 ${logDate}` : ''}</p>
      </div>

      {existingLog && isBackfill ? (
        <div className="banner banner-warning mb-8">
          Editing evening log for {logDate}
        </div>
      ) : isBackfill ? (
        <div className="banner banner-warning mb-8">
          Backfilling evening log for {logDate}
        </div>
      ) : showLogDate ? (
        <div className="banner banner-warning mb-8">
          Logging evening for {logDate} (last night).
        </div>
      ) : null}

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

      {/* Step 4: Midday Struggle */}
      {step === 4 && (
        <div>
          <div className="card">
            <div className="card-title">Midday Struggle</div>
            <p className="text-secondary text-sm mb-8">
              The afternoon dip between lunch and dinner. Did you feel one today?
            </p>
            <div className="switch-row">
              <span>Had a midday struggle</span>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={hadStruggle}
                  onChange={(e) => setHadStruggle(e.target.checked)}
                />
                <span className="switch-slider" />
              </label>
            </div>
          </div>

          {hadStruggle && (
            <>
              <div className="card">
                <div className="card-title">How you coped</div>
                <p className="text-secondary text-sm mb-8">
                  Pick everything you used. <span className="text-success">Drink / exercise</span> are good coping; <span className="text-warning">nap</span> is a good recovery move that often signals short sleep; <span className="text-danger">food</span> is worth avoiding (crash + thermic load).
                </p>
                {(middayCopingItems ?? []).length === 0 ? (
                  <p className="text-secondary text-sm">
                    No coping items yet. Add some in Settings → Midday Coping Items.
                  </p>
                ) : (
                  <div className="toggle-grid">
                    {(middayCopingItems ?? []).map((item: MiddayCopingItem) => {
                      const active = selectedCoping.includes(item.id);
                      return (
                        <button
                          key={item.id}
                          className={`toggle-btn${active ? ' active' : ''}`}
                          onClick={() => toggleCoping(item.id)}
                        >
                          <div>{item.name}</div>
                          <div className={`text-sm ${copingTone(item.type)}`}>
                            {COPING_TYPE_LABEL[item.type]}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="card">
                <div className="card-title">Details</div>
                <div className="form-group">
                  <label className="form-label">When did it hit (optional)</label>
                  <input
                    type="time"
                    className="form-input"
                    value={struggleTime}
                    onChange={(e) => setStruggleTime(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Intensity (optional)</label>
                  <select
                    className="form-input"
                    value={struggleIntensity}
                    onChange={(e) =>
                      setStruggleIntensity(e.target.value as StruggleIntensity | '')
                    }
                  >
                    <option value="">--</option>
                    <option value="low">Low — mild dip</option>
                    <option value="medium">Medium — noticeable</option>
                    <option value="high">High — couldn't function</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Notes (optional)</label>
                  <textarea
                    className="form-input"
                    placeholder="e.g. skipped breakfast, long meeting block"
                    value={struggleNotes}
                    onChange={(e) => setStruggleNotes(e.target.value)}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Step 5: Room Environment */}
      {step === 5 && (
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

      {/* Step 6: Clothing */}
      {step === 6 && (
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

      {/* Step 7: Bedding */}
      {step === 7 && (
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

      {/* Step 8: Notes & Summary */}
      {step === 8 && (
        <div>
          {showWeightStep && weightLbs != null && (
            <div className="card">
              <div className="card-title">Evening Weight</div>
              {weightSkipped ? (
                <div>
                  <div className="text-secondary text-sm mb-8" style={{ textAlign: 'center' }}>
                    Skipped — will be filled with the calculated value
                    ({formatWeight(weightLbs, unitSystem)}).
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-full"
                    onClick={() => setWeightSkipped(false)}
                  >
                    Log weight instead
                  </button>
                </div>
              ) : (
                <>
                  <WeightStepper
                    valueLbs={weightLbs}
                    onChange={setWeightLbs}
                    unitSystem={unitSystem}
                    helpText="Hold +/- to move faster"
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-full mt-8"
                    onClick={() => setWeightSkipped(true)}
                  >
                    Skip weigh-in
                  </button>
                </>
              )}
            </div>
          )}

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
              <span className="summary-label">Midday struggle</span>
              <span className="summary-value">
                {hadStruggle
                  ? `${selectedCoping.length} coping action(s)`
                  : 'None'}
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
            {showWeightStep && weightLbs != null && (
              <div className="summary-row">
                <span className="summary-label">Weight</span>
                <span className="summary-value text-accent">
                  {formatWeight(weightLbs, unitSystem)}
                  {weightSkipped && (
                    <span className="text-secondary text-sm"> (skipped)</span>
                  )}
                </span>
              </div>
            )}
          </div>

          <div className="step-nav">
            <button
              className="btn btn-secondary"
              onClick={() => setStep((s) => s - 1)}
            >
              Back
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? 'Saving…' : 'Save Evening Log'}
            </button>
          </div>
        </div>
      )}

      {/* Step navigation */}
      {step < TOTAL_STEPS && (
        <div className="step-nav">
          {step > 1 && (
            <button
              className="btn btn-secondary"
              onClick={() => setStep((s) => s - 1)}
            >
              Back
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={() => setStep((s) => s + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
