import { afterEach, describe, expect, it, vi } from 'vitest';
import grindJson from '../../grinds/form-talk.json?raw';
import grindInstructions from '../../grinds/form-talk.md?raw';
import kitFragment from '../../node_modules/voice-kit/packages/forms/grind/helping-with-a-form.md?raw';
import answerSchemaJson from '../../grinds/form-talk.answer.schema.json?raw';
import inputSchemaJson from '../../grinds/form-talk.input.schema.json?raw';
import firstQuestionJson from '../../grinds/examples/form-talk/morning-first-question.json?raw';
import fillsATimeJson from '../../grinds/examples/form-talk/evening-fills-a-time.json?raw';
import { door } from 'bsv-kit/bsv';
import { fakePostern } from 'bsv-kit/testing';
import { FORM_START, type FormSpec } from 'voice-kit/forms';
import { FORM_TALK, setMillSource } from './mill';
import { askTutor, currentFormGrind, millGrind, setFormGrind, type FormTalkAnswer, type FormTalkRequest, type GrindSend } from './formTalk';

const PAGE: FormSpec = {
  name: 'Evening log (1 of 2)',
  fields: [
    { name: 'lastMealTime', label: 'Last meal time', required: true, kind: 'text' },
    { name: 'fanSpeed', label: 'Fan speed', required: false, kind: 'choice', options: ['Off', 'Low', 'High'] },
  ],
};

afterEach(() => {
  setFormGrind(undefined);
  setMillSource(null);
});

describe('askTutor: one turn of the form talk', () => {
  it('sends the page as the tutor sees it, with the command, the place and the talk so far', async () => {
    const send = vi.fn<GrindSend>(async () => ({ answer: 'When did you eat last?', form_ask: 'lastMealTime' }));
    const said = await askTutor({
      send,
      page: PAGE,
      pageNo: 1,
      of: 2,
      values: { fanSpeed: 'Low' },
      question: FORM_START,
      history: [{ role: 'him', text: 'Hi' }],
      command: 'saveEveningLog',
    });
    expect(send).toHaveBeenCalledTimes(1);
    const request = send.mock.calls[0][0];
    expect(request.question).toBe(FORM_START);
    expect(request.page).toEqual({ n: 1, of: 2 });
    expect(request.history).toEqual([{ role: 'him', text: 'Hi' }]);
    expect(request.form.name).toBe('Evening log (1 of 2)');
    expect(request.form.command).toBe('saveEveningLog');
    expect(request.form.fields.map((f) => [f.name, f.value])).toEqual([['lastMealTime', ''], ['fanSpeed', 'Low']]);
    expect(said).toEqual({ say: 'When did you eat last?', fills: [], ask: 'lastMealTime' });
  });

  it('returns only the values the page may take, and the answer cut after its first question', async () => {
    const send = async (): Promise<FormTalkAnswer> => ({
      answer: 'Got it. What is the fan on? And the AC?',
      form_values: [
        { field: 'lastMealTime', value: ' 19:30 ' },
        { field: 'fanSpeed', value: 'Gale' },
        { field: 'nope', value: 'x' },
      ],
      form_ask: 'fanSpeed',
    });
    const said = await askTutor({ send, page: PAGE, pageNo: 1, of: 1, values: {}, question: 'half past seven', history: [] });
    expect(said.say).toBe('Got it. What is the fan on?');
    expect(said.fills).toEqual([{ field: 'lastMealTime', value: '19:30' }]);
    expect(said.ask).toBe('fanSpeed');
  });

  it('carries the question to the mill unchanged and leaves out a form_ask that names no field of the page', async () => {
    const send = async (): Promise<FormTalkAnswer> => ({ answer: 'That is everything.', form_ask: 'ghost' });
    const said = await askTutor({ send, page: PAGE, pageNo: 1, of: 1, values: {}, question: 'done', history: [] });
    expect(said.ask).toBeUndefined();
  });
});

