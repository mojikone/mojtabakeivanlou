// Publish logic (Task 22a, spec 13.6 and 12): the commit builder and the publish orchestration, against a fake GitHub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SECTION_LABELS, SESSION_KEY_MISMATCH, buildCommit, publish, finalizePublished, clean, PublishValidationError,
} from '../admin/modules/publish.mjs';
import { createStore } from '../admin/modules/state.mjs';
import { createMemoryFileStore } from '../admin/modules/files.mjs';
import { AuthError, ConflictError, GitHubError } from '../admin/modules/github.mjs';
import { icons } from '../assets/js/render/icons.mjs';
import {
  createAccessFile, createKeysFile, addEntry, unlock, readMeta, seal, generateKey, exportKey, importKey,
  generateDownloadCode, randomId, randomBytes, shortId, wrapFileKey, unwrapFileKey,
} from '../assets/js/vault.mjs';

const ITER = 1000; // production uses 600000; tests stay fast
const SITE = JSON.parse(readFileSync(new URL('./fixtures/site.min.json', import.meta.url), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);
const asFile = (x) => enc(`${JSON.stringify(x, null, 2)}\n`);
const BULLET = ['site', 'experience', 'companies', 0, 'projects', 0, 'bullets', 0];
const PATHS = { site: 'content/site.json', access: 'vault/access.json', keys: 'vault/keys.json' };
const ADMIN_CODE = 'Test-Admin-Code-1';
const GITHUB = { token: 'ghp_FAKETESTTOKEN0000', owner: 'mojikone', repo: 'mojtabakeivanlou', branch: 'redesign3_admin_test' };
const DAY = '2026-10-21';
const SUCCESS = { status: 'completed', conclusion: 'success', html_url: 'https://x/run/1' };
const CANCELLED = { status: 'completed', conclusion: 'cancelled', html_url: 'https://x/run/2' };
const FAILURE = { status: 'completed', conclusion: 'failure', html_url: 'https://x/run/9' };

function memStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
}

// A draft as the store holds it, without a store (buildCommit is pure).
function plainDraft(over = {}) {
  return {
    v: 1,
    baseCommit: 'head0',
    baseShas: { site: 'sha-site-0', access: 'sha-access-0', keys: 'sha-keys-0' },
    site: clone(SITE),
    access: createAccessFile(ITER),
    keys: createKeysFile('abcdef01'),
    pending: [],
    deleted: [],
    revoked: [],
    rotate: false,
    ...over,
  };
}

// A fake GitHub client: the methods publish uses, recording every call. `runs[sha]` is a queue of answers for
// latestRun(sha) (a function is called); the last answer repeats. Commits are named commit1, commit2, ...
// commitFiles behaves like the real ref update (force: false): it refuses a parent that is no longer the head.
function fakeGitHub(base) {
  const calls = [];
  const files = {
    [PATHS.site]: { sha: base.shas.site, bytes: asFile(base.site) },
    [PATHS.access]: { sha: base.shas.access, bytes: asFile(base.access) },
    [PATHS.keys]: { sha: base.shas.keys, bytes: asFile(base.keys) },
  };
  let head = base.commit;
  let commits = 0;
  const gh = {
    calls,
    files,
    runs: {},
    commitError: null,
    fileError: null,
    setHead(sha) { head = sha; },
    async getHead() {
      calls.push(['getHead']);
      return { sha: head, tree: `tree-${head}` };
    },
    async getFile(path) {
      calls.push(['getFile', path]);
      if (gh.fileError) throw gh.fileError;
      const file = files[path];
      return file ? { sha: file.sha, bytes: file.bytes } : null;
    },
    async listTree(tree) {
      calls.push(['listTree', tree]);
      return Object.keys(files);
    },
    async commitFiles(args) {
      calls.push(['commitFiles', args]);
      if (gh.commitError) throw gh.commitError;
      if (args.parent !== head) throw new ConflictError(422, `GitHub answered 422 to PATCH /repos/o/r/git/refs/heads/b: Update is not a fast forward (${args.parent} is not ${head})`);
      commits += 1;
      const sha = `commit${commits}`;
      for (const f of args.files) files[f.path] = { sha: `${f.path}@${sha}`, bytes: f.bytes };
      for (const path of args.deletes) delete files[path];
      head = sha;
      return { sha };
    },
    async latestRun(sha) {
      calls.push(['latestRun', sha]);
      const queue = gh.runs[sha] ?? [null];
      const next = queue.length > 1 ? queue.shift() : queue[0];
      return typeof next === 'function' ? next() : next;
    },
  };
  return gh;
}

// The default vault of setup(): one admin entry, and the session it gives (its keys are the ones the entry holds, so
// publish's session check passes).
async function makeAdminVault() {
  const vk = await generateKey();
  const ok = await generateKey();
  const [vkB64, okB64] = [await exportKey(vk), await exportKey(ok)];
  const access = await addEntry(createAccessFile(ITER), { kind: 'admin', code: ADMIN_CODE, payload: { vk: vkB64, ok: okB64, github: GITHUB }, meta: { label: 'Admin', created: DAY } }, ok);
  const admin = await unlock(access, ADMIN_CODE);
  return { access, session: { vk: vkB64, ok: okB64, kek: await exportKey(admin.kek), entryId: admin.entry.id } };
}
const ADMIN_VAULT = await makeAdminVault();

