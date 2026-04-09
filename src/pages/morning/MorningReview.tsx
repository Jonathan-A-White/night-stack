import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import { formatTime12h } from '../../utils';
import { WeightEditCard } from '../../components/WeightEditCard';

function scoreClass(score: number): string {
  if (score >= 85) return 'score-excellent';
  if (score >= 70) return 'score-good';
  if (score >= 50) return 'score-fair';
  return 'score-poor';
}

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function MorningReview() {
  const { date } = useParams<{ date: string }>();
  const navigate = useNavigate();

  const nightLog = useLiveQuery(
    () => (date ? db.nightLogs.where('date').equals(date).first() : undefined),
    [date]
  );

  const wakeUpCauses = useLiveQuery(() => db.wakeUpCauses.toArray());
  const bedtimeReasons = useLiveQuery(() => db.bedtimeReasons.toArray());
  const clothingItems = useLiveQuery(() => db.clothingItems.toArray());
  const beddingItems = useLiveQuery(() => db.beddingItems.toArray());

  if (!nightLog) {
    return (
      <div className="empty-state">
        <h3>No data found</h3>
        <p>No night log for this date.</p>
        <button className="btn btn-primary mt-16" onClick={() => navigate('/morning')}>
          Go to Morning
        </button>
      </div>
    );
  }

  const sd = nightLog.sleepData;
  const selectedClothing = (clothingItems ?? []).filter((c) => nightLog.clothing.includes(c.id));
  const selectedBedding = (beddingItems ?? []).filter((b) => nightLog.bedding.includes(b.id));

  return (
    <div>
      <div className="page-header">
        <h1>Night Review</h1>
        <div className="subtitle">{date}</div>
      </div>

      {sd && (
        <>
          <div className="text-center mb-16">
            <div className={`score-badge ${scoreClass(sd.sleepScore)}`} style={{ width: 72, height: 72, fontSize: 28, margin: '0 auto' }}>
              {sd.sleepScore}
            </div>
            <div className="text-secondary mt-8">
              Sleep Score {sd.sleepScoreDelta >= 0 ? '+' : ''}{sd.sleepScoreDelta}
            </div>
          </div>

          <div className="metrics-row">
            <div className="metric-card">
              <div className="metric-value">{formatDuration(sd.totalSleepDuration)}</div>
              <div className="metric-label">Total Sleep</div>
            </div>
            <div className="metric-card">
              <div className="metric-value">{formatDuration(sd.actualSleepDuration)}</div>
              <div className="metric-label">Actual Sleep</div>
            </div>
            <div className="metric-card">
              <div className="metric-value">{sd.avgHeartRate}</div>
              <div className="metric-label">Avg HR (bpm)</div>
            </div>
            <div className="metric-card">
              <div className="metric-value">{sd.minHeartRate ?? '--'}</div>
              <div className="metric-label">Night's Low (bpm)</div>
            </div>
          </div>

          <div className="card">
            <div className="card-title">Sleep Stages</div>
            <div className="summary-row">
              <span className="summary-label">Deep Sleep</span>
              <span className="summary-value">{formatDuration(sd.deepSleep)} — {sd.deepSleepRating}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">REM Sleep</span>
              <span className="summary-value">{formatDuration(sd.remSleep)} — {sd.remSleepRating}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Light Sleep</span>
              <span className="summary-value">{formatDuration(sd.lightSleep)}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Awake</span>
              <span className="summary-value">{formatDuration(sd.awakeDuration)}</span>
            </div>
          </div>

          <div className="card">
            <div className="card-title">Vitals & Ratings</div>
            <div className="summary-row">
              <span className="summary-label">Sleep Time</span>
              <span className="summary-value">{formatTime12h(sd.sleepTime)}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Wake Time</span>
              <span className="summary-value">{formatTime12h(sd.wakeTime)}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Respiratory Rate</span>
              <span className="summary-value">{sd.avgRespiratoryRate} br/min</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Blood Oxygen</span>
              <span className="summary-value">{sd.bloodOxygenAvg}%</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Skin Temp Range</span>
              <span className="summary-value">{sd.skinTempRange}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Sleep Latency</span>
              <span className="summary-value">{sd.sleepLatencyRating}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Restfulness</span>
              <span className="summary-value">{sd.restfulnessRating}</span>
            </div>
          </div>
        </>
      )}

      {nightLog.roomTimeline && nightLog.roomTimeline.length > 0 && (
        <div className="card">
          <div className="card-title">Room Conditions</div>
          <div className="summary-row">
            <span className="summary-label">Readings</span>
            <span className="summary-value">{nightLog.roomTimeline.length} data points</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Temp Range</span>
            <span className="summary-value">
              {Math.min(...nightLog.roomTimeline.map((r) => r.tempF)).toFixed(1)}°F — {Math.max(...nightLog.roomTimeline.map((r) => r.tempF)).toFixed(1)}°F
            </span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Humidity Range</span>
            <span className="summary-value">
              {Math.min(...nightLog.roomTimeline.map((r) => r.humidity)).toFixed(0)}% — {Math.max(...nightLog.roomTimeline.map((r) => r.humidity)).toFixed(0)}%
            </span>
          </div>
        </div>
      )}

      {nightLog.wakeUpEvents.length > 0 && (
        <div className="card">
          <div className="card-title">Wake-Up Events</div>
          {nightLog.wakeUpEvents.map((e) => {
            const cause = (wakeUpCauses ?? []).find((c) => c.id === e.cause);
            return (
              <div key={e.id} className="summary-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                <div className="fw-600">
                  {formatTime12h(e.startTime)}
                  {e.endTime ? ` \u2013 ${formatTime12h(e.endTime)}` : ''} — {cause?.label ?? 'Unknown'}
                </div>
                <div className="text-secondary text-sm">
                  Fell back asleep: {e.fellBackAsleep}
                  {e.minutesToFallBackAsleep ? ` (${e.minutesToFallBackAsleep} min)` : ''}
                </div>
                {e.notes && <div className="text-sm">{e.notes}</div>}
              </div>
            );
          })}
        </div>
      )}

      {nightLog.bedtimeExplanation && (
        <div className="card">
          <div className="card-title">Bedtime Explanation</div>
          <div className="summary-row">
            <span className="summary-label">Actual Bedtime</span>
            <span className="summary-value text-warning">{formatTime12h(nightLog.bedtimeExplanation.actualBedtime)}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Target</span>
            <span className="summary-value">{formatTime12h(nightLog.bedtimeExplanation.targetBedtime)}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Reason</span>
            <span className="summary-value">
              {(bedtimeReasons ?? []).find((r) => r.id === nightLog.bedtimeExplanation!.reason)?.label ?? nightLog.bedtimeExplanation.reason}
            </span>
          </div>
          {nightLog.bedtimeExplanation.notes && (
            <div className="summary-row">
              <span className="summary-label">Notes</span>
              <span className="summary-value">{nightLog.bedtimeExplanation.notes}</span>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-title">Evening Inputs</div>
        <div className="summary-row">
          <span className="summary-label">Alarm</span>
          <span className="summary-value">{formatTime12h(nightLog.alarm.actualAlarmTime)}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Stack</span>
          <span className="summary-value">{nightLog.stack.baseStackUsed ? 'As planned' : `${nightLog.stack.deviations.length} deviation(s)`}</span>
        </div>
        {selectedClothing.length > 0 && (
          <div className="summary-row">
            <span className="summary-label">Clothing</span>
            <span className="summary-value">{selectedClothing.map((c) => c.name).join(', ')}</span>
          </div>
        )}
        {selectedBedding.length > 0 && (
          <div className="summary-row">
            <span className="summary-label">Bedding</span>
            <span className="summary-value">{selectedBedding.map((b) => b.name).join(', ')}</span>
          </div>
        )}
      </div>

      <WeightEditCard nightLogId={nightLog.id} period="morning" />

      {(nightLog.eveningNotes || nightLog.morningNotes) && (
        <div className="card">
          <div className="card-title">Notes</div>
          {nightLog.eveningNotes && <p className="mb-8"><strong>Evening:</strong> {nightLog.eveningNotes}</p>}
          {nightLog.morningNotes && <p><strong>Morning:</strong> {nightLog.morningNotes}</p>}
        </div>
      )}
    </div>
  );
}
