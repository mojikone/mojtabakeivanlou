// Publish (spec 13.6, and 12 for revoke = rotate): turns the draft into one commit on the branch and follows the
// workflow run until the site is live. No DOM: the UI drives it through onProgress and the result.
// Browser-safe ES module: relative imports only, no Node APIs.
//
// Nothing here logs. No message or error it produces carries a token, a key or a code: failure messages pass
// through `clean`, which also strips anything shaped like a GitHub token.

import { importKey, exportKey, readMeta, rotateVault } from '../../assets/js/vault.mjs';
import { normalizeSite, validateSite } from '../../assets/js/render/model.mjs';
import { icons as defaultIcons } from '../../assets/js/render/icons.mjs';
import { AuthError, ConflictError, GitHubError } from './github.mjs';
import { PATHS } from './shell.mjs';

export const SECTION_LABELS = Object.freeze({
  profile: 'Profile & contact',
  education: 'Education',
  languages: 'Languages',
  services: 'Engineering services',
  experience: 'Experience',
  skills: 'Skills & software',
  contact: 'Contact page',
  access: 'Access codes',
  files: 'Files',
  settings: 'Settings',
});

const MESSAGE = 'Content update from dashboard';
const CHECKED = ['site', 'access', 'keys'];         // the files the conflict check compares (keys of PATHS)
const FILE_ID = /^[0-9a-f]{32}$/;
const DRAFT_KEY = 'mk.draft';                        // the store's localStorage key (state.mjs)
const GH_TOKEN = /gh[pousr]_[A-Za-z0-9]+/g;
const GH_FINE_GRAINED = /github_pat_[A-Za-z0-9_]+/g;
const MIN_SECRET = 6;                                // shorter strings are not searched for (they would mangle text)

/** Thrown by publish when the draft does not pass the build's validator; `errors` as validateSite returns them. */
export class PublishValidationError extends Error {
  constructor(errors) {
    super(`The draft has ${errors.length} validation error${errors.length === 1 ? '' : 's'}`);
    this.name = 'PublishValidationError';
    this.errors = errors;
  }
}

/* ─── THE COMMIT ─── */

const toFile = (value) => new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const idOf = (pending) => (typeof pending === 'string' ? pending : pending?.id);

// The ids come from the draft in localStorage: never let one name a path outside vault/files/.
function blobPath(id) {
  if (typeof id !== 'string' || !FILE_ID.test(id)) throw new Error('The draft holds an invalid file id');
  return `vault/files/${id}.bin`;
}

/**
 * The commit for a draft. Pure.
 *   blobs          { <file id>: Uint8Array } — the ciphertext of every pending file
 *   dirtySections  the section ids with changes (from store.dirty().bySection), for the message
 *   base           { access, keys } as they are on the branch at the draft's base shas; access.json and keys.json are
 *                  written when the draft's copy differs from it (JSON compare). Without it they are always written.
 * Throws Error('missing blob <id>') when a pending file has no bytes in `blobs`.
 */
export function buildCommit(draft, blobs = {}, dirtySections = [], base = null) {
  const rotate = draft.rotate === true;
  const pendingIds = (draft.pending ?? []).map(idOf);
  const files = [{ path: PATHS.site, bytes: toFile(draft.site) }];
  if (rotate || !sameJson(draft.access, base?.access)) files.push({ path: PATHS.access, bytes: toFile(draft.access) });
  if (rotate || pendingIds.length > 0 || !sameJson(draft.keys, base?.keys)) files.push({ path: PATHS.keys, bytes: toFile(draft.keys) });
  for (const id of pendingIds) {
    const path = blobPath(id);
    const bytes = blobs?.[id];
    if (!(bytes instanceof Uint8Array)) throw new Error(`missing blob ${id}`);
    files.push({ path, bytes });
  }
  const deletes = (draft.deleted ?? []).map(blobPath);
  const labels = Object.keys(SECTION_LABELS).filter((id) => dirtySections.includes(id)).map((id) => SECTION_LABELS[id]);
  return { message: labels.length ? `${MESSAGE}: ${labels.join(', ')}` : MESSAGE, files, deletes };
}

/* ─── HELPERS ─── */

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function browserStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; } // the access itself throws when site data is blocked
}

function clean(message, secrets) {
  let text = String(message ?? 'Unknown error');
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= MIN_SECRET) text = text.split(secret).join('[secret]');
  }
  return text.replace(GH_FINE_GRAINED, '[token]').replace(GH_TOKEN, '[token]');
}

