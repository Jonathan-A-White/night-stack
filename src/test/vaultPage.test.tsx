import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { db, seedDatabase } from '../db';
import VaultSettingsPage from '../pages/settings/VaultSettingsPage';
import { SecretReveal } from '../components/SecretReveal';
import { createVault, encryptSecret, lockVault } from '../services/vault';

/**
 * Regression: with no vault row, Dexie's `get` resolves to undefined,
 * which the page used to treat as "still loading" — the vault settings
 * page hung on "Loading…" forever on a fresh install.
 */

function mount(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings/vault" element={<VaultSettingsPage />} />
        <Route path="/reveal" element={<SecretReveal name="Uncased iPad password" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('vault page and secret reveal on an empty vault', () => {
  beforeEach(async () => {
    cleanup();
    lockVault();
    await db.delete();
    await db.open();
    await seedDatabase();
  });

  afterEach(() => cleanup());

  it('offers to set up the vault when none exists', async () => {
    mount('/settings/vault');
    await waitFor(() => {
      expect(screen.getByText('Set up the vault')).toBeInTheDocument();
    });
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('shows the locked state and the missing seeded passwords once a vault exists', async () => {
    const { config } = await createVault('2468');
    await db.vaultConfig.put(config);
    mount('/settings/vault');
    await waitFor(() => {
      expect(screen.getByText('Locked')).toBeInTheDocument();
    });
    // The seeded sound booth steps reference two passwords that are not stored.
    expect(screen.getByRole('button', { name: 'Uncased iPad password' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cased iPad password' })).toBeInTheDocument();
  });

  it('SecretReveal links to vault setup when there is no vault', async () => {
    mount('/reveal');
    await waitFor(() => {
      expect(screen.getByText('set up the vault')).toBeInTheDocument();
    });
  });

  it('SecretReveal says "not stored yet" when the vault exists but the secret does not', async () => {
    const { config } = await createVault('2468');
    await db.vaultConfig.put(config);
    mount('/reveal');
    await waitFor(() => {
      expect(screen.getByText(/not stored yet/)).toBeInTheDocument();
    });
  });

  it('SecretReveal offers a Show button once the secret is stored', async () => {
    const { config, dek } = await createVault('2468');
    await db.vaultConfig.put(config);
    await db.secrets.put(await encryptSecret(dek, 'Uncased iPad password', 'x'));
    mount('/reveal');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Show Uncased iPad password' })).toBeInTheDocument();
    });
  });
});
