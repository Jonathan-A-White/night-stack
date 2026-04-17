import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import {
  addDaysToDate,
  getCurrentTime,
  getTodayDate,
  getYesterdayDate,
  formatTime12h,
  isTimeAfter,
  timestampToHHMM,
} from '../../utils';
import { parseSamsungHealthJSON, parseGoveeCSV, type ParsedWakeUpEvent } from '../../services/importers';
import { WeightStepper } from '../../components/WeightStepper';
import {
  formatWeight,
  recalculateCalculatedWeights,
  resolveDefaultWeightLbs,
  roundWeightLbs,
} from '../../weightUtils';
import type {
  SleepData,
  SleepRating,
  RoomReading,
  WakeUpEvent,
  BedtimeExplanation,
  WeightEntry,
} from '../../types';

const TOTAL_STEPS = 5;
const VALID_RATINGS: SleepRating[] = ['Excellent', 'Good', 'Fair', 'Attention'];

// Key drafts by the edited date so today's in-progress morning log doesn't
// bleed into an edit of a past entry opened from the calendar.
function getDraftKey(date: string): string {
  return `morning-log-draft-${date}`;
}

function loadDraft(key: string): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function MorningLog() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const today = getTodayDate();
  const yesterday = getYesterdayDate();

  // Support ?date=YYYY-MM-DD for editing a specific night's morning data
  // from the calendar. The date is the NightLog.date (the evening date).
  const targetDate = searchParams.get('date');
  const draftKey = getDraftKey(targetDate ?? today);
  const draft = useRef(loadDraft(draftKey)).current;

  const [step, setStep] = useState<number>((draft?.step as number) ?? 1);

  // Find the evening log — explicit date from calendar, or today/yesterday
  const nightLog = useLiveQuery(async () => {
    if (targetDate) {
      const log = await db.nightLogs.where('date').equals(targetDate).first();
      return log ?? null;
    }
    const todayLog = await db.nightLogs.where('date').equals(today).first();
    if (todayLog) return todayLog;
    const yLog = await db.nightLogs.where('date').equals(yesterday).first();
    return yLog ?? null;
  }, [targetDate, today, yesterday]);

  // Config data
  const wakeUpCauses = useLiveQuery(
    () => db.wakeUpCauses.orderBy('sortOrder').filter((c) => c.isActive).toArray()
  );
  const bedtimeReasons = useLiveQuery(
    () => db.bedtimeReasons.orderBy('sortOrder').filter((r) => r.isActive).toArray()
  );
  const settings = useLiveQuery(() => db.appSettings.get('default'));
  // Normalize the "no entries" case to `null` so we can distinguish it from
  // "query still loading" (which useLiveQuery represents as `undefined`).
  // Without this, users who have never logged a weight would be stuck with
  // `latestWeight === undefined` forever and the weight stepper would never
  // initialize.
  const latestWeight = useLiveQuery(
    async () => (await db.weightEntries.orderBy('timestamp').reverse().first()) ?? null,
  );

  // Step 1: Sleep data import
  const [sleepData, setSleepData] = useState<SleepData | null>(
    (draft?.sleepData as SleepData | null) ?? null,
  );
  const [importError, setImportError] = useState<string | null>(null);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const sleepFileRef = useRef<HTMLInputElement>(null);

  // Manual entry fields
  const [manualFields, setManualFields] = useState({
    sleepTime: '',
    wakeTime: '',
    totalSleepDuration: '',
    actualSleepDuration: '',
    sleepScore: '',
    sleepScoreDelta: '',
    deepSleep: '',
    remSleep: '',
    lightSleep: '',
    awakeDuration: '',
    avgHeartRate: '',
    minHeartRate: '',
    avgRespiratoryRate: '',
    bloodOxygenAvg: '',
    skinTempRange: '',
    sleepLatencyRating: 'Good' as SleepRating,
    restfulnessRating: 'Good' as SleepRating,
    deepSleepRating: 'Good' as SleepRating,
    remSleepRating: 'Good' as SleepRating,
  });

  // Step 2: Govee room data
  const [roomTimeline, setRoomTimeline] = useState<RoomReading[] | null>(
    (draft?.roomTimeline as RoomReading[] | null) ?? null,
  );
  const [goveeError, setGoveeError] = useState<string | null>(null);
  const goveeFileRef = useRef<HTMLInputElement>(null);

  // Step 3: Wake-up events
  const [hadWakeUps, setHadWakeUps] = useState((draft?.hadWakeUps as boolean) ?? false);
  const [wakeUpEvents, setWakeUpEvents] = useState<WakeUpEvent[]>(
    (draft?.wakeUpEvents as WakeUpEvent[]) ?? [],
  );

  // Step 4: Bedtime explanation
  const [bedtimeReason, setBedtimeReason] = useState((draft?.bedtimeReason as string) ?? '');
  const [bedtimeNotes, setBedtimeNotes] = useState((draft?.bedtimeNotes as string) ?? '');

  // Step 5: Morning notes
  const [morningNotes, setMorningNotes] = useState((draft?.morningNotes as string) ?? '');

  // Weight entry (only surfaced if user weighs in the morning)
  const weighInPeriod = settings?.weighInPeriod ?? 'morning';
  const showWeightStep = weighInPeriod === 'morning';
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

  // Initialize the stepper once settings + latest weight query resolve.
  useEffect(() => {
    if (weightInitialized) return;
    if (!settings) return;
    if (latestWeight === undefined) return; // query not yet resolved
    const defaultLbs = resolveDefaultWeightLbs({
      previousWeightLbs: latestWeight ? latestWeight.weightLbs : null,
      startingWeightLbs: settings.startingWeightLbs ?? null,
      sex: settings.sex ?? null,
      heightInches: settings.heightInches ?? null,
    });
    setWeightLbs(defaultLbs);
    setWeightInitialized(true);
  }, [settings, latestWeight, weightInitialized]);

  // Seed form state from existing morning data when editing (no draft in
  // localStorage). This runs once after the nightLog query resolves.
  const [seededFromExisting, setSeededFromExisting] = useState(draft != null);
  useEffect(() => {
    if (seededFromExisting) return;
    if (nightLog === undefined) return; // query still loading
    if (!nightLog) {
      setSeededFromExisting(true);
      return;
    }
    setSeededFromExisting(true);

    // Sleep data
    if (nightLog.sleepData) {
      setSleepData(nightLog.sleepData);
    }

    // Room timeline
    if (nightLog.roomTimeline) {
      setRoomTimeline(nightLog.roomTimeline);
    }

    // Wake-up events
    if (nightLog.wakeUpEvents.length > 0) {
      setHadWakeUps(true);
      setWakeUpEvents(nightLog.wakeUpEvents);
    }

    // Bedtime explanation
    if (nightLog.bedtimeExplanation) {
      setBedtimeReason(nightLog.bedtimeExplanation.reason);
      setBedtimeNotes(nightLog.bedtimeExplanation.notes);
    }

    // Morning notes
    if (nightLog.morningNotes) {
      setMorningNotes(nightLog.morningNotes);
    }
  }, [nightLog, seededFromExisting]);

  // Persist every step of the morning log to localStorage so switching away
  // (settings, insights, closing the app, or restarting) doesn't lose work.
  // localStorage survives app restarts unlike sessionStorage which is wiped
  // when the PWA is killed or the tab is closed.
  useEffect(() => {
    const data = {
      step,
      sleepData,
      roomTimeline,
      hadWakeUps,
      wakeUpEvents,
      bedtimeReason,
      bedtimeNotes,
      morningNotes,
      weightLbs,
      weightSkipped,
    };
    try {
      localStorage.setItem(draftKey, JSON.stringify(data));
    } catch {
      // localStorage can be full or disabled — fail silently, the user will
      // just lose their draft if they navigate away.
    }
  }, [
    step,
    sleepData,
    roomTimeline,
    hadWakeUps,
    wakeUpEvents,
    bedtimeReason,
    bedtimeNotes,
    morningNotes,
    weightLbs,
    weightSkipped,
  ]);

  // --- Handlers ---

  function calcMinutesBetween(start: string, end: string): number | null {
    if (!start || !end) return null;
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    let diff = (eh * 60 + em) - (sh * 60 + sm);
    if (diff < 0) diff += 24 * 60; // handle midnight crossing
    return diff;
  }

  function resolveWakeUpEvents(parsed: ParsedWakeUpEvent[]): WakeUpEvent[] {
    return parsed.map((ev) => {
      const matchedCause = (wakeUpCauses ?? []).find(
        (c) => c.label.toLowerCase() === ev.cause.toLowerCase()
      );
      return {
        id: crypto.randomUUID(),
        startTime: ev.startTime,
        endTime: ev.endTime,
        cause: matchedCause?.id ?? '',
        fellBackAsleep: ev.endTime ? 'yes' : 'no',
        minutesToFallBackAsleep: calcMinutesBetween(ev.startTime, ev.endTime),
        notes: ev.notes,
      } satisfies WakeUpEvent;
    });
  }

  function handleSleepFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = parseSamsungHealthJSON(reader.result as string);
      if (result.error) {
        setImportError(result.error);
        setSleepData(null);
      } else {
        setSleepData(result.data);
        setImportError(null);
        // Auto-populate wake-up events from JSON if present
        if (result.wakeUpEvents.length > 0) {
          const resolved = resolveWakeUpEvents(result.wakeUpEvents);
          setWakeUpEvents(resolved);
          setHadWakeUps(true);
        }
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function handleManualSave() {
    const data: SleepData = {
      sleepTime: manualFields.sleepTime || '22:00',
      wakeTime: manualFields.wakeTime || '06:00',
      totalSleepDuration: Number(manualFields.totalSleepDuration) || 0,
      actualSleepDuration: Number(manualFields.actualSleepDuration) || 0,
      sleepScore: Number(manualFields.sleepScore) || 0,
      sleepScoreDelta: Number(manualFields.sleepScoreDelta) || 0,
      deepSleep: Number(manualFields.deepSleep) || 0,
      remSleep: Number(manualFields.remSleep) || 0,
      lightSleep: Number(manualFields.lightSleep) || 0,
      awakeDuration: Number(manualFields.awakeDuration) || 0,
      avgHeartRate: Number(manualFields.avgHeartRate) || 0,
      minHeartRate: manualFields.minHeartRate === '' ? null : Number(manualFields.minHeartRate),
      avgRespiratoryRate: Number(manualFields.avgRespiratoryRate) || 0,
      bloodOxygenAvg: Number(manualFields.bloodOxygenAvg) || 0,
      skinTempRange: manualFields.skinTempRange,
      sleepLatencyRating: manualFields.sleepLatencyRating,
      restfulnessRating: manualFields.restfulnessRating,
      deepSleepRating: manualFields.deepSleepRating,
      remSleepRating: manualFields.remSleepRating,
      importedAt: Date.now(),
    };
    setSleepData(data);
    setShowManualEntry(false);
    setImportError(null);
  }

  function updateManualField(key: string, value: string) {
    setManualFields((prev) => ({ ...prev, [key]: value }));
  }

  function handleGoveeFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !nightLog) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = parseGoveeCSV(reader.result as string, nightLog.date);
      if (result.error) {
        setGoveeError(result.error);
        setRoomTimeline(null);
      } else {
        setRoomTimeline(result.data);
        setGoveeError(null);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function addWakeUpEvent() {
    setWakeUpEvents((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        startTime: '',
        endTime: '',
        cause: '',
        fellBackAsleep: 'yes',
        minutesToFallBackAsleep: null,
        notes: '',
      },
    ]);
  }

  function updateWakeUpEvent(id: string, field: keyof WakeUpEvent, value: unknown) {
    setWakeUpEvents((prev) =>
      prev.map((ev) => (ev.id === id ? { ...ev, [field]: value } : ev))
    );
  }

  function removeWakeUpEvent(id: string) {
    setWakeUpEvents((prev) => prev.filter((ev) => ev.id !== id));
  }

  // The evening log's finish time is the authoritative bedtime. Fall back
  // to the watch-reported sleepTime only for legacy logs that predate
  // loggedBedtime, so the Late Bedtime flow still works on old data.
  const effectiveBedtime: string | null =
    nightLog?.loggedBedtime != null
      ? timestampToHHMM(nightLog.loggedBedtime)
      : sleepData?.sleepTime ?? null;

  // Determine if bedtime explanation is needed
  const needsBedtimeExplanation =
    effectiveBedtime !== null &&
    nightLog != null &&
    isTimeAfter(effectiveBedtime, nightLog.alarm.targetBedtime);

  function goNext() {
    setStep((s) => {
      const next = s + 1;
      if (next === 4 && !needsBedtimeExplanation) return 5;
      return next;
    });
  }

  function goBack() {
    setStep((s) => {
      const prev = s - 1;
      if (prev === 4 && !needsBedtimeExplanation) return 3;
      return prev;
    });
  }

  async function handleSave() {
    if (!nightLog) return;

    const bedtimeExplanation: BedtimeExplanation | null = needsBedtimeExplanation
      ? {
          actualBedtime: effectiveBedtime!,
          targetBedtime: nightLog.alarm.targetBedtime,
          wasLate: true,
          reason: bedtimeReason,
          notes: bedtimeNotes,
        }
      : null;

    await db.nightLogs.update(nightLog.id, {
      sleepData,
      roomTimeline,
      wakeUpEvents: hadWakeUps ? wakeUpEvents : [],
      bedtimeExplanation,
      morningNotes,
      updatedAt: Date.now(),
    });

    // Log morning weight (if that's the user's preference)
    if (showWeightStep && weightLbs != null) {
      const now = Date.now();
      const entry: WeightEntry = {
        id: crypto.randomUUID(),
        nightLogId: nightLog.id,
        date: today,
        time: getCurrentTime(),
        timestamp: now,
        weightLbs: roundWeightLbs(weightLbs, 'us'),
        period: 'morning',
        createdAt: now,
        measured: !weightSkipped,
      };
      await db.weightEntries.add(entry);

      // When the user actively enters a weight, use it as a new anchor and
      // recompute any calculated entries between the previous measurement
      // and this one (plus fill-forward past the anchor).
      if (!weightSkipped) {
        const all = await db.weightEntries.toArray();
        const recalculated = recalculateCalculatedWeights(all, entry.id);
        await db.weightEntries.bulkPut(recalculated);
      }
    }

    // Clear draft on successful save
    localStorage.removeItem(draftKey);

    navigate(`/morning/review/${nightLog.id}`);
  }

  // --- Rendering ---

  // Loading state
  if (nightLog === undefined) {
    return (
      <div className="empty-state">
        <h3>Loading...</h3>
      </div>
    );
  }

  // No evening log found
  if (nightLog === null) {
    return (
      <div className="empty-state">
        <h3>Complete your evening log first</h3>
        <p className="text-secondary mt-8">
          You need to fill out tonight's log before entering morning data.
        </p>
        <Link to="/tonight" className="btn btn-primary mt-16">
          Go to Tonight
        </Link>
        <Link to={`/tonight/log?date=${yesterday}`} className="btn btn-secondary mt-8">
          Log last night ({yesterday})
        </Link>
      </div>
    );
  }

  // Govee summary helpers
  const goveeMinTemp = roomTimeline && roomTimeline.length > 0
    ? Math.min(...roomTimeline.map((r) => r.tempF))
    : null;
  const goveeMaxTemp = roomTimeline && roomTimeline.length > 0
    ? Math.max(...roomTimeline.map((r) => r.tempF))
    : null;

  // The night log's stored `date` is the evening date (the day you went to
  // bed). The morning log is for the morning *after* — always one day later.
  const morningDate = addDaysToDate(nightLog.date, 1);

  return (
    <div>
      <div className="page-header">
        <h1>Morning Log</h1>
        <p className="subtitle">Step {step} of {TOTAL_STEPS} &mdash; {morningDate}</p>
      </div>

      {targetDate && nightLog.sleepData && (
        <div className="banner banner-warning mb-8">
          Editing morning log for {morningDate}
        </div>
      )}

      {/* Step progress bar */}
      <div className="step-progress">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <div
            key={i}
            className={`step-dot${i + 1 < step ? ' completed' : ''}${i + 1 === step ? ' active' : ''}`}
          />
        ))}
      </div>

      {/* Step 1: Morning Weight + Import Samsung Health Data */}
      {step === 1 && (
        <div>
          {showWeightStep && weightLbs != null && (
            <div className="card">
              <div className="card-title">Morning Weight</div>
              {weightSkipped ? (
                <div>
                  <div className="text-secondary text-sm mb-8" style={{ textAlign: 'center' }}>
                    Skipped &mdash; will be filled with the calculated value
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
            <div className="card-title">Import Sleep Data</div>

            {!sleepData && !showManualEntry && (
              <div>
                <input
                  ref={sleepFileRef}
                  type="file"
                  accept=".json"
                  style={{ display: 'none' }}
                  onChange={handleSleepFileSelect}
                />
                <button
                  className="btn btn-primary btn-full mb-8"
                  onClick={() => sleepFileRef.current?.click()}
                >
                  Import Sleep JSON
                </button>

                {importError && (
                  <div className="banner banner-danger mt-8">{importError}</div>
                )}

                <button
                  className="btn btn-secondary btn-full mt-8"
                  onClick={() => setShowManualEntry(true)}
                >
                  Enter manually
                </button>
              </div>
            )}

            {sleepData && !showManualEntry && (
              <div>
                <div className="card" style={{ background: 'var(--color-surface-2)' }}>
                  <div className="card-title">Parsed Sleep Data</div>
                  <div className="summary-row">
                    <span className="summary-label">Sleep</span>
                    <span className="summary-value">
                      {formatTime12h(sleepData.sleepTime)} &ndash; {formatTime12h(sleepData.wakeTime)}
                    </span>
                  </div>
                  <div className="summary-row">
                    <span className="summary-label">Score</span>
                    <span className="summary-value text-accent">
                      {sleepData.sleepScore} ({sleepData.sleepScoreDelta >= 0 ? '+' : ''}{sleepData.sleepScoreDelta})
                    </span>
                  </div>
                  <div className="summary-row">
                    <span className="summary-label">Total / Actual</span>
                    <span className="summary-value">
                      {sleepData.totalSleepDuration}m / {sleepData.actualSleepDuration}m
                    </span>
                  </div>
                  <div className="summary-row">
                    <span className="summary-label">Deep / REM / Light</span>
                    <span className="summary-value">
                      {sleepData.deepSleep}m / {sleepData.remSleep}m / {sleepData.lightSleep}m
                    </span>
                  </div>
                  <div className="summary-row">
                    <span className="summary-label">Awake</span>
                    <span className="summary-value">{sleepData.awakeDuration}m</span>
                  </div>
                  <div className="summary-row">
                    <span className="summary-label">Avg Heart Rate</span>
                    <span className="summary-value">{sleepData.avgHeartRate} bpm</span>
                  </div>
                  <div className="summary-row">
                    <span className="summary-label">Night's Low HR</span>
                    <span className="summary-value">
                      {sleepData.minHeartRate != null ? `${sleepData.minHeartRate} bpm` : '--'}
                    </span>
                  </div>
                  <div className="summary-row">
                    <span className="summary-label">Avg Respiratory Rate</span>
                    <span className="summary-value">{sleepData.avgRespiratoryRate} br/min</span>
                  </div>
                  <div className="summary-row">
                    <span className="summary-label">Blood Oxygen</span>
                    <span className="summary-value">{sleepData.bloodOxygenAvg}%</span>
                  </div>
                  {sleepData.skinTempRange && (
                    <div className="summary-row">
                      <span className="summary-label">Skin Temp</span>
                      <span className="summary-value">{sleepData.skinTempRange}</span>
                    </div>
                  )}
                  {wakeUpEvents.length > 0 && (
                    <>
                      <div className="summary-row" style={{ borderTop: '1px solid var(--color-border)', paddingTop: 8, marginTop: 8 }}>
                        <span className="summary-label">Wake-Up Events</span>
                        <span className="summary-value">{wakeUpEvents.length}</span>
                      </div>
                      {wakeUpEvents.map((ev) => {
                        const causeMatch = (wakeUpCauses ?? []).find((c) => c.id === ev.cause);
                        return (
                          <div key={ev.id} className="summary-row">
                            <span className="summary-label text-sm" style={{ paddingLeft: 8 }}>
                              {ev.startTime ? formatTime12h(ev.startTime) : '?'}
                              {ev.endTime ? ` \u2013 ${formatTime12h(ev.endTime)}` : ''}
                            </span>
                            <span className="summary-value text-sm">
                              {causeMatch?.label || 'Cause not set'}
                            </span>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>

                <div className="flex gap-8 mt-8">
                  <button className="btn btn-primary" style={{ flex: 1 }} onClick={goNext}>
                    Looks right
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ flex: 1 }}
                    onClick={() => { setSleepData(null); setImportError(null); }}
                  >
                    Try again
                  </button>
                </div>
              </div>
            )}

            {showManualEntry && (
              <div>
                <div className="form-group">
                  <label className="form-label">Sleep time</label>
                  <input type="time" className="form-input" value={manualFields.sleepTime} onChange={(e) => updateManualField('sleepTime', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Wake time</label>
                  <input type="time" className="form-input" value={manualFields.wakeTime} onChange={(e) => updateManualField('wakeTime', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Total sleep duration (min)</label>
                  <input type="number" className="form-input" value={manualFields.totalSleepDuration} onChange={(e) => updateManualField('totalSleepDuration', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Actual sleep duration (min)</label>
                  <input type="number" className="form-input" value={manualFields.actualSleepDuration} onChange={(e) => updateManualField('actualSleepDuration', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Sleep score (0-100)</label>
                  <input type="number" className="form-input" value={manualFields.sleepScore} onChange={(e) => updateManualField('sleepScore', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Score delta</label>
                  <input type="number" className="form-input" value={manualFields.sleepScoreDelta} onChange={(e) => updateManualField('sleepScoreDelta', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Deep sleep (min)</label>
                  <input type="number" className="form-input" value={manualFields.deepSleep} onChange={(e) => updateManualField('deepSleep', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">REM sleep (min)</label>
                  <input type="number" className="form-input" value={manualFields.remSleep} onChange={(e) => updateManualField('remSleep', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Light sleep (min)</label>
                  <input type="number" className="form-input" value={manualFields.lightSleep} onChange={(e) => updateManualField('lightSleep', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Awake duration (min)</label>
                  <input type="number" className="form-input" value={manualFields.awakeDuration} onChange={(e) => updateManualField('awakeDuration', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Avg heart rate (bpm)</label>
                  <input type="number" className="form-input" value={manualFields.avgHeartRate} onChange={(e) => updateManualField('avgHeartRate', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Night's low HR (bpm)</label>
                  <input type="number" className="form-input" value={manualFields.minHeartRate} onChange={(e) => updateManualField('minHeartRate', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Avg respiratory rate (br/min)</label>
                  <input type="number" className="form-input" value={manualFields.avgRespiratoryRate} onChange={(e) => updateManualField('avgRespiratoryRate', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Blood oxygen avg (%)</label>
                  <input type="number" className="form-input" value={manualFields.bloodOxygenAvg} onChange={(e) => updateManualField('bloodOxygenAvg', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Skin temp range</label>
                  <input type="text" className="form-input" placeholder="e.g. 91-95F" value={manualFields.skinTempRange} onChange={(e) => updateManualField('skinTempRange', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Sleep latency rating</label>
                  <select className="form-input" value={manualFields.sleepLatencyRating} onChange={(e) => updateManualField('sleepLatencyRating', e.target.value)}>
                    {VALID_RATINGS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Restfulness rating</label>
                  <select className="form-input" value={manualFields.restfulnessRating} onChange={(e) => updateManualField('restfulnessRating', e.target.value)}>
                    {VALID_RATINGS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Deep sleep rating</label>
                  <select className="form-input" value={manualFields.deepSleepRating} onChange={(e) => updateManualField('deepSleepRating', e.target.value)}>
                    {VALID_RATINGS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">REM sleep rating</label>
                  <select className="form-input" value={manualFields.remSleepRating} onChange={(e) => updateManualField('remSleepRating', e.target.value)}>
                    {VALID_RATINGS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>

                <div className="flex gap-8 mt-16">
                  <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleManualSave}>
                    Save
                  </button>
                  <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowManualEntry(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Step 2: Import Govee Room Data */}
      {step === 2 && (
        <div>
          <div className="card">
            <div className="card-title">Room Environment Data</div>

            {!roomTimeline && (
              <div>
                <input
                  ref={goveeFileRef}
                  type="file"
                  accept=".csv"
                  style={{ display: 'none' }}
                  onChange={handleGoveeFileSelect}
                />
                <button
                  className="btn btn-primary btn-full mb-8"
                  onClick={() => goveeFileRef.current?.click()}
                >
                  Import Govee CSV
                </button>

                {goveeError && (
                  <div className="banner banner-danger mt-8">{goveeError}</div>
                )}
              </div>
            )}

            {roomTimeline && roomTimeline.length > 0 && (
              <div>
                <div className="card" style={{ background: 'var(--color-surface-2)' }}>
                  <div className="card-title">Room Data Summary</div>
                  <div className="summary-row">
                    <span className="summary-label">Readings</span>
                    <span className="summary-value">{roomTimeline.length} data points</span>
                  </div>
                  <div className="summary-row">
                    <span className="summary-label">Temp Range</span>
                    <span className="summary-value">
                      {goveeMinTemp?.toFixed(1)}&deg;F &ndash; {goveeMaxTemp?.toFixed(1)}&deg;F
                    </span>
                  </div>
                  <div className="summary-row">
                    <span className="summary-label">Humidity Range</span>
                    <span className="summary-value">
                      {Math.min(...roomTimeline.map((r) => r.humidity)).toFixed(0)}% &ndash;{' '}
                      {Math.max(...roomTimeline.map((r) => r.humidity)).toFixed(0)}%
                    </span>
                  </div>
                </div>
                <div className="flex gap-8 mt-8">
                  <button className="btn btn-primary" style={{ flex: 1 }} onClick={goNext}>
                    Looks right
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ flex: 1 }}
                    onClick={() => { setRoomTimeline(null); setGoveeError(null); }}
                  >
                    Try again
                  </button>
                </div>
              </div>
            )}

            {roomTimeline && roomTimeline.length === 0 && (
              <div className="banner banner-warning">
                No readings found for the overnight window.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Step 3: Wake-Up Events */}
      {step === 3 && (
        <div>
          <div className="card">
            <div className="card-title">Wake-Up Events</div>
            <div className="switch-row">
              <span>Did you wake up during the night?</span>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={hadWakeUps}
                  onChange={(e) => setHadWakeUps(e.target.checked)}
                />
                <span className="switch-slider" />
              </label>
            </div>
          </div>

          {hadWakeUps && (
            <div>
              {wakeUpEvents.map((event) => {
                const causeLabel = (wakeUpCauses ?? []).find((c) => c.id === event.cause)?.label ?? 'Unknown';
                return (
                  <div key={event.id} className="card">
                    <div className="flex items-center justify-between mb-8">
                      <div>
                        <span className="fw-600">
                          {event.startTime ? formatTime12h(event.startTime) : 'No time set'}
                          {event.endTime ? ` \u2013 ${formatTime12h(event.endTime)}` : ''}
                        </span>
                        <span className="text-secondary text-sm"> &mdash; {causeLabel}</span>
                      </div>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => removeWakeUpEvent(event.id)}
                      >
                        Delete
                      </button>
                    </div>
                    <div className="flex gap-8">
                      <div className="form-group" style={{ flex: 1 }}>
                        <label className="form-label">Woke up at</label>
                        <input
                          type="time"
                          className="form-input"
                          value={event.startTime}
                          onChange={(e) => updateWakeUpEvent(event.id, 'startTime', e.target.value)}
                        />
                      </div>
                      <div className="form-group" style={{ flex: 1 }}>
                        <label className="form-label">Back to sleep at</label>
                        <input
                          type="time"
                          className="form-input"
                          value={event.endTime}
                          onChange={(e) => updateWakeUpEvent(event.id, 'endTime', e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Cause</label>
                      <select
                        className="form-input"
                        value={event.cause}
                        onChange={(e) => updateWakeUpEvent(event.id, 'cause', e.target.value)}
                      >
                        <option value="">Select cause...</option>
                        {(wakeUpCauses ?? []).map((c) => (
                          <option key={c.id} value={c.id}>{c.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Fell back asleep?</label>
                      <select
                        className="form-input"
                        value={event.fellBackAsleep}
                        onChange={(e) => updateWakeUpEvent(event.id, 'fellBackAsleep', e.target.value)}
                      >
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                        <option value="eventually">Eventually</option>
                      </select>
                    </div>
                    {(event.fellBackAsleep === 'yes' || event.fellBackAsleep === 'eventually') && (
                      <div className="form-group">
                        <label className="form-label">Minutes to fall back asleep</label>
                        <input
                          type="number"
                          className="form-input"
                          value={event.minutesToFallBackAsleep ?? ''}
                          onChange={(e) =>
                            updateWakeUpEvent(
                              event.id,
                              'minutesToFallBackAsleep',
                              e.target.value ? Number(e.target.value) : null
                            )
                          }
                        />
                      </div>
                    )}
                    <div className="form-group">
                      <label className="form-label">Notes</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Optional notes"
                        value={event.notes}
                        onChange={(e) => updateWakeUpEvent(event.id, 'notes', e.target.value)}
                      />
                    </div>
                  </div>
                );
              })}
              <button className="btn btn-secondary btn-full" onClick={addWakeUpEvent}>
                Add event
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 4: Bedtime Explanation (conditional — only shown if late) */}
      {step === 4 && needsBedtimeExplanation && (
        <div>
          <div className="card">
            <div className="card-title">Late Bedtime</div>
            <div className="banner banner-warning mb-8">
              You went to bed at {formatTime12h(effectiveBedtime!)}.
              Target was {formatTime12h(nightLog.alarm.targetBedtime)}.
            </div>
            <div className="form-group">
              <label className="form-label">Reason</label>
              <select
                className="form-input"
                value={bedtimeReason}
                onChange={(e) => setBedtimeReason(e.target.value)}
              >
                <option value="">Select reason...</option>
                {(bedtimeReasons ?? []).map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea
                className="form-input"
                placeholder="Any details about why bedtime was late..."
                value={bedtimeNotes}
                onChange={(e) => setBedtimeNotes(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Step 5: Notes + Summary + Save */}
      {step === 5 && (
        <div>
          <div className="card">
            <div className="card-title">Morning Notes</div>
            <div className="form-group">
              <textarea
                className="form-input"
                placeholder="How do you feel? Any observations about last night..."
                value={morningNotes}
                onChange={(e) => setMorningNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="card">
            <div className="card-title">Summary</div>
            <div className="summary-row">
              <span className="summary-label">Sleep score</span>
              <span className="summary-value text-accent">
                {sleepData ? sleepData.sleepScore : '--'}
              </span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Sleep time</span>
              <span className="summary-value">
                {sleepData ? formatTime12h(sleepData.sleepTime) : '--'}
              </span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Wake time</span>
              <span className="summary-value">
                {sleepData ? formatTime12h(sleepData.wakeTime) : '--'}
              </span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Total / Actual sleep</span>
              <span className="summary-value">
                {sleepData ? `${sleepData.totalSleepDuration}m / ${sleepData.actualSleepDuration}m` : '--'}
              </span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Deep / REM / Light</span>
              <span className="summary-value">
                {sleepData ? `${sleepData.deepSleep}m / ${sleepData.remSleep}m / ${sleepData.lightSleep}m` : '--'}
              </span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Avg Heart Rate</span>
              <span className="summary-value">
                {sleepData ? `${sleepData.avgHeartRate} bpm` : '--'}
              </span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Night's Low HR</span>
              <span className="summary-value">
                {sleepData && sleepData.minHeartRate != null ? `${sleepData.minHeartRate} bpm` : '--'}
              </span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Room data</span>
              <span className="summary-value">
                {roomTimeline && roomTimeline.length > 0
                  ? `${roomTimeline.length} readings (${goveeMinTemp?.toFixed(1)}-${goveeMaxTemp?.toFixed(1)}F)`
                  : 'Skipped'}
              </span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Wake-ups</span>
              <span className="summary-value">
                {hadWakeUps ? `${wakeUpEvents.length} event(s)` : 'None'}
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
            {needsBedtimeExplanation && (
              <div className="summary-row">
                <span className="summary-label">Late bedtime</span>
                <span className="summary-value text-warning">
                  {bedtimeReason
                    ? (bedtimeReasons ?? []).find((r) => r.id === bedtimeReason)?.label ?? 'Selected'
                    : 'No reason given'}
                </span>
              </div>
            )}
          </div>

          <div className="step-nav">
            <button className="btn btn-secondary" onClick={goBack}>
              Back
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
            >
              Save Morning Log
            </button>
          </div>
        </div>
      )}

      {/* Step navigation */}
      {step < TOTAL_STEPS && (
        <div className="step-nav">
          {step > 1 && (
            <button className="btn btn-secondary" onClick={goBack}>
              Back
            </button>
          )}
          {!(step === 1 && sleepData) && (
            <button className="btn btn-primary" onClick={goNext}>
              {step === 2 && !roomTimeline ? 'Skip' : 'Next'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
