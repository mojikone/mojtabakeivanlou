// Pure helpers of the dashboard shell (admin.mjs): the session, loading the draft base, the top bar's status line and
// the route. No DOM, so the Node tests cover them; `storage` is injectable (sessionStorage in the browser).

import { createAccessFile, createKeysFile } from '../../assets/js/vault.mjs';

/* ─── SESSION (spec 13.1, 13.8) ─── */

// Written by the gate here and by the public unlock flow (assets/js/access.mjs); all three or none.
//   mk.admin  JSON { entryId, vk, github: { token, owner, repo, branch } }
//   mk.vault  base64 vault key (the same as mk.admin.vk)
//   mk.kek    base64 raw KEK of the admin code
export const SESSION_KEYS = Object.freeze(['mk.admin', 'mk.vault', 'mk.kek']);
const GITHUB_FIELDS = ['token', 'owner', 'repo', 'branch'];

const filled = (x) => typeof x === 'string' && x !== '';

/** { entryId, vk, kek, github } when every field is there, else null. Copies only the known fields. */
export function toSession({ entryId, vk, kek, github } = {}) {
  if (!filled(vk) || !filled(kek) || !github || !GITHUB_FIELDS.every((k) => filled(github[k]))) return null;
  const { token, owner, repo, branch } = github;
  return { entryId: typeof entryId === 'string' ? entryId : '', vk, kek, github: { token, owner, repo, branch } };
}

/** The signed-in session, or null when any of the three keys is missing or malformed (then the gate asks again). */
export function readSession(storage) {
  try {
    const admin = JSON.parse(storage?.getItem('mk.admin') ?? 'null');
    const vault = storage.getItem('mk.vault');
    if (!admin || typeof admin !== 'object' || !filled(vault)) return null;
    return toSession({ ...admin, kek: storage.getItem('mk.kek') });
  } catch {
    return null;                            // blocked storage or a broken value: not signed in
  }
}

/** Stores the session; true when all three keys were written. On any failure none of them is left behind. */
export function writeSession(storage, session) {
  if (!storage) return false;
  try {
    storage.setItem('mk.admin', JSON.stringify({ entryId: session.entryId, vk: session.vk, github: session.github }));
    storage.setItem('mk.vault', session.vk);
    storage.setItem('mk.kek', session.kek);
    return true;
  } catch {
    clearSession(storage);
    return false;
  }
}

export function clearSession(storage) {
  for (const key of SESSION_KEYS) {
    try { storage?.removeItem(key); } catch { /* nothing stored */ }
  }
}

/* ─── DRAFT BASE (spec 13.4) ─── */

export const PATHS = Object.freeze({ site: 'content/site.json', access: 'vault/access.json', keys: 'vault/keys.json' });

function parseJson(file, path) {
  try {
    return JSON.parse(new TextDecoder().decode(file.bytes));
  } catch {
    throw new Error(`${path} on GitHub is not valid JSON`);
  }
}

/**
 * The base for store.init(): the branch head and the three files, fetched in parallel through the GitHub client.
 * A missing access or keys file becomes the empty shape (its sha null); a missing site.json is an error.
 */
export async function loadBase(github) {
  const [head, site, access, keys] = await Promise.all([
    github.getHead(),
    github.getFile(PATHS.site),
    github.getFile(PATHS.access),
    github.getFile(PATHS.keys),
  ]);
  if (!site) throw new Error(`${PATHS.site} is missing on the branch`);
  return {
    commit: head.sha,
    shas: { site: site.sha, access: access?.sha ?? null, keys: keys?.sha ?? null },
    site: parseJson(site, PATHS.site),
    access: access ? parseJson(access, PATHS.access) : createAccessFile(),
    keys: keys ? parseJson(keys, PATHS.keys) : createKeysFile(''),
  };
}

/* ─── TOP BAR ─── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MINUTE = 60e3;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 'just now', '2 min ago', '3 h ago', '1 day ago', '12 days ago', then 'on 3 Mar 2026' (UTC); '—' for a bad date. */
export function relativeTime(iso, now = Date.now()) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '—';
  const diff = now - then;
  if (diff < MINUTE) return 'just now';     // also a timestamp slightly in the future (clock skew)
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h ago`;
  const days = Math.floor(diff / DAY);
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  const d = new Date(then);
  return `on ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function changesText(n) {
  if (n === 0) return 'no unpublished changes';
  return `${n} unpublished ${n === 1 ? 'change' : 'changes'}`;
}

/**
 * The status line of the top bar.
 *   published  undefined while the last successful run is being fetched, null when it is unknown, else its ISO time
 *   changes    store.dirty().total once the draft is loaded, else null (left out)
 */
export function statusText({ published, changes = null, now = Date.now() } = {}) {
  const parts = ['Live'];
  if (published === null) parts.push('—');
  else if (published !== undefined) parts.push(`published ${relativeTime(published, now)}`);
  if (typeof changes === 'number') parts.push(changesText(changes));
  return parts.join(' · ');
}

/** "First Last" from the draft's profile, or '' */
export function profileName(site) {
  const p = site?.profile;
  return [p?.firstName, p?.lastName].filter((x) => typeof x === 'string' && x.trim() !== '').join(' ');
}

/* ─── ROUTE ─── */

/** The section id named by location.hash: 'setup', one of `ids`, or ids[0] for anything else. */
export function routeOf(hash, ids) {
  const id = String(hash ?? '').replace(/^#/, '');   // ids are plain ASCII: nothing to decode
  if (id === 'setup') return 'setup';
  return ids.includes(id) ? id : ids[0];
}
