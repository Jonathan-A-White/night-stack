// FormDoor.tsx (mw-cb24ai.6) — 'Let the tutor do it': the button above a form and the panel it opens. The tutor asks one question at a time,
// page by page, and the answers fill the page's own fields (onFill). When every required field holds something the panel offers Send, which
// runs the form's own command through a registry (the same path the page's Save takes); the tutor never sends. The form is his, and so is Send.
import { useEffect, useMemo, useRef, useState } from 'react';
import { argsOf, requiredFilled, type FormSpec, type FormValue } from 'voice-kit/forms';
import { defineRegistry, type Command } from 'voice-kit/talks';
import { FORM_NEXT, FORM_START, askTutor, currentFormGrind, type TalkLine } from './formTalk';

export interface FormDoorProps {
  /** the form in pages of at most 8 fields, in screen order; the door walks them one at a time */
  pages: readonly FormSpec[];
  /** what the whole form holds now, by field name */
  values: Readonly<Record<string, string>>;
  /** the form's command: Send runs it with the form's values */
  command: Command;
  /** puts what the tutor filled into the form's fields */
  onFill(fills: FormValue[]): void;
  /** the Send button's label; 'Send' unless the form's own button says otherwise */
  sendLabel?: string;
}

type Turn = { pageIdx: number; question: string; history: TalkLine[] };

const messageOf = (error: unknown): string => (error instanceof Error && error.message ? error.message : 'The tutor could not be reached.');

export function FormDoor({ pages, values, command, onFill, sendLabel = 'Send' }: FormDoorProps) {
  const grind = currentFormGrind();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<TalkLine[]>([]);
  const [pageIdx, setPageIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sentSaid, setSentSaid] = useState('');
  const [failedTurn, setFailedTurn] = useState<Turn | null>(null);
  const [draft, setDraft] = useState('');

  // the latest props, for the turns that outlast the render they began in
  const valuesRef = useRef(values);
  const pagesRef = useRef(pages);
  const onFillRef = useRef(onFill);
  useEffect(() => {
    valuesRef.current = values;
    pagesRef.current = pages;
    onFillRef.current = onFill;
  });
  const linesRef = useRef<TalkLine[]>([]);
  const lastTurn = useRef<Turn | null>(null);
  const abort = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      abort.current?.abort();
    };
  }, []);

  const all: FormSpec = useMemo(() => ({ name: command.name, fields: pages.flatMap((p) => p.fields) }), [pages, command.name]);
  const registry = useMemo(() => defineRegistry({ commands: [command] }), [command]);

  if (!grind) return null;

  const say = (line: TalkLine) => {
    linesRef.current = [...linesRef.current, line];
    setLines(linesRef.current);
  };

  /** One turn, and the turns after it while the tutor has finished a page and there is another. */
  async function talk(first: Turn) {
    const send = currentFormGrind();
    if (!send) return;
    abort.current?.abort();
    const stop = new AbortController();
    abort.current = stop;
    setBusy(true);
    setError('');
    setFailedTurn(null);
    let turn: Turn | null = first;
    try {
      while (turn) {
        lastTurn.current = turn;
        const page = pagesRef.current[turn.pageIdx];
        if (!page) break;
        const said = await askTutor({
          send,
          page,
          pageNo: turn.pageIdx + 1,
          of: pagesRef.current.length,
          values: valuesRef.current,
          question: turn.question,
          history: turn.history,
          command: command.name,
          signal: stop.signal,
        });
        if (!alive.current || stop.signal.aborted) return;
        if (said.fills.length) {
          valuesRef.current = { ...valuesRef.current, ...Object.fromEntries(said.fills.map((f) => [f.field, f.value])) };
          onFillRef.current(said.fills);
        }
        say({ role: 'tutor', text: said.say });
        const last = pagesRef.current.length - 1;
        if (said.ask || turn.pageIdx >= last) {
          turn = null;
        } else {
          setPageIdx(turn.pageIdx + 1);
          turn = { pageIdx: turn.pageIdx + 1, question: FORM_NEXT, history: [...linesRef.current] };
        }
      }
    } catch (e) {
      if (alive.current && !stop.signal.aborted) {
        setError(messageOf(e));
        setFailedTurn(lastTurn.current);
      }
    } finally {
      if (alive.current && abort.current === stop) setBusy(false);
    }
  }

  const start = () => {
    linesRef.current = [];
    setLines([]);
    setPageIdx(0);
    setSentSaid('');
    setDraft('');
    setOpen(true);
    void talk({ pageIdx: 0, question: FORM_START, history: [] });
  };

  const reply = () => {
    const text = draft.trim();
    if (!text || busy) return;
    const history = [...linesRef.current];
    say({ role: 'him', text });
    setDraft('');
    void talk({ pageIdx, question: text, history });
  };

  const stop = () => {
    abort.current?.abort();
    setBusy(false);
    setOpen(false);
  };

  const send = async () => {
    setError('');
    const result = await registry.run(command.name, argsOf(all, valuesRef.current));
    if (!alive.current) return;
    if (result.ok) setSentSaid(result.said);
    else setError(result.why);
  };

  if (!open) {
    return (
      <button type="button" className="btn btn-secondary btn-full mb-8" onClick={start}>
        Let the tutor do it
      </button>
    );
  }

  const ready = requiredFilled(all, values);
  const args = argsOf(all, values);
  const offer = command.offer?.(args) ?? '';

  return (
    <div className="card" data-testid="form-door">
      <div className="card-title">Tutor</div>
      <div aria-live="polite">
        {lines.map((l, i) => (
          <p key={i} className={l.role === 'tutor' ? 'fw-600' : 'text-secondary'}>
            {l.text}
          </p>
        ))}
      </div>
      {busy && <p className="text-secondary text-sm">Thinking…</p>}
      {error && (
        <div role="alert" className="banner banner-danger mb-8">
          {error}
          {failedTurn && !busy && !sentSaid && (
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => void talk(failedTurn)}>
              Try again
            </button>
          )}
        </div>
      )}
      {sentSaid ? (
        <p role="status" className="text-success">
          {sentSaid}
        </p>
      ) : (
        <>
          {ready && (
            <div className="mb-8">
              <p className="text-secondary text-sm">Everything required is filled in. Read the form, change anything, then tap {sendLabel} yourself.</p>
              {offer && <p>{offer}</p>}
              <button type="button" className="btn btn-primary btn-full" onClick={() => void send()}>
                {sendLabel}
              </button>
            </div>
          )}
          <div className="form-group">
            <input
              type="text"
              className="form-input"
              aria-label="Your answer"
              placeholder="Your answer"
              value={draft}
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') reply();
              }}
            />
          </div>
          <div className="flex gap-8">
            <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={reply} disabled={busy || !draft.trim()}>
              Reply
            </button>
            <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={stop}>
              Stop
            </button>
          </div>
        </>
      )}
    </div>
  );
}
