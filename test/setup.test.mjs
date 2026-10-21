// First-run setup (Task 24, spec 13.2 and 12): the pure parts of the wizard, against a fake GitHub client.
// The wizard's DOM (admin/modules/setup.mjs runSetup) is checked by hand in the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULTS, ADMIN_EXISTS_MESSAGE, SetupRefusedError, SetupError,
  buildInitialVault, canInitialise, commitInitialVault, codeMeter, scrub, describeFailure, validationMessage,
} from '../admin/modules/setup.mjs';
import { AuthError, ConflictError, GitHubError } from '../admin/modules/github.mjs';
import { setupSection } from '../admin/sections/index.mjs';
import {
  createAccessFile, addEntry, unlock, readMeta, importKey, generateKey, exportKey,
} from '../assets/js/vault.mjs';

const ITER = 1000; // production uses 600000; tests stay fast
const TOKEN = 'ghp_FAKESETUPTOKEN0000';
const CODE = 'Setup-Test-Code-42';
const GH = { token: TOKEN, owner: 'mojikone', repo: 'mojtabakeivanlou', branch: 'redesign3_admin_test' };
const dec = (b) => new TextDecoder().decode(b);
const enc = (s) => new TextEncoder().encode(s);
const asFile = (x) => enc(`${JSON.stringify(x, null, 2)}\n`);

const build = (over = {}) => buildInitialVault({ ...GH, code: CODE, iterations: ITER, ...over });

/* ─── buildInitialVault ─── */

test('the defaults are the repository of the site', () => {
  assert.deepEqual(DEFAULTS, { owner: 'mojikone', repo: 'mojtabakeivanlou', branch: 'redesign3_admin' });
});

test('buildInitialVault: the admin entry unlocks with the code and seals the vault key and the github fields', async () => {
  const { access, keys, entryId } = await build();
  assert.equal(access.v, 1);
  assert.equal(access.kdf.iterations, ITER);
  assert.equal(access.entries.length, 1);
  assert.equal(access.entries[0].id, entryId);
  assert.match(entryId, /^[0-9a-f]{8}$/);
  assert.equal(access.entries[0].kind, 'admin');

  const hit = await unlock(access, CODE);
  assert.equal(hit.kind, 'admin');
  assert.equal(hit.entry.id, entryId);
  assert.deepEqual(hit.payload.github, GH);
  assert.equal(typeof hit.payload.vk, 'string');
  assert.equal((await importKey(hit.payload.vk)) instanceof CryptoKey, true);
  assert.equal((await importKey(hit.payload.ok)) instanceof CryptoKey, true, 'the owner key is in the admin payload');
  assert.notEqual(hit.payload.ok, hit.payload.vk);
  assert.deepEqual(Object.keys(hit.payload).sort(), ['github', 'ok', 'vk']);
  assert.equal(await unlock(access, 'Some-Other-Code-99'), null);
  assert.deepEqual(keys, { v: 1, vk: keys.vk, files: {} });
});

