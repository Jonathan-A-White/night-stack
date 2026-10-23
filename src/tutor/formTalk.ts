// formTalk.ts (mw-cb24ai.6) — one turn of the form talk: the page as the tutor sees it goes out, and what comes back is cut to what the page
// may take. The grind the door talks to is one function (GrindSend); the mill is its usual maker, and a test or an app sets another.
import { FORM_START, applyValues, oneQuestion, requestFields, type FormRequest, type FormSpec, type FormValue } from 'voice-kit/forms';
import { askMill, currentMill, type MillConnection } from './mill';

export { FORM_START };
/** What he is taken to have said when the tutor has finished a page and the door moves on to the next. */
export const FORM_NEXT = 'That page is done. Carry on with the next one.';

/** The talk so far, as the grind sees it. */
export interface TalkLine {
  role: 'tutor' | 'him';
  text: string;
}

/** grinds/form-talk.input.schema.json */
export interface FormTalkRequest {
  question: string;
  form: FormRequest;
  page?: { n: number; of: number };
  history: TalkLine[];
}

/** grinds/form-talk.answer.schema.json */
export interface FormTalkAnswer {
  answer: string;
  form_values?: FormValue[];
  form_ask?: string;
}

export type GrindSend = (request: FormTalkRequest, signal?: AbortSignal) => Promise<FormTalkAnswer>;

/** The longest talk sent with a question: the last turns only. */
export const HISTORY_TURNS = 8;

export interface Said {
  /** what the tutor says: the answer cut after its first question */
  say: string;
  /** the values it fills, those the page may take */
  fills: FormValue[];
  /** the field it asks about next, when the page has it */
  ask?: string;
}

export interface TutorTurn {
  send: GrindSend;
  page: FormSpec;
  pageNo: number;
  of: number;
  /** what the whole form holds now, by field name */
  values: Readonly<Record<string, string>>;
  question: string;
  history: readonly TalkLine[];
  /** the command the form's Send runs: told to the tutor so that it names the button */
  command?: string;
  signal?: AbortSignal;
}

/** Asks the tutor one question about one page and reads what it answers. */
export async function askTutor(turn: TutorTurn): Promise<Said> {
  const { send, page, values, command } = turn;
  const request: FormTalkRequest = {
    question: turn.question,
    form: { name: page.name, fields: requestFields(page, values), ...(command ? { command } : {}) },
    page: { n: turn.pageNo, of: turn.of },
    history: turn.history.slice(-HISTORY_TURNS).map((l) => ({ ...l })),
  };
  const answer = await send(request, turn.signal);
  const ask = typeof answer.form_ask === 'string' && page.fields.some((f) => f.name === answer.form_ask) ? answer.form_ask : undefined;
  return { say: oneQuestion(answer.answer), fills: applyValues(page, answer.form_values), ...(ask ? { ask } : {}) };
}

/** A grind over the mill: sends the request as a form-talk grist, and refuses an answer that is not one. */
export function millGrind(conn: MillConnection): GrindSend {
  return async (request, signal) => {
    const answer = await askMill(conn, request, signal);
    if (typeof answer !== 'object' || answer === null || typeof (answer as { answer?: unknown }).answer !== 'string') {
      throw new Error('The tutor sent back an answer the form talk cannot read.');
    }
    return answer as FormTalkAnswer;
  };
}

let override: GrindSend | null | undefined;

/** Sets the grind the doors talk to: a test's fake, or null for none. undefined puts back the usual one (over the mill). */
export function setFormGrind(grind: GrindSend | null | undefined): void {
  override = grind;
}

/** The grind a door talks to, or null when there is none (no mill is set): then no door is drawn. */
export function currentFormGrind(): GrindSend | null {
  if (override !== undefined) return override;
  const mill = currentMill();
  return mill ? millGrind(mill) : null;
}
