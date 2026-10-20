// Draft store (Task 17, spec section 13.4): unpublished edits kept in localStorage["mk.draft"].
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStore } from '../admin/modules/state.mjs';

const KEY = 'mk.draft';
const clone = (x) => JSON.parse(JSON.stringify(x));
const SITE = JSON.parse(readFileSync(new URL('./fixtures/site.min.json', import.meta.url), 'utf8'));
const FILE = { id: 'a'.repeat(32), name: 'report.pdf', size: 1234, type: 'application/pdf' };
const FILE2 = { id: 'b'.repeat(32), name: 'notes.txt', size: 12, type: 'text/plain' };
const BULLET = ['site', 'experience', 'companies', 0, 'projects', 0, 'bullets', 0];
const LANGS = ['site', 'languages'];

function memStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
}

function makeBase(over = {}) {
  return {
    commit: 'c0ffee1',
    shas: { site: 'sha-site', access: 'sha-access', keys: 'sha-keys' },
    site: clone(SITE),
    access: { v: 1, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: 'c2FsdA==' }, entries: [] },
    keys: { v: 1, vk: '', files: {} },
    ...over,
  };
}

function makeStoredDraft() {
  const b = makeBase();
  return {
    v: 1, baseCommit: b.commit, baseShas: b.shas, site: b.site, access: b.access, keys: b.keys,
    pending: [], deleted: [], revoked: [], rotate: false, loadedAt: '2026-01-01T00:00:00.000Z',
  };
}

function fresh(storage = memStorage()) {
  const store = createStore({ storage });
  store.init(makeBase());
  return { store, storage };
}

// ---------------------------------------------------------------- init

