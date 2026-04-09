import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import type { SleepRule } from '../../types';

const PRIORITY_OPTIONS = ['high', 'medium', 'low'] as const;
const PRIORITY_LABELS: Record<string, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

interface FormState {
  name: string;
  condition: string;
  recommendation: string;
  priority: SleepRule['priority'];
}

const emptyForm: FormState = {
  name: '',
  condition: '',
  recommendation: '',
  priority: 'medium',
};

export { SleepRulesPage };

export default function SleepRulesPage() {
  const rules = useLiveQuery(() => db.sleepRules.toArray());

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(emptyForm);

  if (!rules) {
    return <div className="empty-state"><h3>Loading...</h3></div>;
  }

  // Sort: active first, then by priority (high > medium > low)
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  const sortedRules = [...rules].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });

  const handleAdd = async () => {
    if (!form.name.trim() || !form.recommendation.trim()) return;
    await db.sleepRules.add({
      id: crypto.randomUUID(),
      name: form.name.trim(),
      condition: form.condition.trim(),
      recommendation: form.recommendation.trim(),
      priority: form.priority,
      isActive: true,
      source: 'user',
      createdAt: Date.now(),
    });
    setForm(emptyForm);
    setShowAdd(false);
  };

  const handleToggleActive = async (id: string, isActive: boolean) => {
    await db.sleepRules.update(id, { isActive: !isActive });
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Delete this rule?')) {
      await db.sleepRules.delete(id);
    }
  };

  const startEdit = (rule: SleepRule) => {
    setEditingId(rule.id);
    setEditForm({
      name: rule.name,
      condition: rule.condition,
      recommendation: rule.recommendation,
      priority: rule.priority,
    });
  };

  const saveEdit = async () => {
    if (!editingId || !editForm.name.trim()) return;
    await db.sleepRules.update(editingId, {
      name: editForm.name.trim(),
      condition: editForm.condition.trim(),
      recommendation: editForm.recommendation.trim(),
      priority: editForm.priority,
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
          placeholder="Rule name"
        />
      </div>
      <div className="form-group">
        <label className="form-label">Condition</label>
        <input
          className="form-input"
          value={values.condition}
          onChange={(e) => onChange({ ...values, condition: e.target.value })}
          placeholder="When does this apply?"
        />
      </div>
      <div className="form-group">
        <label className="form-label">Recommendation</label>
        <textarea
          className="form-input"
          value={values.recommendation}
          onChange={(e) => onChange({ ...values, recommendation: e.target.value })}
          placeholder="What should be done?"
        />
      </div>
      <div className="form-group">
        <label className="form-label">Priority</label>
        <select
          className="form-input"
          value={values.priority}
          onChange={(e) => onChange({ ...values, priority: e.target.value as SleepRule['priority'] })}
        >
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
          ))}
        </select>
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
        <h1>Sleep Rules</h1>
      </div>

      {sortedRules.map((rule) =>
        editingId === rule.id ? (
          <div key={rule.id}>
            {renderForm(editForm, setEditForm, saveEdit, () => setEditingId(null))}
          </div>
        ) : (
          <div
            key={rule.id}
            className={`rec-card rec-${rule.priority}`}
            style={{ opacity: rule.isActive ? 1 : 0.5, cursor: 'pointer' }}
            onClick={() => startEdit(rule)}
          >
            <div className="flex items-center justify-between mb-8">
              <div className="rec-name">{rule.name}</div>
              <div className="flex gap-8 items-center">
                <span
                  className={`text-sm fw-600`}
                  style={{ padding: '2px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.1)' }}
                >
                  {rule.source === 'seeded' ? 'Seeded' : 'User'}
                </span>
                <label className="switch" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={rule.isActive}
                    onChange={() => handleToggleActive(rule.id, rule.isActive)}
                  />
                  <span className="switch-slider" />
                </label>
              </div>
            </div>
            {rule.condition && (
              <div className="text-sm text-secondary mb-8">
                <strong>When:</strong> {rule.condition}
              </div>
            )}
            <div className="rec-text">{rule.recommendation}</div>
            <div className="flex gap-8 mt-8">
              <button
                className="btn btn-secondary btn-sm"
                onClick={(e) => { e.stopPropagation(); startEdit(rule); }}
              >
                Edit
              </button>
              {rule.source === 'user' && (
                <button
                  className="btn btn-danger btn-sm"
                  onClick={(e) => { e.stopPropagation(); handleDelete(rule.id); }}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        )
      )}

      {showAdd ? (
        renderForm(form, setForm, handleAdd, () => { setShowAdd(false); setForm(emptyForm); })
      ) : (
        <button
          className="btn btn-primary btn-full mt-16"
          onClick={() => setShowAdd(true)}
        >
          Add Rule
        </button>
      )}
    </div>
  );
}
