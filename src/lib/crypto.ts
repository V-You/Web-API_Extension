/**
 * PIN-based credential encryption using Web Crypto API.
 *
 * Credentials are encrypted with AES-GCM using a key derived from the
 * user's PIN via PBKDF2. The encryption key is never stored -- only the
 * salt, IV, and ciphertext are persisted in chrome.storage.local.
 */

const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface EncryptedBlob {
  /** Base64-encoded PBKDF2 salt */
  salt: string;
  /** Base64-encoded AES-GCM IV */
  iv: string;
  /** Base64-encoded ciphertext */
  ciphertext: string;
}

function toBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromBase64(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    buf[i] = binary.charCodeAt(i);
  }
  return buf.buffer;
}

async function deriveKey(
  pin: string,
  salt: ArrayBuffer
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/** Encrypt plaintext credentials with a user-provided PIN. */
export async function encrypt(
  pin: string,
  plaintext: string
): Promise<EncryptedBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(pin, salt.buffer);

  const encoder = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext)
  );

  return {
    salt: toBase64(salt.buffer),
    iv: toBase64(iv.buffer),
    ciphertext: toBase64(ciphertext),
  };
}

/** Decrypt credentials with the user's PIN. Throws on wrong PIN. */
export async function decrypt(
  pin: string,
  blob: EncryptedBlob
): Promise<string> {
  const salt = fromBase64(blob.salt);
  const iv = fromBase64(blob.iv);
  const ciphertext = fromBase64(blob.ciphertext);
  const key = await deriveKey(pin, salt);

  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv) },
    key,
    ciphertext
  );

  return new TextDecoder().decode(plainBuf);
}
