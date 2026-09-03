import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import { buildFullExport, importBackup } from '../../services/backup';

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysISO(baseISO: string, days: number): string {
  const [y, m, d] = baseISO.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function firstOfMonthISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

function triggerJsonDownload(payload: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function DataManagementPage() {
  const nightLogCount = useLiveQuery(() => db.nightLogs.count());
  const supplementCount = useLiveQuery(() => db.supplementDefs.count());
  const clothingCount = useLiveQuery(() => db.clothingItems.count());
  const beddingCount = useLiveQuery(() => db.beddingItems.count());
  const wakeUpCauseCount = useLiveQuery(() => db.wakeUpCauses.count());
  const bedtimeReasonCount = useLiveQuery(() => db.bedtimeReasons.count());
  const sleepRuleCount = useLiveQuery(() => db.sleepRules.count());
  const alarmScheduleCount = useLiveQuery(() => db.alarmSchedules.count());
  const routineStepCount = useLiveQuery(() => db.routineSteps.count());
  const routineVariantCount = useLiveQuery(() => db.routineVariants.count());
  const routineSessionCount = useLiveQuery(() => db.routineSessions.count());
  const bodyMeasurementCount = useLiveQuery(() => db.bodyMeasurements.count());
  const orthostaticCount = useLiveQuery(() => db.orthostaticReadings.count());

  const [status, setStatus] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const routineFileInputRef = useRef<HTMLInputElement>(null);

  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [rangeError, setRangeError] = useState('');

  // Export/import live in services/backup.ts so the round trip is tested
  // (body-measurements.md). "Export All Data" and "Full export" now
  // produce the same payload, which includes bodyMeasurements and
  // orthostatic readings.
  const handleExport = async () => {
    try {
      triggerJsonDownload(await buildFullExport(), `nightstack-export-${todayISO()}.json`);
      setStatus('Export complete.');
      setTimeout(() => setStatus(''), 3000);
    } catch {
      setStatus('Export failed.');
    }
  };

  const handleFullExport = async () => {
    try {
      const payload = await buildFullExport();
      triggerJsonDownload(payload, `nightstack-export-full-${todayISO()}.json`);
      setStatus('Full export complete.');
      setTimeout(() => setStatus(''), 3000);
    } catch {
      setStatus('Full export failed.');
    }
  };

  const handleRangeExport = async () => {
    if (!rangeStart || !rangeEnd) {
      setRangeError('Please select both a start and end date.');
      return;
    }
    if (rangeStart > rangeEnd) {
      setRangeError('Start date must be on or before end date.');
      return;
    }
    setRangeError('');
    try {
      const payload = await buildFullExport({ start: rangeStart, end: rangeEnd });
      triggerJsonDownload(
        payload,
        `nightstack-export-${rangeStart}_to_${rangeEnd}.json`,
      );
      setStatus('Date-range export complete.');
      setTimeout(() => setStatus(''), 3000);
    } catch {
      setStatus('Date-range export failed.');
    }
  };

  const setQuickRange = (start: string, end: string) => {
    setRangeStart(start);
    setRangeEnd(end);
    setRangeError('');
  };

  const quickLast7 = () => {
    const end = todayISO();
    setQuickRange(addDaysISO(end, -6), end);
  };
  const quickLast30 = () => {
    const end = todayISO();
    setQuickRange(addDaysISO(end, -29), end);
  };
  const quickThisMonth = () => {
    setQuickRange(firstOfMonthISO(), todayISO());
  };
  const quickAllTime = () => {
    setQuickRange('1970-01-01', todayISO());
  };

  const onRangeStartChange = (v: string) => {
    setRangeStart(v);
    if (rangeError) setRangeError('');
  };
  const onRangeEndChange = (v: string) => {
    setRangeEnd(v);
    if (rangeError) setRangeError('');
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!window.confirm('This will replace all existing data. Are you sure?')) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      // Pre-v12 backups (weightEntries, high_salt flags) are translated.
      await importBackup(data);

      setStatus('Import complete. Data has been replaced.');
      setTimeout(() => setStatus(''), 3000);
    } catch {
      setStatus('Import failed. Please check the file format.');
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleExportRoutines = async () => {
    try {
      const payload = {
        exportedAt: new Date().toISOString(),
        version: 1,
        kind: 'nightstack-routines' as const,
        includesSessions: false,
        routineSteps: await db.routineSteps.toArray(),
        routineVariants: await db.routineVariants.toArray(),
      };
      triggerJsonDownload(payload, `nightstack-routines-${todayISO()}.json`);
      setStatus('Routine export complete.');
      setTimeout(() => setStatus(''), 3000);
    } catch {
      setStatus('Routine export failed.');
    }
  };

  const handleExportRoutinesWithHistory = async () => {
    try {
      const payload = {
        exportedAt: new Date().toISOString(),
        version: 1,
        kind: 'nightstack-routines' as const,
        includesSessions: true,
        routineSteps: await db.routineSteps.toArray(),
        routineVariants: await db.routineVariants.toArray(),
        routineSessions: await db.routineSessions.toArray(),
      };
      triggerJsonDownload(payload, `nightstack-routines-with-history-${todayISO()}.json`);
      setStatus('Routine export (with history) complete.');
      setTimeout(() => setStatus(''), 3000);
    } catch {
      setStatus('Routine export failed.');
    }
  };

  const handleImportRoutines = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const resetInput = () => {
      if (routineFileInputRef.current) routineFileInputRef.current.value = '';
    };

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      // Accept either a routine-only export or the routine sections of a full export.
      const steps = data.routineSteps ?? data.config?.routineSteps;
      const variants = data.routineVariants ?? data.config?.routineVariants;
      const sessions = data.routineSessions;

      if (!Array.isArray(steps) || !Array.isArray(variants)) {
        setStatus('Import failed: file is missing routineSteps or routineVariants.');
        resetInput();
        return;
      }

      const hasSessions = Array.isArray(sessions) && sessions.length > 0;
      const confirmMsg = hasSessions
        ? `This will replace your routine steps, variants, and ${sessions.length} session(s). Other data (night logs, weights, etc.) will not be touched. Continue?`
        : 'This will replace your routine steps and variants. Existing routine session history will be cleared. Other data (night logs, weights, etc.) will not be touched. Continue?';

      if (!window.confirm(confirmMsg)) {
        resetInput();
        return;
      }

      await db.transaction(
        'rw',
        [db.routineSteps, db.routineVariants, db.routineSessions],
        async () => {
          await db.routineSteps.clear();
          await db.routineVariants.clear();
          await db.routineSessions.clear();

          if (steps.length) await db.routineSteps.bulkAdd(steps);
          if (variants.length) await db.routineVariants.bulkAdd(variants);
          if (hasSessions) await db.routineSessions.bulkAdd(sessions);

          // Keep the app in a valid state: there must always be at least one variant,
          // and exactly one default.
          if (!variants.length) {
            await db.routineVariants.add({
              id: crypto.randomUUID(),
              name: 'Full',
              description: '',
              stepIds: [],
              isDefault: true,
              sortOrder: 1,
              createdAt: Date.now(),
            });
          }
        },
      );

      setStatus('Routine import complete.');
      setTimeout(() => setStatus(''), 3000);
    } catch {
      setStatus('Routine import failed. Please check the file format.');
    }

    resetInput();
  };

  return (
    <div>
      <div className="page-header">
        <Link to="/settings" className="text-accent" style={{ textDecoration: 'none', fontSize: 14 }}>
          &lsaquo; Settings
        </Link>
        <h1>Data Management</h1>
      </div>

      {/* Data stats */}
      <div className="card">
        <div className="card-title">Data Summary</div>
        <div className="summary-row">
          <span className="summary-label">Night Logs</span>
          <span className="summary-value">{nightLogCount ?? 0}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Supplements</span>
          <span className="summary-value">{supplementCount ?? 0}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Clothing Items</span>
          <span className="summary-value">{clothingCount ?? 0}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Bedding Items</span>
          <span className="summary-value">{beddingCount ?? 0}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Wake-Up Causes</span>
          <span className="summary-value">{wakeUpCauseCount ?? 0}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Bedtime Reasons</span>
          <span className="summary-value">{bedtimeReasonCount ?? 0}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Sleep Rules</span>
          <span className="summary-value">{sleepRuleCount ?? 0}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Alarm Schedules</span>
          <span className="summary-value">{alarmScheduleCount ?? 0}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Routine Steps</span>
          <span className="summary-value">{routineStepCount ?? 0}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Routine Variants</span>
          <span className="summary-value">{routineVariantCount ?? 0}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Routine Sessions</span>
          <span className="summary-value">{routineSessionCount ?? 0}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Body Measurements</span>
          <span className="summary-value">{bodyMeasurementCount ?? 0}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Orthostatic Readings</span>
          <span className="summary-value">{orthostaticCount ?? 0}</span>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Export for doctor</div>
        <Link to="/experiments/export" className="btn btn-secondary btn-full">
          Clinician CSV and printable summary
        </Link>
      </div>

      {/* Export / Import */}
      <div className="card">
        <div className="card-title">Export / Import</div>

        <button
          className="btn btn-primary btn-full mb-8"
          onClick={handleExport}
        >
          Export All Data
        </button>

        <label className="btn btn-secondary btn-full" style={{ cursor: 'pointer' }}>
          Import Data
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImport}
            style={{ display: 'none' }}
          />
        </label>

        <p className="text-secondary text-sm mt-16">
          Export saves all data as a JSON file. Import replaces all current data with the contents of a previously exported file.
        </p>
      </div>

      {/* Routines Only */}
      <div className="card">
        <div className="card-title">Routines Only</div>

        <button
          className="btn btn-primary btn-full mb-8"
          onClick={handleExportRoutines}
        >
          Export Routines
        </button>

        <button
          className="btn btn-primary btn-full mb-8"
          onClick={handleExportRoutinesWithHistory}
        >
          Export Routines + History
        </button>

        <label className="btn btn-secondary btn-full" style={{ cursor: 'pointer' }}>
          Import Routines
          <input
            ref={routineFileInputRef}
            type="file"
            accept=".json"
            onChange={handleImportRoutines}
            style={{ display: 'none' }}
          />
        </label>

        <p className="text-secondary text-sm mt-16">
          Import/export just your evening routine — steps and variants, optionally with session history.
          Importing replaces only routine tables; night logs, weights, and other settings are untouched.
        </p>
      </div>

      {/* Date Range Export */}
      <div className="card">
        <div className="card-title">Date Range Export</div>

        <div className="form-group">
          <label className="form-label" htmlFor="range-start">Start date</label>
          <input
            id="range-start"
            className="form-input"
            type="date"
            value={rangeStart}
            onChange={(e) => onRangeStartChange(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="range-end">End date</label>
          <input
            id="range-end"
            className="form-input"
            type="date"
            value={rangeEnd}
            onChange={(e) => onRangeEndChange(e.target.value)}
          />
        </div>

        <div className="flex gap-8 mt-8" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary text-sm" onClick={quickLast7}>
            Last 7 days
          </button>
          <button type="button" className="btn btn-secondary text-sm" onClick={quickLast30}>
            Last 30 days
          </button>
          <button type="button" className="btn btn-secondary text-sm" onClick={quickThisMonth}>
            This month
          </button>
          <button type="button" className="btn btn-secondary text-sm" onClick={quickAllTime}>
            All time
          </button>
        </div>

        <button
          className="btn btn-primary btn-full mt-16"
          onClick={handleRangeExport}
        >
          Download range (JSON)
        </button>

        {rangeError && (
          <div className="banner banner-danger mt-8">
            {rangeError}
          </div>
        )}

        <p className="text-secondary text-sm mt-16">
          These JSON files can be shared directly with an AI for sleep-pattern analysis.
        </p>
      </div>

      {/* Data Cleanup (bugfixes T4) */}
      <div className="card">
        <div className="card-title">Data Cleanup</div>
        <p className="text-secondary text-sm mb-8">
          Scan your night logs for duplicate sleepData and stale
          roomTimeline rows (the two defects the 2026-04-17 export
          surfaced). You review each match before anything is cleared.
        </p>
        <Link to="/settings/data/cleanup" className="btn btn-secondary btn-full">
          Open Data Cleanup
        </Link>
      </div>

      {/* Full Export (AI-ready) */}
      <div className="card">
        <div className="card-title">Full Export (AI-ready)</div>

        <button
          className="btn btn-primary btn-full"
          onClick={handleFullExport}
        >
          Download full export (JSON)
        </button>

        <p className="text-secondary text-sm mt-16">
          Exports every night log, weight entry, and config table as a single JSON file suitable for AI analysis.
        </p>
      </div>

      {status && (
        <div className={`banner ${status.includes('failed') ? 'banner-danger' : 'banner-success'} mt-16`}>
          {status}
        </div>
      )}
    </div>
  );
}

export { DataManagementPage };
