import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import type { Sex, UnitSystem, WeighInPeriod } from '../../types';
import {
  calculateIdealWeightLbs,
  cmToInches,
  formatWeight,
  inchesToCm,
  inchesToFeetInches,
  kgToLbs,
  lbsToKg,
  parseFeetInchesToInches,
} from '../../weightUtils';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'invalid';

export default function WeightProfilePage() {
  const settings = useLiveQuery(() => db.appSettings.get('default'));

  // Unit system drives the input display. Kept in sync with the loaded settings.
  const [unitSystem, setUnitSystem] = useState<UnitSystem>('us');
  const [weighInPeriod, setWeighInPeriod] = useState<WeighInPeriod>('morning');
  const [sex, setSex] = useState<Sex | ''>('');
  const [age, setAge] = useState('');

  // Height: stored in inches canonically. Inputs differ by unit system.
  const [heightFeet, setHeightFeet] = useState('');
  const [heightInchesPart, setHeightInchesPart] = useState('');
  const [heightCm, setHeightCm] = useState('');

  // Starting weight: stored in lbs canonically. Input differs by unit system.
  const [startingWeightInput, setStartingWeightInput] = useState('');

  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  // Guard auto-save: don't write until we've loaded the existing row once.
  // Otherwise the initial default-state render would wipe the user's saved data.
  const [loaded, setLoaded] = useState(false);

  // Load settings once available.
  useEffect(() => {
    if (!settings) return;
    if (loaded) return;
    setUnitSystem(settings.unitSystem ?? 'us');
    setWeighInPeriod(settings.weighInPeriod ?? 'morning');
    setSex(settings.sex ?? '');
    setAge(settings.age != null ? String(settings.age) : '');

    if (settings.heightInches != null) {
      if ((settings.unitSystem ?? 'us') === 'metric') {
        setHeightCm(Math.round(inchesToCm(settings.heightInches)).toString());
      } else {
        const { feet, inches } = inchesToFeetInches(settings.heightInches);
        setHeightFeet(String(feet));
        setHeightInchesPart(String(inches));
      }
    }

    if (settings.startingWeightLbs != null) {
      if ((settings.unitSystem ?? 'us') === 'metric') {
        setStartingWeightInput(lbsToKg(settings.startingWeightLbs).toFixed(1));
      } else {
        setStartingWeightInput(settings.startingWeightLbs.toFixed(1));
      }
    }

    setLoaded(true);
  }, [settings, loaded]);

  // When user toggles units, reformat the height/weight inputs without data loss.
  function handleUnitChange(next: UnitSystem) {
    if (next === unitSystem) return;

    // Convert current form state to canonical, then back to new display units.
    const currentHeightInches =
      unitSystem === 'metric'
        ? heightCm.trim() !== '' && !isNaN(parseFloat(heightCm))
          ? cmToInches(parseFloat(heightCm))
          : null
        : parseFeetInchesToInches(heightFeet, heightInchesPart);

    const currentWeightLbs =
      startingWeightInput.trim() !== '' && !isNaN(parseFloat(startingWeightInput))
        ? unitSystem === 'metric'
          ? kgToLbs(parseFloat(startingWeightInput))
          : parseFloat(startingWeightInput)
        : null;

    setUnitSystem(next);

    if (currentHeightInches != null) {
      if (next === 'metric') {
        setHeightCm(Math.round(inchesToCm(currentHeightInches)).toString());
      } else {
        const { feet, inches } = inchesToFeetInches(currentHeightInches);
        setHeightFeet(String(feet));
        setHeightInchesPart(String(inches));
      }
    }

    if (currentWeightLbs != null) {
      if (next === 'metric') {
        setStartingWeightInput(lbsToKg(currentWeightLbs).toFixed(1));
      } else {
        setStartingWeightInput(currentWeightLbs.toFixed(1));
      }
    }
  }

  function canonicalHeightInches(): number | null {
    if (unitSystem === 'metric') {
      if (heightCm.trim() === '') return null;
      const cm = parseFloat(heightCm);
      if (isNaN(cm)) return null;
      return cmToInches(cm);
    }
    return parseFeetInchesToInches(heightFeet, heightInchesPart);
  }

  function canonicalStartingWeightLbs(): number | null {
    if (startingWeightInput.trim() === '') return null;
    const val = parseFloat(startingWeightInput);
    if (isNaN(val)) return null;
    return unitSystem === 'metric' ? kgToLbs(val) : val;
  }

  const computedHeightInches = canonicalHeightInches();
  const computedStartingWeightLbs = canonicalStartingWeightLbs();

  // Preview the ideal weight so the user sees what the default will be.
  const idealPreviewLbs =
    sex && computedHeightInches != null
      ? calculateIdealWeightLbs(sex, computedHeightInches)
      : null;

  // Auto-save: debounce all changes and write them to appSettings.
  // Validation errors block the write; going back into range resumes auto-save.
  const saveTimer = useRef<number | null>(null);
  const savedTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!loaded) return; // don't overwrite before we've loaded

    // Validate
    const ageNum = age.trim() === '' ? null : parseInt(age, 10);
    if (ageNum !== null && (isNaN(ageNum) || ageNum < 1 || ageNum > 120)) {
      setError('Age must be a number between 1 and 120.');
      setStatus('invalid');
      return;
    }
    if (
      computedHeightInches !== null &&
      (computedHeightInches < 24 || computedHeightInches > 96)
    ) {
      setError('Height seems out of range. Double-check your entry.');
      setStatus('invalid');
      return;
    }
    if (
      computedStartingWeightLbs !== null &&
      (computedStartingWeightLbs < 40 || computedStartingWeightLbs > 800)
    ) {
      setError('Starting weight seems out of range. Double-check your entry.');
      setStatus('invalid');
      return;
    }

    // Valid — clear any stale error and debounce the write.
    setError(null);
    setStatus('saving');

    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
    }
    saveTimer.current = window.setTimeout(async () => {
      await db.appSettings.update('default', {
        unitSystem,
        weighInPeriod,
        sex: sex === '' ? null : sex,
        heightInches: computedHeightInches,
        startingWeightLbs: computedStartingWeightLbs,
        age: ageNum,
      });
      setStatus('saved');
      if (savedTimer.current !== null) {
        window.clearTimeout(savedTimer.current);
      }
      savedTimer.current = window.setTimeout(() => setStatus('idle'), 1500);
    }, 400);

    return () => {
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current);
      }
    };
  }, [
    loaded,
    unitSystem,
    weighInPeriod,
    sex,
    age,
    computedHeightInches,
    computedStartingWeightLbs,
  ]);

  useEffect(() => {
    return () => {
      if (savedTimer.current !== null) {
        window.clearTimeout(savedTimer.current);
      }
    };
  }, []);

  if (!settings) {
    return <div className="empty-state"><h3>Loading...</h3></div>;
  }

  return (
    <div>
      <div className="page-header">
        <Link to="/settings" className="text-accent" style={{ textDecoration: 'none', fontSize: 14 }}>
          &lsaquo; Settings
        </Link>
        <h1>Weight Profile</h1>
        <p className="subtitle">Personal info used to seed and correlate daily weigh-ins</p>
      </div>

      {/* Weigh-in preference */}
      <div className="card">
        <div className="card-title">When do you weigh in?</div>
        <div className="toggle-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <button
            type="button"
            className={`toggle-btn${weighInPeriod === 'morning' ? ' active' : ''}`}
            onClick={() => setWeighInPeriod('morning')}
          >
            Morning
          </button>
          <button
            type="button"
            className={`toggle-btn${weighInPeriod === 'evening' ? ' active' : ''}`}
            onClick={() => setWeighInPeriod('evening')}
          >
            Evening
          </button>
        </div>
        <div className="text-secondary text-sm mt-8">
          The weight entry will appear in your {weighInPeriod} log.
        </div>
      </div>

      {/* Units */}
      <div className="card">
        <div className="card-title">Units</div>
        <div className="toggle-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <button
            type="button"
            className={`toggle-btn${unitSystem === 'us' ? ' active' : ''}`}
            onClick={() => handleUnitChange('us')}
          >
            US (lb, ft/in)
          </button>
          <button
            type="button"
            className={`toggle-btn${unitSystem === 'metric' ? ' active' : ''}`}
            onClick={() => handleUnitChange('metric')}
          >
            Metric (kg, cm)
          </button>
        </div>
      </div>

      {/* Personal info */}
      <div className="card">
        <div className="card-title">Personal Info</div>

        <div className="form-group">
          <label className="form-label">Sex</label>
          <div className="toggle-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <button
              type="button"
              className={`toggle-btn${sex === 'm' ? ' active' : ''}`}
              onClick={() => setSex('m')}
            >
              M
            </button>
            <button
              type="button"
              className={`toggle-btn${sex === 'f' ? ' active' : ''}`}
              onClick={() => setSex('f')}
            >
              F
            </button>
          </div>
        </div>

        {unitSystem === 'us' ? (
          <div className="form-group">
            <label className="form-label">Height</label>
            <div className="flex gap-8">
              <input
                type="number"
                className="form-input"
                placeholder="ft"
                value={heightFeet}
                onChange={(e) => setHeightFeet(e.target.value)}
                min={0}
                max={8}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                className="form-input"
                placeholder="in"
                value={heightInchesPart}
                onChange={(e) => setHeightInchesPart(e.target.value)}
                min={0}
                max={11}
                step="0.5"
                style={{ flex: 1 }}
              />
            </div>
          </div>
        ) : (
          <div className="form-group">
            <label className="form-label">Height (cm)</label>
            <input
              type="number"
              className="form-input"
              placeholder="e.g. 178"
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
              min={60}
              max={250}
            />
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Age</label>
          <input
            type="number"
            className="form-input"
            placeholder="e.g. 40"
            value={age}
            onChange={(e) => setAge(e.target.value)}
            min={1}
            max={120}
          />
        </div>

        <div className="form-group">
          <label className="form-label">
            Starting weight ({unitSystem === 'metric' ? 'kg' : 'lb'})
          </label>
          <input
            type="number"
            className="form-input"
            placeholder={unitSystem === 'metric' ? 'e.g. 75.0' : 'e.g. 165.0'}
            value={startingWeightInput}
            onChange={(e) => setStartingWeightInput(e.target.value)}
            step="0.1"
          />
          <div className="text-secondary text-sm mt-8">
            Used as the default when you log your very first weigh-in. After that, your
            most recent weigh-in becomes the default.
          </div>
        </div>
      </div>

      {/* Ideal weight preview */}
      {idealPreviewLbs !== null && (
        <div className="card">
          <div className="card-title">Ideal Weight (Devine)</div>
          <div className="summary-row">
            <span className="summary-label">Calculated from sex + height</span>
            <span className="summary-value text-accent">
              {formatWeight(idealPreviewLbs, unitSystem)}
            </span>
          </div>
          <div className="text-secondary text-sm mt-8">
            Fallback default if you haven't logged a weigh-in yet and no starting weight is set.
          </div>
        </div>
      )}

      {error && <div className="banner banner-danger mt-8">{error}</div>}

      <div
        className="text-secondary text-sm mt-16"
        style={{ textAlign: 'center', minHeight: 20 }}
      >
        {status === 'saved' && (
          <span className="text-success">✓ Saved</span>
        )}
        {status === 'saving' && <span>Saving…</span>}
        {status === 'idle' && <span>Changes auto-save</span>}
        {status === 'invalid' && <span className="text-danger">Fix the issue above to save</span>}
      </div>
    </div>
  );
}

export { WeightProfilePage };
