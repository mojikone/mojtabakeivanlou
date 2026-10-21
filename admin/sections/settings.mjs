// Settings (spec 13.3): site-wide values (draft.site.site, except formSubject, which the Contact page edits), the SEO
// fields (draft.site.seo), the GitHub repository (read-only) with "Replace GitHub token" and the token's expiry date
// (spec 13.7), the way to "Change admin code" (in Access codes), and the draft itself.

import { field, card, el, modal, toast } from '../modules/ui.mjs';
import { linesToArray, arrayToLines, previewContext } from '../modules/forms.mjs';
import { loadBase, readTokenExpiry, writeTokenExpiry, localStorageOrNull } from '../modules/shell.mjs';
import { createFileStore } from '../modules/files.mjs';
import { replaceToken, sessionChanged } from '../modules/codes.mjs';
import { openTokenModal } from '../modules/token-modal.mjs';
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
    bound(view, s('cvPdfFilename'), { label: 'CV PDF file name', hint: 'Every "Download CV" button uses it; a plain file name (no folder) that ends in .pdf.' }),
    grid([
      bound(view, s('domain'), { label: 'Domain', hint: '{{domain}}, links and the canonical URLs. The host name only (lower case), e.g. example.com.' }),
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
  // Spec 13.7: GitHub does not say when the token expires, so the owner notes the date it showed him. This browser
  // only (localStorage mk.tokenExpires), never the draft or the vault; the top bar warns two weeks ahead.
  const expires = field({
    label: 'Token expires on', type: 'date', value: readTokenExpiry(localStorageOrNull()),
    hint: 'The expiry date GitHub showed when you created the token. Kept in this browser only; the top bar warns you two weeks before.',
    onInput: (value) => {
      writeTokenExpiry(localStorageOrNull(), value);
      ctx.onTokenExpiry?.();
    },
  });
  return card('GitHub', [
    el('p', { class: 'adm-card-hint', text: 'Where Publish commits. Set during the first-run setup.' }),
    grid([repo.node, branch.node]),
    grid([expires]),
    el('div', { class: 'adm-actions-row' },
      el('button', { type: 'button', class: 'adm-btn adm-btn-plain', onclick: () => replaceTokenModal(store, ctx) }, 'Replace GitHub token'),
      el('a', { class: 'adm-btn adm-btn-plain', href: '#access' }, 'Change admin code')),
  ]);
}

// Spec 13.7: a new fine-grained token (the shared modal checks it against the repository), sealed into the draft's
// admin entry (replaceToken) and used by the dashboard from now on (sessionChanged tells the shell).
function replaceTokenModal(store, ctx) {
  openTokenModal({
    session: ctx.session,
    apply: async (token) => {
      await replaceToken(store, ctx.session.kek, token);
      sessionChanged({ token });
      toast('GitHub token replaced. The dashboard uses it from now on, and the next publish saves it, sealed, in the vault.');
    },
  });
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
