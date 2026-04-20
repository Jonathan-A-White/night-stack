import { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { db } from '../../db';
import type { RoomReading } from '../../types';

function formatReadingTime(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  let h = d.getHours();
  const m = d.getMinutes();
  const period = h >= 12 ? 'PM' : 'AM';
  h = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h}:${m.toString().padStart(2, '0')} ${period}`;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

interface ChartPoint {
  index: number;
  label: string;
  tempF: number;
  humidity: number;
}

function buildChartData(readings: RoomReading[]): ChartPoint[] {
  return readings.map((r, i) => ({
    index: i,
    label: formatReadingTime(r.timestamp),
    tempF: Number(r.tempF.toFixed(1)),
    humidity: Number(r.humidity.toFixed(1)),
  }));
}

export function RoomConditionsDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const nightLog = useLiveQuery(
    () => (id ? db.nightLogs.get(id) : undefined),
    [id]
  );

  const readings = useMemo<RoomReading[]>(() => {
    const timeline = nightLog?.roomTimeline ?? [];
    return [...timeline].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
  }, [nightLog]);

  const chartData = useMemo(() => buildChartData(readings), [readings]);

  if (nightLog === undefined) {
    return <div className="empty-state"><h3>Loading...</h3></div>;
  }

  if (!nightLog) {
    return (
      <div className="empty-state">
        <h3>No data found</h3>
        <p>No night log for this id.</p>
        <button className="btn btn-primary mt-16" onClick={() => navigate('/morning')}>
          Go to Morning
        </button>
      </div>
    );
  }

  const backPath = `/morning/review/${nightLog.id}`;

  if (readings.length === 0) {
    return (
      <div>
        <div className="page-header">
          <button
            className="btn btn-secondary btn-sm mb-8"
            onClick={() => navigate(backPath)}
          >
            {'\u2190 Back'}
          </button>
          <h1>Room Conditions</h1>
          <p className="subtitle">{nightLog.date}</p>
        </div>
        <div className="empty-state">
          <h3>No readings</h3>
          <p>This night has no imported room data.</p>
        </div>
      </div>
    );
  }

  const temps = readings.map((r) => r.tempF);
  const hums = readings.map((r) => r.humidity);
  const tempMin = Math.min(...temps);
  const tempMax = Math.max(...temps);
  const tempAvg = avg(temps);
  const humMin = Math.min(...hums);
  const humMax = Math.max(...hums);
  const humAvg = avg(hums);

  return (
    <div>
      <div className="page-header">
        <button
          className="btn btn-secondary btn-sm mb-8"
          onClick={() => navigate(backPath)}
        >
          {'\u2190 Back'}
        </button>
        <h1>Room Conditions</h1>
        <p className="subtitle">{nightLog.date} &middot; {readings.length} readings</p>
      </div>

      <div className="card">
        <div className="card-title">Temperature</div>
        <div className="metrics-row">
          <div className="metric-card">
            <div className="metric-value">{tempMin.toFixed(1)}&deg;F</div>
            <div className="metric-label">Min</div>
          </div>
          <div className="metric-card">
            <div className="metric-value">{tempAvg.toFixed(1)}&deg;F</div>
            <div className="metric-label">Avg</div>
          </div>
          <div className="metric-card">
            <div className="metric-value">{tempMax.toFixed(1)}&deg;F</div>
            <div className="metric-label">Max</div>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="label"
              tick={{ fill: '#9999aa', fontSize: 10 }}
              axisLine={{ stroke: '#333355' }}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={40}
            />
            <YAxis
              domain={['auto', 'auto']}
              tick={{ fill: '#9999aa', fontSize: 11 }}
              axisLine={{ stroke: '#333355' }}
              tickLine={false}
              width={40}
              tickFormatter={(v) => `${v}°`}
            />
            <Tooltip
              contentStyle={{
                background: '#1a1a2e',
                border: '1px solid #333355',
                borderRadius: 8,
                color: '#e8e8ed',
              }}
              formatter={(value) => [`${Number(value).toFixed(1)}°F`, 'Temp']}
            />
            <Line
              type="monotone"
              dataKey="tempF"
              stroke="#e2b714"
              strokeWidth={2}
              dot={{ fill: '#e2b714', r: 3 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <div className="card-title">Humidity</div>
        <div className="metrics-row">
          <div className="metric-card">
            <div className="metric-value">{humMin.toFixed(0)}%</div>
            <div className="metric-label">Min</div>
          </div>
          <div className="metric-card">
            <div className="metric-value">{humAvg.toFixed(0)}%</div>
            <div className="metric-label">Avg</div>
          </div>
          <div className="metric-card">
            <div className="metric-value">{humMax.toFixed(0)}%</div>
            <div className="metric-label">Max</div>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="label"
              tick={{ fill: '#9999aa', fontSize: 10 }}
              axisLine={{ stroke: '#333355' }}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={40}
            />
            <YAxis
              domain={['auto', 'auto']}
              tick={{ fill: '#9999aa', fontSize: 11 }}
              axisLine={{ stroke: '#333355' }}
              tickLine={false}
              width={40}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              contentStyle={{
                background: '#1a1a2e',
                border: '1px solid #333355',
                borderRadius: 8,
                color: '#e8e8ed',
              }}
              formatter={(value) => [`${Number(value).toFixed(1)}%`, 'Humidity']}
            />
            <Line
              type="monotone"
              dataKey="humidity"
              stroke="#4ea3e0"
              strokeWidth={2}
              dot={{ fill: '#4ea3e0', r: 3 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <div className="card-title">All readings ({readings.length})</div>
        {readings.map((r, i) => (
          <div key={`${r.timestamp}-${i}`} className="summary-row">
            <span className="summary-label">{formatReadingTime(r.timestamp)}</span>
            <span className="summary-value">
              {r.tempF.toFixed(1)}&deg;F &middot; {r.humidity.toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
