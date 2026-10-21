// The Publish button and everything it shows (spec 13.6): the button state, the read-only dashboard while a publish
// runs, the progress card (bottom right), the validation and conflict modals, the failure card and the load-time
// "newer code" notice. publish.mjs does the work; this file only drives it and shows what happened.
//
// The pure helpers at the top are unit-tested (test/publish-ui.test.mjs); wirePublish below is the DOM glue.
// No text shown here carries a secret: every error passes through publish.mjs's clean() with the session's vault
// key, KEK and token, and links are only ever https URLs.

import {
  publish, finalizePublished, PublishValidationError, SECTION_LABELS, SESSION_KEY_MISMATCH, clean, referencedFileIds,
} from './publish.mjs';
import { AuthError } from './github.mjs';
import { contentSection, changedSections, SITE_FIELDS } from './state.mjs';
import { loadBase, PATHS } from './shell.mjs';
import { inflight } from './inflight.mjs';
import { sessionMatchesDraft } from './codes.mjs';
import { el, modal, toast, flushPending } from './ui.mjs';

/** What Publish says instead of publishing when the sign-in does not match the draft's access codes (Task 23b). */
export const SESSION_MISMATCH_TEXT = "Your sign-in no longer matches the draft's access codes. Open Access codes to resume or cancel the admin-code change.";

/* ─── PURE HELPERS ─── */

const STEP_TEXT = Object.freeze({
  validating: 'Checking content…',
  checking: 'Checking for conflicts…',
  committing: 'Saving to GitHub…',
  saved: 'Saved to GitHub',
  building: 'Building pages & PDF',
  skipped: 'Saved and built — deploy is switched off (DEPLOY_FROM_ACTIONS)',
  rotated: 'Access codes updated',
  conflict: 'The site content changed on GitHub since you loaded it (probably a code update).',
});

const hostOf = (url) => {
  try { return new URL(url).host; } catch { return ''; }
};

/** The text of a progress line: the steps of publish() plus saved, skipped and rotated. '' for anything else. */
export function stepLine(step, info = {}) {
  if (step === 'live') {
    const host = info?.url ? hostOf(info.url) : '';
    return host ? `Live on ${host}` : 'Live';
  }
  return Object.hasOwn(STEP_TEXT, step) ? STEP_TEXT[step] : '';
}

/**
 * The Publish button for a draft: { enabled, reason (its tooltip), label }.
 *   dirty     store.dirty().total     busy  a publish (or a reload for one) is running
 *   inflight  the kinds of work still to write to the draft (inflight.mjs): it waits for them
 * Enabled when a section is dirty or files or codes wait: pending, deleted, revoked, or a rotation asked for.
 */
export function buttonState(draft, { dirty = 0, busy = false, inflight: unfinished = [] } = {}) {
  if (busy) return { enabled: false, reason: 'A publish is running', label: 'Publishing…' };
  if (unfinished.length > 0) return { enabled: false, reason: waitText(unfinished), label: 'Publish' };
  const waiting = (list) => Array.isArray(list) && list.length > 0;
  const something = Boolean(draft) && (dirty > 0 || waiting(draft.pending) || waiting(draft.deleted)
    || waiting(draft.revoked) || draft.rotate === true);
  return something ? { enabled: true, reason: '', label: 'Publish' } : { enabled: false, reason: 'Nothing to publish', label: 'Publish' };
}

// The tooltip (and toast) while work is in flight: attachments first, they are the common case.
const waitText = (kinds) => (kinds.includes('attachments') ? 'Wait for attachments to finish' : 'Wait for the access-code change to finish');

/**
 * The section that owns a validator path ("experience.companies[0].name is empty" -> 'experience'), mapped as
 * state.mjs maps the content keys for dirty(); null for a path no section edits (schemaVersion, (root)).
 */
