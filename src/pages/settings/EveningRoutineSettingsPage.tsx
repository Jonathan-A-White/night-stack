import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import {
  computeStepPBs,
  computeStepStats,
  formatTotal,
} from '../../services/routineAnalytics';
import type { RoutineStep, RoutineVariant } from '../../types';

export { EveningRoutineSettingsPage };

interface NameDescForm {
  name: string;
  description: string;
}
const emptyForm: NameDescForm = { name: '', description: '' };

export default function EveningRoutineSettingsPage() {
  const steps = useLiveQuery(() => db.routineSteps.orderBy('sortOrder').toArray());
  const variants = useLiveQuery(() => db.routineVariants.orderBy('sortOrder').toArray());
  const sessions = useLiveQuery(() => db.routineSessions.toArray());

  // Step state
  const [showAddStep, setShowAddStep] = useState(false);
  const [stepForm, setStepForm] = useState<NameDescForm>(emptyForm);
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [editStepName, setEditStepName] = useState('');

  // Variant state
  const [showAddVariant, setShowAddVariant] = useState(false);
  const [variantForm, setVariantForm] = useState<NameDescForm>(emptyForm);
  const [expandedVariantId, setExpandedVariantId] = useState<string | null>(null);
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [editVariantForm, setEditVariantForm] = useState<NameDescForm>(emptyForm);

  if (!steps || !variants || !sessions) {
    return <div className="empty-state"><h3>Loading&hellip;</h3></div>;
  }

  const pbs = computeStepPBs(sessions);
  const stepStats = computeStepStats(sessions);
  const activeSteps = steps.filter((s) => s.isActive);

  // === Step handlers ===
  const handleAddStep = async () => {
    const name = stepForm.name.trim();
    if (!name) return;
    const maxSort = steps.length > 0 ? Math.max(...steps.map((s) => s.sortOrder)) : 0;
    const newStep: RoutineStep = {
      id: crypto.randomUUID(),
      name,
      description: stepForm.description.trim(),
      sortOrder: maxSort + 1,
      isActive: true,
      createdAt: Date.now(),
    };
    // Insert the step AND append its id to every variant's stepIds so new steps
    // are visible by default everywhere.
    await db.transaction('rw', db.routineSteps, db.routineVariants, async () => {
      await db.routineSteps.add(newStep);
      const allVariants = await db.routineVariants.toArray();
      for (const v of allVariants) {
        await db.routineVariants.update(v.id, { stepIds: [...v.stepIds, newStep.id] });
      }
    });
    setStepForm(emptyForm);
    setShowAddStep(false);
  };

  const handleToggleStepActive = (id: string, isActive: boolean) =>
    db.routineSteps.update(id, { isActive: !isActive });

  const startEditStep = (step: RoutineStep) => {
    setEditingStepId(step.id);
    setEditStepName(step.name);
  };

  const saveStepEdit = async () => {
    if (!editingStepId || !editStepName.trim()) return;
    await db.routineSteps.update(editingStepId, { name: editStepName.trim() });
    setEditingStepId(null);
  };

  const handleDeleteStep = async (id: string) => {
    if (!window.confirm('Delete this step? It will be removed from all variants.')) return;
    // Historical sessions intentionally untouched — they store snapshots.
    await db.transaction('rw', db.routineSteps, db.routineVariants, async () => {
      await db.routineSteps.delete(id);
      const allVariants = await db.routineVariants.toArray();
      for (const v of allVariants) {
        if (v.stepIds.includes(id)) {
          await db.routineVariants.update(v.id, {
            stepIds: v.stepIds.filter((sid) => sid !== id),
          });
        }
      }
    });
  };

  const handleMoveStep = async (id: string, direction: 'up' | 'down') => {
    const ordered = [...steps].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = ordered.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= ordered.length) return;
    const current = ordered[idx];
    const neighbor = ordered[targetIdx];
    await db.transaction('rw', db.routineSteps, async () => {
      await db.routineSteps.update(current.id, { sortOrder: neighbor.sortOrder });
      await db.routineSteps.update(neighbor.id, { sortOrder: current.sortOrder });
    });
  };

  // === Variant handlers ===
  const handleAddVariant = async () => {
    const name = variantForm.name.trim();
    if (!name) return;
    const maxSort = variants.length > 0 ? Math.max(...variants.map((v) => v.sortOrder)) : 0;
    await db.routineVariants.add({
      id: crypto.randomUUID(),
      name,
      description: variantForm.description.trim(),
      stepIds: activeSteps.map((s) => s.id),
      isDefault: false,
      sortOrder: maxSort + 1,
      createdAt: Date.now(),
    });
    setVariantForm(emptyForm);
    setShowAddVariant(false);
  };

  const handleDeleteVariant = async (variant: RoutineVariant) => {
    if (variant.isDefault) return;
    if (!window.confirm(`Delete variant "${variant.name}"?`)) return;
    await db.routineVariants.delete(variant.id);
    if (expandedVariantId === variant.id) setExpandedVariantId(null);
  };

  const handleToggleStepInVariant = (variant: RoutineVariant, stepId: string) => {
    const next = variant.stepIds.includes(stepId)
      ? variant.stepIds.filter((id) => id !== stepId)
      : [...variant.stepIds, stepId];
    return db.routineVariants.update(variant.id, { stepIds: next });
  };

  const handleSetDefault = async (variantId: string) => {
    await db.transaction('rw', db.routineVariants, async () => {
      const allVariants = await db.routineVariants.toArray();
      for (const v of allVariants) {
        if (v.id === variantId && !v.isDefault) {
          await db.routineVariants.update(v.id, { isDefault: true });
        } else if (v.id !== variantId && v.isDefault) {
          await db.routineVariants.update(v.id, { isDefault: false });
        }
      }
    });
  };

  const startEditVariant = (variant: RoutineVariant) => {
    setEditingVariantId(variant.id);
    setEditVariantForm({ name: variant.name, description: variant.description });
  };

  const saveVariantEdit = async () => {
    if (!editingVariantId || !editVariantForm.name.trim()) return;
    await db.routineVariants.update(editingVariantId, {
      name: editVariantForm.name.trim(),
      description: editVariantForm.description.trim(),
    });
    setEditingVariantId(null);
  };

  // === Shared render helpers ===
  const subLabel = (text: string) => (
    <div className="text-secondary text-sm" style={{ marginTop: -8, marginBottom: 12 }}>{text}</div>
  );

  const renderNameDescForm = (
    values: NameDescForm,
    onChange: (f: NameDescForm) => void,
    onSave: () => void,
    onCancel: () => void,
    namePlaceholder: string,
    descPlaceholder: string,
    nameLabel: string,
  ) => (
    <div className="card mt-8">
      <div className="form-group">
        <label className="form-label">{nameLabel}</label>
        <input
          className="form-input"
          value={values.name}
          onChange={(e) => onChange({ ...values, name: e.target.value })}
          placeholder={namePlaceholder}
          autoFocus
        />
      </div>
      <div className="form-group">
        <label className="form-label">Description (optional)</label>
        <textarea
          className="form-input"
          value={values.description}
          onChange={(e) => onChange({ ...values, description: e.target.value })}
          placeholder={descPlaceholder}
          rows={2}
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
        <h1>Evening Routine</h1>
      </div>

      {/* === Section 1: Steps === */}
      <div className="card">
        <div className="card-title">Routine Steps</div>
        {subLabel('All steps in your evening routine, ordered.')}

        {steps.length === 0 ? (
          <div className="text-secondary text-sm" style={{ padding: '8px 0' }}>No steps yet. Add your first step below.</div>
        ) : steps.map((step, idx) => {
          const pbMs = pbs.get(step.id) ?? null;
          const isFirst = idx === 0;
          const isLast = idx === steps.length - 1;
          return (
            <div key={step.id} className="routine-step-row" style={{ opacity: step.isActive ? 1 : 0.5 }}>
              {editingStepId === step.id ? (
                <div className="flex gap-8" style={{ flex: 1, alignItems: 'center' }}>
                  <input
                    className="form-input"
                    value={editStepName}
                    onChange={(e) => setEditStepName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveStepEdit()}
                    autoFocus
                  />
                  <button className="btn btn-primary btn-sm" onClick={saveStepEdit}>Save</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditingStepId(null)}>Cancel</button>
                </div>
              ) : (
                <>
                  <span className="routine-step-name" style={{ cursor: 'pointer' }} onClick={() => startEditStep(step)}>{step.name}</span>
                  <span className="routine-step-time" style={{ fontSize: 14 }}>PB {formatTotal(pbMs)}</span>
                  <div className="flex gap-8" style={{ alignItems: 'center' }}>
                    <button className="routine-reorder-btn" onClick={() => handleMoveStep(step.id, 'up')} disabled={isFirst} aria-label="Move up">&uarr;</button>
                    <button className="routine-reorder-btn" onClick={() => handleMoveStep(step.id, 'down')} disabled={isLast} aria-label="Move down">&darr;</button>
                    <button className="routine-reorder-btn" onClick={() => handleDeleteStep(step.id)} aria-label="Delete step">&times;</button>
                    <label className="switch">
                      <input type="checkbox" checked={step.isActive} onChange={() => handleToggleStepActive(step.id, step.isActive)} />
                      <span className="switch-slider" />
                    </label>
                  </div>
                </>
              )}
            </div>
          );
        })}

        {showAddStep ? renderNameDescForm(
          stepForm,
          setStepForm,
          handleAddStep,
          () => { setShowAddStep(false); setStepForm(emptyForm); },
          'e.g. Brush teeth',
          'Optional notes about this step',
          'Step Name',
        ) : (
          <button className="btn btn-primary btn-sm mt-8" onClick={() => setShowAddStep(true)}>Add Step</button>
        )}
      </div>

      {/* === Section 2: Variants === */}
      <div className="card">
        <div className="card-title">Variants</div>
        {subLabel('Named subsets of steps — pick which variant to run each night.')}

        {variants.map((variant) => {
          const isExpanded = expandedVariantId === variant.id;
          const isEditing = editingVariantId === variant.id;
          return (
            <div key={variant.id} className="card" style={{ padding: 12, marginBottom: 8 }}>
              {isEditing ? (
                <div>
                  <div className="form-group">
                    <label className="form-label">Name</label>
                    <input className="form-input" value={editVariantForm.name} onChange={(e) => setEditVariantForm({ ...editVariantForm, name: e.target.value })} autoFocus />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Description</label>
                    <textarea className="form-input" value={editVariantForm.description} onChange={(e) => setEditVariantForm({ ...editVariantForm, description: e.target.value })} rows={2} />
                  </div>
                  <div className="flex gap-8">
                    <button className="btn btn-primary btn-sm" onClick={saveVariantEdit}>Save</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setEditingVariantId(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex gap-8" style={{ alignItems: 'center', cursor: 'pointer' }} onClick={() => setExpandedVariantId(isExpanded ? null : variant.id)}>
                    <div style={{ flex: 1 }}>
                      <span className="fw-600">{variant.name}</span>
                      {variant.isDefault && (
                        <span className="text-accent fw-600" style={{ marginLeft: 8, fontSize: 11, letterSpacing: 0.5 }}>DEFAULT</span>
                      )}
                      {variant.description && (
                        <div className="text-secondary text-sm">{variant.description}</div>
                      )}
                    </div>
                    <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); startEditVariant(variant); }}>Edit</button>
                    {variant.isDefault ? (
                      <button className="btn btn-secondary btn-sm" disabled title="Default variant cannot be deleted" onClick={(e) => e.stopPropagation()}>Delete</button>
                    ) : (
                      <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); handleDeleteVariant(variant); }}>Delete</button>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="mt-16">
                      {activeSteps.length === 0 ? (
                        <div className="text-secondary text-sm">No active steps. Add a step above to include it in this variant.</div>
                      ) : activeSteps.map((step) => {
                        const included = variant.stepIds.includes(step.id);
                        return (
                          <label key={step.id} className="flex gap-8" style={{ alignItems: 'center', padding: '6px 0', cursor: 'pointer' }}>
                            <input type="checkbox" checked={included} onChange={() => handleToggleStepInVariant(variant, step.id)} />
                            <span>{step.name}</span>
                          </label>
                        );
                      })}
                      {!variant.isDefault && (
                        <button className="btn btn-secondary btn-sm mt-8" onClick={() => handleSetDefault(variant.id)}>Set as default</button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}

        {showAddVariant ? renderNameDescForm(
          variantForm,
          setVariantForm,
          handleAddVariant,
          () => { setShowAddVariant(false); setVariantForm(emptyForm); },
          'e.g. Quick, Weeknight',
          'When to use this variant',
          'Variant Name',
        ) : (
          <button className="btn btn-primary btn-sm mt-8" onClick={() => setShowAddVariant(true)}>Add Variant</button>
        )}
      </div>

      {/* === Section 3: Stats === */}
      <div className="card">
        <div className="card-title">Per-Step Stats (last 30 days)</div>
        {sessions.length === 0 ? (
          <div className="text-secondary text-sm" style={{ padding: '8px 0' }}>
            No session data yet. Run your first routine to see stats here.
          </div>
        ) : activeSteps.length === 0 ? (
          <div className="text-secondary text-sm" style={{ padding: '8px 0' }}>
            No active steps to show.
          </div>
        ) : activeSteps.map((step) => {
          const s = stepStats.get(step.id);
          const best = s?.bestMs ?? null;
          const avg30 = s?.avgMs30d ?? null;
          const runs = s?.completedCount ?? 0;
          const skipped = s?.skippedCount ?? 0;
          const punted = s?.puntedCount ?? 0;
          return (
            <div key={step.id} className="flex gap-8" style={{ alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
              <div className="fw-600" style={{ flex: 1 }}>{step.name}</div>
              <div className="text-secondary text-sm" style={{ textAlign: 'right' }}>
                Best: {formatTotal(best)} &middot; Avg (30d): {formatTotal(avg30)}
                <br />
                Runs: {runs}, Skipped: {skipped}, Punted: {punted}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
