// The dashboard (spec 13): the gate, the shell (top bar, section nav, main area) and the draft loaded from GitHub.
// The sections themselves live in sections/index.mjs; this file routes between them and keeps the top bar current.
//
// Views, chosen by the session and location.hash (render() below):
//   no session, #setup   the setup view (spec 13.2), on its own
//   no session           the gate: the site name and the Access pill, nothing else (spec 13.1)
//   session              the shell; #<section id> picks the section (#setup is for the first run: it goes to #profile)
//
// The session (mk.admin, mk.vault, mk.kek in sessionStorage) is never logged, rendered or put in a URL.

import { mountAccessPill } from '../assets/js/access-pill.mjs';
import { unlock, exportKey } from '../assets/js/vault.mjs';
import { html } from '../assets/js/render/html.mjs';
import { icon } from '../assets/js/render/icons.mjs';
import { openPreview, pageForSection } from './modules/preview.mjs';
import { wirePublish } from './modules/publish-ui.mjs';
import { createGitHub, AuthError } from './modules/github.mjs';
import { createStore } from './modules/state.mjs';
import { createFileStore, createMemoryFileStore } from './modules/files.mjs';
import { toast } from './modules/ui.mjs';
import {
  toSession, readSession, writeSession, clearSession, loadBase, statusText, profileName, routeOf,
} from './modules/shell.mjs';
import { sections, setupSection } from './sections/index.mjs';

const STATUS_TICK_MS = 30000;               // "published 2 min ago" stays current
const SECTION_IDS = sections.map((s) => s.id);
const $ = (id) => document.getElementById(id);

// sessionStorage can be missing or throw (blocked site data); the session then lasts until the page is left.
const sessionStorageOrNull = (() => {
  try { return globalThis.sessionStorage ?? null; } catch { return null; }
})();

let session = readSession(sessionStorageOrNull);
let pillMounted = false;                    // mountAccessPill has no teardown: once per page
let publicName = '';                        // the name on the public home page, until the draft is loaded

// The shell, created after the gate.
let github = null;
let store = null;
let fileStore = null;                       // the attachments waiting for Publish (files.mjs), created with the shell
let load = { state: 'idle' };               // idle | loading | ready | error (+ auth, status, message)
let published;                              // undefined while asking, null when unknown, else an ISO time
let route = null;
let teardown = null;                        // returned by the current section's render()

/* ─── VIEWS ─── */

function show(id) {
  for (const view of ['gate', 'setupView', 'app']) $(view).hidden = view !== id;
}

function render() {
  const next = routeOf(location.hash, SECTION_IDS);
  if (!session) {
    if (next === 'setup') showSetup();
    else showGate();
    return;
  }
  if (next === 'setup') {                   // setup is for the first run only (spec 13.2): signed in, go to the dashboard
    history.replaceState(null, '', '#profile');
    toast('Already signed in');
    return showShell('profile');
  }
  showShell(next);
}

/* ─── GATE ─── */

// The same markup as the hero's pill (assets/js/render/index.mjs), so main.css styles it the same way.
const PILL = html`<div class="hero-contact-link access-pill" id="accessPill" data-state="idle">
  <button type="button" class="access-pill-main" aria-expanded="false">${icon('key', { width: '10', height: '10' })}<span class="access-pill-label">Access</span></button>
  <form class="access-pill-form" hidden autocomplete="off">
    <input type="password" name="code" placeholder="Access code" aria-label="Access code" autocomplete="off" autocapitalize="off" spellcheck="false">
    <button type="submit">Enter</button>
  </form>
</div>`;

function showGate() {
  show('gate');
  leaveSection();                           // leaving #setup empties the wizard's token and code fields
  if (pillMounted) return;
  pillMounted = true;
  $('gatePill').innerHTML = PILL;
  mountAccessPill($('accessPill'), { onSubmit: submitCode });
  $('accessPill').querySelector('.access-pill-main').focus();
}