// GitHub could not be reached, or answered with a server error: worth asking again on the next poll.
const transient = (err) => err instanceof GitHubError && !(err instanceof AuthError) && (err.status === 0 || err.status >= 500);

const parseFile = (file) => {
  try { return JSON.parse(new TextDecoder().decode(file.bytes)); } catch { return undefined; }
};

// { site, access, keys }: each { sha, bytes }, or null when the file does not exist (or undefined when `tolerant`
// and fetching it failed).
async function fetchFiles(gh, tolerant = false) {
  const got = await Promise.all(CHECKED.map((k) => {
    const file = Promise.resolve().then(() => gh.getFile(PATHS[k]));
    return tolerant ? file.catch(() => undefined) : file;
  }));
  return Object.fromEntries(CHECKED.map((k, i) => [k, got[i]]));
}

function siteUrl(site) {
  const domain = site?.site?.domain;
  return typeof domain === 'string' && domain.trim() ? `https://${domain.trim()}/` : null;
}

// Revoke = rotate (spec 12): a new vault key for everything kept, the revoked entries dropped. The code of every kept
// download entry is read from its meta with the current vault key; one that cannot be read stops the publish, so a
// rotation never silently locks a hirer out. Codes are added to `secrets` so no message can carry them.
async function rotateDraft(draft, session, secrets) {
  const vk = await importKey(session.vk);
  const kek = await importKey(session.kek);
  const entries = draft.access?.entries ?? [];
  const revoked = new Set(draft.revoked ?? []);
  const codesById = {};
  for (const entry of entries) {
    if (entry.kind !== 'download' || revoked.has(entry.id)) continue;
    let meta;
    try {
      meta = await readMeta(entry, vk);
    } catch {
      throw new Error(`Access entry ${entry.id} cannot be read with the current vault key, so its code cannot be kept. Nothing was published.`);
    }
    if (typeof meta?.code === 'string') {
      codesById[entry.id] = meta.code;
      secrets.push(meta.code);
    }
  }
  return rotateVault({
    access: draft.access,
    keys: draft.keys,
    vk,
    kek,
    adminEntryId: session.entryId,
    codesById,
    dropIds: entries.filter((e) => revoked.has(e.id)).map((e) => e.id), // an id no longer in access.json is already gone
  });
}

// Polls the run of `sha` until it completes; a run cancelled because a newer push superseded it is followed on the
// newest head. Resolves the completed run, or null after `maxPolls` polls.
async function follow(gh, sha, { pollMs, maxPolls }) {
  let target = sha;
  for (let poll = 0; poll < maxPolls; poll += 1) {
    await sleep(pollMs);
    try {
      const run = await gh.latestRun(target);
      if (!run || run.status !== 'completed') continue;
      if (run.conclusion !== 'cancelled') return run;
      const { sha: newest } = await gh.getHead();
      if (newest === target) return run;              // cancelled by hand: nothing newer to follow
      target = newest;
    } catch (err) {
      if (!transient(err)) throw err;
    }
  }
  return null;
}

// The base of the next draft: the three files as they are now on the branch, so their shas and contents agree.
// A file that cannot be fetched or parsed falls back to what was committed, with sha null (the next publish then
// reports a conflict on it instead of overwriting blindly).
async function newBase(gh, sha, working) {
  const fetched = await fetchFiles(gh, true);
  const base = { commit: sha, shas: {} };
  for (const k of CHECKED) {
    const parsed = fetched[k] ? parseFile(fetched[k]) : undefined;
    base[k] = parsed === undefined ? working[k] : parsed;
    base.shas[k] = parsed === undefined ? null : fetched[k].sha;
  }
  return base;
}

/* ─── PUBLISH ─── */

/**
 * Publishes the store's draft (spec 13.6). Options:
 *   store       the draft store (state.mjs), already init()ed
 *   gh          the GitHub client (github.mjs)
 *   fileStore   the pending-file store (files.mjs) holding the ciphertext of every pending file
 *   session     { vk, kek, entryId } — base64 vault key, base64 KEK of the admin code, the admin entry id
 *   icons       the icon map (render/icons.mjs) the validator checks service icons against
 *   onProgress  (step, info) => void; steps: validating, checking, committing, building { sha }, live { sha, url },
 *               conflict { paths }, failed { sha?, runUrl? | reason: 'timeout' | error }
 *   pollMs      delay before each poll of the run (default 10000); maxPolls (default 90)
 *   storage     the storage the store persists to (default localStorage), cleared of the draft before the rebase
 * Resolves { sha } (plus vk, base64, when the vault key was rotated), { conflict: true, paths } or
 * { failed: true, runUrl | reason | error } (plus vk when a rotation was committed before the failure).
 * Rejects only with PublishValidationError, or with an AuthError raised before the commit reached the branch.
 */
