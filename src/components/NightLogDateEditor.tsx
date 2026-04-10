import { useState } from 'react';
import { db } from '../db';
import type { NightLog } from '../types';

interface NightLogDateEditorProps {
  nightLog: NightLog;
}

/**
 * Inline editor for a night log's `date`. Shown on both review pages so users
 * can re-file a mis-dated entry — e.g. when a past app-date bug wrote two
 * different nights under the same date, or when a backfill landed on the
 * wrong day. Updating the date does not affect the entry's `id`, so links
 * and linked weight entries stay intact.
 */
export function NightLogDateEditor({ nightLog }: NightLogDateEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(nightLog.date);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!draft) {
      setError('Pick a date');
      return;
    }
    if (draft === nightLog.date) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await db.nightLogs.update(nightLog.id, {
        date: draft,
        updatedAt: Date.now(),
      });
      // Also re-file any weight entries linked to this night so the calendar
      // and per-day views keep them in the right bucket.
      await db.weightEntries
        .where('nightLogId')
        .equals(nightLog.id)
        .modify({ date: draft });
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setDraft(nightLog.date);
    setError(null);
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="card">
        <div className="summary-row">
          <div>
            <div className="fw-600">Log date</div>
            <div className="text-secondary text-sm">{nightLog.date}</div>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setEditing(true)}
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="fw-600 mb-8">Change log date</div>
      <p className="text-secondary text-sm mb-8">
        Re-file this night log under a different date. Useful when a past entry
        was assigned the wrong night.
      </p>
      <input
        type="date"
        className="input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={saving}
      />
      {error && (
        <div className="text-danger text-sm mt-8">{error}</div>
      )}
      <div className="flex gap-8 mt-16">
        <button
          className="btn btn-secondary"
          onClick={cancel}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          className="btn btn-primary"
          onClick={save}
          disabled={saving || !draft || draft === nightLog.date}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
