// Vault crypto primitives (spec section 12). WebCrypto only, no library.
// Shared by the public site, the admin dashboard and Node tests, so it must run unchanged in
// browsers and in Node 22: only globalThis.crypto, btoa/atob and TextEncoder/TextDecoder are
// used. No Node-only imports or globals.

const IV_BYTES = 12;                 // AES-GCM nonce size, fresh and random for every seal/encryptFile
const TAG_BYTES = 16;                // GCM authentication tag, appended to the ciphertext by WebCrypto
const RANDOM_CHUNK = 65536;          // getRandomValues refuses more than 64 KiB per call
const B64_CHUNK = 0x8000;            // keeps String.fromCharCode argument lists small
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 symbols: no I, O, 0, 1
const AES = { name: 'AES-GCM', length: 256 };
const USAGES = ['encrypt', 'decrypt'];

// Looked up on use rather than at import, so importing this module never throws in a context
// without WebCrypto (the functions below then fail with a clear TypeError instead).
const subtle = () => globalThis.crypto.subtle;

/* ─── BYTES AND BASE64 ─── */

// Any ArrayBuffer or typed-array view, as a Uint8Array over the same memory.
function asBytes(x) {
  if (x instanceof Uint8Array) return x;
  if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  throw new TypeError('Expected a Uint8Array');
}

export function toB64(bytes) {
  const b = asBytes(bytes);
  let bin = '';
  for (let i = 0; i < b.length; i += B64_CHUNK) {
    bin += String.fromCharCode.apply(null, b.subarray(i, i + B64_CHUNK));
  }
  return btoa(bin);
}

export function fromB64(s) {
  if (typeof s !== 'string') throw new TypeError('Expected a base64 string');
  const bin = atob(s); // throws on characters outside the base64 alphabet
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ─── RANDOMNESS, IDS AND CODES ─── */

export function randomBytes(n) {
  if (!Number.isInteger(n) || n < 0) throw new RangeError('randomBytes: length must be a non-negative integer');
  const out = new Uint8Array(n);
  for (let off = 0; off < n; off += RANDOM_CHUNK) {
    globalThis.crypto.getRandomValues(out.subarray(off, Math.min(off + RANDOM_CHUNK, n)));
  }
  return out;
}

// 128 random bits as 32 lowercase hex characters (file ids).
export function randomId() {
  return Array.from(randomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('');
}

// MK-XXXX-XXXX, 8 symbols from a 32-symbol alphabet = 40 bits. The alphabet size is a power
// of two, so `byte & 31` maps a uniform byte to a uniform symbol with no modulo bias.
export function generateDownloadCode() {
  let s = '';
  for (const b of randomBytes(8)) s += CODE_ALPHABET[b & 31];
  return `MK-${s.slice(0, 4)}-${s.slice(4)}`;
}

// Admin code rule: at least 12 characters drawn from at least 3 of 4 classes
// (lowercase a-z, uppercase A-Z, digits 0-9, anything else). `length` counts characters
// (code points), not UTF-16 units.
export function codeStrength(code) {
  const s = typeof code === 'string' ? code : '';
  const length = Array.from(s).length;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(s)).length;
  return { ok: length >= 12 && classes >= 3, length, classes };
}

/* ─── KEYS ─── */

// code -> key-encryption key. PBKDF2-HMAC-SHA-256 over the UTF-8 bytes of `code`, with the
// site-wide salt. Extractable on purpose: the dashboard keeps the raw KEK in sessionStorage.
export async function deriveKek(code, saltB64, iterations) {
  if (typeof code !== 'string' || code === '') throw new TypeError('deriveKek: code must be a non-empty string');
  if (!Number.isInteger(iterations) || iterations < 1) throw new RangeError('deriveKek: iterations must be a positive integer');
  const material = await subtle().importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations },
    material,
    AES,
    true,
    USAGES,
  );
}

export function generateKey() {
  return subtle().generateKey(AES, true, USAGES);
}

// Raw 256-bit key as base64.
export async function exportKey(key) {
  return toB64(new Uint8Array(await subtle().exportKey('raw', key)));
}

export function importKey(b64) {
  const raw = fromB64(b64);
  if (raw.length !== 32) return Promise.reject(new RangeError('importKey: expected a 256-bit key'));
  return subtle().importKey('raw', raw, AES, true, USAGES);
}

/* ─── SEAL / OPEN (small payloads, base64 fields for JSON) ─── */

async function encryptRaw(key, bytes) {
  const iv = randomBytes(IV_BYTES);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, asBytes(bytes)));
  return { iv, ct };
}

// AES-256-GCM with a fresh random IV. `data` is ciphertext || tag.
export async function seal(key, bytes) {
  const { iv, ct } = await encryptRaw(key, bytes);
  return { iv: toB64(iv), data: toB64(ct) };
}

// Inverse of seal. Rejects with Error('decrypt failed') on a wrong key, any altered byte of
// iv or data, or malformed input. It never returns partial data.
export async function open(key, { iv, data }) {
  try {
    const ivBytes = fromB64(iv);
    if (ivBytes.length !== IV_BYTES) throw new Error('bad iv length');
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: ivBytes }, key, fromB64(data)));
  } catch (cause) {
    throw new Error('decrypt failed', { cause });
  }
}

/* ─── FILE BLOBS ─── */

// vault/files/<id>.bin layout: IV (12 bytes) || AES-256-GCM(FK, IV, plaintext) incl. 16-byte tag.
export async function encryptFile(fk, plain) {
  const { iv, ct } = await encryptRaw(fk, plain);
  const out = new Uint8Array(IV_BYTES + ct.length);
  out.set(iv, 0);
  out.set(ct, IV_BYTES);
  return out;
}

export async function decryptFile(fk, blob) {
  try {
    const b = asBytes(blob);
    if (b.length < IV_BYTES + TAG_BYTES) throw new Error('blob too short');
    const iv = b.subarray(0, IV_BYTES);
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv }, fk, b.subarray(IV_BYTES)));
  } catch (cause) {
    throw new Error('decrypt failed', { cause });
  }
}

/* ─── DISPLAY ─── */

// '512 B', '812 kB', '4.2 MB', '1.1 GB': no decimals below 1 MB, one decimal from there. Units
// are 1024-based, as in the spec's own example (4403211 bytes = '4.2 MB' only holds at 1024^2);
// change UNIT to 1000 for SI sizes. A value that would round up to a full 1024 of its unit
// is shown in the next unit instead (1 048 575 bytes is '1.0 MB', never '1024 kB').
const UNIT = 1024;

export function formatSize(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) {
    throw new RangeError('formatSize: expected a non-negative finite number');
  }
  const n = Math.round(bytes);
  if (n < UNIT) return `${n} B`;
  const kb = Math.round(n / UNIT);
  if (kb < UNIT) return `${kb} kB`;
  const mb = (n / UNIT ** 2).toFixed(1);
  if (Number(mb) < UNIT) return `${mb} MB`;
  return `${(n / UNIT ** 3).toFixed(1)} GB`;
}
