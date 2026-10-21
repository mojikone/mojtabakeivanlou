// Publish logic (Task 22a, spec 13.6 and 12): the commit builder and the publish orchestration, against a fake GitHub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SECTION_LABELS, buildCommit, publish, PublishValidationError } from '../admin/modules/publish.mjs';
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
    async commitFiles(args) {
      calls.push(['commitFiles', args]);
      if (gh.commitError) throw gh.commitError;
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

// A store initialised from a base that matches the fake GitHub, a memory file store and a recording onProgress.
function setup({ access = createAccessFile(ITER), keys = createKeysFile('abcdef01'), session } = {}) {
  const storage = memStorage();
  const store = createStore({ storage });
  const base = {
    commit: 'head0',
    shas: { site: 'sha-site-0', access: 'sha-access-0', keys: 'sha-keys-0' },
    site: clone(SITE),
    access,
    keys,
  };
  store.init(base);
  const gh = fakeGitHub(base);
  gh.runs.commit1 = [null, SUCCESS];
  const fileStore = createMemoryFileStore();
  const steps = [];
  const onProgress = (step, info) => { steps.push([step, info]); };
  const sess = session ?? { vk: 'A'.repeat(43) + '=', kek: 'B'.repeat(43) + '=', entryId: 'abcdef01' };
  const run = (over = {}) => publish({ store, gh, fileStore, session: sess, icons, onProgress, pollMs: 1, storage, ...over });
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

// An admin entry plus two download codes, one to keep and one to revoke, and one existing file key.
async function makeVault() {
  const vk = await generateKey();
  const vkB64 = await exportKey(vk);
  const kept = generateDownloadCode();
  let gone = generateDownloadCode();
  while (gone === kept) gone = generateDownloadCode();
  let access = createAccessFile(ITER);
  access = await addEntry(access, { kind: 'admin', code: ADMIN_CODE, payload: { vk: vkB64, github: GITHUB }, meta: { label: 'Admin', created: DAY } }, vk);
  access = await addEntry(access, { kind: 'download', code: kept, payload: { vk: vkB64 }, meta: { label: 'Kept hirer', created: DAY, code: kept } }, vk);
  access = await addEntry(access, { kind: 'download', code: gone, payload: { vk: vkB64 }, meta: { label: 'Revoked hirer', created: DAY, code: gone } }, vk);
  const fileId = randomId();
  const fk = await generateKey();
  const keys = { ...createKeysFile(shortId()), files: { [fileId]: await wrapFileKey(vk, fk) } };
  const admin = await unlock(access, ADMIN_CODE);
  const session = { vk: vkB64, kek: await exportKey(admin.kek), entryId: admin.entry.id };
  return { vk, vkB64, kept, gone, access, keys, fileId, fk, session, ids: access.entries.map((e) => e.id) };
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
  draft.access = await addEntry(draft.access, { kind: 'download', code: 'MK-TEST-2345', payload: { vk: await exportKey(vk) }, meta: { label: 'x', created: DAY, code: 'MK-TEST-2345' } }, vk);
  assert.deepEqual(buildCommit(draft, {}, [], base).files.map((f) => f.path), ['content/site.json', 'vault/access.json']);
  draft.keys = { ...draft.keys, files: { [randomId()]: { iv: 'aXY=', key: 'a2V5' } } };
  assert.deepEqual(buildCommit(draft, {}, [], base).files.map((f) => f.path), ['content/site.json', 'vault/access.json', 'vault/keys.json']);
  const same = plainDraft();
  assert.deepEqual(buildCommit(same, {}, [], { access: clone(same.access), keys: clone(same.keys) }).files.map((f) => f.path), ['content/site.json']);
  assert.deepEqual(buildCommit(same, {}, []).files.map((f) => f.path), ['content/site.json', 'vault/access.json', 'vault/keys.json']);
  const deletedOnly = plainDraft({ deleted: [randomId()] });
  assert.equal(buildCommit(deletedOnly, {}, [], { access: deletedOnly.access, keys: deletedOnly.keys }).message, 'Content update from dashboard');
});

test('buildCommit: a pending file without its blob throws; so does a malformed file id', () => {
  const id = randomId();
  const draft = plainDraft({ pending: [{ id, name: 'a.pdf', size: 1, type: 'application/pdf', enc: true }] });
  assert.throws(() => buildCommit(draft, {}, ['files']), { message: `missing blob ${id}` });
  assert.throws(() => buildCommit(plainDraft({ deleted: ['../../content/site'] }), {}, []), /invalid file id/);
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

test('publish: a failed run reports its URL; the draft and the pending blob stay', async () => {
  const w = setup();
  w.store.set([...BULLET, 'text'], 'changed');
  const { id } = await attach(w);
  w.gh.runs.commit1 = [null, { status: 'in_progress', conclusion: null, html_url: FAILURE.html_url }, FAILURE];
  const before = w.store.get();

  const result = await w.run();

  assert.deepEqual(names(w.steps), ['validating', 'checking', 'committing', 'building', 'failed']);
  assert.deepEqual(w.steps[4][1], { sha: 'commit1', runUrl: 'https://x/run/9' });
  assert.deepEqual(result, { failed: true, runUrl: 'https://x/run/9' });
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
  assert.deepEqual(await w.run(), { failed: true, runUrl: CANCELLED.html_url });
  assert.deepEqual(w.steps.at(-1), ['failed', { sha: 'commit1', runUrl: CANCELLED.html_url }]);
});

test('publish: no completed run within maxPolls is a timeout; transient GitHub errors while polling are retried', async () => {
  const w = setup();
  w.store.set([...BULLET, 'text'], 'changed');
  const before = w.store.get();
  w.gh.runs.commit1 = [null];
  assert.deepEqual(await w.run({ maxPolls: 3 }), { failed: true, reason: 'timeout' });
  assert.deepEqual(w.steps.at(-1), ['failed', { sha: 'commit1', reason: 'timeout' }]);
  assert.equal(w.gh.calls.filter(([m]) => m === 'latestRun').length, 3);
  assert.equal(w.store.get(), before);

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

test('publish: rotation drops the revoked code, keeps the other, rewraps the file keys and returns the new vk', async () => {
  const vault = await makeVault();
  const w = setup({ access: vault.access, keys: vault.keys, session: vault.session });
  w.store.set(['revoked'], [vault.ids[2]]);
  w.store.set(['rotate'], true);

  const result = await w.run();

  assert.deepEqual(names(w.steps), ['validating', 'checking', 'committing', 'building', 'live']);
  assert.deepEqual(Object.keys(result).sort(), ['sha', 'vk']);
  assert.equal(result.sha, 'commit1');
  assert.notEqual(result.vk, vault.vkB64);

  const [commit] = commitCalls(w.gh);
  assert.deepEqual(commit.files.map((f) => f.path), ['content/site.json', 'vault/access.json', 'vault/keys.json']);
  assert.equal(commit.message, 'Content update from dashboard: Access codes');
  const newAccess = JSON.parse(dec(commit.files[1].bytes));
  const newKeys = JSON.parse(dec(commit.files[2].bytes));

  const kept = await unlock(newAccess, vault.kept);
  assert.equal(kept.kind, 'download');
  assert.equal(kept.payload.vk, result.vk);
  assert.equal(await unlock(newAccess, vault.gone), null);
  const admin = await unlock(newAccess, ADMIN_CODE);
  assert.equal(admin.payload.vk, result.vk);
  assert.deepEqual(admin.payload.github, GITHUB);
  assert.deepEqual(newAccess.entries.map((e) => e.id), [vault.ids[0], vault.ids[1]]);

  assert.notEqual(newKeys.vk, vault.keys.vk);
  const newVk = await importKey(result.vk);
  assert.equal((await readMeta(newAccess.entries[1], newVk)).code, vault.kept);
  assert.equal(await exportKey(await unwrapFileKey(newVk, newKeys.files[vault.fileId])), await exportKey(vault.fk));

  const d = w.store.get();
  assert.deepEqual(d.access, newAccess);
  assert.deepEqual(d.keys, newKeys);
  assert.equal(d.rotate, false);
  assert.deepEqual(d.revoked, []);
  assert.equal(w.store.dirty().total, 0);
});

test('publish: a kept download entry whose meta the current vk cannot read fails before anything is committed', async () => {
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
  for (const secret of [vault.kept, vault.gone, vault.session.vk, vault.session.kek]) assert.ok(!result.error.includes(secret));
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

  assert.deepEqual(Object.keys(result).sort(), ['failed', 'runUrl', 'vk']);
  const committed = JSON.parse(dec(commitCalls(w.gh)[0].files[1].bytes));
  assert.equal((await unlock(committed, vault.kept)).payload.vk, result.vk);
  assert.equal(w.store.get(), before);
  assert.deepEqual(w.steps.at(-1), ['failed', { sha: 'commit1', runUrl: FAILURE.html_url }]);
});
