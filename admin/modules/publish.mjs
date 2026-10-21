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
import { sessionKeysMatch } from './codes.mjs';

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

/** The failure when the session's vault key or owner key is not the one the draft's admin entry holds (I2). */
export const SESSION_KEY_MISMATCH = 'session vault key does not match the vault';

const MESSAGE = 'Content update from dashboard';
const CHECKED = ['site', 'access', 'keys'];         // the files the conflict check compares (keys of PATHS)
const FILE_ID = /^[0-9a-f]{32}$/;
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
 * Throws Error('missing blob <id>') when a pending file has no bytes in `blobs`, and
 * Error('file both pending and deleted: <id>') when the draft both uploads and deletes the same file.
 */
export function buildCommit(draft, blobs = {}, dirtySections = [], base = null) {
  const rotate = draft.rotate === true;
  const pendingIds = (draft.pending ?? []).map(idOf);
  const both = (draft.deleted ?? []).find((id) => pendingIds.includes(id));
  if (both !== undefined) throw new Error(`file both pending and deleted: ${both}`);
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

/** The ids of every file record in the content: the `files` arrays of the bullets (any `files` array counts). */
export function referencedFileIds(site) {
  const ids = new Set();
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node === null || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'files' && Array.isArray(value)) {
        for (const file of value) if (typeof file?.id === 'string') ids.add(file.id);
      } else {
        walk(value);
      }
    }
  };
  walk(site);
  return ids;
}

// keys.json as it is committed: without the key of a deleted file or of a file no bullet references. Spec 12 promises
// that a removed blob stays under a key only old vault keys can unwrap, so its key must be neither kept nor rewrapped
// by a rotation. The draft keeps such keys until publish so that Undo works.
function prunedKeys(draft) {
  const files = draft.keys?.files;
  if (files === null || typeof files !== 'object') return draft.keys;
  const referenced = referencedFileIds(draft.site);
  const deleted = new Set(draft.deleted ?? []);
  const keep = Object.keys(files).filter((id) => referenced.has(id) && !deleted.has(id));
  if (keep.length === Object.keys(files).length) return draft.keys;
  return { ...draft.keys, files: Object.fromEntries(keep.map((id) => [id, files[id]])) };
}

/* ─── HELPERS ─── */

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * `message` as text that is safe to show: every literal occurrence of the given secrets (strings of 6 or more
 * characters: vault key, KEK, token, codes) becomes [secret], and anything shaped like a GitHub token [token].
 * The publish UI passes every text it shows through it.
 */
