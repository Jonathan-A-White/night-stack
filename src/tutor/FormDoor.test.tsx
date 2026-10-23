import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FORM_START, formCommand, type FormSpec, type FormValue } from 'voice-kit/forms';
import { FormDoor } from './FormDoor';
import { FORM_NEXT, setFormGrind, type FormTalkAnswer, type FormTalkRequest } from './formTalk';

const PAGES: FormSpec[] = [
  {
    name: 'Trip (1 of 2)',
    fields: [
      { name: 'where', label: 'Where to', required: true, kind: 'text' },
      { name: 'when', label: 'When', required: true, kind: 'text' },
    ],
  },
  { name: 'Trip (2 of 2)', fields: [{ name: 'seat', label: 'Seat', required: false, kind: 'choice', options: ['Aisle', 'Window'] }] },
];

/** a stand-in page: holds the values the door fills, and shows them */
function Harness({ send, refuse }: { send: (v: Record<string, string>) => void; refuse?: (v: Record<string, string>) => string | undefined }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const command = formCommand(
    { name: 'Trip', fields: PAGES.flatMap((p) => p.fields) },
    {
      name: 'bookTrip',
      tell: 'Books the trip',
      send: async (v) => {
        const why = refuse?.(v);
        if (why) throw new Error(why);
        send(v);
        return { said: 'Trip booked.' };
      },
    },
  );
  const onFill = (fills: FormValue[]) => setValues((prev) => ({ ...prev, ...Object.fromEntries(fills.map((f) => [f.field, f.value])) }));
  return (
    <div>
      <FormDoor pages={PAGES} values={values} command={command} onFill={onFill} sendLabel="Send trip" />
      <output data-testid="values">{JSON.stringify(values)}</output>
    </div>
  );
}

function script(answers: FormTalkAnswer[]) {
  const seen: FormTalkRequest[] = [];
  const grind = vi.fn(async (request: FormTalkRequest): Promise<FormTalkAnswer> => {
    seen.push(request);
    const next = answers.shift();
    if (!next) throw new Error('the script has no more answers');
    return next;
  });
  setFormGrind(grind);
  return { seen, grind };
}

const reply = (text: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: /your answer/i }), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: /^reply$/i }));
};

beforeEach(() => cleanup());
afterEach(() => setFormGrind(undefined));

describe('FormDoor', () => {
  it('shows nothing when there is no tutor to talk to', () => {
    render(<Harness send={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /let the tutor do it/i })).toBeNull();
  });

  it('asks, fills as he answers, and ends with Send, which runs the form\'s command once', async () => {
    const sent = vi.fn();
    const { seen } = script([
      { answer: 'Where are you going?', form_ask: 'where' },
      { answer: 'And when?', form_values: [{ field: 'where', value: 'Lisbon' }], form_ask: 'when' },
      { answer: 'That is everything required.', form_values: [{ field: 'when', value: 'Friday' }] },
      { answer: 'Aisle or window?', form_ask: 'seat' },
    ]);
    render(<Harness send={sent} />);
    fireEvent.click(screen.getByRole('button', { name: /let the tutor do it/i }));
    expect(await screen.findByText('Where are you going?')).toBeInTheDocument();
    expect(seen[0].question).toBe(FORM_START);
    expect(seen[0].page).toEqual({ n: 1, of: 2 });
    expect(seen[0].form.command).toBe('bookTrip');
    expect(screen.queryByRole('button', { name: /send trip/i })).toBeNull();

    reply('Lisbon');
    expect(await screen.findByText('And when?')).toBeInTheDocument();
    expect(seen[1].question).toBe('Lisbon');
    expect(screen.getByTestId('values')).toHaveTextContent('"where":"Lisbon"');

    reply('Friday');
    await screen.findByText('Aisle or window?');
    expect(screen.getByTestId('values')).toHaveTextContent('"when":"Friday"');
    const sendButton = screen.getByRole('button', { name: /send trip/i });
    expect(sent).not.toHaveBeenCalled(); // the tutor never sends
    fireEvent.click(sendButton);
    expect(await screen.findByText('Trip booked.')).toBeInTheDocument();
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent).toHaveBeenCalledWith({ where: 'Lisbon', when: 'Friday' });
  });

  it('goes on to the next page when the tutor has finished a page, carrying the values so far', async () => {
    const { seen } = script([
      { answer: 'Where?', form_ask: 'where' },
      { answer: 'Anything else about the trip?', form_values: [{ field: 'where', value: 'Lisbon' }, { field: 'when', value: 'Friday' }] },
      { answer: 'Aisle or window?', form_ask: 'seat' },
    ]);
    render(<Harness send={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /let the tutor do it/i }));
    await screen.findByText('Where?');
    reply('Lisbon on Friday');
    await screen.findByText('Aisle or window?');
    expect(seen).toHaveLength(3);
    expect(seen[2].question).toBe(FORM_NEXT);
    expect(seen[2].page).toEqual({ n: 2, of: 2 });
    expect(seen[2].form.name).toBe('Trip (2 of 2)');
    expect(seen[1].history.map((h) => h.role)).toEqual(['tutor']);
  });

  it('refuses a send the command refuses, says why, and runs nothing', async () => {
    const sent = vi.fn();
    script([{ answer: 'Done.', form_values: [{ field: 'where', value: 'Lisbon' }, { field: 'when', value: 'Never' }] }]);
    render(<Harness send={sent} refuse={(v) => (v.when === 'Never' ? 'That date is not a date.' : undefined)} />);
    fireEvent.click(screen.getByRole('button', { name: /let the tutor do it/i }));
    await screen.findByText('Done.');
    fireEvent.click(screen.getByRole('button', { name: /send trip/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That date is not a date.');
    expect(sent).not.toHaveBeenCalled();
  });

  it('says what went wrong when the tutor cannot be reached, and lets him reply again', async () => {
    script([]);
    render(<Harness send={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /let the tutor do it/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no more answers/);
  });

  it('closes the panel with Stop and leaves what is filled in place', async () => {
    script([{ answer: 'Where?', form_values: [{ field: 'where', value: 'Lisbon' }] }]);
    render(<Harness send={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /let the tutor do it/i }));
    await screen.findByText('Where?');
    fireEvent.click(screen.getByRole('button', { name: /^stop$/i }));
    await waitFor(() => expect(screen.queryByText('Where?')).toBeNull());
    expect(screen.getByTestId('values')).toHaveTextContent('Lisbon');
    expect(screen.getByRole('button', { name: /let the tutor do it/i })).toBeInTheDocument();
  });
});
