import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { db, seedDatabase } from '../db';
import { createBlankNightLog } from '../utils';
import type { NightLog } from '../types';
import { MorningLog } from '../pages/morning/MorningLog';
import { EveningLog } from '../pages/tonight/EveningLog';
import { TonightPlan } from '../pages/tonight/TonightPlan';
import { setFormGrind, type FormTalkAnswer, type FormTalkRequest } from './formTalk';

// 23:30 on 4 Sep 2026: after the eating cutoff, so a save is a real bedtime save and the early-bedtime warning stays quiet
const NOW = new Date(2026, 8, 4, 23, 30);
const EVENING_DATE = '2026-09-04';

function script(answers: FormTalkAnswer[]) {
  const seen: FormTalkRequest[] = [];
  setFormGrind(async (request) => {
    seen.push(request);
    const next = answers.shift();
    if (!next) throw new Error('the script has no more answers');
    return next;
  });
  return seen;
}

function numberOrTimeField(label: string): HTMLInputElement {
  const el = screen.getAllByText((_, e) => e?.tagName === 'LABEL' && (e.textContent ?? '').trim().startsWith(label))[0];
  return (el.closest('.form-group') as HTMLElement).querySelector('input,textarea,select') as HTMLInputElement;
}

const type = (label: string, value: string) => fireEvent.change(numberOrTimeField(label), { target: { value } });
const next = () => fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
const reply = (text: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: /your answer/i }), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: /^reply$/i }));
};

beforeEach(async () => {
  cleanup();
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await db.delete();
  await db.open();
  await seedDatabase();
});
afterEach(() => {
  setFormGrind(undefined);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Morning log: Let the tutor do it, on the manual sleep data', () => {
  async function mountMorning() {
    const log = createBlankNightLog(EVENING_DATE, { expectedAlarmTime: '07:00', actualAlarmTime: '07:00', isOverridden: false, targetBedtime: '23:00', eatingCutoff: '20:00', supplementTime: '21:00' });
    await db.nightLogs.put(log);
    render(
      <MemoryRouter initialEntries={[`/morning?date=${EVENING_DATE}`]}>
        <Routes>
          <Route path="/morning" element={<MorningLog />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /enter manually/i }));
  }

  it('has no door without a tutor to talk to', async () => {
    await mountMorning();
    expect(screen.queryByRole('button', { name: /let the tutor do it/i })).toBeNull();
    expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument();
  });

  it('asks, fills, and ends with Send, which does what the manual Save does and writes nothing to the database', async () => {
    const seen = script([
      { answer: 'When did you fall asleep?', form_ask: 'sleepTime' },
      {
        answer: 'Got the main numbers. Anything about heart rate?',
        form_values: [
          { field: 'sleepTime', value: '23:10' },
          { field: 'wakeTime', value: '06:45' },
          { field: 'totalSleepDuration', value: '455' },
          { field: 'actualSleepDuration', value: '410' },
          { field: 'sleepScore', value: '82' },
        ],
      },
      { answer: 'Any ratings?', form_ask: 'sleepLatencyRating' },
    ]);
    await mountMorning();
    const writes = vi.spyOn(db.nightLogs, 'update');
    const puts = vi.spyOn(db.nightLogs, 'put');
    fireEvent.click(screen.getByRole('button', { name: /let the tutor do it/i }));
    await screen.findByText('When did you fall asleep?');
    expect(seen[0].form.name).toBe('Morning sleep data (1 of 3)');
    expect(seen[0].form.fields.map((f) => f.label)).toEqual(['Sleep time', 'Wake time', 'Total sleep duration (min)', 'Actual sleep duration (min)', 'Sleep score (0-100)', 'Score delta', 'Deep sleep (min)', 'REM sleep (min)']);
    reply('around eleven ten');
    await screen.findByText('Any ratings?');
    expect(numberOrTimeField('Sleep score').value).toBe('82');
    expect(numberOrTimeField('Sleep time').value).toBe('23:10');

    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    // the manual form closes and the parsed sleep data is shown, as after the page's own Save
    expect(await screen.findByText('Parsed Sleep Data')).toBeInTheDocument();
    expect(screen.getByText(/^82 \(/)).toBeInTheDocument();
    expect(writes).not.toHaveBeenCalled();
    expect(puts).not.toHaveBeenCalled();
  });

  it('refuses a sleep score over 100 and keeps the manual form open', async () => {
    script([{ answer: 'Done.', form_values: [
      { field: 'sleepTime', value: '23:10' }, { field: 'wakeTime', value: '06:45' }, { field: 'totalSleepDuration', value: '455' },
      { field: 'actualSleepDuration', value: '410' }, { field: 'sleepScore', value: '150' },
    ] }, { answer: 'Next?', form_ask: 'sleepScoreDelta' }]);
    await mountMorning();
    fireEvent.click(screen.getByRole('button', { name: /let the tutor do it/i }));
    await screen.findByText('Next?');
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent(/sleep score.*0 to 100/i);
    expect(screen.queryByText('Parsed Sleep Data')).toBeNull();
  });
});

