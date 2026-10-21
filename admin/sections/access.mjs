// Access codes (spec 13.3, 12): the codes that open the private downloads, a new download code, revoke, and the admin
// code. Every change goes into the draft (admin/modules/codes.mjs); the next publish applies it, and a revoke or an
// admin code change renews the vault key in that same commit.
//
// Secrets on the page: a download code reaches the DOM only when the owner asks for it (Show, or the one-time display
// after it is created) and as the value of the custom-code field he types it into; Copy works without showing it.
// The admin code and the GitHub token only ever sit in password fields, which are emptied once used. Nothing here
// logs, and no code or token goes into a URL.

import { el, card, section, modal, toast } from '../modules/ui.mjs';
import { codeStrength } from '../../assets/js/vault.mjs';
import { createGitHub } from '../modules/github.mjs';
import { inflight } from '../modules/inflight.mjs';
import {
  listCodes, createDownloadCode, revoke, unrevoke, changeAdminCode, isStaleSession, resumeAdminSession,
  cancelAdminChange, applySessionChange, sessionChanged, validateNewToken,
} from '../modules/codes.mjs';
import { grid } from './_common.mjs';

/** Spec 13.3: the revoke confirmation, word for word. */
export const REVOKE_SENTENCE = 'This person will no longer be able to open any file added from now on; files they could already download stay downloadable for them.';

/** Spec 12: the admin code protects the GitHub token. */
export const TOKEN_WARNING = 'Your admin code also protects the GitHub token. If you change the code because it may have leaked, the token has leaked too: revoke it on GitHub and paste a new one below, in this same step.';

const MASK = '••••';

let seq = 0;
const nextId = (prefix) => `${prefix}-${++seq}`;
const asList = (x) => (Array.isArray(x) ? x : []);