test('init builds a fresh draft from the base', () => {
  const { store, storage } = fresh();
  const d = store.get();
  assert.equal(d.v, 1);
  assert.equal(d.baseCommit, 'c0ffee1');
  assert.deepEqual(d.baseShas, { site: 'sha-site', access: 'sha-access', keys: 'sha-keys' });
  assert.deepEqual(d.site, SITE);
  assert.deepEqual(d.access, makeBase().access);
  assert.deepEqual(d.keys, makeBase().keys);
  assert.deepEqual(d.pending, []);
  assert.deepEqual(d.deleted, []);
  assert.deepEqual(d.revoked, []);
  assert.equal(d.rotate, false);
  assert.match(d.loadedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(storage.getItem(KEY), null, 'a clean draft is not persisted until something changes');
});

test('init returns the draft it created', () => {
  const store = createStore({ storage: memStorage() });
  assert.equal(store.init(makeBase()), store.get());
});

test('the draft does not alias the base object it was created from', () => {
  const base = makeBase();
  const store = createStore({ storage: memStorage() });
  store.init(base);
  base.site.profile.firstName = 'Mutated';
  assert.equal(store.get().site.profile.firstName, 'Mojtaba');
  assert.equal(store.dirty().total, 0);
});

test('init loads a stored v1 draft and keeps its own base fields', () => {
  const { store: first, storage } = fresh();
  first.set(['site', 'profile', 'email'], 'new@example.com');
  const saved = first.get();

  const second = createStore({ storage });
  const loaded = second.init(makeBase({ commit: 'newer999', shas: { site: 's2', access: 'a2', keys: 'k2' } }));
  assert.deepEqual(loaded, saved);
  assert.equal(second.get().baseCommit, 'c0ffee1');
  assert.deepEqual(second.get().baseShas, { site: 'sha-site', access: 'sha-access', keys: 'sha-keys' });
  assert.equal(second.get().site.profile.email, 'new@example.com');
});

test('a second createStore with the same storage loads the persisted draft', () => {
  const { store, storage } = fresh();
  store.set(['site', 'profile', 'roleSubtitle'], 'Principal');
  store.addPendingFile(BULLET, FILE);
  store.set(['rotate'], true);

  const again = createStore({ storage });
  again.init(makeBase());
  assert.equal(again.get().site.profile.roleSubtitle, 'Principal');
  assert.deepEqual(again.get().pending, [FILE]);
  assert.equal(again.get().rotate, true);
  assert.equal(again.dirty().bySection.profile, 1);
});

test('a stored draft with another version is discarded', () => {
  const stale = { ...makeStoredDraft(), v: 0 };
  stale.site.profile.firstName = 'Stale';
  const storage = memStorage({ [KEY]: JSON.stringify(stale) });
  const store = createStore({ storage });
  store.init(makeBase());
  assert.equal(store.get().v, 1);
  assert.equal(store.get().site.profile.firstName, 'Mojtaba');
  assert.equal(storage.getItem(KEY), null, 'the stale draft is removed from storage');
});

test('invalid JSON in storage is ignored and removed', () => {
  const storage = memStorage({ [KEY]: '{not json' });
  const store = createStore({ storage });
  store.init(makeBase());
  assert.equal(store.get().site.profile.firstName, 'Mojtaba');
  assert.equal(storage.getItem(KEY), null);
});

test('stored values that are not draft-shaped are discarded', () => {
  for (const junk of ['null', '42', '"text"', '[]', '{"v":1,"site":null}', '{"v":1,"pending":{}}']) {
    const storage = memStorage({ [KEY]: junk });
    const store = createStore({ storage });
    store.init(makeBase());
    assert.equal(store.get().baseCommit, 'c0ffee1', junk);
    assert.equal(storage.getItem(KEY), null, junk);
  }
});

// ---------------------------------------------------------------- set

test('set persists and get reflects it', () => {
  const { store, storage } = fresh();
  store.set(['site', 'profile', 'email'], 'new@example.com');
  assert.equal(store.get().site.profile.email, 'new@example.com');
  const stored = JSON.parse(storage.getItem(KEY));
  assert.equal(stored.v, 1);
  assert.equal(stored.site.profile.email, 'new@example.com');
});

test('set reaches into arrays by index', () => {
  const { store } = fresh();
  store.set([...BULLET, 'text'], 'Edited bullet');
  const bullet = store.get().site.experience.companies[0].projects[0].bullets[0];
  assert.equal(bullet.text, 'Edited bullet');
  assert.deepEqual(bullet.files, []);
});

test('set creates missing intermediate objects and arrays', () => {
  const { store } = fresh();
  store.set(['site', 'extra', 'deep', 'leaf'], 1);
  store.set(['site', 'list', 2, 'name'], 'x');
  assert.deepEqual(store.get().site.extra, { deep: { leaf: 1 } });
  assert.ok(Array.isArray(store.get().site.list));
  assert.equal(store.get().site.list.length, 3);
  assert.equal(store.get().site.list[2].name, 'x');
});

test('set replaces top-level draft values', () => {
  const { store } = fresh();
  store.set(['rotate'], true);
  store.set(['revoked'], ['entry-1']);
  assert.equal(store.get().rotate, true);
  assert.deepEqual(store.get().revoked, ['entry-1']);
});

test('set rejects an empty path and prototype-polluting keys', () => {
  const { store } = fresh();
  assert.throws(() => store.set([], {}), TypeError);
  assert.throws(() => store.set(['site', '__proto__', 'x'], 1), TypeError);
  assert.equal({}.x, undefined);
});

test('reading or mutating before init is safe or throws clearly', () => {
  const store = createStore({ storage: memStorage() });
  assert.equal(store.get(), null);
  assert.equal(store.dirty().total, 0);
  assert.throws(() => store.set(['rotate'], true), /init/);
});

// ---------------------------------------------------------------- lists

test('insert adds an item at the index', () => {
  const { store } = fresh();
  store.set(LANGS, ['a', 'b', 'c']);
  store.insert(LANGS, 1, 'x');
  assert.deepEqual(store.get().site.languages, ['a', 'x', 'b', 'c']);
  store.insert(LANGS, 99, 'end');
  assert.deepEqual(store.get().site.languages, ['a', 'x', 'b', 'c', 'end']);
});

test('insert into a missing array creates it', () => {
  const { store } = fresh();
  store.insert(['site', 'brandNew'], 0, 'first');
  assert.deepEqual(store.get().site.brandNew, ['first']);
});

test('remove drops the item at the index and ignores a bad index', () => {
  const { store } = fresh();
  store.set(LANGS, ['a', 'b', 'c']);
  store.remove(LANGS, 1);
  assert.deepEqual(store.get().site.languages, ['a', 'c']);
  const before = store.get();
  store.remove(LANGS, 5);
  store.remove(LANGS, -1);
  assert.equal(store.get(), before);
});

test('move reorders in place', () => {
  const { store } = fresh();
  store.set(LANGS, ['a', 'b', 'c', 'd']);
  store.move(LANGS, 0, 2);
  assert.deepEqual(store.get().site.languages, ['b', 'c', 'a', 'd']);
  store.move(LANGS, 3, 0);
  assert.deepEqual(store.get().site.languages, ['d', 'b', 'c', 'a']);
  const before = store.get();
  store.move(LANGS, 1, 1);
  store.move(LANGS, 9, 0);
  assert.equal(store.get(), before);
});

test('move persists', () => {
  const { store, storage } = fresh();
  store.set(LANGS, ['a', 'b', 'c']);
  store.move(LANGS, 2, 0);
  assert.deepEqual(JSON.parse(storage.getItem(KEY)).site.languages, ['c', 'a', 'b']);
});

// ---------------------------------------------------------------- files

test('addPendingFile puts the record on the bullet and in pending', () => {
  const { store, storage } = fresh();
  store.addPendingFile(BULLET, FILE);
  const d = store.get();
  assert.deepEqual(d.site.experience.companies[0].projects[0].bullets[0].files, [FILE]);
  assert.deepEqual(d.pending, [FILE]);
  assert.deepEqual(JSON.parse(storage.getItem(KEY)).pending, [FILE]);
});

test('addPendingFile accepts a bullet path relative to the site content', () => {
  const { store } = fresh();
  store.addPendingFile(BULLET.slice(1), FILE);
  assert.deepEqual(store.get().site.experience.companies[0].projects[0].bullets[0].files, [FILE]);
});

test('removeFile on a pending id drops it from the bullet and from pending', () => {
  const { store } = fresh();
  store.addPendingFile(BULLET, FILE);
  store.addPendingFile(BULLET, FILE2);
  store.removeFile(BULLET, FILE.id);
  const d = store.get();
  assert.deepEqual(d.site.experience.companies[0].projects[0].bullets[0].files, [FILE2]);
  assert.deepEqual(d.pending, [FILE2]);
  assert.deepEqual(d.deleted, []);
});

test('removeFile on a committed id moves it to deleted', () => {
  const base = makeBase();
  base.site.experience.companies[0].projects[0].bullets[0].files = [FILE];
  const store = createStore({ storage: memStorage() });
  store.init(base);
  store.removeFile(BULLET, FILE.id);
  const d = store.get();
  assert.deepEqual(d.site.experience.companies[0].projects[0].bullets[0].files, []);
  assert.deepEqual(d.deleted, [FILE.id]);
  assert.deepEqual(d.pending, []);
});

test('removeFile does nothing for an id the bullet does not hold', () => {
  const { store } = fresh();
  const before = store.get();
  store.removeFile(BULLET, 'f'.repeat(32));
  assert.equal(store.get(), before);
  assert.deepEqual(store.get().deleted, []);
});

test('removeFile does not list a committed id twice', () => {
  const base = makeBase();
  base.site.experience.companies[0].projects[0].bullets[0].files = [FILE, { ...FILE }];
  const store = createStore({ storage: memStorage() });
  store.init(base);
  store.removeFile(BULLET, FILE.id);
  store.removeFile(BULLET, FILE.id);
  assert.deepEqual(store.get().deleted, [FILE.id]);
});

// ---------------------------------------------------------------- dirty

test('a clean draft has nothing dirty', () => {
  const { store } = fresh();
  assert.equal(store.dirty().total, 0);
  assert.equal(store.dirty().bySection.experience, 0);
});

test('one bullet edit makes only experience dirty', () => {
  const { store } = fresh();
  store.set([...BULLET, 'text'], 'Edited bullet');
  const d = store.dirty();
  assert.equal(d.bySection.experience, 1);
  assert.equal(d.total, 1);
  assert.equal(d.bySection.profile, 0);
});

test('several edits in one section still count once; total counts sections', () => {
  const { store } = fresh();
  store.set([...BULLET, 'text'], 'one');
  store.set(['site', 'experience', 'intro'], 'two');
  store.set(['site', 'profile', 'email'], 'a@b.co');
  const d = store.dirty();
  assert.equal(d.bySection.experience, 1);
  assert.equal(d.bySection.profile, 1);
  assert.equal(d.total, 2);
});

test('editing a value back to the original is clean again', () => {
  const { store } = fresh();
  const original = store.get().site.profile.email;
  store.set(['site', 'profile', 'email'], 'other@example.com');
  assert.equal(store.dirty().total, 1);
  store.set(['site', 'profile', 'email'], original);
  assert.equal(store.dirty().total, 0);
});

test('the section map covers every top-level key', () => {
  const cases = [
    [['site', 'profile', 'email'], 'x', 'profile'],
    [['site', 'education', 0, 'degree'], 'x', 'education'],
    [['site', 'languages', 0, 'name'], 'x', 'languages'],
    [['site', 'services', 0, 'title'], 'x', 'services'],
    [['site', 'experience', 'intro'], 'x', 'experience'],
    [['site', 'skills', 0, 'name'], 'x', 'skills'],
    [['site', 'contactPage', 'title'], 'x', 'contact'],
    [['site', 'thankYou', 'title'], 'x', 'contact'],
    [['site', 'cta', 'title'], 'x', 'contact'],
    [['site', 'site', 'gaId'], 'G-OTHER', 'settings'],
    [['site', 'seo', 'title'], 'x', 'settings'],
    [['access', 'entries'], [{ id: 'e1' }], 'access'],
    [['revoked'], ['e1'], 'access'],
    [['rotate'], true, 'access'],
    [['pending'], [FILE], 'files'],
    [['deleted'], ['gone'], 'files'],
  ];
  for (const [path, value, section] of cases) {
    const { store } = fresh();
    store.set(path, value);
    const d = store.dirty();
    assert.equal(d.bySection[section], 1, `${path.join('.')} -> ${section}`);
    assert.equal(d.total, 1, path.join('.'));
  }
});

test('several keys of one section count as one dirty section', () => {
  const { store } = fresh();
  store.set(['site', 'contactPage', 'title'], 'x');
  store.set(['site', 'thankYou', 'title'], 'y');
  store.set(['site', 'cta', 'title'], 'z');
  assert.equal(store.dirty().bySection.contact, 1);
  assert.equal(store.dirty().total, 1);
});

test('file changes make the files section dirty', () => {
  const { store } = fresh();
  store.addPendingFile(BULLET, FILE);
  const d = store.dirty();
  assert.equal(d.bySection.files, 1);
  assert.equal(d.bySection.experience, 1);
  assert.equal(d.total, 2);
});

test('key order does not matter when comparing against the base', () => {
  const { store } = fresh();
  const profile = store.get().site.profile;
  store.set(['site', 'profile'], Object.fromEntries(Object.entries(profile).reverse()));
  assert.equal(store.dirty().total, 0);
});

test('dirty compares against the base given to init, not the stored base fields', () => {
  const { store: first, storage } = fresh();
  first.set(['site', 'profile', 'email'], 'new@example.com');
  const again = createStore({ storage });
  again.init(makeBase());
  assert.equal(again.dirty().bySection.profile, 1);

  const newerBase = makeBase();
  newerBase.site.profile.email = 'new@example.com';
  const third = createStore({ storage });
  third.init(newerBase);
  assert.equal(third.dirty().bySection.profile, 0);
});

// ---------------------------------------------------------------- reset

test('reset restores the base, persists it and notifies', () => {
  const { store, storage } = fresh();
  store.set(['site', 'profile', 'email'], 'new@example.com');
  store.addPendingFile(BULLET, FILE);
  store.set(['rotate'], true);
  const seen = [];
  store.subscribe((d) => seen.push(d));

  const d = store.reset();
  assert.equal(d, store.get());
  assert.deepEqual(d.site, SITE);
  assert.deepEqual(d.pending, []);
  assert.equal(d.rotate, false);
  assert.equal(d.baseCommit, 'c0ffee1');
  assert.equal(store.dirty().total, 0);
  assert.equal(seen.length, 1);
  assert.equal(seen[0], d);
  assert.deepEqual(JSON.parse(storage.getItem(KEY)).site, SITE);
});

test('reset uses the base from the most recent init', () => {
  const { store } = fresh();
  store.set(['site', 'profile', 'email'], 'x@y.zz');
  const newer = makeBase({ commit: 'newer999' });
  newer.site.profile.firstName = 'Moji';
  store.init(newer);
  store.set(['site', 'profile', 'firstName'], 'Changed');
  store.reset();
  assert.equal(store.get().baseCommit, 'newer999');
  assert.equal(store.get().site.profile.firstName, 'Moji');
});

test('reset before init throws', () => {
  assert.throws(() => createStore({ storage: memStorage() }).reset(), /init/);
});

// ---------------------------------------------------------------- immutability

test('an earlier get() result is never changed by later edits', () => {
  const { store } = fresh();
  store.set(LANGS, ['a', 'b', 'c']);
  const snapshot = store.get();
  const frozenCopy = clone(snapshot);

  store.set(['site', 'profile', 'email'], 'new@example.com');
  store.set([...BULLET, 'text'], 'Edited');
  store.insert(LANGS, 0, 'z');
  store.remove(LANGS, 1);
  store.move(LANGS, 0, 2);
  store.addPendingFile(BULLET, FILE);
  store.removeFile(BULLET, FILE.id);
  store.set(['rotate'], true);

  assert.deepEqual(snapshot, frozenCopy);
  assert.notEqual(store.get(), snapshot);
});

test('nested arrays are copied, not shared, when they change', () => {
  const { store } = fresh();
  const bullet = store.get().site.experience.companies[0].projects[0].bullets[0];
  const pendingBefore = store.get().pending;
  store.addPendingFile(BULLET, FILE);
  assert.deepEqual(bullet.files, []);
  assert.deepEqual(pendingBefore, []);
  assert.notEqual(store.get().pending, pendingBefore);
});

test('untouched branches are shared between versions', () => {
  const { store } = fresh();
  const before = store.get();
  store.set(['site', 'profile', 'email'], 'new@example.com');
  assert.equal(store.get().site.experience, before.site.experience);
  assert.notEqual(store.get().site.profile, before.site.profile);
});

// ---------------------------------------------------------------- subscribe

test('subscribers get the new draft after every change', () => {
  const { store } = fresh();
  const seen = [];
  store.subscribe((d) => seen.push(d));
  store.set(['rotate'], true);
  store.insert(LANGS, 0, 'a');
  store.addPendingFile(BULLET, FILE);
  assert.equal(seen.length, 3);
  assert.equal(seen[2], store.get());
  assert.equal(seen[0].rotate, true);
});

test('unsubscribe stops notifications', () => {
  const { store } = fresh();
  let calls = 0;
  const off = store.subscribe(() => { calls += 1; });
  store.set(['rotate'], true);
  off();
  off();
  store.set(['rotate'], false);
  assert.equal(calls, 1);
});

test('a subscriber can unsubscribe while being notified', () => {
  const { store } = fresh();
  const calls = [];
  const offA = store.subscribe(() => { calls.push('a'); offA(); });
  store.subscribe(() => calls.push('b'));
  store.set(['rotate'], true);
  store.set(['rotate'], false);
  assert.deepEqual(calls, ['a', 'b', 'b']);
});

test('init notifies subscribers with the loaded draft', () => {
  const store = createStore({ storage: memStorage() });
  const seen = [];
  store.subscribe((d) => seen.push(d));
  const d = store.init(makeBase());
  assert.deepEqual(seen, [d]);
});

test('a throwing subscriber does not stop the others or the change', (t) => {
  const { store } = fresh();
  const errors = t.mock.method(console, 'error', () => {});
  let reached = false;
  store.subscribe(() => { throw new Error('boom'); });
  store.subscribe(() => { reached = true; });
  store.set(['rotate'], true);
  assert.equal(reached, true);
  assert.equal(store.get().rotate, true);
  assert.equal(errors.mock.callCount(), 1);
});

// ---------------------------------------------------------------- storage failures

test('a storage that throws on write keeps the in-memory draft working', () => {
  const storage = memStorage();
  storage.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); };
  const { store } = fresh(storage);
  store.set(['site', 'profile', 'email'], 'new@example.com');
  store.addPendingFile(BULLET, FILE);
  assert.equal(store.get().site.profile.email, 'new@example.com');
  assert.equal(store.dirty().bySection.profile, 1);
  assert.doesNotThrow(() => store.reset());
});

test('a storage that throws on read or remove is treated as empty', () => {
  const storage = memStorage();
  storage.getItem = () => { throw new Error('denied'); };
  storage.removeItem = () => { throw new Error('denied'); };
  const store = createStore({ storage });
  assert.doesNotThrow(() => store.init(makeBase()));
  assert.equal(store.get().baseCommit, 'c0ffee1');

  const broken = memStorage({ [KEY]: 'nope' });
  broken.removeItem = () => { throw new Error('denied'); };
  const other = createStore({ storage: broken });
  assert.doesNotThrow(() => other.init(makeBase()));
});

test('without any storage the store still works in memory', () => {
  const store = createStore({ storage: null });
  store.init(makeBase());
  store.set(['rotate'], true);
  assert.equal(store.get().rotate, true);
});
