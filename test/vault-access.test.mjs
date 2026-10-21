// Access file (vault/access.json), keys file (vault/keys.json) and the vault CLI (Task 14, spec section 12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile, readdir, stat, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fromB64, generateKey, exportKey, importKey, encryptFile, decryptFile, generateDownloadCode, codeStrength,
  createAccessFile, createKeysFile, unlock, addEntry, readMeta, wrapFileKey, unwrapFileKey, rotateVault, shortId,
} from '../assets/js/vault.mjs';

const ITER = 1000; // production uses 600000; tests stay fast
const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);
const clone = (x) => JSON.parse(JSON.stringify(x));

// Obviously fake fixtures. ADMIN_CODE passes the admin strength rule (12+ chars, 3+ classes).
const ADMIN_CODE = 'Test-Admin-Code-1';
const TOKEN = 'test-token-not-real';
const GITHUB = { token: TOKEN, owner: 'mojikone', repo: 'mojtabakeivanlou', branch: 'redesign3_admin' };
const DAY = '2026-10-21';

// A vault with one admin entry and the given download codes, at test iterations. `vk` is the vault key (in every
// payload), `ok` the owner key (in the admin payload only; it seals every meta).
async function makeVault(downloadCodes = []) {
  const vk = await generateKey();
  const vkB64 = await exportKey(vk);
  const ok = await generateKey();
  const okB64 = await exportKey(ok);
  let access = createAccessFile(ITER);
  access = await addEntry(access, { kind: 'admin', code: ADMIN_CODE, payload: { vk: vkB64, ok: okB64, github: GITHUB }, meta: { label: 'Admin', created: DAY } }, ok);
  for (const [i, code] of downloadCodes.entries()) {
    access = await addEntry(access, { kind: 'download', code, payload: { vk: vkB64 }, meta: { label: `Hirer ${i + 1}`, created: DAY, code } }, ok);
  }
  return { access, vk, vkB64, ok, okB64, keys: createKeysFile(shortId()) };
}

// -- file shapes ----------------------------------------------------------

test('createAccessFile: v1, PBKDF2/SHA-256, 600000 iterations by default, a fresh 16-byte salt, no entries', () => {
  const a = createAccessFile();
  assert.deepEqual(Object.keys(a).sort(), ['entries', 'kdf', 'v']);
  assert.equal(a.v, 1);
  assert.deepEqual(Object.keys(a.kdf).sort(), ['hash', 'iterations', 'name', 'salt']);
  assert.equal(a.kdf.name, 'PBKDF2');
  assert.equal(a.kdf.hash, 'SHA-256');
  assert.equal(a.kdf.iterations, 600000);
  assert.equal(fromB64(a.kdf.salt).length, 16);
  assert.deepEqual(a.entries, []);
  assert.notEqual(createAccessFile().kdf.salt, a.kdf.salt);
  assert.equal(createAccessFile(ITER).kdf.iterations, ITER);
});

test('createAccessFile rejects a non-positive or fractional iteration count', () => {
  assert.throws(() => createAccessFile(0));
  assert.throws(() => createAccessFile(1.5));
  assert.throws(() => createAccessFile('1000'));
});

test('createKeysFile and shortId', () => {
  const id = shortId();
  assert.match(id, /^[0-9a-f]{8}$/);
  assert.deepEqual(createKeysFile(id), { v: 1, vk: id, files: {} });
  const seen = new Set(Array.from({ length: 50 }, shortId));
  assert.ok(seen.size > 45);
});

test('entries have an 8-hex id, kind, iv, data and meta { iv, data }; admin meta holds no code', async () => {
  const code = generateDownloadCode();
  const { access, ok } = await makeVault([code]);
  assert.equal(access.entries.length, 2);
  for (const e of access.entries) {
    assert.deepEqual(Object.keys(e).sort(), ['data', 'id', 'iv', 'kind', 'meta']);
    assert.match(e.id, /^[0-9a-f]{8}$/);
    assert.equal(fromB64(e.iv).length, 12);
    assert.deepEqual(Object.keys(e.meta).sort(), ['data', 'iv']);
  }
  assert.notEqual(access.entries[0].id, access.entries[1].id);
  assert.deepEqual(access.entries.map((e) => e.kind), ['admin', 'download']);
  assert.deepEqual(await readMeta(access.entries[0], ok), { label: 'Admin', created: DAY });
  // nothing readable in the public file
  const json = JSON.stringify(access);
  for (const secret of [ADMIN_CODE, TOKEN, code, 'Hirer', 'Admin']) assert.ok(!json.includes(secret), secret);
});

// -- full flow ------------------------------------------------------------

