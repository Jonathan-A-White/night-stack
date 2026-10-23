import { afterEach, describe, expect, it } from 'vitest';
import { door } from 'bsv-kit/bsv';
import { grist } from 'bsv-kit/grist';
import { MILL_KEY, fakePostern } from 'bsv-kit/testing';
import { FORM_TALK, MillRefusedError, askMill, currentMill, setMillSource, type MillConnection } from './mill';

const TXID = 'direct:' + 'a'.repeat(64);

function connect() {
  const fake = fakePostern();
  fake.postResult = { txid: TXID, seq: 1 };
  const conn: MillConnection = { door: new door.Door({ baseUrl: fake.base, key: fake.appKey, fetch: fake.fetch }), key: fake.appKey, intervalMs: 1 };
  return { fake, conn };
}

/** the grist the fake saw posted, opened with the mill's key */
function postedGrist(fake: ReturnType<typeof fakePostern>) {
  const post = fake.seen.find((s) => s.method === 'POST' && s.path === '/messages');
  if (!post?.body) throw new Error('no grist was posted');
  const { scriptHex } = JSON.parse(new TextDecoder().decode(post.body)) as { scriptHex: string };
  const { envelope } = grist.readRecordScript(scriptHex);
  return JSON.parse(grist.openCt(envelope.ct, MILL_KEY)) as { grist: { app: string; kind: string; v: string }; input: unknown; attachments: unknown[] };
}

afterEach(() => setMillSource(null));

describe('the mill client', () => {
  it('posts a form-talk grist with the request as its input and reads the answer back', async () => {
    const { fake, conn } = connect();
    fake.onPoll = () => {
      fake.reply({ re: TXID, status: 'answered', answer: { answer: 'When did you go to sleep?', form_ask: 'sleepTime' }, grind: FORM_TALK });
    };
    const request = { question: 'Help me fill this in.', form: { name: 'Morning sleep data (1 of 3)', fields: [] } };
    const answer = await askMill(conn, request);
    expect(answer).toEqual({ answer: 'When did you go to sleep?', form_ask: 'sleepTime' });
    const sent = postedGrist(fake);
    expect(sent.grist).toEqual({ app: 'night-stack', kind: 'form-talk', v: '1' });
    expect(sent.input).toEqual(request);
    expect(sent.attachments).toEqual([]);
  });

  it('refuses with the mill\'s reason when the mill refuses or fails the grist', async () => {
    const { fake, conn } = connect();
    fake.onPoll = () => {
      fake.reply({ re: TXID, status: 'refused', reason: 'No licence', grind: FORM_TALK });
    };
    await expect(askMill(conn, { question: 'x' })).rejects.toThrow(MillRefusedError);
    await expect(askMill(conn, { question: 'x' })).rejects.toThrow('No licence');
  });

  it('stops waiting when the signal aborts', async () => {
    const { conn } = connect();
    const stop = new AbortController();
    const asked = askMill(conn, { question: 'x' }, stop.signal);
    setTimeout(() => stop.abort(), 20);
    await expect(asked).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('has no mill until an app says where it is: nothing leaves the phone by default', () => {
    expect(currentMill()).toBeNull();
    const { conn } = connect();
    setMillSource(() => conn);
    expect(currentMill()).toBe(conn);
    setMillSource(null);
    expect(currentMill()).toBeNull();
  });
});
