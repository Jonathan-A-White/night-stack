import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import type { SupplementDef } from '../../types';

const TIMING_OPTIONS = ['morning', 'lunch', 'dinner', 'bedtime'] as const;
const FREQUENCY_OPTIONS = ['daily', 'every_other_day', 'weekdays', 'custom'] as const;
const FREQUENCY_LABELS: Record<string, string> = {
  daily: 'Daily',
  every_other_day: 'Every Other Day',
  weekdays: 'Weekdays',
  custom: 'Custom',
};

interface FormState {
  name: string;
  defaultDose: string;
  timing: SupplementDef['timing'];
  frequency: SupplementDef['frequency'];
  notes: string;
}

const emptyForm: FormState = {
  name: '',
  defaultDose: '',
  timing: 'bedtime',
  frequency: 'daily',
  notes: '',
};

export { SupplementStackPage };

export default function SupplementStackPage() {
  const supplements = useLiveQuery(
    () => db.supplementDefs.orderBy('sortOrder').toArray()
  );

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(emptyForm);

  if (!supplements) {
    return <div className="empty-state"><h3>Loading...</h3></div>;
  }

  const handleAdd = async () => {
    if (!form.name.trim()) return;
    const maxSort = supplements.length > 0
      ? Math.max(...supplements.map((s) => s.sortOrder))
      : 0;
    await db.supplementDefs.add({
      id: crypto.randomUUID(),
      name: form.name.trim(),
      defaultDose: form.defaultDose.trim(),
      timing: form.timing,
      frequency: form.frequency,
      notes: form.notes.trim(),
      isActive: true,
      sortOrder: maxSort + 1,
    });
    setForm(emptyForm);
    setShowAdd(false);
  };

  const handleToggleActive = async (id: string, isActive: boolean) => {
    await db.supplementDefs.update(id, { isActive: !isActive });
  };

  const startEdit = (supp: SupplementDef) => {
    setEditingId(supp.id);
    setEditForm({
      name: supp.name,
      defaultDose: supp.defaultDose,
      timing: supp.timing,
      frequency: supp.frequency,
      notes: supp.notes,
    });
  };

  const saveEdit = async () => {
    if (!editingId || !editForm.name.trim()) return;
    await db.supplementDefs.update(editingId, {
      name: editForm.name.trim(),
      defaultDose: editForm.defaultDose.trim(),
      timing: editForm.timing,
      frequency: editForm.frequency,
      notes: editForm.notes.trim(),
    });
    setEditingId(null);
  };

  const renderForm = (
    values: FormState,
    onChange: (f: FormState) => void,
    onSave: () => void,
    onCancel: () => void,
  ) => (
    <div className="card">
      <div className="form-group">
        <label className="form-label">Name</label>
        <input
          className="form-input"
          value={values.name}
          onChange={(e) => onChange({ ...values, name: e.target.value })}
          placeholder="Supplement name"
        />
      </div>
      <div className="form-group">
        <label className="form-label">Default Dose</label>
        <input
          className="form-input"
          value={values.defaultDose}
          onChange={(e) => onChange({ ...values, defaultDose: e.target.value })}
          placeholder="e.g. 400mg"
        />
      </div>
      <div className="form-group">
        <label className="form-label">Timing</label>
        <select
          className="form-input"
          value={values.timing}
          onChange={(e) => onChange({ ...values, timing: e.target.value as SupplementDef['timing'] })}
        >
          {TIMING_OPTIONS.map((t) => (
            <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">Frequency</label>
        <select
          className="form-input"
          value={values.frequency}
          onChange={(e) => onChange({ ...values, frequency: e.target.value as SupplementDef['frequency'] })}
        >
          {FREQUENCY_OPTIONS.map((f) => (
            <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">Notes</label>
        <input
          className="form-input"
          value={values.notes}
          onChange={(e) => onChange({ ...values, notes: e.target.value })}
          placeholder="Optional notes"
        />
      </div>
      <div className="flex gap-8">
        <button className="btn btn-primary btn-sm" onClick={onSave}>Save</button>
        <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <Link to="/settings" className="text-accent" style={{ textDecoration: 'none', fontSize: 14 }}>
          &lsaquo; Settings
        </Link>
        <h1>Supplement Stack</h1>
      </div>

      {supplements.map((supp) => (
        editingId === supp.id ? (
          <div key={supp.id}>
            {renderForm(editForm, setEditForm, saveEdit, () => setEditingId(null))}
          </div>
        ) : (
          <div
            key={supp.id}
            className="list-item"
            style={{ opacity: supp.isActive ? 1 : 0.5, cursor: 'pointer' }}
            onClick={() => startEdit(supp)}
          >
            <div style={{ flex: 1 }}>
              <div className="fw-600">{supp.name}</div>
              <div className="text-secondary text-sm">
                {supp.defaultDose} &middot; {supp.timing.charAt(0).toUpperCase() + supp.timing.slice(1)} &middot; {FREQUENCY_LABELS[supp.frequency]}
              </div>
              {supp.notes && (
                <div className="text-secondary text-sm" style={{ fontStyle: 'italic' }}>
                  {supp.notes}
                </div>
              )}
            </div>
            <label className="switch" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={supp.isActive}
                onChange={() => handleToggleActive(supp.id, supp.isActive)}
              />
              <span className="switch-slider" />
            </label>
          </div>
        )
      ))}

      {showAdd ? (
        renderForm(form, setForm, handleAdd, () => { setShowAdd(false); setForm(emptyForm); })
      ) : (
        <button
          className="btn btn-primary btn-full mt-16"
          onClick={() => setShowAdd(true)}
        >
          Add Supplement
        </button>
      )}
    </div>
  );
}
