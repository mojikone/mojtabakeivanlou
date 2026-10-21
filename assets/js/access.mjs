// The public unlock flow (spec 11.3), loaded as a module script on index.html.
//
// sessionStorage (one tab; closing it ends the session):
//   mk.vault  base64 raw vault key: the download icons are shown and files decrypt
//   mk.admin  JSON { entryId, vk, ok, github } (the admin payload): the pill shows "Dashboard"
//   mk.kek    base64 raw KEK of the admin code (the dashboard re-seals the admin entry with it)
//
// Nothing secret is ever logged: warnings name the step and the error type only.
// It never reads an entry's meta: the labels and codes are sealed under the owner key, which only the admin payload holds.

import { mountAccessPill } from './access-pill.mjs';
import { unlock, importKey, exportKey, unwrapFileKey, decryptFile } from './vault.mjs';

const VAULT = 'mk.vault';
const ADMIN = 'mk.admin';
const KEK = 'mk.kek';
const FILE_ID = /^[0-9a-f]{32}$/;
const ERROR_MS = 4000;                      // how long a failed icon stays marked
const REVOKE_MS = 40000;                    // keep the object URL alive until the browser has taken the download

/* ─── SESSION ─── */

// sessionStorage can be missing or throw (blocked storage); the page then still works for this load.
const session = {
  get(key) {
    try { return sessionStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    sessionStorage.setItem(key, value);
  },
  clear() {
    for (const key of [VAULT, ADMIN, KEK]) {
      try { sessionStorage.removeItem(key); } catch { /* nothing stored */ }
    }
  },
};

// The vault key of this page: from the session on load, then from an unlock. Kept here as well, so downloads work
// on this page even when sessionStorage refuses to store it.
let vaultKey = session.get(VAULT);

class HttpError extends Error {
  constructor(path, status) {
    super(`${path} returned HTTP ${status}`);
    this.name = 'HttpError';
  }
}

// Step name and error type, plus the message of our own HTTP errors (a public path and a status). Never a code,
// key or token.
function warn(step, err) {
  const detail = err instanceof HttpError ? err.message : (err && err.name) || 'Error';
  console.warn(`[access] ${step} failed: ${detail}`);
}

async function fetchOk(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) throw new HttpError(path, res.status);
  return res;
}

function showFiles(show) {
  for (const span of document.querySelectorAll('.proj-files')) span.hidden = !show;
}

/* ─── UNLOCK ─── */

async function onSubmit(code) {
  let hit;
  try {
    const access = await (await fetchOk('vault/access.json', { cache: 'no-store' })).json();
    hit = await unlock(access, code);
  } catch (err) {
    warn('unlock', err);
    return 'none';
  }
  if (!hit) return 'none';

  if (hit.kind === 'admin') {
    try {
      session.set(ADMIN, JSON.stringify({ entryId: hit.entry.id, ...hit.payload }));
      session.set(VAULT, hit.payload.vk);
      session.set(KEK, await exportKey(hit.kek));
    } catch (err) {
      session.clear();                      // all three or none; the dashboard gate then asks again
      warn('storing the session', err);
    }
    location.href = 'admin/';
    return 'admin';
  }

  if (hit.kind === 'download') {
    vaultKey = hit.payload.vk;
    try {
      session.set(VAULT, vaultKey);
    } catch (err) {
      warn('storing the session', err);   // downloads still work until the page is left
    }
    showFiles(true);
    return 'download';
  }
  return 'none';
}

function onLock() {
  vaultKey = null;
  session.clear();
  showFiles(false);
}

function onDashboard() {
  location.href = 'admin/';
}

/* ─── DOWNLOADS ─── */

async function fileBytes(id, encrypted) {
  const blobPath = `vault/files/${id}.bin`;
  if (!encrypted) return new Uint8Array(await (await fetchOk(blobPath)).arrayBuffer());
  if (!vaultKey) throw new Error('locked');
  const [keys, blob] = await Promise.all([
    fetchOk('vault/keys.json', { cache: 'no-store' }).then((res) => res.json()),
    fetchOk(blobPath).then((res) => res.arrayBuffer()),
  ]);
  const files = keys && keys.files;
  if (!files || !Object.hasOwn(files, id)) throw new Error('no key for this file');
  const fileKey = await unwrapFileKey(await importKey(vaultKey), files[id]);
  return decryptFile(fileKey, new Uint8Array(blob));
}

function save(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_MS);
}

// anchor -> { timer, title }: the pending reset of a failed icon and the title it had before.
const failed = new WeakMap();

function clearFailed(anchor) {
  const mark = failed.get(anchor);
  if (!mark) return;
  clearTimeout(mark.timer);
  failed.delete(anchor);
  anchor.classList.remove('is-error');
  if (mark.title === null) anchor.removeAttribute('title');
  else anchor.setAttribute('title', mark.title);
}

function markFailed(anchor) {
  const title = anchor.getAttribute('title');
  anchor.classList.add('is-error');
  anchor.setAttribute('title', 'Download failed');
  failed.set(anchor, { title, timer: setTimeout(() => clearFailed(anchor), ERROR_MS) });
}

async function download(anchor) {
  if (anchor.classList.contains('is-busy')) return;
  clearFailed(anchor);
  anchor.classList.add('is-busy');
  anchor.setAttribute('aria-busy', 'true');
  try {
    const id = anchor.dataset.file || '';
    if (!FILE_ID.test(id)) throw new Error('bad file id');
    const bytes = await fileBytes(id, anchor.dataset.enc === 'true');
    // The template does not render the MIME type; the download attribute names the file either way.
    save(bytes, anchor.dataset.name || `${id}.bin`, anchor.dataset.type || 'application/octet-stream');
  } catch (err) {
    warn('download', err);
    markFailed(anchor);
  } finally {
    anchor.classList.remove('is-busy');
    anchor.removeAttribute('aria-busy');
  }
}

document.addEventListener('click', (event) => {
  const anchor = event.target instanceof Element ? event.target.closest('a.proj-dl') : null;
  if (!anchor) return;
  event.preventDefault();
  download(anchor);
});

/* ─── START ─── */

const root = document.getElementById('accessPill');
const pill = root ? mountAccessPill(root, { onSubmit, onLock, onDashboard }) : null;
if (vaultKey) {
  showFiles(true);
  pill?.setState(session.get(ADMIN) ? 'admin' : 'unlocked');
}