export function sectionForPath(path) {
  const head = String(path ?? '').trim().split(/\s/)[0];
  const [key, field] = head.split(/[.[]/);
  return key ? contentSection(key, field) : null;
}

/** True when the jobs of a run (github.mjs runJobs) show the deploy job skipped: DEPLOY_FROM_ACTIONS is off. */
export function isDeploySkipped(jobs) {
  return Array.isArray(jobs) && jobs.some((job) => job?.name === 'deploy' && job.conclusion === 'skipped');
}

/** The Actions page of the session's repository (the fallback "check the run" link), or null. */
export function actionsUrl(session) {
  const gh = session?.github;
  if (!gh?.owner || !gh?.repo) return null;
  return `https://github.com/${encodeURIComponent(gh.owner)}/${encodeURIComponent(gh.repo)}/actions`;
}

const shortUrl = (href) => String(href).replace(/^https?:\/\//, '');

/**
 * What the progress card says after a failed publish() result: { title, parts, retry }. `parts` are strings and
 * { text, href } links, in reading order; `retry` is true when nothing reached GitHub (a Retry button makes sense).
 * The error text is cleaned of tokens and of `secrets`.
 */
export function failureMessage(result, fallbackUrl = null, secrets = []) {
  if (result?.reason === 'timeout') {
    const href = result.runUrl ?? fallbackUrl;
    return {
      title: 'Saved, still building',
      retry: false,
      parts: ['Saved to GitHub; the build is taking longer than expected — check the run: ', href ? { text: shortUrl(href), href } : 'on GitHub'],
    };
  }
  if (result?.runUrl) {
    return {
      title: 'Saved, not live',
      retry: false,
      parts: ['Saved to GitHub, but the build failed. ', { text: 'Open the run', href: result.runUrl }, '. Fix the problem and publish again, or re-run the workflow on GitHub.'],
    };
  }
  if (!result?.sha && result?.error === SESSION_KEY_MISMATCH) {
    return {
      title: 'Not published',
      retry: false,
      parts: [`Nothing was published: ${SESSION_KEY_MISMATCH}. Reload the dashboard: it takes the current keys from the draft, or asks you to sign in again.`],
    };
  }
  const error = clean(result?.error, secrets);
  if (result?.sha) {
    return {
      title: 'Saved, not followed',
      retry: false,
      parts: [`Saved to GitHub, but the build could not be followed (${error}). `, fallbackUrl ? { text: 'Check the run on GitHub', href: fallbackUrl } : 'Check the run on GitHub', '.'],
    };
  }
  return { title: 'Not published', retry: true, parts: [`Nothing was published: ${error}`] };
}

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const copy = (x) => (x === undefined ? undefined : structuredClone(x));
const idOf = (pending) => (typeof pending === 'string' ? pending : pending?.id);

// A copy of `node` without the file records whose id is in `ids` (in every `files` array).
function stripFiles(node, ids) {
  if (Array.isArray(node)) return node.map((item) => stripFiles(item, ids));
  if (!isObj(node)) return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = key === 'files' && Array.isArray(value) ? value.filter((f) => !ids.has(f?.id)) : stripFiles(value, ids);
  }
  return out;
}

// Deep equality for JSON values; object key order does not matter (as state.mjs compares).
function equal(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && equal(a[k], b[k]));
}

// A three-way merge of JSON values. What the owner did not change (mine equals base) takes theirs; what GitHub did not
// change keeps mine; an object changed on both sides merges key by key; anything else changed on both sides keeps
// mine (a list counts as one value). Keys follow theirs, then keys only mine has.
function merge3(base, mine, theirs) {
  if (equal(mine, base)) return copy(theirs);
  if (equal(theirs, base)) return copy(mine);
  if (isObj(base) && isObj(mine) && isObj(theirs)) {
    const out = {};
    for (const key of [...Object.keys(theirs), ...Object.keys(mine).filter((k) => !Object.hasOwn(theirs, k))]) {
      if (key === '__proto__') continue;
      const value = merge3(base[key], mine[key], theirs[key]);
      if (value !== undefined) out[key] = value;
    }
    return out;
  }
  return copy(mine);
}

// The content `site` key: Settings owns it except the fields of other sections (formSubject: Contact page).
function mergeSiteKey(mine, theirs, dirty) {
  const out = copy(dirty.has(contentSection('site')) ? mine : theirs);
  if (!isObj(out)) return out;
  for (const field of SITE_FIELDS) {
    const from = dirty.has(contentSection('site', field)) ? mine : theirs;
    if (isObj(from) && Object.hasOwn(from, field)) out[field] = copy(from[field]);
    else delete out[field];
  }
  return out;
}