// A store initialised from a base that matches the fake GitHub, a memory file store and a recording onProgress.
function setup({ access = ADMIN_VAULT.access, keys = createKeysFile('abcdef01'), session, site = SITE } = {}) {
  const storage = memStorage();
  const store = createStore({ storage });
  const base = {
    commit: 'head0',
    shas: { site: 'sha-site-0', access: 'sha-access-0', keys: 'sha-keys-0' },
    site: clone(site),
    access,
    keys,
  };
  store.init(base);
  const gh = fakeGitHub(base);
  gh.runs.commit1 = [null, SUCCESS];
  const fileStore = createMemoryFileStore();
  const steps = [];
  const onProgress = (step, info) => { steps.push([step, info]); };
  const sess = session ?? ADMIN_VAULT.session;
  const run = (over = {}) => publish({ store, gh, fileStore, session: sess, icons, onProgress, pollMs: 1, ...over });
  return { storage, store, base, gh, fileStore, steps, run, session: sess };
}

const names = (steps) => steps.map(([step]) => step);
const commitCalls = (gh) => gh.calls.filter(([method]) => method === 'commitFiles').map(([, args]) => args);

// Adds a pending file (ciphertext in the file store, record on the first bullet) and returns its id and bytes.
async function attach(w) {
  const id = randomId();
  const blob = randomBytes(64);
  await w.fileStore.put(id, blob);
  w.store.addPendingFile(BULLET, { id, name: 'report.pdf', size: 36, type: 'application/pdf', enc: true });
  return { id, blob };
}

// The fixture site with these file records on the first bullet.
function siteWithFiles(...ids) {
  const site = clone(SITE);
  site.experience.companies[0].projects[0].bullets[0].files = ids.map((id) => ({ id, name: `${id.slice(0, 4)}.pdf`, size: 3, type: 'application/pdf', enc: true }));
  return site;
}

// An admin entry plus two download codes, one to keep and one to revoke, and one existing file key (its record on
// the first bullet of `site`). The metas are sealed under the owner key `ok`, which only the admin payload holds.
async function makeVault() {
  const vk = await generateKey();
  const vkB64 = await exportKey(vk);
  const ok = await generateKey();
  const okB64 = await exportKey(ok);
  const kept = generateDownloadCode();
  let gone = generateDownloadCode();
  while (gone === kept) gone = generateDownloadCode();
  let access = createAccessFile(ITER);
  access = await addEntry(access, { kind: 'admin', code: ADMIN_CODE, payload: { vk: vkB64, ok: okB64, github: GITHUB }, meta: { label: 'Admin', created: DAY } }, ok);
  access = await addEntry(access, { kind: 'download', code: kept, payload: { vk: vkB64 }, meta: { label: 'Kept hirer', created: DAY, code: kept } }, ok);
  access = await addEntry(access, { kind: 'download', code: gone, payload: { vk: vkB64 }, meta: { label: 'Revoked hirer', created: DAY, code: gone } }, ok);
  const fileId = randomId();
  const fk = await generateKey();
  const keys = { ...createKeysFile(shortId()), files: { [fileId]: await wrapFileKey(vk, fk) } };
  const admin = await unlock(access, ADMIN_CODE);
  const session = { vk: vkB64, ok: okB64, kek: await exportKey(admin.kek), entryId: admin.entry.id };
  return { vk, vkB64, ok, okB64, kept, gone, access, keys, fileId, fk, session, site: siteWithFiles(fileId), ids: access.entries.map((e) => e.id) };
}

/* ─── SECTION_LABELS and buildCommit ─── */

test('SECTION_LABELS: every dashboard section, in nav order', () => {
  assert.deepEqual(SECTION_LABELS, {
    profile: 'Profile & contact', education: 'Education', languages: 'Languages', services: 'Engineering services',
    experience: 'Experience', skills: 'Skills & software', contact: 'Contact page', access: 'Access codes',
    files: 'Files', settings: 'Settings',
  });
  assert.deepEqual(Object.keys(SECTION_LABELS), ['profile', 'education', 'languages', 'services', 'experience', 'skills', 'contact', 'access', 'files', 'settings']);
});

test('buildCommit: site.json, keys.json and the blob of a pending file, a delete for a deleted file, the dirty labels', () => {
  const draft = plainDraft();
  const base = { access: clone(draft.access), keys: clone(draft.keys) };
  const pendingId = randomId();
  const deletedId = randomId();
  const record = { id: pendingId, name: 'report.pdf', size: 36, type: 'application/pdf', enc: true };
  draft.site.experience.companies[0].projects[0].bullets[0].files = [record];
  draft.pending = [record];
  draft.deleted = [deletedId];
  const blob = randomBytes(64);

  const commit = buildCommit(draft, { [pendingId]: blob }, ['experience'], base);

  assert.deepEqual(commit.files.map((f) => f.path), ['content/site.json', 'vault/keys.json', `vault/files/${pendingId}.bin`]);
  assert.equal(commit.files[2].bytes, blob);
  assert.deepEqual([...commit.files[2].bytes], [...blob]);
  assert.deepEqual(commit.deletes, [`vault/files/${deletedId}.bin`]);
  assert.equal(commit.message, 'Content update from dashboard: Experience');
  assert.equal(dec(commit.files[0].bytes), `${JSON.stringify(draft.site, null, 2)}\n`);
  assert.equal(dec(commit.files[1].bytes), `${JSON.stringify(draft.keys, null, 2)}\n`);
});