test('full flow: admin + generated download code; trimmed lower-case code unlocks the download entry', async () => {
  const code = generateDownloadCode();
  const { access, ok, vkB64, okB64 } = await makeVault([code]);

  const admin = await unlock(access, ADMIN_CODE);
  assert.equal(admin.kind, 'admin');
  assert.equal(admin.entry.id, access.entries[0].id);
  assert.deepEqual(admin.payload, { vk: vkB64, ok: okB64, github: GITHUB });
  assert.equal(admin.kek.algorithm.name, 'AES-GCM');

  const dl = await unlock(access, '  ' + code.toLowerCase() + ' ');
  assert.equal(dl.kind, 'download');
  assert.equal(dl.entry.id, access.entries[1].id);
  assert.equal(dl.payload.vk, admin.payload.vk);
  assert.deepEqual(Object.keys(dl.payload), ['vk']);

  assert.equal(await unlock(access, 'wrong'), null);
  assert.equal(await unlock(access, ''), null);
  assert.equal(await unlock(access, '   '), null);
  assert.equal(await unlock(access, undefined), null);
  assert.equal((await readMeta(access.entries[1], ok)).code, code);
});

test('a download code opens no meta: its payload is the vault key alone, and the vault key opens no label or code', async () => {
  const codes = [generateDownloadCode(), generateDownloadCode(), generateDownloadCode()];
  const { access, vk, ok } = await makeVault(codes);
  for (const code of codes) {
    const hit = await unlock(access, code);
    assert.deepEqual(Object.keys(hit.payload), ['vk']);
    const hirerKey = await importKey(hit.payload.vk);
    for (const entry of access.entries) await assert.rejects(readMeta(entry, hirerKey), { message: 'decrypt failed' });
  }
  for (const entry of access.entries) await assert.rejects(readMeta(entry, vk), { message: 'decrypt failed' });
  // the owner key, from the admin payload, opens every one of them
  const admin = await unlock(access, ADMIN_CODE);
  const owner = await importKey(admin.payload.ok);
  assert.deepEqual((await Promise.all(access.entries.map((e) => readMeta(e, owner)))).map((m) => m.code ?? null), [null, ...codes]);
  assert.equal(await exportKey(owner), await exportKey(ok));
});

test('unlock tries the code as typed before upper-casing it (a lower-case admin code still works)', async () => {
  const vk = await generateKey();
  const ok = await generateKey();
  const lower = 'lower-case-admin-code-42';
  let access = createAccessFile(ITER);
  access = await addEntry(access, { kind: 'admin', code: lower, payload: { vk: await exportKey(vk), ok: await exportKey(ok), github: GITHUB }, meta: { label: 'Admin', created: DAY } }, ok);
  assert.equal((await unlock(access, lower)).kind, 'admin');
  assert.equal(await unlock(access, lower.toUpperCase()), null);
});

test('unlock derives the KEK at most once per candidate (once as typed, once upper-cased)', async () => {
  const code = generateDownloadCode();
  const { access } = await makeVault([code, generateDownloadCode(), generateDownloadCode()]);
  const subtle = globalThis.crypto.subtle;
  const real = subtle.deriveKey;
  let calls = 0;
  subtle.deriveKey = function (...args) { calls++; return real.apply(subtle, args); };
  try {
    calls = 0; await unlock(access, ADMIN_CODE); assert.equal(calls, 1);
    calls = 0; await unlock(access, code); assert.equal(calls, 1);
    calls = 0; await unlock(access, code.toLowerCase()); assert.equal(calls, 2);
    calls = 0; assert.equal(await unlock(access, 'nope'), null); assert.equal(calls, 2);
    calls = 0; assert.equal(await unlock(access, 'NOPE'), null); assert.equal(calls, 1);
  } finally {
    delete subtle.deriveKey;
  }
  assert.equal(subtle.deriveKey, real);
});

test('unlock tries admin entries first, wherever they sit in the file', async () => {
  // Two entries sealed under the same code (addEntry refuses this, so build it by hand from two files
  // that share a salt): the admin entry must win even though it is listed last.
  const vk = await generateKey();
  const vkB64 = await exportKey(vk);
  const ok = await generateKey();
  const base = createAccessFile(ITER);
  const withDl = await addEntry(base, { kind: 'download', code: 'MK-SAME-CODE', payload: { vk: vkB64 }, meta: { label: 'x', created: DAY, code: 'MK-SAME-CODE' } }, ok);
  const withAdmin = await addEntry(base, { kind: 'admin', code: 'MK-SAME-CODE', payload: { vk: vkB64, ok: await exportKey(ok), github: GITHUB }, meta: { label: 'Admin', created: DAY } }, ok);
  const both = { ...base, entries: [withDl.entries[0], withAdmin.entries[0]] };
  const r = await unlock(both, 'MK-SAME-CODE');
  assert.equal(r.kind, 'admin');
  assert.equal(r.entry.id, withAdmin.entries[0].id);
});