// Per top-level key of the content: a dirty section keeps the draft's value, any other key takes the remote's.
function mergeBySection(mine, theirs, dirty) {
  const site = {};
  for (const key of [...Object.keys(theirs), ...Object.keys(mine).filter((k) => !Object.hasOwn(theirs, k))]) {
    if (key === '__proto__') continue;
    const value = key === 'site' ? mergeSiteKey(mine.site, theirs.site, dirty) : copy(dirty.has(contentSection(key)) ? mine[key] : theirs[key]);
    if (value !== undefined) site[key] = value;
  }
  return site;
}

/**
 * What a draft started from: { site, access } as they were at draft.baseCommit. A file whose sha on GitHub still
 * equals the draft's base sha is taken from `remote` (a loadBase() result: { shas, site, access, … }) without a
 * request; the others are read at the base commit (github.mjs getFile(path, ref)). Each is the parsed JSON, null when
 * the file did not exist at that commit, or undefined when it cannot be known (no base commit, the read failed).
 * Never throws.
 */
export async function readDraftBase(gh, draft, remote) {
  const out = {};
  await Promise.all(['site', 'access'].map(async (k) => {
    if ((remote?.shas?.[k] ?? null) === (draft?.baseShas?.[k] ?? null) && remote?.[k] !== undefined) {
      out[k] = remote[k];
      return;
    }
    out[k] = undefined;
    if (!draft?.baseCommit) return;
    try {
      const file = await gh.getFile(PATHS[k], draft.baseCommit);
      out[k] = file ? JSON.parse(new TextDecoder().decode(file.bytes)) : null;
    } catch { /* unknown: the caller falls back to the sections dirty() names */ }
  }));
  return out;
}

/**
 * The draft rebased on newer content from GitHub (the conflict modal's "Reload and reapply", and with keepSite its
 * "Overwrite with my draft"). Pure; returns copies.
 *   draft          the store's draft
 *   remote         { shas, site, access, keys } as they are on GitHub now (a loadBase() result)
 *   dirtySections  the sections the owner changed since the draft's base ('access' for access-code changes)
 *   keepSite       keep the draft's whole site (overwrite)
 *   baseSite       the content the draft started from (readDraftBase): the site is then merged three-way, field by
 *                  field; without it, by section (a dirty section keeps the draft's value, the rest the remote's)
 * Returns { site, access, keys, pending, deleted, revoked, rotate, dropped, vaultChanged, keyChanged, discardedAccess }:
 *   vaultChanged  vault/access.json or vault/keys.json moved on GitHub since the draft's base. Only then do access
 *                 and keys come from GitHub (a rotation made elsewhere is never clobbered) and are the draft's
 *                 revoked and rotate cleared; otherwise the draft keeps all four, as there is nothing to clobber.
 *   keyChanged    the vault key itself differs (keys.vk): the draft's new attachments were wrapped under a key that
 *                 is gone, so they leave the site and the draft. Otherwise they keep their wrapped keys.
 *   dropped       every pending id not kept      deleted  the draft's deleted ids the merged site no longer references
 *   discardedAccess  the vault changed and the owner had access-code changes, which are now gone
 */
