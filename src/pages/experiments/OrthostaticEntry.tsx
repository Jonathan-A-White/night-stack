import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import type { BpPoint, OrthostaticSlot, VitalsSource } from '../../types';
import { getTodayDate } from '../../utils';
import {
  STAGE_DURATIONS_MS,
  getReading,
  saveReading,
  stageRemainingMs,
} from '../../services/orthostatic';
import {
  clearVitalsDraft,
  loadVitalsDraft,
  saveVitalsDraft,
  type VitalsDraft,
  type VitalsStage,
} from './vitalsDraftStorage';

/**
 * Orthostatic entry (vitals.md, Q2): a coached flow with skippable clock-
 * based timers, or a direct six-field form. One reading per (date, slot);
 * re-entering the same slot edits it.
 */

type Mode = 'choose' | 'direct' | 'coached';

interface Fields {
  systolic: string;
  diastolic: string;
  pulse: string;
}

const EMPTY: Fields = { systolic: '', diastolic: '', pulse: '' };

function toFields(p: BpPoint | null): Fields {
  return p ? { systolic: String(p.systolic), diastolic: String(p.diastolic), pulse: String(p.pulse) } : EMPTY;
}

function toPoint(f: Fields): BpPoint | null {
  if (!f.systolic || !f.diastolic || !f.pulse) return null;
  const p = { systolic: Number(f.systolic), diastolic: Number(f.diastolic), pulse: Number(f.pulse) };
  return Number.isFinite(p.systolic) && Number.isFinite(p.diastolic) && Number.isFinite(p.pulse) ? p : null;
}

const STAGE_ORDER: VitalsStage[] = ['supine', 'standing1', 'standing3'];
const STAGE_TITLE: Record<VitalsStage, string> = {
  supine: 'Lie down',
  standing1: 'Standing — 1 min',
  standing3: 'Standing — 3 min',
};
const STAGE_HINT: Record<VitalsStage, string> = {
  supine: 'Rest flat for 5 minutes, then take the reading.',
  standing1: 'Stand up. Take the reading when the timer ends.',
  standing3: 'Stay standing. Take the final reading when the timer ends.',
};
const STAGE_LABEL: Record<VitalsStage, string> = {
  supine: 'Supine',
  standing1: 'Standing 1 min',
  standing3: 'Standing 3 min',
};

