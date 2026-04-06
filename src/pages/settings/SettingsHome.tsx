import { Link } from 'react-router-dom';

const settingsItems = [
  { label: 'Alarm Schedule', path: '/settings/alarm-schedule' },
  { label: 'Supplement Stack', path: '/settings/supplements' },
  { label: 'Clothing Items', path: '/settings/clothing' },
  { label: 'Bedding Items', path: '/settings/bedding' },
  { label: 'Wake-Up Causes', path: '/settings/wake-up-causes' },
  { label: 'Bedtime Reasons', path: '/settings/bedtime-reasons' },
  { label: 'Sleep Rules', path: '/settings/sleep-rules' },
  { label: 'Location', path: '/settings/location' },
  { label: 'Data Management', path: '/settings/data' },
  { label: 'About', path: '/settings/about' },
];

export { SettingsHome };

export default function SettingsHome() {
  return (
    <div>
      <div className="page-header">
        <h1>Settings</h1>
      </div>

      {settingsItems.map((item) => (
        <Link
          key={item.path}
          to={item.path}
          className="list-item"
          style={{ textDecoration: 'none', color: 'inherit' }}
        >
          <span className="fw-600">{item.label}</span>
          <span className="text-secondary" style={{ fontSize: 20 }}>&rsaquo;</span>
        </Link>
      ))}
    </div>
  );
}
