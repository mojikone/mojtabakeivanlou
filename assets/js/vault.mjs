// Vault crypto primitives (spec section 12). WebCrypto only, no library.
// Shared by the public site, the admin dashboard and Node tests, so it must run unchanged in
// browsers and in Node 22: only globalThis.crypto, btoa/atob and TextEncoder/TextDecoder are
// used. No Node-only imports or globals.

const IV_BYTES = 12;                 // AES-GCM nonce size, fresh and random for every seal/encryptFile
const TAG_BYTES = 16;                // GCM authentication tag, appended to the ciphertext by WebCrypto
const SALT_BYTES = 16;               // minimum PBKDF2 salt; access.json carries one site-wide salt
const KDF_ITERATIONS = 600000;       // production PBKDF2 cost (spec section 12)
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

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

// 128 random bits as 32 lowercase hex characters (file ids).
export function randomId() {
  return hex(randomBytes(16));
}

// 32 random bits as 8 lowercase hex characters (access-entry ids and vault-key ids).
export function shortId() {
  return hex(randomBytes(4));
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
// site-wide salt (at least 16 bytes). Extractable on purpose: the dashboard keeps the raw KEK in
// sessionStorage.
export async function deriveKek(code, saltB64, iterations) {
  if (typeof code !== 'string' || code === '') throw new TypeError('deriveKek: code must be a non-empty string');
  if (!Number.isInteger(iterations) || iterations < 1) throw new RangeError('deriveKek: iterations must be a positive integer');
  const salt = fromB64(saltB64);
  if (salt.length < SALT_BYTES) throw new Error('salt too short');
  const material = await subtle().importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
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

// async, so malformed input rejects instead of throwing synchronously.
export async function importKey(b64) {
  const raw = fromB64(b64);
  if (raw.length !== 32) throw new RangeError('importKey: expected a 256-bit key');
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
// iv or data, or malformed input (a missing `sealed` included). It never returns partial data.
export async function open(key, sealed) {
  try {
    const { iv, data } = sealed;
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

/* ─── ACCESS FILE AND KEYS FILE ─── */

// vault/access.json  { v: 1, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt }, entries: [entry] }
//   entry            { id (8 hex), kind: 'admin' | 'download', iv, data, meta: { iv, data } }
//   iv, data         seal(KEK of the entry's code, JSON payload)
//                      admin payload    { vk: <b64 VK>, github: { token, owner, repo, branch } }
//                      download payload { vk: <b64 VK> }
//   meta             seal(VK, JSON { label, created, code? }); the admin meta never holds the admin code
// vault/keys.json    { v: 1, vk: <8-hex id of the current VK>, files: { <file id>: { iv, key } } }
//   iv, key          seal(VK, raw 32-byte file key)
//
// Every function here returns new objects and never mutates its arguments. Error messages never
// contain a code, a key or a token.

const KINDS = ['admin', 'download'];

const sealJson = (key, value) => seal(key, new TextEncoder().encode(JSON.stringify(value)));
const openJson = async (key, sealed) => JSON.parse(new TextDecoder().decode(await open(key, sealed)));

// Codes are trimmed wherever they are used, so the code a KEK is derived from at addEntry is the
// one unlock and rotateVault derive again.
const normCode = (code) => (typeof code === 'string' ? code.trim() : '');
const deriveFor = (access, code) => deriveKek(code, access.kdf.salt, access.kdf.iterations);

function checkAccess(access) {
  const kdf = access?.kdf;
  if (access?.v !== 1 || kdf?.name !== 'PBKDF2' || kdf?.hash !== 'SHA-256' || !Array.isArray(access.entries)) {
    throw new TypeError('Unsupported access file');
  }
}

// The first of `entries` that `kek` opens, with its payload, or null.
async function openAny(entries, kek) {
  for (const entry of entries) {
    try {
      return { entry, payload: await openJson(kek, { iv: entry.iv, data: entry.data }) };
    } catch {
      // not this entry
    }
  }
  return null;
}

export function createAccessFile(iterations = KDF_ITERATIONS) {
  if (!Number.isInteger(iterations) || iterations < 1) throw new RangeError('createAccessFile: iterations must be a positive integer');
  return {
    v: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toB64(randomBytes(SALT_BYTES)) },
    entries: [],
  };
}

export function createKeysFile(vkId) {
  return { v: 1, vk: vkId, files: {} };
}

// The entry a typed code opens: { entry, kind, payload, kek } or null. The code is trimmed and
// tried as typed, then upper-cased (download codes are MK-XXXX-XXXX in capitals). One PBKDF2
// derivation per candidate, then one cheap AES-GCM attempt per entry, admin entries first.
export async function unlock(access, code) {
  checkAccess(access);
  const typed = normCode(code);
  if (!typed || access.entries.length === 0) return null;
  const ordered = [...access.entries.filter((e) => e.kind === 'admin'), ...access.entries.filter((e) => e.kind !== 'admin')];
  for (const candidate of new Set([typed, typed.toUpperCase()])) {
    const kek = await deriveFor(access, candidate);
    const hit = await openAny(ordered, kek);
    if (hit) return { entry: hit.entry, kind: hit.entry.kind, payload: hit.payload, kek };
  }
  return null;
}

// A copy of `access` with one more entry (appended last, so it is `.entries.at(-1)`). `payload.vk`
// must be the base64 of `vk`. Refuses a code that already opens an entry: two entries behind one
// code would make unlock ambiguous (and a download code equal to the admin code would open admin).
export async function addEntry(access, { kind, code, payload, meta }, vk) {
  checkAccess(access);
  if (!KINDS.includes(kind)) throw new TypeError('addEntry: kind must be "admin" or "download"');
  const c = normCode(code);
  if (!c) throw new TypeError('addEntry: code must be a non-empty string');
  if (!meta || typeof meta !== 'object') throw new TypeError('addEntry: meta must be an object');
  if (kind === 'admin' && 'code' in meta) throw new TypeError('addEntry: the admin entry meta must not hold the admin code');
  if (!payload || typeof payload !== 'object' || payload.vk !== await exportKey(vk)) {
    throw new Error('addEntry: payload.vk must be the vault key');
  }
  const kek = await deriveFor(access, c);
  if (await openAny(access.entries, kek)) throw new Error('addEntry: this code is already in use');
  const taken = new Set(access.entries.map((e) => e.id));
  let id;
  do id = shortId(); while (taken.has(id));
  const entry = { id, kind, ...(await sealJson(kek, payload)), meta: await sealJson(vk, meta) };
  return { ...access, kdf: { ...access.kdf }, entries: [...access.entries, entry] };
}

// An entry's plaintext meta { label, created, code? }; rejects ('decrypt failed') without the right VK.
export async function readMeta(entry, vk) {
  return openJson(vk, entry?.meta);
}

export async function wrapFileKey(vk, fk) {
  const { iv, data } = await seal(vk, fromB64(await exportKey(fk)));
  return { iv, key: data };
}

export async function unwrapFileKey(vk, wrapped) {
  const raw = await open(vk, wrapped && { iv: wrapped.iv, data: wrapped.key });
  return importKey(toB64(raw));
}

// Revoke / rotate: a new VK with a new keys.vk id; every file key rewrapped under it; every kept
// entry's payload (with `vk` replaced by the new VK) re-sealed under its own KEK and its meta
// re-sealed under the new VK; entries in `dropIds` removed. The admin entry `adminEntryId` uses
// `kek`; every other kept entry needs its code in `codesById`. Everything is checked before
// anything is built, so it throws (never silently drops access) when a code is missing or does
// not open its entry, when `vk` does not open a meta or a file key, or when asked to drop the
// admin entry in use.
export async function rotateVault({ access, keys, vk, kek, adminEntryId, codesById = {}, dropIds = [] }) {
  checkAccess(access);
  if (keys?.v !== 1 || !keys.files || typeof keys.files !== 'object') throw new TypeError('rotateVault: unsupported keys file');
  const admin = access.entries.find((e) => e.id === adminEntryId);
  if (!admin || admin.kind !== 'admin') throw new Error('rotateVault: adminEntryId is not an admin entry');
  const drop = new Set(dropIds);
  if (drop.has(adminEntryId)) throw new Error('rotateVault: cannot drop the admin entry in use');
  for (const id of drop) {
    if (!access.entries.some((e) => e.id === id)) throw new Error(`rotateVault: no entry ${id} to drop`);
  }
  const kept = access.entries.filter((e) => !drop.has(e.id));

  // Open everything with the current keys first.
  const opened = await Promise.all(kept.map(async (e) => {
    let entryKek = kek;
    if (e.id !== adminEntryId) {
      const code = normCode(codesById[e.id]);
      if (!code) throw new Error(`rotateVault: no code for entry ${e.id}`);
      entryKek = await deriveFor(access, code);
    }
    let payload, meta;
    try {
      payload = await openJson(entryKek, { iv: e.iv, data: e.data });
    } catch {
      throw new Error(`rotateVault: the key for entry ${e.id} does not open it`);
    }
    try {
      meta = await readMeta(e, vk);
    } catch {
      throw new Error(`rotateVault: the vault key does not open the meta of entry ${e.id}`);
    }
    return { e, entryKek, payload, meta };
  }));
  const fileKeys = await Promise.all(Object.entries(keys.files).map(async ([id, wrapped]) => {
    try {
      return [id, await unwrapFileKey(vk, wrapped)];
    } catch {
      throw new Error(`rotateVault: the vault key does not unwrap file key ${id}`);
    }
  }));

  // Then seal everything again under a new vault key.
  const newVk = await generateKey();
  const newVkB64 = await exportKey(newVk);
  const entries = await Promise.all(opened.map(async ({ e, entryKek, payload, meta }) => ({
    id: e.id,
    kind: e.kind,
    ...(await sealJson(entryKek, { ...payload, vk: newVkB64 })),
    meta: await sealJson(newVk, meta),
  })));
  const files = {};
  for (const [id, fk] of fileKeys) files[id] = await wrapFileKey(newVk, fk);
  let vkId;
  do vkId = shortId(); while (vkId === keys.vk);
  return {
    access: { ...access, kdf: { ...access.kdf }, entries },
    keys: { ...keys, vk: vkId, files },
    vk: newVk,
  };
}