test('buildCommit: rotate includes access.json and keys.json; labels follow SECTION_LABELS order', () => {
  const draft = plainDraft({ rotate: true, revoked: ['0badc0de'] });
  const base = { access: clone(draft.access), keys: clone(draft.keys) };
  const commit = buildCommit(draft, {}, ['settings', 'access'], base);
  assert.deepEqual(commit.files.map((f) => f.path), ['content/site.json', 'vault/access.json', 'vault/keys.json']);
  assert.deepEqual(commit.deletes, []);
  assert.equal(commit.message, 'Content update from dashboard: Access codes, Settings');
  assert.deepEqual(JSON.parse(dec(commit.files[1].bytes)), draft.access);
});

test('buildCommit: access.json and keys.json when they differ from the base (or it is unknown); no labels, plain message', async () => {
  const draft = plainDraft();
  const base = { access: clone(draft.access), keys: clone(draft.keys) };
  const vk = await generateKey();
  draft.access = await addEntry(draft.access, { kind: 'download', code: 'MK-TEST-2345', payload: { vk: await exportKey(vk) }, meta: { label: 'x', created: DAY, code: 'MK-TEST-2345' } }, await generateKey());
  assert.deepEqual(buildCommit(draft, {}, [], base).files.map((f) => f.path), ['content/site.json', 'vault/access.json']);
  draft.keys = { ...draft.keys, files: { [randomId()]: { iv: 'aXY=', key: 'a2V5' } } };
  assert.deepEqual(buildCommit(draft, {}, [], base).files.map((f) => f.path), ['content/site.json', 'vault/access.json', 'vault/keys.json']);
  const same = plainDraft();
  assert.deepEqual(buildCommit(same, {}, [], { access: clone(same.access), keys: clone(same.keys) }).files.map((f) => f.path), ['content/site.json']);
  assert.deepEqual(buildCommit(same, {}, []).files.map((f) => f.path), ['content/site.json', 'vault/access.json', 'vault/keys.json']);
  const deletedOnly = plainDraft({ deleted: [randomId()] });
  assert.equal(buildCommit(deletedOnly, {}, [], { access: deletedOnly.access, keys: deletedOnly.keys }).message, 'Content update from dashboard');
});

test('buildCommit: with the head tree, a deleted file that is not in it is left out of deletes (T6)', () => {
  const [here, gone] = [randomId(), randomId()];
  const draft = plainDraft({ deleted: [here, gone] });
  const base = { access: clone(draft.access), keys: clone(draft.keys) };
  const headPaths = ['content/site.json', `vault/files/${here}.bin`, 'vault/access.json'];
  assert.deepEqual(buildCommit(draft, {}, [], base, headPaths).deletes, [`vault/files/${here}.bin`]);
  assert.deepEqual(buildCommit(draft, {}, [], base, new Set(headPaths)).deletes, [`vault/files/${here}.bin`], 'a Set works too');
  assert.deepEqual(buildCommit(draft, {}, [], base, []).deletes, [], 'an empty tree: nothing to delete');
  assert.deepEqual(buildCommit(draft, {}, [], base).deletes, [`vault/files/${here}.bin`, `vault/files/${gone}.bin`], 'no tree given: every deleted file');
  assert.throws(() => buildCommit(plainDraft({ deleted: ['../x'] }), {}, [], base, ['../x']), /invalid file id/, 'ids are still checked');
});

test('buildCommit: a pending file without its blob throws; so does a malformed file id', () => {
  const id = randomId();
  const draft = plainDraft({ pending: [{ id, name: 'a.pdf', size: 1, type: 'application/pdf', enc: true }] });
  assert.throws(() => buildCommit(draft, {}, ['files']), { message: `missing blob ${id}` });
  assert.throws(() => buildCommit(plainDraft({ deleted: ['../../content/site'] }), {}, []), /invalid file id/);
});

test('buildCommit: a file id both pending and deleted throws instead of uploading and deleting the same path', () => {
  const id = randomId();
  const record = { id, name: 'a.pdf', size: 1, type: 'application/pdf', enc: true };
  const draft = plainDraft({ pending: [record], deleted: [randomId(), id] });
  assert.throws(() => buildCommit(draft, { [id]: randomBytes(8) }, ['files']), { message: `file both pending and deleted: ${id}` });
  assert.throws(() => buildCommit(plainDraft({ pending: [id], deleted: [id] }), { [id]: randomBytes(8) }, []), { message: `file both pending and deleted: ${id}` });
});

/* ─── publish ─── */

