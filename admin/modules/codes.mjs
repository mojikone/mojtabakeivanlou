// Access codes, the admin code and the GitHub token (spec 12, 13.3, 13.7), and the attachment helpers of the Files
// section (13.3, 13.9). The dashboard's side of vault/access.json: everything here changes the draft only. Publish
// (publish.mjs) turns `revoked` and `rotate` into a new vault key in one commit: every kept entry re-sealed under it,
// every revoked entry dropped. So a revoked code and a replaced admin code stop working at the next publish, and
// the old admin entry goes in the same rotation that makes the new one current (Task 14).
//
// Browser-safe: relative imports only, no DOM, no Node APIs. Nothing here logs, and no error message carries a
// code, a key or a token.

import {
  unlock, addEntry, readMeta, importKey, exportKey, deriveKek, seal, open, generateDownloadCode, codeStrength,
} from '../../assets/js/vault.mjs';
import { TOTAL_AMBER, TOTAL_RED } from './limits.mjs';

const MIN_CUSTOM = 8;                       // characters of a custom download code
const ADMIN_LABEL = 'Me';                   // the meta label of an admin entry the dashboard makes
const BLOB = /^vault\/files\/([0-9a-f]{32})\.bin$/;
const MK = /^mk-/i;

const STALE_VK = "This session's vault key does not open the draft's access codes. Sign out and sign in again.";
const IN_USE = 'This code is already in use. Choose another one.';
const WEAK_ADMIN = 'The new admin code needs at least 12 characters, from at least three of: lower case, upper case, digits, symbols.';
const CHANGED = 'The access codes changed while this was being prepared. Nothing was changed; try again.';

const asList = (x) => (Array.isArray(x) ? x : []);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const trimmed = (x) => (typeof x === 'string' ? x.trim() : '');
const text = (x) => (typeof x === 'string' ? x : '');
const filled = (x) => typeof x === 'string' && x !== '';
const asKey = async (vk) => (typeof vk === 'string' ? importKey(vk) : vk);
const sealJson = (key, value) => seal(key, new TextEncoder().encode(JSON.stringify(value)));
const openJson = async (key, sealed) => JSON.parse(new TextDecoder().decode(await open(key, sealed)));