describe('Evening log: Let the tutor do it', () => {
  function mountEvening() {
    return render(
      <MemoryRouter initialEntries={['/tonight/log']}>
        <Routes>
          <Route path="/tonight/log" element={<EveningLog />} />
          <Route path="/tonight/review/:id" element={<div>evening review</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  const strip = (log: NightLog) => ({ ...log, id: 'x', createdAt: 0, updatedAt: 0, loggedBedtime: log.loggedBedtime == null ? null : 0 });

  async function byHand(): Promise<NightLog> {
    mountEvening();
    await screen.findByText(/Step 1 of/);
    next();
    next();
    type('Last meal time', '19:30');
    type('Food description', 'Salmon and rice');
    next();
    next();
    type('Room temperature', '67');
    fireEvent.click(screen.getByRole('button', { name: /^Low$/ }));
    for (let i = 0; i < 3; i++) next();
    fireEvent.click(screen.getByRole('button', { name: /save evening log/i }));
    await screen.findByText('evening review');
    const logs = await db.nightLogs.toArray();
    expect(logs).toHaveLength(1);
    return logs[0];
  }

  it('saves, through the page\'s own Save and once, exactly what the same values typed by hand save', async () => {
    const byHandLog = await byHand();
    await db.nightLogs.clear();
    cleanup();
    localStorage.clear();

    const puts = vi.spyOn(db.nightLogs, 'put');
    const seen = script([
      { answer: 'When did you last eat?', form_ask: 'lastMealTime' },
      {
        answer: 'Thanks. Anything else about the evening?',
        form_values: [
          { field: 'lastMealTime', value: '19:30' },
          { field: 'foodDescription', value: 'Salmon and rice' },
        ],
      },
      { answer: 'Anything about the room?', form_ask: 'roomTempF' },
      { answer: 'Got it.', form_values: [{ field: 'roomTempF', value: '67' }, { field: 'fanSpeed', value: 'Low' }] },
    ]);
    mountEvening();
    await screen.findByText(/Step 1 of/);
    fireEvent.click(screen.getByRole('button', { name: /let the tutor do it/i }));
    await screen.findByText('When did you last eat?');
    expect(seen[0].form.name).toBe('Evening log (1 of 2)');
    expect(seen[0].form.command).toBe('saveEveningLog');
    reply('half past seven, salmon and rice');
    await screen.findByText('Anything about the room?');
    expect(seen[2].form.name).toBe('Evening log (2 of 2)');
    // the page 2 request: the AC fields are not offered when no AC is installed
    expect(seen[2].form.fields.map((f) => f.name)).not.toContain('acCurveProfile');
    reply('67, fan on low');
    await screen.findByText('Got it.');
    expect(puts).not.toHaveBeenCalled(); // the tutor never saves

    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await screen.findByText('evening review');
    expect(puts).toHaveBeenCalledTimes(1);
    const saved = (await db.nightLogs.toArray())[0];
    expect(strip(saved)).toEqual(strip(byHandLog));
    expect(saved.eveningIntake.lastMealTime).toBe('19:30');
    expect(saved.environment.roomTempF).toBe(67);
    expect(saved.environment.fanSpeed).toBe('low');
  });

  it('refuses a room temperature out of range before anything is written', async () => {
    const puts = vi.spyOn(db.nightLogs, 'put');
    script([
      { answer: 'Done with food.', form_values: [{ field: 'lastMealTime', value: '19:30' }] },
      { answer: 'More?', form_values: [{ field: 'roomTempF', value: '900' }], form_ask: 'fanSpeed' },
    ]);
    mountEvening();
    await screen.findByText(/Step 1 of/);
    fireEvent.click(screen.getByRole('button', { name: /let the tutor do it/i }));
    await screen.findByText('More?');
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent(/room temperature/i);
    expect(puts).not.toHaveBeenCalled();
    expect(await db.nightLogs.count()).toBe(0);
  });
});

describe("Tonight's plan: Let the tutor do it", () => {
  it('sets the plan\'s dials, saves nothing, and shows the new recommendation inputs', async () => {
    const puts = vi.spyOn(db.nightLogs, 'put');
    script([
      { answer: 'What is the room at?', form_ask: 'plannedRoomTemp' },
      { answer: 'Anything else?', form_values: [{ field: 'plannedRoomTemp', value: '68' }, { field: 'hoursSinceLastMeal', value: '3.5' }], form_ask: 'plannedRoomHumidity' },
    ]);
    render(
      <MemoryRouter initialEntries={['/tonight']}>
        <Routes>
          <Route path="/tonight" element={<TonightPlan />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /let the tutor do it/i }));
    await screen.findByText('What is the room at?');
    reply('sixty eight, ate three and a half hours ago');
    await screen.findByText('Anything else?');
    await waitFor(() => expect(numberOrTimeField('Starting room temp').value).toBe('68'));
    expect(numberOrTimeField('Hours since last meal').value).toBe('3.5');
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    expect(await screen.findByText(/plan.*updated|dials/i)).toBeInTheDocument();
    expect(puts).not.toHaveBeenCalled();
  });
});
