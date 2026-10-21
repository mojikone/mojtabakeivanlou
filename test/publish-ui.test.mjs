// Publish UI (Task 22b, spec 13.6): the pure helpers behind the Publish button, the progress card, the validation
// links and the conflict merge. The DOM glue (wirePublish) is checked by hand in the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buttonState, stepLine, sectionForPath, mergeDrafts, failureMessage, isDeploySkipped, actionsUrl,
} from '../admin/modules/publish-ui.mjs';

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

/* ─── mergeDrafts ─── */

test('mergeDrafts: a dirty profile keeps the draft profile, education takes the remote; access and keys always remote', () => {
  const draft = draftOf({ revoked: ['x1'], rotate: true });
  draft.site.profile.firstName = 'Draft';
  draft.access = { v: 1, entries: [{ id: 'mine' }, { id: 'new-code' }] };
  const remote = { site: clone(SITE), access: { v: 1, entries: [{ id: 'theirs' }] }, keys: { v: 1, vk: 'vk1', files: { [ID('c')]: { k: 1 } } } };
  remote.site.profile.firstName = 'Remote';
  remote.site.education[0].degree = 'PhD — remote';

  const m = mergeDrafts(draft, remote, ['profile', 'access']);

  assert.equal(m.site.profile.firstName, 'Draft');
  assert.deepEqual(m.site.profile, draft.site.profile);
  assert.deepEqual(m.site.education, remote.site.education);
  assert.deepEqual(m.access, remote.access);
  assert.deepEqual(m.keys, remote.keys);
  assert.deepEqual(m.revoked, []);
  assert.equal(m.rotate, false);
  assert.equal(m.discardedAccess, true);
  assert.deepEqual(Object.keys(m.site), Object.keys(remote.site));     // site.json keeps the remote key order
  assert.notEqual(m.site.profile, draft.site.profile);                 // copies, not shared objects
  assert.equal(mergeDrafts(draft, remote, ['profile']).discardedAccess, false);
});

test('mergeDrafts: the site key splits like dirty(): formSubject follows Contact page, the rest Settings', () => {
  const draft = draftOf();
  draft.site.site.formSubject = 'Draft subject';
  draft.site.site.gaId = 'G-DRAFT';
  const remote = { site: clone(SITE), access: draft.access, keys: draft.keys };
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
  const remote = { site: { ...clone(SITE), schemaVersion: 2, extra: { a: 1 } }, access: draft.access, keys: draft.keys };
  const m = mergeDrafts(draft, remote, ['education']);
  assert.equal(m.site.schemaVersion, 2);
  assert.deepEqual(m.site.extra, { a: 1 });
  assert.equal(m.site.education[0].year, '1999');
  const over = mergeDrafts(draft, remote, [], { keepSite: true });
  assert.deepEqual(over.site, draft.site);
  assert.deepEqual(over.access, remote.access);
});

test('mergeDrafts: pending files keep their wrapped keys on the same vault key; deleted ids stay unless referenced', () => {
  const pend = ID('d');
  const gone = ID('e');
  const draft = draftOf({ pending: [record(pend)], deleted: [gone] });
  draft.site.experience.companies[0].projects[0].bullets[0].files = [record(pend)];
  draft.keys = { v: 1, vk: 'vk1', files: { [pend]: { wrapped: 'p' }, [gone]: { wrapped: 'g' } } };
  const remote = { site: clone(SITE), access: draft.access, keys: { v: 1, vk: 'vk1', files: { [gone]: { wrapped: 'g' } } } };

  const m = mergeDrafts(draft, remote, ['experience', 'files']);

  assert.deepEqual(m.keys, { v: 1, vk: 'vk1', files: { [gone]: { wrapped: 'g' }, [pend]: { wrapped: 'p' } } });
  assert.deepEqual(m.pending, [record(pend)]);
  assert.deepEqual(m.deleted, [gone]);
  assert.deepEqual(m.dropped, []);

  // experience not dirty: the remote experience wins, so the pending record is gone and so is its pending entry;
  // a deleted id the remote still references is not deleted
  const remote2 = clone(remote);
  remote2.site.experience.companies[0].projects[0].bullets[0].files = [record(gone)];
  const n = mergeDrafts(draft, remote2, []);
  assert.deepEqual(n.pending, []);
  assert.deepEqual(n.dropped, [pend]);
  assert.equal(n.vaultChanged, false);
  assert.deepEqual(n.deleted, []);
  assert.deepEqual(n.keys, remote2.keys);
});

test('mergeDrafts: a vault key rotated on GitHub drops the new attachments (their keys are under the old key)', () => {
  const pend = ID('f');
  const draft = draftOf({ pending: [record(pend)] });
  draft.site.experience.companies[0].projects[0].bullets[0].files = [record(pend)];
  draft.site.profile.firstName = 'Draft';
  draft.keys = { v: 1, vk: 'vk1', files: { [pend]: { wrapped: 'p' } } };
  const remote = { site: clone(SITE), access: draft.access, keys: { v: 1, vk: 'vk2', files: {} } };

  for (const m of [mergeDrafts(draft, remote, ['experience', 'files', 'profile']), mergeDrafts(draft, remote, [], { keepSite: true })]) {
    assert.deepEqual(m.dropped, [pend]);
    assert.equal(m.vaultChanged, true);
    assert.deepEqual(m.pending, []);
    assert.deepEqual(m.keys, remote.keys);
    assert.deepEqual(m.site.experience.companies[0].projects[0].bullets[0].files, []);
    assert.equal(m.site.profile.firstName, 'Draft');
  }
  assert.deepEqual(draft.site.experience.companies[0].projects[0].bullets[0].files, [record(pend)]); // not mutated
});