test('unlock on a file with no entries returns null', async () => {
  assert.equal(await unlock(createAccessFile(ITER), ADMIN_CODE), null);
});

// -- addEntry -------------------------------------------------------------

test('addEntry returns a new access file and does not mutate its input', async () => {
  const { access, ok, vkB64 } = await makeVault();
  const before = clone(access);
  const code = generateDownloadCode();
  const next = await addEntry(access, { kind: 'download', code, payload: { vk: vkB64 }, meta: { label: 'New', created: DAY, code } }, ok);
  assert.deepEqual(access, before);
  assert.notEqual(next, access);
  assert.notEqual(next.entries, access.entries);
  assert.equal(next.entries.length, 2);
  assert.deepEqual(next.entries[0], access.entries[0]);
  assert.deepEqual(next.kdf, access.kdf);
  assert.equal((await unlock(next, code)).kind, 'download');
});

test('addEntry trims the code, so the code unlock trims still matches', async () => {
  const { access, ok, vkB64 } = await makeVault();
  const next = await addEntry(access, { kind: 'download', code: '  MK-PADD-CODE \n', payload: { vk: vkB64 }, meta: { label: 'x', created: DAY, code: 'MK-PADD-CODE' } }, ok);
  assert.equal((await unlock(next, 'MK-PADD-CODE')).kind, 'download');
});

test('addEntry refuses a bad kind, an empty code, a code already in use, an admin meta with a code, and a payload without a vault key', async () => {
  const code = generateDownloadCode();
  const { access, ok, vkB64, okB64 } = await makeVault([code]);
  const good = { kind: 'download', code: 'MK-FRSH-CODE', payload: { vk: vkB64 }, meta: { label: 'x', created: DAY, code: 'MK-FRSH-CODE' } };
  await addEntry(access, good, ok); // the baseline is valid
  await assert.rejects(addEntry(access, { ...good, kind: 'owner' }, ok));
  await assert.rejects(addEntry(access, { ...good, code: '   ' }, ok));
  await assert.rejects(addEntry(access, { ...good, code }, ok), /already in use/);
  await assert.rejects(addEntry(access, { ...good, code: ADMIN_CODE }, ok), /already in use/);
  await assert.rejects(addEntry(access, { kind: 'admin', code: 'Another-Admin-1', payload: { vk: vkB64, ok: okB64, github: GITHUB }, meta: { label: 'A', created: DAY, code: 'Another-Admin-1' } }, ok));
  for (const payload of [{}, { vk: 'not-a-key' }, { vk: okB64.slice(4) }, null]) {
    await assert.rejects(addEntry(access, { ...good, payload }, ok), /payload\.vk must be a vault key/);
  }
});

test('addEntry: an admin payload must carry the owner key its meta is sealed under; a download payload is exactly { vk }', async () => {
  const { access, ok, vkB64, okB64 } = await makeVault();
  const admin = { kind: 'admin', code: 'Another-Admin-1', payload: { vk: vkB64, ok: okB64, github: GITHUB }, meta: { label: 'A', created: DAY } };
  await addEntry(access, admin, ok); // the baseline is valid
  await assert.rejects(addEntry(access, { ...admin, payload: { vk: vkB64, github: GITHUB } }, ok), /owner key/);
  await assert.rejects(addEntry(access, { ...admin, payload: { ...admin.payload, ok: await exportKey(await generateKey()) } }, ok), /owner key/);
  await assert.rejects(addEntry(access, admin, await generateKey()), /owner key/);
  const download = { kind: 'download', code: 'MK-FRSH-CODE', meta: { label: 'x', created: DAY, code: 'MK-FRSH-CODE' } };
  for (const payload of [{ vk: vkB64, ok: okB64 }, { vk: vkB64, github: GITHUB }, { ok: okB64, vk: vkB64 }]) {
    await assert.rejects(addEntry(access, { ...download, payload }, ok), /exactly \{ vk \}/);
  }
  await assert.rejects(addEntry(access, { ...download, payload: { vk: vkB64 } }, undefined)); // no owner key, no meta
});

// -- file keys ------------------------------------------------------------

test('wrapFileKey/unwrapFileKey roundtrip; a wrong vault key cannot unwrap', async () => {
  const vk = await generateKey();
  const fk = await generateKey();
  const wrapped = await wrapFileKey(vk, fk);
  assert.deepEqual(Object.keys(wrapped).sort(), ['iv', 'key']);
  assert.equal(fromB64(wrapped.iv).length, 12);
  assert.equal(fromB64(wrapped.key).length, 32 + 16);
  const back = await unwrapFileKey(vk, wrapped);
  assert.equal(await exportKey(back), await exportKey(fk));
  const blob = await encryptFile(fk, enc('report'));
  assert.equal(dec(await decryptFile(back, blob)), 'report');
  await assert.rejects(unwrapFileKey(await generateKey(), wrapped), { message: 'decrypt failed' });
  await assert.rejects(unwrapFileKey(vk, undefined), { message: 'decrypt failed' });
});

