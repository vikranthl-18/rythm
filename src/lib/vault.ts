// ---------------------------------------------------------------------------
// Privacy vault — "your physiology never leaves your device."
//
// The app is local-first: data lives in localStorage and nothing is synced.
// For backups (or moving to another device) we offer a passphrase-encrypted
// vault: AES-256-GCM with a PBKDF2-derived key. The passphrase never touches
// disk or a server — if you lose it, the vault is unrecoverable. That's the
// point: only you hold the key.
// ---------------------------------------------------------------------------

const PBKDF2_ITERATIONS = 150_000;

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export function vaultAvailable(): boolean {
  return typeof crypto !== "undefined" && !!crypto.subtle;
}

/**
 * Encrypt a JSON string into a self-contained vault payload:
 * `v1.<salt b64>.<iv b64>.<ciphertext b64>`.
 */
export async function encryptVault(plaintext: string, passphrase: string): Promise<string> {
  const salt: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(16));
  const iv: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return `v1.${toB64(salt)}.${toB64(iv)}.${toB64(new Uint8Array(ct))}`;
}

/** Decrypt a vault payload. Throws on a wrong passphrase or tampered data. */
export async function decryptVault(payload: string, passphrase: string): Promise<string> {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Unrecognized vault format");
  const salt = fromB64(parts[1]);
  const iv = fromB64(parts[2]);
  const ct = fromB64(parts[3]);
  const key = await deriveKey(passphrase, salt);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

// ---------------------------------------------------------------------------
// localStorage snapshot helpers (what the vault encrypts)
// ---------------------------------------------------------------------------

/** Collect every rythm-* localStorage key into a JSON string. */
export function snapshotLocalData(): string {
  const data: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("rythm-")) data[k] = localStorage.getItem(k) ?? "";
  }
  return JSON.stringify(data);
}

/** Write a snapshot back into localStorage (must match the snapshot shape). */
export function restoreLocalData(snapshot: string): void {
  const data = JSON.parse(snapshot) as Record<string, string>;
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith("rythm-")) localStorage.setItem(k, v);
  }
}
