// Settings (spec 13.3): site-wide values (draft.site.site, except formSubject, which the Contact page edits), the SEO
// fields (draft.site.seo), the GitHub repository (read-only) with "Replace GitHub token" (spec 13.7) and the way to
// "Change admin code" (in Access codes), and the draft itself.

import { field, card, el, modal, toast } from '../modules/ui.mjs';
import { linesToArray, arrayToLines, previewContext } from '../modules/forms.mjs';
import { loadBase } from '../modules/shell.mjs';
import { createFileStore } from '../modules/files.mjs';
import { createGitHub } from '../modules/github.mjs';
import { replaceToken, sessionChanged } from '../modules/codes.mjs';
import { formSection, bound, grid, readout } from './_common.mjs';

const SITE = ['site', 'site'];
const SEO = ['site', 'seo'];
const RELOAD_MS = 20000;                    // Reset draft stops waiting for GitHub after this, so its modal can close
const s = (key) => [...SITE, key];
const seo = (key) => [...SEO, key];

export function render(container, store, ctx = {}) {
  return formSection(container, store, {
    title: 'Settings',
    hint: 'Site-wide values, what search engines see, and the draft itself.',
    keys: ['site', 'seo'],
    exclude: ['site.formSubject'],
    build: (view) => [
      siteCard(view),
      seoCard(view),
      githubCard(store, ctx),
      draftCard(store, ctx),
    ],
  });
}

function siteCard(view) {
  const years = readout('Years of experience today');
  view.derive((draft) => {
    const n = previewContext(draft.site).years;
    years.set(typeof n === 'number' ? String(n) : 'needs a valid start date');
  });
  return card('Site', [
    grid([
      bound(view, s('experienceStart'), { label: 'Experience start', type: 'date', hint: '{{years}} counts full years since this date.' }),
      years.node,
    ]),
    bound(view, s('cvPdfFilename'), { label: 'CV PDF file name', hint: 'Every "Download CV" button uses it; it must end in .pdf.' }),
    grid([
      bound(view, s('domain'), { label: 'Domain', hint: '{{domain}}, links and the canonical URLs.' }),
      bound(view, s('gaId'), { label: 'Google Analytics ID', placeholder: 'G-…' }),
    ]),
    bound(view, s('web3formsKey'), { label: 'Web3Forms key', hint: 'The access key the contact form sends with each message.' }),
  ]);
}

function seoCard(view) {
  const terms = readout('Terms');
  view.derive((draft) => {
    const list = draft.site.seo?.knowsAbout;
    terms.set(String(Array.isArray(list) ? list.length : 0));
  });
  const text = (key, label, hint) => bound(view, seo(key), { label, hint });
  const area = (key, label, hint) => bound(view, seo(key), { label, hint, type: 'textarea', rows: 2 });
  return card('Search engines', [
    el('p', { class: 'adm-card-hint', text: 'Placeholders: {{name}}, {{roleTitle}}, {{years}}, {{year}}, {{domain}}.' }),
    el('h3', { class: 'adm-sub', text: 'Page titles' }),
    grid([
      text('titleIndex', 'Home page'),
      text('titleCv', 'CV'),
      text('titleContact', 'Contact page'),
      text('titleThankYou', 'Thank-you page'),
    ]),
    el('h3', { class: 'adm-sub', text: 'Descriptions' }),
    area('descriptionIndex', 'Home page', 'Under the title in search results.'),
    area('ogDescriptionIndex', 'Home page, when shared', 'The preview text of a shared link (Open Graph).'),
    area('descriptionCv', 'CV'),
    area('ogDescriptionCv', 'CV, when shared'),
    area('descriptionContact', 'Contact page'),
    area('descriptionThankYou', 'Thank-you page', 'May stay empty.'),
    area('personDescription', 'About you', 'The description of you in the structured data (JSON-LD).'),
    el('h3', { class: 'adm-sub', text: 'Knows about' }),
    grid([
      field({
        label: 'Topics', type: 'textarea', rows: 10, value: arrayToLines(view.get().site.seo?.knowsAbout),
        hint: 'One per line. Your fields of knowledge in the structured data (JSON-LD knowsAbout).',
        onInput: (v) => view.write.set(seo('knowsAbout'), linesToArray(v)),
      }),
      terms.node,
    ]),
  ]);
}