export function render(container, store, ctx = {}) {
  // The session as this visit knows it. A change of the admin code updates it here and tells the shell
  // (sessionChanged), which keeps sessionStorage and later visits current. The repaint after it makes sure the
  // notice is judged against the new session (the draft writes before it were painted with the old one).
  let session = ctx.session ?? {};
  const update = (change) => {
    session = applySessionChange(session, change);
    sessionChanged(change);
    paint();
  };
  let alive = true;
  const shown = new Set();                  // download entries whose code the owner chose to show

  const notice = el('div', { class: 'adm-access-notice' });
  const pending = el('p', { class: 'adm-card-hint', hidden: true });
  const table = el('div', { class: 'adm-table-wrap' });
  const adminForm = changeAdminForm(store, () => session, update);
  container.replaceChildren(
    section('Access codes', 'The codes that open the private downloads on the home page. Changes here take effect when you publish.'),
    notice,
    card('Codes', [pending, table]),
    newCodeCard(store, () => session),
    adminForm.node,
  );

  let turn = 0;
  async function paint() {
    const mine = ++turn;
    const draft = store.get();
    let rows = null;
    try { rows = await listCodes(draft, session.ok); } catch { rows = null; }
    if (!alive || mine !== turn) return;     // left, or a newer paint is on its way
    paintNotice(draft);
    const revoked = asList(draft.revoked).length;
    pending.hidden = !(revoked || draft.rotate === true);
    pending.textContent = revoked
      ? 'Struck-through codes stop working when you publish; the vault key is renewed then.'
      : 'The vault key is renewed when you publish.';
    table.replaceChildren(rows ? codesTable(rows) : el('p', { class: 'adm-form-error', text: "The access codes cannot be read with this session's keys. Sign out and sign in again." }));
  }

  function codesTable(rows) {
    return el('table', { class: 'adm-table adm-codes' },
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col', text: 'Label' }), el('th', { scope: 'col', text: 'Kind' }), el('th', { scope: 'col', text: 'Code' }),
        el('th', { scope: 'col', text: 'Created' }), el('th', { scope: 'col' }, el('span', { class: 'adm-sr', text: 'Actions' })))),
      el('tbody', {}, rows.map((row) => codeRow(row))));
  }

  function codeRow(row) {
    const admin = row.kind === 'admin';
    const label = row.unreadable ? '(cannot be read)' : row.label || '(no label)';
    const status = row.revoked ? el('span', { class: 'adm-badge is-warn', text: admin ? 'replaced at publish' : 'revoked at publish' }) : null;
    return el('tr', { class: row.revoked ? 'is-revoked' : null },
      el('td', {}, el('span', { class: 'adm-strike', text: label }), status ? ' ' : null, status),
      el('td', { text: admin ? 'Admin' : 'Download' }),
      el('td', {}, codeCell(row)),
      el('td', { class: 'adm-nowrap', text: row.created || '—' }),
      el('td', { class: 'adm-row-acts' }, actions(row, label)));
  }

  function codeCell(row) {
    if (row.kind === 'admin' || typeof row.code !== 'string') {
      return el('code', { class: 'adm-code', text: MASK, title: row.kind === 'admin' ? 'The admin code is never stored' : null });
    }
    const visible = shown.has(row.id);
    return el('span', { class: 'adm-code-cell' },
      el('code', { class: 'adm-code adm-strike', text: visible ? row.code : MASK }),
      el('button', {
        type: 'button', class: 'adm-linkbtn', 'aria-pressed': String(visible), 'aria-label': `${visible ? 'Hide' : 'Show'} the code of ${row.label}`,
        onclick: () => { if (visible) shown.delete(row.id); else shown.add(row.id); paint(); },
      }, visible ? 'Hide' : 'Show'),
      el('button', { type: 'button', class: 'adm-linkbtn', 'aria-label': `Copy the code of ${row.label}`, onclick: () => copy(row.code) }, 'Copy'));
  }

  function actions(row, label) {
    if (row.kind === 'admin') {
      return row.revoked ? null : el('button', { type: 'button', class: 'adm-linkbtn', onclick: () => adminForm.focus() }, 'Change');
    }
    if (row.revoked) {
      return el('button', { type: 'button', class: 'adm-linkbtn', onclick: () => attempt(() => unrevoke(store, row.id)) }, 'Undo revoke');
    }
    return el('button', {
      type: 'button', class: 'adm-linkbtn adm-linkbtn-danger', 'aria-label': `Revoke the code of ${label}`,
      onclick: () => confirmRevoke(row, label),
    }, 'Revoke');
  }

  function confirmRevoke(row, label) {
    modal({
      title: `Revoke the code for ${label}?`,
      body: el('div', {},
        el('p', { class: 'adm-modal-text', text: REVOKE_SENTENCE }),
        el('p', { class: 'adm-modal-text adm-modal-note', text: 'The code stops working when you publish.' })),
      actions: [
        { label: 'Cancel' },
        { label: 'Revoke', primary: true, onClick: () => attempt(() => revoke(store, row.id)) },
      ],
    });
  }

  // A session that signed in with the admin code the draft replaces (or whose admin entry the draft lost) cannot
  // publish the draft: say so, and offer the way out.
  function paintNotice(draft) {
    const entries = asList(draft.access?.entries);
    if (isStaleSession(draft, session)) {
      if (!notice.querySelector('[data-notice="stale"]')) notice.replaceChildren(staleNotice());
    } else if (entries.length > 0 && !entries.some((e) => e.id === session.entryId && e.kind === 'admin')) {
      if (!notice.querySelector('[data-notice="missing"]')) {
        notice.replaceChildren(el('div', { class: 'adm-card adm-alert', role: 'alert', dataset: { notice: 'missing' } },
          el('p', { class: 'adm-alert-title', text: "This session's admin code is not in the draft" }),
          el('p', { class: 'adm-alert-text', text: 'The draft was probably reset after an admin code change. Sign out and sign in again with your current admin code before you publish.' })));
      }
    } else {
      notice.replaceChildren();
    }
  }

  function staleNotice() {
    const code = passwordField('New admin code', 'new-password');
    const error = formError();
    const go = el('button', { type: 'button', class: 'adm-btn adm-btn-dark' }, 'Continue');
    go.addEventListener('click', async () => {
      error.hidden = true;
      go.disabled = true;
      try {
        const found = await resumeAdminSession(store.get(), code.control.value);
        if (!found) throw new Error('That is not the new admin code.');
        code.control.value = '';
        update(found);
        toast('Signed in with the new admin code for this draft.');
      } catch (err) {
        showError(error, err);
      } finally {
        go.disabled = false;
      }
    });
    const cancel = el('button', {
      type: 'button', class: 'adm-btn adm-btn-plain',
      onclick: () => attempt(() => { cancelAdminChange(store, session); toast('Admin code change cancelled: your current code stays.'); }),
    }, 'Cancel the change');
    return el('div', { class: 'adm-card adm-alert', role: 'alert', dataset: { notice: 'stale' } },
      el('p', { class: 'adm-alert-title', text: 'This draft changes the admin code' }),
      el('p', { class: 'adm-alert-text', text: 'You signed in with the code it replaces (the new code works only once it is published). Enter the new admin code to publish the change, or cancel the change.' }),
      code.node, error, el('div', { class: 'adm-actions-row' }, go, cancel));
  }

  const unsubscribe = store.subscribe(() => paint());
  paint();
  return () => {
    alive = false;
    unsubscribe();
  };
}

