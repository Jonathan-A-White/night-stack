import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import {
  computeStepPBs,
  computeStepStats,
  formatTotal,
} from '../../services/routineAnalytics';
import { blankSchedule, describeSchedule } from '../../services/routineSchedule';
import { ROUTINES_SETTINGS_PATH, VAULT_SETTINGS_PATH, trackerPathFor } from '../../services/routinePaths';
import { EVENING_ROUTINE_ID } from '../../services/routineSeeds';
import { DAY_NAMES } from '../../utils';
import type { RoutineSchedule, RoutineScheduleAnchor, RoutineStep, RoutineVariant } from '../../types';

export { RoutineEditorPage };

interface NameDescForm {
  name: string;
  description: string;
}
const emptyForm: NameDescForm = { name: '', description: '' };

interface StepEditForm {
  name: string;
  description: string;
  secretNames: string[];
}

/**
 * Settings → Routines → one routine: name, description and schedule at
 * the top, then the step list, variants and per-step stats that used to
 * be the Evening Routine page. `/settings/evening-routine` redirects
 * here with the evening routine's id.
 */
export default function RoutineEditorPage() {
  const { routineId = EVENING_ROUTINE_ID } = useParams<{ routineId: string }>();
  return <RoutineEditorFor key={routineId} routineId={routineId} />;
}

