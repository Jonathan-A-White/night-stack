import { useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../../db';
import { addDaysToDate } from '../../utils';
import { buildClinicianRows, defaultRange, toCsv } from '../../services/clinicianExport';

function triggerDownload(text: string, filename: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Load everything the export needs for [start, end] nights (AM rows spill one day past `end`). */
export async function loadClinicianInput(start: string, end: string) {
  const [logs, bodyRows, readings, settings] = await Promise.all([
    db.nightLogs.where('date').between(start, end, true, true).toArray(),
    db.bodyMeasurements.where('date').between(start, addDaysToDate(end, 1), true, true).toArray(),
    db.orthostaticReadings.where('date').between(start, addDaysToDate(end, 1), true, true).toArray(),
    db.appSettings.get('default'),
  ]);
  const logIds = logs.map((l) => l.id);
  const samples = logIds.length ? await db.vitalSamples.where('nightLogId').anyOf(logIds).toArray() : [];
  return { logs, bodyRows, readings, samples, watchBpCalibratedAt: settings?.watchBpCalibratedAt ?? null };
}

/** Experiments › Export for doctor (clinician-export.md). */
export function ClinicianExportPage() {
  const [range, setRange] = useState(() => defaultRange());
  const [status, setStatus] = useState('');

  async function downloadCsv() {
    try {
      const input = await loadClinicianInput(range.start, range.end);
      const rows = buildClinicianRows(input);
      triggerDownload(toCsv(rows), `nightstack-clinician-${range.start}_to_${range.end}.csv`, 'text/csv;charset=utf-8');
      setStatus(`CSV with ${rows.length} night${rows.length === 1 ? '' : 's'} downloaded.`);
    } catch {
      setStatus('Export failed.');
    }
  }

  const quick = (nights: number) => {
    const end = defaultRange().end;
    setRange({ start: addDaysToDate(end, -(nights - 1)), end });
  };

  return (
    <div>
      <div className="page-header">
        <h1>Export for doctor</h1>
        <p className="subtitle">One row per night: tags, deltas, vitals, episodes</p>
      </div>

      <div className="card">
        <div className="form-group">
          <label className="form-label" htmlFor="cl-start">From (evening date)</label>
          <input id="cl-start" className="form-input" type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="cl-end">To (evening date)</label>
          <input id="cl-end" className="form-input" type="date" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} />
        </div>
        <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary text-sm" onClick={() => quick(14)}>Last 14 nights</button>
          <button type="button" className="btn btn-secondary text-sm" onClick={() => quick(30)}>Last 30 nights</button>
        </div>
      </div>

      <button type="button" className="btn btn-primary btn-full mb-8" style={{ minHeight: 56 }} onClick={downloadCsv}>
        Download CSV
      </button>
      <Link to={`/experiments/export/print?start=${range.start}&end=${range.end}`} className="btn btn-secondary btn-full" style={{ minHeight: 56 }}>
        Open printable summary
      </Link>

      {status && <div className={`banner ${status.includes('failed') ? 'banner-danger' : 'banner-success'} mt-16`}>{status}</div>}

      <p className="text-secondary text-sm mt-16">
        Flags follow common thresholds (systolic drop ≥ 20, diastolic drop ≥ 10, pulse rise ≥ 30 without a drop) and are not a
        diagnosis. Per-minute watch data is summarised as the SpO2 nadir and HR peak around each episode when it has been imported.
      </p>
    </div>
  );
}

export default ClinicianExportPage;