// -- rotateVault (revoke) ---------------------------------------------------

async function vaultWithFiles() {
  const keep = generateDownloadCode();
  const drop = generateDownloadCode();
  const v = await makeVault([keep, drop]);
  const blobs = {};
  for (const name of ['a.pdf', 'b.docx', 'c.zip']) {
    const fk = await generateKey();
    blobs[name] = { blob: await encryptFile(fk, enc(`contents of ${name}`)), text: `contents of ${name}` };
    v.keys.files[name] = await wrapFileKey(v.vk, fk);
  }
  const admin = await unlock(v.access, ADMIN_CODE);
  const [, keepEntry, dropEntry] = v.access.entries;
  return { ...v, keep, drop, blobs, admin, keepEntry, dropEntry };
}

const rotateArgs = (v, extra = {}) => ({
  access: v.access, keys: v.keys, vk: v.vk, ok: v.ok, kek: v.admin.kek, adminEntryId: v.admin.entry.id,
  codesById: { [v.keepEntry.id]: v.keep }, dropIds: [v.dropEntry.id], ...extra,
});

test('rotateVault: kept code still unlocks, dropped code does not, every file still decrypts, keys.vk changes', async () => {
  const v = await vaultWithFiles();
  const r = await rotateVault(rotateArgs(v));
  const newVkB64 = await exportKey(r.vk);
  const newOkB64 = await exportKey(r.ok);
  assert.notEqual(newVkB64, v.vkB64);
  assert.notEqual(newOkB64, v.okB64);
  assert.notEqual(newOkB64, newVkB64);
  assert.match(r.keys.vk, /^[0-9a-f]{8}$/);
  assert.notEqual(r.keys.vk, v.keys.vk);
  assert.equal(r.keys.v, 1);
  assert.equal(r.access.v, 1);
  assert.deepEqual(r.access.kdf, v.access.kdf);
  assert.deepEqual(r.access.entries.map((e) => e.id), [v.admin.entry.id, v.keepEntry.id]);

  const kept = await unlock(r.access, v.keep.toLowerCase());
  assert.equal(kept.kind, 'download');
  assert.deepEqual(kept.payload, { vk: newVkB64 }, 'a download payload never gains the owner key');
  assert.equal(await unlock(r.access, v.drop), null);

  const admin = await unlock(r.access, ADMIN_CODE);
  assert.equal(admin.kind, 'admin');
  assert.deepEqual(admin.payload, { vk: newVkB64, ok: newOkB64, github: GITHUB });

  assert.deepEqual(Object.keys(r.keys.files).sort(), Object.keys(v.keys.files).sort());
  for (const [id, { blob, text }] of Object.entries(v.blobs)) {
    const fk = await unwrapFileKey(r.vk, r.keys.files[id]);
    assert.equal(dec(await decryptFile(fk, blob)), text);
  }
});

test('rotateVault leaves nothing under the old keys and keeps every label and code, under the new owner key only', async () => {
  const v = await vaultWithFiles();
  const r = await rotateVault(rotateArgs(v));
  for (const wrapped of Object.values(r.keys.files)) await assert.rejects(unwrapFileKey(v.vk, wrapped));
  for (const e of r.access.entries) {
    await assert.rejects(readMeta(e, v.ok), { message: 'decrypt failed' }, 'not under the old owner key');
    await assert.rejects(readMeta(e, v.vk), { message: 'decrypt failed' });
    await assert.rejects(readMeta(e, r.vk), { message: 'decrypt failed' }, 'not under the new vault key a hirer gets');
  }
  assert.deepEqual(await readMeta(r.access.entries[0], r.ok), { label: 'Admin', created: DAY });
  assert.deepEqual(await readMeta(r.access.entries[1], r.ok), { label: 'Hirer 1', created: DAY, code: v.keep });
  // every kept entry was re-sealed (fresh iv), not copied
  for (const [i, e] of r.access.entries.entries()) {
    assert.notEqual(e.iv, v.access.entries[i].iv);
    assert.notEqual(e.meta.iv, v.access.entries[i].meta.iv);
  }
});

test('rotateVault does not mutate its inputs', async () => {
  const v = await vaultWithFiles();
  const args = rotateArgs(v);
  const before = clone({ access: args.access, keys: args.keys, codesById: args.codesById, dropIds: args.dropIds });
  await rotateVault(args);
  assert.deepEqual(clone({ access: args.access, keys: args.keys, codesById: args.codesById, dropIds: args.dropIds }), before);
});

