// The Publish button and everything it shows (spec 13.6): the button state, the read-only dashboard while a publish
// runs, the progress card (bottom right), the validation and conflict modals, the failure card and the load-time
// "newer code" notice. publish.mjs does the work; this file only drives it and shows what happened.
//
// The pure helpers at the top are unit-tested (test/publish-ui.test.mjs); wirePublish below is the DOM glue.
// No text shown here carries a secret: every error passes through publish.mjs's clean() with the session's vault
// key, KEK and token, and links are only ever https URLs.

import { publish, finalizePublished, PublishValidationError, SECTION_LABELS, clean, referencedFileIds } from './publish.mjs';
import { AuthError } from './github.mjs';
import { contentSection, SITE_FIELDS } from './state.mjs';
import { loadBase } from './shell.mjs';
import { el, modal, toast, flushPending } from './ui.mjs';

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
 *   dirty  store.dirty().total     busy  a publish (or a reload for one) is running
 * Enabled when a section is dirty or files or codes wait: pending, deleted, revoked, or a rotation asked for.
 */
export function buttonState(draft, { dirty = 0, busy = false } = {}) {
  if (busy) return { enabled: false, reason: 'A publish is running', label: 'Publishing…' };
  const waiting = (list) => Array.isArray(list) && list.length > 0;
  const something = Boolean(draft) && (dirty > 0 || waiting(draft.pending) || waiting(draft.deleted)
    || waiting(draft.revoked) || draft.rotate === true);
  return something ? { enabled: true, reason: '', label: 'Publish' } : { enabled: false, reason: 'Nothing to publish', label: 'Publish' };
}

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

/**
 * The draft rebased on newer content from GitHub (the conflict modal's "Reload and reapply", and with keepSite its
 * "Overwrite with my draft"). Pure; returns copies.
 *   draft          the store's draft
 *   remote         { site, access, keys } as they are on GitHub now (a loadBase() result)
 *   dirtySections  the section ids with changes (store.dirty().bySection)
 *   keepSite       keep the draft's whole site (overwrite) instead of merging it by section
 * Returns { site, access, keys, pending, deleted, revoked: [], rotate: false, dropped, vaultChanged, discardedAccess }:
 *   site      per top-level key: a dirty section keeps the draft's value, any other key takes the remote's
 *   access    always the remote's, and keys too: a rotation made elsewhere is never clobbered. The draft's new
 *             attachments keep their wrapped keys when the vault key is the same; otherwise (vaultChanged) their
 *             keys are useless, so they leave the site and the draft: `dropped` lists every pending id not kept
 *   deleted   the draft's deleted ids that the merged site no longer references
 *   discardedAccess  the draft had access-code changes (revoke, new codes), now gone
 */