/* ─── NEW DOWNLOAD CODE ─── */

function newCodeCard(store, getSession) {
  const label = textField('Label', { hint: 'Who the code is for, for example "Hirer — Acme". Only you see it.' });
  const custom = textField('Custom code (optional)', { hint: 'Leave empty for a generated code (MK-XXXX-XXXX). A code of your own needs at least 8 characters.', code: true });
  const create = el('button', { type: 'button', class: 'adm-btn adm-btn-dark' }, 'Create code');
  const error = formError();
  const result = el('div', { class: 'adm-new-code', hidden: true });

  async function submit() {
    error.hidden = true;
    create.disabled = true;
    create.textContent = 'Creating…';
    const done = inflight.begin('codes');   // Publish waits for the new entry (inflight.mjs)
    try {
      const name = label.control.value.trim();
      const code = await createDownloadCode(store, getSession(), { label: name, code: custom.control.value });
      label.control.value = '';
      custom.control.value = '';
      showResult(name, code);
    } catch (err) {
      showError(error, err);
    } finally {
      done();
      create.disabled = false;
      create.textContent = 'Create code';
    }
  }

  // The one-time display: the code in a read-only field to copy, until Done or until the owner leaves the section.
  function showResult(name, code) {
    const id = nextId('adm-code');
    const value = el('input', { id, class: 'adm-input adm-code-input', readOnly: true, value: code, spellcheck: 'false', autocomplete: 'off' });
    const done = el('button', { type: 'button', class: 'adm-linkbtn', onclick: () => { result.hidden = true; result.replaceChildren(); label.control.focus(); } }, 'Done');
    result.replaceChildren(
      el('label', { class: 'adm-label', for: id, text: `Code for ${name}` }),
      el('div', { class: 'adm-code-line' }, value,
        el('button', { type: 'button', class: 'adm-btn adm-btn-plain', onclick: () => copy(code, value) }, 'Copy'), done),
      el('p', { class: 'adm-hint', text: 'Send it to them yourself. It opens the downloads once you publish; you can show or copy it again from the table.' }));
    result.hidden = false;
    value.focus();
    value.select();
  }

  create.addEventListener('click', submit);
  for (const input of [label.control, custom.control]) {
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  }
  return card('New download code', [
    el('p', { class: 'adm-card-hint', text: 'Give one code per person, so you can revoke it on its own later.' }),
    grid([label.node, custom.node]),
    error,
    el('div', { class: 'adm-actions-row' }, create),
    result,
  ]);
}

/* ─── CHANGE ADMIN CODE ─── */

