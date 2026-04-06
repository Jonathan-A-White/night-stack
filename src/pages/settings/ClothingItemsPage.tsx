import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';

export { ClothingItemsPage };

export default function ClothingItemsPage() {
  const items = useLiveQuery(
    () => db.clothingItems.orderBy('sortOrder').toArray()
  );

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  if (!items) {
    return <div className="empty-state"><h3>Loading...</h3></div>;
  }

  const handleAdd = async () => {
    if (!newName.trim()) return;
    const maxSort = items.length > 0
      ? Math.max(...items.map((i) => i.sortOrder))
      : 0;
    await db.clothingItems.add({
      id: crypto.randomUUID(),
      name: newName.trim(),
      sortOrder: maxSort + 1,
      isActive: true,
    });
    setNewName('');
    setShowAdd(false);
  };

  const handleToggleActive = async (id: string, isActive: boolean) => {
    await db.clothingItems.update(id, { isActive: !isActive });
  };

  const startEdit = (id: string, name: string) => {
    setEditingId(id);
    setEditName(name);
  };

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    await db.clothingItems.update(editingId, { name: editName.trim() });
    setEditingId(null);
  };

  return (
    <div>
      <div className="page-header">
        <Link to="/settings" className="text-accent" style={{ textDecoration: 'none', fontSize: 14 }}>
          &lsaquo; Settings
        </Link>
        <h1>Clothing Items</h1>
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
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
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
                onClick={() => startEdit(item.id, item.name)}
              >
                {item.name}
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
            <label className="form-label">Item Name</label>
            <input
              className="form-input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              placeholder="e.g. Wool socks"
              autoFocus
            />
          </div>
          <div className="flex gap-8">
            <button className="btn btn-primary btn-sm" onClick={handleAdd}>Save</button>
            <button className="btn btn-secondary btn-sm" onClick={() => { setShowAdd(false); setNewName(''); }}>Cancel</button>
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
