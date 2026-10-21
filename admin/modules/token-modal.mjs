// "Replace GitHub token" (spec 13.7): the one modal for Settings and for the shell's "GitHub rejected the token" card
// (a 401 or 403 while the draft loads). The new token is checked against the session's repository first
// (codes.mjs validateNewToken), then handed to `apply`, which seals it into the draft and switches the dashboard to it.
// The token stays in a password field, emptied when the modal closes; it is never shown, logged or put in a URL.

import { el, modal } from './ui.mjs';
import { createGitHub } from './github.mjs';
import { validateNewToken } from './codes.mjs';

/**
 * Opens the modal.
 *   session       the signed-in session ({ kek, github }): the token is checked against its repository
 *   apply(token)  async, called once GitHub accepted the token: seal it and use it (and say so). A rejection keeps the
 *                 modal open with the error's message, which must not carry the token.
 *   createClient  github.mjs createGitHub, replaceable
 */
export function openTokenModal({ session, apply, createClient = createGitHub } = {}) {
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
    if (token && !session?.kek) return fail('This session cannot seal a token. Sign out and sign in again.');
    const refused = await validateNewToken(createClient, session, token);
    if (refused) return fail(refused);
    try {
      await apply(token);
    } catch (err) {
      return fail(err?.message || 'The token could not be sealed.');
    }
    input.value = '';
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
