import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Line, CartesianGrid,
} from 'recharts';
import { db } from '../../db';
import { recalculateAllCalculatedWeights } from '../../weightUtils';
import { SubNav } from './Dashboard';
import type { NightLog, SleepRating, WeightEntry } from '../../types';

type XVar =
  | 'roomTemp'
  | 'externalLow'
  | 'roomHumidity'
  | 'lastMealMins'
  | 'beddingLayers'
  | 'clothingLayers'
  | 'alcohol'
  | 'anyFlag'
  | 'weight'
  | 'overate';

type YVar =
  | 'sleepScore'
  | 'deepSleep'
  | 'remSleep'
  | 'awakeMins'
  | 'avgHR'
  | 'minHR'
  | 'wakeUpCount'
  | 'restfulness';

const X_OPTIONS: { value: XVar; label: string }[] = [
  { value: 'roomTemp', label: 'Room temp (\u00b0F)' },
  { value: 'externalLow', label: 'External overnight low (\u00b0F)' },
  { value: 'roomHumidity', label: 'Room humidity (%)' },
  { value: 'lastMealMins', label: 'Last meal (mins before bed)' },
  { value: 'beddingLayers', label: 'Number bedding layers' },
  { value: 'clothingLayers', label: 'Number clothing layers' },
  { value: 'alcohol', label: 'Alcohol (1/0)' },
  { value: 'anyFlag', label: 'Any flag active (1/0)' },
  { value: 'weight', label: 'Weight (lb)' },
  { value: 'overate', label: 'Overate flag (1/0)' },
];

const Y_OPTIONS: { value: YVar; label: string }[] = [
  { value: 'sleepScore', label: 'Sleep score' },
  { value: 'deepSleep', label: 'Deep sleep (min)' },
  { value: 'remSleep', label: 'REM sleep (min)' },
  { value: 'awakeMins', label: 'Awake (min)' },
  { value: 'avgHR', label: 'Avg heart rate (bpm)' },
  { value: 'minHR', label: "Night's low HR (bpm)" },
  { value: 'wakeUpCount', label: 'Wake-up events' },
  { value: 'restfulness', label: 'Restfulness rating' },
];

function ratingToNum(r: SleepRating): number {
  switch (r) {
    case 'Excellent': return 4;
    case 'Good': return 3;
    case 'Fair': return 2;
    case 'Attention': return 1;
  }
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function getExternalLow(log: NightLog): number | null {
  const temps = log.environment.externalWeather?.overnightTemps;
  if (!temps || temps.length === 0) return null;
  return Math.min(...temps.map((t) => t.value));
}

function getXValue(
  log: NightLog,
  v: XVar,
  weightByLogId: Map<string, number>,
): number | null {
  switch (v) {
    case 'roomTemp':
      return log.environment.roomTempF;
    case 'externalLow':
      return getExternalLow(log);
    case 'roomHumidity':
      return log.environment.roomHumidity;
    case 'lastMealMins': {
      if (!log.eveningIntake.lastMealTime || !log.sleepData?.sleepTime) return null;
      const mealMins = timeToMinutes(log.eveningIntake.lastMealTime);
      let bedMins = timeToMinutes(log.sleepData.sleepTime);
      // Handle crossing midnight: if bedtime < meal time, add 24h to bedtime
      if (bedMins < mealMins) bedMins += 24 * 60;
      return bedMins - mealMins;
    }
    case 'beddingLayers':
      return log.bedding.length;
    case 'clothingLayers':
      return log.clothing.length;
    case 'alcohol':
      return log.eveningIntake.alcohol ? 1 : 0;
    case 'anyFlag':
      return log.eveningIntake.flags.some((f) => f.active) ? 1 : 0;
    case 'weight': {
      const w = weightByLogId.get(log.id);
      return w ?? null;
    }
    case 'overate':
      return log.eveningIntake.flags.some(
        (f) => f.type === 'overate' && f.active,
      )
        ? 1
        : 0;
  }
}

function getYValue(log: NightLog, v: YVar): number | null {
  if (!log.sleepData) return null;
  switch (v) {
    case 'sleepScore': return log.sleepData.sleepScore;
    case 'deepSleep': return log.sleepData.deepSleep;
    case 'remSleep': return log.sleepData.remSleep;
    case 'awakeMins': return log.sleepData.awakeDuration;
    case 'avgHR': return log.sleepData.avgHeartRate;
    case 'minHR': return log.sleepData.minHeartRate;
    case 'wakeUpCount': return log.wakeUpEvents.length;
    case 'restfulness': return ratingToNum(log.sleepData.restfulnessRating);
  }
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
  const [xVar, setXVar] = useState<XVar>('roomTemp');
  const [yVar, setYVar] = useState<YVar>('sleepScore');

  const cutoffDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return d.toISOString().split('T')[0];
  }, []);

  const logs = useLiveQuery(
    () => db.nightLogs.where('date').above(cutoffDate).toArray(),
    [cutoffDate]
  );
  const weights = useLiveQuery(
    () => db.weightEntries.toArray(),
    []
  );

  // Build a nightLogId → weight (lbs) map.
  //
  // Interpolation policy: calculated entries use their latest interpolation
  // between surrounding measurements so the scatter plot always reflects the
  // current state. We do NOT fabricate weights for night logs that have no
  // WeightEntry at all — only entries that actually exist are plotted.
  const weightByLogId = useMemo(() => {
    const map = new Map<string, number>();
    if (!weights) return map;

    // Recompute interpolation on the fly. This is defensive: the save-time
    // recalc in the log pages should already keep stored values current, but
    // running it here ensures Correlations never shows stale interpolations.
    const resolved = recalculateAllCalculatedWeights(weights);

    // Later entries overwrite earlier ones when two weights are linked to the
    // same night log (shouldn't happen in practice, but be safe).
    const sorted = [...resolved].sort((a: WeightEntry, b: WeightEntry) => a.timestamp - b.timestamp);
    for (const w of sorted) {
      if (w.nightLogId) map.set(w.nightLogId, w.weightLbs);
    }
    return map;
  }, [weights]);

  const { points, regression, trendLine } = useMemo(() => {
    if (!logs) return { points: [], regression: { slope: 0, intercept: 0, r: 0 }, trendLine: [] };

    const pts: { x: number; y: number }[] = [];
    for (const log of logs) {
      const x = getXValue(log, xVar, weightByLogId);
      const y = getYValue(log, yVar);
      if (x !== null && y !== null) {
        pts.push({ x, y });
      }
    }

    const reg = linearRegression(pts);

    // Build trend line from min to max x
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
  }, [logs, xVar, yVar, weightByLogId]);

  const xLabel = X_OPTIONS.find((o) => o.value === xVar)?.label ?? '';
  const yLabel = Y_OPTIONS.find((o) => o.value === yVar)?.label ?? '';

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

      {/* Pickers */}
      <div className="card">
        <div className="form-group">
          <label className="form-label">X-axis (input variable)</label>
          <select
            className="form-input"
            value={xVar}
            onChange={(e) => setXVar(e.target.value as XVar)}
          >
            {X_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Y-axis (output variable)</label>
          <select
            className="form-input"
            value={yVar}
            onChange={(e) => setYVar(e.target.value as YVar)}
          >
            {Y_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Correlation info */}
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

      {/* Scatter plot */}
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