export function OrthostaticEntry() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const slot: OrthostaticSlot = params.get('slot') === 'pm' ? 'pm' : 'am';
  const date = params.get('date') ?? getTodayDate();

  const existing = useLiveQuery(() => getReading(date, slot), [date, slot]);
  const settings = useLiveQuery(() => db.appSettings.get('default'));

  const [draft, setDraft] = useState<VitalsDraft | null>(() => loadVitalsDraft(date, slot));
  const [mode, setMode] = useState<Mode>(() => (loadVitalsDraft(date, slot) ? 'coached' : 'choose'));

  // Direct-form state (prefilled from an existing reading once it loads).
  const [supine, setSupine] = useState<Fields>(EMPTY);
  const [standing1, setStanding1] = useState<Fields>(EMPTY);
  const [standing3, setStanding3] = useState<Fields>(EMPTY);
  const [source, setSource] = useState<VitalsSource>('cuff');
  const [notes, setNotes] = useState('');
  const [prefilled, setPrefilled] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (existing && !prefilled) {
      setSupine(toFields(existing.supine));
      setStanding1(toFields(existing.standing1));
      setStanding3(toFields(existing.standing3));
      setSource(existing.source);
      setNotes(existing.notes);
      setPrefilled(true);
    }
  }, [existing, prefilled]);

  // Coached stage inputs.
  const [stageFields, setStageFields] = useState<Fields>(EMPTY);
  const [, tick] = useState(0);
  useEffect(() => {
    if (mode !== 'coached') return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [mode]);

  function startCoached() {
    const d: VitalsDraft = {
      date,
      slot,
      stage: 'supine',
      stageStartedAt: Date.now(),
      inputsRevealed: false,
      supine: null,
      standing1: null,
      standing3: null,
      source: existing?.source ?? 'cuff',
      notes: existing?.notes ?? '',
    };
    saveVitalsDraft(d);
    setDraft(d);
    setStageFields(EMPTY);
    setMode('coached');
  }

  function updateDraft(patch: Partial<VitalsDraft>) {
    if (!draft) return;
    const next = { ...draft, ...patch };
    saveVitalsDraft(next);
    setDraft(next);
  }

  function nextStage(current: VitalsStage, point: BpPoint | null) {
    if (!draft) return;
    const idx = STAGE_ORDER.indexOf(current);
    const patch: Partial<VitalsDraft> = { [current]: point };
    if (idx < STAGE_ORDER.length - 1) {
      updateDraft({ ...patch, stage: STAGE_ORDER[idx + 1], stageStartedAt: Date.now(), inputsRevealed: false });
      setStageFields(EMPTY);
    } else {
      updateDraft(patch);
      void persist({ ...draft, ...patch } as VitalsDraft);
    }
  }

  async function persist(d: VitalsDraft) {
    if (!d.supine) {
      setError('The supine reading is required.');
      return;
    }
    await saveReading({
      date: d.date,
      slot: d.slot,
      timestamp: d.stageStartedAt,
      source: d.source,
      supine: d.supine,
      standing1: d.standing1,
      standing3: d.standing3,
      notes: d.notes,
    });
    clearVitalsDraft(d.date, d.slot);
    navigate('/experiments/vitals');
  }

  async function saveDirect() {
    const s = toPoint(supine);
    if (!s) {
      setError('Enter the supine systolic, diastolic and pulse.');
      return;
    }
    setError('');
    await saveReading({
      date,
      slot,
      timestamp: existing?.timestamp ?? Date.now(),
      source,
      supine: s,
      standing1: toPoint(standing1),
      standing3: toPoint(standing3),
      notes,
    });
    clearVitalsDraft(date, slot);
    navigate('/experiments/vitals');
  }

  const header = (
    <div className="page-header">
      <button className="btn btn-secondary btn-sm mb-8" onClick={() => navigate('/experiments/vitals')}>
        ← Vitals
      </button>
      <h1>{slot === 'am' ? 'AM' : 'PM'} orthostatic reading</h1>
      <p className="subtitle">{date}</p>
    </div>
  );

  if (mode === 'choose') {
    return (
      <div>
        {header}
        {existing && (
          <div className="banner banner-success mb-16">A reading for this slot already exists. You can edit it.</div>
        )}
        <button type="button" className="btn btn-primary btn-full mb-8" style={{ minHeight: 64 }} onClick={startCoached}>
          Start coached reading
        </button>
        <button type="button" className="btn btn-secondary btn-full" style={{ minHeight: 64 }} onClick={() => setMode('direct')}>
          Just enter numbers
        </button>
        <p className="text-secondary text-sm mt-16">
          Coached: 5 minutes lying down, then readings at 1 and 3 minutes standing. Every timer can be skipped.
        </p>
      </div>
    );
  }

  if (mode === 'direct') {
    return (
      <div>
        {header}
        <BpFields label="Supine" fields={supine} onChange={setSupine} />
        <BpFields label="Standing 1 min" fields={standing1} onChange={setStanding1} />
        <BpFields label="Standing 3 min" fields={standing3} onChange={setStanding3} />
        <SourcePicker value={source} onChange={setSource} calibratedAt={settings?.watchBpCalibratedAt ?? null} />
        <div className="form-group">
          <label className="form-label" htmlFor="ortho-notes">Notes</label>
          <input id="ortho-notes" className="form-input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {error && <div className="banner banner-danger mb-8">{error}</div>}
        <button type="button" className="btn btn-primary btn-full" style={{ minHeight: 56 }} onClick={saveDirect}>
          Save
        </button>
      </div>
    );
  }

  // Coached mode.
  if (!draft) {
    setMode('choose');
    return null;
  }
  const stage = draft.stage;
  const remaining = stageRemainingMs(draft.stageStartedAt, STAGE_DURATIONS_MS[stage], Date.now());
  const revealed = draft.inputsRevealed || remaining === 0;
  const mm = Math.floor(remaining / 60_000);
  const ss = Math.floor((remaining % 60_000) / 1000);
  const isLast = stage === 'standing3';
  const advanceLabel = stage === 'supine' ? 'Stand up' : isLast ? 'Save' : 'Next';
  const point = toPoint(stageFields);

  return (
    <div>
      {header}
      <div className="card" style={{ textAlign: 'center' }}>
        <div className="card-title">{STAGE_TITLE[stage]}</div>
        <p className="text-secondary text-sm mb-8">{STAGE_HINT[stage]}</p>
        {!revealed ? (
          <>
            <div style={{ fontSize: 56, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {mm}:{ss.toString().padStart(2, '0')}
            </div>
            <button type="button" className="btn btn-secondary btn-full mt-16" style={{ minHeight: 56 }} onClick={() => updateDraft({ inputsRevealed: true })}>
              Skip timer
            </button>
          </>
        ) : (
          <>
            <BpFields label={STAGE_LABEL[stage]} fields={stageFields} onChange={setStageFields} autoFocus />
            {isLast && (
              <SourcePicker value={draft.source} onChange={(s) => updateDraft({ source: s })} calibratedAt={settings?.watchBpCalibratedAt ?? null} />
            )}
            {error && <div className="banner banner-danger mb-8">{error}</div>}
            <button
              type="button"
              className="btn btn-primary btn-full"
              style={{ minHeight: 56 }}
              disabled={!point}
              onClick={() => nextStage(stage, point)}
            >
              {advanceLabel}
            </button>
            {stage !== 'supine' && (
              <button type="button" className="btn btn-secondary btn-full mt-8" style={{ minHeight: 48 }} onClick={() => nextStage(stage, null)}>
                Skip this reading
              </button>
            )}
          </>
        )}
      </div>
      <button
        type="button"
        className="btn btn-secondary btn-full"
        onClick={() => {
          clearVitalsDraft(date, slot);
          setDraft(null);
          setMode('choose');
        }}
      >
        Cancel
      </button>
    </div>
  );
}

function BpFields({
  label,
  fields,
  onChange,
  autoFocus,
}: {
  label: string;
  fields: Fields;
  onChange: (f: Fields) => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="form-group">
      <div className="form-label">{label}</div>
      <div className="flex gap-8">
        {(['systolic', 'diastolic', 'pulse'] as const).map((k, i) => (
          <input
            key={k}
            type="number"
            inputMode="numeric"
            className="form-input"
            style={{ textAlign: 'center' }}
            aria-label={`${label} ${k}`}
            placeholder={k === 'systolic' ? 'SYS' : k === 'diastolic' ? 'DIA' : 'PULSE'}
            value={fields[k]}
            autoFocus={autoFocus && i === 0}
            onChange={(e) => onChange({ ...fields, [k]: e.target.value })}
          />
        ))}
      </div>
    </div>
  );
}

function SourcePicker({
  value,
  onChange,
  calibratedAt,
}: {
  value: VitalsSource;
  onChange: (v: VitalsSource) => void;
  calibratedAt: number | null;
}) {
  const staleWatch =
    value === 'watch' &&
    (calibratedAt === null || Date.now() - calibratedAt > 28 * 24 * 60 * 60 * 1000);
  return (
    <div className="form-group">
      <div className="form-label">Source</div>
      <div className="toggle-grid">
        <button type="button" className={`toggle-btn${value === 'cuff' ? ' active' : ''}`} aria-pressed={value === 'cuff'} onClick={() => onChange('cuff')}>
          Cuff
        </button>
        <button type="button" className={`toggle-btn${value === 'watch' ? ' active' : ''}`} aria-pressed={value === 'watch'} onClick={() => onChange('watch')}>
          Watch
        </button>
      </div>
      {staleWatch && (
        <div className="text-warning text-sm mt-8">
          Watch BP is more than 28 days from its last cuff calibration — recalibrate soon.
        </div>
      )}
    </div>
  );
}

export default OrthostaticEntry;