// The public unlock sequence (assets/js/access.mjs), except that only the admin code opens anything here: a download
// code, a wrong code and every failure answer 'none', and the pill shakes.
async function submitCode(code) {
  let next = null;
  try {
    const res = await fetch('../vault/access.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`vault/access.json returned HTTP ${res.status}`);
    const hit = await unlock(await res.json(), code);
    if (hit?.kind === 'admin') {
      next = toSession({ entryId: hit.entry.id, ...hit.payload, kek: await exportKey(hit.kek) });
    }
  } catch (err) {
    console.warn(`[admin] unlock failed: ${err?.name || 'Error'}`);
    return 'none';
  }
  if (!next) return 'none';
  if (!writeSession(sessionStorageOrNull, next)) console.warn('[admin] the session could not be stored; it lasts until this page is left');
  session = next;
  setTimeout(render, 0);                    // after the pill has taken the result
  return 'admin';
}

/* ─── SETUP (Task 24) ─── */

function showSetup() {
  show('setupView');
  leaveSection();
  mountSection(setupSection, $('setupView'), null);
}

/* ─── SHELL ─── */

let shellStarted = false;

function showShell(next) {
  if (!shellStarted) startShell();
  show('app');
  if (location.hash !== `#${next}`) history.replaceState(null, '', `#${next}`);
  if (next === route && $('main').firstElementChild) return;
  route = next;
  renderNav();
  renderMain();
}

function startShell() {
  shellStarted = true;
  github = createGitHub(session.github);
  store = createStore();
  fileStore = openFileStore();
  store.subscribe(() => {
    renderNav();
    renderStatus();
    renderName();
  });
  $('signOut').addEventListener('click', signOut);
  buildNav();
  renderName();
  renderStatus();
  setInterval(renderStatus, STATUS_TICK_MS);
  loadDraft();
  loadPublished();
}

// IndexedDB keeps attachments until they are published. Without it they live in memory, so a reload loses them.
function openFileStore() {
  let idb;
  try { idb = globalThis.indexedDB; } catch { idb = undefined; }   // the access itself can throw when site data is blocked
  if (idb) return createFileStore({ idb });
  toast('Attachments will not survive a reload in this browser');
  return createMemoryFileStore();
}

// Spec 13.8 and the session ruling: the three keys go, the draft (localStorage) stays; the reload shows the gate.
// The section hash is kept for the next sign-in, except #setup, which would show the setup view instead of the gate.
function signOut() {
  clearSession(sessionStorageOrNull);
  if (location.hash === '#setup') history.replaceState(null, '', location.pathname + location.search);
  location.reload();
}

async function loadDraft() {
  load = { state: 'loading' };
  if (route) renderMain();
  try {
    const base = await loadBase(github);
    load = { state: 'ready' };
    store.init(base);                       // notifies: nav, status and name follow
    $('previewButton').onclick = () => openPreview(store, pageForSection(route));
    $('previewButton').disabled = false;
    wirePublish({
      root: $('app'), store, gh: github, fileStore, session, onPublished: loadPublished,
      onSessionVk: (vk) => { session.vk = vk; writeSession(sessionStorageOrNull, session); }, // a rotation: the new vault key, at once
    });
  } catch (err) {
    load = { state: 'error', auth: err instanceof AuthError, status: err?.status, message: String(err?.message || 'Unknown error') };
  }
  renderMain();
  renderNav();
  renderStatus();
}

async function loadPublished() {
  published = undefined;
  renderStatus();
  try {
    published = (await github.latestSuccessfulRun())?.updated_at ?? null;
  } catch {
    published = null;                       // "Live · —"
  }
  renderStatus();
}

/* top bar */

function renderName() {
  const name = (load.state === 'ready' && profileName(store.get()?.site)) || publicName;
  $('brandName').textContent = name;
  document.title = name ? `${name} · Admin` : 'Admin';
}

function renderStatus() {
  if (!store) return;
  const changes = load.state === 'ready' ? store.dirty().total : null;
  $('status').textContent = statusText({ published, changes });
}

/* nav */

function buildNav() {
  const items = [];
  sections.forEach((section, i) => {
    if (i > 0 && section.group !== sections[i - 1].group) items.push('<li class="adm-nav-sep" role="separator"></li>');
    items.push(html`<li><a class="adm-nav-link" href="#${section.id}" data-id="${section.id}"><span>${section.label}</span><span class="adm-nav-dirty" hidden></span></a></li>`);
  });
  $('nav').innerHTML = items.join('');
}

function renderNav() {
  const bySection = load.state === 'ready' ? store.dirty().bySection : {};
  for (const link of $('nav').querySelectorAll('.adm-nav-link')) {
    const id = link.dataset.id;
    if (id === route) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
    const count = bySection[id] ?? 0;
    const badge = link.querySelector('.adm-nav-dirty');
    badge.hidden = count === 0;
    badge.textContent = count ? String(count) : '';
    badge.title = count ? `${count} unpublished ${count === 1 ? 'change' : 'changes'}` : '';
  }
}

/* main area */

function leaveSection() {
  const done = teardown;
  teardown = null;
  if (typeof done !== 'function') return;
  try { done(); } catch (err) { console.error(err); }
}

// A fresh container per visit, so a section never finds the listeners or markup of the previous one.
function mountSection(section, host, sectionStore) {
  const container = document.createElement('section');
  container.className = 'adm-section';
  container.dataset.section = section.id;
  host.replaceChildren(container);
  try {
    teardown = section.render(container, sectionStore, { github, session, fileStore });
  } catch (err) {
    console.error(err);
    container.innerHTML = html`<div class="adm-card adm-alert" role="alert"><p class="adm-alert-title">This section could not be shown</p><p class="adm-alert-text">${String(err?.message || err)}</p></div>`;
  }
}

function renderMain() {
  const main = $('main');
  leaveSection();
  if (load.state === 'ready') return mountSection(sections.find((s) => s.id === route), main, store);

  if (load.state === 'error' && load.auth) {
    main.innerHTML = html`<div class="adm-section"><div class="adm-card adm-alert" role="alert">
      <p class="adm-alert-title">GitHub rejected the token</p>
      <p class="adm-alert-text">GitHub answered HTTP ${load.status}. Sign out and sign in again; replacing the token comes with a later update.</p>
      <button type="button" class="adm-linkbtn" data-shell="signout">Sign out</button>
    </div></div>`;
    main.querySelector('[data-shell="signout"]').addEventListener('click', signOut);
  } else if (load.state === 'error') {
    main.innerHTML = html`<div class="adm-section"><div class="adm-card adm-alert" role="alert">
      <p class="adm-alert-title">The draft could not be loaded from GitHub</p>
      <p class="adm-alert-text">${load.message}</p>
      <button type="button" class="adm-btn adm-btn-dark" data-shell="retry">Retry</button>
    </div></div>`;
    main.querySelector('[data-shell="retry"]').addEventListener('click', () => {
      loadDraft();
      if (!published) loadPublished();
    });
  } else {
    main.innerHTML = html`<div class="adm-section"><div class="adm-card adm-loading" role="status"><span class="adm-spinner"></span>Loading the draft from GitHub…</div></div>`;
  }
}

/* ─── START ─── */

// The site name for the gate (and the top bar until the draft is in): the Person in the home page's JSON-LD.
async function readPublicName() {
  try {
    const res = await fetch('../index.html');
    if (!res.ok) return '';
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
      const data = JSON.parse(script.textContent);
      if (typeof data?.name === 'string') return data.name;
    }
  } catch { /* decoration only */ }
  return '';
}

readPublicName().then((name) => {
  publicName = name;
  $('gateName').textContent = name;
  if (shellStarted) renderName();
});

window.addEventListener('hashchange', render);
render();