test('publish: validating, checking, committing, building, live; one commit on the head; the blob is deleted and the draft rebased', async () => {
  const w = setup();
  w.store.set([...BULLET, 'text'], 'Flood-hazard assessment, revised');
  const { id, blob } = await attach(w);

  const result = await w.run();

  assert.deepEqual(names(w.steps), ['validating', 'checking', 'committing', 'building', 'live']);
  assert.deepEqual(w.steps[3][1], { sha: 'commit1' });
  assert.deepEqual(w.steps[4][1], { sha: 'commit1', url: 'https://mojtabakeivanlou.com/' });
  assert.deepEqual(result, { sha: 'commit1' });

  const commits = commitCalls(w.gh);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].parent, 'head0');
  assert.deepEqual(commits[0].files.map((f) => f.path), ['content/site.json', 'vault/keys.json', `vault/files/${id}.bin`]);
  assert.equal(commits[0].files[2].bytes, blob);
  assert.deepEqual(commits[0].deletes, []);
  assert.equal(commits[0].message, 'Content update from dashboard: Experience, Files');
  assert.equal(JSON.parse(dec(commits[0].files[0].bytes)).experience.companies[0].projects[0].bullets[0].text, 'Flood-hazard assessment, revised');

  assert.equal(await w.fileStore.get(id), null);
  const d = w.store.get();
  assert.equal(d.baseCommit, 'commit1');
  assert.deepEqual(d.baseShas, { site: 'content/site.json@commit1', access: 'sha-access-0', keys: 'vault/keys.json@commit1' });
  assert.equal(w.store.dirty().total, 0);
  assert.deepEqual(d.pending, []);
  assert.equal(d.site.experience.companies[0].projects[0].bullets[0].text, 'Flood-hazard assessment, revised');
  assert.equal(w.storage.getItem('mk.draft'), null);
});

test('publish: a changed content/site.json on GitHub is a conflict; nothing is committed and the draft stays', async () => {
  const w = setup();
  w.store.set([...BULLET, 'text'], 'changed');
  const { id } = await attach(w);
  w.gh.files[PATHS.site].sha = 'sha-site-other';
  const before = w.store.get();

  const result = await w.run();

  assert.deepEqual(w.steps, [['validating', undefined], ['checking', undefined], ['conflict', { paths: ['content/site.json'] }]]);
  assert.deepEqual(result, { conflict: true, paths: ['content/site.json'] });
  assert.equal(commitCalls(w.gh).length, 0);
  assert.equal(w.store.get(), before);
  assert.ok(await w.fileStore.get(id));
});

test('publish: a missing remote file equals a null base sha; a remote file the base did not have is a conflict', async () => {
  const w = setup();
  w.store.set(['baseShas', 'keys'], null);
  delete w.gh.files[PATHS.keys];
  assert.deepEqual(await w.run(), { sha: 'commit1' });

  const v = setup();
  v.store.set(['baseShas', 'access'], null);
  assert.deepEqual(await v.run(), { conflict: true, paths: ['vault/access.json'] });
  assert.equal(commitCalls(v.gh).length, 0);
});

test('publish: a ConflictError from commitFiles (the branch moved) is a conflict on the ref', async () => {
  const w = setup();
  w.store.set([...BULLET, 'text'], 'changed');
  w.gh.commitError = new ConflictError(422, 'GitHub answered 422 to PATCH /repos/o/r/git/refs/heads/b: Update is not a fast forward');
  const before = w.store.get();

  const result = await w.run();

  assert.deepEqual(names(w.steps), ['validating', 'checking', 'committing', 'conflict']);
  assert.deepEqual(w.steps[3][1], { paths: ['ref'] });
  assert.deepEqual(result, { conflict: true, paths: ['ref'] });
  assert.equal(w.store.get(), before);
});

test('publish: a failed run reports its URL and the commit sha; the draft and the pending blob stay', async () => {
  const w = setup();
  w.store.set([...BULLET, 'text'], 'changed');
  const { id } = await attach(w);
  w.gh.runs.commit1 = [null, { status: 'in_progress', conclusion: null, html_url: FAILURE.html_url }, FAILURE];
  const before = w.store.get();

  const result = await w.run();

  assert.deepEqual(names(w.steps), ['validating', 'checking', 'committing', 'building', 'failed']);
  assert.deepEqual(w.steps[4][1], { sha: 'commit1', runUrl: 'https://x/run/9' });
  assert.deepEqual(result, { failed: true, runUrl: 'https://x/run/9', sha: 'commit1' });
  assert.equal(w.store.get(), before);
  assert.ok(await w.fileStore.get(id));
});

test('publish: a run cancelled by a newer push is followed on the new head until it succeeds', async () => {
  const w = setup();
  w.store.set([...BULLET, 'text'], 'changed');
  w.gh.runs.commit1 = [() => { w.gh.setHead('sha2'); return CANCELLED; }];
  w.gh.runs.sha2 = [null, SUCCESS];

  const result = await w.run();

  assert.deepEqual(names(w.steps), ['validating', 'checking', 'committing', 'building', 'live']);
  assert.deepEqual(result, { sha: 'commit1' });
  assert.deepEqual(w.gh.calls.filter(([m]) => m === 'latestRun').map(([, sha]) => sha), ['commit1', 'sha2', 'sha2']);
});

test('publish: a run cancelled with nothing newer on the branch is a failure', async () => {
  const w = setup();
  w.store.set([...BULLET, 'text'], 'changed');
  w.gh.runs.commit1 = [CANCELLED];
  assert.deepEqual(await w.run(), { failed: true, runUrl: CANCELLED.html_url, sha: 'commit1' });
  assert.deepEqual(w.steps.at(-1), ['failed', { sha: 'commit1', runUrl: CANCELLED.html_url }]);
});

