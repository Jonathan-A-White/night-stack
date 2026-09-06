import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import {
  DEFAULT_AUTO_LOCK_MINUTES,
  changePin,
  createVault,
  decryptSecret,
  encryptSecret,
  enrollPrfKey,
  getUnlockedDek,
  lockVault,
  removePrfKey,
  setUnlocked,
} from '../../services/vault';
import { enrollBiometric, isPlatformAuthenticatorAvailable, isWebAuthnAvailable } from '../../services/webauthnPrf';
import { VaultUnlockForm, useVaultUnlocked } from '../../components/SecretReveal';
import { ROUTINES_SETTINGS_PATH } from '../../services/routinePaths';

export { VaultSettingsPage };

/**
 * Settings → Password vault. Create the vault (PIN), enroll or remove the
 * fingerprint, add / update / delete secrets, change the PIN, lock.
 * Secrets referenced by routine steps but not yet stored are listed so
 * a seeded routine's "Uncased iPad password" is one tap away from being
 * filled in.
 */
export default function VaultSettingsPage() {
  // `undefined` while loading, `null` when no vault has been created yet.
  // Dexie's `get` returns undefined for a missing row, which would read
  // as "still loading" forever without the `?? null`.
  const config = useLiveQuery(async () => (await db.vaultConfig.get('default')) ?? null, []);
  const secrets = useLiveQuery(() => db.secrets.orderBy('name').toArray(), []);
  const steps = useLiveQuery(() => db.routineSteps.toArray(), []);
  const unlocked = useVaultUnlocked();

  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Create-vault form
  const [newPin, setNewPin] = useState('');
  const [newPinConfirm, setNewPinConfirm] = useState('');

  // Change-PIN form
  const [showChangePin, setShowChangePin] = useState(false);
  const [changePinValue, setChangePinValue] = useState('');
  const [changePinConfirm, setChangePinConfirm] = useState('');

  // Secret form
  const [secretName, setSecretName] = useState('');
  const [secretValue, setSecretValue] = useState('');
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  const [biometricAvailable, setBiometricAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void isPlatformAuthenticatorAvailable().then((ok) => {
      if (!cancelled) setBiometricAvailable(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Drop revealed plaintext when the vault locks.
  useEffect(() => {
    if (!unlocked) setRevealed({});
  }, [unlocked]);

  const flash = (msg: string) => {
    setStatus(msg);
    setError('');
    setTimeout(() => setStatus(''), 3000);
  };

  const fail = (e: unknown, fallback: string) => {
    setError(e instanceof Error && e.message ? e.message : fallback);
    setStatus('');
  };

  if (config === undefined || secrets === undefined || steps === undefined) {
    return <div className="empty-state"><h3>Loading&hellip;</h3></div>;
  }

  const referencedNames = new Set<string>();
  for (const s of steps) for (const n of s.secretNames ?? []) referencedNames.add(n);
  const storedNames = new Set(secrets.map((s) => s.name));
  const missing = [...referencedNames].filter((n) => !storedNames.has(n)).sort();

  const handleCreate = async () => {
    if (newPin.length < 4) {
      setError('Use at least 4 digits or characters.');
      return;
    }
    if (newPin !== newPinConfirm) {
      setError('PINs do not match.');
      return;
    }
    setBusy(true);
    try {
      const { config: created, dek } = await createVault(newPin);
      await db.vaultConfig.put(created);
      setUnlocked(dek, created.autoLockMinutes * 60_000);
      setNewPin('');
      setNewPinConfirm('');
      flash('Vault created and unlocked.');
    } catch (e) {
      fail(e, 'Could not create the vault.');
    } finally {
      setBusy(false);
    }
  };

  const requireDek = (): CryptoKey | null => {
    const dek = getUnlockedDek();
    if (!dek) setError('Unlock the vault first.');
    return dek;
  };

  const handleSaveSecret = async () => {
    const name = secretName.trim();
    if (!name || !secretValue) return;
    const dek = requireDek();
    if (!dek) return;
    setBusy(true);
    try {
      const existing = await db.secrets.get(name);
      const now = Date.now();
      const row = await encryptSecret(dek, name, secretValue, now, existing?.createdAt ?? now);
      await db.secrets.put(row);
      setSecretName('');
      setSecretValue('');
      setRevealed((r) => {
        const next = { ...r };
        delete next[name];
        return next;
      });
      flash(existing ? `Updated "${name}".` : `Stored "${name}".`);
    } catch (e) {
      fail(e, 'Could not store the secret.');
    } finally {
      setBusy(false);
    }
  };

  const handleReveal = async (name: string) => {
    const dek = requireDek();
    if (!dek) return;
    const row = await db.secrets.get(name);
    if (!row) return;
    try {
      const value = await decryptSecret(dek, row);
      setRevealed((r) => ({ ...r, [name]: value }));
    } catch (e) {
      fail(e, 'Could not decrypt.');
    }
  };

  const handleDeleteSecret = async (name: string) => {
    if (!window.confirm(`Delete "${name}" from the vault?`)) return;
    await db.secrets.delete(name);
    setRevealed((r) => {
      const next = { ...r };
      delete next[name];
      return next;
    });
  };

  const handleChangePin = async () => {
    if (!config) return;
    const dek = requireDek();
    if (!dek) return;
    if (changePinValue.length < 4) {
      setError('Use at least 4 digits or characters.');
      return;
    }
    if (changePinValue !== changePinConfirm) {
      setError('PINs do not match.');
      return;
    }
    setBusy(true);
    try {
      await db.vaultConfig.put(await changePin(config, dek, changePinValue));
      setChangePinValue('');
      setChangePinConfirm('');
      setShowChangePin(false);
      flash('PIN changed.');
    } catch (e) {
      fail(e, 'Could not change the PIN.');
    } finally {
      setBusy(false);
    }
  };

  const handleEnrollBiometric = async () => {
    if (!config) return;
    const dek = requireDek();
    if (!dek) return;
    setBusy(true);
    try {
      const prfSalt = new Uint8Array(32);
      crypto.getRandomValues(prfSalt);
      const enrollment = await enrollBiometric(prfSalt);
      const next = await enrollPrfKey(
        config, dek, enrollment.credentialId, enrollment.prfSalt, enrollment.prfOutput,
      );
      await db.vaultConfig.put(next);
      flash('Fingerprint unlock enabled.');
    } catch (e) {
      fail(e, 'Could not enable fingerprint unlock.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveBiometric = async () => {
    if (!config) return;
    if (!window.confirm('Remove fingerprint unlock? The PIN keeps working.')) return;
    await db.vaultConfig.put(removePrfKey(config));
    flash('Fingerprint unlock removed.');
  };

  const handleAutoLockChange = async (minutes: number) => {
    if (!config) return;
    await db.vaultConfig.put({ ...config, autoLockMinutes: minutes, updatedAt: Date.now() });
  };

  const handleDeleteVault = async () => {
    if (!window.confirm('Delete the vault and every stored secret? Routine steps keep their references and will show "not stored".')) return;
    await db.transaction('rw', db.vaultConfig, db.secrets, async () => {
      await db.secrets.clear();
      await db.vaultConfig.clear();
    });
    lockVault();
    flash('Vault deleted.');
  };

  return (
    <div>
      <div className="page-header">
        <Link to="/settings" className="text-accent" style={{ textDecoration: 'none', fontSize: 14 }}>
          &lsaquo; Settings
        </Link>
        <h1>Password vault</h1>
        <p className="subtitle">Encrypted on this phone; nothing is synced or exported</p>
      </div>

      {status && <div className="banner banner-success">{status}</div>}
      {error && <div className="banner banner-danger">{error}</div>}

      {!config ? (
        <div className="card">
          <div className="card-title">Set up the vault</div>
          <p className="text-secondary text-sm mb-8">
            Pick a PIN. It never leaves the phone and cannot be recovered — if you forget it the
            stored passwords are gone (you can delete the vault and start over). You can add
            fingerprint unlock after this step.
          </p>
          <div className="form-group">
            <label className="form-label">PIN</label>
            <input className="form-input" type="password" inputMode="numeric" autoComplete="new-password" value={newPin} onChange={(e) => setNewPin(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Confirm PIN</label>
            <input className="form-input" type="password" inputMode="numeric" autoComplete="new-password" value={newPinConfirm} onChange={(e) => setNewPinConfirm(e.target.value)} />
          </div>
          <button className="btn btn-primary btn-full" onClick={handleCreate} disabled={busy}>Create vault</button>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="card-title">{unlocked ? 'Unlocked' : 'Locked'}</div>
            {unlocked ? (
              <>
                <p className="text-secondary text-sm mb-8">
                  Auto-locks after {config.autoLockMinutes || DEFAULT_AUTO_LOCK_MINUTES} minutes.
                </p>
                <button className="btn btn-secondary btn-full" onClick={() => lockVault()}>Lock now</button>
              </>
            ) : (
              <VaultUnlockForm config={config} onUnlocked={() => flash('Unlocked.')} />
            )}
          </div>

          {missing.length > 0 && (
            <div className="banner banner-warning">
              Routine steps reference {missing.length === 1 ? 'a password that is' : 'passwords that are'} not stored yet:{' '}
              {missing.map((n) => (
                <button
                  key={n}
                  type="button"
                  className="routine-variant-chip"
                  style={{ marginLeft: 4, marginTop: 4 }}
                  onClick={() => setSecretName(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          )}

          <div className="card">
            <div className="card-title">Stored passwords</div>
            {secrets.length === 0 ? (
              <div className="text-secondary text-sm mb-8">Nothing stored yet.</div>
            ) : secrets.map((s) => (
              <div key={s.name} className="routine-step-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="fw-600">{s.name}</div>
                  {revealed[s.name] != null ? (
                    <div className="secret-reveal-value">{revealed[s.name]}</div>
                  ) : (
                    <div className="text-secondary text-sm">••••••••</div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                  {revealed[s.name] != null ? (
                    <button className="btn btn-secondary btn-sm" onClick={() => setRevealed((r) => { const n = { ...r }; delete n[s.name]; return n; })}>Hide</button>
                  ) : (
                    <button className="btn btn-secondary btn-sm" onClick={() => handleReveal(s.name)} disabled={!unlocked}>Show</button>
                  )}
                  <button className="btn btn-secondary btn-sm" onClick={() => { setSecretName(s.name); setSecretValue(''); }} disabled={!unlocked}>Change</button>
                  <button className="routine-reorder-btn" onClick={() => handleDeleteSecret(s.name)} aria-label={`Delete ${s.name}`}>&times;</button>
                </div>
              </div>
            ))}

            <div className="form-group mt-16">
              <label className="form-label">Name (what routine steps reference)</label>
              <input
                className="form-input"
                value={secretName}
                onChange={(e) => setSecretName(e.target.value)}
                placeholder="e.g. Uncased iPad password"
                disabled={!unlocked}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Value</label>
              <input
                className="form-input"
                type="password"
                autoComplete="off"
                value={secretValue}
                onChange={(e) => setSecretValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveSecret()}
                disabled={!unlocked}
              />
            </div>
            <button className="btn btn-primary btn-full" onClick={handleSaveSecret} disabled={busy || !unlocked || !secretName.trim() || !secretValue}>
              {storedNames.has(secretName.trim()) ? 'Update password' : 'Store password'}
            </button>
            {!unlocked && <div className="text-secondary text-sm mt-8">Unlock the vault to add or change passwords.</div>}
          </div>

          <div className="card">
            <div className="card-title">Fingerprint unlock</div>
            {config.prfWrappedKey ? (
              <>
                <p className="text-secondary text-sm mb-8">Enabled on this phone. The PIN still works as a fallback.</p>
                <button className="btn btn-secondary btn-full" onClick={handleRemoveBiometric} disabled={busy}>Remove fingerprint unlock</button>
              </>
            ) : !isWebAuthnAvailable() ? (
              <p className="text-secondary text-sm">This browser does not support passkeys, so fingerprint unlock is unavailable here.</p>
            ) : biometricAvailable === false ? (
              <p className="text-secondary text-sm">No fingerprint / face authenticator is available on this device.</p>
            ) : (
              <>
                <p className="text-secondary text-sm mb-8">
                  Creates a passkey on this phone whose PRF output wraps the vault key, so your
                  fingerprint or face can unlock it. Requires the vault to be unlocked with the
                  PIN first. If the browser reports that PRF is unsupported, the vault stays PIN-only.
                </p>
                <button className="btn btn-primary btn-full" onClick={handleEnrollBiometric} disabled={busy || !unlocked}>
                  Enable fingerprint unlock
                </button>
                {!unlocked && <div className="text-secondary text-sm mt-8">Unlock with the PIN first.</div>}
              </>
            )}
          </div>

          <div className="card">
            <div className="card-title">Settings</div>
            <div className="form-group">
              <label className="form-label">Auto-lock after</label>
              <select
                className="form-input"
                value={config.autoLockMinutes || DEFAULT_AUTO_LOCK_MINUTES}
                onChange={(e) => handleAutoLockChange(parseInt(e.target.value, 10))}
              >
                {[1, 2, 5, 10, 30].map((m) => (
                  <option key={m} value={m}>{m} minute{m === 1 ? '' : 's'}</option>
                ))}
              </select>
            </div>
            {showChangePin ? (
              <div className="card" style={{ padding: 12 }}>
                <div className="form-group">
                  <label className="form-label">New PIN</label>
                  <input className="form-input" type="password" inputMode="numeric" autoComplete="new-password" value={changePinValue} onChange={(e) => setChangePinValue(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Confirm new PIN</label>
                  <input className="form-input" type="password" inputMode="numeric" autoComplete="new-password" value={changePinConfirm} onChange={(e) => setChangePinConfirm(e.target.value)} />
                </div>
                <div className="flex gap-8">
                  <button className="btn btn-primary btn-sm" onClick={handleChangePin} disabled={busy || !unlocked}>Save PIN</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setShowChangePin(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <button className="btn btn-secondary btn-full mb-8" onClick={() => setShowChangePin(true)} disabled={!unlocked}>Change PIN</button>
            )}
            <button className="btn btn-danger btn-full" onClick={handleDeleteVault} disabled={busy}>Delete vault</button>
          </div>
        </>
      )}

      <div className="card">
        <div className="card-title">How it works</div>
        <p className="text-secondary text-sm">
          Each password is encrypted with AES-GCM under a random key that is itself wrapped by
          your PIN (PBKDF2, 310k rounds) and, optionally, by a passkey PRF output. The plaintext
          is never written to storage and is not included in any export. Anyone who unlocks the
          phone and the vault can read them, so treat the PIN like the passwords it protects.
        </p>
        <Link to={ROUTINES_SETTINGS_PATH} className="text-accent text-sm">Back to routines</Link>
      </div>
    </div>
  );
}
