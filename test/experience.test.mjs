// The Experience section's file bookkeeping (Task 19b): a removed company, project or bullet takes its files out of
// the draft as removeFile() does one by one (pending ones leave `pending`, committed ones go to `deleted`), and the
// row's Undo puts them back. The DOM part of the section is checked in the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStore } from '../admin/modules/state.mjs';
import { releaseFiles, restoreFiles } from '../admin/sections/experience.mjs';

const SITE = JSON.parse(readFileSync(new URL('./fixtures/site.min.json', import.meta.url), 'utf8'));
const COMPANIES = ['site', 'experience', 'companies'];
const BULLETS = [...COMPANIES, 0, 'projects', 0, 'bullets'];
const COMMITTED = { id: 'c'.repeat(32), name: 'old.pdf', size: 10, type: 'application/pdf', enc: true };
const PENDING = { id: 'a'.repeat(32), name: 'new.pdf', size: 20, type: 'application/pdf', enc: true };

// A draft whose first bullet holds a committed file and a pending one.
function setup() {
  const site = structuredClone(SITE);
  site.experience.companies[0].projects[0].bullets[0].files = [COMMITTED];
  const store = createStore({ storage: null });
  store.init({ commit: 'c0', shas: { site: 's', access: null, keys: null }, site, access: { v: 1, entries: [] }, keys: { v: 1, vk: '', files: {} } });
  store.addPendingFile([...BULLETS, 0], PENDING);
  return store;
}
const bookkeeping = (draft) => ({ pending: draft.pending, deleted: draft.deleted });

test('removing a bullet releases its files, and putting it back restores them', () => {
  const store = setup();
  const before = store.get();
  const bullet = before.site.experience.companies[0].projects[0].bullets[0];

  store.remove(BULLETS, 0);
  releaseFiles(store, store.get(), bullet);
  assert.deepEqual(bookkeeping(store.get()), { pending: [], deleted: [COMMITTED.id] });

  store.insert(BULLETS, 0, structuredClone(bullet));
  restoreFiles(store, store.get(), bullet);
  assert.deepEqual(store.get().site, before.site);
  assert.deepEqual(bookkeeping(store.get()), bookkeeping(before));
});

test('a company releases the files of all its projects and gets them back', () => {
  const store = setup();
  const before = store.get();
  const company = before.site.experience.companies[0];

  store.remove(COMPANIES, 0);
  releaseFiles(store, store.get(), company);
  assert.deepEqual(bookkeeping(store.get()), { pending: [], deleted: [COMMITTED.id] });

  store.insert(COMPANIES, 0, structuredClone(company));
  restoreFiles(store, store.get(), company);
  assert.deepEqual(bookkeeping(store.get()), bookkeeping(before));
});

test('a row without files writes nothing', () => {
  const store = setup();
  let writes = 0;
  const spy = { set: () => { writes += 1; } };
  for (const row of [{ text: 'x', files: [] }, { id: '', name: '', bullets: [] }, { id: '', projects: [] }, null]) {
    releaseFiles(spy, store.get(), row);
    restoreFiles(spy, store.get(), row);
  }
  assert.equal(writes, 0);
});