test('publish: no completed run within maxPolls is a timeout; transient GitHub errors while polling are retried', async () => {
  const w = setup();
  w.store.set([...BULLET, 'text'], 'changed');
  const before = w.store.get();
  w.gh.runs.commit1 = [null];
  assert.deepEqual(await w.run({ maxPolls: 3 }), { failed: true, reason: 'timeout', sha: 'commit1' });
  assert.deepEqual(w.steps.at(-1), ['failed', { sha: 'commit1', reason: 'timeout' }]);
  assert.equal(w.gh.calls.filter(([m]) => m === 'latestRun').length, 3);
  assert.equal(w.store.get(), before);

  // a run that was seen but never completed: its URL comes with the timeout, for the "check the run" link
  const u = setup();
  u.store.set([...BULLET, 'text'], 'changed');
  u.gh.runs.commit1 = [{ status: 'in_progress', conclusion: null, html_url: 'https://x/run/5', id: 5 }];
  assert.deepEqual(await u.run({ maxPolls: 2 }), { failed: true, reason: 'timeout', runUrl: 'https://x/run/5', sha: 'commit1' });
  assert.deepEqual(u.steps.at(-1), ['failed', { sha: 'commit1', reason: 'timeout', runUrl: 'https://x/run/5' }]);

  const v = setup();
  v.store.set([...BULLET, 'text'], 'changed');
  v.gh.runs.commit1 = [() => { throw new GitHubError(0, 'Could not reach GitHub (GET /x)'); }, () => { throw new GitHubError(502, 'GitHub answered 502 to GET /x'); }, SUCCESS];
  assert.deepEqual(await v.run(), { sha: 'commit1' });
  assert.equal(names(v.steps).at(-1), 'live');
});

test('publish: an invalid draft rejects with PublishValidationError naming the path; onProgress saw only validating', async () => {
  const w = setup();
  w.store.set(['site', 'profile', 'firstName'], '');
  await assert.rejects(w.run(), (err) => {
    assert.ok(err instanceof PublishValidationError);
    assert.match(err.errors[0], /^profile\.firstName /);
    return true;
  });
  assert.deepEqual(names(w.steps), ['validating']);
  assert.equal(w.gh.calls.length, 0);
});

test('publish: an AuthError before the commit rejects; any other failure resolves failed with the token stripped', async () => {
  const w = setup();
  w.gh.fileError = new AuthError(401, 'GitHub answered 401 to GET /repos/o/r/contents/content/site.json: Bad credentials');
  await assert.rejects(w.run(), AuthError);
  assert.deepEqual(names(w.steps), ['validating', 'checking']);

  const v = setup();
  v.store.set([...BULLET, 'text'], 'changed');
  v.gh.commitError = new GitHubError(500, `GitHub answered 500 to POST /x: ghp_AbC123xyz github_pat_11AB_cd ${v.session.vk}`);
  const result = await v.run();
  assert.deepEqual(result, { failed: true, error: 'GitHub answered 500 to POST /x: [token] [token] [secret]' });
  assert.deepEqual(v.steps.at(-1), ['failed', { error: result.error }]);
});

test('publish: rotation drops the revoked code, keeps the other, rewraps the file keys and returns the new vk and ok', async () => {
  const vault = await makeVault();
  const w = setup({ access: vault.access, keys: vault.keys, session: vault.session, site: vault.site });
  w.store.set(['revoked'], [vault.ids[2]]);
  w.store.set(['rotate'], true);

  const result = await w.run();

  assert.deepEqual(names(w.steps), ['validating', 'checking', 'committing', 'building', 'live']);
  assert.deepEqual(Object.keys(result).sort(), ['ok', 'sha', 'vk']);
  assert.equal(result.sha, 'commit1');
  assert.notEqual(result.vk, vault.vkB64);
  assert.notEqual(result.ok, vault.okB64);

  const [commit] = commitCalls(w.gh);
  assert.deepEqual(commit.files.map((f) => f.path), ['content/site.json', 'vault/access.json', 'vault/keys.json']);
  assert.equal(commit.message, 'Content update from dashboard: Access codes');
  const newAccess = JSON.parse(dec(commit.files[1].bytes));
  const newKeys = JSON.parse(dec(commit.files[2].bytes));

  const kept = await unlock(newAccess, vault.kept);
  assert.equal(kept.kind, 'download');
  assert.deepEqual(kept.payload, { vk: result.vk });
  assert.equal(await unlock(newAccess, vault.gone), null);
  const admin = await unlock(newAccess, ADMIN_CODE);
  assert.equal(admin.payload.vk, result.vk);
  assert.equal(admin.payload.ok, result.ok);
  assert.deepEqual(admin.payload.github, GITHUB);
  assert.deepEqual(newAccess.entries.map((e) => e.id), [vault.ids[0], vault.ids[1]]);

  assert.notEqual(newKeys.vk, vault.keys.vk);
  const newVk = await importKey(result.vk);
  const newOk = await importKey(result.ok);
  assert.equal((await readMeta(newAccess.entries[1], newOk)).code, vault.kept);
  for (const entry of newAccess.entries) {
    await assert.rejects(readMeta(entry, newVk), { message: 'decrypt failed' }, 'the new vault key a hirer gets opens no meta');
    await assert.rejects(readMeta(entry, vault.ok), { message: 'decrypt failed' }, 'neither does the old owner key');
  }
  assert.equal(await exportKey(await unwrapFileKey(newVk, newKeys.files[vault.fileId])), await exportKey(vault.fk));

  const d = w.store.get();
  assert.deepEqual(d.access, newAccess);
  assert.deepEqual(d.keys, newKeys);
  assert.equal(d.rotate, false);
  assert.deepEqual(d.revoked, []);
  assert.equal(w.store.dirty().total, 0);
});