test('rotateVault with nothing dropped keeps every entry working', async () => {
  const v = await vaultWithFiles();
  const r = await rotateVault(rotateArgs(v, { codesById: { [v.keepEntry.id]: v.keep, [v.dropEntry.id]: v.drop }, dropIds: [] }));
  assert.equal(r.access.entries.length, 3);
  assert.equal((await unlock(r.access, v.keep)).payload.vk, await exportKey(r.vk));
  assert.equal((await unlock(r.access, v.drop)).payload.vk, await exportKey(r.vk));
  for (const e of r.access.entries) await readMeta(e, r.ok); // every meta opens under the new owner key
});

test('rotateVault throws, rather than silently dropping access, when a kept download entry has no code or a wrong one', async () => {
  const v = await vaultWithFiles();
  await assert.rejects(rotateVault(rotateArgs(v, { codesById: {} })), new RegExp(v.keepEntry.id));
  await assert.rejects(rotateVault(rotateArgs(v, { codesById: { [v.keepEntry.id]: v.drop } })), new RegExp(v.keepEntry.id));
});

test('rotateVault refuses to drop the admin entry, an unknown admin id, a wrong admin KEK or a wrong vault key', async () => {
  const v = await vaultWithFiles();
  await assert.rejects(rotateVault(rotateArgs(v, { dropIds: [v.dropEntry.id, v.admin.entry.id] })));
  await assert.rejects(rotateVault(rotateArgs(v, { adminEntryId: 'deadbeef' })));
  await assert.rejects(rotateVault(rotateArgs(v, { adminEntryId: v.keepEntry.id })));
  await assert.rejects(rotateVault(rotateArgs(v, { kek: (await unlock(v.access, v.keep)).kek })));
  await assert.rejects(rotateVault(rotateArgs(v, { vk: await generateKey() })));
  await assert.rejects(rotateVault(rotateArgs(v, { ok: await generateKey() })), /owner key/);
  await assert.rejects(rotateVault(rotateArgs(v, { ok: v.vk })), /owner key/);
  // without a file key to try it on, a wrong vault key is still caught by the admin payload
  await assert.rejects(rotateVault(rotateArgs(v, { keys: createKeysFile(shortId()), vk: await generateKey() })), /vault key or the owner key/);
});

// -- committed initial files ------------------------------------------------

test('vault/access.json and vault/keys.json are committed in their initial, empty state', async () => {
  const root = new URL('../vault/', import.meta.url);
  const accessText = (await readFile(new URL('access.json', root), 'utf8')).replace(/\r\n/g, '\n');
  const keysText = (await readFile(new URL('keys.json', root), 'utf8')).replace(/\r\n/g, '\n');
  const access = JSON.parse(accessText);
  assert.equal(access.v, 1);
  assert.deepEqual({ ...access.kdf, salt: 'x' }, { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: 'x' });
  assert.equal(fromB64(access.kdf.salt).length, 16);
  assert.deepEqual(access.entries, []);
  assert.equal(accessText, JSON.stringify(access, null, 2) + '\n');
  assert.equal(keysText, JSON.stringify({ v: 1, vk: '', files: {} }, null, 2) + '\n');
});

// -- CLI --------------------------------------------------------------------

const CLI = fileURLToPath(new URL('../scripts/vault-cli.mjs', import.meta.url));

// Runs the CLI in `cwd`, capturing stdout and stderr so nothing leaks into the test runner's output.
function cli(cwd, ...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 20000 });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

async function inTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'vault-cli-test-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

const readJson = async (dir, name) => JSON.parse(await readFile(join(dir, 'vault', name), 'utf8'));
const initArgs = ['init', '--admin-code', ADMIN_CODE, '--token', TOKEN, '--iterations', '1000'];

test('CLI: --help and no arguments print usage and exit 0; an unknown command exits 2 with usage on stderr', async () => {
  await inTempDir(async (dir) => {
    for (const args of [['--help'], []]) {
      const r = cli(dir, ...args);
      assert.equal(r.status, 0);
      assert.match(r.stdout, /Usage/);
      for (const cmd of ['init', 'add-code', 'encrypt', 'revoke', 'list']) assert.match(r.stdout, new RegExp(cmd));
      assert.doesNotMatch(r.stdout, /--iterations/); // hidden test option
      assert.equal(r.stderr, '');
    }
    const bad = cli(dir, 'frobnicate');
    assert.equal(bad.status, 2);
    assert.equal(bad.stdout, '');
    assert.match(bad.stderr, /Usage/);
    assert.equal(cli(dir, 'list', '--admin-code', ADMIN_CODE, '--bogus', 'x').status, 2);
    assert.equal(cli(dir, 'add-code', '--label', 'x').status, 2); // missing --admin-code
    assert.equal(cli(dir, 'encrypt', '--admin-code', ADMIN_CODE).status, 2); // missing <file>
    assert.deepEqual(await readdir(dir), []); // usage errors write nothing
  });
});

