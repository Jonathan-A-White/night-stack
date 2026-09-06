import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import {
  DEFAULT_AUTO_LOCK_MINUTES,
  VaultError,
  decryptSecret,
  getUnlockedDek,
  lockVault,
  onVaultStateChange,
  setUnlocked,
  unlockWithPin,
  unlockWithPrfOutput,
} from '../services/vault';
import { assertBiometric } from '../services/webauthnPrf';
import { VAULT_SETTINGS_PATH } from '../services/routinePaths';
import { base64ToBytes } from '../services/vault';
import type { VaultConfig } from '../types';

/** How long a revealed value stays on screen before hiding itself. */
const REVEAL_TTL_MS = 60_000;

/**
 * Small hook: is the vault unlocked right now? Re-renders on lock /
 * unlock transitions and on the auto-lock expiry.
 */
export function useVaultUnlocked(): boolean {
  const [unlocked, setUnlockedState] = useState(() => getUnlockedDek() != null);
  useEffect(() => {
    const sync = () => setUnlockedState(getUnlockedDek() != null);
    sync();
    const off = onVaultStateChange(sync);
    const id = setInterval(sync, 5_000);
    return () => {
      off();
      clearInterval(id);
    };
  }, []);
  return unlocked;
}

interface UnlockProps {
  config: VaultConfig;
  onUnlocked: () => void;
  onCancel?: () => void;
}

/**
 * Inline unlock form: fingerprint button when enrolled, PIN field always.
 * Shared by SecretReveal and the vault settings page.
 */
export function VaultUnlockForm({ config, onUnlocked, onCancel }: UnlockProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ttlMs = (config.autoLockMinutes || DEFAULT_AUTO_LOCK_MINUTES) * 60_000;

  const finish = (dek: CryptoKey) => {
    setUnlocked(dek, ttlMs);
    setPin('');
    setError('');
    onUnlocked();
  };

  const handlePin = async () => {
    if (!pin) return;
    setBusy(true);
    setError('');
    try {
      finish(await unlockWithPin(config, pin));
    } catch (e) {
      setError(e instanceof VaultError && e.code === 'wrong_pin' ? 'Wrong PIN.' : 'Could not unlock.');
    } finally {
      setBusy(false);
    }
  };

  const handleBiometric = async () => {
    if (!config.prfWrappedKey) return;
    setBusy(true);
    setError('');
    try {
      const output = await assertBiometric(
        config.prfWrappedKey.credentialId,
        base64ToBytes(config.prfWrappedKey.prfSalt),
      );
      finish(await unlockWithPrfOutput(config, output));
    } catch (e) {
      setError(e instanceof Error ? `Fingerprint failed: ${e.message}` : 'Fingerprint failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vault-unlock">
      {config.prfWrappedKey && (
        <button
          type="button"
          className="btn btn-primary btn-full mb-8"
          onClick={handleBiometric}
          disabled={busy}
        >
          Unlock with fingerprint
        </button>
      )}
      <div className="flex gap-8" style={{ alignItems: 'center' }}>
        <input
          className="form-input"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          placeholder="Vault PIN"
          aria-label="Vault PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handlePin();
          }}
        />
        <button type="button" className="btn btn-secondary btn-sm" onClick={handlePin} disabled={busy || !pin}>
          Unlock
        </button>
        {onCancel && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
      {error && <div className="text-sm mt-8" style={{ color: 'var(--color-danger)' }}>{error}</div>}
    </div>
  );
}

interface RevealProps {
  name: string;
}

/**
 * "Show <secret>" affordance for a routine step. Handles every state: no
 * vault yet, secret not stored, vault locked (inline unlock), unlocked
 * (decrypt on tap, auto-hide after a minute).
 */
export function SecretReveal({ name }: RevealProps) {
  const config = useLiveQuery(() => db.vaultConfig.get('default'), []);
  const secret = useLiveQuery(() => db.secrets.get(name), [name]);
  const unlocked = useVaultUnlocked();
  const [showUnlock, setShowUnlock] = useState(false);
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Hide the plaintext when the vault locks (auto-lock or manual).
  useEffect(() => {
    if (!unlocked) setValue(null);
  }, [unlocked]);

  // Auto-hide a revealed value.
  useEffect(() => {
    if (value == null) return;
    const id = setTimeout(() => setValue(null), REVEAL_TTL_MS);
    return () => clearTimeout(id);
  }, [value]);

  const reveal = async () => {
    const dek = getUnlockedDek();
    if (!dek || !secret) {
      setShowUnlock(true);
      return;
    }
    try {
      setValue(await decryptSecret(dek, secret));
      setError('');
      setShowUnlock(false);
    } catch {
      setError('Could not decrypt this secret.');
    }
  };

  if (config === undefined || secret === undefined) return null;

  if (!config) {
    return (
      <div className="secret-reveal">
        <span className="text-secondary text-sm">
          {name}: <Link to={VAULT_SETTINGS_PATH}>set up the vault</Link> to store it.
        </span>
      </div>
    );
  }

  if (!secret) {
    return (
      <div className="secret-reveal">
        <span className="text-secondary text-sm">
          {name}: not stored yet — <Link to={VAULT_SETTINGS_PATH}>add it in the vault</Link>.
        </span>
      </div>
    );
  }

  if (value != null) {
    return (
      <div className="secret-reveal">
        <div className="secret-reveal-label">{name}</div>
        <div className="secret-reveal-value" aria-live="polite">{value}</div>
        <div className="flex gap-8 mt-8">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setValue(null)}>
            Hide
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setValue(null);
              lockVault();
            }}
          >
            Hide and lock vault
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="secret-reveal">
      {showUnlock && !unlocked ? (
        <>
          <div className="secret-reveal-label">Unlock to show {name}</div>
          <VaultUnlockForm
            config={config}
            onUnlocked={() => {
              setShowUnlock(false);
              void reveal();
            }}
            onCancel={() => setShowUnlock(false)}
          />
        </>
      ) : (
        <button type="button" className="btn btn-secondary btn-full" onClick={reveal}>
          Show {name}
        </button>
      )}
      {error && <div className="text-sm mt-8" style={{ color: 'var(--color-danger)' }}>{error}</div>}
    </div>
  );
}

export default SecretReveal;
