import type { PrfWrappedKey, Secret, VaultConfig, WrappedKey } from '../types';

/**
 * Encrypted-at-rest secrets for routine steps (iPad passwords and the
 * like). Pure WebCrypto; nothing here touches the database or the DOM,
 * so the whole envelope can be unit-tested under Node's webcrypto.
 *
 * Design (types.ts `VaultConfig`):
 *   - A random 256-bit AES-GCM data-encryption key (DEK) encrypts every
 *     secret value. The DEK is generated in memory and only ever
 *     persisted as *wrapped* bytes.
 *   - The DEK is wrapped under a key derived from the PIN with PBKDF2
 *     (SHA-256, `PBKDF2_ITERATIONS`). Wrong PIN → AES-GCM tag check
 *     fails → `VaultError('wrong_pin')`.
 *   - Optionally the DEK is also wrapped under an HKDF key derived from
 *     a WebAuthn PRF output (`webauthnPrf.ts`), so the phone's
 *     fingerprint / face unlock can open the vault. Either wrap yields
 *     the same DEK, so enrolling or removing biometrics never
 *     re-encrypts the secrets themselves.
 *
 * What this does NOT protect against: someone who can run code in this
 * origin while the vault is unlocked (the DEK is in memory for
 * `autoLockMinutes`), or a compromised device. It does protect the
 * plaintext in IndexedDB, in DevTools "Application" views, and in any
 * JSON export, which is the realistic threat for a phone that gets
 * handed around a sound booth.
 */

export const PBKDF2_ITERATIONS = 310_000;
export const DEFAULT_AUTO_LOCK_MINUTES = 5;
const AES_KEY_BITS = 256;
const IV_BYTES = 12;
const SALT_BYTES = 16;

export type VaultErrorCode =
  | 'wrong_pin'
  | 'no_vault'
  | 'locked'
  | 'no_biometric'
  | 'biometric_failed'
  | 'unsupported';

export class VaultError extends Error {
  code: VaultErrorCode;
  constructor(code: VaultErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'VaultError';
    this.code = code;
  }
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new VaultError('unsupported', 'WebCrypto is not available');
  return s;
}

// --- base64 helpers (binary-safe, no external deps) ---

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4);
  return base64ToBytes(padded);
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** Copy into a fresh ArrayBuffer so WebCrypto never sees a shared/offset view. */
function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

// --- key derivation ---

/** PBKDF2(PIN, salt) → non-extractable AES-GCM wrapping key. */
export async function deriveKeyFromPin(
  pin: string,
  salt: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  const material = await subtle().importKey(
    'raw', new TextEncoder().encode(pin.normalize('NFKC')), 'PBKDF2', false, ['deriveKey'],
  );
  return subtle().deriveKey(
    { name: 'PBKDF2', salt: toBuffer(salt), iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: AES_KEY_BITS },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

/** HKDF(PRF output) → non-extractable AES-GCM wrapping key. */
export async function deriveKeyFromPrfOutput(prfOutput: Uint8Array): Promise<CryptoKey> {
  const material = await subtle().importKey('raw', toBuffer(prfOutput), 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32).buffer,
      info: new TextEncoder().encode('nightstack-vault-prf-v1'),
    },
    material,
    { name: 'AES-GCM', length: AES_KEY_BITS },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

async function generateDek(): Promise<CryptoKey> {
  // Extractable so it can be wrapped; the wrapped form is the only thing
  // persisted. Consumers only ever hold the CryptoKey object.
  return subtle().generateKey({ name: 'AES-GCM', length: AES_KEY_BITS }, true, ['encrypt', 'decrypt']);
}

async function wrapDek(dek: CryptoKey, wrappingKey: CryptoKey): Promise<WrappedKey> {
  const iv = randomBytes(IV_BYTES);
  const wrapped = await subtle().wrapKey('raw', dek, wrappingKey, { name: 'AES-GCM', iv: toBuffer(iv) });
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(wrapped)) };
}

async function unwrapDek(wrapped: WrappedKey, wrappingKey: CryptoKey): Promise<CryptoKey> {
  return subtle().unwrapKey(
    'raw',
    toBuffer(base64ToBytes(wrapped.ciphertext)),
    wrappingKey,
    { name: 'AES-GCM', iv: toBuffer(base64ToBytes(wrapped.iv)) },
    { name: 'AES-GCM', length: AES_KEY_BITS },
    true,
    ['encrypt', 'decrypt'],
  );
}

// --- vault lifecycle ---

/** Create a new vault config with a fresh DEK wrapped under `pin`. */
export async function createVault(
  pin: string,
  now: number = Date.now(),
): Promise<{ config: VaultConfig; dek: CryptoKey }> {
  if (pin.length < 4) throw new Error('PIN must be at least 4 characters');
  const salt = randomBytes(SALT_BYTES);
  const dek = await generateDek();
  const pinKey = await deriveKeyFromPin(pin, salt);
  const config: VaultConfig = {
    id: 'default',
    kdfSalt: bytesToBase64(salt),
    kdfIterations: PBKDF2_ITERATIONS,
    pinWrappedKey: await wrapDek(dek, pinKey),
    prfWrappedKey: null,
    autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES,
    createdAt: now,
    updatedAt: now,
  };
  return { config, dek };
}

