// mill.ts (mw-cb24ai.6) — the ONE client of the mill (bsv-kit/grist) in Night Stack: it sends a form-talk grist and waits for the answer.
// Night Stack has no licence and holds no key of its own yet, so WHERE the door's key comes from, and who pays for the tutor, is not decided
// here. Until an app sets a source with setMillSource, there is no mill: no grist is sent, and no 'Let the tutor do it' button is drawn.
import type { door } from 'bsv-kit/bsv';

type Door = InstanceType<typeof door.Door>;

/** Which grind answers: grinds/form-talk.json. */
export const FORM_TALK = { app: 'night-stack', kind: 'form-talk', v: '1' } as const;

/** How often an unanswered grist is paged for while the tutor is asked a question (the kit's own default is 20 s). */
export const MILL_POLL_MS = 3000;

/** Where to send: the backend's door and the app's key. */
export interface MillConnection {
  door: Door;
  key: Uint8Array;
  /** the pinned mill key; asked of GET /api/me when absent */
  mill?: string;
  /** milliseconds between pages while waiting; MILL_POLL_MS when absent */
  intervalMs?: number;
}

/** The mill answered the grist 'refused' or 'failed'. */
export class MillRefusedError extends Error {
  readonly status: 'refused' | 'failed';
  constructor(status: 'refused' | 'failed', reason: string | undefined) {
    super(reason || (status === 'refused' ? 'The mill refused the question.' : 'The mill could not answer the question.'));
    this.name = 'MillRefusedError';
    this.status = status;
  }
}

let source: (() => MillConnection | null) | null = null;

/** Says where the mill is (or, with null, that there is none). The app calls this once it has a key; tests call it with a fake. */
export function setMillSource(next: (() => MillConnection | null) | null): void {
  source = next;
}

/** The mill to send to, or null when no source is set or it holds no key: then nothing leaves the phone. */
export function currentMill(): MillConnection | null {
  return source ? source() : null;
}

/** Sends `input` as a form-talk grist and resolves with the answer the mill sealed to it, in the grind's own schema. Rejects with
 * MillRefusedError when the mill refuses or fails it, and with the kit's AbortError when `signal` aborts. */
export async function askMill(conn: MillConnection, input: unknown, signal?: AbortSignal): Promise<unknown> {
  // loaded when the tutor is first asked, so the BSV SDK behind it is not part of the app's first load
  const { grist } = await import('bsv-kit/grist');
  const txid = await grist.sendGrist({ door: conn.door, key: conn.key, ...FORM_TALK, input, ...(conn.mill ? { mill: conn.mill } : {}) });
  const answered = await grist.awaitAnswer(txid, {
    door: conn.door,
    key: conn.key,
    intervalMs: conn.intervalMs ?? MILL_POLL_MS,
    ...(conn.mill ? { mill: conn.mill } : {}),
    ...(signal ? { signal } : {}),
  });
  if (answered.status !== 'answered') throw new MillRefusedError(answered.status, answered.reason);
  return answered.answer;
}
