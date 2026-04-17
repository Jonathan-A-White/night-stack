import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { db } from '../../db';
import { formatTime12h } from '../../utils';
import type { NightLog } from '../../types';
import { ThermalComfortChip } from '../../components/ThermalComfortChip';

/**
 * localStorage key for the one-time backfill onboarding card (Q9 option c).
 * Stored as the ISO timestamp when the user first dismissed / acted on the
 * card, so we can tell "never shown" from "dismissed". Any truthy value
 * suppresses future appearances — the card is genuinely one-time.
 */
const BACKFILL_ONBOARDING_KEY = 'insights-backfill-onboarding-seen';

function SubNav({ active }: { active: 'dashboard' | 'correlations' | 'best-nights' }) {
  return (
    <div className="flex gap-8 mb-16" style={{ overflowX: 'auto' }}>
      <Link
        to="/insights"
        className={`btn btn-sm ${active === 'dashboard' ? 'btn-primary' : 'btn-secondary'}`}
      >
        Dashboard
      </Link>
      <Link
        to="/insights/correlations"
        className={`btn btn-sm ${active === 'correlations' ? 'btn-primary' : 'btn-secondary'}`}
      >
        Correlations
      </Link>
      <Link
        to="/insights/best-nights"
        className={`btn btn-sm ${active === 'best-nights' ? 'btn-primary' : 'btn-secondary'}`}
      >
        Best Nights
      </Link>
    </div>
  );
}

export { SubNav };

function scoreClass(score: number): string {
  if (score >= 85) return 'score-excellent';
  if (score >= 70) return 'score-good';
  if (score >= 50) return 'score-fair';
  return 'score-poor';
}

