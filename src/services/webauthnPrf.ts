import { base64UrlToBytes, bytesToBase64Url, VaultError } from './vault';

/**
 * Biometric unlock via the WebAuthn PRF extension. A platform passkey
 * (Android fingerprint / face through Google Password Manager, iOS Face
 * ID / Touch ID on 18+) evaluates a pseudo-random function on a salt we
 * choose; the 32-byte output is stable per credential and is the only
 * thing that leaves the authenticator. `vault.ts` turns it into a
 * wrapping key for the DEK.
 *
 * Everything here is feature-detected. Where PRF is unavailable the
 * vault stays PIN-only and the settings page says why. This file is
 * browser-only and untested in jsdom; the crypto on either side of it is
 * covered by `vault.test.ts`.
 */

const RP_NAME = 'NightStack vault';
const USER_ID = new TextEncoder().encode('nightstack-vault-user');

interface PrfExtensionResults {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer | Uint8Array } };
}

export function isWebAuthnAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.credentials?.create === 'function'
  );
}

/** True when a fingerprint / face authenticator is likely usable here. */
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isWebAuthnAvailable()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

function extractPrfOutput(credential: PublicKeyCredential): Uint8Array | null {
  const ext = credential.getClientExtensionResults() as PrfExtensionResults;
  const first = ext.prf?.results?.first;
  if (!first) return null;
  return first instanceof Uint8Array ? first : new Uint8Array(first);
}

export interface PrfEnrollment {
  credentialId: string; // base64url
  prfSalt: Uint8Array<ArrayBuffer>;
  prfOutput: Uint8Array;
}

/**
 * Create a platform passkey with PRF and evaluate it once. Some browsers
 * only return the PRF output on `get()`, so if `create()` enables PRF
 * but returns no output we immediately assert to fetch it.
 */
export async function enrollBiometric(prfSalt: Uint8Array<ArrayBuffer>): Promise<PrfEnrollment> {
  if (!isWebAuthnAvailable()) throw new VaultError('unsupported', 'WebAuthn is not available');
  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);
  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.create({
      publicKey: {
        rp: { name: RP_NAME, id: window.location.hostname },
        user: { id: USER_ID, name: 'nightstack', displayName: 'NightStack' },
        challenge,
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'required',
          userVerification: 'required',
        },
        timeout: 60_000,
        extensions: { prf: { eval: { first: prfSalt } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
  } catch (e) {
    throw new VaultError('biometric_failed', e instanceof Error ? e.message : 'Enrollment cancelled');
  }
  if (!credential) throw new VaultError('biometric_failed', 'No credential returned');
  const ext = credential.getClientExtensionResults() as PrfExtensionResults;
  if (!ext.prf?.enabled && !ext.prf?.results) {
    throw new VaultError('unsupported', 'This authenticator does not support the PRF extension');
  }
  const credentialId = bytesToBase64Url(new Uint8Array(credential.rawId));
  const direct = extractPrfOutput(credential);
  const prfOutput = direct ?? (await assertBiometric(credentialId, prfSalt));
  return { credentialId, prfSalt, prfOutput };
}

/** Prompt for the fingerprint and return the PRF output for `prfSalt`. */
export async function assertBiometric(credentialId: string, prfSalt: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  if (!isWebAuthnAvailable()) throw new VaultError('unsupported', 'WebAuthn is not available');
  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);
  let assertion: PublicKeyCredential | null;
  try {
    assertion = (await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: window.location.hostname,
        allowCredentials: [{ type: 'public-key', id: base64UrlToBytes(credentialId) }],
        userVerification: 'required',
        timeout: 60_000,
        extensions: { prf: { eval: { first: prfSalt } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
  } catch (e) {
    throw new VaultError('biometric_failed', e instanceof Error ? e.message : 'Fingerprint cancelled');
  }
  if (!assertion) throw new VaultError('biometric_failed', 'No assertion returned');
  const output = extractPrfOutput(assertion);
  if (!output) throw new VaultError('unsupported', 'Authenticator returned no PRF output');
  return output;
}
