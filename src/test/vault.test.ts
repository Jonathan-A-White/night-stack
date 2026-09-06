import { describe, it, expect, beforeEach } from 'vitest';
import {
  VaultError,
  base64ToBytes,
  base64UrlToBytes,
  bytesToBase64,
  bytesToBase64Url,
  changePin,
  createVault,
  decryptSecret,
  encryptSecret,
  enrollPrfKey,
  getUnlockedDek,
  isVaultUnlocked,
  lockVault,
  onVaultStateChange,
  removePrfKey,
  setUnlocked,
  unlockWithPin,
  unlockWithPrfOutput,
} from '../services/vault';

/**
 * Vault envelope (specs/routines/vault.md): PIN-wrapped DEK, optional
 * PRF-wrapped DEK, AES-GCM secrets. Runs on Node's WebCrypto under jsdom.
 */

function fakePrfOutput(seed: number): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) out[i] = (seed * 31 + i * 7) % 256;
  return out;
}

describe('base64 helpers', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    expect(base64UrlToBytes(bytesToBase64Url(bytes))).toEqual(bytes);
  });

  it('base64url has no padding or unsafe characters', () => {
    const b64url = bytesToBase64Url(new Uint8Array([251, 255, 191, 62]));
    expect(b64url).not.toMatch(/[+/=]/);
  });
});

describe('vault envelope', () => {
  it('creates a vault and unlocks it with the right PIN', async () => {
    const { config } = await createVault('2468');
    expect(config.id).toBe('default');
    expect(config.prfWrappedKey).toBeNull();
    expect(config.kdfIterations).toBeGreaterThanOrEqual(100_000);
    const dek = await unlockWithPin(config, '2468');
    expect(dek.type).toBe('secret');
  });

  it('rejects a wrong PIN with VaultError(wrong_pin)', async () => {
    const { config } = await createVault('2468');
    await expect(unlockWithPin(config, '2469')).rejects.toMatchObject({ code: 'wrong_pin' });
    await expect(unlockWithPin(config, '2469')).rejects.toBeInstanceOf(VaultError);
  });

  it('refuses a PIN shorter than four characters', async () => {
    await expect(createVault('123')).rejects.toThrow();
  });

  it('encrypts and decrypts a secret; ciphertext never contains the plaintext', async () => {
    const { config, dek } = await createVault('2468');
    const secret = await encryptSecret(dek, 'Uncased iPad password', 'hunter2-Sunday');
    expect(secret.name).toBe('Uncased iPad password');
    expect(secret.ciphertext).not.toContain('hunter2');
    expect(JSON.stringify(secret)).not.toContain('hunter2');
    expect(JSON.stringify(config)).not.toContain('hunter2');
    // A fresh unlock (new CryptoKey object) decrypts it.
    const again = await unlockWithPin(config, '2468');
    expect(await decryptSecret(again, secret)).toBe('hunter2-Sunday');
  });

  it('binds the ciphertext to the secret name (AAD)', async () => {
    const { dek } = await createVault('2468');
    const secret = await encryptSecret(dek, 'A', 'value');
    await expect(decryptSecret(dek, { ...secret, name: 'B' })).rejects.toThrow();
  });

  it('a different vault cannot decrypt the secret', async () => {
    const a = await createVault('2468');
    const b = await createVault('2468');
    const secret = await encryptSecret(a.dek, 'A', 'value');
    await expect(decryptSecret(b.dek, secret)).rejects.toThrow();
  });

  it('changePin re-wraps the DEK without touching secrets', async () => {
    const { config, dek } = await createVault('2468');
    const secret = await encryptSecret(dek, 'A', 'value');
    const next = await changePin(config, dek, '13579');
    expect(next.kdfSalt).not.toBe(config.kdfSalt);
    await expect(unlockWithPin(next, '2468')).rejects.toMatchObject({ code: 'wrong_pin' });
    const dek2 = await unlockWithPin(next, '13579');
    expect(await decryptSecret(dek2, secret)).toBe('value');
  });

  it('enrolls a PRF key so either PIN or PRF output unlocks the same DEK', async () => {
    const { config, dek } = await createVault('2468');
    const secret = await encryptSecret(dek, 'A', 'value');
    const salt = new Uint8Array(32);
    const prf = fakePrfOutput(1);
    const enrolled = await enrollPrfKey(config, dek, 'cred-id', salt, prf);
    expect(enrolled.prfWrappedKey?.credentialId).toBe('cred-id');
    // PIN still works.
    expect(await decryptSecret(await unlockWithPin(enrolled, '2468'), secret)).toBe('value');
    // PRF works.
    expect(await decryptSecret(await unlockWithPrfOutput(enrolled, prf), secret)).toBe('value');
    // A different PRF output does not.
    await expect(unlockWithPrfOutput(enrolled, fakePrfOutput(2))).rejects.toMatchObject({ code: 'biometric_failed' });
    // Removing the PRF wrap leaves the PIN path intact.
    const removed = removePrfKey(enrolled);
    expect(removed.prfWrappedKey).toBeNull();
    await expect(unlockWithPrfOutput(removed, prf)).rejects.toMatchObject({ code: 'no_biometric' });
    expect(await decryptSecret(await unlockWithPin(removed, '2468'), secret)).toBe('value');
  });
});

describe('unlocked session', () => {
  beforeEach(() => lockVault());

  it('caches the DEK until the TTL expires', async () => {
    const { dek } = await createVault('2468');
    setUnlocked(dek, 60_000, 1_000);
    expect(getUnlockedDek(30_000)).toBe(dek);
    expect(isVaultUnlocked(30_000)).toBe(true);
    expect(getUnlockedDek(61_001)).toBeNull();
    expect(isVaultUnlocked(61_001)).toBe(false);
  });

  it('lockVault clears the DEK and notifies listeners', async () => {
    const { dek } = await createVault('2468');
    let calls = 0;
    const off = onVaultStateChange(() => { calls += 1; });
    setUnlocked(dek, 60_000, 0);
    expect(calls).toBe(1);
    lockVault();
    expect(calls).toBe(2);
    expect(getUnlockedDek(1)).toBeNull();
    lockVault(); // no-op, no extra notification
    expect(calls).toBe(2);
    off();
  });
});