export function mergeDrafts(draft, remote, dirtySections = [], { keepSite = false, baseSite } = {}) {
  const dirty = new Set(dirtySections);
  const mine = isObj(draft?.site) ? draft.site : {};
  const theirs = isObj(remote?.site) ? remote.site : {};
  let site;
  if (keepSite) site = copy(mine);
  else if (isObj(baseSite)) site = merge3(baseSite, mine, theirs);
  else site = mergeBySection(mine, theirs, dirty);

  const moved = (k) => (remote?.shas?.[k] ?? null) !== (draft?.baseShas?.[k] ?? null);
  const vaultChanged = moved('access') || moved('keys');
  const keyChanged = vaultChanged && !(isObj(draft?.keys) && isObj(remote?.keys) && draft.keys.vk === remote.keys.vk);
  const pendingIds = (draft?.pending ?? []).map(idOf);
  if (keyChanged && pendingIds.length) site = stripFiles(site, new Set(pendingIds));
  const referenced = referencedFileIds(site);
  const pending = keyChanged ? [] : (draft?.pending ?? []).filter((p) => referenced.has(idOf(p))).map(copy);
  const kept = new Set(pending.map(idOf));
  let keys = copy(draft?.keys);
  if (vaultChanged) {
    keys = copy(remote?.keys);
    if (isObj(keys) && kept.size) {
      keys.files = { ...(isObj(keys.files) ? keys.files : {}) };
      for (const id of kept) {
        if (draft.keys?.files?.[id] !== undefined) keys.files[id] = copy(draft.keys.files[id]);
      }
    }
  }
  return {
    site,
    access: copy(vaultChanged ? remote?.access : draft?.access),
    keys,
    pending,
    deleted: (draft?.deleted ?? []).filter((id) => !referenced.has(id)),
    revoked: vaultChanged ? [] : copy(draft?.revoked ?? []),
    rotate: vaultChanged ? false : draft?.rotate === true,
    dropped: pendingIds.filter((id) => !kept.has(id)),
    vaultChanged,
    keyChanged,
    discardedAccess: vaultChanged && dirty.has('access'),
  };
}

/* ─── THE PROGRESS CARD (bottom right, appended to <body>) ─── */

let currentCard = null;                     // one card at a time: a new publish replaces the last one

// A link only for an https URL (they come from GitHub's API or the site's domain); anything else stays text.
function linkOrText(text, href) {
  if (typeof href === 'string' && /^https:\/\//i.test(href)) {
    return el('a', { href, target: '_blank', rel: 'noopener noreferrer', text });
  }
  return el('span', { text });
}

const MARKS = { done: '✓', failed: '✕', waiting: '…' };

function mark(state) {
  if (state === 'active') return el('span', { class: 'adm-spinner adm-pub-mark', 'aria-hidden': 'true' });
  return el('span', { class: `adm-pub-mark is-${state}`, 'aria-hidden': 'true', text: MARKS[state] ?? '' });
}

function openCard(title) {
  currentCard?.close();
  const titleNode = el('p', { class: 'adm-pub-title', text: title });
  const closeButton = el('button', { type: 'button', class: 'adm-pub-close', 'aria-label': 'Close', hidden: true }, '×');
  const list = el('ol', { class: 'adm-pub-lines' });
  const message = el('div', { class: 'adm-pub-msg', hidden: true });
  const node = el('section', { class: 'adm-pub', role: 'status', 'aria-live': 'polite', 'aria-label': 'Publish' },
    el('div', { class: 'adm-pub-head' }, titleNode, closeButton), list, message);
  const lines = new Map();
  const card = {
    node,
    close() {
      node.remove();
      if (currentCard === card) currentCard = null;
    },
    // A line by key, created on first use: its text (a link when href is an https URL) and its mark
    // (active: spinner, done, failed, waiting). A null text keeps the line's current text and link.
    line(key, text, state, href) {
      let entry = lines.get(key);
      if (!entry) {
        entry = { item: el('li') };
        lines.set(key, entry);
        list.append(entry.item);
      }
      if (text !== null) Object.assign(entry, { text, href });
      entry.state = state;
      entry.item.className = `adm-pub-line is-${state}`;
      entry.item.replaceChildren(linkOrText(entry.text, entry.href), ' ', mark(state));
    },
    state(key) { return lines.get(key)?.state ?? null; },
    finish(text) {
      titleNode.textContent = text;
      closeButton.hidden = false;
    },
    // The end of a publish that did not go live: the title, the message (strings and links) and an optional Retry.
    fail(text, parts, { retry, extra = [] } = {}) {
      card.finish(text);
      message.hidden = false;
      const nodes = [
        el('p', { class: 'adm-pub-text' }, parts.map((p) => (typeof p === 'string' ? p : linkOrText(p.text, p.href)))),
        ...extra.map((t) => el('p', { class: 'adm-pub-text adm-pub-extra', text: t })),
      ];
      if (retry) {
        nodes.push(el('div', { class: 'adm-pub-actions' }, el('button', {
          type: 'button', class: 'adm-btn adm-btn-dark', onclick: () => { card.close(); retry(); },
        }, 'Retry')));
      }
      message.replaceChildren(...nodes);           // (replaceChildren would print a null or an array as text)
    },
  };
  closeButton.addEventListener('click', () => card.close());
  document.body.append(node);
  currentCard = card;
  return card;
}