export async function publish({
  store, gh, fileStore, session, icons = defaultIcons, onProgress = () => {},
  pollMs = 10000, maxPolls = 90, storage = browserStorage(),
} = {}) {
  const emit = (step, info) => {
    try { onProgress(step, info); } catch { /* a broken progress display must not break the publish */ }
  };
  const secrets = [session?.vk, session?.kek, session?.github?.token];
  let sha = null;                                     // set once the commit is on the branch
  let vk = null;                                      // the new vault key (base64), once rotated
  const result = (fields) => (sha && vk ? { ...fields, vk } : fields);

  try {
    const draft = store.get();

    emit('validating');
    const errors = validateSite(normalizeSite(draft?.site), { icons: Object.keys(icons) });
    if (errors.length) throw new PublishValidationError(errors);

    // The head is read before the files: if anything is pushed after it, the ref update below fails (a conflict)
    // instead of committing on top of a change the check did not see.
    emit('checking');
    const head = await gh.getHead();
    const remote = await fetchFiles(gh);
    const paths = CHECKED
      .filter((k) => (remote[k]?.sha ?? null) !== (draft.baseShas?.[k] ?? null))
      .map((k) => PATHS[k]);
    if (paths.length) {
      emit('conflict', { paths });
      return { conflict: true, paths };
    }

    let working = draft;
    if (draft.rotate === true || (draft.revoked ?? []).length > 0) {
      const rotated = await rotateDraft(draft, session, secrets);
      working = { ...draft, access: rotated.access, keys: rotated.keys };
      vk = await exportKey(rotated.vk);
      secrets.push(vk);
    }

    emit('committing');
    const pendingIds = (working.pending ?? []).map(idOf);
    const blobs = {};
    for (const id of pendingIds) {
      const bytes = await fileStore.get(id);
      if (bytes) blobs[id] = bytes;
    }
    const { bySection = {} } = store.dirty();
    const dirtySections = Object.keys(bySection).filter((id) => bySection[id] > 0);
    const onBranch = (k) => (remote[k] ? parseFile(remote[k]) : undefined); // the base content: its sha matched
    const commit = buildCommit(working, blobs, dirtySections, { access: onBranch('access'), keys: onBranch('keys') });
    try {
      ({ sha } = await gh.commitFiles({ ...commit, parent: head.sha }));
    } catch (err) {
      if (!(err instanceof ConflictError)) throw err;
      emit('conflict', { paths: ['ref'] });
      return { conflict: true, paths: ['ref'] };
    }

    emit('building', { sha });
    const run = await follow(gh, sha, { pollMs, maxPolls });
    if (!run) {
      emit('failed', { sha, reason: 'timeout' });
      return result({ failed: true, reason: 'timeout' });
    }
    if (run.conclusion !== 'success') {
      emit('failed', { sha, runUrl: run.html_url });
      return result({ failed: true, runUrl: run.html_url });
    }
    emit('live', { sha, url: siteUrl(working.site) });

    // Live: the pending ciphertexts are on GitHub now, and the next draft starts from what was published.
    // Nothing below may turn a live publish into a failure.
    try {
      for (const id of pendingIds) {
        try { await fileStore.delete(id); } catch { /* an orphan in the browser's store is harmless */ }
      }
      const next = await newBase(gh, sha, working);
      store.reset();
      try { storage?.removeItem(DRAFT_KEY); } catch { /* blocked storage: nothing was persisted either */ }
      store.init(next);
      if (store.get()?.baseCommit !== next.commit) store.reset(); // a clean draft persisted elsewhere was loaded
    } catch { /* the draft stays as it was; the next publish reports a conflict and offers to reload */ }
    return vk ? { sha, vk } : { sha };
  } catch (err) {
    if (err instanceof PublishValidationError) throw err;
    if (err instanceof AuthError && !sha) throw err;
    const error = clean(err?.message ?? err, secrets);
    emit('failed', sha ? { sha, error } : { error });
    return result({ failed: true, error });
  }
}
