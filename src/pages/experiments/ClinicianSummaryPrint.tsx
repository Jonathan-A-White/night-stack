import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { buildClinicianRows, defaultRange, summaryStats, type ClinicianRow, type ClinicianSummary } from '../../services/clinicianExport';
import { loadClinicianInput } from './ClinicianExportPage';
import type { SodiumLevel, SleepPosition } from '../../types';

const LEVELS: { key: SodiumLevel; label: string }[] = [
  { key: 'normal', label: 'Normal salt' },
  { key: 'more', label: 'More salt' },
  { key: 'much_more', label: 'Much more salt' },
];
const POSITIONS: { key: SleepPosition; label: string }[] = [
  { key: 'side', label: 'Side' },
  { key: 'back', label: 'Back' },
  { key: 'unknown', label: 'Unknown' },
];

/** One printable page: summary tables then a compact nights table. Always light. */
export function ClinicianSummaryPrint() {
  const [params] = useSearchParams();
  const dflt = defaultRange();
  const start = params.get('start') ?? dflt.start;
  const end = params.get('end') ?? dflt.end;
  const [rows, setRows] = useState<ClinicianRow[] | null>(null);
  const [summary, setSummary] = useState<ClinicianSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadClinicianInput(start, end).then((input) => {
      if (cancelled) return;
      const r = buildClinicianRows(input);
      setRows(r);
      setSummary(summaryStats(r));
    });
    return () => {
      cancelled = true;
    };
  }, [start, end]);

  if (!rows || !summary) return <div className="empty-state"><h3>Loading…</h3></div>;

  const cell = (v: string) => (v === '' ? '—' : v);

  return (
    <div className="print-page">
      <div className="print-toolbar no-print">
        <Link to="/experiments/export" className="btn btn-secondary">‹ Back</Link>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>

      <h1>NightStack — home measurements</h1>
      <p className="print-sub">
        Nights {start} to {end} · {summary.nights} nights · generated {new Date().toLocaleString()}
      </p>

      <div className="print-grid">
        <table className="print-table">
          <caption>Adrenergic nights (episode captured or woke wired) by salt × position to bed</caption>
          <thead>
            <tr><th></th>{POSITIONS.map((p) => <th key={p.key}>{p.label}</th>)}</tr>
          </thead>
          <tbody>
            {LEVELS.map((l) => (
              <tr key={l.key}>
                <th>{l.label}</th>
                {POSITIONS.map((p) => {
                  const c = summary.grid[l.key][p.key];
                  return <td key={p.key}>{c.total === 0 ? '—' : `${c.adrenergic} / ${c.total}`}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>

        <table className="print-table">
          <caption>Mean overnight change by salt level (measured nights only)</caption>
          <thead>
            <tr><th></th><th>Weight (lb)</th><th>Neck (in)</th></tr>
          </thead>
          <tbody>
            {LEVELS.map((l) => (
              <tr key={l.key}>
                <th>{l.label}</th>
                <td>{summary.meanWeightDelta[l.key].mean === null ? '—' : `${summary.meanWeightDelta[l.key].mean} (n=${summary.meanWeightDelta[l.key].n})`}</td>
                <td>{summary.meanNeckDelta[l.key].mean === null ? '—' : `${summary.meanNeckDelta[l.key].mean} (n=${summary.meanNeckDelta[l.key].n})`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="print-sub">
        Episodes: {summary.episodes} · Adrenergic nights: {summary.adrenergicNights} · Orthostatic readings with a flag: {summary.flaggedReadings}
        {summary.recalibrationWarnings > 0 && ` · Watch readings needing recalibration: ${summary.recalibrationWarnings}`}
      </p>

      <table className="print-table print-nights">
        <caption>Nights</caption>
        <thead>
          <tr>
            <th>Night</th><th>Salt</th><th>Pos</th><th>Wired</th><th>Ep.</th><th>Δ wt</th><th>Δ neck</th>
            <th>PM 3 min</th><th>PM flags</th><th>AM 3 min</th><th>AM flags</th><th>Score</th><th>Min HR</th><th>SpO2 nadir</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.night_date}>
              <td>{r.night_date.slice(5)}</td>
              <td>{r.sodium_level.replace('_', ' ')}</td>
              <td>{r.position_started[0]}→{r.position_at_wake[0]}</td>
              <td>{r.wired_wake === 'yes' ? '✓' : ''}</td>
              <td>{r.episode_count === '0' ? '' : r.episode_count}</td>
              <td>{cell(r.weight_delta_lb)}</td>
              <td>{cell(r.neck_delta_in)}</td>
              <td>{cell(r.pm_stand3)}</td>
              <td>{cell(r.pm_flags)}</td>
              <td>{cell(r.am_stand3)}</td>
              <td>{cell(r.am_flags)}</td>
              <td>{cell(r.sleep_score)}</td>
              <td>{cell(r.min_hr)}</td>
              <td>{cell(r.spo2_nadir_pre_episode)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="print-footer">
        Generated by NightStack from self-recorded data. Orthostatic flags: systolic drop ≥ 20, diastolic drop ≥ 10, pulse rise ≥ 30
        without a drop (supine vs standing at 3 min). Flags follow common thresholds and are not a diagnosis.
      </p>
    </div>
  );
}

export default ClinicianSummaryPrint;
