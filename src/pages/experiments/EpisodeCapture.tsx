import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { EcgVerdict, RhythmFelt, SleepPosition, WakeUpEvent } from '../../types';
import { attachEpisode, updateEpisode } from '../../services/episodes';
import {
  clearEpisodeDraft,
  loadEpisodeDraft,
  saveEpisodeDraft,
  type EpisodeDraft,
} from './episodeDraftStorage';
import { formatTime12h, timestampToHHMM } from '../../utils';

/**
 * The 4am flow (specs/home-experiments/episode-capture.md, Q7).
 *
 * Step 0 is one giant button. The first tap persists the episode BEFORE
 * any follow-up renders, then writes a draft so a killed app resumes on
 * the same event. Every follow-up is one question, one screen, big
 * targets, skippable, and saved on tap. Settle time and back-to-sleep are
 * asked in the morning, not here. Forced dark regardless of theme.
 */

const FOLLOW_UP_COUNT = 5;

type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export function EpisodeCapture() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<EpisodeDraft | null>(() => loadEpisodeDraft());
  const [saving, setSaving] = useState(false);
  const [bp, setBp] = useState({ systolic: '', diastolic: '', pulse: '' });

  const step: Step = draft ? (Math.min(Math.max(draft.step, 1), 6) as Step) : 0;

  async function handleEpisodeNow() {
    if (saving) return;
    setSaving(true);
    try {
      const now = Date.now();
      const res = await attachEpisode(now);
      const next: EpisodeDraft = {
        nightDate: res.nightDate,
        nightLogId: res.nightLogId,
        eventId: res.eventId,
        step: 1,
        startedAt: now,
      };
      saveEpisodeDraft(next);
      setDraft(next);
      try {
        navigator.vibrate?.(50);
      } catch {
        // not supported
      }
    } finally {
      setSaving(false);
    }
  }

  function advance() {
    if (!draft) return;
    const next = { ...draft, step: draft.step + 1 };
    if (next.step > FOLLOW_UP_COUNT) {
      // Done for now: the morning log asks the rest. Draft stays until
      // the morning log is saved so "Finish episode details" can resume.
      next.step = 6;
    }
    saveEpisodeDraft(next);
    setDraft(next);
  }

  async function answer(patch: Partial<WakeUpEvent>) {
    if (!draft) return;
    await updateEpisode(draft.nightLogId, draft.eventId, patch);
    advance();
  }

  function finish() {
    clearEpisodeDraft();
    setDraft(null);
    navigate('/experiments');
  }

  const savedLabel = draft ? formatTime12h(timestampToHHMM(draft.startedAt)) : '';

  return (
    <div className="force-dark episode-page">
      {step === 0 && (
        <>
          <button
            type="button"
            className="episode-big-button"
            onClick={handleEpisodeNow}
            disabled={saving}
          >
            ⚡<br />Episode now
          </button>
          <p className="episode-hint">One tap saves the time. Everything else is optional.</p>
          <button type="button" className="btn btn-secondary btn-full mt-16" onClick={() => navigate('/experiments')}>
            Cancel
          </button>
        </>
      )}

      {step >= 1 && step <= 5 && (
        <div className="episode-saved">Saved {savedLabel}</div>
      )}

      {step === 1 && (
        <Question title="Position at wake?" onSkip={advance}>
          {(['side', 'back', 'unknown'] as SleepPosition[]).map((p) => (
            <BigChoice key={p} label={p === 'side' ? 'Side' : p === 'back' ? 'Back' : 'Unknown'} onClick={() => answer({ positionAtWake: p })} />
          ))}
        </Question>
      )}

      {step === 2 && (
        <Question title="ECG on the watch?" onSkip={advance}>
          <BigChoice label="Not taken" onClick={() => answer({ ecgTaken: false, ecgVerdict: 'not_taken' })} />
          {(['sinus', 'afib', 'inconclusive'] as EcgVerdict[]).map((v) => (
            <BigChoice
              key={v}
              label={v === 'sinus' ? 'Sinus rhythm' : v === 'afib' ? 'AFib' : 'Inconclusive'}
              onClick={() => answer({ ecgTaken: true, ecgVerdict: v })}
            />
          ))}
        </Question>
      )}

      {step === 3 && (
        <Question title="Rhythm as felt?" onSkip={advance}>
          {(['fast_regular', 'irregular', 'unsure'] as RhythmFelt[]).map((r) => (
            <BigChoice
              key={r}
              label={r === 'fast_regular' ? 'Fast, regular' : r === 'irregular' ? 'Irregular' : 'Unsure'}
              onClick={() => answer({ rhythmFelt: r })}
            />
          ))}
        </Question>
      )}

      {step === 4 && (
        <Question title="Lying BP, if a cuff is at hand" onSkip={advance}>
          <div className="episode-bp-row">
            {(['systolic', 'diastolic', 'pulse'] as const).map((k) => (
              <input
                key={k}
                type="number"
                inputMode="numeric"
                className="form-input episode-bp-input"
                placeholder={k === 'systolic' ? 'SYS' : k === 'diastolic' ? 'DIA' : 'PULSE'}
                aria-label={k}
                value={bp[k]}
                onChange={(e) => setBp({ ...bp, [k]: e.target.value })}
              />
            ))}
          </div>
          <BigChoice
            label="Save reading"
            disabled={!(bp.systolic && bp.diastolic && bp.pulse)}
            onClick={() =>
              answer({
                lyingBp: {
                  systolic: Number(bp.systolic),
                  diastolic: Number(bp.diastolic),
                  pulse: Number(bp.pulse),
                },
              })
            }
          />
        </Question>
      )}

      {step === 5 && (
        <Question title="Wired?" onSkip={advance}>
          <BigChoice label="Yes, wired" onClick={() => answer({ wired: true })} />
          <BigChoice label="No" onClick={() => answer({ wired: false })} />
        </Question>
      )}

      {step === 6 && (
        <div className="episode-question">
          <h2 className="episode-title">Done for now</h2>
          <p className="episode-hint">
            The morning log will ask how long it took to settle and whether you got back to sleep.
          </p>
          <BigChoice label="Back to sleep" onClick={finish} />
        </div>
      )}
    </div>
  );
}

function Question({ title, onSkip, children }: { title: string; onSkip: () => void; children: React.ReactNode }) {
  return (
    <div className="episode-question">
      <h2 className="episode-title">{title}</h2>
      <div className="episode-choices">{children}</div>
      <button type="button" className="episode-skip" onClick={onSkip}>
        Skip
      </button>
    </div>
  );
}

function BigChoice({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="episode-choice" onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
}

export default EpisodeCapture;
