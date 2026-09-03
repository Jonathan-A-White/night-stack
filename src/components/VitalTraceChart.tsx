import { useLiveQuery } from 'dexie-react-hooks';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { db } from '../db';
import { timestampToHHMM } from '../utils';

interface Props {
  /** Epoch ms the trace is centred on (an episode's capturedAt). */
  capturedAt: number;
  beforeMin?: number;
  afterMin?: number;
}

/**
 * Per-minute HR and SpO2 around an episode, from the Samsung bulk import
 * (samsung-bulk-import.md). Renders nothing when no samples exist.
 */
export function VitalTraceChart({ capturedAt, beforeMin = 60, afterMin = 30 }: Props) {
  const lo = capturedAt - beforeMin * 60_000;
  const hi = capturedAt + afterMin * 60_000;
  const samples = useLiveQuery(
    () => db.vitalSamples.where('timestamp').between(lo, hi, true, true).toArray(),
    [lo, hi],
  );
  if (!samples || samples.length === 0) return null;

  const byMinute = new Map<number, { t: number; hr?: number; spo2?: number }>();
  for (const s of samples) {
    const cur = byMinute.get(s.timestamp) ?? { t: s.timestamp };
    if (s.kind === 'hr') cur.hr = s.value;
    else cur.spo2 = s.value;
    byMinute.set(s.timestamp, cur);
  }
  const data = [...byMinute.values()].sort((a, b) => a.t - b.t).map((d) => ({ ...d, label: timestampToHHMM(d.t) }));
  const spo2s = data.map((d) => d.spo2).filter((v): v is number => v !== undefined);
  const hrs = data.map((d) => d.hr).filter((v): v is number => v !== undefined);

  return (
    <div className="card">
      <div className="card-title">Watch trace around the episode</div>
      <div className="text-secondary text-sm mb-8">
        {beforeMin} min before → {afterMin} min after {timestampToHHMM(capturedAt)}
        {spo2s.length > 0 && ` · SpO2 nadir ${Math.min(...spo2s)}%`}
        {hrs.length > 0 && ` · HR peak ${Math.max(...hrs)} bpm`}
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data}>
          <XAxis dataKey="label" tick={{ fill: '#9999aa', fontSize: 10 }} axisLine={{ stroke: '#333355' }} tickLine={false} minTickGap={24} />
          <YAxis yAxisId="hr" domain={['auto', 'auto']} tick={{ fill: '#9999aa', fontSize: 10 }} axisLine={{ stroke: '#333355' }} tickLine={false} width={30} />
          <YAxis yAxisId="spo2" orientation="right" domain={[80, 100]} tick={{ fill: '#9999aa', fontSize: 10 }} axisLine={{ stroke: '#333355' }} tickLine={false} width={30} />
          <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid #333355', borderRadius: 8, color: '#e8e8ed' }} />
          <ReferenceLine yAxisId="hr" x={timestampToHHMM(capturedAt)} stroke="#e25555" strokeDasharray="4 2" />
          <Line yAxisId="hr" type="monotone" dataKey="hr" name="HR (bpm)" stroke="#e2b714" strokeWidth={2} dot={false} connectNulls />
          <Line yAxisId="spo2" type="monotone" dataKey="spo2" name="SpO2 (%)" stroke="#4caf87" strokeWidth={2} dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
