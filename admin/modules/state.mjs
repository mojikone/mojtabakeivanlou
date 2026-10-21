// Draft store for the admin dashboard (spec section 13.4).
// Keeps the owner's unpublished edits in localStorage["mk.draft"] and exposes immutable updates.
// Pure and browser-safe: no DOM, no Node imports; `storage` is injectable (tests pass an in-memory one).

const KEY = 'mk.draft';
const VERSION = 1;
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);

// Top-level keys of the content JSON (draft.site) and of the draft itself -> dashboard section id.
const CONTENT_SECTIONS = {
  profile: 'profile', education: 'education', languages: 'languages', services: 'services',
  experience: 'experience', skills: 'skills',
  contactPage: 'contact', thankYou: 'contact', cta: 'contact',
  site: 'settings', seo: 'settings',
};
const DRAFT_SECTIONS = { access: 'access', revoked: 'access', rotate: 'access', pending: 'files', deleted: 'files' };
// Single fields of the content `site` key that the dashboard edits in another section than Settings.
const SITE_FIELD_SECTIONS = { formSubject: 'contact' };
const SECTIONS = ['profile', 'education', 'languages', 'services', 'experience', 'skills', 'contact', 'access', 'files', 'settings'];

/**
 * The dashboard section that edits the content key `key` (a top-level key of draft.site), or null for a key no
 * section edits. For the `site` key, `field` (one of its fields) can name a section of its own (formSubject: contact).
 */
export function contentSection(key, field) {
  if (key === 'site' && typeof field === 'string' && Object.hasOwn(SITE_FIELD_SECTIONS, field)) return SITE_FIELD_SECTIONS[field];
  return Object.hasOwn(CONTENT_SECTIONS, key) ? CONTENT_SECTIONS[key] : null;
}

/** The content fields of the `site` key that belong to another section than Settings (see contentSection). */
export const SITE_FIELDS = Object.freeze(Object.keys(SITE_FIELD_SECTIONS));

/**
 * The content sections (in nav order) whose part of `site` differs from `baseSite`: the map dirty() uses, so a draft
 * can also be compared with the content it started from (publish-ui.mjs, Reload and reapply).
 */
export function changedSections(site, baseSite) {
  const changed = new Set();
  for (const [key, id] of Object.entries(CONTENT_SECTIONS)) {
    if (key === 'site') continue;
    if (!same(site?.[key], baseSite?.[key])) changed.add(id);
  }
  // content `site`: Settings, except the fields listed in SITE_FIELD_SECTIONS
  const own = (s) => (isObj(s) ? Object.fromEntries(Object.entries(s).filter(([k]) => !(k in SITE_FIELD_SECTIONS))) : s);
  if (!same(own(site?.site), own(baseSite?.site))) changed.add(CONTENT_SECTIONS.site);
  for (const [field, id] of Object.entries(SITE_FIELD_SECTIONS)) {
    if (!same(site?.site?.[field], baseSite?.site?.[field])) changed.add(id);
  }
  return SECTIONS.filter((id) => changed.has(id));
}

// ---- pure helpers -------------------------------------------------------------------------

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const asList = (x) => (Array.isArray(x) ? x : []);
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);
const getIn = (node, path) => path.reduce((n, k) => (n == null ? undefined : n[k]), node);

// Returns a copy of `node` with `value` at `path`; only the objects along the path are copied.
function setIn(node, path, value) {
  if (!path.length) return value;
  const [key, ...rest] = path;
  if (UNSAFE.has(key)) throw new TypeError(`Unsafe path key "${key}"`);
  const copy = node !== null && typeof node === 'object'
    ? (Array.isArray(node) ? [...node] : { ...node })
    : (typeof key === 'number' ? [] : {});
  copy[key] = setIn(node?.[key], rest, value);
  return copy;
}

const updateIn = (node, path, fn) => setIn(node, path, fn(getIn(node, path)));

// Deep equality for JSON values; object key order does not matter.
function same(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => k in b && same(a[k], b[k]));
}

const freshDraft = (b) => ({
  v: VERSION,
  baseCommit: b.commit,
  baseShas: structuredClone(b.shas),
  site: structuredClone(b.site),
  access: structuredClone(b.access),
  keys: structuredClone(b.keys),
  pending: [],
  deleted: [],
  revoked: [],
  rotate: false,
  loadedAt: new Date().toISOString(),
});

// A stored value is usable when it is a v1 draft whose parts have the right container types.
const usable = (d) => isObj(d) && d.v === VERSION
  && ['baseShas', 'site', 'access', 'keys'].every((k) => d[k] === undefined || isObj(d[k]))
  && ['pending', 'deleted', 'revoked'].every((k) => d[k] === undefined || Array.isArray(d[k]));

// A bullet path may be draft-rooted (['site','experience',...]) or relative to the content JSON.
const bulletFiles = (bulletPath) => [...(bulletPath[0] === 'site' ? bulletPath : ['site', ...bulletPath]), 'files'];

function browserStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; } // access can throw when site data is blocked
}

// ---- the store ----------------------------------------------------------------------------

export function createStore({ storage = browserStorage() } = {}) {
  let draft = null;
  let base = null;
  const listeners = new Set();

  const dropStored = () => { try { storage?.removeItem(KEY); } catch { /* keep going without storage */ } };
  const persist = () => { try { storage?.setItem(KEY, JSON.stringify(draft)); } catch { /* quota or blocked: the in-memory draft stays authoritative */ } };

  function notify() {
    for (const entry of [...listeners]) {
      try { entry.fn(draft); } catch (err) { console.error(err); }
    }
  }

  function load() {
    let parsed = null;
    try {
      const raw = storage?.getItem(KEY);
      if (raw == null) return null;
      parsed = JSON.parse(raw);
    } catch { /* unreadable or invalid JSON: treated like a bad draft */ }
    if (usable(parsed)) return parsed;
    dropStored();
    return null;
  }

  function commit(next) {
    draft = next;
    persist();
    notify();
  }

  function need() {
    if (!draft) throw new Error('Draft store is not ready: call init(base) first');
  }

  // Applies fn to the array at `path`; fn returns the new array, or null for "nothing to do".
  function editList(path, fn) {
    need();
    const next = fn(asList(getIn(draft, path)));
    if (next) commit(setIn(draft, path, next));
  }

  function init(newBase) {
    base = structuredClone(newBase);
    const stored = load();
    draft = stored ? { ...freshDraft(base), ...stored } : freshDraft(base); // a stored draft keeps its own base fields
    notify();
    return draft;
  }

  function set(path, value) {
    need();
    if (!path.length) throw new TypeError('set() needs a non-empty path');
    commit(setIn(draft, path, value));
  }

  function insert(path, index, item) {
    editList(path, (list) => {
      const at = Number.isInteger(index) ? clamp(index, 0, list.length) : list.length;
      return [...list.slice(0, at), item, ...list.slice(at)];
    });
  }

  function remove(path, index) {
    editList(path, (list) => (Number.isInteger(index) && index >= 0 && index < list.length
      ? list.filter((_, i) => i !== index)
      : null));
  }

  function move(path, from, to) {
    editList(path, (list) => {
      if (!Number.isInteger(from) || from < 0 || from >= list.length || !Number.isInteger(to)) return null;
      const at = clamp(to, 0, list.length - 1);
      if (at === from) return null;
      const next = list.filter((_, i) => i !== from);
      next.splice(at, 0, list[from]);
      return next;
    });
  }

  function addPendingFile(bulletPath, record) {
    need();
    const file = { ...record };
    const withFile = updateIn(draft, bulletFiles(bulletPath), (files) => [...asList(files), file]);
    commit({ ...withFile, pending: [...withFile.pending, file] });
  }

  // A pending file simply disappears; a committed one is queued for deletion on publish.
  function removeFile(bulletPath, fileId) {
    need();
    const path = bulletFiles(bulletPath);
    const files = asList(getIn(draft, path));
    if (!files.some((f) => f?.id === fileId)) return;
    const next = setIn(draft, path, files.filter((f) => f?.id !== fileId));
    if (next.pending.some((f) => f.id === fileId)) {
      next.pending = next.pending.filter((f) => f.id !== fileId);
    } else if (!next.deleted.includes(fileId)) {
      next.deleted = [...next.deleted, fileId];
    }
    commit(next);
  }

  // A section is dirty (1) when any top-level key mapped to it differs from the base given to init().
  function dirty() {
    const bySection = Object.fromEntries(SECTIONS.map((id) => [id, 0]));
    if (draft && base) {
      for (const id of changedSections(draft.site, base.site)) bySection[id] = 1;
      const pristine = { access: base.access, revoked: [], rotate: false, pending: [], deleted: [] };
      for (const [key, id] of Object.entries(DRAFT_SECTIONS)) {
        if (!same(draft[key], pristine[key])) bySection[id] = 1;
      }
    }
    return { total: Object.values(bySection).reduce((sum, n) => sum + n, 0), bySection };
  }

  // Discards the draft: the stored copy is removed (a clean draft is never persisted, so the next init() loads its
  // own base) and the in-memory draft is rebuilt from the remembered base, or from `newBase`, which then replaces it.
  function reset(newBase) {
    if (newBase !== undefined) base = structuredClone(newBase);
    if (!base) throw new Error('Draft store is not ready: call init(base) first');
    dropStored();
    draft = freshDraft(base);
    notify();
    return draft;
  }

  function subscribe(fn) {
    const entry = { fn };
    listeners.add(entry);
    return () => { listeners.delete(entry); };
  }

  return { init, get: () => draft, subscribe, set, insert, remove, move, addPendingFile, removeFile, dirty, reset };
}
