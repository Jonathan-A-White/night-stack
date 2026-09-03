import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { db, seedDatabase } from '../db';
import { AppSwitcher } from '../components/AppSwitcher';
import { AppTabBar } from '../components/AppTabBar';
import { AppEntryRedirect } from '../components/AppEntryRedirect';
import { writeLastApp, writeLastPath } from '../apps';

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname}</div>;
}

function Shell({ initial }: { initial: string }) {
  return (
    <MemoryRouter initialEntries={[initial]}>
      <AppSwitcher />
      <Routes>
        <Route path="/" element={<AppEntryRedirect />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
      <AppTabBar />
    </MemoryRouter>
  );
}

describe('app shell', () => {
  beforeEach(async () => {
    cleanup();
    localStorage.clear();
    await db.delete();
    await db.open();
    await seedDatabase();
  });

  it('shows the tracking tabs on a tracking route', () => {
    render(<Shell initial="/morning" />);
    const nav = screen.getByRole('navigation', { name: /tabs/i });
    const labels = Array.from(nav.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).toEqual(['Tonight', 'Morning', 'Calendar', 'Insights', 'Settings']);
    expect(screen.getByRole('button', { name: /Tracking/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('switching to Experiments navigates to its home and swaps the tabs', () => {
    render(<Shell initial="/morning" />);
    fireEvent.click(screen.getByRole('button', { name: /Experiments/ }));
    expect(screen.getByTestId('loc').textContent).toBe('/experiments');
    const nav = screen.getByRole('navigation', { name: /tabs/i });
    const labels = Array.from(nav.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).toEqual(['Home', 'Vitals', 'Body', 'Import', 'Settings']);
  });

  it('switching back restores the last-visited tab of that app', () => {
    writeLastPath('tracking', '/insights/correlations');
    render(<Shell initial="/routine" />);
    fireEvent.click(screen.getByRole('button', { name: /Tracking/ }));
    expect(screen.getByTestId('loc').textContent).toBe('/insights/correlations');
  });

  it('cold launch at / redirects to the remembered app home', () => {
    writeLastApp('experiments');
    render(<Shell initial="/" />);
    expect(screen.getByTestId('loc').textContent).toBe('/experiments');
  });

  it('cold launch with nothing remembered goes to /tonight', () => {
    render(<Shell initial="/" />);
    expect(screen.getByTestId('loc').textContent).toBe('/tonight');
  });

  it('settings keeps the last-active app selected', () => {
    writeLastApp('routine');
    render(<Shell initial="/settings/weight-profile" />);
    expect(screen.getByRole('button', { name: /Routine/ })).toHaveAttribute('aria-pressed', 'true');
    const nav = screen.getByRole('navigation', { name: /tabs/i });
    const active = nav.querySelector('button.active');
    expect(active?.textContent).toBe('Settings');
  });
});
