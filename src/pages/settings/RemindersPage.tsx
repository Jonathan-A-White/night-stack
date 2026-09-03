import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import type { AppSettings } from '../../types';
import { requestNotificationPermission } from '../../services/notifications';

type PrefKey = keyof AppSettings['notificationPreferences'];

const ROWS: { key: PrefKey; label: string; when: string }[] = [
  { key: 'eatingCutoff', label: 'Eating cutoff', when: '2.5 h before target bedtime' },
  { key: 'supplementReminder', label: 'Bedtime stack', when: '45 min before target bedtime' },
  { key: 'bedtimeWarning', label: 'Wind down', when: '15 min before target bedtime' },
  { key: 'bedtime', label: 'Bedtime', when: 'Target bedtime' },
  { key: 'morningLog', label: 'Morning log', when: '2 h after the alarm' },
  { key: 'amVitals', label: 'AM orthostatic reading', when: '15 min after the alarm' },
  { key: 'pmVitals', label: 'PM orthostatic reading', when: '60 min before target bedtime' },
  { key: 'bedtimeWeighIn', label: 'Bedtime weigh-in + neck', when: '10 min before target bedtime' },
];

/** Settings › Reminders: every notification preference in one place. */
export default function RemindersPage() {
  const settings = useLiveQuery(() => db.appSettings.get('default'));
  const [permission, setPermission] = useState<string>(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
  );

  async function toggle(key: PrefKey, value: boolean) {
    if (!settings) return;
    await db.appSettings.update('default', {
      notificationPreferences: { ...settings.notificationPreferences, [key]: value },
    });
  }

  return (
    <div>
      <div className="page-header">
        <Link to="/settings" className="text-accent" style={{ textDecoration: 'none', fontSize: 14 }}>
          ‹ Settings
        </Link>
        <h1>Reminders</h1>
      </div>

      {permission !== 'granted' && (
        <div className="card">
          <p className="text-secondary text-sm mb-8">
            Notifications are {permission === 'unsupported' ? 'not supported here' : `"${permission}"`}.
          </p>
          {permission !== 'unsupported' && (
            <button
              type="button"
              className="btn btn-primary btn-full"
              onClick={async () => {
                const ok = await requestNotificationPermission();
                setPermission(ok ? 'granted' : Notification.permission);
              }}
            >
              Allow notifications
            </button>
          )}
        </div>
      )}

      <div className="card">
        {ROWS.map((row) => (
          <div key={row.key} className="switch-row">
            <div>
              <div>{row.label}</div>
              <div className="text-secondary text-sm">{row.when}</div>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={settings?.notificationPreferences[row.key] ?? false}
                onChange={(e) => toggle(row.key, e.target.checked)}
              />
              <span className="switch-slider" />
            </label>
          </div>
        ))}
      </div>

      <p className="text-secondary text-sm">
        Reminders are scheduled when the evening log is saved and fire only while NightStack is open.
      </p>
    </div>
  );
}

export { RemindersPage };