function RoutineEditorFor({ routineId }: { routineId: string }) {
  const routine = useLiveQuery(
    async () => (await db.routines.get(routineId)) ?? null,
    [routineId],
  );
  const steps = useLiveQuery(
    () => db.routineSteps.where('routineId').equals(routineId).sortBy('sortOrder'),
    [routineId],
  );
  const variants = useLiveQuery(
    () => db.routineVariants.where('routineId').equals(routineId).sortBy('sortOrder'),
    [routineId],
  );
  const sessions = useLiveQuery(
    () => db.routineSessions.where('routineId').equals(routineId).toArray(),
    [routineId],
  );
  const storedSecrets = useLiveQuery(() => db.secrets.toArray(), []);

  // Routine header form (name / description / schedule), saved on blur / change.
  const [headerForm, setHeaderForm] = useState<{ name: string; description: string } | null>(null);
  useEffect(() => {
    if (routine && headerForm == null) {
      setHeaderForm({ name: routine.name, description: routine.description });
    }
  }, [routine, headerForm]);

  // Step state
  const [showAddStep, setShowAddStep] = useState(false);
  const [stepForm, setStepForm] = useState<NameDescForm>(emptyForm);
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [editStep, setEditStep] = useState<StepEditForm>({ name: '', description: '', secretNames: [] });
  const [newSecretName, setNewSecretName] = useState('');

  // Variant state
  const [showAddVariant, setShowAddVariant] = useState(false);
  const [variantForm, setVariantForm] = useState<NameDescForm>(emptyForm);
  const [expandedVariantId, setExpandedVariantId] = useState<string | null>(null);
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [editVariantForm, setEditVariantForm] = useState<NameDescForm>(emptyForm);

  if (routine === undefined || !steps || !variants || !sessions) {
    return <div className="empty-state"><h3>Loading&hellip;</h3></div>;
  }

  if (routine === null) {
    return (
      <div className="empty-state">
        <h3>Routine not found</h3>
        <p className="text-secondary text-sm"><Link to={ROUTINES_SETTINGS_PATH}>Back to routines</Link></p>
      </div>
    );
  }

  const pbs = computeStepPBs(sessions);
  const stepStats = computeStepStats(sessions);
  const activeSteps = steps.filter((s) => s.isActive);
  const knownSecretNames = new Set((storedSecrets ?? []).map((s) => s.name));

  // === Routine header handlers ===
  const saveHeader = async () => {
    if (!headerForm) return;
    const name = headerForm.name.trim();
    if (!name) {
      setHeaderForm({ ...headerForm, name: routine.name });
      return;
    }
    if (name !== routine.name || headerForm.description.trim() !== routine.description) {
      await db.routines.update(routine.id, { name, description: headerForm.description.trim() });
    }
  };

  const saveSchedule = (schedule: RoutineSchedule) =>
    db.routines.update(routine.id, { schedule });

  const handleAnchorChange = (anchor: RoutineScheduleAnchor) => {
    if (anchor === routine.schedule.anchor) return;
    void saveSchedule(blankSchedule(anchor));
  };

  const handleDeadlineChange = (deadlineHHMM: string) => {
    if (routine.schedule.anchor !== 'time') return;
    void saveSchedule({ ...routine.schedule, deadlineHHMM });
  };

  const handleToggleDay = (day: number) => {
    if (routine.schedule.anchor !== 'time') return;
    const days = routine.schedule.daysOfWeek.includes(day)
      ? routine.schedule.daysOfWeek.filter((d) => d !== day)
      : [...routine.schedule.daysOfWeek, day].sort((a, b) => a - b);
    void saveSchedule({ ...routine.schedule, daysOfWeek: days });
  };

  // === Step handlers ===
  const handleAddStep = async () => {
    const name = stepForm.name.trim();
    if (!name) return;
    const maxSort = steps.length > 0 ? Math.max(...steps.map((s) => s.sortOrder)) : 0;
    const newStep: RoutineStep = {
      id: crypto.randomUUID(),
      routineId,
      name,
      description: stepForm.description.trim(),
      secretNames: [],
      sortOrder: maxSort + 1,
      isActive: true,
      createdAt: Date.now(),
    };
    // Insert the step AND append its id to every variant's stepIds so new steps
    // are visible by default everywhere.
    await db.transaction('rw', db.routineSteps, db.routineVariants, async () => {
      await db.routineSteps.add(newStep);
      for (const v of variants) {
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
    setEditStep({ name: step.name, description: step.description, secretNames: [...step.secretNames] });
    setNewSecretName('');
  };

  const saveStepEdit = async () => {
    if (!editingStepId || !editStep.name.trim()) return;
    await db.routineSteps.update(editingStepId, {
      name: editStep.name.trim(),
      description: editStep.description.trim(),
      secretNames: editStep.secretNames,
    });
    setEditingStepId(null);
  };

  const addSecretToStep = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || editStep.secretNames.includes(trimmed)) return;
    setEditStep({ ...editStep, secretNames: [...editStep.secretNames, trimmed] });
    setNewSecretName('');
  };

  const removeSecretFromStep = (name: string) =>
    setEditStep({ ...editStep, secretNames: editStep.secretNames.filter((n) => n !== name) });

  const handleDeleteStep = async (id: string) => {
    if (!window.confirm('Delete this step? It will be removed from all variants.')) return;
    // Historical sessions intentionally untouched — they store snapshots.
    await db.transaction('rw', db.routineSteps, db.routineVariants, async () => {
      await db.routineSteps.delete(id);
      for (const v of variants) {
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
      routineId,
      name,
      description: variantForm.description.trim(),
      stepIds: activeSteps.map((s) => s.id),
      isDefault: variants.length === 0,
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
      for (const v of variants) {
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

  const schedule = routine.schedule;

  return (
    <div>
      <div className="page-header">
        <Link to={ROUTINES_SETTINGS_PATH} className="text-accent" style={{ textDecoration: 'none', fontSize: 14 }}>
          &lsaquo; Routines
        </Link>
        <h1>{routine.name}</h1>
        <p className="subtitle">{describeSchedule(schedule)}</p>
      </div>

      {/* === Section 0: Routine === */}
      <div className="card">
        <div className="card-title">Routine</div>
        <div className="form-group">
          <label className="form-label">Name</label>
          <input
            className="form-input"
            value={headerForm?.name ?? routine.name}
            onChange={(e) => setHeaderForm({ name: e.target.value, description: headerForm?.description ?? routine.description })}
            onBlur={saveHeader}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Description (optional)</label>
          <textarea
            className="form-input"
            rows={2}
            value={headerForm?.description ?? routine.description}
            onChange={(e) => setHeaderForm({ name: headerForm?.name ?? routine.name, description: e.target.value })}
            onBlur={saveHeader}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Start-by countdown</label>
          <div className="flex gap-8 mb-8" style={{ flexWrap: 'wrap' }}>
            {(['bedtime', 'time', 'none'] as RoutineScheduleAnchor[]).map((anchor) => (
              <button
                key={anchor}
                type="button"
                className={`routine-variant-chip${schedule.anchor === anchor ? ' active' : ''}`}
                onClick={() => handleAnchorChange(anchor)}
              >
                {anchor === 'bedtime' ? 'Target bedtime' : anchor === 'time' ? 'Fixed time' : 'No deadline'}
              </button>
            ))}
          </div>
          {schedule.anchor === 'bedtime' && (
            <div className="text-secondary text-sm">
              Counts back from tonight’s target bedtime (alarm schedule minus 7.5 h) using your
              average routine length plus a buffer.
            </div>
          )}
          {schedule.anchor === 'time' && (
            <>
              <div className="flex gap-8" style={{ alignItems: 'center' }}>
                <span className="text-secondary text-sm">Finish by</span>
                <input
                  className="form-input"
                  type="time"
                  value={schedule.deadlineHHMM}
                  onChange={(e) => handleDeadlineChange(e.target.value)}
                  style={{ maxWidth: 140 }}
                />
              </div>
              <div className="text-secondary text-sm mt-8">On these days (none selected = every day):</div>
              <div className="flex gap-8 mt-8" style={{ flexWrap: 'wrap' }}>
                {DAY_NAMES.map((day, i) => (
                  <button
                    key={day}
                    type="button"
                    className={`routine-variant-chip${schedule.daysOfWeek.includes(i) ? ' active' : ''}`}
                    onClick={() => handleToggleDay(i)}
                  >
                    {day.slice(0, 3)}
                  </button>
                ))}
              </div>
            </>
          )}
          {schedule.anchor === 'none' && (
            <div className="text-secondary text-sm">
              The tracker still times every step and keeps personal bests; there is just no
              recommended start time.
            </div>
          )}
        </div>
        <Link to={trackerPathFor(routine.id)} className="btn btn-secondary btn-full">Open tracker</Link>
      </div>

      {/* === Section 1: Steps === */}
      <div className="card">
        <div className="card-title">Steps</div>
        {subLabel('Tap a step to edit its name, instructions and passwords.')}

        {steps.length === 0 ? (
          <div className="text-secondary text-sm" style={{ padding: '8px 0' }}>No steps yet. Add your first step below.</div>
        ) : steps.map((step, idx) => {
          const pbMs = pbs.get(step.id) ?? null;
          const isFirst = idx === 0;
          const isLast = idx === steps.length - 1;
          if (editingStepId === step.id) {
            return (
              <div key={step.id} className="card" style={{ padding: 12, marginBottom: 8 }}>
                <div className="form-group">
                  <label className="form-label">Step name</label>
                  <input
                    className="form-input"
                    value={editStep.name}
                    onChange={(e) => setEditStep({ ...editStep, name: e.target.value })}
                    autoFocus
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Instructions (shown while the step runs)</label>
                  <textarea
                    className="form-input"
                    rows={5}
                    value={editStep.description}
                    onChange={(e) => setEditStep({ ...editStep, description: e.target.value })}
                    placeholder="What to do, where things are, gotchas"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Passwords this step needs</label>
                  {editStep.secretNames.length === 0 && (
                    <div className="text-secondary text-sm mb-8">None.</div>
                  )}
                  {editStep.secretNames.map((name) => (
                    <div key={name} className="flex gap-8 mb-8" style={{ alignItems: 'center' }}>
                      <span style={{ flex: 1 }}>
                        {name}
                        {!knownSecretNames.has(name) && (
                          <span className="text-secondary text-sm"> — not stored yet</span>
                        )}
                      </span>
                      <button className="routine-reorder-btn" onClick={() => removeSecretFromStep(name)} aria-label={`Remove ${name}`}>&times;</button>
                    </div>
                  ))}
                  <div className="flex gap-8" style={{ alignItems: 'center' }}>
                    <input
                      className="form-input"
                      list={`secret-names-${step.id}`}
                      value={newSecretName}
                      onChange={(e) => setNewSecretName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); addSecretToStep(newSecretName); }
                      }}
                      placeholder="e.g. Cased iPad password"
                    />
                    <datalist id={`secret-names-${step.id}`}>
                      {(storedSecrets ?? []).map((s) => <option key={s.name} value={s.name} />)}
                    </datalist>
                    <button className="btn btn-secondary btn-sm" onClick={() => addSecretToStep(newSecretName)}>Add</button>
                  </div>
                  <div className="text-secondary text-sm mt-8">
                    Values live in the <Link to={VAULT_SETTINGS_PATH}>vault</Link>; the step only references them by name.
                  </div>
                </div>
                <div className="flex gap-8">
                  <button className="btn btn-primary btn-sm" onClick={saveStepEdit}>Save</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditingStepId(null)}>Cancel</button>
                </div>
              </div>
            );
          }
          return (
            <div key={step.id} className="routine-step-row" style={{ opacity: step.isActive ? 1 : 0.5 }}>
              <span className="routine-step-name" style={{ cursor: 'pointer' }} onClick={() => startEditStep(step)}>
                {step.name}
                {step.secretNames.length > 0 && (
                  <span className="text-secondary text-sm" title={step.secretNames.join(', ')}> 🔑</span>
                )}
              </span>
              <span className="routine-step-time" style={{ fontSize: 13, minWidth: 0, flexShrink: 0 }}>PB {formatTotal(pbMs)}</span>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                <button className="routine-reorder-btn" onClick={() => handleMoveStep(step.id, 'up')} disabled={isFirst} aria-label="Move up">&uarr;</button>
                <button className="routine-reorder-btn" onClick={() => handleMoveStep(step.id, 'down')} disabled={isLast} aria-label="Move down">&darr;</button>
                <button className="routine-reorder-btn" onClick={() => handleDeleteStep(step.id)} aria-label="Delete step">&times;</button>
                <label className="switch">
                  <input type="checkbox" checked={step.isActive} onChange={() => handleToggleStepActive(step.id, step.isActive)} />
                  <span className="switch-slider" />
                </label>
              </div>
            </div>
          );
        })}

        {showAddStep ? renderNameDescForm(
          stepForm,
          setStepForm,
          handleAddStep,
          () => { setShowAddStep(false); setStepForm(emptyForm); },
          'e.g. Brush teeth',
          'Optional instructions for this step',
          'Step Name',
        ) : (
          <button className="btn btn-primary btn-sm mt-8" onClick={() => setShowAddStep(true)}>Add Step</button>
        )}
      </div>

      {/* === Section 2: Variants === */}
      <div className="card">
        <div className="card-title">Variants</div>
        {subLabel('Named subsets of steps — pick which variant to run each time.')}

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