/** Unlock with the PIN. Throws `VaultError('wrong_pin')` on a bad PIN. */
export async function unlockWithPin(config: VaultConfig, pin: string): Promise<CryptoKey> {
  const pinKey = await deriveKeyFromPin(pin, base64ToBytes(config.kdfSalt), config.kdfIterations);
  try {
    return await unwrapDek(config.pinWrappedKey, pinKey);
  } catch {
    throw new VaultError('wrong_pin', 'Wrong PIN');
  }
}

/** Re-wrap the DEK under a new PIN (fresh salt). Secrets are untouched. */
export async function changePin(
  config: VaultConfig,
  dek: CryptoKey,
  newPin: string,
  now: number = Date.now(),
): Promise<VaultConfig> {
  if (newPin.length < 4) throw new Error('PIN must be at least 4 characters');
  const salt = randomBytes(SALT_BYTES);
  const pinKey = await deriveKeyFromPin(newPin, salt);
  return {
    ...config,
    kdfSalt: bytesToBase64(salt),
    kdfIterations: PBKDF2_ITERATIONS,
    pinWrappedKey: await wrapDek(dek, pinKey),
    updatedAt: now,
  };
}

/** Wrap the DEK under a PRF-derived key so biometrics can unlock it. */
export async function enrollPrfKey(
  config: VaultConfig,
  dek: CryptoKey,
  credentialId: string,
  prfSalt: Uint8Array,
  prfOutput: Uint8Array,
  now: number = Date.now(),
): Promise<VaultConfig> {
  const prfKey = await deriveKeyFromPrfOutput(prfOutput);
  const wrapped = await wrapDek(dek, prfKey);
  const prfWrappedKey: PrfWrappedKey = {
    ...wrapped,
    credentialId,
    prfSalt: bytesToBase64(prfSalt),
  };
  return { ...config, prfWrappedKey, updatedAt: now };
}

/** Unlock with a PRF output obtained from the enrolled authenticator. */
export async function unlockWithPrfOutput(config: VaultConfig, prfOutput: Uint8Array): Promise<CryptoKey> {
  if (!config.prfWrappedKey) throw new VaultError('no_biometric', 'No fingerprint enrolled');
  const prfKey = await deriveKeyFromPrfOutput(prfOutput);
  try {
    return await unwrapDek(config.prfWrappedKey, prfKey);
  } catch {
    throw new VaultError('biometric_failed', 'Fingerprint key did not unlock the vault');
  }
}

export function removePrfKey(config: VaultConfig, now: number = Date.now()): VaultConfig {
  return { ...config, prfWrappedKey: null, updatedAt: now };
}

// --- secrets ---

export async function encryptSecret(
  dek: CryptoKey,
  name: string,
  value: string,
  now: number = Date.now(),
  createdAt: number = now,
): Promise<Secret> {
  const iv = randomBytes(IV_BYTES);
  const ciphertext = await subtle().encrypt(
    { name: 'AES-GCM', iv: toBuffer(iv), additionalData: new TextEncoder().encode(name) },
    dek,
    new TextEncoder().encode(value),
  );
  return {
    name,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    createdAt,
    updatedAt: now,
  };
}

export async function decryptSecret(dek: CryptoKey, secret: Secret): Promise<string> {
  const plain = await subtle().decrypt(
    {
      name: 'AES-GCM',
      iv: toBuffer(base64ToBytes(secret.iv)),
      additionalData: new TextEncoder().encode(secret.name),
    },
    dek,
    toBuffer(base64ToBytes(secret.ciphertext)),
  );
  return new TextDecoder().decode(plain);
}

// --- in-memory unlocked session ---
//
// The DEK lives here between unlock and auto-lock. Module state on
// purpose: every SecretReveal on the page shares one unlock, and a page
// reload drops it (there is nothing to persist).

let unlockedDek: CryptoKey | null = null;
let unlockedUntil = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

export function setUnlocked(dek: CryptoKey, ttlMs: number, now: number = Date.now()): void {
  unlockedDek = dek;
  unlockedUntil = now + ttlMs;
  notify();
}

export function getUnlockedDek(now: number = Date.now()): CryptoKey | null {
  if (unlockedDek && now < unlockedUntil) return unlockedDek;
  if (unlockedDek) lockVault();
  return null;
}

export function isVaultUnlocked(now: number = Date.now()): boolean {
  return getUnlockedDek(now) != null;
}

export function lockVault(): void {
  const wasUnlocked = unlockedDek != null;
  unlockedDek = null;
  unlockedUntil = 0;
  if (wasUnlocked) notify();
}

/** Subscribe to lock / unlock transitions. Returns an unsubscribe. */
export function onVaultStateChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
