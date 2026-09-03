import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import { planImport, runImport, type ImportFile, type ImportPlan } from '../../services/samsungExport';

/**
 * Experiments › Import (samsung-bulk-import.md). Pick the whole export
 * folder; see a per-file recognized/skipped report and the nights that
 * would be filled; tick or untick nights; import. Nothing is written
 * before "Import" is tapped.
 *
 * A real export is ~10k files and Samsung can only export the full
 * history, so files are handed to `planImport` as lazy loaders with a
 * range: only the few CSVs plus the binning files referenced by rows
 * in range are read. The range defaults to the last night and can be
 * widened without picking the folder again.
 */

const RANGES: { label: string; days: number | null }[] = [
  { label: 'Last night', days: 1 },
  { label: '7 nights', days: 7 },
  { label: '30 nights', days: 30 },
  { label: 'All history', days: null },
];

function sinceForDays(days: number | null, now = Date.now()): number | null {
  return days === null ? null : now - days * 86_400_000;
}

export function SamsungImportPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<ImportFile[]>([]);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [status, setStatus] = useState('');
  const [rangeDays, setRangeDays] = useState<number | null>(1);
  const [hasFiles, setHasFiles] = useState(false);
  const lastBatch = useLiveQuery(() => db.importBatches.orderBy('importedAt').reverse().first(), []);

  async function buildPlan(files: ImportFile[], days: number | null) {
    setBusy(true);
    setStatus('');
    setPlan(null);
    setProgress(null);
    try {
      const existing = await db.nightLogs.toArray();
      setPlan(await planImport(files, existing, { sinceMs: sinceForDays(days), onProgress: (done, total) => setProgress({ done, total }) }));
    } catch (err) {
      setStatus(`Could not read the folder: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    const files: ImportFile[] = [];
    for (const f of Array.from(list)) {
      const name = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      if (!/\.(csv|json)$/i.test(name)) continue;
      files.push({ name, text: () => f.text() });
    }
    filesRef.current = files;
    setHasFiles(files.length > 0);
    if (inputRef.current) inputRef.current.value = '';
    await buildPlan(files, rangeDays);
  }

  async function changeRange(days: number | null) {
    setRangeDays(days);
    if (filesRef.current.length > 0 && !busy) await buildPlan(filesRef.current, days);
  }

  function toggleNight(nightDate: string) {
    if (!plan) return;
    setPlan({ ...plan, nights: plan.nights.map((n) => (n.nightDate === nightDate ? { ...n, selected: !n.selected } : n)) });
  }

  async function doImport() {
    if (!plan) return;
    setBusy(true);
    try {
      const batch = await runImport(plan);
      const filled = plan.nights.filter((n) => n.selected).length;
      setStatus(`Imported ${filled} night${filled === 1 ? '' : 's'} and ${plan.samples.length} per-minute samples (batch ${batch.id.slice(0, 8)}).`);
      setPlan(null);
      filesRef.current = [];
      setHasFiles(false);
    } catch (err) {
      setStatus(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  const recognized = plan?.report.filter((r) => r.recognized) ?? [];
  const skipped = plan?.report.filter((r) => !r.recognized) ?? [];
  const readingLabel = progress && progress.total > 0 ? `Reading ${progress.done} / ${progress.total} files…` : 'Reading…';

  return (
    <div>
      <div className="page-header">
        <h1>Samsung import</h1>
        <p className="subtitle">Bulk-load sleep sessions and per-minute HR / SpO2</p>
      </div>

      <div className="banner banner-warning mb-16">
        The export format is only documented by example. Check the per-file report before importing; files the app does not
        recognise are listed as skipped, never silently ignored.
      </div>

      <div className="card">
        <div className="card-title">Range</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} role="group" aria-label="Import range">
          {RANGES.map((r) => (
            <button
              key={r.label}
              type="button"
              className={`btn btn-sm ${rangeDays === r.days ? 'btn-primary' : 'btn-secondary'}`}
              aria-pressed={rangeDays === r.days}
              onClick={() => changeRange(r.days)}
              disabled={busy}
            >
              {r.label}
            </button>
          ))}
        </div>
        <p className="text-secondary text-sm mt-8">
          Samsung exports the whole history; only nights in this range are read and planned. Widen it any time without picking the folder again.
        </p>
      </div>

      <div className="card">
        <label className="btn btn-primary btn-full" style={{ cursor: 'pointer', minHeight: 56 }}>
          {busy && !plan ? readingLabel : hasFiles ? 'Choose a different folder' : 'Choose export folder'}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".csv,.json"
            // @ts-expect-error non-standard attribute for folder selection on Chromium/Android
            webkitdirectory=""
            onChange={handleFiles}
            style={{ display: 'none' }}
            disabled={busy}
          />
        </label>
        <p className="text-secondary text-sm mt-8">
          Samsung Health › Settings › Download personal data. Unzip, then pick the folder (or select all its CSV and JSON files).
        </p>
        {lastBatch && (
          <p className="text-secondary text-sm">Last import: {new Date(lastBatch.importedAt).toLocaleString()} ({lastBatch.files.length} files)</p>
        )}
      </div>

      {plan && (
        <>
          <div className="card">
            <div className="card-title">Files</div>
            {recognized.map((r) => (
              <div key={r.name} className="summary-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                <span className="fw-600 text-sm">✓ {r.name.split('/').pop()}</span>
                <span className="text-secondary text-sm">{r.rows ? `${r.rows} rows` : ''}{r.rows && r.note ? ' · ' : ''}{r.note}</span>
              </div>
            ))}
            {skipped.map((r) => (
              <div key={r.name} className="summary-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                <span className="text-secondary text-sm">– {r.name.split('/').pop()}</span>
                <span className="text-secondary text-sm">skipped · {r.note}</span>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-title">Nights ({plan.nights.length}) · samples ({plan.samples.length})</div>
            {plan.nights.length === 0 && <p className="text-secondary text-sm">No sleep sessions in this range. Widen the range above.</p>}
            {plan.nights.map((n) => (
              <div key={n.nightDate} className="switch-row">
                <div>
                  <div className="fw-600">{n.nightDate}</div>
                  <div className="text-secondary text-sm">
                    {n.sleepData.sleepTime}–{n.sleepData.wakeTime} · score {n.sleepData.sleepScore || '—'}
                    {n.sleepData.avgHeartRate ? ` · HR ${n.sleepData.avgHeartRate}` : ''}
                    {n.sleepData.bloodOxygenAvg ? ` · SpO2 ${n.sleepData.bloodOxygenAvg}%` : ''}
                    {n.status === 'has_data' && ' · already has data'}
                    {n.duplicateOf && ` · duplicate of ${n.duplicateOf}`}
                  </div>
                </div>
                <label className="switch">
                  <input type="checkbox" checked={n.selected} onChange={() => toggleNight(n.nightDate)} />
                  <span className="switch-slider" />
                </label>
              </div>
            ))}
            <p className="text-secondary text-sm mt-8">
              Unticked nights keep their current sleep data; per-minute samples are always stored and re-imports are idempotent.
            </p>
          </div>

          <button type="button" className="btn btn-primary btn-full" style={{ minHeight: 56 }} onClick={doImport} disabled={busy}>
            {busy ? 'Importing…' : 'Import'}
          </button>
        </>
      )}

      {status && <div className={`banner ${status.includes('failed') || status.includes('Could not') ? 'banner-danger' : 'banner-success'} mt-16`}>{status}</div>}
    </div>
  );
}

export default SamsungImportPage;