export function mergeDrafts(draft, remote, dirtySections = [], { keepSite = false } = {}) {
  const dirty = new Set(dirtySections);
  const mine = isObj(draft?.site) ? draft.site : {};
  const theirs = isObj(remote?.site) ? remote.site : {};
  let site;
  if (keepSite) {
    site = copy(mine);
  } else {
    site = {};
    const keys = [...Object.keys(theirs), ...Object.keys(mine).filter((k) => !Object.hasOwn(theirs, k))];
    for (const key of keys) {
      if (key === '__proto__') continue;
      const value = key === 'site' ? mergeSiteKey(mine.site, theirs.site, dirty) : copy(dirty.has(contentSection(key)) ? mine[key] : theirs[key]);
      if (value !== undefined) site[key] = value;
    }
  }

  const vaultChanged = !(isObj(draft?.keys) && isObj(remote?.keys) && draft.keys.vk === remote.keys.vk);
  const pendingIds = (draft?.pending ?? []).map(idOf);
  if (vaultChanged && pendingIds.length) site = stripFiles(site, new Set(pendingIds));
  const referenced = referencedFileIds(site);
  const pending = vaultChanged ? [] : (draft?.pending ?? []).filter((p) => referenced.has(idOf(p))).map(copy);
  const kept = new Set(pending.map(idOf));
  const keys = copy(remote?.keys);
  if (isObj(keys) && kept.size) {
    keys.files = { ...(isObj(keys.files) ? keys.files : {}) };
    for (const id of kept) {
      if (draft.keys?.files?.[id] !== undefined) keys.files[id] = copy(draft.keys.files[id]);
    }
  }
  return {
    site,
    access: copy(remote?.access),
    keys,
    pending,
    deleted: (draft?.deleted ?? []).filter((id) => !referenced.has(id)),
    revoked: [],
    rotate: false,
    dropped: pendingIds.filter((id) => !kept.has(id)),
    vaultChanged,
    discardedAccess: dirty.has('access'),
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
 *   store, gh, fileStore, session, icons   as publish() takes them (session: { vk, kek, entryId, github })
 *   onSessionVk(vkB64)   a publish rotated the vault key: the session must take it at once
 *   onPublished()        a publish went live: refresh "published N min ago"
 * Returns { refresh, start, busy() }.
 */
export function wirePublish({ root = document, store, gh, fileStore, session, icons, onSessionVk, onPublished } = {}) {
  if (wired.has(root)) {
    wired.get(root).refresh();
    return wired.get(root);
  }
  const find = (selector) => root.querySelector(selector);
  const button = find('#publishButton');
  const status = find('#status');
  const signOut = find('#signOut');
  const areas = [find('#main'), find('.adm-nav')].filter(Boolean);
  const secrets = () => [session?.vk, session?.kek, session?.github?.token];
  const safe = (message) => clean(message?.message ?? message, secrets());
  let busy = false;
  let note = null;

  function refresh() {
    const draft = store.get();
    const state = buttonState(draft, { dirty: draft ? store.dirty().total : 0, busy });
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

  async function deploySkipped(runId) {
    if (runId === undefined || runId === null) return false;
    try { return isDeploySkipped(await gh.runJobs(runId)); } catch { return false; }
  }

  /* publish */

  async function start() {
    if (busy) return;
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

    let result;
    try {
      result = await publish({ store, gh, fileStore, session, icons, onProgress });
    } catch (err) {
      setBusy(false);
      if (err instanceof PublishValidationError) {
        card.close();
        showValidation(err.errors);
        return;
      }
      if (card.state('save') === 'active') card.line('save', null, 'failed');
      card.fail('Not published', [err instanceof AuthError
        ? `GitHub rejected the token (HTTP ${err.status}). Nothing was published; replacing the token comes with a later update.`
        : `Nothing was published: ${safe(err)}`], { retry: start });
      return;
    }

    if (result.vk) {
      try { onSessionVk?.(result.vk); } catch { /* the committed vault is under the new key whatever happens here */ }
    }

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
    const skipped = await deploySkipped(live?.runId);
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
        el('li', {}, el('b', { text: 'Reload and reapply' }), ' puts your draft on top of the newer content: the sections you changed keep your version, the others take the newer one. You publish afterwards.'),
        el('li', {}, el('b', { text: 'Overwrite with my draft' }), ' publishes your content as it is, now.'),
        el('li', {}, 'Either way, access codes and file keys come from GitHub.')));
    const dialog = modal({
      title: 'Changed on GitHub',
      body,
      actions: [
        { label: 'Cancel' },
        { label: 'Overwrite with my draft', onClick: () => { setTimeout(() => reapply(true), 0); } },
        { label: 'Reload and reapply', primary: true, onClick: () => { setTimeout(() => reapply(false), 0); } },
      ],
    });
    dialog.element.classList.add('adm-modal-wide');
  }

  function confirmApply() {
    return new Promise((resolve) => {
      modal({
        title: 'Reload and reapply',
        body: 'Your draft will be applied on top of the newer content; fields you did not touch take the newer values',
        actions: [
          { label: 'Cancel', onClick: () => resolve(false) },
          { label: 'Apply my draft', primary: true, onClick: () => resolve(true) },
        ],
        onClose: () => resolve(false),
      });
    });
  }

  // Reload and reapply (overwrite = false) or Overwrite with my draft (true, then publish again).
  async function reapply(overwrite) {
    if (busy) return;
    flushPending();
    setBusy(true);
    const card = openCard(overwrite ? 'Publishing' : 'Reloading');
    card.line('reload', 'Reloading from GitHub…', 'active');
    let remote;
    try {
      remote = await loadBase(gh);
    } catch (err) {
      setBusy(false);
      card.line('reload', null, 'failed');
      card.fail('Not reloaded', [`Could not reload from GitHub: ${safe(err)}`], { retry: () => reapply(overwrite) });
      return;
    }
    card.line('reload', 'Reloaded from GitHub', 'done');
    const draft = store.get();
    if (!overwrite && remote.shas.site !== (draft.baseShas?.site ?? null) && !(await confirmApply())) {
      setBusy(false);
      card.close();
      return;
    }

    const merged = mergeDrafts(draft, remote, dirtyIds(), { keepSite: overwrite });
    store.reset(remote);                    // base, access, keys, revoked and rotate from GitHub
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    if (!same(merged.site, remote.site)) store.set(['site'], merged.site);
    if (!same(merged.keys, remote.keys)) store.set(['keys'], merged.keys);
    if (merged.pending.length) store.set(['pending'], merged.pending);
    if (merged.deleted.length) store.set(['deleted'], merged.deleted);
    for (const id of merged.dropped) {
      try { await fileStore.delete(id); } catch { /* an orphan in the browser's store is harmless */ }
    }
    hideNote();
    setBusy(false);
    card.close();

    if (merged.discardedAccess) toast('Access-code changes were discarded because the vault changed on GitHub; redo them', { ms: 12000 });
    if (merged.vaultChanged) {
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
  window.addEventListener('beforeunload', (event) => {
    if (!busy) return;
    event.preventDefault();
    event.returnValue = '';                 // older browsers need it to ask before leaving mid-publish
  });
  refresh();

  // Spec 13.6 pre-flight: a draft based on an older commit than the branch head (code pushed since it was loaded).
  const loadedOn = store.get()?.baseCommit;
  gh.getHead().then(({ sha }) => {
    if (sha && loadedOn && sha !== loadedOn && store.get()?.baseCommit === loadedOn) showNote();
  }).catch(() => { /* the notice is a courtesy; Publish checks for conflicts anyway */ });

  const handle = { refresh, start, busy: () => busy };
  wired.set(root, handle);
  return handle;
}