/** The local calendar date as YYYY-MM-DD: the "created" date of a code (the vault CLI uses the same). */
export function today(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// The draft's access file without the entries it revokes: what unlocks after the next publish.
function liveAccess(draft) {
  const revoked = new Set(asList(draft?.revoked));
  return { ...draft.access, entries: asList(draft.access?.entries).filter((e) => !revoked.has(e.id)) };
}

// The admin entry `code` opens among the live entries: unlock's { entry, kind, payload, kek }, or null.
async function openAdmin(draft, code) {
  const hit = await unlock(liveAccess(draft), code);
  return hit?.kind === 'admin' ? hit : null;
}

// Writes `next` over the draft's access file, unless it changed since `from` was read (an await in between).
function commitAccess(store, from, next) {
  if (store.get()?.access !== from) throw new Error(CHANGED);
  store.set(['access'], next);
}

/* ─── LIST ─── */

/**
 * One row per access entry: { id, kind, label, created, code? (download entries only), revoked }, plus
 * unreadable: true when `vk` does not open the entry's meta. `vk` is the vault key, a CryptoKey or base64.
 */
export async function listCodes(draft, vk) {
  const key = await asKey(vk);
  const revoked = new Set(asList(draft?.revoked));
  return Promise.all(asList(draft?.access?.entries).map(async (entry) => {
    const row = { id: entry.id, kind: entry.kind, label: '', created: '' };
    try {
      const meta = await readMeta(entry, key);
      row.label = text(meta?.label);
      row.created = text(meta?.created);
      if (entry.kind === 'download' && typeof meta?.code === 'string') row.code = meta.code;
    } catch {
      row.unreadable = true;
    }
    row.revoked = revoked.has(entry.id);
    return row;
  }));
}

/* ─── DOWNLOAD CODES ─── */

/**
 * Adds a download entry to the draft and returns its code: a generated MK-XXXX-XXXX, or `code` when given (trimmed,
 * upper-cased when it looks like MK-..., at least 8 characters, not a code already in use in any case). The payload is
 * exactly { vk } (the vault key, base64); the meta is { label, created, code }.
 */
export async function createDownloadCode(store, vk, { label, code } = {}) {
  const name = trimmed(label);
  if (!name) throw new Error('Give the code a label, for example the name of the person it is for.');
  let value = trimmed(code);
  if (value && MK.test(value)) value = value.toUpperCase();
  if (value && codeStrength(value).length < MIN_CUSTOM) throw new Error(`A custom code needs at least ${MIN_CUSTOM} characters.`);

  const key = await asKey(vk);
  const draft = store.get();
  const { access } = draft;
  const rows = await listCodes(draft, key);
  if (rows.length > 0 && rows.every((r) => r.unreadable)) throw new Error(STALE_VK);
  const taken = new Set(rows.filter((r) => typeof r.code === 'string').map((r) => r.code.toUpperCase()));
  if (value && taken.has(value.toUpperCase())) throw new Error(IN_USE);
  if (!value) do value = generateDownloadCode(); while (taken.has(value));

  let next;
  try {
    next = await addEntry(access, {
      kind: 'download',
      code: value,
      payload: { vk: await exportKey(key) },
      meta: { label: name, created: today(), code: value },
    }, key);
  } catch (err) {
    throw /already in use/.test(err?.message) ? new Error(IN_USE) : err; // the admin code, typed exactly
  }
  commitAccess(store, access, next);
  return value;
}

/* ─── REVOKE ─── */

/** Marks a download entry for revocation at the next publish (spec 12: the vault key is renewed then). */
export function revoke(store, entryId) {
  const draft = store.get();
  const entry = asList(draft?.access?.entries).find((e) => e.id === entryId);
  if (!entry) throw new Error('No access entry with this id');
  if (entry.kind === 'admin') throw new Error('The admin code is not revoked: change it instead');
  const revoked = asList(draft.revoked);
  if (!revoked.includes(entryId)) store.set(['revoked'], [...revoked, entryId]);
  if (store.get().rotate !== true) store.set(['rotate'], true);
}

/**
 * Takes back a revoke before it is published. Once nothing is revoked, `rotate` goes back to false, so an undone
 * revoke leaves nothing to publish. (A token replaced meanwhile is published anyway: its re-sealed admin entry makes
 * access.json differ from the base.) A replaced admin entry is put back with cancelAdminChange, never here.
 */
export function unrevoke(store, entryId) {
  const draft = store.get();
  const revoked = asList(draft?.revoked);
  if (!revoked.includes(entryId)) return;
  const entry = asList(draft.access?.entries).find((e) => e.id === entryId);
  if (entry?.kind === 'admin') throw new Error('A replaced admin code comes back only by cancelling the admin code change');
  const next = revoked.filter((id) => id !== entryId);
  store.set(['revoked'], next);
  if (next.length === 0 && store.get().rotate === true) store.set(['rotate'], false);
}

/* ─── ADMIN CODE ─── */

/**
 * Spec 12 "Change admin code". Checks `currentCode` against the draft's live admin entry and the strength of `newCode`
 * (codeStrength), then adds a new admin entry under the new code with the payload { vk, github } (the GitHub details
 * of the current entry, the token replaced by `newToken` when given) and the meta { label: 'Me', created }. The old
 * admin entry goes into `revoked` and `rotate` is set, so the publish that makes the new code current also drops the
 * old one under a new vault key (the old code could otherwise still open the old key from history).
 * Resolves { kekB64, entryId }: the new code's KEK (base64) and the new entry's id, for the session.
 */
export async function changeAdminCode(store, { currentCode, newCode, newToken } = {}, vk) {
  const code = trimmed(newCode);
  if (!codeStrength(code).ok) throw new Error(WEAK_ADMIN);
  const key = await asKey(vk);
  const draft = store.get();
  const { access } = draft;
  const current = await openAdmin(draft, currentCode);
  if (!current) throw new Error('The current admin code is not right.');
  const vkB64 = await exportKey(key);
  if (current.payload?.vk !== vkB64) throw new Error(STALE_VK);

  const github = { ...current.payload.github, token: trimmed(newToken) || current.payload.github?.token };
  let next;
  try {
    next = await addEntry(access, {
      kind: 'admin',
      code,
      payload: { vk: vkB64, github },
      meta: { label: ADMIN_LABEL, created: today() },
    }, key);
  } catch (err) {
    if (/already in use/.test(err?.message)) throw new Error('The new admin code is already in use: choose one that is neither the current code nor an access code.');
    throw err;
  }
  const entry = next.entries[next.entries.length - 1];
  const kekB64 = await exportKey(await deriveKek(code, access.kdf.salt, access.kdf.iterations));

  commitAccess(store, access, next);
  const revoked = asList(store.get().revoked);
  if (!revoked.includes(current.entry.id)) store.set(['revoked'], [...revoked, current.entry.id]);
  store.set(['rotate'], true);
  return { kekB64, entryId: entry.id };
}

/**
 * True when the session signed in with an admin code that the draft replaces: the code was changed, and the owner
 * signed in again (the gate reads the published vault) before publishing. Publishing then needs the new code
 * (resumeAdminSession) or the change undone (cancelAdminChange).
 */
export function isStaleSession(draft, session) {
  const id = session?.entryId;
  return Boolean(id) && asList(draft?.revoked).includes(id)
    && asList(draft?.access?.entries).some((e) => e.id === id && e.kind === 'admin');
}

/** The session values for the admin code the draft makes current: { kekB64, entryId, token }, or null. */
export async function resumeAdminSession(draft, code) {
  const hit = await openAdmin(draft, code);
  if (!hit) return null;
  return { kekB64: await exportKey(hit.kek), entryId: hit.entry.id, token: hit.payload?.github?.token };
}

/**
 * Undoes the admin code changes of a stale session's draft: the admin entries added since (every admin entry but the
 * session's: a published vault holds one admin entry) leave the draft, and the session's entry is no longer revoked.
 */
export function cancelAdminChange(store, session) {
  const draft = store.get();
  if (!isStaleSession(draft, session)) throw new Error('There is no admin code change to cancel for this session');
  const added = new Set(asList(draft.access.entries).filter((e) => e.kind === 'admin' && e.id !== session.entryId).map((e) => e.id));
  store.set(['access'], { ...draft.access, entries: draft.access.entries.filter((e) => !added.has(e.id)) });
  const revoked = asList(draft.revoked).filter((id) => id !== session.entryId && !added.has(id));
  store.set(['revoked'], revoked);
  if (revoked.length === 0) store.set(['rotate'], false);
}

/* ─── GITHUB TOKEN ─── */

/**
 * Spec 13.7 "Replace GitHub token": re-seals the payload of the admin entry that `kekB64` (the session's KEK) opens,
 * with github.token replaced, and sets `rotate` so the publish re-seals everything consistently. The entry keeps its
 * id and meta.
 */
export async function replaceToken(store, kekB64, token) {
  const value = trimmed(token);
  if (!value) throw new Error('Paste the new GitHub token.');
  const kek = await importKey(kekB64);
  const draft = store.get();
  const { access } = draft;
  const revoked = new Set(asList(draft.revoked));
  for (const entry of asList(access?.entries)) {
    if (entry.kind !== 'admin' || revoked.has(entry.id)) continue;
    let payload;
    try {
      payload = await openJson(kek, { iv: entry.iv, data: entry.data });
    } catch {
      continue;                             // another admin entry
    }
    const { iv, data } = await sealJson(kek, { ...payload, github: { ...payload.github, token: value } });
    commitAccess(store, access, { ...access, entries: access.entries.map((e) => (e.id === entry.id ? { ...e, iv, data } : e)) });
    store.set(['rotate'], true);
    return;
  }
  throw new Error("The admin entry of this session is not in the draft's access codes. Sign out and sign in again.");
}

/* ─── SESSION HOOK ─── */

// The shell (admin.mjs) keeps the session (sessionStorage mk.admin / mk.kek and the GitHub client). After a change of
// the admin code or of the token, the sections call sessionChanged(change); the shell's handler applies it.
const handlers = new Set();

/** Registers fn(change), change = { kekB64?, entryId?, token? }; returns the unsubscribe function. */
export function onSessionChanged(fn) {
  const entry = { fn };
  handlers.add(entry);
  return () => { handlers.delete(entry); };
}

/** Tells every registered handler that the session must change. */
export function sessionChanged(change) {
  for (const { fn } of [...handlers]) fn(change);
}

/** A new session object with `change` applied (kek, entryId, github.token); `session` itself is left as it is. */
export function applySessionChange(session, { kekB64, entryId, token } = {}) {
  const next = { ...session, github: { ...session?.github } };
  if (filled(kekB64)) next.kek = kekB64;
  if (filled(entryId)) next.entryId = entryId;
  if (filled(token)) next.github.token = token;
  return next;
}

/* ─── ATTACHMENTS (Files section) ─── */

/**
 * Every file record of the site, in page order: { file, path (the bullet, draft-rooted, for store.removeFile),
 * index (in the bullet's files), company, project, bullet (its text), bulletIndex }.
 */
export function listAttachments(site) {
  const out = [];
  asList(site?.experience?.companies).forEach((company, ci) => {
    asList(company?.projects).forEach((project, pi) => {
      asList(project?.bullets).forEach((bullet, bi) => {
        asList(bullet?.files).forEach((file, index) => {
          if (!isObj(file)) return;
          out.push({
            file,
            path: ['site', 'experience', 'companies', ci, 'projects', pi, 'bullets', bi],
            index,
            company: text(company.name),
            project: text(project.name),
            bullet: text(bullet.text),
            bulletIndex: bi,
          });
        });
      });
    });
  });
  return out;
}

/** The plaintext size of every attachment of the site, in bytes. */
export function totalAttachmentBytes(site) {
  return listAttachments(site).reduce((sum, { file }) => sum + (Number.isFinite(file.size) && file.size > 0 ? file.size : 0), 0);
}

/** 'ok', 'amber' or 'red': the colour of the Files gauge for `total` bytes (spec 13.9). */
export function budgetLevel(total, { amber = TOTAL_AMBER, red = TOTAL_RED } = {}) {
  if (total >= red) return 'red';
  if (total >= amber) return 'amber';
  return 'ok';
}

/** The ids of the blobs under vault/files/ in `treePaths` (gh.listTree()) that no bullet of `site` references. */
export function orphanBlobs(treePaths, site) {
  const used = new Set(listAttachments(site).map(({ file }) => file.id));
  const ids = [];
  for (const path of asList(treePaths)) {
    const id = BLOB.exec(path)?.[1];
    if (id && !used.has(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
