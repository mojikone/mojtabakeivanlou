// Pending-file store and upload preparation (Task 19a, spec sections 12 and 13.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFileStore, createMemoryFileStore, prepareUpload, isLarge, readPending } from '../admin/modules/files.mjs';
import { FILE_MAX, FILE_NOTE } from '../admin/modules/limits.mjs';
import { generateKey, randomBytes, unwrapFileKey, decryptFile } from '../assets/js/vault.mjs';

const LIMITS = { FILE_MAX, FILE_NOTE };
const MB = 1024 * 1024;

test('prepareUpload encrypts a file, stores the ciphertext and wraps its key', async () => {
  const bytes = randomBytes(MB);
  const file = new File([bytes], 'r.pdf', { type: 'application/pdf' });
  const vk = await generateKey();
  const fileStore = createMemoryFileStore();

  const { record, wrapped } = await prepareUpload(file, vk, { limits: LIMITS, fileStore });

  assert.match(record.id, /^[0-9a-f]{32}$/);
  assert.equal(record.name, 'r.pdf');
  assert.equal(record.size, bytes.length);
  assert.equal(record.type, 'application/pdf');
  assert.equal(record.enc, true);
  assert.deepEqual(Object.keys(record).sort(), ['enc', 'id', 'name', 'size', 'type']);
  assert.deepEqual(Object.keys(wrapped).sort(), ['iv', 'key']);

  assert.deepEqual(await fileStore.list(), [record.id]);
  const stored = await fileStore.get(record.id);
  assert.equal(stored.length, bytes.length + 28);

  const fk = await unwrapFileKey(vk, wrapped);
  assert.deepEqual(await decryptFile(fk, stored), bytes);
  assert.deepEqual(await readPending(record.id, vk, wrapped, fileStore), bytes);
});

test('prepareUpload rejects an oversize file before reading it', async () => {
  const fileStore = createMemoryFileStore();
  const vk = await generateKey();
  const big = {
    name: 'big.bin',
    size: FILE_MAX + 1,
    type: 'application/octet-stream',
    arrayBuffer() { throw new Error('must not read'); },
  };
  await assert.rejects(prepareUpload(big, vk, { limits: LIMITS, fileStore }), { message: 'too-large' });
  assert.deepEqual(await fileStore.list(), []);
});

test('prepareUpload accepts a file of exactly FILE_MAX bytes (checked with a File-like)', async () => {
  const fileStore = createMemoryFileStore();
  const vk = await generateKey();
  const limits = { FILE_MAX: 8, FILE_NOTE: 4 };
  const file = new File([new Uint8Array(8)], 'edge.bin', { type: 'application/octet-stream' });
  const { record } = await prepareUpload(file, vk, { limits, fileStore });
  assert.equal(record.size, 8);
  await assert.rejects(
    prepareUpload(new File([new Uint8Array(9)], 'edge.bin'), vk, { limits, fileStore }),
    { message: 'too-large' },
  );
  assert.deepEqual(await fileStore.list(), [record.id]);
});

test('a file with an empty type gets application/octet-stream', async () => {
  const fileStore = createMemoryFileStore();
  const vk = await generateKey();
  const file = new File([new Uint8Array([1, 2, 3])], 'blob');
  assert.equal(file.type, '');
  const { record } = await prepareUpload(file, vk, { limits: LIMITS, fileStore });
  assert.equal(record.type, 'application/octet-stream');
  assert.equal(record.size, 3);
});

test('every upload gets its own id and its own file key', async () => {
  const fileStore = createMemoryFileStore();
  const vk = await generateKey();
  const file = new File([new Uint8Array([9, 9, 9])], 'same.txt', { type: 'text/plain' });
  const a = await prepareUpload(file, vk, { limits: LIMITS, fileStore });
  const b = await prepareUpload(file, vk, { limits: LIMITS, fileStore });
  assert.notEqual(a.record.id, b.record.id);
  assert.notEqual(a.wrapped.key, b.wrapped.key);
  assert.equal((await fileStore.list()).length, 2);
});

test('readPending rejects when the file is not in the store, and with the wrong vault key', async () => {
  const fileStore = createMemoryFileStore();
  const vk = await generateKey();
  const file = new File([new Uint8Array([1, 2, 3, 4])], 'a.bin');
  const { record, wrapped } = await prepareUpload(file, vk, { limits: LIMITS, fileStore });
  await assert.rejects(readPending('f'.repeat(32), vk, wrapped, fileStore), { message: /not found/ });
  await assert.rejects(readPending(record.id, await generateKey(), wrapped, fileStore), { message: 'decrypt failed' });
});

test('isLarge is true only above FILE_NOTE', () => {
  assert.equal(isLarge(FILE_NOTE, LIMITS), false);
  assert.equal(isLarge(FILE_NOTE + 1, LIMITS), true);
  assert.equal(isLarge(0, LIMITS), false);
});

