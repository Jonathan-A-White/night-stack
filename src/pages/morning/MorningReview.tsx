import { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import {
  formatTime12h,
  timestampToHHMM,
  findNearestRoomReading,
  computeAdjustedSleepOnset,
} from '../../utils';
import { WeightEditCard } from '../../components/WeightEditCard';
import { NightLogDateEditor } from '../../components/NightLogDateEditor';
import { ThermalComfortChip } from '../../components/ThermalComfortChip';
import { logToInputs, nightDistance } from '../../services/recommender';
import type { NightLog, ThermalComfort } from '../../types';

const COMFORT_LABEL: Record<ThermalComfort, string> = {
  too_hot: 'too hot',
  too_cold: 'too cold',
  just_right: 'just right',
  mixed: 'mixed',
};

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
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const nightLog = useLiveQuery(
    () => (id ? db.nightLogs.get(id) : undefined),
    [id]
  );

  const wakeUpCauses = useLiveQuery(() => db.wakeUpCauses.toArray());
  const bedtimeReasons = useLiveQuery(() => db.bedtimeReasons.toArray());
  const clothingItems = useLiveQuery(() => db.clothingItems.toArray());
  const beddingItems = useLiveQuery(() => db.beddingItems.toArray());
  // All night logs feed the similarity lookup (ux.md T7). Cheap — Dexie
  // returns a plain array and we filter in-memory.
  const allLogs = useLiveQuery(() => db.nightLogs.toArray(), []);

  // Top-3 similar past nights by nightDistance (ux.md T7). Only runs when
  // this log has a thermalComfort label — otherwise the "how did last
  // night compare" section is hidden entirely. Self-exclusion: the current
  // night's own id is filtered out so it doesn't rank as its own closest
  // match.
  const similarMatches = useMemo(() => {
    if (!nightLog || !allLogs) return [];
    if (!nightLog.thermalComfort) return [];
    const selfInputs = logToInputs(nightLog);
    type Match = { log: NightLog; distance: number };
    const candidates: Match[] = [];
    for (const other of allLogs) {
      if (other.id === nightLog.id) continue;
      candidates.push({
        log: other,
        distance: nightDistance(selfInputs, logToInputs(other)),
      });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    return candidates.slice(0, 3);
  }, [nightLog, allLogs]);

  // "2 of your 3 closest matches also ended X" one-liner. Same-label
  // matches count toward the insight.
  const matchInsight = useMemo(() => {
    if (!nightLog?.thermalComfort) return '';
    const withLabels = similarMatches.filter((m) => m.log.thermalComfort != null);
    if (withLabels.length < 2) return '';
    const sameCount = withLabels.filter(
      (m) => m.log.thermalComfort === nightLog.thermalComfort,
    ).length;
    if (sameCount < 2) return '';
    return `${sameCount} of your ${withLabels.length} closest matches also ended ${COMFORT_LABEL[nightLog.thermalComfort]}.`;
  }, [nightLog, similarMatches]);

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
  const adjustedOnset = sd
    ? computeAdjustedSleepOnset({
        loggedBedtime: nightLog.loggedBedtime,
        watchSleepTime: sd.sleepTime,
        watchTotalDuration: sd.totalSleepDuration,
        watchActualDuration: sd.actualSleepDuration,
      })
    : null;
  const selectedClothing = (clothingItems ?? []).filter((c) => nightLog.clothing.includes(c.id));
  const selectedBedding = (beddingItems ?? []).filter((b) => nightLog.bedding.includes(b.id));

  return (
    <div>
      <div className="page-header">
        <h1>Night Review</h1>
        <div className="subtitle">{nightLog.date}</div>
      </div>

      <NightLogDateEditor nightLog={nightLog} />

      {nightLog.thermalComfort && (
        <div className="card">
          <div className="card-title">Thermal Comfort</div>
          <div className="flex items-center gap-8">
            <ThermalComfortChip log={nightLog} readOnly />
            {nightLog.thermalComfortSource === 'proxy' && (
              <span className="text-secondary text-sm">
                Inferred from wake events — edit in the morning log to confirm.
              </span>
            )}
          </div>
        </div>
      )}

      {/* ux.md T7: "How last night compared" — top-3 similar past nights
          by nightDistance so the user can see which recommender neighbors
          they resembled in hindsight. Hidden when the night hasn't been
          labeled (no signal to anchor against). */}
      {nightLog.thermalComfort && similarMatches.length > 0 && (
        <div className="card">
          <div className="card-title">How last night compared</div>
          <div className="flex items-center gap-8 mb-8">
            <ThermalComfortChip log={nightLog} readOnly />
            <span className="text-secondary text-sm">last night</span>
          </div>
          <div className="text-secondary text-sm mb-8">
            Top 3 past nights with the most similar inputs:
          </div>
          {similarMatches.map((m) => (
            <div key={m.log.id} className="summary-row">
              <span className="summary-label">{m.log.date}</span>
              <span className="summary-value flex items-center gap-8">
                <ThermalComfortChip log={m.log} renderEmpty />
                <span className="text-secondary text-sm">
                  d={m.distance.toFixed(2)}
                </span>
              </span>
            </div>
          ))}
          {matchInsight && (
            <p className="text-sm mt-8">{matchInsight}</p>
          )}
        </div>
      )}

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
              <div className="metric-value">{formatDuration(adjustedOnset?.totalSleepDuration ?? sd.totalSleepDuration)}</div>
              <div className="metric-label">Total Sleep</div>
            </div>
            <div className="metric-card">
              <div className="metric-value">{formatDuration(adjustedOnset?.actualSleepDuration ?? sd.actualSleepDuration)}</div>
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
              <span className="summary-value">{formatTime12h(adjustedOnset?.sleepTime ?? sd.sleepTime)}</span>
            </div>
            {adjustedOnset?.isAdjusted && (
              <div className="text-secondary text-sm" style={{ marginTop: -4, marginBottom: 8 }}>
                Adjusted +{adjustedOnset.adjustmentMinutes}m from evening log
                (watch: {formatTime12h(adjustedOnset.watchSleepTime)}).
              </div>
            )}
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
            const nearest = findNearestRoomReading(e.startTime, nightLog.roomTimeline ?? []);
            return (
              <div key={e.id} className="summary-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                <div className="fw-600">
                  {formatTime12h(e.startTime)}
                  {e.endTime ? ` \u2013 ${formatTime12h(e.endTime)}` : ''} — {cause?.label ?? 'Unknown'}
                </div>
                {nearest && (
                  <div className="text-secondary text-sm">
                    Room at wake-up: {nearest.tempF.toFixed(1)}°F, {nearest.humidity.toFixed(0)}% humidity
                  </div>
                )}
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

      {nightLog.loggedBedtime !== null && !nightLog.bedtimeExplanation && (
        <div className="card">
          <div className="card-title">Logged Bedtime</div>
          <div className="summary-row">
            <span className="summary-label">Time to bed</span>
            <span className="summary-value text-success">
              {formatTime12h(timestampToHHMM(nightLog.loggedBedtime))}
            </span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Target</span>
            <span className="summary-value">
              {formatTime12h(nightLog.alarm.targetBedtime)}
            </span>
          </div>
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