test('CLI: init refuses a weak admin code and an existing admin entry (unless --force)', async () => {
  await inTempDir(async (dir) => {
    const weak = cli(dir, 'init', '--admin-code', 'password1', '--token', TOKEN, '--iterations', '1000');
    assert.equal(weak.status, 1);
    assert.match(weak.stderr, /12 characters/);
    assert.ok(!(weak.stdout + weak.stderr).includes('password1'));
    assert.deepEqual(await readdir(dir), []);

    assert.equal(cli(dir, ...initArgs).status, 0);
    const before = await readJson(dir, 'access.json');
    const again = cli(dir, ...initArgs);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /--force/);
    assert.deepEqual(await readJson(dir, 'access.json'), before);

    const forced = cli(dir, ...initArgs, '--force');
    assert.equal(forced.status, 0, forced.stderr);
    assert.notDeepEqual(await readJson(dir, 'access.json'), before);
  });
});

test('CLI: init, add-code, encrypt, list, revoke end to end; secrets never printed except the new code', async () => {
  await inTempDir(async (dir) => {
    const runs = [];
    const run = (...args) => { const r = cli(dir, ...args); runs.push(r); return r; };

    // init
    const init = run('init', '--admin-code', ADMIN_CODE, '--token', TOKEN, '--branch', 'test-branch', '--iterations', '1000');
    assert.equal(init.status, 0, init.stderr);
    const accessText = await readFile(join(dir, 'vault', 'access.json'), 'utf8');
    assert.ok(accessText.endsWith('}\n'));
    assert.ok(accessText.includes('\n  "kdf": {'));
    let access = JSON.parse(accessText);
    let keys = await readJson(dir, 'keys.json');
    assert.equal(access.kdf.iterations, 1000);
    assert.equal(access.entries.length, 1);
    assert.match(keys.vk, /^[0-9a-f]{8}$/);
    assert.deepEqual(keys.files, {});
    const admin = await unlock(access, ADMIN_CODE);
    assert.equal(admin.kind, 'admin');
    assert.deepEqual(admin.payload.github, { token: TOKEN, owner: 'mojikone', repo: 'mojtabakeivanlou', branch: 'test-branch' });
    assert.deepEqual(Object.keys(admin.payload).sort(), ['github', 'ok', 'vk']);
    assert.notEqual(admin.payload.ok, admin.payload.vk);
    const adminMeta = await readMeta(access.entries[0], await importKey(admin.payload.ok));
    assert.deepEqual(Object.keys(adminMeta).sort(), ['created', 'label']);
    assert.equal(adminMeta.label, 'Admin');

    // add-code with a generated code: stdout is only the code
    const add = run('add-code', '--admin-code', ADMIN_CODE, '--label', 'Hirer A');
    assert.equal(add.status, 0, add.stderr);
    const code = add.stdout.trim();
    assert.equal(add.stdout, code + '\n');
    assert.match(code, /^MK-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    access = await readJson(dir, 'access.json');
    assert.equal(access.entries.length, 2);
    const dl = await unlock(access, code.toLowerCase());
    assert.equal(dl.kind, 'download');
    assert.deepEqual(dl.payload, { vk: admin.payload.vk });
    const dlId = dl.entry.id;

    // add-code with a chosen code; a wrong admin code and a download code are refused
    const add2 = run('add-code', '--admin-code', ADMIN_CODE, '--label', 'Hirer B', '--code', 'MK-CHSN-CODE');
    assert.equal(add2.status, 0, add2.stderr);
    assert.equal(add2.stdout, 'MK-CHSN-CODE\n');
    assert.equal(run('add-code', '--admin-code', 'Not-The-Admin-9', '--label', 'x').status, 1);
    assert.equal(run('add-code', '--admin-code', code, '--label', 'x').status, 1);
    assert.equal(run('add-code', '--admin-code', ADMIN_CODE, '--label', 'dup', '--code', code).status, 1);
    access = await readJson(dir, 'access.json');
    assert.equal(access.entries.length, 3);
    // a hirer's code opens no label and no code: every meta is sealed under the owner key
    const hirerKey = await importKey(dl.payload.vk);
    for (const e of access.entries) await assert.rejects(readMeta(e, hirerKey), { message: 'decrypt failed' });

    // encrypt a small file
    const plain = enc('pretend this is a PDF report');
    await writeFile(join(dir, 'Report One.pdf'), plain);
    const encr = run('encrypt', '--admin-code', ADMIN_CODE, 'Report One.pdf');
    assert.equal(encr.status, 0, encr.stderr);
    const record = JSON.parse(encr.stdout);
    assert.deepEqual(Object.keys(record), ['id', 'name', 'size', 'type', 'enc']);
    assert.match(record.id, /^[0-9a-f]{32}$/);
    assert.deepEqual({ ...record, id: 'x' }, { id: 'x', name: 'Report One.pdf', size: plain.length, type: 'application/pdf', enc: true });
    const binPath = join(dir, 'vault', 'files', `${record.id}.bin`);
    assert.equal((await stat(binPath)).size, plain.length + 28);
    keys = await readJson(dir, 'keys.json');
    assert.deepEqual(Object.keys(keys.files), [record.id]);
    const fk0 = await unwrapFileKey(await importKey(admin.payload.vk), keys.files[record.id]);
    assert.deepEqual(await decryptFile(fk0, await readFile(binPath)), plain);

    // list: every entry, with download codes shown
    const list = run('list', '--admin-code', ADMIN_CODE);
    assert.equal(list.status, 0, list.stderr);
    for (const e of access.entries) assert.match(list.stdout, new RegExp(e.id));
    for (const s of ['admin', 'download', 'Hirer A', 'Hirer B', code, 'MK-CHSN-CODE', /\d{4}-\d{2}-\d{2}/]) assert.match(list.stdout, s instanceof RegExp ? s : new RegExp(s));

    // revoke the first download entry
    const rev = run('revoke', '--admin-code', ADMIN_CODE, dlId);
    assert.equal(rev.status, 0, rev.stderr);
    const access2 = await readJson(dir, 'access.json');
    const keys2 = await readJson(dir, 'keys.json');
    assert.deepEqual(access2.entries.map((e) => e.id), access.entries.filter((e) => e.id !== dlId).map((e) => e.id));
    assert.equal(await unlock(access2, code), null);
    const admin2 = await unlock(access2, ADMIN_CODE);
    assert.equal(admin2.kind, 'admin');
    assert.notEqual(admin2.payload.vk, admin.payload.vk);
    assert.equal(admin2.payload.github.token, TOKEN);
    assert.notEqual(admin2.payload.ok, admin.payload.ok, 'the owner key is rotated with the vault key');
    assert.equal((await unlock(access2, 'mk-chsn-code')).payload.vk, admin2.payload.vk);
    const kept = await unlock(access2, 'MK-CHSN-CODE');
    for (const e of access2.entries) {
      await assert.rejects(readMeta(e, await importKey(kept.payload.vk)), { message: 'decrypt failed' });
      await assert.rejects(readMeta(e, await importKey(admin.payload.ok)), { message: 'decrypt failed' });
    }
    assert.notEqual(keys2.vk, keys.vk);
    const fk1 = await unwrapFileKey(await importKey(admin2.payload.vk), keys2.files[record.id]);
    assert.deepEqual(await decryptFile(fk1, await readFile(binPath)), plain);
    assert.deepEqual((await readdir(join(dir, 'vault'))).sort(), ['access.json', 'files', 'keys.json']); // no .tmp/.bak left

    // list after the revoke: the labels and codes are still there, read with the new owner key
    const list2 = run('list', '--admin-code', ADMIN_CODE);
    assert.equal(list2.status, 0, list2.stderr);
    for (const s of ['Hirer B', 'MK-CHSN-CODE', admin2.entry.id]) assert.ok(list2.stdout.includes(s), s);
    assert.ok(!list2.stdout.includes('Hirer A'));

    // revoking the admin entry or an unknown id is refused and changes nothing
    assert.equal(run('revoke', '--admin-code', ADMIN_CODE, admin2.entry.id).status, 1);
    assert.equal(run('revoke', '--admin-code', ADMIN_CODE, 'deadbeef').status, 1);
    assert.deepEqual(await readJson(dir, 'access.json'), access2);

    // the admin code and the token never appear in any output; the download code only where asked for
    for (const r of runs) {
      assert.ok(!(r.stdout + r.stderr).includes(ADMIN_CODE));
      assert.ok(!(r.stdout + r.stderr).includes(TOKEN));
    }
    assert.ok(!(rev.stdout + rev.stderr).includes(code));
  });
});

test('CLI: when the second file cannot be replaced, keys.json is rolled back, nothing is left behind, and the exit is non-zero', {
  skip: process.platform !== 'win32' && 'a read-only file blocks a rename over it only on Windows',
}, async () => {
  await inTempDir(async (dir) => {
    assert.equal(cli(dir, ...initArgs).status, 0);
    const code = cli(dir, 'add-code', '--admin-code', ADMIN_CODE, '--label', 'Hirer').stdout.trim();
    await writeFile(join(dir, 'f.txt'), 'kept file');
    const record = JSON.parse(cli(dir, 'encrypt', '--admin-code', ADMIN_CODE, 'f.txt').stdout);
    const accessPath = join(dir, 'vault', 'access.json');
    const keysPath = join(dir, 'vault', 'keys.json');
    const accessBefore = await readFile(accessPath, 'utf8');
    const keysBefore = await readFile(keysPath, 'utf8');
    const oldVk = await importKey((await unlock(JSON.parse(accessBefore), ADMIN_CODE)).payload.vk);
    const dlId = (await unlock(JSON.parse(accessBefore), code)).entry.id;

    // A read-only access.json stands in for a Windows file lock: revoke renames keys.json first,
    // then renaming over access.json fails with EPERM (after its retries).
    await chmod(accessPath, 0o444);
    let r;
    try {
      r = cli(dir, 'revoke', '--admin-code', ADMIN_CODE, dlId);
    } finally {
      await chmod(accessPath, 0o644);
    }
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('Could not replace vault/access.json (EPERM).'), r.stderr);
    assert.ok(r.stderr.includes('vault/keys.json restored from backup; nothing was changed'), r.stderr);
    assert.ok(!r.stderr.includes(ADMIN_CODE));

    // no split: both files as before, no .tmp/.bak, and keys.json still unwraps under the OLD vault key
    assert.deepEqual((await readdir(join(dir, 'vault'))).sort(), ['access.json', 'files', 'keys.json']);
    assert.equal(await readFile(keysPath, 'utf8'), keysBefore);
    assert.equal(await readFile(accessPath, 'utf8'), accessBefore);
    const fk = await unwrapFileKey(oldVk, JSON.parse(await readFile(keysPath, 'utf8')).files[record.id]);
    assert.equal(dec(await decryptFile(fk, await readFile(join(dir, 'vault', 'files', `${record.id}.bin`)))), 'kept file');

    // the vault still works, so the revoke can simply be run again
    const again = cli(dir, 'revoke', '--admin-code', ADMIN_CODE, dlId);
    assert.equal(again.status, 0, again.stderr);
    assert.equal(await unlock(JSON.parse(await readFile(accessPath, 'utf8')), code), null);
  });
});