function githubCard(store, ctx) {
  const gh = ctx.session?.github ?? {};
  const repo = readout('Repository', gh.owner && gh.repo ? `${gh.owner}/${gh.repo}` : '—');
  const branch = readout('Branch', gh.branch || '—');
  return card('GitHub', [
    el('p', { class: 'adm-card-hint', text: 'Where Publish commits. Set during the first-run setup.' }),
    grid([repo.node, branch.node]),
    el('div', { class: 'adm-actions-row' },
      el('button', { type: 'button', class: 'adm-btn adm-btn-plain', onclick: () => tokenModal(store, ctx) }, 'Replace GitHub token'),
      el('a', { class: 'adm-btn adm-btn-plain', href: '#access' }, 'Change admin code')),
  ]);
}

// Spec 13.7: a new fine-grained token, checked against the repository, sealed into the draft's admin entry
// (replaceToken) and used by the dashboard from now on (sessionChanged tells the shell). The token stays in a
// password field, which is emptied when the modal closes; it is never shown, logged or put in a URL.
function tokenModal(store, ctx) {
  const id = 'adm-new-token';
  const input = el('input', {
    id, class: 'adm-input', type: 'password', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', 'aria-describedby': `${id}-hint`,
  });
  const error = el('p', { class: 'adm-form-error', role: 'alert', hidden: true });
  const fail = (message) => {
    error.textContent = message;
    error.hidden = false;
    return false;                           // keeps the modal open
  };
  async function submit() {
    error.hidden = true;
    const token = input.value.trim();
    const session = ctx.session;
    if (!token) return fail('Paste the new token.');
    if (!session?.kek || !session.github) return fail('This session cannot seal a token. Sign out and sign in again.');
    const check = await createGitHub({ ...session.github, token }).validate();
    if (!check.ok) {
      if (check.status === 0) return fail('GitHub could not be reached to check the token. Try again when you are online.');
      return fail(`GitHub did not accept this token for ${session.github.owner}/${session.github.repo} (HTTP ${check.status}). Check that it covers this repository, with Contents read and write and Actions read.`);
    }
    try {
      await replaceToken(store, session.kek, token);
    } catch (err) {
      return fail(err?.message || 'The token could not be sealed.');
    }
    input.value = '';
    sessionChanged({ token });
    toast('GitHub token replaced. The dashboard uses it from now on, and the next publish saves it, sealed, in the vault.');
    return true;
  }
  const { element } = modal({
    title: 'Replace GitHub token',
    body: el('div', {},
      el('p', { class: 'adm-modal-text', text: 'Create a new fine-grained token on GitHub for this repository (Contents: read and write; Actions: read) and paste it here. Then revoke the old one on GitHub.' }),
      el('div', { class: 'adm-field' },
        el('label', { class: 'adm-label', for: id, text: 'New GitHub token' }),
        input,
        el('p', { class: 'adm-hint', id: `${id}-hint`, text: 'It is sealed under your admin code: nobody else can read it from the vault.' })),
      error),
    actions: [
      { label: 'Cancel' },
      { label: 'Replace token', primary: true, onClick: submit },
    ],
    onClose: () => { input.value = ''; },
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    element.querySelector('.adm-btn-dark')?.click();
  });
  input.focus();
}

function draftCard(store, ctx) {
  const confirm = () => modal({
    title: 'Reset the draft?',
    body: 'Every unpublished change in every section is thrown away, files attached since the last publish too, and the content is loaded again from GitHub. This cannot be undone.',
    actions: [
      { label: 'Cancel' },
      { label: 'Reset draft', primary: true, onClick: () => resetDraft(store, ctx) },
    ],
  });
  return card('Draft', [
    el('p', { class: 'adm-card-hint', text: 'Your edits are kept in this browser until you publish them.' }),
    el('div', { class: 'adm-actions-row' },
      el('button', { type: 'button', class: 'adm-btn adm-btn-danger', onclick: confirm }, 'Reset draft')),
  ]);
}

// Spec 13.4: "Reset draft" discards the draft and reloads from GitHub. Without GitHub, or once RELOAD_MS have passed
// (the GitHub client cannot abort a request, and the modal stays busy until this resolves), it falls back to the base
// loaded at sign-in. Encrypted files waiting for publish are dropped with the draft that referenced them.
async function resetDraft(store, ctx) {
  let note = 'Draft reset: every section shows the content as it is on GitHub.';
  try {
    store.reset(await withTimeout(loadBase(ctx.github), RELOAD_MS));
  } catch {
    store.reset();
    note = 'Draft reset to the content loaded when you signed in: GitHub could not be reached in time for a newer copy.';
  }
  try {
    await (ctx.fileStore ?? createFileStore()).clear();
  } catch { /* no IndexedDB, or nothing stored */ }
  toast(note);
}

// Rejects after `ms` unless `promise` settles first.
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
