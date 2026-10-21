// First-run setup (Task 24, spec 13.2 and 12): a three-step wizard that writes the first vault.
//
//   1. GitHub token   a password field, plus owner, repository and branch. "Validate" asks GitHub (GET /repos/{o}/{r});
//                     only an accepted token lets the owner continue.
//   2. Admin code     typed twice, with a strength meter (spec 12: 12 characters, three of four classes) and the
//                     warning that the code protects the token.
//   3. Create vault   one commit, "Initialise vault", holding vault/access.json (the admin entry) and vault/keys.json.
//                     It is refused when the branch already has an admin entry.
//
// The first half of this file is pure and tested in Node (test/setup.test.mjs): buildInitialVault, canInitialise,
// commitInitialVault, codeMeter, scrub, describeFailure, validationMessage. runSetup at the end is the DOM.
//
// Secrets: the token and the codes live in their <input> fields and in the arguments of the calls that use them, and
// nowhere else. Nothing is logged, stored, written into the page as text or put in an address; error text is scrubbed
// of both before it is shown, and the fields are emptied after the commit.

import {
  codeStrength, createAccessFile, createKeysFile, addEntry, generateKey, exportKey, shortId,
} from '../../assets/js/vault.mjs';
import { AuthError, ConflictError, GitHubError } from './github.mjs';
import { el, card, section } from './ui.mjs';

export const DEFAULTS = Object.freeze({ owner: 'mojikone', repo: 'mojtabakeivanlou', branch: 'redesign3_admin' });
export const ACCESS_PATH = 'vault/access.json';
export const KEYS_PATH = 'vault/keys.json';
export const COMMIT_MESSAGE = 'Initialise vault';
export const INITIAL_ITERATIONS = 600000;              // production PBKDF2 cost (spec 12)
export const MIN_CODE_LENGTH = 12;
export const ADMIN_EXISTS_MESSAGE = 'This site already has an admin code. Use Change admin code in the dashboard.';
const CODE_RULE = `The admin code needs at least ${MIN_CODE_LENGTH} characters, using at least 3 of: lowercase, uppercase, digits, symbols.`;
const HIDDEN = '[hidden]';

/* ─── ERRORS ─── */

// A problem the wizard explains in its own words (never carries a secret).
export class SetupError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SetupError';
  }
}

// The branch already has an admin code: nothing is written, and there is nothing to retry.
export class SetupRefusedError extends SetupError {
  constructor() {
    super(ADMIN_EXISTS_MESSAGE);
    this.name = 'SetupRefusedError';
  }
}

/* ─── PURE PARTS ─── */

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const isoDay = (date) => date.toISOString().slice(0, 10);

/**
 * True when setup may write a first vault: the access file is missing, or has no admin entry. `access` is the parsed
 * vault/access.json, or null. Download entries alone do not stop setup (they cannot be opened without an admin code
 * anyway); an admin entry always does.
 */
export function canInitialise(access) {
  const entries = access?.entries;
  return !(Array.isArray(entries) && entries.some((entry) => entry?.kind === 'admin'));
}

/**
 * The first vault: a fresh access file (random salt) with one admin entry for `code`, and an empty keys file.
 * Sealed in the admin entry: the new vault key, the new owner key (it seals every meta, spec 12) and { token, owner,
 * repo, branch }. Its meta is { label: 'Me', created } and never holds the code. Returns { access, keys, entryId };
 * nothing is written anywhere.
 * `created` is a YYYY-MM-DD date (today, UTC, by default). `iterations` is the PBKDF2 cost (tests pass fewer).
 */
export async function buildInitialVault({
  token, code, owner, repo, branch, iterations = INITIAL_ITERATIONS, created,
} = {}) {
  const github = { token: text(token), owner: text(owner), repo: text(repo), branch: text(branch) };
  if (!github.token) throw new SetupError('A GitHub token is required.');
  if (!github.owner) throw new SetupError('The repository owner is required.');
  if (!github.repo) throw new SetupError('The repository name is required.');
  if (!github.branch) throw new SetupError('The branch name is required.');
  const adminCode = text(code);
  if (!codeStrength(adminCode).ok) throw new SetupError(CODE_RULE);

  const vk = await generateKey();
  const ok = await generateKey();
  const access = await addEntry(createAccessFile(iterations), {
    kind: 'admin',
    code: adminCode,
    payload: { vk: await exportKey(vk), ok: await exportKey(ok), github },
    meta: { label: 'Me', created: created ?? isoDay(new Date()) },
  }, ok);
  return { access, keys: createKeysFile(shortId()), entryId: access.entries[access.entries.length - 1].id };
}