test('CLI: leftover .tmp/.bak files from an interrupted write make every command refuse and print the recovery step', async () => {
  await inTempDir(async (dir) => {
    assert.equal(cli(dir, ...initArgs).status, 0);
    const vault = join(dir, 'vault');
    const accessBefore = await readFile(join(vault, 'access.json'), 'utf8');
    // every command refuses, and stderr holds each expected line
    const refuses = (...lines) => {
      for (const args of [['list', '--admin-code', ADMIN_CODE], ['add-code', '--admin-code', ADMIN_CODE, '--label', 'x'], [...initArgs, '--force']]) {
        const r = cli(dir, ...args);
        assert.equal(r.status, 1, args[0]);
        assert.equal(r.stdout, '');
        for (const line of lines) assert.ok(r.stderr.includes(line), `${args[0]}: ${r.stderr}`);
        assert.ok(!r.stderr.includes(ADMIN_CODE));
      }
    };

    await writeFile(join(vault, 'access.json.tmp'), '{}');
    refuses('stopped before replacing any vault file', '  delete vault/access.json.tmp');

    await writeFile(join(vault, 'keys.json.bak'), '{}');
    refuses('half-way', '  rename vault/keys.json.bak to vault/keys.json (replacing it)', '  delete vault/access.json.tmp');

    await rm(join(vault, 'access.json.tmp'));
    refuses('could not remove its backups', '  delete vault/keys.json.bak');

    assert.equal(await readFile(join(vault, 'access.json'), 'utf8'), accessBefore); // nothing was touched
    await rm(join(vault, 'keys.json.bak'));
    assert.equal(cli(dir, 'list', '--admin-code', ADMIN_CODE).status, 0);
  });
});

test('CLI: encrypt picks the MIME type from the extension', async () => {
  await inTempDir(async (dir) => {
    assert.equal(cli(dir, ...initArgs).status, 0);
    const cases = {
      'a.PDF': 'application/pdf',
      'b.jpeg': 'image/jpeg',
      'c.csv': 'text/csv',
      'd.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'e.bin': 'application/octet-stream',
      noext: 'application/octet-stream',
    };
    for (const [name, type] of Object.entries(cases)) {
      await writeFile(join(dir, name), 'x');
      const r = cli(dir, 'encrypt', '--admin-code', ADMIN_CODE, name);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(JSON.parse(r.stdout).type, type, name);
    }
    assert.equal(Object.keys((await readJson(dir, 'keys.json')).files).length, Object.keys(cases).length);
  });
});

test('the CLI admin code fixture passes the admin strength rule', () => {
  assert.equal(codeStrength(ADMIN_CODE).ok, true);
});