export function clean(message, secrets = []) {
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

// Revoke = rotate (spec 12): a new vault key and a new owner key for everything kept, the revoked entries dropped. The
// code of every kept download entry is read from its meta with the current owner key; one that cannot be read stops
// the publish, so a rotation never silently locks a hirer out. Codes are added to `secrets` so no message can carry them.
async function rotateDraft(draft, session, secrets) {
  const vk = await importKey(session.vk);
  const ok = await importKey(session.ok);
  const kek = await importKey(session.kek);
  const entries = draft.access?.entries ?? [];
  const revoked = new Set(draft.revoked ?? []);
  const codesById = {};
  for (const entry of entries) {
    if (entry.kind !== 'download' || revoked.has(entry.id)) continue;
    let meta;
    try {
      meta = await readMeta(entry, ok);
    } catch {
      throw new Error(`Access entry ${entry.id} cannot be read with the current owner key, so its code cannot be kept. Nothing was published.`);
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
    ok,
    kek,
    adminEntryId: session.entryId,
    codesById,
    dropIds: entries.filter((e) => revoked.has(e.id)).map((e) => e.id), // an id no longer in access.json is already gone
  });
}

// Polls the run of `sha` until it completes; a run cancelled because a newer push superseded it is followed on the
// newest head. Resolves { run: the completed run, or null after `maxPolls` polls; seen: the URL of the last run seen }.
async function follow(gh, sha, { pollMs, maxPolls }) {
  let target = sha;
  let seen = null;
  for (let poll = 0; poll < maxPolls; poll += 1) {
    await sleep(pollMs);
    try {
      const run = await gh.latestRun(target);
      if (typeof run?.html_url === 'string') seen = run.html_url;
      if (!run || run.status !== 'completed') continue;
      if (run.conclusion !== 'cancelled') return { run, seen };
      const { sha: newest } = await gh.getHead();
      if (newest === target) return { run, seen };   // cancelled by hand: nothing newer to follow
      target = newest;
    } catch (err) {
      if (!transient(err)) throw err;
    }
  }
  return { run: null, seen };
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

/**
 * Once the commit `sha` is on the branch (live, or a failed or timed-out build: the content is saved either way), the
 * next draft starts from what is on GitHub: the three files are fetched again, the store is reset onto them (the
 * stored draft is dropped, so the badge reads 0), and only THEN are the pending ciphertexts of `draft` deleted. If the
 * rebase fails, the draft that still references them is kept, and so are they.
 *   draft   the draft that was committed (default store.get()); its contents stand in for a file that cannot be fetched
 * Resolves the new base; rejects when the rebase fails. A failing blob delete is ignored (a harmless orphan).
 */
export async function finalizePublished({ store, gh, fileStore, draft = store.get(), sha }) {
  const next = await newBase(gh, sha, draft);
  store.reset(next);
  for (const id of (draft.pending ?? []).map(idOf)) {
    try { await fileStore.delete(id); } catch { /* an orphan in the browser's store is harmless */ }
  }
  return next;
}

/* ─── PUBLISH ─── */

/**
 * Publishes the store's draft (spec 13.6). Options:
 *   store       the draft store (state.mjs), already init()ed
 *   gh          the GitHub client (github.mjs)
 *   fileStore   the pending-file store (files.mjs) holding the ciphertext of every pending file
 *   session     { vk, ok, kek, entryId } — base64 vault key, owner key and KEK of the admin code, the admin entry id
 *   icons       the icon map (render/icons.mjs) the validator checks service icons against
 *   onProgress  (step, info) => void; steps: validating, checking, committing, building { sha },
 *               live { sha, url, runId? }, conflict { paths },
 *               failed { sha?, runUrl? | reason: 'timeout' (+ runUrl when a run was seen) | error }
 *   onCommitted ({ sha, vk?, ok? }) => void, called once, the moment the commit is on the branch (before the build
 *               is followed): with a rotation, the session must take the new keys then, not minutes later
 *   pollMs      delay before each poll of the run (default 10000); maxPolls (default 90)
 * Resolves { sha } (plus vk and ok, base64, when the vault key and owner key were rotated), { conflict: true, paths }
 * or { failed: true, runUrl | reason (+ runUrl) | error }. A failure after the commit reached the branch also carries
 * that commit's `sha` (the content is saved: the caller runs finalizePublished) and `vk` and `ok` when a rotation was
 * committed.
 * After live the draft is already rebased (finalizePublished). After a failure the draft and the blobs are untouched.
 * A session whose vault key or owner key is not the one its admin entry in the draft holds commits nothing: it
 * resolves { failed: true, error: SESSION_KEY_MISMATCH } (an attachment wrapped under a stale key could never be
 * decrypted, and a rotation would fail).
 * Rejects only with PublishValidationError, or with an AuthError raised before the commit reached the branch.
 */
export async function publish({
  store, gh, fileStore, session, icons = defaultIcons, onProgress = () => {}, onCommitted = () => {},
  pollMs = 10000, maxPolls = 90,
} = {}) {
  const emit = (step, info) => {
    try { onProgress(step, info); } catch { /* a broken progress display must not break the publish */ }
  };
  const secrets = [session?.vk, session?.ok, session?.kek, session?.github?.token];
  let sha = null;                                     // set once the commit is on the branch
  let vk = null;                                      // the new vault key (base64), once rotated
  let ok = null;                                      // the new owner key (base64), rotated with it
  const rotatedKeys = () => (vk ? { vk, ok } : {});
  const result = (fields) => (sha ? { ...fields, sha, ...rotatedKeys() } : fields);

  try {
    const draft = store.get();

    emit('validating');
    const errors = validateSite(normalizeSite(draft?.site), { icons: Object.keys(icons) });
    if (errors.length) throw new PublishValidationError(errors);
    if (!(await sessionKeysMatch(draft?.access, session))) {
      emit('failed', { error: SESSION_KEY_MISMATCH });
      return { failed: true, error: SESSION_KEY_MISMATCH };
    }

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

    // The keys of removed files go first, so a rotation never rewraps them.
    let working = { ...draft, keys: prunedKeys(draft) };
    if (draft.rotate === true || (draft.revoked ?? []).length > 0) {
      const rotated = await rotateDraft(working, session, secrets);
      working = { ...working, access: rotated.access, keys: rotated.keys, rotate: true }; // revoked alone rotates too
      vk = await exportKey(rotated.vk);
      ok = await exportKey(rotated.ok);
      secrets.push(vk, ok);
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
    try { onCommitted({ sha, ...rotatedKeys() }); } catch { /* the commit is on the branch whatever happens here */ }

    emit('building', { sha });
    const { run, seen } = await follow(gh, sha, { pollMs, maxPolls });
    if (!run) {
      const timeout = seen ? { reason: 'timeout', runUrl: seen } : { reason: 'timeout' };
      emit('failed', { sha, ...timeout });
      return result({ failed: true, ...timeout });
    }
    if (run.conclusion !== 'success') {
      emit('failed', { sha, runUrl: run.html_url });
      return result({ failed: true, runUrl: run.html_url });
    }
    emit('live', run.id === undefined ? { sha, url: siteUrl(working.site) } : { sha, url: siteUrl(working.site), runId: run.id });

    // Live: the next draft starts from what was published, then the pending ciphertexts (on GitHub now) go.
    // Nothing here may turn a live publish into a failure.
    try {
      await finalizePublished({ store, gh, fileStore, draft: working, sha });
    } catch { /* the draft stays as it was; the next publish reports a conflict and offers to reload */ }
    return { sha, ...rotatedKeys() };
  } catch (err) {
    if (err instanceof PublishValidationError) throw err;
    if (err instanceof AuthError && !sha) throw err;
    const error = clean(err?.message ?? err, secrets);
    emit('failed', sha ? { sha, error } : { error });
    return result({ failed: true, error });
  }
}
