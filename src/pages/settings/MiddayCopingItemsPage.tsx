import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import type { MiddayCopingType } from '../../types';

const TYPE_OPTIONS: { value: MiddayCopingType; label: string; hint: string }[] = [
  { value: 'food', label: 'Food', hint: 'Bad coping — crash + thermic load' },
  { value: 'drink', label: 'Drink', hint: 'Good coping' },
  { value: 'exercise', label: 'Exercise', hint: 'Good coping' },
  { value: 'nap', label: 'Nap', hint: 'Good action, bad signal — prior sleep likely short' },
];

const TYPE_LABEL: Record<MiddayCopingType, string> = {
  food: 'Food',
  drink: 'Drink',
  exercise: 'Exercise',
  nap: 'Nap',
};

/** Returns the good/bad class for the pill shown next to an item. */
function toneClass(type: MiddayCopingType): string {
  if (type === 'food') return 'text-danger';
  if (type === 'nap') return 'text-warning';
  return 'text-success';
}

export { MiddayCopingItemsPage };

export default function MiddayCopingItemsPage() {
  const items = useLiveQuery(
    () => db.middayCopingItems.orderBy('sortOrder').toArray()
  );

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<MiddayCopingType>('drink');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState<MiddayCopingType>('drink');

  if (!items) {
    return <div className="empty-state"><h3>Loading...</h3></div>;
  }

  const handleAdd = async () => {
    if (!newName.trim()) return;
    const maxSort = items.length > 0
      ? Math.max(...items.map((i) => i.sortOrder))
      : 0;
    await db.middayCopingItems.add({
      id: crypto.randomUUID(),
      name: newName.trim(),
      type: newType,
      sortOrder: maxSort + 1,
      isActive: true,
    });
    setNewName('');
    setNewType('drink');
    setShowAdd(false);
  };

  const handleToggleActive = async (id: string, isActive: boolean) => {
    await db.middayCopingItems.update(id, { isActive: !isActive });
  };

  const startEdit = (id: string, name: string, type: MiddayCopingType) => {
    setEditingId(id);
    setEditName(name);
    setEditType(type);
  };

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    await db.middayCopingItems.update(editingId, {
      name: editName.trim(),
      type: editType,
    });
    setEditingId(null);
  };

  return (
    <div>
      <div className="page-header">
        <Link to="/settings" className="text-accent" style={{ textDecoration: 'none', fontSize: 14 }}>
          &lsaquo; Settings
        </Link>
        <h1>Midday Coping Items</h1>
        <p className="subtitle">
          What you reach for when the afternoon slump hits. Food is treated as
          bad; drink and exercise as good; naps as a good response to a bad
          signal.
        </p>
      </div>

      {items.map((item) => (
        <div
          key={item.id}
          className="list-item"
          style={{ opacity: item.isActive ? 1 : 0.5 }}
        >
          {editingId === item.id ? (
            <div style={{ flex: 1 }}>
              <div className="form-group">
                <input
                  className="form-input"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label">Type</label>
                <select
                  className="form-input"
                  value={editType}
                  onChange={(e) => setEditType(e.target.value as MiddayCopingType)}
                >
                  {TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label} — {opt.hint}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-8">
                <button className="btn btn-primary btn-sm" onClick={saveEdit}>Save</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => startEdit(item.id, item.name, item.type)}>
                <div className="fw-600">{item.name}</div>
                <div className={`text-sm ${toneClass(item.type)}`}>
                  {TYPE_LABEL[item.type]}
                </div>
              </div>
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
            <label className="form-label">Name</label>
            <input
              className="form-input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              placeholder="e.g. Ginger tea"
              autoFocus
            />
          </div>
          <div className="form-group">
            <label className="form-label">Type</label>
            <select
              className="form-input"
              value={newType}
              onChange={(e) => setNewType(e.target.value as MiddayCopingType)}
            >
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} — {opt.hint}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-8">
            <button className="btn btn-primary btn-sm" onClick={handleAdd}>Save</button>
            <button className="btn btn-secondary btn-sm" onClick={() => { setShowAdd(false); setNewName(''); setNewType('drink'); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button
          className="btn btn-primary btn-full mt-16"
          onClick={() => setShowAdd(true)}
        >
          Add Item
        </button>
      )}
    </div>
  );
}