test('publish: a kept download entry whose meta the current owner key cannot read fails before anything is committed', async () => {
  const vault = await makeVault();
  const access = clone(vault.access);
  access.entries[1].meta = await seal(await generateKey(), enc(JSON.stringify({ label: 'x', created: DAY, code: vault.kept })));
  const w = setup({ access, keys: vault.keys, session: vault.session });
  w.store.set(['revoked'], [vault.ids[2]]);
  w.store.set(['rotate'], true);
  const before = w.store.get();

  const result = await w.run();

  assert.deepEqual(names(w.steps), ['validating', 'checking', 'failed']);
  assert.deepEqual(Object.keys(result).sort(), ['error', 'failed']);
  assert.equal(result.failed, true);
  assert.match(result.error, new RegExp(vault.ids[1]));
  assert.match(result.error, /owner key/);
  for (const secret of [vault.kept, vault.gone, vault.session.vk, vault.session.ok, vault.session.kek]) assert.ok(!result.error.includes(secret));
  assert.equal(commitCalls(w.gh).length, 0);
  assert.equal(w.store.get(), before);
});

test('publish: a committed rotation reports the new vk even when the build fails; the draft is not reset', async () => {
  const vault = await makeVault();
  const w = setup({ access: vault.access, keys: vault.keys, session: vault.session });
  w.store.set(['revoked'], [vault.ids[2]]);
  w.store.set(['rotate'], true);
  w.gh.runs.commit1 = [FAILURE];
  const before = w.store.get();

  const result = await w.run();

  assert.deepEqual(Object.keys(result).sort(), ['failed', 'ok', 'runUrl', 'sha', 'vk']);
  assert.equal(result.sha, 'commit1');
  const committed = JSON.parse(dec(commitCalls(w.gh)[0].files[1].bytes));
  assert.equal((await unlock(committed, vault.kept)).payload.vk, result.vk);
  assert.equal(w.store.get(), before);
  assert.deepEqual(w.steps.at(-1), ['failed', { sha: 'commit1', runUrl: FAILURE.html_url }]);
});

/* ─── carried from the 22a review ─── */

test('publish: a push between the check and the ref update (the parent race) is a ref conflict; nothing lands', async () => {
  const w = setup();
  w.store.set([...BULLET, 'text'], 'changed');
  const before = w.store.get();
  // someone pushes right after the conflict check passed
  const onProgress = (step, info) => {
    w.steps.push([step, info]);
    if (step === 'committing') w.gh.setHead('pushed-meanwhile');
  };

  const result = await w.run({ onProgress });

  assert.deepEqual(result, { conflict: true, paths: ['ref'] });
  assert.deepEqual(names(w.steps), ['validating', 'checking', 'committing', 'conflict']);
  const [commit] = commitCalls(w.gh);
  assert.equal(commit.parent, 'head0');                     // the head read at the check, not the moved one
  assert.equal(w.gh.files[PATHS.site].sha, 'sha-site-0');   // the fake refused it: nothing was written
  assert.equal((await w.gh.getHead()).sha, 'pushed-meanwhile');
  assert.equal(w.store.get(), before);
  assert.equal(w.gh.calls.filter(([m]) => m === 'latestRun').length, 0);
});

test('publish: a non-empty revoked rotates even when rotate is false', async () => {
  const vault = await makeVault();
  const w = setup({ access: vault.access, keys: vault.keys, session: vault.session });
  w.store.set(['revoked'], [vault.ids[2]]);
  assert.equal(w.store.get().rotate, false);

  const result = await w.run();

  assert.deepEqual(Object.keys(result).sort(), ['ok', 'sha', 'vk']);
  assert.notEqual(result.vk, vault.vkB64);
  const [commit] = commitCalls(w.gh);
  assert.deepEqual(commit.files.map((f) => f.path), ['content/site.json', 'vault/access.json', 'vault/keys.json']);
  const newAccess = JSON.parse(dec(commit.files[1].bytes));
  assert.equal(await unlock(newAccess, vault.gone), null);
  assert.equal((await unlock(newAccess, vault.kept)).payload.vk, result.vk);
  assert.notEqual(JSON.parse(dec(commit.files[2].bytes)).vk, vault.keys.vk);
  assert.deepEqual(w.store.get().revoked, []);
  assert.equal(w.store.dirty().total, 0);
});