test('buildInitialVault: the meta holds the label and the date and never the code; the keys file has an 8-hex vk', async () => {
  const { access, keys } = await build();
  const { payload } = await unlock(access, CODE);
  await assert.rejects(readMeta(access.entries[0], await importKey(payload.vk)), { message: 'decrypt failed' }, 'not under the vault key');
  const meta = await readMeta(access.entries[0], await importKey(payload.ok));
  assert.equal(meta.label, 'Me');
  assert.match(meta.created, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal('code' in meta, false);
  assert.equal(Object.keys(meta).sort().join(), 'created,label');
  assert.match(keys.vk, /^[0-9a-f]{8}$/);
  // Nothing readable in the public files: neither the code nor the token.
  const text = JSON.stringify(access) + JSON.stringify(keys);
  assert.equal(text.includes(CODE), false);
  assert.equal(text.includes(TOKEN), false);
});

test('buildInitialVault: the date comes from `created` when given; the code is trimmed like unlock does', async () => {
  const { access } = await build({ created: '2026-10-21', code: `  ${CODE}  ` });
  const hit = await unlock(access, CODE);
  assert.ok(hit);
  assert.equal((await readMeta(access.entries[0], await importKey(hit.payload.ok))).created, '2026-10-21');
});

test('buildInitialVault: every run has its own salt, entry and vault key', async () => {
  const a = await build();
  const b = await build();
  assert.notEqual(a.access.kdf.salt, b.access.kdf.salt);
  assert.notEqual((await unlock(a.access, CODE)).payload.vk, (await unlock(b.access, CODE)).payload.vk);
  assert.notEqual((await unlock(a.access, CODE)).payload.ok, (await unlock(b.access, CODE)).payload.ok);
});

test('buildInitialVault: refuses a weak code, a missing token and a missing owner, repo or branch', async () => {
  for (const code of ['', 'short1A!', 'alllowercaseletters', 'ALLUPPERCASELETTERS', '123456789012', 'abcdefghij12']) {
    await assert.rejects(build({ code }), /admin code/i, code);
  }
  await assert.rejects(build({ token: '' }), /token/i);
  await assert.rejects(build({ token: '   ' }), /token/i);
  await assert.rejects(build({ owner: '' }), /owner/i);
  await assert.rejects(build({ repo: ' ' }), /repo/i);
  await assert.rejects(build({ branch: undefined }), /branch/i);
});

test('buildInitialVault: error messages never contain the code or the token', async () => {
  for (const over of [{ code: 'Weakcode1' }, { owner: '' }]) {
    try {
      await build(over);
      assert.fail('should have thrown');
    } catch (err) {
      assert.equal(err.message.includes(TOKEN), false);
      assert.equal(err.message.includes(over.code ?? CODE), false);
    }
  }
});

/* ─── canInitialise ─── */

test('canInitialise: false as soon as an admin entry exists, true for a missing or empty access file', async () => {
  assert.equal(canInitialise(null), true);
  assert.equal(canInitialise(undefined), true);
  assert.equal(canInitialise(createAccessFile(ITER)), true);
  assert.equal(canInitialise({ v: 1, entries: [{ id: 'aaaaaaaa', kind: 'download' }] }), true);
  assert.equal(canInitialise({ v: 1, entries: [{ id: 'aaaaaaaa', kind: 'download' }, { id: 'bbbbbbbb', kind: 'admin' }] }), false);
  assert.equal(canInitialise((await build()).access), false);
  assert.equal(canInitialise({ v: 1 }), true, 'no entries array: nothing to protect');
});

/* ─── commitInitialVault, against a fake GitHub ─── */

function fakeGh({ file = null, head = { sha: 'head-sha-1', tree: 'tree-1' }, commitError = null } = {}) {
  const calls = [];
  return {
    calls,
    async getFile(path) { calls.push(['getFile', path]); return file; },
    async getHead() { calls.push(['getHead']); return head; },
    async commitFiles(args) {
      calls.push(['commitFiles', args]);
      if (commitError) throw commitError;
      return { sha: 'new-commit-sha' };
    },
  };
}
const fileOf = (value) => ({ sha: 'blob-sha', bytes: enc(typeof value === 'string' ? value : JSON.stringify(value)) });
const names = (gh) => gh.calls.map((c) => c[0]);

test('commitInitialVault: one commit "Initialise vault" with access.json then keys.json, on top of the head', async () => {
  const gh = fakeGh({ file: fileOf(createAccessFile(ITER)) });
  const out = await commitInitialVault({ gh, ...GH, code: CODE, iterations: ITER });
  assert.deepEqual(names(gh), ['getFile', 'getHead', 'commitFiles']);
  assert.deepEqual(gh.calls[0], ['getFile', 'vault/access.json']);

  const args = gh.calls[2][1];
  assert.equal(args.message, 'Initialise vault');
  assert.equal(args.parent, 'head-sha-1');
  assert.deepEqual(args.deletes, []);
  assert.deepEqual(args.files.map((f) => f.path), ['vault/access.json', 'vault/keys.json']);

  const access = JSON.parse(dec(args.files[0].bytes));
  const keys = JSON.parse(dec(args.files[1].bytes));
  assert.deepEqual(args.files[0].bytes, asFile(access), '2-space JSON with a trailing newline');
  assert.deepEqual(args.files[1].bytes, asFile(keys));
  assert.equal(access.entries.length, 1);
  assert.deepEqual((await unlock(access, CODE)).payload.github, GH);
  assert.match(keys.vk, /^[0-9a-f]{8}$/);
  assert.deepEqual(keys.files, {});
  assert.deepEqual(out, { sha: 'new-commit-sha', entryId: access.entries[0].id });
});

test('commitInitialVault: a missing access.json is fine, and the committed files hold neither the code nor the token', async () => {
  const gh = fakeGh({ file: null });
  await commitInitialVault({ gh, ...GH, code: CODE, iterations: ITER });
  assert.deepEqual(names(gh), ['getFile', 'getHead', 'commitFiles']);
  const text = gh.calls[2][1].files.map((f) => dec(f.bytes)).join('\n');
  assert.equal(text.includes(CODE), false);
  assert.equal(text.includes(TOKEN), false);
});

test('commitInitialVault: refuses when the file already has an admin entry, and writes nothing', async () => {
  const existing = (await build()).access;
  const gh = fakeGh({ file: fileOf(existing) });
  await assert.rejects(
    commitInitialVault({ gh, ...GH, code: 'Another-Code-12345', iterations: ITER }),
    (err) => {
      assert.ok(err instanceof SetupRefusedError);
      assert.ok(err instanceof SetupError);
      assert.equal(err.message, 'This site already has an admin code. Use Change admin code in the dashboard.');
      return true;
    },
  );
  assert.equal(ADMIN_EXISTS_MESSAGE, 'This site already has an admin code. Use Change admin code in the dashboard.');
  assert.deepEqual(names(gh), ['getFile'], 'no head lookup, no commit');
});

test('commitInitialVault: a file with download entries only is overwritten (rule: refuse on an admin entry only)', async () => {
  const vk = await generateKey();
  const withDownload = await addEntry(createAccessFile(ITER), {
    kind: 'download', code: 'MK-AAAA-BBBB', payload: { vk: await exportKey(vk) }, meta: { label: 'Hirer', created: '2026-10-01', code: 'MK-AAAA-BBBB' },
  }, await generateKey());
  const gh = fakeGh({ file: fileOf(withDownload) });
  await commitInitialVault({ gh, ...GH, code: CODE, iterations: ITER });
  assert.deepEqual(names(gh), ['getFile', 'getHead', 'commitFiles']);
});

test('commitInitialVault: an access.json that is not JSON is never overwritten', async () => {
  const gh = fakeGh({ file: fileOf('<<<<<<< merge conflict') });
  await assert.rejects(
    commitInitialVault({ gh, ...GH, code: CODE, iterations: ITER }),
    (err) => err instanceof SetupError && !(err instanceof SetupRefusedError) && /vault\/access\.json/.test(err.message),
  );
  assert.deepEqual(names(gh), ['getFile']);
});

test('commitInitialVault: the fetchAccess dependency replaces the file lookup', async () => {
  const gh = fakeGh({ file: fileOf((await build()).access) });     // would refuse, but it is not asked
  const seen = [];
  await commitInitialVault({
    gh, ...GH, code: CODE, iterations: ITER,
    fetchAccess: async (client) => { seen.push(client); return null; },
  });
  assert.deepEqual(seen, [gh]);
  assert.deepEqual(names(gh), ['getHead', 'commitFiles']);
});

test('commitInitialVault: `now` dates the admin entry', async () => {
  const gh = fakeGh();
  await commitInitialVault({ gh, ...GH, code: CODE, iterations: ITER, now: () => new Date('2027-03-04T23:30:00Z') });
  const access = JSON.parse(dec(gh.calls[2][1].files[0].bytes));
  const { payload } = await unlock(access, CODE);
  assert.equal((await readMeta(access.entries[0], await importKey(payload.ok))).created, '2027-03-04');
});

test('commitInitialVault: GitHub errors pass through unchanged (the wizard shows them and lets the owner retry)', async () => {
  for (const error of [new AuthError(401, 'GitHub answered 401'), new ConflictError(422, 'moved'), new GitHubError(500, 'boom')]) {
    const gh = fakeGh({ commitError: error });
    await assert.rejects(commitInitialVault({ gh, ...GH, code: CODE, iterations: ITER }), (err) => err === error);
  }
});

/* ─── the strength meter ─── */

test('codeMeter: the rule of spec 12 (12 characters, three of four classes) as a level and a message', () => {
  const empty = codeMeter('');
  assert.equal(empty.ok, false);
  assert.equal(empty.level, 0);
  assert.match(empty.message, /12/);

  const short = codeMeter('Abc1!');
  assert.equal(short.ok, false);
  assert.ok(short.level > 0 && short.level < 0.5);
  assert.match(short.message, /7 more/);

  const flat = codeMeter('abcdefghijklmnop');
  assert.equal(flat.ok, false);
  assert.match(flat.message, /at least 3 of/);
  assert.equal(flat.classes, 1);

  const good = codeMeter('Abcdefgh1jkl');
  assert.equal(good.ok, true);
  assert.equal(good.level, 1);
  assert.match(good.message, /strong enough/i);
  assert.ok(codeMeter('Abcdefgh1jkl!').level <= 1);
  assert.equal(codeMeter(`  ${CODE}  `).length, CODE.length, 'surrounding spaces do not count: unlock trims the code');
});

/* ─── messages ─── */

test('scrub removes secrets from a message, longest first, ignoring empty ones', () => {
  assert.equal(scrub(`failed for ${TOKEN} and ${CODE}`, [TOKEN, CODE]), 'failed for [hidden] and [hidden]');
  assert.equal(scrub('nothing here', ['', undefined, null]), 'nothing here');
  assert.equal(scrub('abcabc', ['abc', 'abcabc']), '[hidden]');
  assert.equal(scrub(undefined, [TOKEN]), '');
});

test('describeFailure: a plain sentence per kind of failure, with no secrets', () => {
  const auth = describeFailure(new AuthError(401, `GitHub answered 401 to GET /x: Bad credentials ${TOKEN}`), [TOKEN, CODE]);
  assert.match(auth, /rejected the token/i);
  assert.equal(auth.includes(TOKEN), false);
  assert.match(describeFailure(new ConflictError(422, 'ref moved'), []), /changed while|try again/i);
  assert.match(describeFailure(new GitHubError(0, 'Could not reach GitHub (GET /repos/x)'), []), /Could not reach GitHub/);
  const plain = describeFailure(new Error(`oops ${CODE}`), [CODE]);
  assert.equal(plain.includes(CODE), false);
  assert.match(describeFailure('not an error', []), /\w/);
});

test('validationMessage: one sentence per answer of the token check', () => {
  const where = { owner: 'mojikone', repo: 'mojtabakeivanlou' };
  assert.match(validationMessage({ ok: true, status: 200 }, where), /accepted.*mojikone\/mojtabakeivanlou/);
  assert.match(validationMessage({ ok: false, status: 401 }, where), /rejected the token \(HTTP 401\)/);
  assert.match(validationMessage({ ok: false, status: 403 }, where), /rejected the token \(HTTP 403\)/);
  assert.match(validationMessage({ ok: false, status: 404 }, where), /cannot find mojikone\/mojtabakeivanlou/);
  assert.match(validationMessage({ ok: false, status: 0 }, where), /Could not reach GitHub/);
  assert.match(validationMessage({ ok: false, status: 500 }, where), /HTTP 500/);
});

/* ─── guards ─── */

test('setup.mjs never logs and never touches storage or the URL', () => {
  const source = readFileSync(new URL('../admin/modules/setup.mjs', import.meta.url), 'utf8');
  for (const forbidden of ['console.', 'localStorage', 'sessionStorage', 'location.', 'history.', 'innerHTML', 'document.cookie']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test('the registry points the #setup view at the wizard', () => {
  assert.equal(setupSection.id, 'setup');
  assert.equal(typeof setupSection.render, 'function');
});
