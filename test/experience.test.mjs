// The Experience section's file bookkeeping (Task 19b): a removed company, project or bullet takes its files out of
// the draft as removeFile() does one by one (pending ones leave `pending`, committed ones go to `deleted`), and the
// row's Undo puts them back. The DOM part of the section is checked in the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStore } from '../admin/modules/state.mjs';
import { releaseFiles, restoreFiles, listPath } from '../admin/sections/experience.mjs';

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

/* --- where a list is (listPath): late Undos only by id --- */

// Two companies; the first holds a named project and one without an id yet.
const DRAFT = {
  site: {
    experience: {
      companies: [
        { id: 'acme', projects: [{ id: 'dam', bullets: [] }, { id: '', bullets: [] }] },
        { id: '', projects: [{ id: 'canal', bullets: [] }] },
      ],
    },
  },
};
const acme = { id: 'acme', index: 0 };
const unnamedCompany = { id: '', index: 1 };
const dam = { company: acme, id: 'dam', index: 0 };
const unnamed = { company: acme, id: '', index: 1 };
const canal = { company: unnamedCompany, id: 'canal', index: 0 };

test('listPath: a list on screen is placed by its indexes, with or without ids', () => {
  assert.deepEqual(listPath(DRAFT, null, 'companies', true), ['site', 'experience', 'companies']);
  assert.deepEqual(listPath(DRAFT, unnamed, 'bullets', true), [...COMPANIES, 0, 'projects', 1, 'bullets']);
  assert.deepEqual(listPath(DRAFT, canal, 'bullets', true), [...COMPANIES, 1, 'projects', 0, 'bullets']);
});

test('listPath: a detached list is placed by ids only, so an item without an id is not placed at all', () => {
  assert.equal(listPath(DRAFT, unnamed, 'bullets', false), null);
  assert.equal(listPath(DRAFT, canal, 'bullets', false), null);        // an id-less company in the chain
  assert.equal(listPath(DRAFT, unnamedCompany, 'projects', false), null);
  assert.deepEqual(listPath(DRAFT, null, 'companies', false), ['site', 'experience', 'companies']);
});

test('listPath: a detached list with ids follows its parent after a move, and is lost when the parent is gone', () => {
  const moved = structuredClone(DRAFT);
  moved.site.experience.companies.reverse();
  moved.site.experience.companies[1].projects.reverse();
  assert.deepEqual(listPath(moved, dam, 'bullets', false), [...COMPANIES, 1, 'projects', 1, 'bullets']);
  const gone = structuredClone(DRAFT);
  gone.site.experience.companies[0].projects.shift();
  assert.equal(listPath(gone, dam, 'bullets', false), null);
  gone.site.experience.companies.shift();
  assert.equal(listPath(gone, acme, 'projects', false), null);
});