test('publish: an AuthError while polling, after the commit, resolves failed with the error, the sha and the new vk', async () => {
  const vault = await makeVault();
  const w = setup({ access: vault.access, keys: vault.keys, session: vault.session });
  w.store.set(['revoked'], [vault.ids[2]]);
  w.store.set(['rotate'], true);
  w.gh.runs.commit1 = [() => { throw new AuthError(401, 'GitHub answered 401 to GET /repos/o/r/actions/runs: Bad credentials'); }];
  const before = w.store.get();

  const result = await w.run();

  assert.deepEqual(Object.keys(result).sort(), ['error', 'failed', 'ok', 'sha', 'vk']);
  assert.equal(result.failed, true);
  assert.equal(result.sha, 'commit1');
  assert.equal(result.error, 'GitHub answered 401 to GET /repos/o/r/actions/runs: Bad credentials');
  assert.deepEqual(w.steps.at(-1), ['failed', { sha: 'commit1', error: result.error }]);
  const committed = JSON.parse(dec(commitCalls(w.gh)[0].files[1].bytes));
  assert.equal((await unlock(committed, vault.kept)).payload.vk, result.vk);
  assert.equal(w.store.get(), before);                      // the UI finalizes; publish leaves the draft alone
});

test('publish: a session whose vault key or owner key is not the one its admin entry holds commits nothing (I2)', async () => {
  const other = await exportKey(await generateKey());
  const stale = [
    { ...ADMIN_VAULT.session, vk: other },                 // kept from before a rotation (a reload during the build)
    { ...ADMIN_VAULT.session, ok: other },
    { ...ADMIN_VAULT.session, kek: other },                // a KEK that opens nothing
    { ...ADMIN_VAULT.session, entryId: 'ffffffff' },       // an entry the draft does not hold
    { ...ADMIN_VAULT.session, ok: undefined },
  ];
  for (const session of stale) {
    const w = setup({ session });
    await attach(w);                                       // the real risk: an attachment wrapped under a stale key
    const before = w.store.get();

    const result = await w.run();

    assert.deepEqual(result, { failed: true, error: SESSION_KEY_MISMATCH });
    assert.equal(SESSION_KEY_MISMATCH, 'session vault key does not match the vault');
    assert.deepEqual(names(w.steps), ['validating', 'failed']);
    assert.deepEqual(w.steps.at(-1), ['failed', { error: SESSION_KEY_MISMATCH }]);
    assert.deepEqual(w.gh.calls, [], 'not even the head is read');
    assert.equal(w.store.get(), before);
  }
});

test('publish: onCommitted gets the sha, and with a rotation the new keys, the moment the commit lands (before the build)', async () => {
  const vault = await makeVault();
  const w = setup({ access: vault.access, keys: vault.keys, session: vault.session, site: vault.site });
  w.store.set(['revoked'], [vault.ids[2]]);
  const order = [];
  const committed = [];
  const onProgress = (step) => { order.push(step); };
  const onCommitted = (info) => { order.push('onCommitted'); committed.push(info); };

  const result = await w.run({ onProgress, onCommitted });

  assert.deepEqual(order, ['validating', 'checking', 'committing', 'onCommitted', 'building', 'live']);
  assert.deepEqual(committed, [{ sha: 'commit1', vk: result.vk, ok: result.ok }]);
  assert.notEqual(result.vk, vault.vkB64);

  // without a rotation: the sha alone; a throwing callback breaks nothing
  const plain = setup();
  plain.store.set([...BULLET, 'text'], 'changed');
  const seen = [];
  const again = await plain.run({ onCommitted: (info) => { seen.push(info); throw new Error('a broken callback'); } });
  assert.deepEqual(seen, [{ sha: 'commit1' }]);
  assert.deepEqual(again, { sha: 'commit1' });

  // nothing committed (a conflict): never called
  const conflict = setup();
  conflict.store.set([...BULLET, 'text'], 'changed');
  conflict.gh.files[PATHS.site].sha = 'moved';
  const none = [];
  assert.equal((await conflict.run({ onCommitted: (info) => none.push(info) })).conflict, true);
  assert.deepEqual(none, []);
});

test('publish: live carries the run id of the run that went live (for the deploy check)', async () => {
  const w = setup();
  w.store.set([...BULLET, 'text'], 'changed');
  w.gh.runs.commit1 = [{ ...SUCCESS, id: 77 }];
  assert.deepEqual(await w.run(), { sha: 'commit1' });
  assert.deepEqual(w.steps.at(-1), ['live', { sha: 'commit1', url: 'https://mojtabakeivanlou.com/', runId: 77 }]);
});

test('finalizePublished: refetches the three files, rebases the draft (badge 0, no stored draft), THEN deletes the blobs', async () => {
  const w = setup();
  w.store.set([...BULLET, 'text'], 'changed');
  const { id } = await attach(w);
  w.gh.runs.commit1 = [FAILURE];
  const draft = w.store.get();
  const result = await w.run();
  assert.equal(result.sha, 'commit1');
  assert.ok(await w.fileStore.get(id));                     // publish itself leaves them after a failed build
  assert.notEqual(w.storage.getItem('mk.draft'), null);

  const log = [];
  const gh = { ...w.gh, getFile: async (path) => { log.push(['getFile', path]); return w.gh.getFile(path); } };
  const store = { ...w.store, reset: (b) => { log.push(['reset', b.commit]); return w.store.reset(b); } };
  const fileStore = { ...w.fileStore, delete: async (x) => { log.push(['delete', x, w.store.get().baseCommit]); return w.fileStore.delete(x); } };

  await finalizePublished({ store, gh, fileStore, draft, sha: result.sha });

  assert.deepEqual(log.map(([what]) => what), ['getFile', 'getFile', 'getFile', 'reset', 'delete']);
  assert.deepEqual(log.at(-1), ['delete', id, 'commit1']);
  assert.equal(await w.fileStore.get(id), null);
  const d = w.store.get();
  assert.equal(d.baseCommit, 'commit1');
  assert.deepEqual(d.baseShas, { site: 'content/site.json@commit1', access: 'sha-access-0', keys: 'vault/keys.json@commit1' });
  assert.equal(d.site.experience.companies[0].projects[0].bullets[0].text, 'changed');
  assert.deepEqual(d.pending, []);
  assert.equal(w.store.dirty().total, 0);
  assert.equal(w.storage.getItem('mk.draft'), null);
});