/* ─── WIRING ─── */

const wired = new WeakMap();                // root -> handle (admin.mjs's loadDraft runs again on Retry)

/**
 * Wires the top bar's Publish button (#publishButton inside `root`) once the draft is loaded. Owns the button's state,
 * the read-only mode while publishing, the progress card and the modals.
 *   store, fileStore, icons   as publish() takes them
 *   getSession(), getGh()     the session ({ vk, ok, kek, entryId, github }) and the GitHub client as they are now: read at
 *                             every click, because a change of the admin code or the token replaces both after wiring
 *                             (admin.mjs's session hook). `session` and `gh` instead fix them for good.
 *   onSessionVk(vk, ok)  a publish rotated the vault key and the owner key (base64): the session must take them at
 *                        once, as soon as the commit is on the branch (publish's onCommitted), not after the build
 *   onPublished()        a publish went live: refresh "published N min ago"
 *   publishFn            publish.mjs's publish(), replaceable in tests
 * Every way into a publish (the button, Retry, Overwrite, Reload and reapply) first checks that the session still
 * matches the draft's access codes (codes.mjs sessionMatchesDraft); if not, nothing starts and a modal sends the owner
 * to Access codes.
 * Returns { refresh, start, reapply(overwrite), busy() }.
 */
export function wirePublish({
  root = document, store, gh, fileStore, session, getSession = () => session, getGh = () => gh, icons, onSessionVk,
  onPublished, publishFn = publish,
} = {}) {
  if (wired.has(root)) {
    wired.get(root).refresh();
    return wired.get(root);
  }
  const find = (selector) => root.querySelector(selector);
  const button = find('#publishButton');
  const status = find('#status');
  const signOut = find('#signOut');
  const areas = [find('#main'), find('.adm-nav')].filter(Boolean);
  const secrets = () => {
    const now = getSession();
    return [now?.vk, now?.ok, now?.kek, now?.github?.token];
  };
  const safe = (message) => clean(message?.message ?? message, secrets());
  let busy = false;
  let note = null;

  function refresh() {
    const draft = store.get();
    const state = buttonState(draft, { dirty: draft ? store.dirty().total : 0, busy, inflight: inflight.kinds() });
    button.disabled = !state.enabled;
    button.textContent = state.label;
    button.title = state.reason;
    if (busy) button.setAttribute('aria-busy', 'true');
    else button.removeAttribute('aria-busy');
  }

  // Read-only while publishing: every store write between the click and the rebase would be lost (or published
  // half). The sections and the nav go inert (no pointer, no keyboard), Sign out is off, and so are pending Undo toasts.
  function setBusy(on) {
    busy = on;
    for (const area of areas) {
      area.classList.toggle('adm-busy', on);
      area.inert = on;
    }
    if (signOut) signOut.disabled = on;
    const undoToasts = document.querySelector('.adm-toasts');
    if (undoToasts) undoToasts.inert = on;
    refresh();
  }

  function showNote() {
    if (note || !status) return;
    const text = 'Newer code on GitHub — your next publish will check for conflicts';
    note = el('p', { class: 'adm-status-note', role: 'note', title: text, text });
    status.after(note);
  }
  function hideNote() {
    note?.remove();
    note = null;
  }

  const dirtyIds = () => {
    const { bySection = {} } = store.dirty();
    return Object.keys(bySection).filter((id) => bySection[id] > 0);
  };

  async function deploySkipped(gh, runId) {
    if (runId === undefined || runId === null) return false;
    try { return isDeploySkipped(await gh.runJobs(runId)); } catch { return false; }
  }

  /* publish */

  // Work still to land in the draft (an attachment being encrypted, an access code being derived) would be lost by the
  // rebase after a publish, or wrapped under a key the publish rotates away: publish and reload wait for it.
  function unfinished() {
    if (inflight.count() === 0) return false;
    toast(`${waitText(inflight.kinds())}, then try again`);
    return true;
  }

  // A session whose admin entry the draft replaced (signed in again with the old code before publishing the change) or
  // does not hold could only fail inside the rotation. Nothing starts; the owner resumes or cancels in Access codes.
  function sessionBlocked() {
    const { ok, reason } = sessionMatchesDraft(store.get(), getSession());
    if (ok) return false;
    const { element } = modal({
      title: 'Not published',
      body: SESSION_MISMATCH_TEXT,
      actions: [
        { label: 'Cancel' },
        { label: 'Open Access codes', primary: true, onClick: () => { location.hash = '#access'; } },
      ],
    });
    element.dataset.reason = reason;
    return true;
  }

  async function start() {
    if (busy || unfinished() || sessionBlocked()) return;
    const session = getSession();           // the session and client of this click, for the whole run
    const gh = getGh();
    flushPending();                         // a keystroke typed just before the click is part of what is published
    setBusy(true);
    const card = openCard('Publishing');
    let live = null;
    const onProgress = (step, info) => {
      if (step === 'validating' || step === 'checking' || step === 'committing') card.line('save', stepLine(step), 'active');
      else if (step === 'building') {
        card.line('save', stepLine('saved'), 'done');
        card.line('build', stepLine('building'), 'active');
      } else if (step === 'live') {
        card.line('build', stepLine('building'), 'done');
        live = info ?? {};
      }
    };

    // A rotation: the session takes the new keys the moment the commit lands, so a reload or a lost connection during
    // the build cannot leave it on keys the vault no longer holds.
    let keysTaken = false;
    const takeKeys = ({ vk, ok } = {}) => {
      if (!vk || keysTaken) return;
      keysTaken = true;
      try { onSessionVk?.(vk, ok); } catch { /* the committed vault is under the new key whatever happens here */ }
    };

    let result;
    try {
      result = await publishFn({ store, gh, fileStore, session, icons, onProgress, onCommitted: takeKeys });
    } catch (err) {
      setBusy(false);
      if (err instanceof PublishValidationError) {
        card.close();
        showValidation(err.errors);
        return;
      }
      if (card.state('save') === 'active') card.line('save', null, 'failed');
      card.fail('Not published', [err instanceof AuthError
        ? `GitHub rejected the token (HTTP ${err.status}). Nothing was published. Replace it in Settings (Replace GitHub token), then publish again.`
        : `Nothing was published: ${safe(err)}`], { retry: start });
      return;
    }

    if (result.vk) takeKeys(result);        // normally done already, when the commit landed

    if (result.conflict) {
      setBusy(false);
      card.close();
      showConflict(result.paths ?? []);
      return;
    }

    if (result.failed) {
      // After the commit the content is saved, failed build or not: the draft starts from it (badge 0).
      let rebased = !result.sha;
      if (result.sha) {
        try {
          await finalizePublished({ store, gh, fileStore, draft: store.get(), sha: result.sha });
          rebased = true;
          hideNote();
        } catch { /* left as it was: the next Publish reports a conflict and offers to reload */ }
        card.line('save', stepLine('saved'), 'done');
        card.line('build', stepLine('building'), result.reason === 'timeout' ? 'waiting' : 'failed');
        if (result.vk) card.line('rotated', stepLine('rotated'), 'done');
      } else {
        for (const key of ['save', 'build']) if (card.state(key) === 'active') card.line(key, null, 'failed');
      }
      setBusy(false);
      const { title, parts, retry } = failureMessage(result, actionsUrl(session), secrets());
      card.fail(title, parts, {
        retry: retry ? start : null,
        extra: rebased ? [] : ['The draft could not be refreshed from GitHub; the next Publish will offer to reload it.'],
      });
      return;
    }

    // live: the draft is already rebased by publish(); say where it went
    const skipped = await deploySkipped(gh, live?.runId);
    if (skipped) card.line('live', stepLine('skipped'), 'done');
    else card.line('live', stepLine('live', live ?? {}), 'done', live?.url ?? undefined);
    if (result.vk) card.line('rotated', stepLine('rotated'), 'done');
    card.finish(skipped ? 'Saved and built' : 'Published');
    hideNote();
    setBusy(false);
    try { onPublished?.(); } catch { /* the status line refreshes itself on its next tick */ }
  }

  /* validation */

  function showValidation(errors) {
    const MAX = 30;
    let dialog = null;
    const items = errors.slice(0, MAX).map((error) => {
      const line = safe(error);
      const id = sectionForPath(error);
      if (!id) return el('li', { class: 'adm-pub-error' }, line);
      return el('li', { class: 'adm-pub-error' }, el('a', {
        href: `#${id}`,
        onclick: (event) => {
          event.preventDefault();
          dialog?.close();
          location.hash = id;
        },
      }, el('span', { class: 'adm-pub-error-section', text: SECTION_LABELS[id] ?? id }), ' ', line));
    });
    const body = el('div', {},
      el('p', { class: 'adm-modal-text', text: 'Nothing was published. Each line opens the section that holds the problem.' }),
      el('ul', { class: 'adm-pub-errors' }, items),
      errors.length > MAX ? el('p', { class: 'adm-pub-more', text: `…and ${errors.length - MAX} more` }) : null);
    dialog = modal({
      title: `Fix ${errors.length} ${errors.length === 1 ? 'problem' : 'problems'} before publishing`,
      body,
      actions: [{ label: 'Close', primary: true }],
    });
    dialog.element.classList.add('adm-modal-wide');
  }

  /* conflict */

  function showConflict(paths) {
    const detail = paths.includes('ref')
      ? 'Someone pushed to the branch while this publish was saving it. Nothing was published.'
      : `Changed on GitHub: ${paths.join(', ')}. Nothing was published.`;
    const body = el('div', {},
      el('p', { class: 'adm-modal-text adm-pub-lead', text: stepLine('conflict') }),
      el('p', { class: 'adm-pub-detail', text: detail }),
      el('ul', { class: 'adm-pub-choices' },
        el('li', {}, el('b', { text: 'Reload and reapply' }), ' puts your draft on top of the newer content: what you changed keeps your version, everything else takes the newer one. You publish afterwards.'),
        el('li', {}, el('b', { text: 'Overwrite with my draft' }), ' publishes your content as it is, now.'),
        el('li', {}, 'Your access-code changes stay, unless the access codes changed on GitHub too: then GitHub’s win, and you are asked first.')));
    // While an attachment is still being encrypted the choice waits: the modal stays open (onClick returns false).
    const choose = (overwrite) => () => {
      if (unfinished()) return false;
      setTimeout(() => reapply(overwrite), 0);
      return undefined;
    };
    const dialog = modal({
      title: 'Changed on GitHub',
      body,
      actions: [
        { label: 'Cancel' },
        { label: 'Overwrite with my draft', onClick: choose(true) },
        { label: 'Reload and reapply', primary: true, onClick: choose(false) },
      ],
    });
    dialog.element.classList.add('adm-modal-wide');
  }

  // The last word before the draft is rebased: the promise of the merge (Reload) and every warning that applies.
  function confirmApply({ overwrite, siteMoved, notes }) {
    const body = el('div', {},
      !overwrite && siteMoved ? el('p', { class: 'adm-modal-text', text: 'Your draft will be applied on top of the newer content; fields you did not touch take the newer values' }) : null,
      notes.map((text) => el('p', { class: 'adm-pub-warn', text })));
    return new Promise((resolve) => {
      modal({
        title: overwrite ? 'Overwrite with my draft' : 'Reload and reapply',
        body,
        actions: [
          { label: 'Cancel', onClick: () => resolve(false) },
          { label: overwrite ? 'Overwrite and publish' : 'Apply my draft', primary: true, onClick: () => resolve(true) },
        ],
        onClose: () => resolve(false),
      });
    });
  }

  // Reload and reapply (overwrite = false) or Overwrite with my draft (true, then publish again).
  async function reapply(overwrite) {
    if (busy || unfinished() || sessionBlocked()) return;
    const gh = getGh();
    flushPending();
    setBusy(true);
    const card = openCard(overwrite ? 'Publishing' : 'Reloading');
    card.line('reload', 'Reloading from GitHub…', 'active');
    const draft = store.get();
    let remote;
    let base;
    try {
      remote = await loadBase(gh);
      base = await readDraftBase(gh, draft, remote);    // never throws: unknown parts are undefined
    } catch (err) {
      setBusy(false);
      card.line('reload', null, 'failed');
      card.fail('Not reloaded', [`Could not reload from GitHub: ${safe(err)}`], { retry: () => reapply(overwrite) });
      return;
    }
    card.line('reload', 'Reloaded from GitHub', 'done');

    // What the owner changed: compared with the content the draft started from (at its base commit), not with the
    // base loaded at sign-in, which may be newer. When that content cannot be read, dirty() names the sections, and
    // the confirmation lists them, so the owner can cancel.
    const known = isObj(base.site);
    const fallback = dirtyIds();
    const own = known ? changedSections(draft.site, base.site) : fallback.filter((id) => id !== 'access' && id !== 'files');
    const accessOwn = (draft.revoked ?? []).length > 0 || draft.rotate === true
      || (base.access === undefined ? fallback.includes('access') : !equal(draft.access, base.access));
    const merged = mergeDrafts(draft, remote, accessOwn ? [...own, 'access'] : own, { keepSite: overwrite, baseSite: known ? base.site : undefined });

    const siteMoved = (remote.shas?.site ?? null) !== (draft.baseShas?.site ?? null);
    const notes = [];
    if (!overwrite && siteMoved && !known && own.length) {
      notes.push(`The content your draft started from could not be read, so these sections keep your version as a whole: ${own.map((id) => SECTION_LABELS[id] ?? id).join(', ')}. Cancel if one of them should take the newer content.`);
    }
    if (merged.discardedAccess) {
      notes.push('Your access-code changes (revoked or new codes, a changed admin code) will be discarded, because the access codes changed on GitHub. Redo them afterwards.');
    }
    const ask = overwrite ? merged.discardedAccess : siteMoved || merged.discardedAccess;
    if (ask && !(await confirmApply({ overwrite, siteMoved, notes }))) {
      setBusy(false);
      card.close();
      return;
    }

    store.reset(remote);                    // the base and the vault files from GitHub; then the draft's parts back
    if (!equal(merged.site, remote.site)) store.set(['site'], merged.site);
    if (!equal(merged.access, remote.access)) store.set(['access'], merged.access);
    if (!equal(merged.keys, remote.keys)) store.set(['keys'], merged.keys);
    if (merged.pending.length) store.set(['pending'], merged.pending);
    if (merged.deleted.length) store.set(['deleted'], merged.deleted);
    if (merged.revoked.length) store.set(['revoked'], merged.revoked);
    if (merged.rotate) store.set(['rotate'], true);
    for (const id of merged.dropped) {
      try { await fileStore.delete(id); } catch { /* an orphan in the browser's store is harmless */ }
    }
    hideNote();
    setBusy(false);
    card.close();

    if (merged.discardedAccess) toast('Access-code changes were discarded because the vault changed on GitHub; redo them', { ms: 12000 });
    if (merged.keyChanged) {
      toast(`The vault key changed on GitHub${merged.dropped.length ? `, so ${merged.dropped.length} new attachment(s) were removed` : ''}: sign out and sign in again before attaching files or changing access codes`, { ms: 15000 });
    } else if (merged.dropped.length) {
      toast(`${merged.dropped.length} new attachment(s) were removed with the older content: attach them again`, { ms: 12000 });
    }
    if (overwrite) start();
    else toast('Your draft now sits on top of the newer content from GitHub. Check it, then publish.', { ms: 8000 });
  }

  /* wire */

  button.onclick = () => { start(); };
  store.subscribe(refresh);
  inflight.subscribe(refresh);
  window.addEventListener('beforeunload', (event) => {
    if (!busy) return;
    event.preventDefault();
    event.returnValue = '';                 // older browsers need it to ask before leaving mid-publish
  });
  refresh();

  // Spec 13.6 pre-flight: a draft based on an older commit than the branch head (code pushed since it was loaded).
  const loadedOn = store.get()?.baseCommit;
  getGh().getHead().then(({ sha }) => {
    if (sha && loadedOn && sha !== loadedOn && store.get()?.baseCommit === loadedOn) showNote();
  }).catch(() => { /* the notice is a courtesy; Publish checks for conflicts anyway */ });

  const handle = { refresh, start, reapply, busy: () => busy };
  wired.set(root, handle);
  return handle;
}
