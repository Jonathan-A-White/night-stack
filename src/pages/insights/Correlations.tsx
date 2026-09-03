import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { db } from '../../db';
import { toLocalDateString } from '../../utils';
import { SubNav } from './Dashboard';
import {
  GROUP_LABELS,
  buildNightMetricCtx,
  getMetric,
  metricsForSide,
  type MetricGroup,
  type NightMetric,
} from '../../services/nightMetrics';

/**
 * Scatter-plot builder. Both pickers are derived from the shared night
 * metric registry (insights-and-rules.md, Q15): tags default to X,
 * deltas and vitals to Y, and any 'both'-sided metric can go on either
 * axis. Per-night context (body measurements, orthostatic readings) is
 * built once per data change.
 */

const GROUP_ORDER: MetricGroup[] = ['tags', 'body', 'vitals', 'environment', 'sleep'];

function MetricSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: NightMetric[];
  onChange: (key: string) => void;
}) {
  return (
    <div className="form-group">
      <label className="form-label" htmlFor={id}>{label}</label>
      <select id={id} className="form-input" value={value} onChange={(e) => onChange(e.target.value)}>
        {GROUP_ORDER.map((g) => {
          const items = options.filter((o) => o.group === g);
          if (items.length === 0) return null;
          return (
            <optgroup key={g} label={GROUP_LABELS[g]}>
              {items.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </optgroup>
          );
        })}
      </select>
    </div>
  );
}

function linearRegression(points: { x: number; y: number }[]) {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: 0, r: 0 };
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);
  const sumY2 = points.reduce((s, p) => s + p.y * p.y, 0);

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n, r: 0 };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  const rNum = n * sumXY - sumX * sumY;
  const rDen = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  const r = rDen === 0 ? 0 : rNum / rDen;

  return { slope, intercept, r };
}

export function Correlations() {
  const [xKey, setXKey] = useState('roomTemp');
  const [yKey, setYKey] = useState('sleepScore');

  const cutoffDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return toLocalDateString(d);
  }, []);

  const logs = useLiveQuery(
    () => db.nightLogs.where('date').above(cutoffDate).toArray(),
    [cutoffDate]
  );
  const bodyRows = useLiveQuery(
    () => db.bodyMeasurements.where('date').above(cutoffDate).toArray(),
    [cutoffDate],
  );
  const readings = useLiveQuery(
    () => db.orthostaticReadings.where('date').above(cutoffDate).toArray(),
    [cutoffDate],
  );
  const settings = useLiveQuery(() => db.appSettings.get('default'));

  const xOptions = useMemo(() => metricsForSide('x'), []);
  const yOptions = useMemo(() => metricsForSide('y'), []);

  const contexts = useMemo(() => {
    if (!logs) return [];
    const calibratedAt = settings?.watchBpCalibratedAt ?? null;
    return logs.map((log) => buildNightMetricCtx(log, bodyRows ?? [], readings ?? [], calibratedAt));
  }, [logs, bodyRows, readings, settings]);

  const { points, regression, trendLine } = useMemo(() => {
    const xm = getMetric(xKey);
    const ym = getMetric(yKey);
    const pts: { x: number; y: number }[] = [];
    for (const ctx of contexts) {
      const x = xm.extract(ctx);
      const y = ym.extract(ctx);
      if (x !== null && y !== null) pts.push({ x, y });
    }
    const reg = linearRegression(pts);
    let trend: { x: number; y: number }[] = [];
    if (pts.length >= 2) {
      const xs = pts.map((p) => p.x);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      trend = [
        { x: minX, y: reg.slope * minX + reg.intercept },
        { x: maxX, y: reg.slope * maxX + reg.intercept },
      ];
    }
    return { points: pts, regression: reg, trendLine: trend };
  }, [contexts, xKey, yKey]);

  const xLabel = getMetric(xKey).label;
  const yLabel = getMetric(yKey).label;

  if (!logs) {
    return <div className="empty-state"><h3>Loading...</h3></div>;
  }

  return (
    <div>
      <div className="page-header">
        <h1>Insights</h1>
        <p className="subtitle">Explore correlations in your sleep data</p>
      </div>

      <SubNav active="correlations" />

      <div className="card">
        <MetricSelect id="x-metric" label="X-axis" value={xKey} options={xOptions} onChange={setXKey} />
        <MetricSelect id="y-metric" label="Y-axis" value={yKey} options={yOptions} onChange={setYKey} />
      </div>

      {points.length >= 2 && (
        <div className="card">
          <div className="card-title">Correlation</div>
          <div className="flex items-center justify-between">
            <span className="text-secondary">Pearson r</span>
            <span className="fw-600 text-accent">{regression.r.toFixed(3)}</span>
          </div>
          <div className="flex items-center justify-between mt-8">
            <span className="text-secondary">Data points</span>
            <span className="fw-600">{points.length}</span>
          </div>
        </div>
      )}

      {points.length > 0 ? (
        <div className="card">
          <div className="card-title">{yLabel} vs {xLabel}</div>
          <ResponsiveContainer width="100%" height={280}>
            <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
              <CartesianGrid stroke="#333355" strokeDasharray="3 3" />
              <XAxis
                type="number"
                dataKey="x"
                name={xLabel}
                tick={{ fill: '#9999aa', fontSize: 11 }}
                axisLine={{ stroke: '#333355' }}
                tickLine={false}
                label={{ value: xLabel, position: 'bottom', fill: '#9999aa', fontSize: 11, offset: 5 }}
              />
              <YAxis
                type="number"
                dataKey="y"
                name={yLabel}
                tick={{ fill: '#9999aa', fontSize: 11 }}
                axisLine={{ stroke: '#333355' }}
                tickLine={false}
                width={40}
              />
              <Tooltip
                contentStyle={{
                  background: '#1a1a2e',
                  border: '1px solid #333355',
                  borderRadius: 8,
                  color: '#e8e8ed',
                }}
                formatter={(value: unknown, name: unknown) => [
                  Number(value).toFixed(1),
                  String(name) === 'x' ? xLabel : yLabel,
                ]}
              />
              <Scatter data={points} fill="#e2b714" />
              {trendLine.length === 2 && (
                <Scatter
                  data={trendLine}
                  fill="none"
                  line={{ stroke: '#e2b714', strokeWidth: 2, strokeDasharray: '6 3' }}
                  shape={() => <></>}
                  legendType="none"
                />
              )}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="empty-state">
          <h3>Not enough data</h3>
          <p>Need at least one night with both the selected input and output values to plot.</p>
        </div>
      )}
    </div>
  );
}
