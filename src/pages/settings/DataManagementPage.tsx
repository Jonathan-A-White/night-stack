import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';

export default function DataManagementPage() {
  const nightLogCount = useLiveQuery(() => db.nightLogs.count());
  const supplementCount = useLiveQuery(() => db.supplementDefs.count());
  const clothingCount = useLiveQuery(() => db.clothingItems.count());
  const beddingCount = useLiveQuery(() => db.beddingItems.count());
  const wakeUpCauseCount = useLiveQuery(() => db.wakeUpCauses.count());
  const bedtimeReasonCount = useLiveQuery(() => db.bedtimeReasons.count());
  const sleepRuleCount = useLiveQuery(() => db.sleepRules.count());
  const alarmScheduleCount = useLiveQuery(() => db.alarmSchedules.count());

  const [status, setStatus] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    try {
      const data = {
        nightLogs: await db.nightLogs.toArray(),
        supplementDefs: await db.supplementDefs.toArray(),
        clothingItems: await db.clothingItems.toArray(),
        beddingItems: await db.beddingItems.toArray(),
        wakeUpCauses: await db.wakeUpCauses.toArray(),
        bedtimeReasons: await db.bedtimeReasons.toArray(),
        alarmSchedules: await db.alarmSchedules.toArray(),
        sleepRules: await db.sleepRules.toArray(),
        appSettings: await db.appSettings.toArray(),
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nightstack-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setStatus('Export complete.');
      setTimeout(() => setStatus(''), 3000);
    } catch {
      setStatus('Export failed.');
    }
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

      await db.transaction('rw', [
        db.nightLogs, db.supplementDefs, db.clothingItems, db.beddingItems,
        db.wakeUpCauses, db.bedtimeReasons, db.alarmSchedules, db.sleepRules, db.appSettings,
      ], async () => {
          // Clear all tables
          await db.nightLogs.clear();
          await db.supplementDefs.clear();
          await db.clothingItems.clear();
          await db.beddingItems.clear();
          await db.wakeUpCauses.clear();
          await db.bedtimeReasons.clear();
          await db.alarmSchedules.clear();
          await db.sleepRules.clear();
          await db.appSettings.clear();

          // Load imported data
          if (data.nightLogs?.length) await db.nightLogs.bulkAdd(data.nightLogs);
          if (data.supplementDefs?.length) await db.supplementDefs.bulkAdd(data.supplementDefs);
          if (data.clothingItems?.length) await db.clothingItems.bulkAdd(data.clothingItems);
          if (data.beddingItems?.length) await db.beddingItems.bulkAdd(data.beddingItems);
          if (data.wakeUpCauses?.length) await db.wakeUpCauses.bulkAdd(data.wakeUpCauses);
          if (data.bedtimeReasons?.length) await db.bedtimeReasons.bulkAdd(data.bedtimeReasons);
          if (data.alarmSchedules?.length) await db.alarmSchedules.bulkAdd(data.alarmSchedules);
          if (data.sleepRules?.length) await db.sleepRules.bulkAdd(data.sleepRules);
          if (data.appSettings?.length) await db.appSettings.bulkAdd(data.appSettings);
        }
      );

      setStatus('Import complete. Data has been replaced.');
      setTimeout(() => setStatus(''), 3000);
    } catch {
      setStatus('Import failed. Please check the file format.');
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
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

      {status && (
        <div className={`banner ${status.includes('failed') ? 'banner-danger' : 'banner-success'} mt-16`}>
          {status}
        </div>
      )}
    </div>
  );
}

export { DataManagementPage };