// vault/access.json as the branch has it: the parsed file, or null when there is none.
async function readAccess(gh) {
  const file = await gh.getFile(ACCESS_PATH);
  if (!file) return null;
  try {
    return JSON.parse(new TextDecoder().decode(file.bytes));
  } catch {
    throw new SetupError(`${ACCESS_PATH} exists on the branch but is not valid JSON, so setup will not overwrite it. Repair or remove it in the repository first.`);
  }
}

const asFile = (value) => new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);

/**
 * The whole write, against any client shaped like admin/modules/github.mjs (getFile, getHead, commitFiles):
 *   fetch the branch's access file -> refuse (SetupRefusedError) if it has an admin entry -> build the vault ->
 *   look up the head -> commit both files in one commit on top of it.
 * `fetchAccess(gh)` may replace the lookup (it returns the parsed access file or null). `now()` dates the entry.
 * GitHub errors pass through unchanged. Returns { sha, entryId }; no secret is returned.
 */
export async function commitInitialVault({
  gh, token, code, owner, repo, branch, iterations, fetchAccess = readAccess, now,
}) {
  const existing = await fetchAccess(gh);
  if (!canInitialise(existing)) throw new SetupRefusedError();

  const { access, keys, entryId } = await buildInitialVault({
    token, code, owner, repo, branch, iterations, created: now ? isoDay(now()) : undefined,
  });
  const head = await gh.getHead();
  const { sha } = await gh.commitFiles({
    message: COMMIT_MESSAGE,
    files: [{ path: ACCESS_PATH, bytes: asFile(access) }, { path: KEYS_PATH, bytes: asFile(keys) }],
    deletes: [],
    parent: head.sha,
  });
  return { sha, entryId };
}

/**
 * The strength meter for the admin code (spec 12: at least 12 characters from at least 3 of 4 classes), judged on the
 * trimmed code because unlock trims what is typed. level runs 0..1 and is 1 exactly when the code is acceptable.
 */
export function codeMeter(code) {
  const { ok, length, classes } = codeStrength(text(code));
  if (ok) return { ok, length, classes, level: 1, message: 'Strong enough.' };
  if (length === 0) {
    return { ok, length, classes, level: 0, message: `At least ${MIN_CODE_LENGTH} characters, using at least 3 of: lowercase, uppercase, digits, symbols.` };
  }
  const missing = MIN_CODE_LENGTH - length;
  const parts = [];
  if (missing > 0) parts.push(`${missing} more character${missing === 1 ? '' : 's'}`);
  if (classes < 3) parts.push(`at least 3 of: lowercase, uppercase, digits, symbols (${classes} so far)`);
  const level = Math.min(length / MIN_CODE_LENGTH, 1) * Math.min(classes / 3, 1);
  return { ok, length, classes, level, message: `Needs ${parts.join(' and ')}.` };
}

/** `message` with every secret replaced by "[hidden]" (longest first, so a secret inside another goes whole). */
export function scrub(message, secrets = []) {
  let out = message === undefined || message === null ? '' : String(message);
  const list = secrets.filter((s) => typeof s === 'string' && s !== '').sort((a, b) => b.length - a.length);
  for (const secret of list) out = out.split(secret).join(HIDDEN);
  return out;
}

/** What the owner reads when the token check answers { ok, status } (status 0: GitHub could not be reached). */
export function validationMessage({ ok, status }, { owner, repo }) {
  if (ok) return `Token accepted: GitHub shows ${owner}/${repo} with it.`;
  if (status === 401 || status === 403) {
    return `GitHub rejected the token (HTTP ${status}). Check that it is pasted completely and has not expired.`;
  }
  if (status === 404) {
    return `GitHub cannot find ${owner}/${repo} with this token. Check the owner and repository names, and that the token has access to that repository.`;
  }
  if (!status) return 'Could not reach GitHub. Check the connection and try again.';
  return `GitHub answered HTTP ${status}. Try again in a moment.`;
}