function formatMinutesAsHM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}h ${m}m`;
}

export function Dashboard() {
  const navigate = useNavigate();

  const allLogs = useLiveQuery(
    () => db.nightLogs.orderBy('date').reverse().limit(90).toArray(),
    []
  );

  // Backfill workstream T3 / Q9: count unlabeled, non-dismissed nights so
  // we can show the persistent "Label past nights" button + a one-time
  // onboarding card the first time the user lands on Insights after this
  // ships. The card is suppressed once dismissed or once the user visits
  // the review flow.
  const backfillCandidateCount = useLiveQuery(
    async () => {
      const all = await db.nightLogs
        .filter(
          (l) => l.thermalComfort == null && !l.thermalProxyDismissed,
        )
        .count();
      return all;
    },
    [],
    0,
  );

  const [showOnboardingCard, setShowOnboardingCard] = useState(false);
  useEffect(() => {
    // Read localStorage once on mount. If the user hasn't dismissed and
    // there are candidates, surface the card. We don't re-check on every
    // render — one read is enough, the user dismissing below sets state
    // directly.
    const seen = localStorage.getItem(BACKFILL_ONBOARDING_KEY);
    setShowOnboardingCard(!seen);
  }, []);

  function dismissOnboarding() {
    localStorage.setItem(BACKFILL_ONBOARDING_KEY, String(Date.now()));
    setShowOnboardingCard(false);
  }

  function goToBackfill() {
    // Visiting the flow counts as acknowledging the card; no need to see
    // it again even if the user hits "Cancel" without applying labels.
    localStorage.setItem(BACKFILL_ONBOARDING_KEY, String(Date.now()));
    setShowOnboardingCard(false);
    navigate('/insights/backfill');
  }

  const last14 = useMemo(() => {
    if (!allLogs) return [];
    return allLogs.slice(0, 14).reverse();
  }, [allLogs]);

  const last7 = useMemo(() => {
    if (!allLogs) return [];
    return allLogs.slice(0, 7);
  }, [allLogs]);

  // Chart data
  const chartData = useMemo(() => {
    return last14
      .filter((log) => log.sleepData)
      .map((log) => ({
        date: log.date.slice(5), // "MM-DD"
        score: log.sleepData!.sleepScore,
      }));
  }, [last14]);

  // 7-day averages
  const metrics = useMemo(() => {
    const withSleep = last7.filter((log) => log.sleepData);
    if (withSleep.length === 0) return null;

    const n = withSleep.length;
    const avgScore = withSleep.reduce((s, l) => s + l.sleepData!.sleepScore, 0) / n;
    const avgTotal = withSleep.reduce((s, l) => s + l.sleepData!.totalSleepDuration, 0) / n;
    const avgDeep = withSleep.reduce((s, l) => s + l.sleepData!.deepSleep, 0) / n;
    const avgHR = withSleep.reduce((s, l) => s + l.sleepData!.avgHeartRate, 0) / n;
    const wakeNights = last7.filter((l) => l.wakeUpEvents.length > 0).length;

    return { avgScore, avgTotal, avgDeep, avgHR, wakeNights };
  }, [last7]);

  // Flags for recent nights
  function getFlags(log: NightLog): string[] {
    const flags: string[] = [];
    if (log.bedtimeExplanation?.wasLate) flags.push('Late bedtime');
    if (log.wakeUpEvents.length > 0) flags.push(`${log.wakeUpEvents.length} wake-up${log.wakeUpEvents.length > 1 ? 's' : ''}`);
    if (log.stack.deviations.length > 0) flags.push(`${log.stack.deviations.length} deviation${log.stack.deviations.length > 1 ? 's' : ''}`);
    return flags;
  }

  if (!allLogs) {
    return <div className="empty-state"><h3>Loading...</h3></div>;
  }

  return (
    <div>
      <div className="page-header">
        <h1>Insights</h1>
        <p className="subtitle">Your sleep trends and patterns</p>
      </div>

      <SubNav active="dashboard" />

      {/* Backfill: one-time onboarding card (Q9 option c). Surfaces the
          first time the user lands here post-ship, if there's anything to
          label. Dismissible; "Label now" jumps straight to the review. */}
      {showOnboardingCard && backfillCandidateCount > 0 && (
        <div className="card">
          <div className="card-title">Label your past nights</div>
          <p className="text-secondary text-sm">
            We can guess how each past night went (too hot, too cold, just
            right) from the wake-ups you already logged. That gives the
            recommender something to work with on night one — no need to
            wait two weeks to build up ground truth.
          </p>
          <div className="flex gap-8 mt-16">
            <button className="btn btn-primary" onClick={goToBackfill}>
              Label now
            </button>
            <button className="btn btn-secondary" onClick={dismissOnboarding}>
              Maybe later
            </button>
          </div>
        </div>
      )}

      {/* Backfill: persistent entry point (Q9 option a). Shown whenever
          there's still anything to review, even after the onboarding card
          has been dismissed. Hidden when the queue is empty to avoid
          dead-ended buttons. */}
      {backfillCandidateCount > 0 && (
        <div className="flex mb-16">
          <button
            className="btn btn-secondary"
            onClick={() => navigate('/insights/backfill')}
          >
            Label past nights ({backfillCandidateCount})
          </button>
        </div>
      )}

      {allLogs.length === 0 ? (
        <div className="empty-state">
          <h3>No data yet</h3>
          <p>Complete your first evening and morning logs to see insights here.</p>
        </div>
      ) : (
        <>
          {/* Sleep Score Trend */}
          {chartData.length > 0 && (
            <div className="card">
              <div className="card-title">Sleep Score Trend (14 nights)</div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData}>
                  <XAxis
                    dataKey="date"
                    tick={{ fill: '#9999aa', fontSize: 11 }}
                    axisLine={{ stroke: '#333355' }}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fill: '#9999aa', fontSize: 11 }}
                    axisLine={{ stroke: '#333355' }}
                    tickLine={false}
                    width={30}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#1a1a2e',
                      border: '1px solid #333355',
                      borderRadius: 8,
                      color: '#e8e8ed',
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke="#e2b714"
                    strokeWidth={2}
                    dot={{ fill: '#e2b714', r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Key Metrics Cards */}
          {metrics && (
            <div className="card">
              <div className="card-title">7-Day Averages</div>
              <div className="metrics-row">
                <div
                  className="metric-card metric-card--clickable"
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate('/insights/metric/score')}
                >
                  <div className="metric-value">{Math.round(metrics.avgScore)}</div>
                  <div className="metric-label">Avg Score</div>
                </div>
                <div
                  className="metric-card metric-card--clickable"
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate('/insights/metric/sleep')}
                >
                  <div className="metric-value">{formatMinutesAsHM(metrics.avgTotal)}</div>
                  <div className="metric-label">Avg Sleep</div>
                </div>
                <div
                  className="metric-card metric-card--clickable"
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate('/insights/metric/deep')}
                >
                  <div className="metric-value">{Math.round(metrics.avgDeep)}</div>
                  <div className="metric-label">Deep (min)</div>
                </div>
              </div>
              <div className="metrics-row">
                <div
                  className="metric-card metric-card--clickable"
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate('/insights/metric/hr')}
                >
                  <div className="metric-value">{Math.round(metrics.avgHR)}</div>
                  <div className="metric-label">Avg HR (bpm)</div>
                </div>
                <div
                  className="metric-card metric-card--clickable"
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate('/insights/metric/wake')}
                >
                  <div className="metric-value">{metrics.wakeNights}</div>
                  <div className="metric-label">Wake Nights</div>
                </div>
              </div>
            </div>
          )}

          {/* Recent Nights List */}
          <div className="card">
            <div className="card-title">Recent Nights</div>
            {last7.map((log) => {
              const flags = getFlags(log);
              return (
                <div
                  key={log.id}
                  className="list-item"
                  onClick={() => navigate(`/morning/review/${log.id}`)}
                >
                  <div>
                    <div className="flex items-center gap-8">
                      <span className="fw-600">{log.date}</span>
                      {/* ux.md T6: render a chip on every row — grey "—"
                          for nights with no label so the layout stays
                          even and the user has an affordance to label. */}
                      <ThermalComfortChip log={log} renderEmpty />
                    </div>
                    {flags.length > 0 && (
                      <div className="text-secondary text-sm mt-8">
                        {flags.join(' \u00b7 ')}
                      </div>
                    )}
                  </div>
                  {log.sleepData && (
                    <div className={`score-badge ${scoreClass(log.sleepData.sleepScore)}`}>
                      {log.sleepData.sleepScore}
                    </div>
                  )}
                </div>
              );
            })}
            {last7.length === 0 && (
              <p className="text-secondary text-sm">No nights logged yet.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
