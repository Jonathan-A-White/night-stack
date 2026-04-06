import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';

export { BedtimeReasonsPage };

export default function BedtimeReasonsPage() {
  const items = useLiveQuery(
    () => db.bedtimeReasons.orderBy('sortOrder').toArray()
  );

  const [showAdd, setShowAdd] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');

  if (!items) {
    return <div className="empty-state"><h3>Loading...</h3></div>;
  }

  const handleAdd = async () => {
    if (!newLabel.trim()) return;
    const maxSort = items.length > 0
      ? Math.max(...items.map((i) => i.sortOrder))
      : 0;
    await db.bedtimeReasons.add({
      id: crypto.randomUUID(),
      label: newLabel.trim(),
      sortOrder: maxSort + 1,
      isActive: true,
    });
    setNewLabel('');
    setShowAdd(false);
  };

  const handleToggleActive = async (id: string, isActive: boolean) => {
    await db.bedtimeReasons.update(id, { isActive: !isActive });
  };

  const startEdit = (id: string, label: string) => {
    setEditingId(id);
    setEditLabel(label);
  };

  const saveEdit = async () => {
    if (!editingId || !editLabel.trim()) return;
    await db.bedtimeReasons.update(editingId, { label: editLabel.trim() });
    setEditingId(null);
  };

  return (
    <div>
      <div className="page-header">
        <Link to="/settings" className="text-accent" style={{ textDecoration: 'none', fontSize: 14 }}>
          &lsaquo; Settings
        </Link>
        <h1>Bedtime Reasons</h1>
      </div>

      {items.map((item) => (
        <div
          key={item.id}
          className="list-item"
          style={{ opacity: item.isActive ? 1 : 0.5 }}
        >
          {editingId === item.id ? (
            <div className="flex gap-8 items-center" style={{ flex: 1 }}>
              <input
                className="form-input"
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                autoFocus
              />
              <button className="btn btn-primary btn-sm" onClick={saveEdit}>Save</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
            </div>
          ) : (
            <>
              <span
                className="fw-600"
                style={{ flex: 1, cursor: 'pointer' }}
                onClick={() => startEdit(item.id, item.label)}
              >
                {item.label}
              </span>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={item.isActive}
                  onChange={() => handleToggleActive(item.id, item.isActive)}
                />
                <span className="switch-slider" />
              </label>
            </>
          )}
        </div>
      ))}

      {showAdd ? (
        <div className="card">
          <div className="form-group">
            <label className="form-label">Reason Label</label>
            <input
              className="form-input"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              placeholder="e.g. Reading too late"
              autoFocus
            />
          </div>
          <div className="flex gap-8">
            <button className="btn btn-primary btn-sm" onClick={handleAdd}>Save</button>
            <button className="btn btn-secondary btn-sm" onClick={() => { setShowAdd(false); setNewLabel(''); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button
          className="btn btn-primary btn-full mt-16"
          onClick={() => setShowAdd(true)}
        >
          Add Reason
        </button>
      )}
    </div>
  );
}