describe('the grind a door talks to', () => {
  it('is none until a mill is set: no door without one', () => {
    expect(currentFormGrind()).toBeNull();
  });

  it('a set grind (an app\'s or a test\'s) is the one used; undefined puts the mill back', () => {
    const fake = async (): Promise<FormTalkAnswer> => ({ answer: 'Hi?' });
    setFormGrind(fake);
    expect(currentFormGrind()).toBe(fake);
    setFormGrind(null);
    expect(currentFormGrind()).toBeNull();
    setFormGrind(undefined);
    expect(currentFormGrind()).toBeNull();
  });

  it('with a mill set, the grind sends a form-talk grist and reads the answer', async () => {
    const txid = 'direct:' + 'b'.repeat(64);
    const posted = fakePostern();
    posted.postResult = { txid, seq: 1 };
    posted.onPoll = () => {
      posted.reply({ re: txid, status: 'answered', answer: { answer: 'Which night?', form_ask: 'lastMealTime' }, grind: FORM_TALK });
    };
    setMillSource(() => ({ door: new door.Door({ baseUrl: posted.base, key: posted.appKey, fetch: posted.fetch }), key: posted.appKey, intervalMs: 1 }));
    const grind = currentFormGrind();
    expect(grind).not.toBeNull();
    const answer = await grind!({ question: FORM_START, form: { name: 'x', fields: [] }, history: [] });
    expect(answer).toEqual({ answer: 'Which night?', form_ask: 'lastMealTime' });
  });

  it('refuses an answer that is not a form-talk answer', async () => {
    const posted = fakePostern();
    const txid = 'direct:' + 'c'.repeat(64);
    posted.postResult = { txid, seq: 1 };
    posted.onPoll = () => {
      posted.reply({ re: txid, status: 'answered', answer: { nothing: true }, grind: FORM_TALK });
    };
    const send = millGrind({ door: new door.Door({ baseUrl: posted.base, key: posted.appKey, fetch: posted.fetch }), key: posted.appKey, intervalMs: 1 });
    await expect(send({ question: 'x', form: { name: 'x', fields: [] }, history: [] })).rejects.toThrow(/answer/i);
  });
});

describe('the form-talk grind', () => {
  const grind = JSON.parse(grindJson) as Record<string, unknown>;
  const answerSchema = JSON.parse(answerSchemaJson) as { required: string[]; properties: Record<string, unknown> };
  const inputSchema = JSON.parse(inputSchemaJson) as { required: string[]; properties: Record<string, unknown> };

  it('is the grind the mill client sends to, and names the files it keeps', () => {
    expect([grind.app, grind.kind, grind.versions]).toEqual([FORM_TALK.app, FORM_TALK.kind, [FORM_TALK.v]]);
    expect(grind.instructions).toBe('grinds/form-talk.md');
    expect(grind.answerSchema).toBe('grinds/form-talk.answer.schema.json');
    expect(grind.attachments).toMatchObject({ min: 0, max: 0 });
  });

  it("carries the kit's fragment 'Helping him fill in a form' word for word, so a kit update shows here", () => {
    expect(grindInstructions).toContain(kitFragment.trim());
  });

  it('answers with the fields the door reads, and takes the fields the door sends', () => {
    expect(Object.keys(answerSchema.properties).sort()).toEqual(['answer', 'form_ask', 'form_values']);
    expect(answerSchema.required).toEqual(['answer']);
    expect(Object.keys(inputSchema.properties).sort()).toEqual(['form', 'history', 'page', 'question']);
  });

  it('has scenarios whose requests have the shape the door sends', () => {
    for (const text of [firstQuestionJson, fillsATimeJson]) {
      const scenario = JSON.parse(text) as { schemaVersion: string; request: FormTalkRequest; expect: Record<string, unknown> };
      expect(scenario.schemaVersion).toBe('1');
      expect(Object.keys(scenario.request).sort()).toEqual(['form', 'history', 'page', 'question']);
      expect(scenario.request.form.fields.length).toBeLessThanOrEqual(8);
      for (const path of Object.keys(scenario.expect)) expect(Object.keys(answerSchema.properties)).toContain(path.split('.')[0]);
    }
  });
});
