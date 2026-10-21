// Access codes, the admin code, the GitHub token and the attachment helpers of the dashboard (Task 23, spec 12, 13.3,
// 13.7, 13.9): admin/modules/codes.mjs against an in-memory draft store and a test vault at 1000 PBKDF2 iterations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStore } from '../admin/modules/state.mjs';
import { createMemoryFileStore } from '../admin/modules/files.mjs';
import { publish } from '../admin/modules/publish.mjs';
import {
  listCodes, createDownloadCode, revoke, unrevoke, changeAdminCode, replaceToken, totalAttachmentBytes, orphanBlobs,
  listAttachments, isStaleSession, resumeAdminSession, cancelAdminChange, applySessionChange, onSessionChanged,
  sessionChanged, today, budgetLevel, validateNewToken, sessionMatchesDraft,
} from '../admin/modules/codes.mjs';
import {
  createAccessFile, createKeysFile, addEntry, unlock, generateKey, exportKey, shortId,
} from '../assets/js/vault.mjs';

const ITER = 1000; // production uses 600000; tests stay fast
const SITE = JSON.parse(readFileSync(new URL('./fixtures/site.min.json', import.meta.url), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const asFile = (x) => new TextEncoder().encode(`${JSON.stringify(x, null, 2)}\n`);

// Obviously fake fixtures. The admin codes pass the strength rule (12+ characters, 3+ kinds).
const ADMIN_CODE = 'Test-Admin-Code-1';
const NEW_ADMIN_CODE = 'Other-Admin-Code-2';
const TOKEN = 'ghp_FAKEOLDTOKEN0000';
const NEW_TOKEN = 'ghp_FAKENEWTOKEN1111';
const GITHUB = { token: TOKEN, owner: 'mojikone', repo: 'mojtabakeivanlou', branch: 'redesign3_admin_test' };
const DAY = '2026-10-21';
const CODE_SHAPE = /^MK-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;

// A test vault with one admin entry (and the given download codes), loaded into a fresh draft store.
async function setup({ downloads = [], site = clone(SITE) } = {}) {
  const vk = await generateKey();
  const vkB64 = await exportKey(vk);
  let access = createAccessFile(ITER);
  access = await addEntry(access, { kind: 'admin', code: ADMIN_CODE, payload: { vk: vkB64, github: GITHUB }, meta: { label: 'Admin', created: DAY } }, vk);
  for (const [i, code] of downloads.entries()) {
    access = await addEntry(access, { kind: 'download', code, payload: { vk: vkB64 }, meta: { label: `Hirer ${i + 1}`, created: DAY, code } }, vk);
  }
  const keys = createKeysFile(shortId());
  const base = { commit: 'head0', shas: { site: 'sha-site-0', access: 'sha-access-0', keys: 'sha-keys-0' }, site, access, keys };
  const store = createStore({ storage: null });
  store.init(base);
  const admin = await unlock(access, ADMIN_CODE);
  const session = { entryId: admin.entry.id, vk: vkB64, kek: await exportKey(admin.kek), github: { ...GITHUB } };
  return { store, vk, vkB64, base, session, adminId: admin.entry.id };
}

// Rejects with a message that matches `pattern` and names none of `secrets`.
async function rejectsQuietly(promise, pattern, secrets = []) {
  await assert.rejects(promise, (err) => {
    assert.match(err.message, pattern);
    for (const secret of secrets) assert.ok(!err.message.includes(secret), 'the message carries a secret');
    return true;
  });
}

/* --- download codes --- */

test('createDownloadCode generates an MK code; listCodes shows it with its label, kind, date and code', async () => {
  const { store, vk, adminId } = await setup();
  const code = await createDownloadCode(store, vk, { label: '  Hirer - Acme  ' });
  assert.match(code, CODE_SHAPE);
  const rows = await listCodes(store.get(), vk);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { id: adminId, kind: 'admin', label: 'Admin', created: DAY, revoked: false });
  const { id, ...rest } = rows[1];
  assert.match(id, /^[0-9a-f]{8}$/);
  assert.deepEqual(rest, { kind: 'download', label: 'Hirer - Acme', created: today(), code, revoked: false });
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(today(new Date(2026, 0, 5, 23, 59)), '2026-01-05', 'the local calendar date');
});

test('listCodes accepts the vault key as base64 too, and never lists a code for the admin entry', async () => {
  const { store, vkB64 } = await setup({ downloads: ['MK-AAAA-BBBB'] });
  const rows = await listCodes(store.get(), vkB64);
  assert.equal(rows[1].code, 'MK-AAAA-BBBB');
  assert.equal('code' in rows[0], false);
});

test('the download payload is exactly { vk }: the code unlocks the vault key and nothing else', async () => {
  const { store, vk, vkB64 } = await setup();
  const code = await createDownloadCode(store, vk, { label: 'Hirer' });
  const hit = await unlock(store.get().access, code.toLowerCase());
  assert.equal(hit.kind, 'download');
  assert.deepEqual(hit.payload, { vk: vkB64 });
  assert.deepEqual(Object.keys(hit.payload), ['vk']);
});

test('a custom code is trimmed, upper-cased when it looks like MK-..., and unlocks', async () => {
  const { store, vk } = await setup();
  assert.equal(await createDownloadCode(store, vk, { label: 'A', code: '  mk-abcd-efgh ' }), 'MK-ABCD-EFGH');
  assert.equal(await createDownloadCode(store, vk, { label: 'B', code: ' summer-visit ' }), 'summer-visit');
  const rows = await listCodes(store.get(), vk);
  assert.deepEqual(rows.slice(1).map((r) => r.code), ['MK-ABCD-EFGH', 'summer-visit']);
  assert.equal((await unlock(store.get().access, 'MK-ABCD-EFGH')).entry.id, rows[1].id);
  assert.equal((await unlock(store.get().access, 'summer-visit')).entry.id, rows[2].id);
});

test('a weak custom code is refused and the draft is unchanged', async () => {
  const { store, vk } = await setup();
  const before = store.get();
  await rejectsQuietly(createDownloadCode(store, vk, { label: 'A', code: 'abc1234' }), /at least 8 characters/, ['abc1234']);
  await rejectsQuietly(createDownloadCode(store, vk, { label: 'A', code: `   ${'x'.repeat(7)}  ` }), /at least 8 characters/);
  assert.equal(store.get(), before);
});

test('a code already in use is refused (any case), including the admin code', async () => {
  const { store, vk } = await setup({ downloads: ['MK-AAAA-BBBB', 'Holiday-2026'] });
  const before = store.get();
  await rejectsQuietly(createDownloadCode(store, vk, { label: 'A', code: 'mk-aaaa-bbbb' }), /already in use/, ['MK-AAAA-BBBB']);
  await rejectsQuietly(createDownloadCode(store, vk, { label: 'A', code: 'HOLIDAY-2026' }), /already in use/);
  await rejectsQuietly(createDownloadCode(store, vk, { label: 'A', code: ADMIN_CODE }), /already in use/, [ADMIN_CODE]);
  assert.equal(store.get(), before);
});

test('a code needs a label', async () => {
  const { store, vk } = await setup();
  await rejectsQuietly(createDownloadCode(store, vk, { label: '  ' }), /label/);
  await rejectsQuietly(createDownloadCode(store, vk, {}), /label/);
  assert.equal(store.get().access.entries.length, 1);
});

/* --- revoke --- */

test('revoke marks the entry in revoked and sets rotate; listCodes flags it; twice is once', async () => {
  const { store, vk } = await setup({ downloads: ['MK-AAAA-BBBB', 'MK-CCCC-DDDD'] });
  const [, first, second] = await listCodes(store.get(), vk);
  revoke(store, first.id);
  revoke(store, first.id);
  assert.deepEqual(store.get().revoked, [first.id]);
  assert.equal(store.get().rotate, true);
  const rows = await listCodes(store.get(), vk);
  assert.equal(rows[1].revoked, true);
  assert.equal(rows[2].revoked, false);
  assert.equal(store.dirty().bySection.access, 1);
  revoke(store, second.id);
  assert.deepEqual(store.get().revoked, [first.id, second.id]);
});

test('revoke refuses the admin entry and an unknown id', async () => {
  const { store, adminId } = await setup();
  assert.throws(() => revoke(store, adminId), /admin/);
  assert.throws(() => revoke(store, 'ffffffff'), /No access entry/);
  assert.deepEqual(store.get().revoked, []);
  assert.equal(store.get().rotate, false);
});

test('unrevoke undoes a revoke; rotate goes back to false once nothing is revoked', async () => {
  const { store, vk } = await setup({ downloads: ['MK-AAAA-BBBB', 'MK-CCCC-DDDD'] });
  const [, first, second] = await listCodes(store.get(), vk);
  revoke(store, first.id);
  revoke(store, second.id);
  unrevoke(store, first.id);
  assert.deepEqual(store.get().revoked, [second.id]);
  assert.equal(store.get().rotate, true);
  unrevoke(store, second.id);
  assert.deepEqual(store.get().revoked, []);
  assert.equal(store.get().rotate, false);
  assert.equal(store.dirty().bySection.access, 0, 'nothing left to publish');
  unrevoke(store, second.id);                       // not revoked: nothing happens
  assert.deepEqual(store.get().revoked, []);
});

/* --- change admin code --- */

test('changeAdminCode refuses a weak new code and changes nothing', async () => {
  const { store, vk } = await setup();
  const before = store.get();
  await rejectsQuietly(changeAdminCode(store, { currentCode: ADMIN_CODE, newCode: 'short-1A' }, vk), /12 characters/, [ADMIN_CODE, 'short-1A']);
  await rejectsQuietly(changeAdminCode(store, { currentCode: ADMIN_CODE, newCode: 'alllowercaseletters' }, vk), /three/);
  assert.equal(store.get(), before);
});

test('changeAdminCode refuses a wrong current code, a download code, and a new code already in use', async () => {
  const { store, vk } = await setup({ downloads: ['MK-AAAA-BBBB'] });
  const before = store.get();
  await rejectsQuietly(changeAdminCode(store, { currentCode: 'Wrong-Admin-Code-9', newCode: NEW_ADMIN_CODE }, vk), /current admin code/, ['Wrong-Admin-Code-9', NEW_ADMIN_CODE]);
  await rejectsQuietly(changeAdminCode(store, { currentCode: 'MK-AAAA-BBBB', newCode: NEW_ADMIN_CODE }, vk), /current admin code/);
  await rejectsQuietly(changeAdminCode(store, { currentCode: ADMIN_CODE, newCode: ADMIN_CODE }, vk), /already in use/, [ADMIN_CODE]);
  assert.equal(store.get(), before);
});

test('changeAdminCode: the new code opens a NEW admin entry with the same vault key and GitHub details; the old one is revoked', async () => {
  const { store, vk, vkB64, adminId } = await setup({ downloads: ['MK-AAAA-BBBB'] });
  const { kekB64, entryId } = await changeAdminCode(store, { currentCode: ADMIN_CODE, newCode: ` ${NEW_ADMIN_CODE} ` }, vk);
  const draft = store.get();
  assert.notEqual(entryId, adminId);
  assert.deepEqual(draft.revoked, [adminId]);
  assert.equal(draft.rotate, true);
  const hit = await unlock(draft.access, NEW_ADMIN_CODE);
  assert.equal(hit.entry.id, entryId);
  assert.equal(hit.kind, 'admin');
  assert.deepEqual(hit.payload, { vk: vkB64, github: GITHUB });
  assert.equal(await exportKey(hit.kek), kekB64);
  const rows = await listCodes(draft, vk);
  assert.deepEqual(rows.map((r) => [r.kind, r.label, r.revoked]), [['admin', 'Admin', true], ['download', 'Hirer 1', false], ['admin', 'Me', false]]);
  assert.equal(rows[2].created, today());
  assert.ok(!JSON.stringify(draft).includes(NEW_ADMIN_CODE));
});

test('changeAdminCode with a new token seals the new token in the new admin entry', async () => {
  const { store, vk } = await setup();
  await changeAdminCode(store, { currentCode: ADMIN_CODE, newCode: NEW_ADMIN_CODE, newToken: ` ${NEW_TOKEN} ` }, vk);
  const hit = await unlock(store.get().access, NEW_ADMIN_CODE);
  assert.deepEqual(hit.payload.github, { ...GITHUB, token: NEW_TOKEN });
  assert.ok(!JSON.stringify(store.get()).includes(NEW_TOKEN));
});

test('after changeAdminCode the replaced code no longer counts as current; a second change revokes the first new entry', async () => {
  const { store, vk, adminId } = await setup();
  const first = await changeAdminCode(store, { currentCode: ADMIN_CODE, newCode: NEW_ADMIN_CODE }, vk);
  await rejectsQuietly(changeAdminCode(store, { currentCode: ADMIN_CODE, newCode: 'Third-Admin-Code-3' }, vk), /current admin code/);
  const second = await changeAdminCode(store, { currentCode: NEW_ADMIN_CODE, newCode: 'Third-Admin-Code-3' }, vk);
  assert.deepEqual(store.get().revoked, [adminId, first.entryId]);
  assert.equal((await unlock(store.get().access, 'Third-Admin-Code-3')).entry.id, second.entryId);
});

test('after changeAdminCode and a publish, the old admin code no longer unlocks and the new one does', async () => {
  const { store, vk, vkB64, base, session } = await setup({ downloads: ['MK-AAAA-BBBB'] });
  const change = await changeAdminCode(store, { currentCode: ADMIN_CODE, newCode: NEW_ADMIN_CODE }, vk);
  const next = applySessionChange(session, change);
  const gh = fakeGitHub(base);
  const result = await publish({ store, gh, fileStore: createMemoryFileStore(), session: next, pollMs: 0, storage: null });
  assert.equal(result.sha, 'commit1');
  const committed = JSON.parse(new TextDecoder().decode(gh.files['vault/access.json'].bytes));
  assert.equal(await unlock(committed, ADMIN_CODE), null);
  const hit = await unlock(committed, NEW_ADMIN_CODE);
  assert.equal(hit.entry.id, change.entryId);
  assert.equal(hit.payload.vk, result.vk);
  assert.notEqual(result.vk, vkB64, 'the vault key was rotated in the same commit');
  assert.equal(committed.entries.filter((e) => e.kind === 'admin').length, 1);
  assert.equal((await unlock(committed, 'MK-AAAA-BBBB')).payload.vk, result.vk, 'the download code is kept');
});

/* --- a session that signed in with the replaced code --- */

test('a session whose admin entry the draft replaces is stale; the new code resumes it, or the change is cancelled', async () => {
  const { store, vk, session, adminId } = await setup();
  assert.equal(isStaleSession(store.get(), session), false);
  const change = await changeAdminCode(store, { currentCode: ADMIN_CODE, newCode: NEW_ADMIN_CODE }, vk);
  assert.equal(isStaleSession(store.get(), session), true, 'signed in again with the old code before publishing');
  assert.equal(isStaleSession(store.get(), applySessionChange(session, change)), false);

  assert.equal(await resumeAdminSession(store.get(), ADMIN_CODE), null, 'the replaced code does not resume');
  assert.equal(await resumeAdminSession(store.get(), 'Wrong-Admin-Code-9'), null);
  assert.deepEqual(await resumeAdminSession(store.get(), NEW_ADMIN_CODE), { ...change, token: TOKEN });
  assert.throws(() => cancelAdminChange(store, applySessionChange(session, change)), /no admin code change/);

  cancelAdminChange(store, session);
  assert.deepEqual(store.get().access.entries.map((e) => e.id), [adminId]);
  assert.deepEqual(store.get().revoked, []);
  assert.equal(store.get().rotate, false);
  assert.equal(isStaleSession(store.get(), session), false);
});

test('sessionMatchesDraft: the publish guard, ok only for a live admin entry of the draft that is the session', async () => {
  const { store, vk, session } = await setup({ downloads: ['MK-AAAA-BBBB'] });
  assert.deepEqual(sessionMatchesDraft(store.get(), session), { ok: true, reason: null });

  // fail-closed: a change the shell never applied leaves the session on the replaced entry, which stops the publish
  const change = await changeAdminCode(store, { currentCode: ADMIN_CODE, newCode: NEW_ADMIN_CODE }, vk);
  assert.deepEqual(sessionMatchesDraft(store.get(), session), { ok: false, reason: 'stale' });
  assert.deepEqual(sessionMatchesDraft(store.get(), applySessionChange(session, change)), { ok: true, reason: null });

  // an entry the draft does not hold (a Reset draft after the change, a vault changed elsewhere), or not an admin one
  const download = store.get().access.entries.find((e) => e.kind === 'download');
  assert.deepEqual(sessionMatchesDraft(store.get(), { ...session, entryId: 'ffffffff' }), { ok: false, reason: 'missing' });
  assert.deepEqual(sessionMatchesDraft(store.get(), { ...session, entryId: download.id }), { ok: false, reason: 'missing' });
  assert.deepEqual(sessionMatchesDraft({ ...store.get(), access: { ...store.get().access, entries: [] } }, applySessionChange(session, change)), { ok: false, reason: 'missing' });
  for (const nobody of [null, undefined, {}, { ...session, entryId: '' }]) {
    assert.deepEqual(sessionMatchesDraft(store.get(), nobody), { ok: false, reason: 'missing' });
  }
  assert.deepEqual(sessionMatchesDraft(null, session), { ok: false, reason: 'missing' });
});

/* --- replace the GitHub token --- */

test('replaceToken re-seals the admin payload with the new token under the session KEK, and sets rotate', async () => {
  const { store, vkB64, session, adminId } = await setup({ downloads: ['MK-AAAA-BBBB'] });
  const before = store.get().access.entries.find((e) => e.id === adminId);
  await replaceToken(store, session.kek, `  ${NEW_TOKEN}\n`);
  const draft = store.get();
  const hit = await unlock(draft.access, ADMIN_CODE);
  assert.equal(hit.entry.id, adminId);
  assert.deepEqual(hit.payload, { vk: vkB64, github: { ...GITHUB, token: NEW_TOKEN } });
  assert.equal(draft.rotate, true);
  const after = draft.access.entries.find((e) => e.id === adminId);
  assert.deepEqual(Object.keys(after), Object.keys(before));
  assert.deepEqual(after.meta, before.meta);
  assert.notEqual(after.iv, before.iv);
  const text = JSON.stringify(draft.access);
  assert.ok(!text.includes(TOKEN) && !text.includes(NEW_TOKEN), 'no token in access.json');
  assert.equal(draft.access.entries.length, 2);
});

test('replaceToken refuses an empty token and a KEK that opens no admin entry', async () => {
  const { store, session } = await setup();
  const before = store.get();
  await rejectsQuietly(replaceToken(store, session.kek, '   '), /token/);
  const other = await exportKey(await generateKey());
  await rejectsQuietly(replaceToken(store, other, NEW_TOKEN), /admin entry/, [NEW_TOKEN]);
  assert.equal(store.get(), before);
});

/* --- checking a new token before it is used --- */

// A createGitHub stand-in: records the config it was given and answers validate() with `answer` (or throws it).
function fakeClientFactory(answer) {
  const configs = [];
  const create = (config) => {
    configs.push(config);
    return { validate: async () => { if (answer instanceof Error) throw answer; return answer; } };
  };
  return { create, configs };
}

test('validateNewToken resolves null for a token GitHub accepts, checked against the session repository', async () => {
  const { create, configs } = fakeClientFactory({ ok: true, status: 200 });
  assert.equal(await validateNewToken(create, { github: GITHUB }, `  ${NEW_TOKEN} `), null);
  assert.deepEqual(configs, [{ ...GITHUB, token: NEW_TOKEN }]);
});

test('validateNewToken explains a refused or unreachable check, and never names the token', async () => {
  const refused = await validateNewToken(fakeClientFactory({ ok: false, status: 401 }).create, { github: GITHUB }, NEW_TOKEN);
  assert.match(refused, /did not accept this token for mojikone\/mojtabakeivanlou \(HTTP 401\)/);
  assert.match(await validateNewToken(fakeClientFactory({ ok: false, status: 404 }).create, { github: GITHUB }, NEW_TOKEN), /HTTP 404/);
  const offline = await validateNewToken(fakeClientFactory({ ok: false, status: 0 }).create, { github: GITHUB }, NEW_TOKEN);
  assert.match(offline, /could not be reached/);
  const broken = await validateNewToken(fakeClientFactory(new TypeError(`bad ${NEW_TOKEN}`)).create, { github: GITHUB }, NEW_TOKEN);
  assert.match(broken, /could not be reached/);
  for (const message of [refused, offline, broken]) assert.ok(!message.includes(NEW_TOKEN));
});

test('validateNewToken does not blame the token during a GitHub rate limit', async () => {
  const limited = await validateNewToken(fakeClientFactory({ ok: false, status: 403, rateLimited: true }).create, { github: GITHUB }, NEW_TOKEN);
  assert.match(limited, /^GitHub rate limit — try again in a few minutes/);
  assert.doesNotMatch(limited, /did not accept/);
});

test('validateNewToken refuses an empty token and a session without GitHub details, without asking GitHub', async () => {
  const { create, configs } = fakeClientFactory({ ok: true, status: 200 });
  assert.match(await validateNewToken(create, { github: GITHUB }, '   '), /Paste the new token/);
  assert.match(await validateNewToken(create, {}, NEW_TOKEN), /Sign out and sign in again/);
  assert.match(await validateNewToken(create, null, NEW_TOKEN), /Sign out and sign in again/);
  assert.deepEqual(configs, []);
});

/* --- the session hook --- */

test('applySessionChange returns a new session; onSessionChanged handlers get each change until unsubscribed', () => {
  const session = { entryId: 'aaaaaaaa', vk: 'dmF1bHQ=', kek: 'a2VrMQ==', github: { ...GITHUB } };
  const next = applySessionChange(session, { kekB64: 'a2VrMg==', entryId: 'bbbbbbbb' });
  assert.deepEqual(next, { ...session, kek: 'a2VrMg==', entryId: 'bbbbbbbb' });
  assert.deepEqual(applySessionChange(session, { token: NEW_TOKEN }).github, { ...GITHUB, token: NEW_TOKEN });
  assert.equal(session.kek, 'a2VrMQ==', 'the old session is untouched');
  assert.equal(applySessionChange(session, {}).github.token, TOKEN);

  const seen = [];
  const off = onSessionChanged((change) => seen.push(change));
  sessionChanged({ entryId: 'bbbbbbbb', kekB64: 'a2VrMg==' });
  off();
  sessionChanged({ token: NEW_TOKEN });
  assert.deepEqual(seen, [{ entryId: 'bbbbbbbb', kekB64: 'a2VrMg==' }]);
});

/* --- attachments --- */

const fileRec = (ch, size, name = `${ch}.pdf`) => ({ id: ch.repeat(32), name, size, type: 'application/pdf', enc: true });

function siteWithFiles() {
  const site = clone(SITE);
  const company = site.experience.companies[0];
  company.projects[0].bullets[0].files = [fileRec('a', 1000), fileRec('b', 2500)];
  company.projects.push({ id: 'second', name: 'Second', period: '2020', role: '', scope: '', bullets: [{ text: 'One', files: [] }, { text: 'Two', files: [fileRec('c', 40)] }] });
  return site;
}

test('listAttachments and totalAttachmentBytes cover every file of every bullet', () => {
  const site = siteWithFiles();
  const list = listAttachments(site);
  assert.deepEqual(list.map((a) => a.file.id[0]), ['a', 'b', 'c']);
  assert.deepEqual(list[2].path, ['site', 'experience', 'companies', 0, 'projects', 1, 'bullets', 1]);
  assert.equal(list[2].company, 'Renardet S.A. & Partners');
  assert.equal(list[2].project, 'Second');
  assert.equal(list[2].bullet, 'Two');
  assert.equal(list[2].bulletIndex, 1);
  assert.equal(totalAttachmentBytes(site), 3540);
  assert.equal(totalAttachmentBytes(clone(SITE)), 0);
  assert.equal(totalAttachmentBytes({}), 0);
});

test('budgetLevel turns amber at TOTAL_AMBER and red at TOTAL_RED', () => {
  const MB = 1024 * 1024;
  assert.equal(budgetLevel(0), 'ok');
  assert.equal(budgetLevel(700 * MB - 1), 'ok');
  assert.equal(budgetLevel(700 * MB), 'amber');
  assert.equal(budgetLevel(900 * MB - 1), 'amber');
  assert.equal(budgetLevel(900 * MB), 'red');
});

test('orphanBlobs lists the vault/files ids in the tree that no bullet references', () => {
  const site = siteWithFiles();
  const tree = [
    'content/site.json', 'vault/access.json', 'vault/keys.json', 'vault/files/.gitkeep',
    `vault/files/${'a'.repeat(32)}.bin`, `vault/files/${'d'.repeat(32)}.bin`, `vault/files/${'e'.repeat(32)}.bin`,
    `vault/files/${'c'.repeat(32)}.bin`, `other/${'f'.repeat(32)}.bin`, `vault/files/${'A'.repeat(32)}.bin`,
  ];
  assert.deepEqual(orphanBlobs(tree, site), ['d'.repeat(32), 'e'.repeat(32)]);
  assert.deepEqual(orphanBlobs([], site), []);
});

/* --- a fake GitHub for the publish round trip (only the methods publish uses) --- */

function fakeGitHub(base) {
  const files = {
    'content/site.json': { sha: base.shas.site, bytes: asFile(base.site) },
    'vault/access.json': { sha: base.shas.access, bytes: asFile(base.access) },
    'vault/keys.json': { sha: base.shas.keys, bytes: asFile(base.keys) },
  };
  let head = base.commit;
  let commits = 0;
  return {
    files,
    async getHead() { return { sha: head, tree: `tree-${head}` }; },
    async getFile(path) { return files[path] ? { ...files[path] } : null; },
    async commitFiles({ files: changed, deletes }) {
      commits += 1;
      head = `commit${commits}`;
      for (const f of changed) files[f.path] = { sha: `${f.path}@${head}`, bytes: f.bytes };
      for (const path of deletes) delete files[path];
      return { sha: head };
    },
    async latestRun() { return { status: 'completed', conclusion: 'success', html_url: 'https://x/run/1' }; },
  };
}
