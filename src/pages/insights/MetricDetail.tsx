import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { db } from '../../db';
import { getEffectiveSleepData } from '../../utils';
import type { NightLog } from '../../types';

type MetricType = 'score' | 'sleep' | 'deep' | 'hr' | 'wake';

interface MetricConfig {
  title: string;
  description: string;
  format: (v: number) => string;
  extract: (log: NightLog) => number | null;
  yDomain?: [number, number];
}

function formatMinutesAsHM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}h ${m}m`;
}

const METRIC_CONFIG: Record<MetricType, MetricConfig> = {
  score: {
    title: 'Sleep Score',
    description: 'Nightly sleep score over time',
    format: (v) => String(Math.round(v)),
    extract: (log) => log.sleepData?.sleepScore ?? null,
    yDomain: [0, 100],
  },
  sleep: {
    title: 'Total Sleep',
    description: 'Hours asleep per night',
    format: (v) => formatMinutesAsHM(v),
    extract: (log) => getEffectiveSleepData(log)?.totalSleepDuration ?? log.sleepData?.totalSleepDuration ?? null,
  },
  deep: {
    title: 'Deep Sleep',
    description: 'Minutes of deep sleep per night',
    format: (v) => `${Math.round(v)} min`,
    extract: (log) => log.sleepData?.deepSleep ?? null,
  },
  hr: {
    title: 'Avg Heart Rate',
    description: 'Overnight average heart rate',
    format: (v) => `${Math.round(v)} bpm`,
    extract: (log) => log.sleepData?.avgHeartRate ?? null,
  },
  wake: {
    title: 'Wake-Ups',
    description: 'Logged wake-up events per night',
    format: (v) => String(Math.round(v)),
    extract: (log) => log.wakeUpEvents.length,
  },
};

export function MetricDetail() {
  const { type } = useParams<{ type: string }>();
  const navigate = useNavigate();

  const allLogs = useLiveQuery(
    () => db.nightLogs.orderBy('date').reverse().limit(30).toArray(),
    []
  );

  const config = type ? METRIC_CONFIG[type as MetricType] : undefined;

  if (!config) {
    return (
      <div className="empty-state">
        <h3>Unknown metric</h3>
        <button className="btn btn-primary mt-16" onClick={() => navigate('/insights')}>
          Back to Insights
        </button>
      </div>
    );
  }

  if (!allLogs) {
    return <div className="empty-state"><h3>Loading...</h3></div>;
  }

  const rows = allLogs
    .map((log) => {
      const value = config.extract(log);
      return value !== null ? { id: log.id, date: log.date, value } : null;
    })
    .filter((r): r is { id: string; date: string; value: number } => r !== null);

  const last7 = rows.slice(0, 7);
  const avg7 = last7.length > 0 ? last7.reduce((s, r) => s + r.value, 0) / last7.length : 0;

  const avg30 = rows.length > 0 ? rows.reduce((s, r) => s + r.value, 0) / rows.length : 0;

  const max = rows.length > 0 ? Math.max(...rows.map((r) => r.value)) : 0;
  const min = rows.length > 0 ? Math.min(...rows.map((r) => r.value)) : 0;

  const chartData = rows.slice(0, 14).reverse().map((r) => ({
    date: r.date.slice(5),
    value: r.value,
  }));

  return (
    <div>
      <div className="page-header">
        <button
          className="btn btn-secondary btn-sm mb-8"
          onClick={() => navigate('/insights')}
        >
          {'\u2190 Back'}
        </button>
        <h1>{config.title}</h1>
        <p className="subtitle">{config.description}</p>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          <h3>No data yet</h3>
          <p>Log more nights to see {config.title.toLowerCase()} over time.</p>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="card-title">Summary</div>
            <div className="metrics-row">
              <div className="metric-card">
                <div className="metric-value">{config.format(avg7)}</div>
                <div className="metric-label">7-Day Avg</div>
              </div>
              <div className="metric-card">
                <div className="metric-value">{config.format(avg30)}</div>
                <div className="metric-label">{rows.length}-Night Avg</div>
              </div>
            </div>
            <div className="metrics-row">
              <div className="metric-card">
                <div className="metric-value">{config.format(max)}</div>
                <div className="metric-label">Max</div>
              </div>
              <div className="metric-card">
                <div className="metric-value">{config.format(min)}</div>
                <div className="metric-label">Min</div>
              </div>
            </div>
          </div>

          {chartData.length > 0 && (
            <div className="card">
              <div className="card-title">Last {chartData.length} nights</div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData}>
                  <XAxis
                    dataKey="date"
                    tick={{ fill: '#9999aa', fontSize: 11 }}
                    axisLine={{ stroke: '#333355' }}
                    tickLine={false}
                  />
                  <YAxis
                    domain={config.yDomain ?? ['auto', 'auto']}
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
                    dataKey="value"
                    stroke="#e2b714"
                    strokeWidth={2}
                    dot={{ fill: '#e2b714', r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="card">
            <div className="card-title">All nights ({rows.length})</div>
            {rows.map((r) => (
              <div
                key={r.id}
                className="list-item"
                onClick={() => navigate(`/morning/review/${r.id}`)}
              >
                <div className="fw-600">{r.date}</div>
                <div className="fw-600" style={{ color: 'var(--color-accent)' }}>
                  {config.format(r.value)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