test('memory store: put, get, delete, list, clear', async () => {
  const s = createMemoryFileStore();
  assert.deepEqual(await s.list(), []);
  assert.equal(await s.get('missing'), null);

  await s.put('a', new Uint8Array([1, 2]));
  await s.put('b', new Uint8Array([3]));
  assert.deepEqual((await s.list()).sort(), ['a', 'b']);
  assert.deepEqual(await s.get('a'), new Uint8Array([1, 2]));

  await s.put('a', new Uint8Array([7]));
  assert.deepEqual(await s.get('a'), new Uint8Array([7]));
  assert.equal((await s.list()).length, 2);

  await s.delete('a');
  assert.equal(await s.get('a'), null);
  assert.deepEqual(await s.list(), ['b']);

  await assert.doesNotReject(s.delete('never-there'));

  await s.clear();
  assert.deepEqual(await s.list(), []);
  assert.equal(await s.get('b'), null);
});

test('createFileStore without IndexedDB rejects every method with IndexedDB unavailable', async () => {
  const s = createFileStore({ idb: undefined });
  const gone = { message: 'IndexedDB unavailable' };
  await assert.rejects(s.put('a', new Uint8Array([1])), gone);
  await assert.rejects(s.get('a'), gone);
  await assert.rejects(s.delete('a'), gone);
  await assert.rejects(s.list(), gone);
  await assert.rejects(s.clear(), gone);
});

/* --- createFileStore over a fake IndexedDB --- */

// A minimal IndexedDB that follows the browser's event order. Requests run one tick after the transaction is
// created (so the caller can attach handlers first); each fires success or error before the transaction's complete
// or abort. A request error bubbles to the transaction's onerror while tx.error is still null and, unless a handler
// calls preventDefault(), aborts the transaction: its writes are dropped and onabort fires with tx.error set to the
// request's error. `fail(op)` returns an error to throw for that request (or nothing).
function fakeIndexedDB({ fail = () => null } = {}) {
  const rows = new Map();
  let hasStore = false;
  const db = {
    objectStoreNames: { contains: (name) => hasStore && name === 'pending' },
    createObjectStore: () => { hasStore = true; },
    close() {},
    transaction() {
      const staged = new Map(rows);
      const queue = [];
      const tx = { error: null, oncomplete: null, onerror: null, onabort: null };
      const request = (op, run) => {
        const req = { result: undefined, error: null, onsuccess: null, onerror: null };
        queue.push({ req, op, run });
        return req;
      };
      tx.objectStore = () => ({
        put: (value, key) => request('put', () => { staged.set(key, value); return key; }),
        get: (key) => request('get', () => staged.get(key)),
        delete: (key) => request('delete', () => { staged.delete(key); }),
        getAllKeys: () => request('getAllKeys', () => [...staged.keys()]),
        clear: () => request('clear', () => { staged.clear(); }),
      });
      setTimeout(() => {
        for (const { req, op, run } of queue) {
          const error = fail(op);
          if (error) {
            req.error = error;
            const event = { target: req, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
            req.onerror?.(event);
            tx.onerror?.(event);
            if (event.defaultPrevented) continue;
            tx.error = error;
            tx.onabort?.({ target: tx });
            return;
          }
          req.result = run();
          req.onsuccess?.({ target: req });
        }
        rows.clear();
        for (const [key, value] of staged) rows.set(key, value);
        tx.oncomplete?.({ target: tx });
      }, 0);
      return tx;
    },
  };
  const idb = {
    opens: 0,
    open() {
      idb.opens += 1;
      const req = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      setTimeout(() => {
        req.result = db;
        if (!hasStore) req.onupgradeneeded?.({ target: req });
        req.onsuccess?.({ target: req });
      }, 0);
      return req;
    },
  };
  return idb;
}

test('createFileStore over IndexedDB: put, get, list, delete and clear, on one reused connection', async () => {
  const idb = fakeIndexedDB();
  const s = createFileStore({ idb });
  assert.deepEqual(await s.list(), []);
  assert.equal(await s.get('missing'), null);

  await s.put('a', new Uint8Array([1, 2, 3]));
  await s.put('b', new Uint8Array([4]));
  assert.deepEqual(await s.get('a'), new Uint8Array([1, 2, 3]));
  assert.deepEqual((await s.list()).sort(), ['a', 'b']);

  await s.delete('a');
  assert.equal(await s.get('a'), null);
  assert.deepEqual(await s.list(), ['b']);
  await assert.doesNotReject(s.delete('never-there'));

  await s.clear();
  assert.deepEqual(await s.list(), []);
  assert.equal(idb.opens, 1);
});

test('createFileStore: a failed request rejects with its own error name and stores nothing', async () => {
  const quota = () => new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  const s = createFileStore({ idb: fakeIndexedDB({ fail: (op) => (op === 'put' ? quota() : null) }) });
  await assert.rejects(s.put('big', new Uint8Array(8)), (err) => err.name === 'QuotaExceededError');
  assert.deepEqual(await s.list(), []);
});
