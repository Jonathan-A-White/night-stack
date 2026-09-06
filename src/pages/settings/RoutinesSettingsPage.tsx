import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import { blankSchedule, describeSchedule, sortRoutines } from '../../services/routineSchedule';
import { buildDefaultVariant, EVENING_ROUTINE_ID } from '../../services/routineSeeds';
import { editorPathFor, VAULT_SETTINGS_PATH } from '../../services/routinePaths';
import type { Routine } from '../../types';

export { RoutinesSettingsPage };

/**
 * Settings → Routines: the list of routines with add / reorder /
 * activate / delete. Each row opens the per-routine editor.
 */
export default function RoutinesSettingsPage() {
  const navigate = useNavigate();
  const routines = useLiveQuery(() => db.routines.toArray(), []);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');

  if (!routines) {
    return <div className="empty-state"><h3>Loading&hellip;</h3></div>;
  }

  const ordered = sortRoutines(routines);

  const handleAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const now = Date.now();
    const maxSort = routines.reduce((m, r) => Math.max(m, r.sortOrder), 0);
    const routine: Routine = {
      id: crypto.randomUUID(),
      name: trimmed,
      description: '',
      schedule: blankSchedule('none'),
      isActive: true,
      sortOrder: maxSort + 1,
      createdAt: now,
    };
    await db.transaction('rw', db.routines, db.routineVariants, async () => {
      await db.routines.add(routine);
      await db.routineVariants.add(buildDefaultVariant(routine.id, now));
    });
    setName('');
    setShowAdd(false);
    navigate(editorPathFor(routine.id));
  };

  const handleToggleActive = (routine: Routine) =>
    db.routines.update(routine.id, { isActive: !routine.isActive });

  const handleMove = async (routine: Routine, direction: 'up' | 'down') => {
    const bySort = [...routines].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = bySort.findIndex((r) => r.id === routine.id);
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (idx === -1 || targetIdx < 0 || targetIdx >= bySort.length) return;
    const neighbor = bySort[targetIdx];
    await db.transaction('rw', db.routines, async () => {
      await db.routines.update(routine.id, { sortOrder: neighbor.sortOrder });
      await db.routines.update(neighbor.id, { sortOrder: routine.sortOrder });
    });
  };

  const handleDelete = async (routine: Routine) => {
    if (routine.id === EVENING_ROUTINE_ID) return;
    const sessionCount = await db.routineSessions.where('routineId').equals(routine.id).count();
    const msg = sessionCount > 0
      ? `Delete "${routine.name}" and its ${sessionCount} saved session(s)? This cannot be undone.`
      : `Delete "${routine.name}" and its steps?`;
    if (!window.confirm(msg)) return;
    await db.transaction(
      'rw',
      [db.routines, db.routineSteps, db.routineVariants, db.routineSessions],
      async () => {
        await db.routineSteps.where('routineId').equals(routine.id).delete();
        await db.routineVariants.where('routineId').equals(routine.id).delete();
        await db.routineSessions.where('routineId').equals(routine.id).delete();
        await db.routines.delete(routine.id);
      },
    );
  };

  return (
    <div>
      <div className="page-header">
        <Link to="/settings" className="text-accent" style={{ textDecoration: 'none', fontSize: 14 }}>
          &lsaquo; Settings
        </Link>
        <h1>Routines</h1>
        <p className="subtitle">Each routine has its own steps, variants and stats</p>
      </div>

      <div className="card">
        {ordered.length === 0 ? (
          <div className="text-secondary text-sm" style={{ padding: '8px 0' }}>No routines yet.</div>
        ) : ordered.map((routine, idx) => {
          const isEvening = routine.id === EVENING_ROUTINE_ID;
          return (
            <div key={routine.id} className="routine-step-row" style={{ opacity: routine.isActive ? 1 : 0.5 }}>
              <Link
                to={editorPathFor(routine.id)}
                style={{ flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit' }}
              >
                <div className="fw-600">{routine.name}</div>
                <div className="text-secondary text-sm">{describeSchedule(routine.schedule)}</div>
              </Link>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                <button className="routine-reorder-btn" onClick={() => handleMove(routine, 'up')} disabled={idx === 0} aria-label="Move up">&uarr;</button>
                <button className="routine-reorder-btn" onClick={() => handleMove(routine, 'down')} disabled={idx === ordered.length - 1} aria-label="Move down">&darr;</button>
                <button
                  className="routine-reorder-btn"
                  onClick={() => handleDelete(routine)}
                  disabled={isEvening}
                  title={isEvening ? 'The evening routine cannot be deleted; deactivate it instead' : 'Delete routine'}
                  aria-label="Delete routine"
                >
                  &times;
                </button>
                <label className="switch" title={routine.isActive ? 'Active' : 'Hidden from the Routine home'}>
                  <input type="checkbox" checked={routine.isActive} onChange={() => handleToggleActive(routine)} />
                  <span className="switch-slider" />
                </label>
              </div>
            </div>
          );
        })}

        {showAdd ? (
          <div className="card mt-8">
            <div className="form-group">
              <label className="form-label">Routine name</label>
              <input
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                placeholder="e.g. Morning, Sound booth, Packing for a trip"
                autoFocus
              />
            </div>
            <div className="flex gap-8">
              <button className="btn btn-primary btn-sm" onClick={handleAdd}>Create</button>
              <button className="btn btn-secondary btn-sm" onClick={() => { setShowAdd(false); setName(''); }}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="btn btn-primary btn-sm mt-8" onClick={() => setShowAdd(true)}>Add Routine</button>
        )}
      </div>

      <div className="card">
        <div className="card-title">Password vault</div>
        <p className="text-secondary text-sm mb-8">
          Steps can show a stored password (iPad unlock codes and the like). Values are
          encrypted on this phone and unlocked with a PIN or your fingerprint.
        </p>
        <Link to={VAULT_SETTINGS_PATH} className="btn btn-secondary btn-full">Open vault</Link>
      </div>

      <div className="card">
        <div className="card-title">Import / export</div>
        <p className="text-secondary text-sm mb-8">
          Routine files (steps, variants, optionally history) are exported and imported from
          Data Management. See <code>docs/routine-import-guide.md</code> for the file format.
        </p>
        <Link to="/settings/data" className="btn btn-secondary btn-full">Data Management</Link>
      </div>
    </div>
  );
}
