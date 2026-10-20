// Pending attachments for the admin dashboard (spec sections 12 and 13.4).
// Files the owner attaches are encrypted straight away; the ciphertext waits in a byte store
// (IndexedDB database "mk-files", object store "pending") until publish uploads it, because it can be
// far too large for localStorage. Only ciphertext is ever stored here, and nothing in this module
// logs file contents or keys. Browser-safe: no Node imports, `indexedDB` is injectable.
import { generateKey, encryptFile, wrapFileKey, unwrapFileKey, decryptFile, randomId } from '../../assets/js/vault.mjs';

const DB_NAME = 'mk-files';
const DB_VERSION = 1;
const STORE = 'pending';
const UNAVAILABLE = 'IndexedDB unavailable';
const OCTET_STREAM = 'application/octet-stream';

function assertBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Expected a Uint8Array');
}

/* ─── BYTE STORES ─── */

// Both stores share one interface (every method returns a promise):
//   put(id, bytes) · get(id) -> Uint8Array | null · delete(id) (a missing id is fine) · list() -> ids · clear()

// IndexedDB-backed store. The connection is opened on first use and then reused; with no
// IndexedDB every method rejects with Error('IndexedDB unavailable').
export function createFileStore({ idb = globalThis.indexedDB } = {}) {
  let opening = null;

  function connect() {
    if (!idb) return Promise.reject(new Error(UNAVAILABLE));
    if (opening) return opening;
    const attempt = new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error) => { settled = true; reject(error); };
      let req;
      try {
        req = idb.open(DB_NAME, DB_VERSION);
      } catch (error) {
        fail(error);
        return;
      }
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onerror = () => fail(req.error ?? new Error('IndexedDB open failed'));
      // Another tab holds an older connection open while this one wants to upgrade.
      req.onblocked = () => fail(new Error('IndexedDB blocked'));
      req.onsuccess = () => {
        const db = req.result;
        if (settled) { db.close(); return; } // opened after we gave up on it: do not leak the connection
        // Let a newer version (another tab) upgrade, and reconnect on the next call.
        db.onversionchange = () => { db.close(); if (opening === attempt) opening = null; };
        settled = true;
        resolve(db);
      };
    });
    opening = attempt;
    attempt.catch(() => { if (opening === attempt) opening = null; }); // a failed open is retried on the next call
    return attempt;
  }

  // Runs `use(objectStore)` in one transaction; resolves with the request's result once the
  // transaction has committed (so a resolved put is durable), rejects if it errors or aborts.
  async function run(mode, use) {
    const db = await connect();
    return new Promise((resolve, reject) => {
      let result;
      try {
        const tx = db.transaction(STORE, mode);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB request failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
        const req = use(tx.objectStore(STORE));
        req.onsuccess = () => { result = req.result; };
      } catch (error) {
        if (error?.name === 'InvalidStateError') opening = null; // the connection is closing: reconnect next time
        reject(error);
      }
    });
  }

  return {
    async put(id, bytes) {
      await connect();
      assertBytes(bytes);
      await run('readwrite', (store) => store.put(bytes, id));
    },
    async get(id) {
      const value = await run('readonly', (store) => store.get(id));
      if (value === undefined) return null;
      return value instanceof Uint8Array ? value : new Uint8Array(value);
    },
    async delete(id) {
      await run('readwrite', (store) => store.delete(id));
    },
    async list() {
      return [...await run('readonly', (store) => store.getAllKeys())];
    },
    async clear() {
      await run('readwrite', (store) => store.clear());
    },
  };
}

// Same interface over a Map: for tests, and as a fallback when IndexedDB is unavailable.
export function createMemoryFileStore() {
  const map = new Map();
  return {
    async put(id, bytes) { assertBytes(bytes); map.set(id, bytes); },
    async get(id) { return map.get(id) ?? null; },
    async delete(id) { map.delete(id); },
    async list() { return [...map.keys()]; },
    async clear() { map.clear(); },
  };
}

/* ─── UPLOAD PREPARATION ─── */

// Reads the file once and returns only its ciphertext, so the plaintext is unreachable (and can be
// freed) as soon as encryption is done.
async function encryptOf(file, fk) {
  return encryptFile(fk, new Uint8Array(await file.arrayBuffer()));
}

// Turns a picked file into a site record plus its wrapped key, with the ciphertext parked in `fileStore`.
//   file       a File (or anything with name, size, type, arrayBuffer())
//   vk         the vault key (CryptoKey); the file's own key is wrapped under it
//   limits     { FILE_MAX } (see limits.mjs)
// Rejects with Error('too-large') above FILE_MAX, without reading the file. The key is wrapped before
// the store is touched, so any failure leaves nothing behind. Nothing is base64-encoded here.
export async function prepareUpload(file, vk, { limits, fileStore }) {
  if (file.size > limits.FILE_MAX) throw new Error('too-large');
  const fk = await generateKey();
  const cipher = await encryptOf(file, fk);   // IV (12) || ciphertext || tag (16): size + 28 bytes
  const wrapped = await wrapFileKey(vk, fk);
  const id = randomId();
  await fileStore.put(id, cipher);
  return {
    record: { id, name: file.name, size: file.size, type: file.type || OCTET_STREAM, enc: true },
    wrapped,
  };
}

// For the UI note shown above FILE_NOTE (spec section 13.9).
export function isLarge(size, limits) {
  return size > limits.FILE_NOTE;
}

// Decrypts a pending file again (preview and replace flows). Rejects if the store does not hold the id,
// or ('decrypt failed') if `vk` / `wrapped` do not match the stored ciphertext.
export async function readPending(id, vk, wrapped, fileStore) {
  const cipher = await fileStore.get(id);
  if (!cipher) throw new Error('pending file not found');
  const fk = await unwrapFileKey(vk, wrapped);
  return decryptFile(fk, cipher);
}