/** A sentence for a failed write, free of the secrets in `secrets`. */
export function describeFailure(err, secrets = []) {
  if (err instanceof AuthError) {
    return `GitHub rejected the token (HTTP ${err.status}). Go back to step 1 and check the token, its access to this repository and its Contents (read and write) permission.`;
  }
  if (err instanceof ConflictError) {
    return 'The branch changed while the vault was being written, so nothing was committed. Try again.';
  }
  if (err instanceof GitHubError) {
    const hint = err.status === 404 ? ' Check the owner, repository and branch names.' : '';
    return `${scrub(err.message, secrets)}${hint}`;
  }
  if (err instanceof Error && err.message) return scrub(err.message, secrets);
  return 'Something went wrong. Nothing was committed.';
}

/* ─── THE WIZARD (DOM) ─── */

let seq = 0;

// A labelled input. The wizard reads `.input.value` when it needs it; secrets are never copied anywhere else.
function textInput({ label, value = '', type = 'text', autocomplete = 'off', hint }) {
  const id = `adm-setup-${++seq}`;
  const input = el('input', {
    id, class: 'adm-input', type, autocomplete, spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off',
    'aria-describedby': hint ? `${id}-hint` : null,
  });
  input.value = value;
  const node = el('div', { class: 'adm-field' },
    el('label', { class: 'adm-label', for: id, text: label }),
    input,
    hint ? el('p', { class: 'adm-hint', id: `${id}-hint`, text: hint }) : null);
  return { node, input };
}

const STEPS = ['GitHub token', 'Admin code', 'Create vault'];

/**
 * Mounts the wizard in `container`. deps = { createGitHub, fetchAccess?, now? }:
 *   createGitHub  admin/modules/github.mjs createGitHub, called with { token, owner, repo, branch }
 *   fetchAccess   optional replacement for the access-file lookup (see commitInitialVault)
 *   now           optional () => Date, for the entry's date
 * Returns a teardown that empties the secret fields.
 */