test('finalizePublished: a failing rebase rejects and keeps the draft and the blobs', async () => {
  const w = setup();
  const { id } = await attach(w);
  const before = w.store.get();
  const store = { ...w.store, reset: () => { throw new Error('storage exploded'); } };
  await assert.rejects(finalizePublished({ store, gh: w.gh, fileStore: w.fileStore, draft: before, sha: 'commit9' }), /storage exploded/);
  assert.ok(await w.fileStore.get(id));
  assert.equal(w.store.get(), before);
});

test('publish: keys.json drops the keys of deleted files and of files no bullet references; a referenced pending file keeps its key', async () => {
  const committedId = randomId();
  const strayId = randomId();
  const keptId = randomId();
  const keys = {
    ...createKeysFile('abcdef01'),
    files: { [committedId]: { iv: 'aXY=', key: 'Y29tbWl0dGVk' }, [strayId]: { iv: 'aXY=', key: 'c3RyYXk=' }, [keptId]: { iv: 'aXY=', key: 'a2VwdA==' } },
  };
  const w = setup({ keys, site: siteWithFiles(committedId, keptId) });
  w.gh.files[`vault/files/${committedId}.bin`] = { sha: 'blob-committed', bytes: randomBytes(8) };
  w.store.removeFile(BULLET, committedId);
  assert.deepEqual(w.store.get().deleted, [committedId]);
  const { id: pendingId } = await attach(w);
  w.store.set(['keys', 'files', pendingId], { iv: 'cGVu', key: 'ZGluZw==' });
  assert.ok(w.store.get().keys.files[committedId] && w.store.get().keys.files[strayId]); // the draft keeps them (Undo)

  const result = await w.run();

  assert.deepEqual(result, { sha: 'commit1' });
  const [commit] = commitCalls(w.gh);
  const committed = JSON.parse(dec(commit.files.find((f) => f.path === 'vault/keys.json').bytes));
  assert.deepEqual(Object.keys(committed.files).sort(), [keptId, pendingId].sort());
  assert.deepEqual(committed.files[pendingId], { iv: 'cGVu', key: 'ZGluZw==' });
  assert.deepEqual(commit.deletes, [`vault/files/${committedId}.bin`]);
});

test('publish: a deleted file the head tree no longer holds is not deleted again; the tree is listed only for deletes (T6)', async () => {
  const [here, gone] = [randomId(), randomId()];
  const w = setup({ site: siteWithFiles(here, gone) });
  w.gh.files[`vault/files/${here}.bin`] = { sha: 'blob-here', bytes: randomBytes(8) };   // `gone` was removed meanwhile
  w.store.removeFile(BULLET, here);
  w.store.removeFile(BULLET, gone);
  assert.deepEqual(w.store.get().deleted, [here, gone]);

  const result = await w.run();

  assert.deepEqual(result, { sha: 'commit1' });
  assert.deepEqual(w.gh.calls.filter(([m]) => m === 'listTree'), [['listTree', 'tree-head0']], 'the tree of the parent, once');
  assert.deepEqual(commitCalls(w.gh)[0].deletes, [`vault/files/${here}.bin`]);

  const plain = setup();
  plain.store.set([...BULLET, 'text'], 'changed');
  await plain.run();
  assert.equal(plain.gh.calls.filter(([m]) => m === 'listTree').length, 0, 'nothing deleted: no tree listing');
});

test('publish: a rotation rewraps only the keys that survive the prune', async () => {
  const vault = await makeVault();
  const strayId = randomId();
  const keys = { ...vault.keys, files: { ...vault.keys.files, [strayId]: await wrapFileKey(vault.vk, await generateKey()) } };
  const w = setup({ access: vault.access, keys, session: vault.session, site: vault.site });
  w.store.set(['revoked'], [vault.ids[2]]);

  const result = await w.run();

  const newKeys = JSON.parse(dec(commitCalls(w.gh)[0].files[2].bytes));
  assert.deepEqual(Object.keys(newKeys.files), [vault.fileId]);
  const newVk = await importKey(result.vk);
  assert.equal(await exportKey(await unwrapFileKey(newVk, newKeys.files[vault.fileId])), await exportKey(vault.fk));
});

test('clean: GitHub tokens and the given secrets are stripped from a message', () => {
  assert.equal(clean('a ghp_AbC123 b github_pat_11AB_cd c Secret-Value-1 d', ['Secret-Value-1', 'abc']), 'a [token] b [token] c [secret] d');
  assert.equal(clean(undefined, []), 'Unknown error');
});
