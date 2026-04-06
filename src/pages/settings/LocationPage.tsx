import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';

export default function LocationPage() {
  const settings = useLiveQuery(() => db.appSettings.get('default'));

  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings) {
      setLatitude(String(settings.latitude));
      setLongitude(String(settings.longitude));
    }
  }, [settings]);

  if (!settings) {
    return <div className="empty-state"><h3>Loading...</h3></div>;
  }

  const handleSave = async () => {
    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lon)) return;
    await db.appSettings.update('default', { latitude: lat, longitude: lon });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleResetDefault = async () => {
    setLatitude('41.37');
    setLongitude('-73.41');
    await db.appSettings.update('default', { latitude: 41.37, longitude: -73.41 });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div>
      <div className="page-header">
        <Link to="/settings" className="text-accent" style={{ textDecoration: 'none', fontSize: 14 }}>
          &lsaquo; Settings
        </Link>
        <h1>Location</h1>
        <p className="subtitle">Used for overnight weather data</p>
      </div>

      <div className="card">
        <div className="form-group">
          <label className="form-label">Latitude</label>
          <input
            type="number"
            className="form-input"
            value={latitude}
            onChange={(e) => setLatitude(e.target.value)}
            step="0.01"
            placeholder="41.37"
          />
        </div>
        <div className="form-group">
          <label className="form-label">Longitude</label>
          <input
            type="number"
            className="form-input"
            value={longitude}
            onChange={(e) => setLongitude(e.target.value)}
            step="0.01"
            placeholder="-73.41"
          />
        </div>

        <div className="flex gap-8">
          <button className="btn btn-primary btn-sm" onClick={handleSave}>
            Save
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleResetDefault}>
            Reset to Default
          </button>
        </div>

        {saved && (
          <div className="banner banner-success mt-16">
            Location saved.
          </div>
        )}

        <p className="text-secondary text-sm mt-16">
          Default: Bethel, CT (41.37, -73.41)
        </p>
      </div>
    </div>
  );
}

export { LocationPage };