export function runSetup(container, { createGitHub, fetchAccess, now } = {}) {
  if (typeof createGitHub !== 'function') throw new TypeError('runSetup needs deps.createGitHub');
  let disposed = false;
  let validated = false;
  let validateRun = 0;
  let busy = false;

  /* step 1: token and repository */
  const token = textInput({
    label: 'GitHub token', type: 'password',
    hint: 'A fine-grained personal access token for this one repository, with Contents (read and write) and Actions (read). It is sealed under your admin code and sent only to api.github.com.',
  });
  const owner = textInput({ label: 'Owner', value: DEFAULTS.owner });
  const repo = textInput({ label: 'Repository', value: DEFAULTS.repo });
  const branch = textInput({ label: 'Branch', value: DEFAULTS.branch });
  const validateStatus = el('p', { class: 'adm-setup-status', role: 'status', 'aria-live': 'polite' });
  const validateButton = el('button', { type: 'submit', class: 'adm-btn adm-btn-plain', text: 'Validate' });
  const toCode = el('button', { type: 'button', class: 'adm-btn adm-btn-dark', text: 'Continue', disabled: true });

  /* step 2: the admin code */
  const code = textInput({ label: 'Admin code', type: 'password', autocomplete: 'new-password' });
  const again = textInput({ label: 'Repeat the admin code', type: 'password', autocomplete: 'new-password' });
  const meterBar = el('div', { class: 'adm-meter-bar' });
  const meter = el('div', { class: 'adm-meter', 'aria-hidden': 'true' }, meterBar);
  const meterText = el('p', { class: 'adm-hint adm-meter-text', role: 'status', 'aria-live': 'polite' });
  const matchText = el('p', { class: 'adm-hint adm-setup-match', role: 'status', 'aria-live': 'polite' });
  const backToToken = el('button', { type: 'button', class: 'adm-btn adm-btn-plain', text: 'Back' });
  const toCreate = el('button', { type: 'submit', class: 'adm-btn adm-btn-dark', text: 'Continue', disabled: true });

  /* step 3: write the vault */
  const summary = el('dl', { class: 'adm-setup-summary' });
  const createError = el('div', { class: 'adm-setup-error', role: 'alert', hidden: true });
  const createProgress = el('div', { class: 'adm-loading', role: 'status', hidden: true },
    el('span', { class: 'adm-spinner' }), 'Creating the vault…');
  const backToCode = el('button', { type: 'button', class: 'adm-btn adm-btn-plain', text: 'Back' });
  const create = el('button', { type: 'submit', class: 'adm-btn adm-btn-dark', text: 'Create vault' });

  /* the end states */
  const doneBody = el('p', { class: 'adm-setup-text' });
  const doneTitle = el('h2', { class: 'adm-card-title', tabindex: '-1', text: 'Done — reopen /admin/ and enter your code' });
  const refusedTitle = el('h2', { class: 'adm-card-title', tabindex: '-1', text: 'Setup stopped' });

  const form = (children, onsubmit) => el('form', { class: 'adm-setup-form', autocomplete: 'off', novalidate: true, onsubmit: (e) => { e.preventDefault(); onsubmit(); } }, children);

  const panels = [
    card('1. GitHub token', form([
      token.node,
      el('div', { class: 'adm-grid adm-grid-3' }, owner.node, repo.node, branch.node),
      validateStatus,
      el('div', { class: 'adm-actions-row' }, validateButton, toCode),
    ], () => validate())),
    card('2. Admin code', form([
      el('p', { class: 'adm-card-hint', text: 'You type this code to open the dashboard.' }),
      el('div', { class: 'adm-setup-warn', role: 'note', text: 'This code protects your GitHub token: the token is sealed under it in a public file, so anyone who learns the code can open the token and change your site. Use a code you use nowhere else, and keep a copy somewhere safe, because it cannot be recovered.' }),
      code.node, meter, meterText, again.node, matchText,
      el('div', { class: 'adm-actions-row' }, backToToken, toCreate),
    ], () => { if (!toCreate.disabled) goTo(2); })),
    card('3. Create the vault', form([
      summary,
      el('p', { class: 'adm-card-hint', text: 'This writes vault/access.json and vault/keys.json to the branch in one commit named “Initialise vault”. Both files are encrypted; the token and the code are not stored in plain text anywhere.' }),
      createError, createProgress,
      el('div', { class: 'adm-actions-row' }, backToCode, create),
    ], () => createVault())),
    el('div', { class: 'adm-card adm-setup-done' }, doneTitle, doneBody,
      el('div', { class: 'adm-actions-row' }, el('a', { class: 'adm-btn adm-btn-dark', href: './', text: 'Open the dashboard' }))),
    el('div', { class: 'adm-card adm-alert' }, refusedTitle,
      el('p', { class: 'adm-alert-text', text: ADMIN_EXISTS_MESSAGE }),
      el('a', { class: 'adm-linkbtn', href: './', text: 'Open the dashboard' })),
  ];
  const [PANEL_TOKEN, PANEL_CODE, PANEL_CREATE, PANEL_DONE, PANEL_REFUSED] = panels;

  const stepItems = STEPS.map((label, i) => el('li', { class: 'adm-step' },
    el('span', { class: 'adm-step-n', text: String(i + 1) }), el('span', { text: label })));

  function goTo(step) {
    const target = [PANEL_TOKEN, PANEL_CODE, PANEL_CREATE][step];
    panels.forEach((panel) => { panel.hidden = panel !== target; });
    stepItems.forEach((item, i) => {
      item.classList.toggle('is-done', i < step);
      if (i === step) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
    if (step === 2) renderSummary();
    (step === 0 ? token.input : step === 1 ? code.input : create).focus();
  }

  // An end state: the secret fields are emptied first. Only a finished setup ticks off all three steps.
  function finish(panel, title, { complete }) {
    clearSecrets();
    panels.forEach((p) => { p.hidden = p !== panel; });
    if (complete) stepItems.forEach((item) => { item.classList.add('is-done'); item.removeAttribute('aria-current'); });
    title.focus();
  }

  function clearSecrets() {
    token.input.value = '';
    code.input.value = '';
    again.input.value = '';
    validated = false;
    toCode.disabled = true;
    toCreate.disabled = true;
    renderCode();
  }

  const repoValues = () => ({ owner: text(owner.input.value), repo: text(repo.input.value), branch: text(branch.input.value) });

  function setBusy(on, ...controls) {
    busy = on;
    for (const control of controls) control.disabled = on;
  }

  /* step 1 */

  function invalidate() {
    validateRun += 1;                       // an answer still on its way is for values that no longer stand
    validated = false;
    toCode.disabled = true;
    validateStatus.textContent = '';
    validateStatus.classList.remove('is-ok', 'is-bad');
  }

  async function validate() {
    if (busy) return;
    const target = repoValues();
    if (!text(token.input.value)) {
      validateStatus.classList.add('is-bad');
      validateStatus.textContent = 'Paste the GitHub token first.';
      token.input.focus();
      return;
    }
    if (!target.owner || !target.repo || !target.branch) {
      validateStatus.classList.add('is-bad');
      validateStatus.textContent = 'Owner, repository and branch are all required.';
      return;
    }
    const run = ++validateRun;
    setBusy(true, validateButton);
    validateStatus.classList.remove('is-ok', 'is-bad');
    validateStatus.textContent = 'Checking with GitHub…';
    let result;
    try {
      result = await createGitHub({ token: text(token.input.value), ...target }).validate();
    } catch {
      result = { ok: false, status: 0 };
    }
    setBusy(false, validateButton);
    if (disposed || run !== validateRun) return;
    validated = Boolean(result.ok);
    toCode.disabled = !validated;
    validateStatus.classList.toggle('is-ok', validated);
    validateStatus.classList.toggle('is-bad', !validated);
    validateStatus.textContent = validationMessage(result, target);
    if (validated) toCode.focus();
  }

  for (const part of [token, owner, repo, branch]) part.input.addEventListener('input', invalidate);
  toCode.addEventListener('click', () => { if (validated) goTo(1); });
  backToToken.addEventListener('click', () => goTo(0));

  /* step 2 */

  function renderCode() {
    const result = codeMeter(code.input.value);
    meterBar.style.width = `${Math.round(result.level * 100)}%`;
    meter.dataset.level = result.ok ? 'ok' : result.level >= 0.5 ? 'mid' : 'low';
    meterText.textContent = result.message;
    const typedAgain = again.input.value !== '';
    const same = code.input.value === again.input.value;
    matchText.textContent = !typedAgain ? '' : same ? 'The two codes match.' : 'The two codes do not match yet.';
    matchText.classList.toggle('is-bad', typedAgain && !same);
    toCreate.disabled = !(result.ok && typedAgain && same);
  }

  code.input.addEventListener('input', renderCode);
  again.input.addEventListener('input', renderCode);
  backToCode.addEventListener('click', () => goTo(1));

  /* step 3 */

  function renderSummary() {
    const { owner: o, repo: r, branch: b } = repoValues();
    summary.replaceChildren(
      el('dt', { text: 'Repository' }), el('dd', { text: `${o}/${r}` }),
      el('dt', { text: 'Branch' }), el('dd', { text: b }),
      el('dt', { text: 'GitHub token' }), el('dd', { text: 'accepted, will be sealed under your admin code' }),
      el('dt', { text: 'Admin code' }), el('dd', { text: 'chosen and confirmed' }),
    );
    createError.hidden = true;
  }

  async function createVault() {
    if (busy) return;
    const target = repoValues();
    const secrets = [text(token.input.value), text(code.input.value), code.input.value, token.input.value];
    createError.hidden = true;
    createProgress.hidden = false;
    setBusy(true, create, backToCode);
    try {
      const gh = createGitHub({ token: text(token.input.value), ...target });
      await commitInitialVault({
        gh, token: token.input.value, code: code.input.value, ...target, fetchAccess, now,
      });
      if (disposed) return;
      doneBody.textContent = `The vault is committed to ${target.branch} on ${target.owner}/${target.repo}. `
        + 'The dashboard reads vault/access.json from the site it is served from: if you run it locally, pull the branch and let it rebuild first; if you use the published site, wait for the GitHub Actions run to finish.';
      finish(PANEL_DONE, doneTitle, { complete: true });
    } catch (err) {
      if (disposed) return;
      if (err instanceof SetupRefusedError) {
        finish(PANEL_REFUSED, refusedTitle, { complete: false });
      } else {
        createError.textContent = describeFailure(err, secrets);
        createError.hidden = false;
      }
    } finally {
      createProgress.hidden = true;
      setBusy(false, create, backToCode);
    }
  }

  /* mount */

  container.replaceChildren(
    section('First-run setup', 'Creates the vault that protects your GitHub token and your private downloads. Three steps.'),
    el('ol', { class: 'adm-steps', 'aria-label': 'Setup steps' }, ...stepItems),
    ...panels,
  );
  renderCode();
  goTo(0);

  return () => {
    disposed = true;
    clearSecrets();
  };
}
