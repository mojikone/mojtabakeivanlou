// Publish UI (Task 22b, spec 13.6): the pure helpers behind the Publish button, the progress card, the validation
// links and the conflict merge. The DOM glue (wirePublish) is checked by hand in the browser, except its session guard
// (Task 23b), which runs here on a fake DOM (test/helpers/fake-dom.mjs) with a fake publish().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buttonState, stepLine, sectionForPath, mergeDrafts, failureMessage, isDeploySkipped, actionsUrl, readDraftBase,
  wirePublish, SESSION_MISMATCH_TEXT,
} from '../admin/modules/publish-ui.mjs';
import { SESSION_KEY_MISMATCH } from '../admin/modules/publish.mjs';
import { AuthError } from '../admin/modules/github.mjs';
import { changedSections } from '../admin/modules/state.mjs';
import { createInflight } from '../admin/modules/inflight.mjs';
import { FakeNode, installFakeDom } from './helpers/fake-dom.mjs';

const SITE = JSON.parse(readFileSync(new URL('./fixtures/site.min.json', import.meta.url), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const ID = (c) => c.repeat(32);                              // a well-formed file id
const record = (id) => ({ id, name: `${id.slice(0, 4)}.pdf`, size: 3, type: 'application/pdf', enc: true });

function draftOf(over = {}) {
  return {
    v: 1, baseCommit: 'head0', baseShas: { site: 's0', access: 'a0', keys: 'k0' },
    site: clone(SITE), access: { v: 1, entries: [{ id: 'mine' }] }, keys: { v: 1, vk: 'vk1', files: {} },
    pending: [], deleted: [], revoked: [], rotate: false, ...over,
  };
}

/* ─── buttonState ─── */

test('buttonState: disabled with "Nothing to publish" when the draft has nothing to publish', () => {
  assert.deepEqual(buttonState(draftOf()), { enabled: false, reason: 'Nothing to publish', label: 'Publish' });
  assert.deepEqual(buttonState(draftOf(), { dirty: 0 }), { enabled: false, reason: 'Nothing to publish', label: 'Publish' });
  assert.equal(buttonState(null).enabled, false);
});

test('buttonState: enabled by dirty sections, pending, deleted or revoked files and codes, or rotate', () => {
  const on = { enabled: true, reason: '', label: 'Publish' };
  assert.deepEqual(buttonState(draftOf(), { dirty: 2 }), on);
  assert.deepEqual(buttonState(draftOf({ pending: [record(ID('a'))] })), on);
  assert.deepEqual(buttonState(draftOf({ deleted: [ID('b')] })), on);
  assert.deepEqual(buttonState(draftOf({ revoked: ['x1'] })), on);
  assert.deepEqual(buttonState(draftOf({ rotate: true })), on);
});

test('buttonState: while a publish runs the button is disabled and reads "Publishing…"', () => {
  assert.deepEqual(buttonState(draftOf(), { dirty: 3, busy: true }), { enabled: false, reason: 'A publish is running', label: 'Publishing…' });
});

test('buttonState: disabled while attachments (or an access-code change) are still being encrypted', () => {
  const pending = draftOf({ pending: [record(ID('a'))] });
  assert.deepEqual(buttonState(pending, { dirty: 1, inflight: ['attachments'] }), { enabled: false, reason: 'Wait for attachments to finish', label: 'Publish' });
  assert.deepEqual(buttonState(pending, { dirty: 1, inflight: ['codes'] }), { enabled: false, reason: 'Wait for the access-code change to finish', label: 'Publish' });
  assert.deepEqual(buttonState(draftOf(), { inflight: ['codes', 'attachments'] }).reason, 'Wait for attachments to finish');
  assert.equal(buttonState(pending, { dirty: 1, inflight: [] }).enabled, true);
  assert.equal(buttonState(pending, { dirty: 1, busy: true, inflight: ['attachments'] }).label, 'Publishing…');
});

/* ─── the in-flight counter ─── */

test('inflight: begin returns an idempotent end; count and kinds follow; subscribers hear every change', () => {
  const flight = createInflight();
  const heard = [];
  const off = flight.subscribe(() => heard.push(flight.count()));
  const a = flight.begin();
  const b = flight.begin();
  const c = flight.begin('codes');
  assert.equal(flight.count(), 3);
  assert.equal(flight.count('attachments'), 2);
  assert.deepEqual(flight.kinds(), ['attachments', 'codes']);
  a(); a();                                                // a second end of the same begin changes nothing
  assert.equal(flight.count('attachments'), 1);
  b(); c();
  assert.equal(flight.count(), 0);
  assert.deepEqual(flight.kinds(), []);
  assert.deepEqual(heard, [1, 2, 3, 2, 1, 0]);
  off();
  flight.begin()();
  assert.equal(heard.length, 6);
});

/* ─── stepLine ─── */

test('stepLine: the progress lines for each step of publish()', () => {
  assert.equal(stepLine('validating'), 'Checking content…');
  assert.equal(stepLine('checking'), 'Checking for conflicts…');
  assert.equal(stepLine('committing'), 'Saving to GitHub…');
  assert.equal(stepLine('saved'), 'Saved to GitHub');
  assert.equal(stepLine('building', { sha: 'c1' }), 'Building pages & PDF');
  assert.equal(stepLine('live', { sha: 'c1', url: 'https://mojtabakeivanlou.com/' }), 'Live on mojtabakeivanlou.com');
  assert.equal(stepLine('live', { sha: 'c1', url: null }), 'Live');
  assert.equal(stepLine('skipped'), 'Saved and built — deploy is switched off (DEPLOY_FROM_ACTIONS)');
  assert.equal(stepLine('rotated'), 'Access codes updated');
  assert.equal(stepLine('conflict', { paths: ['content/site.json'] }), 'The site content changed on GitHub since you loaded it (probably a code update).');
  assert.equal(stepLine('nonsense'), '');
});

/* ─── failure texts ─── */

const ACTIONS = 'https://github.com/mojikone/mojtabakeivanlou/actions';

test('failureMessage: a failed build after the commit: saved, the run link, what to do', () => {
  const m = failureMessage({ failed: true, runUrl: 'https://github.com/o/r/actions/runs/9', sha: 'c1' }, ACTIONS);
  assert.equal(m.title, 'Saved, not live');
  assert.deepEqual(m.parts, [
    'Saved to GitHub, but the build failed. ',
    { text: 'Open the run', href: 'https://github.com/o/r/actions/runs/9' },
    '. Fix the problem and publish again, or re-run the workflow on GitHub.',
  ]);
  assert.equal(m.retry, false);
});

test('failureMessage: a timeout links the run when one was seen, else the Actions page', () => {
  const seen = failureMessage({ failed: true, reason: 'timeout', runUrl: 'https://github.com/o/r/actions/runs/5', sha: 'c1' }, ACTIONS);
  assert.equal(seen.title, 'Saved, still building');
  assert.deepEqual(seen.parts, [
    'Saved to GitHub; the build is taking longer than expected — check the run: ',
    { text: 'github.com/o/r/actions/runs/5', href: 'https://github.com/o/r/actions/runs/5' },
  ]);
  const unseen = failureMessage({ failed: true, reason: 'timeout', sha: 'c1' }, ACTIONS);
  assert.deepEqual(unseen.parts[1], { text: 'github.com/mojikone/mojtabakeivanlou/actions', href: ACTIONS });
});

test('failureMessage: an error after the commit is saved-but-unfollowed; before it, not published and retryable', () => {
  const after = failureMessage({ failed: true, error: 'GitHub answered 401 to GET /x', sha: 'c1' }, ACTIONS);
  assert.equal(after.title, 'Saved, not followed');
  assert.deepEqual(after.parts, ['Saved to GitHub, but the build could not be followed (GitHub answered 401 to GET /x). ', { text: 'Check the run on GitHub', href: ACTIONS }, '.']);
  assert.equal(after.retry, false);
  const before = failureMessage({ failed: true, error: 'Could not reach GitHub (GET /x)' }, ACTIONS);
  assert.equal(before.title, 'Not published');
  assert.deepEqual(before.parts, ['Nothing was published: Could not reach GitHub (GET /x)']);
  assert.equal(before.retry, true);
});

test('failureMessage: a stale session key says to reload (Retry would only fail the same way)', () => {
  const m = failureMessage({ failed: true, error: SESSION_KEY_MISMATCH }, ACTIONS);
  assert.equal(m.title, 'Not published');
  assert.equal(m.retry, false);
  assert.deepEqual(m.parts, ['Nothing was published: session vault key does not match the vault. Reload the dashboard: it takes the current keys from the draft, or asks you to sign in again.']);
});

test('failureMessage: the error text is cleaned of tokens and the given secrets', () => {
  const m = failureMessage({ failed: true, error: 'boom ghp_AbC123 Secret-Value-9' }, ACTIONS, ['Secret-Value-9']);
  assert.deepEqual(m.parts, ['Nothing was published: boom [token] [secret]']);
});

test('actionsUrl: the Actions page of the session repository, or null', () => {
  assert.equal(actionsUrl({ github: { owner: 'mojikone', repo: 'mojtabakeivanlou' } }), ACTIONS);
  assert.equal(actionsUrl({ github: { owner: 'a b', repo: 'c/d' } }), 'https://github.com/a%20b/c%2Fd/actions');
  assert.equal(actionsUrl(null), null);
});

/* ─── deploy skipped ─── */

test('isDeploySkipped: only a job named deploy concluded skipped', () => {
  assert.equal(isDeploySkipped([{ name: 'build', conclusion: 'success' }, { name: 'deploy', conclusion: 'skipped' }]), true);
  assert.equal(isDeploySkipped([{ name: 'build', conclusion: 'success' }, { name: 'deploy', conclusion: 'success' }]), false);
  assert.equal(isDeploySkipped([{ name: 'build', conclusion: 'skipped' }]), false);
  assert.equal(isDeploySkipped(null), false);
});

/* ─── sectionForPath ─── */

test('sectionForPath: the section owning a validator path, as state.mjs maps the content keys', () => {
  assert.equal(sectionForPath('experience.companies[0].projects[1].bullets[2].text'), 'experience');
  assert.equal(sectionForPath('experience.companies[0].name is empty'), 'experience');
  assert.equal(sectionForPath('profile.firstName'), 'profile');
  assert.equal(sectionForPath('contactPage.projectTypes must have at least one entry'), 'contact');
  assert.equal(sectionForPath('thankYou.text'), 'contact');
  assert.equal(sectionForPath('cta.sub'), 'contact');
  assert.equal(sectionForPath('site.formSubject is empty'), 'contact');
  assert.equal(sectionForPath('site.experienceStart is in the future'), 'settings');
  assert.equal(sectionForPath('seo.titleIndex'), 'settings');
  assert.equal(sectionForPath('services[3].icon is unknown'), 'services');
  assert.equal(sectionForPath('skills'), 'skills');
  assert.equal(sectionForPath('schemaVersion must be 1'), null);
  assert.equal(sectionForPath('(root) must be an object'), null);
  assert.equal(sectionForPath(''), null);
  assert.equal(sectionForPath('__proto__.x'), null);
});

/* ─── changedSections (state.mjs) ─── */

test('changedSections: the sections whose content differs, mapped as dirty() maps them', () => {
  const base = clone(SITE);
  assert.deepEqual(changedSections(clone(SITE), base), []);
  const site = clone(SITE);
  site.profile.firstName = 'X';
  site.education[0].year = '1999';
  site.thankYou = { ...site.thankYou, text: 'changed' };
  site.site.formSubject = 'changed';
  assert.deepEqual(changedSections(site, base), ['profile', 'education', 'contact']);
  site.site.gaId = 'G-OTHER';
  site.seo = { ...site.seo, titleIndex: 'other' };
  assert.deepEqual(changedSections(site, base), ['profile', 'education', 'contact', 'settings']);
  assert.deepEqual(changedSections({ ...clone(SITE), schemaVersion: 9 }, base), []);   // a key no section edits
});

/* ─── readDraftBase ─── */

function fakeFiles(files, { fail = false } = {}) {
  const calls = [];
  return {
    calls,
    async getFile(path, ref) {
      calls.push([path, ref]);
      if (fail) throw new Error('GitHub answered 500');
      const value = files[`${ref}:${path}`];
      return value === undefined ? null : { sha: 'x', bytes: new TextEncoder().encode(JSON.stringify(value)) };
    },
  };
}

test('readDraftBase: the remote copy when its sha is the draft base sha, else the file at the draft base commit', async () => {
  const draft = draftOf();                                 // baseCommit head0, baseShas s0 / a0 / k0
  const old = clone(SITE);
  old.education[0].year = '1990';
  const remote = { commit: 'head9', shas: { site: 's1', access: 'a0', keys: 'k0' }, site: clone(SITE), access: { v: 1, entries: [] }, keys: draft.keys };

  const gh = fakeFiles({ 'head0:content/site.json': old });
  const base = await readDraftBase(gh, draft, remote);
  assert.deepEqual(base.site, old);
  assert.equal(base.access, remote.access);                // same sha: no request
  assert.deepEqual(gh.calls, [['content/site.json', 'head0']]);

  const both = fakeFiles({ 'head0:content/site.json': old, 'head0:vault/access.json': { v: 1, entries: [{ id: 'base' }] } });
  const moved = await readDraftBase(both, draft, { ...remote, shas: { site: 's1', access: 'a1', keys: 'k1' } });
  assert.deepEqual(moved.access, { v: 1, entries: [{ id: 'base' }] });

  const missing = await readDraftBase(fakeFiles({}), draft, { ...remote, shas: { site: 's1', access: 'a1', keys: 'k0' } });
  assert.equal(missing.site, null);                        // not there at that commit
  assert.equal(missing.access, null);
});

test('readDraftBase: unknown (undefined) when the fetch fails or the draft has no base commit; never throws', async () => {
  const draft = draftOf();
  const remote = { shas: { site: 's1', access: 'a1', keys: 'k0' }, site: clone(SITE), access: {}, keys: {} };
  const failed = await readDraftBase(fakeFiles({}, { fail: true }), draft, remote);
  assert.equal(failed.site, undefined);
  assert.equal(failed.access, undefined);
  const gh = fakeFiles({});
  const none = await readDraftBase(gh, draftOf({ baseCommit: null }), remote);
  assert.equal(none.site, undefined);
  assert.deepEqual(gh.calls, []);
});

/* ─── mergeDrafts ─── */

const VAULT_MOVED = { site: 's1', access: 'a1', keys: 'k1' };     // the draft's baseShas are s0 / a0 / k0
const VAULT_SAME = { site: 's1', access: 'a0', keys: 'k0' };

test('mergeDrafts with the draft base: a three-way merge, so what the owner did not touch takes the newer values', () => {
  const base = clone(SITE);
  const draft = draftOf();
  draft.site.profile.firstName = 'Draft';                  // the owner edited Profile only
  draft.site.profile.quote = 'Both edited: the draft wins';
  const remote = { shas: VAULT_SAME, site: clone(SITE), access: draft.access, keys: draft.keys };
  remote.site.education[0].year = '2014 (GitHub)';         // an Education change on GitHub
  remote.site.profile.email = 'new@example.com';           // a field of Profile the owner did not touch
  remote.site.profile.quote = 'Both edited: GitHub';
  remote.site.schemaVersion = 2;

  // store.dirty() against a later base would name Education too; the draft's own base does not
  const m = mergeDrafts(draft, remote, changedSections(draft.site, base), { baseSite: base });

  assert.equal(m.site.profile.firstName, 'Draft');
  assert.equal(m.site.profile.email, 'new@example.com');
  assert.equal(m.site.profile.quote, 'Both edited: the draft wins');
  assert.equal(m.site.education[0].year, '2014 (GitHub)');
  assert.equal(m.site.schemaVersion, 2);
  assert.deepEqual(Object.keys(m.site), Object.keys(remote.site));

  // a list both sides changed is taken whole from the draft; a list only GitHub changed comes from GitHub
  const d2 = draftOf();
  d2.site.languages = [...d2.site.languages, { name: 'Draft', level: 'B1' }];
  const r2 = { shas: VAULT_SAME, site: clone(SITE), access: d2.access, keys: d2.keys };
  r2.site.languages = [{ name: 'GitHub', level: 'C2' }];
  r2.site.education = [];
  const n = mergeDrafts(d2, r2, ['languages'], { baseSite: base });
  assert.deepEqual(n.site.languages, d2.site.languages);
  assert.deepEqual(n.site.education, []);
});

test('mergeDrafts without the draft base: by section (a dirty section keeps the draft value, the rest the remote)', () => {
  const draft = draftOf();
  draft.site.profile.firstName = 'Draft';
  const remote = { shas: VAULT_SAME, site: clone(SITE), access: draft.access, keys: draft.keys };
  remote.site.profile.firstName = 'Remote';
  remote.site.education[0].degree = 'PhD — remote';
  const m = mergeDrafts(draft, remote, ['profile']);
  assert.deepEqual(m.site.profile, draft.site.profile);
  assert.deepEqual(m.site.education, remote.site.education);
  assert.deepEqual(Object.keys(m.site), Object.keys(remote.site));
  assert.notEqual(m.site.profile, draft.site.profile);     // copies, not shared objects
});

test('mergeDrafts (vault changed on GitHub): remote access and keys, revoke and rotate cleared; the discard is reported for own access changes only', () => {
  const draft = draftOf({ revoked: ['x1'], rotate: true });
  draft.access = { v: 1, entries: [{ id: 'mine' }, { id: 'new-code' }] };
  const remote = { shas: VAULT_MOVED, site: clone(SITE), access: { v: 1, entries: [{ id: 'theirs' }] }, keys: { v: 1, vk: 'vk1', files: { [ID('c')]: { k: 1 } } } };

  const m = mergeDrafts(draft, remote, ['access']);
  assert.deepEqual(m.access, remote.access);
  assert.deepEqual(m.keys, remote.keys);
  assert.deepEqual(m.revoked, []);
  assert.equal(m.rotate, false);
  assert.equal(m.vaultChanged, true);
  assert.equal(m.discardedAccess, true);
  assert.equal(mergeDrafts(draft, remote, []).discardedAccess, false);
  // only keys.json moved counts as a vault change as well
  assert.equal(mergeDrafts(draft, { ...remote, shas: { ...VAULT_SAME, keys: 'k1' } }, ['access']).vaultChanged, true);
});

test('mergeDrafts (vault unchanged on GitHub): the draft keeps its access, keys, revoked and rotate; nothing is discarded', () => {
  const draft = draftOf({ revoked: ['x1'], rotate: true });
  draft.access = { v: 1, entries: [{ id: 'mine' }, { id: 'new-code' }] };
  draft.keys = { v: 1, vk: 'vk1', files: { [ID('c')]: { k: 1 } } };
  const remote = { shas: VAULT_SAME, site: clone(SITE), access: { v: 1, entries: [{ id: 'mine' }] }, keys: { v: 1, vk: 'vk1', files: {} } };

  for (const m of [mergeDrafts(draft, remote, ['access']), mergeDrafts(draft, remote, ['access'], { keepSite: true })]) {
    assert.deepEqual(m.access, draft.access);
    assert.deepEqual(m.keys, draft.keys);
    assert.deepEqual(m.revoked, ['x1']);
    assert.equal(m.rotate, true);
    assert.equal(m.vaultChanged, false);
    assert.equal(m.discardedAccess, false);
    assert.notEqual(m.access, draft.access);
  }
});

test('mergeDrafts: the site key splits like dirty(): formSubject follows Contact page, the rest Settings', () => {
  const draft = draftOf();
  draft.site.site.formSubject = 'Draft subject';
  draft.site.site.gaId = 'G-DRAFT';
  const remote = { shas: VAULT_SAME, site: clone(SITE), access: draft.access, keys: draft.keys };
  remote.site.site.domain = 'remote.example';
  remote.site.site.formSubject = 'Remote subject';

  const contactOnly = mergeDrafts(draft, remote, ['contact']);
  assert.equal(contactOnly.site.site.formSubject, 'Draft subject');
  assert.equal(contactOnly.site.site.domain, 'remote.example');
  assert.equal(contactOnly.site.site.gaId, SITE.site.gaId);

  const settingsOnly = mergeDrafts(draft, remote, ['settings']);
  assert.equal(settingsOnly.site.site.formSubject, 'Remote subject');
  assert.equal(settingsOnly.site.site.gaId, 'G-DRAFT');
  assert.equal(settingsOnly.site.site.domain, SITE.site.domain);
});

test('mergeDrafts: a key no section edits (schemaVersion) comes from the remote; keepSite keeps the whole draft site', () => {
  const draft = draftOf();
  draft.site.education[0].year = '1999';
  const remote = { shas: VAULT_MOVED, site: { ...clone(SITE), schemaVersion: 2, extra: { a: 1 } }, access: { v: 1, entries: [] }, keys: draft.keys };
  const m = mergeDrafts(draft, remote, ['education']);
  assert.equal(m.site.schemaVersion, 2);
  assert.deepEqual(m.site.extra, { a: 1 });
  assert.equal(m.site.education[0].year, '1999');
  const over = mergeDrafts(draft, remote, [], { keepSite: true, baseSite: clone(SITE) });
  assert.deepEqual(over.site, draft.site);
  assert.deepEqual(over.access, remote.access);
});

test('mergeDrafts: pending files keep their wrapped keys on the same vault key; deleted ids stay unless referenced', () => {
  const pend = ID('d');
  const gone = ID('e');
  const draft = draftOf({ pending: [record(pend)], deleted: [gone] });
  draft.site.experience.companies[0].projects[0].bullets[0].files = [record(pend)];
  draft.keys = { v: 1, vk: 'vk1', files: { [pend]: { wrapped: 'p' }, [gone]: { wrapped: 'g' } } };
  const remote = { shas: VAULT_MOVED, site: clone(SITE), access: draft.access, keys: { v: 1, vk: 'vk1', files: { [gone]: { wrapped: 'g' } } } };

  const m = mergeDrafts(draft, remote, ['experience', 'files']);

  assert.deepEqual(m.keys, { v: 1, vk: 'vk1', files: { [gone]: { wrapped: 'g' }, [pend]: { wrapped: 'p' } } });
  assert.deepEqual(m.pending, [record(pend)]);
  assert.deepEqual(m.deleted, [gone]);
  assert.deepEqual(m.dropped, []);
  assert.equal(m.keyChanged, false);

  // experience not dirty: the remote experience wins, so the pending record is gone and so is its pending entry;
  // a deleted id the remote still references is not deleted
  const remote2 = clone(remote);
  remote2.site.experience.companies[0].projects[0].bullets[0].files = [record(gone)];
  const n = mergeDrafts(draft, remote2, []);
  assert.deepEqual(n.pending, []);
  assert.deepEqual(n.dropped, [pend]);
  assert.deepEqual(n.deleted, []);
  assert.deepEqual(n.keys, remote2.keys);

  // vault unchanged: the draft's own keys, the pending one included
  const same = mergeDrafts(draft, { ...remote, shas: VAULT_SAME }, ['experience', 'files']);
  assert.deepEqual(same.keys, draft.keys);
  assert.deepEqual(same.pending, [record(pend)]);
});

test('mergeDrafts: a vault key rotated on GitHub drops the new attachments (their keys are under the old key)', () => {
  const pend = ID('f');
  const draft = draftOf({ pending: [record(pend)] });
  draft.site.experience.companies[0].projects[0].bullets[0].files = [record(pend)];
  draft.site.profile.firstName = 'Draft';
  draft.keys = { v: 1, vk: 'vk1', files: { [pend]: { wrapped: 'p' } } };
  const remote = { shas: VAULT_MOVED, site: clone(SITE), access: draft.access, keys: { v: 1, vk: 'vk2', files: {} } };

  for (const m of [mergeDrafts(draft, remote, ['experience', 'files', 'profile']), mergeDrafts(draft, remote, [], { keepSite: true })]) {
    assert.deepEqual(m.dropped, [pend]);
    assert.equal(m.keyChanged, true);
    assert.deepEqual(m.pending, []);
    assert.deepEqual(m.keys, remote.keys);
    assert.deepEqual(m.site.experience.companies[0].projects[0].bullets[0].files, []);
    assert.equal(m.site.profile.firstName, 'Draft');
  }
  assert.deepEqual(draft.site.experience.companies[0].projects[0].bullets[0].files, [record(pend)]); // not mutated
});

/* ─── wirePublish: the session guard (Task 23b) ─── */

const GH_DETAILS = { token: 'ghp_FAKE_T23B', owner: 'mojikone', repo: 'mojtabakeivanlou', branch: 'main' };
const asSession = (entryId) => ({ entryId, vk: 'dmF1bHQ=', kek: 'a2Vr', github: { ...GH_DETAILS } });
const tick = () => new Promise((resolve) => { setImmediate(resolve); });

// The top bar and areas wirePublish looks up in its root, as fake nodes.
function shellRoot() {
  const nodes = {
    '#publishButton': new FakeNode('button'),
    '#status': new FakeNode('p'),
    '#signOut': new FakeNode('button'),
    '#main': new FakeNode('main'),
    '.adm-nav': new FakeNode('nav'),
  };
  new FakeNode('header').append(nodes['#status']);
  return { nodes, root: { querySelector: (selector) => nodes[selector] ?? null } };
}

// A draft whose admin code was changed: 'old' is the replaced admin entry, 'new' the one the change made current.
function changedDraft() {
  return draftOf({
    access: { v: 1, entries: [{ id: 'old', kind: 'admin' }, { id: 'dl', kind: 'download' }, { id: 'new', kind: 'admin' }] },
    revoked: ['old'],
    rotate: true,
  });
}

function wireForGuard({ session, draft = changedDraft() }) {
  const { root, nodes } = shellRoot();
  const state = { session, gh: null, published: [], ghCalls: [] };
  const makeGh = (name) => ({
    name,
    getHead: async () => { state.ghCalls.push(`${name} getHead`); return { sha: draft.baseCommit, tree: 't' }; },
    getFile: async (path) => { state.ghCalls.push(`${name} getFile ${path}`); return null; },
  });
  state.makeGh = makeGh;
  state.gh = makeGh('gh1');
  const store = { get: () => draft, dirty: () => ({ total: 1, bySection: { profile: 1 } }), subscribe: () => () => {} };
  const handle = wirePublish({
    root, store, fileStore: {}, getSession: () => state.session, getGh: () => state.gh,
    publishFn: async ({ session: s, gh }) => {
      state.published.push({ entryId: s.entryId, gh: gh.name });
      return { failed: true, error: 'fake failure' };   // "Not published" with a Retry button
    },
  });
  return { handle, nodes, state };
}

const dialogs = () => document.body.findAll((n) => n.tagName === 'DIALOG');
const buttonsNamed = (label, from = document.body) => from.findAll((n) => n.tagName === 'BUTTON' && n.textContent === label);

test('wirePublish: the session guard text is the one the owner is shown', () => {
  assert.equal(SESSION_MISMATCH_TEXT, "Your sign-in no longer matches the draft's access codes. Open Access codes to resume or cancel the admin-code change.");
});

test('wirePublish: publish() gets the session and GitHub client current at the click, and only while they match the draft', async () => {
  const restore = installFakeDom();
  try {
    const { handle, nodes, state } = wireForGuard({ session: asSession('new') });
    await tick();
    assert.deepEqual(state.ghCalls, ['gh1 getHead'], 'only the load-time notice check');

    state.gh = state.makeGh('gh2');                     // a session change recreated the client after wiring
    await handle.start();
    assert.deepEqual(state.published, [{ entryId: 'new', gh: 'gh2' }]);
    assert.equal(dialogs().length, 0);
    assert.equal(buttonsNamed('Retry').length, 1, 'the fake failure leaves a Retry button');
    assert.equal(nodes['#publishButton'].textContent, 'Publish');
  } finally {
    restore();
  }
});

test('wirePublish: a rotation hands the new keys to the session when the commit lands, once, before the build is over', async () => {
  const restore = installFakeDom();
  try {
    const { root } = shellRoot();
    const draft = changedDraft();
    const store = { get: () => draft, dirty: () => ({ total: 1, bySection: { profile: 1 } }), subscribe: () => () => {} };
    const gh = { getHead: async () => ({ sha: draft.baseCommit, tree: 't' }), runJobs: async () => [] };
    const taken = [];
    let finishBuild;
    const building = new Promise((resolve) => { finishBuild = resolve; });
    const handle = wirePublish({
      root, store, fileStore: {}, getSession: () => asSession('new'), getGh: () => gh,
      onSessionVk: (vk, ok) => { taken.push([vk, ok]); },
      publishFn: async ({ onCommitted }) => {
        onCommitted({ sha: 'c1', vk: 'bmV3LXZr', ok: 'bmV3LW9r' });
        await building;                            // the build takes minutes; a reload may come meanwhile
        return { sha: 'c1', vk: 'bmV3LXZr', ok: 'bmV3LW9r' };
      },
    });
    await tick();
    const run = handle.start();
    await tick();
    assert.deepEqual(taken, [['bmV3LXZr', 'bmV3LW9r']], 'taken while the build still runs');
    assert.equal(handle.busy(), true);
    finishBuild();
    await run;
    assert.deepEqual(taken, [['bmV3LXZr', 'bmV3LW9r']], 'not taken twice');
    assert.equal(handle.busy(), false);
  } finally {
    restore();
  }
});

test('wirePublish: GitHub refusing the token opens the shared token modal; with a new token in, the publish runs again (T5)', async () => {
  const restore = installFakeDom();
  try {
    const { root } = shellRoot();
    const draft = changedDraft();
    const store = { get: () => draft, dirty: () => ({ total: 1, bySection: { profile: 1 } }), subscribe: () => () => {} };
    const state = { session: asSession('new'), gh: { name: 'old-client', getHead: async () => ({ sha: draft.baseCommit, tree: 't' }) } };
    const runs = [];
    const modals = [];
    const applied = [];
    const handle = wirePublish({
      root, store, fileStore: {}, getSession: () => state.session, getGh: () => state.gh,
      publishFn: async ({ gh }) => {
        runs.push(gh.name);
        if (runs.length === 1) throw new AuthError(401, 'GitHub answered 401 to GET /repos/o/r/git/ref/heads/main: Bad credentials');
        return { failed: true, error: 'stop here' };
      },
      tokenModal: (options) => { modals.push(options); },
      applyToken: async (token) => {
        applied.push(token);
        state.gh = { ...state.gh, name: 'new-client' };       // what admin.mjs's session hook does
      },
    });
    await tick();
    await handle.start();

    assert.deepEqual(runs, ['old-client']);
    assert.equal(modals.length, 1, 'the shared token modal opened by itself');
    assert.equal(modals[0].session, state.session, 'checked against the session repository');
    const card = document.body.findAll((n) => n.className === 'adm-pub')[0];
    assert.ok(card.textContent.includes('GitHub rejected the token (HTTP 401). Nothing was published.'));
    assert.ok(!card.textContent.includes('Settings'), 'no detour through Settings');
    assert.equal(buttonsNamed('Retry', card).length, 0);

    // Cancel, then the card's "Replace token" opens the same modal again
    buttonsNamed('Replace token', card)[0].click();
    assert.equal(modals.length, 2);

    await modals[1].apply('ghp_FAKE_T5_NEW');                 // GitHub accepted the new token (the modal checked it)
    await new Promise((resolve) => { setTimeout(resolve, 10); });   // the publish starts again on a later turn
    await tick();
    assert.deepEqual(applied, ['ghp_FAKE_T5_NEW']);
    assert.deepEqual(runs, ['old-client', 'new-client'], 'published again, with the new client');
    assert.equal(modals.length, 2, 'no modal for a failure that is not the token');
  } finally {
    restore();
  }
});

test('wirePublish: a stale or missing sign-in never reaches publish(), whether from the button, Retry, Overwrite or Reload', async () => {
  const restore = installFakeDom();
  try {
    const { handle, nodes, state } = wireForGuard({ session: asSession('new') });
    await tick();
    await handle.start();                               // publishes once, and leaves the Retry button
    assert.equal(state.published.length, 1);

    state.session = asSession('old');                   // signed in again with the replaced admin code: stale
    buttonsNamed('Retry')[0].click();
    nodes['#publishButton'].onclick();
    await handle.reapply(true);                         // Overwrite with my draft
    await handle.reapply(false);                        // Reload and reapply
    state.session = asSession('ghost');                 // an admin entry the draft does not hold
    await handle.start();
    state.session = asSession('dl');                    // not an admin entry
    await handle.start();
    await tick();

    assert.equal(state.published.length, 1, 'publish() was never called again');
    assert.deepEqual(state.ghCalls, ['gh1 getHead'], 'nothing was read from GitHub either');
    assert.equal(nodes['#publishButton'].textContent, 'Publish', 'not left busy');
    assert.equal(nodes['#main'].classList.contains('adm-busy'), false);
    const shown = dialogs();
    assert.equal(shown.length, 6, 'one notice per attempt');
    for (const dialog of shown) assert.ok(dialog.textContent.includes(SESSION_MISMATCH_TEXT));

    // its button opens Access codes, where the owner resumes or cancels the change
    buttonsNamed('Open Access codes', shown[0])[0].click();
    await tick();
    assert.equal(location.hash, '#access');
    assert.equal(dialogs().length, 5, 'that notice closed');
  } finally {
    restore();
  }
});
