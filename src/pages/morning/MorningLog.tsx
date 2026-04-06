import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import { getTodayDate, formatTime12h, isTimeAfter } from '../../utils';
import { parseSamsungHealthJSON, parseGoveeCSV } from '../../services/importers';
import type { SleepData, WakeUpEvent, BedtimeExplanation } from '../../types';

const TOTAL_STEPS = 5;

export function MorningLog() {
  const navigate = useNavigate();
  const today = getTodayDate();

  // Try today's log, then yesterday's
  const nightLog = useLiveQuery(async () => {
    let log = await db.nightLogs.where('date').equals(today).first();
    if (!log) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yDate = yesterday.toISOString().split('T')[0];
      log = await db.nightLogs.where('date').equals(yDate).first();
    }
    return log;
  }, [today]);

  const wakeUpCauses = useLiveQuery(() => db.wakeUpCauses.orderBy('sortOrder').toArray());
  const bedtimeReasons = useLiveQuery(() => db.bedtimeReasons.orderBy('sortOrder').toArray());

  const [step, setStep] = useState(0);
  const [sleepData, setSleepData] = useState<SleepData | null>(null);
  const [sleepError, setSleepError] = useState('');
  const [roomReadings, setRoomReadings] = useState<import('../../types').RoomReading[] | null>(null);
  const [wakeUpEvents, setWakeUpEvents] = useState<WakeUpEvent[]>([]);
  const [hadWakeUps, setHadWakeUps] = useState(false);
  const [bedtimeExplanation, setBedtimeExplanation] = useState<BedtimeExplanation | null>(null);
  const [morningNotes, setMorningNotes] = useState('');
  const [manualEntry, setManualEntry] = useState(false);
  const [manualFields, setManualFields] = useState({
    sleepTime: '', wakeTime: '', totalSleepDuration: '', actualSleepDuration: '',
    sleepScore: '', sleepScoreDelta: '', deepSleep: '', remSleep: '', lightSleep: '',
    awakeDuration: '', avgHeartRate: '', avgRespiratoryRate: '', bloodOxygenAvg: '', skinTempRange: '',
  });

  // New wake-up event form
  const [newEvent, setNewEvent] = useState<{ time: string; cause: string; fellBackAsleep: 'yes' | 'no' | 'eventually'; minutes: string; notes: string }>({ time: '', cause: '', fellBackAsleep: 'yes', minutes: '', notes: '' });

  const jsonInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  if (!nightLog) {
    return (
      <div className="empty-state">
        <h3>No evening log found</h3>
        <p>Complete your evening log first to start the morning debrief.</p>
        <button className="btn btn-primary mt-16" onClick={() => navigate('/tonight')}>
          Go to Tonight
        </button>
      </div>
    );
  }

  // Determine if bedtime explanation is needed
  const needsBedtimeExplanation = sleepData && nightLog.alarm.targetBedtime &&
    isTimeAfter(sleepData.sleepTime, nightLog.alarm.targetBedtime);

  // Auto-skip step 4 if not needed
  const getEffectiveStep = (s: number) => {
    if (s === 3 && !needsBedtimeExplanation) return 4; // Skip to step 5
    return s;
  };

  const handleJsonImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = parseSamsungHealthJSON(reader.result as string);
      if (result.error) {
        setSleepError(result.error);
        setSleepData(null);
      } else {
        setSleepData(result.data);
        setSleepError('');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleCsvImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = parseGoveeCSV(reader.result as string, nightLog.date);
      if (result.error) {
        setRoomReadings(null);
      } else {
        setRoomReadings(result.data);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleManualSleepData = (): SleepData => ({
    sleepTime: manualFields.sleepTime || '22:00',
    wakeTime: manualFields.wakeTime || '06:00',
    totalSleepDuration: parseInt(manualFields.totalSleepDuration) || 0,
    actualSleepDuration: parseInt(manualFields.actualSleepDuration) || 0,
    sleepScore: parseInt(manualFields.sleepScore) || 0,
    sleepScoreDelta: parseInt(manualFields.sleepScoreDelta) || 0,
    deepSleep: parseInt(manualFields.deepSleep) || 0,
    remSleep: parseInt(manualFields.remSleep) || 0,
    lightSleep: parseInt(manualFields.lightSleep) || 0,
    awakeDuration: parseInt(manualFields.awakeDuration) || 0,
    avgHeartRate: parseInt(manualFields.avgHeartRate) || 0,
    avgRespiratoryRate: parseFloat(manualFields.avgRespiratoryRate) || 0,
    bloodOxygenAvg: parseInt(manualFields.bloodOxygenAvg) || 0,
    skinTempRange: manualFields.skinTempRange || '',
    sleepLatencyRating: 'Good',
    restfulnessRating: 'Good',
    deepSleepRating: 'Good',
    remSleepRating: 'Good',
    importedAt: Date.now(),
  });

  const addWakeUpEvent = () => {
    if (!newEvent.time || !newEvent.cause) return;
    const event: WakeUpEvent = {
      id: crypto.randomUUID(),
      approximateTime: newEvent.time,
      cause: newEvent.cause,
      fellBackAsleep: newEvent.fellBackAsleep,
      minutesToFallBackAsleep: newEvent.minutes ? parseInt(newEvent.minutes) : null,
      notes: newEvent.notes,
    };
    setWakeUpEvents([...wakeUpEvents, event]);
    setNewEvent({ time: '', cause: '', fellBackAsleep: 'yes', minutes: '', notes: '' });
  };

  const removeWakeUpEvent = (id: string) => {
    setWakeUpEvents(wakeUpEvents.filter((e) => e.id !== id));
  };

  const handleSave = async () => {
    const finalSleepData = manualEntry ? handleManualSleepData() : sleepData;

    const explanation = needsBedtimeExplanation && bedtimeExplanation ? bedtimeExplanation : null;

    await db.nightLogs.update(nightLog.id, {
      sleepData: finalSleepData,
      roomTimeline: roomReadings,
      wakeUpEvents,
      bedtimeExplanation: explanation,
      morningNotes,
      updatedAt: Date.now(),
    });

    navigate(`/morning/review/${nightLog.date}`);
  };

  const effectiveStep = getEffectiveStep(step);

  const goNext = () => {
    if (step < TOTAL_STEPS - 1) {
      let next = step + 1;
      // Skip bedtime explanation if not needed
      if (next === 3 && !needsBedtimeExplanation) next = 4;
      setStep(next);
    }
  };

  const goBack = () => {
    if (step > 0) {
      let prev = step - 1;
      if (prev === 3 && !needsBedtimeExplanation) prev = 2;
      setStep(prev);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Morning Log</h1>
        <div className="subtitle">{nightLog.date}</div>
      </div>

      <div className="step-progress">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <div key={i} className={`step-dot ${i < step ? 'completed' : ''} ${i === step ? 'active' : ''}`} />
        ))}
      </div>

      {/* Step 1: Samsung Health Import */}
      {step === 0 && (
        <div>
          <div className="card">
            <div className="card-title">Import Sleep Data</div>
            <input
              ref={jsonInputRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={handleJsonImport}
            />
            <button className="btn btn-primary btn-full mb-8" onClick={() => jsonInputRef.current?.click()}>
              Import Sleep JSON
            </button>

            {sleepError && <div className="banner banner-danger">{sleepError}</div>}

            {sleepData && (
              <div className="card" style={{ background: 'var(--color-surface-2)' }}>
                <div className="card-title">Parsed Sleep Data</div>
                <div className="summary-row">
                  <span className="summary-label">Sleep</span>
                  <span className="summary-value">{formatTime12h(sleepData.sleepTime)} - {formatTime12h(sleepData.wakeTime)}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Score</span>
                  <span className="summary-value text-accent">{sleepData.sleepScore} ({sleepData.sleepScoreDelta >= 0 ? '+' : ''}{sleepData.sleepScoreDelta})</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Total / Actual</span>
                  <span className="summary-value">{sleepData.totalSleepDuration}m / {sleepData.actualSleepDuration}m</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Deep / REM / Light</span>
                  <span className="summary-value">{sleepData.deepSleep}m / {sleepData.remSleep}m / {sleepData.lightSleep}m</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Heart Rate</span>
                  <span className="summary-value">{sleepData.avgHeartRate} bpm</span>
                </div>
                <div className="flex gap-8 mt-8">
                  <button className="btn btn-primary" onClick={goNext}>Looks right</button>
                  <button className="btn btn-secondary" onClick={() => { setSleepData(null); setSleepError(''); }}>Try again</button>
                </div>
              </div>
            )}

            {!sleepData && (
              <div className="mt-16">
                <button className="btn btn-secondary btn-full" onClick={() => setManualEntry(!manualEntry)}>
                  {manualEntry ? 'Hide Manual Entry' : 'Enter Manually'}
                </button>

                {manualEntry && (
                  <div className="mt-8">
                    {Object.entries(manualFields).map(([key, val]) => (
                      <div key={key} className="form-group">
                        <label className="form-label">{key}</label>
                        <input
                          className="form-input"
                          type={key.includes('Time') ? 'time' : key === 'skinTempRange' ? 'text' : 'number'}
                          value={val}
                          onChange={(e) => setManualFields({ ...manualFields, [key]: e.target.value })}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Step 2: Govee CSV Import */}
      {step === 1 && (
        <div>
          <div className="card">
            <div className="card-title">Import Room Data</div>
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv"
              style={{ display: 'none' }}
              onChange={handleCsvImport}
            />
            <button className="btn btn-primary btn-full mb-8" onClick={() => csvInputRef.current?.click()}>
              Import Govee CSV
            </button>

            {roomReadings && roomReadings.length > 0 && (
              <div className="card" style={{ background: 'var(--color-surface-2)' }}>
                <div className="card-title">Room Data Summary</div>
                <div className="summary-row">
                  <span className="summary-label">Readings</span>
                  <span className="summary-value">{roomReadings.length} data points</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Temp Range</span>
                  <span className="summary-value">
                    {Math.min(...roomReadings.map((r) => r.tempF)).toFixed(1)}°F - {Math.max(...roomReadings.map((r) => r.tempF)).toFixed(1)}°F
                  </span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Humidity Range</span>
                  <span className="summary-value">
                    {Math.min(...roomReadings.map((r) => r.humidity)).toFixed(0)}% - {Math.max(...roomReadings.map((r) => r.humidity)).toFixed(0)}%
                  </span>
                </div>
              </div>
            )}

            {roomReadings && roomReadings.length === 0 && (
              <div className="banner banner-warning">No readings found for the overnight window.</div>
            )}
          </div>
        </div>
      )}

      {/* Step 3: Wake-Up Events */}
      {step === 2 && (
        <div>
          <div className="card">
            <div className="card-title">Wake-Up Events</div>
            <div className="switch-row">
              <span>Did you wake up during the night?</span>
              <label className="switch">
                <input type="checkbox" checked={hadWakeUps} onChange={(e) => setHadWakeUps(e.target.checked)} />
                <span className="switch-slider" />
              </label>
            </div>

            {hadWakeUps && (
              <>
                {wakeUpEvents.map((evt) => {
                  const cause = (wakeUpCauses ?? []).find((c) => c.id === evt.cause);
                  return (
                    <div key={evt.id} className="card" style={{ background: 'var(--color-surface-2)' }}>
                      <div className="flex justify-between items-center">
                        <div>
                          <div className="fw-600">{formatTime12h(evt.approximateTime)}</div>
                          <div className="text-secondary text-sm">{cause?.label ?? 'Unknown'} — {evt.fellBackAsleep}</div>
                          {evt.notes && <div className="text-sm mt-8">{evt.notes}</div>}
                        </div>
                        <button className="btn btn-sm btn-danger" onClick={() => removeWakeUpEvent(evt.id)}>X</button>
                      </div>
                    </div>
                  );
                })}

                <div className="card" style={{ background: 'var(--color-surface-2)' }}>
                  <div className="card-title">Add Event</div>
                  <div className="form-group">
                    <label className="form-label">Time</label>
                    <input className="form-input" type="time" value={newEvent.time} onChange={(e) => setNewEvent({ ...newEvent, time: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Cause</label>
                    <select className="form-input" value={newEvent.cause} onChange={(e) => setNewEvent({ ...newEvent, cause: e.target.value })}>
                      <option value="">Select cause...</option>
                      {(wakeUpCauses ?? []).filter((c) => c.isActive).map((c) => (
                        <option key={c.id} value={c.id}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Fell back asleep?</label>
                    <select className="form-input" value={newEvent.fellBackAsleep} onChange={(e) => setNewEvent({ ...newEvent, fellBackAsleep: e.target.value as 'yes' | 'no' | 'eventually' })}>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                      <option value="eventually">Eventually</option>
                    </select>
                  </div>
                  {(newEvent.fellBackAsleep === 'yes' || newEvent.fellBackAsleep === 'eventually') && (
                    <div className="form-group">
                      <label className="form-label">Minutes to fall back asleep</label>
                      <input className="form-input" type="number" value={newEvent.minutes} onChange={(e) => setNewEvent({ ...newEvent, minutes: e.target.value })} />
                    </div>
                  )}
                  <div className="form-group">
                    <label className="form-label">Notes</label>
                    <input className="form-input" value={newEvent.notes} onChange={(e) => setNewEvent({ ...newEvent, notes: e.target.value })} />
                  </div>
                  <button className="btn btn-secondary btn-full" onClick={addWakeUpEvent}>Add Event</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Step 4: Bedtime Explanation (conditional) */}
      {step === 3 && needsBedtimeExplanation && (
        <div>
          <div className="card">
            <div className="card-title">Bedtime Explanation</div>
            <div className="banner banner-warning">
              You went to bed at {formatTime12h(sleepData!.sleepTime)}. Target was {formatTime12h(nightLog.alarm.targetBedtime)}.
            </div>
            <div className="form-group">
              <label className="form-label">What happened?</label>
              <select
                className="form-input"
                value={bedtimeExplanation?.reason ?? ''}
                onChange={(e) =>
                  setBedtimeExplanation({
                    actualBedtime: sleepData!.sleepTime,
                    targetBedtime: nightLog.alarm.targetBedtime,
                    wasLate: true,
                    reason: e.target.value,
                    notes: bedtimeExplanation?.notes ?? '',
                  })
                }
              >
                <option value="">Select reason...</option>
                {(bedtimeReasons ?? []).filter((r) => r.isActive).map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea
                className="form-input"
                value={bedtimeExplanation?.notes ?? ''}
                onChange={(e) =>
                  setBedtimeExplanation((prev) =>
                    prev ? { ...prev, notes: e.target.value } : {
                      actualBedtime: sleepData!.sleepTime,
                      targetBedtime: nightLog.alarm.targetBedtime,
                      wasLate: true,
                      reason: '',
                      notes: e.target.value,
                    }
                  )
                }
              />
            </div>
          </div>
        </div>
      )}

      {/* Step 5: Notes & Save */}
      {step === 4 && (
        <div>
          <div className="card">
            <div className="card-title">Morning Notes</div>
            <div className="form-group">
              <textarea
                className="form-input"
                placeholder="How did you feel waking up? Any observations?"
                value={morningNotes}
                onChange={(e) => setMorningNotes(e.target.value)}
                rows={4}
              />
            </div>
          </div>

          <div className="card">
            <div className="card-title">Summary</div>
            {(sleepData || manualEntry) && (
              <div className="summary-row">
                <span className="summary-label">Sleep Score</span>
                <span className="summary-value text-accent">{sleepData?.sleepScore ?? manualFields.sleepScore ?? '-'}</span>
              </div>
            )}
            {roomReadings && (
              <div className="summary-row">
                <span className="summary-label">Room Data</span>
                <span className="summary-value">{roomReadings.length} readings</span>
              </div>
            )}
            <div className="summary-row">
              <span className="summary-label">Wake-Up Events</span>
              <span className="summary-value">{wakeUpEvents.length}</span>
            </div>
            {bedtimeExplanation && (
              <div className="summary-row">
                <span className="summary-label">Late Bedtime</span>
                <span className="summary-value text-warning">Explained</span>
              </div>
            )}
          </div>

          <button className="btn btn-primary btn-full" onClick={handleSave}>Save Morning Log</button>
        </div>
      )}

      <div className="step-nav">
        {step > 0 && <button className="btn btn-secondary" onClick={goBack}>Back</button>}
        {step < TOTAL_STEPS - 1 && step !== 0 && (
          <button className="btn btn-primary" onClick={goNext}>
            {step === 1 ? (roomReadings ? 'Next' : 'Skip') : 'Next'}
          </button>
        )}
        {step === 0 && (manualEntry || sleepData) && !sleepData && (
          <button className="btn btn-primary" onClick={goNext}>Next</button>
        )}
      </div>
    </div>
  );
}
