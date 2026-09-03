import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { db } from '../../db';
import { getEffectiveSleepData } from '../../utils';
import { buildNightMetricCtx, getMetric, type NightMetricCtx } from '../../services/nightMetrics';

/**
 * Per-metric detail (7/30-night averages, 14-night line, per-night list).
 * The legacy `:type` keys stay valid; new keys come from the night-metric
 * registry (insights-and-rules.md).
 */
type MetricType =
  | 'score' | 'sleep' | 'deep' | 'hr' | 'wake'
  | 'weightDelta' | 'neckDelta' | 'orthoAm' | 'orthoPm' | 'episodes' | 'sodium';

interface MetricConfig {
  title: string;
  description: string;
  format: (v: number) => string;
  extract: (ctx: NightMetricCtx) => number | null;
  yDomain?: [number, number];
}

function formatMinutesAsHM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}h ${m}m`;
}

const fromRegistry = (key: string, format: (v: number) => string, title?: string, description?: string): MetricConfig => {
  const m = getMetric(key);
  return { title: title ?? m.label, description: description ?? m.label, format, extract: m.extract };
};

const METRIC_CONFIG: Record<MetricType, MetricConfig> = {
  score: { ...fromRegistry('sleepScore', (v) => String(Math.round(v)), 'Sleep Score', 'Nightly sleep score over time'), yDomain: [0, 100] },
  sleep: {
    title: 'Total Sleep',
    description: 'Hours asleep per night',
    format: (v) => formatMinutesAsHM(v),
    extract: ({ log }) => getEffectiveSleepData(log)?.totalSleepDuration ?? log.sleepData?.totalSleepDuration ?? null,
  },
  deep: fromRegistry('deepSleep', (v) => `${Math.round(v)} min`, 'Deep Sleep', 'Minutes of deep sleep per night'),
  hr: fromRegistry('avgHR', (v) => `${Math.round(v)} bpm`, 'Avg Heart Rate', 'Overnight average heart rate'),
  wake: fromRegistry('wakeUpCount', (v) => String(Math.round(v)), 'Wake-Ups', 'Logged wake-up events per night'),
  weightDelta: fromRegistry('weightDelta', (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} lb`, 'Overnight Weight Change', 'Morning weight minus bedtime weight'),
  neckDelta: fromRegistry('neckDelta', (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} in`, 'Overnight Neck Change', 'Morning neck minus bedtime neck'),
  orthoAm: fromRegistry('orthoAmSystolicDrop3', (v) => `${Math.round(v)} mmHg`, 'AM Systolic Drop', 'Supine minus standing (3 min), morning reading'),
  orthoPm: fromRegistry('orthoPmSystolicDrop3', (v) => `${Math.round(v)} mmHg`, 'PM Systolic Drop', 'Supine minus standing (3 min), evening reading'),
  episodes: fromRegistry('episodeCount', (v) => String(Math.round(v)), 'Episodes', '4am episodes captured per night'),
  sodium: fromRegistry('sodiumLevel', (v) => ['normal', 'more', 'much more'][Math.round(v)] ?? String(v), 'Sodium Level', 'Evening sodium load (0 normal, 1 more, 2 much more)'),
};

export function MetricDetail() {
  const { type } = useParams<{ type: string }>();
  const navigate = useNavigate();

  const allLogs = useLiveQuery(
    () => db.nightLogs.orderBy('date').reverse().limit(30).toArray(),
    []
  );
  const bodyRows = useLiveQuery(() => db.bodyMeasurements.toArray(), []);
  const readings = useLiveQuery(() => db.orthostaticReadings.toArray(), []);
  const settings = useLiveQuery(() => db.appSettings.get('default'));

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

  const calibratedAt = settings?.watchBpCalibratedAt ?? null;
  const rows = allLogs
    .map((log) => {
      const value = config.extract(buildNightMetricCtx(log, bodyRows ?? [], readings ?? [], calibratedAt));
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
          onClick={() => navigate(-1)}
        >
          {'← Back'}
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
