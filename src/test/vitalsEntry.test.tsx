import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { db, seedDatabase } from '../db';
import { OrthostaticEntry } from '../pages/experiments/OrthostaticEntry';
import { vitalsDraftKey } from '../pages/experiments/vitalsDraftStorage';

const T = new Date(2026, 8, 4, 7, 5);

function mount(slot: 'am' | 'pm' = 'am') {
  return render(
    <MemoryRouter initialEntries={[`/experiments/vitals/new?slot=${slot}`]}>
      <Routes>
        <Route path="/experiments/vitals/new" element={<OrthostaticEntry />} />
        <Route path="/experiments/vitals" element={<div>vitals list</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function type(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function fillAll() {
  type(/supine systolic/i, '120');
  type(/supine diastolic/i, '78');
  type(/supine pulse/i, '60');
  type(/standing 1 min systolic/i, '104');
  type(/standing 1 min diastolic/i, '70');
  type(/standing 1 min pulse/i, '84');
  type(/standing 3 min systolic/i, '98');
  type(/standing 3 min diastolic/i, '66');
  type(/standing 3 min pulse/i, '92');
}

describe('OrthostaticEntry', () => {
  beforeEach(async () => {
    cleanup();
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T);
    await db.delete();
    await db.open();
    await seedDatabase();
  });
  afterEach(() => vi.useRealTimers());

  it('direct form saves one reading per date+slot and updates on re-save', async () => {
    mount('am');
    fireEvent.click(screen.getByRole('button', { name: /just enter numbers/i }));
    fillAll();
    fireEvent.click(screen.getByRole('button', { name: /^cuff$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(async () => {
      expect(await db.orthostaticReadings.count()).toBe(1);
    });
    let row = (await db.orthostaticReadings.toArray())[0];
    expect(row.date).toBe('2026-09-04');
    expect(row.slot).toBe('am');
    expect(row.source).toBe('cuff');
    expect(row.supine).toEqual({ systolic: 120, diastolic: 78, pulse: 60 });
    expect(row.standing1).toEqual({ systolic: 104, diastolic: 70, pulse: 84 });
    expect(row.standing3).toEqual({ systolic: 98, diastolic: 66, pulse: 92 });
    await screen.findByText('vitals list');

    // Re-open the same slot: form is prefilled; edit and save → same row updated.
    cleanup();
    mount('am');
    fireEvent.click(screen.getByRole('button', { name: /just enter numbers/i }));
    await waitFor(() => {
      expect((screen.getByLabelText(/supine systolic/i) as HTMLInputElement).value).toBe('120');
    });
    type(/supine systolic/i, '122');
    fireEvent.click(screen.getByRole('button', { name: /^watch$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(async () => {
      row = (await db.orthostaticReadings.toArray())[0];
      expect(row.supine.systolic).toBe(122);
    });
    expect(await db.orthostaticReadings.count()).toBe(1);
    expect(row.source).toBe('watch');
  });

  it('coached path: skip timer reveals inputs, draft survives a remount', async () => {
    mount('pm');
    fireEvent.click(screen.getByRole('button', { name: /start coached reading/i }));
    await screen.findByText(/lie down/i);
    fireEvent.click(screen.getByRole('button', { name: /skip timer/i }));
    type(/supine systolic/i, '118');
    type(/supine diastolic/i, '76');
    type(/supine pulse/i, '58');
    fireEvent.click(screen.getByRole('button', { name: /stand up/i }));
    await screen.findByText(/standing.*1 min/i);
    expect(localStorage.getItem(vitalsDraftKey('2026-09-04', 'pm'))).not.toBeNull();

    cleanup();
    mount('pm');
    // Resumes on the 1-minute stage with the supine values intact.
    await screen.findByText(/standing.*1 min/i);
    fireEvent.click(screen.getByRole('button', { name: /skip timer/i }));
    fireEvent.click(screen.getByRole('button', { name: /skip this reading/i }));
    await screen.findByText(/standing.*3 min/i);
    fireEvent.click(screen.getByRole('button', { name: /skip timer/i }));
    type(/standing 3 min systolic/i, '100');
    type(/standing 3 min diastolic/i, '70');
    type(/standing 3 min pulse/i, '80');
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(async () => {
      expect(await db.orthostaticReadings.count()).toBe(1);
    });
    const row = (await db.orthostaticReadings.toArray())[0];
    expect(row.slot).toBe('pm');
    expect(row.supine).toEqual({ systolic: 118, diastolic: 76, pulse: 58 });
    expect(row.standing1).toBeNull();
    expect(row.standing3).toEqual({ systolic: 100, diastolic: 70, pulse: 80 });
    expect(localStorage.getItem(vitalsDraftKey('2026-09-04', 'pm'))).toBeNull();
  });
});