function changeAdminForm(store, getSession, update) {
  const current = passwordField('Current admin code', 'current-password');
  const next = passwordField('New admin code', 'new-password');
  const again = passwordField('New admin code, again', 'new-password');
  const token = passwordField('New GitHub token (optional)', 'off', 'Leave empty to keep the current token.');
  const meter = strengthMeter();
  next.control.addEventListener('input', () => meter.update(next.control.value));
  const submit = el('button', { type: 'button', class: 'adm-btn adm-btn-dark' }, 'Change admin code');
  const error = formError();

  submit.addEventListener('click', async () => {
    error.hidden = true;
    try {
      if (!current.control.value.trim()) throw new Error('Enter the current admin code.');
      if (next.control.value !== again.control.value) throw new Error('The two new codes differ.');
      if (!codeStrength(next.control.value.trim()).ok) {
        throw new Error('The new admin code needs at least 12 characters, from at least three of: lower case, upper case, digits, symbols.');
      }
    } catch (err) {
      showError(error, err);
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Changing…';
    const done = inflight.begin('codes');   // Publish waits for the rewrapped admin entry (inflight.mjs)
    try {
      // A new token is checked with GitHub first, as Replace GitHub token does: the dashboard switches to it at once,
      // so a mistyped or under-scoped token would lock the owner out. A refusal changes nothing.
      const newToken = token.control.value.trim();
      if (newToken) {
        const refused = await validateNewToken(createGitHub, getSession(), newToken);
        if (refused) throw new Error(refused);
      }
      const done = await changeAdminCode(store, { currentCode: current.control.value, newCode: next.control.value, newToken }, getSession());
      for (const f of [current, next, again, token]) f.control.value = '';
      meter.update('');
      update(newToken ? { ...done, token: newToken } : done);
      toast('Admin code changed in the draft. Publish to make it take effect; until then your current code still signs you in.');
    } catch (err) {
      showError(error, err);
    } finally {
      done();
      submit.disabled = false;
      submit.textContent = 'Change admin code';
    }
  });

  const node = card('Change admin code', [
    el('p', { class: 'adm-warning', text: TOKEN_WARNING }),
    current.node,
    grid([el('div', {}, next.node, meter.node), again.node]),
    token.node,
    error,
    el('div', { class: 'adm-actions-row' }, submit),
  ]);
  return { node, focus: () => { node.scrollIntoView({ block: 'start' }); current.control.focus(); } };
}

// Spec 12: at least 12 characters from at least three of four kinds.
function strengthMeter() {
  const bar = el('span', { class: 'adm-meter-bar' });
  const text = el('span', { class: 'adm-meter-text', 'aria-live': 'polite' });
  const node = el('div', { class: 'adm-meter', dataset: { level: 'none' } }, el('span', { class: 'adm-meter-track', 'aria-hidden': 'true' }, bar), text);
  function update(value) {
    const { ok, length, classes } = codeStrength(value.trim());
    let level = 'weak';
    let message;
    if (length === 0) {
      level = 'none';
      message = 'At least 12 characters, from at least three of: lower case, upper case, digits, symbols.';
    } else if (length < 12) {
      message = `Too short: ${length} of at least 12 characters.`;
    } else if (!ok) {
      level = 'fair';
      message = `Use at least three kinds of characters (now ${classes}): lower case, upper case, digits, symbols.`;
    } else {
      level = 'strong';
      message = 'Strong enough.';
    }
    const score = Math.min(length, 12) / 12 * 0.6 + Math.min(classes, 3) / 3 * 0.4;
    bar.style.width = `${Math.round(score * 100)}%`;
    node.dataset.level = level;
    text.textContent = message;
  }
  update('');
  return { node, update };
}

/* ─── SMALL PARTS ─── */

function textField(label, { hint, code = false } = {}) {
  const id = nextId('adm-af');
  const control = el('input', {
    id, class: `adm-input${code ? ' adm-code-input' : ''}`, type: 'text', autocomplete: 'off',
    spellcheck: code ? 'false' : 'true', autocapitalize: code ? 'off' : null,
    'aria-describedby': hint ? `${id}-hint` : null,
  });
  return {
    control,
    node: el('div', { class: 'adm-field' }, el('label', { class: 'adm-label', for: id, text: label }), control,
      hint ? el('p', { class: 'adm-hint', id: `${id}-hint`, text: hint }) : null),
  };
}

function passwordField(label, autocomplete, hint) {
  const id = nextId('adm-pw');
  const control = el('input', {
    id, class: 'adm-input', type: 'password', autocomplete, spellcheck: 'false', autocapitalize: 'off',
    'aria-describedby': hint ? `${id}-hint` : null,
  });
  return {
    control,
    node: el('div', { class: 'adm-field' }, el('label', { class: 'adm-label', for: id, text: label }), control,
      hint ? el('p', { class: 'adm-hint', id: `${id}-hint`, text: hint }) : null),
  };
}

const formError = () => el('p', { class: 'adm-form-error', role: 'alert', hidden: true });

function showError(node, err) {
  node.textContent = err?.message || 'Something went wrong.';
  node.hidden = false;
}

// Runs a draft change; a refusal (an error from codes.mjs) shows as a toast.
function attempt(fn) {
  try {
    fn();
  } catch (err) {
    toast(err?.message || 'That did not work.');
  }
}

/** Copies `value` to the clipboard; with no clipboard API, selects `input` (if given) and uses the copy command. */
async function copy(value, input) {
  try {
    await navigator.clipboard.writeText(value);
    toast('Code copied.');
    return;
  } catch { /* no clipboard permission (or an old browser): the selection route below */ }
  let ok = false;
  if (input) {
    input.focus();
    input.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
  }
  toast(ok ? 'Code copied.' : 'Could not copy: show the code and copy it by hand.');
}
