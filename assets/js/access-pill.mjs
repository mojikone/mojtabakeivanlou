// The Access pill (spec 11.1): a pure state machine plus a thin DOM layer, no crypto. Used by the public home page
// (assets/js/access.mjs) and by the dashboard gate. Importing it touches no DOM, so Node tests can load the reducer.
//
//   idle      key icon + "Access"                    click: open
//   open      key icon + code field + "Enter"        Enter/button: submit; Escape or outside click: idle
//   checking  the same, field and button disabled    nothing (only the result moves on)
//   unlocked  lock-open icon + "Unlocked"            click: lock (onLock), back to idle
//   admin     key icon + "Dashboard"                 click: onDashboard
//
// A wrong code shakes the pill once (mk-shake, 300 ms), clears the field and returns to idle. No message.

import { icon } from './render/icons.mjs';

export const STATES = Object.freeze(['idle', 'open', 'checking', 'unlocked', 'admin']);
export const EVENTS = Object.freeze(['open', 'submit', 'ok-download', 'ok-admin', 'fail', 'lock', 'escape']);

// state -> event -> next state. A pair that is not listed leaves the state as it is.
const TRANSITIONS = {
  idle: { open: 'open' },
  open: { submit: 'checking', escape: 'idle' },
  checking: { 'ok-download': 'unlocked', 'ok-admin': 'admin', fail: 'idle' },
  unlocked: { lock: 'idle' },
  admin: {},
};

/** The state after `event`; an unknown state or event, or a pair with no transition, returns `state` unchanged. */
export function nextState(state, event) {
  const row = Object.hasOwn(TRANSITIONS, state) ? TRANSITIONS[state] : null;
  return row && typeof event === 'string' && Object.hasOwn(row, event) ? row[event] : state;
}

const LABELS = { idle: 'Access', open: 'Access', checking: 'Access', unlocked: 'Unlocked', admin: 'Dashboard' };
const SHAKE_MS = 300;                       // the length of the mk-shake keyframes in main.css
const isFormState = (state) => state === 'open' || state === 'checking';

function svgElement(markup) {
  const template = document.createElement('template');
  template.innerHTML = markup;              // trusted, static markup from icons.mjs
  return template.content.firstElementChild;
}

/**
 * Wires the pill markup rendered by the index template (div.access-pill with button.access-pill-main,
 * span.access-pill-label, form.access-pill-form, input[name=code] and a submit button).
 *   onSubmit(code) -> Promise<'admin' | 'download' | 'none'>: anything else, or a rejection, counts as 'none'.
 *   onLock(): called after an unlocked pill was clicked (the pill is idle again by then).
 *   onDashboard(): called when the pill in the admin state is clicked.
 * Returns { setState(state), shake() }. setState jumps straight to a state (restoring a session); it throws a
 * TypeError for anything that is not one of STATES.
 */
export function mountAccessPill(root, { onSubmit, onLock, onDashboard } = {}) {
  const main = root.querySelector('.access-pill-main');
  const label = root.querySelector('.access-pill-label');
  const form = root.querySelector('.access-pill-form');
  const input = form.querySelector('input[name="code"]');
  const enter = form.querySelector('button[type="submit"]');
  const keyIcon = main.querySelector('svg');
  const size = { width: keyIcon?.getAttribute('width') ?? '10', height: keyIcon?.getAttribute('height') ?? '10' };
  const lockOpenIcon = svgElement(icon('lockOpen', size).html);

  let state = 'idle';
  let shakeTimer = null;

  function render() {
    const formOpen = isFormState(state);
    root.dataset.state = state;
    form.hidden = !formOpen;
    label.hidden = formOpen;
    label.textContent = LABELS[state];
    main.setAttribute('aria-label', LABELS[state]);
    main.setAttribute('aria-expanded', String(formOpen));
    input.disabled = state === 'checking';
    enter.disabled = state === 'checking';
    if (!formOpen) input.value = '';        // a typed code never outlives the open field

    const wanted = state === 'unlocked' ? lockOpenIcon : keyIcon;
    const current = main.querySelector('svg');
    if (wanted && current && current !== wanted) main.replaceChild(wanted, current);
  }

  function stopShake() {
    clearTimeout(shakeTimer);
    shakeTimer = null;
    root.classList.remove('is-shaking');
  }

  // Every interaction goes through the reducer. Leaving the field puts focus back on the main button when focus was
  // in the pill (or nowhere, as after the disabled field of a check), but never after a click elsewhere.
  function dispatch(event, { refocus = true } = {}) {
    const before = state;
    const active = document.activeElement;
    const focusInPill = root.contains(active) || !active || active === document.body;
    state = nextState(state, event);
    if (state === before) return;
    render();
    if (state === 'open') input.focus();
    else if (refocus && isFormState(before) && focusInPill) main.focus({ preventScroll: true });
  }

  function shake() {
    stopShake();
    void root.offsetWidth;                  // restart the animation if it is still running
    root.classList.add('is-shaking');
    shakeTimer = setTimeout(() => {
      stopShake();
      input.value = '';
      dispatch(state === 'checking' ? 'fail' : 'escape');
    }, SHAKE_MS);
  }

  function setState(next) {
    if (!STATES.includes(next)) throw new TypeError('setState: unknown state');
    stopShake();
    state = next;
    render();
  }

  main.addEventListener('click', () => {
    if (state === 'idle') dispatch('open');
    else if (state === 'open') input.focus();
    else if (state === 'unlocked') {
      dispatch('lock');
      onLock?.();
    } else if (state === 'admin') {
      dispatch('open');                     // stays admin; the click navigates
      onDashboard?.();
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state !== 'open') return;
    const code = input.value;
    if (code.trim() === '') {
      input.focus();
      return;
    }
    dispatch('submit');
    let result;
    try {
      result = await onSubmit?.(code);
    } catch {
      result = 'none';
    }
    if (state !== 'checking') return;       // setState() moved on while the code was being checked
    if (result === 'admin') dispatch('ok-admin');
    else if (result === 'download') dispatch('ok-download');
    else shake();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state === 'open') dispatch('escape');
  });

  document.addEventListener('pointerdown', (event) => {
    if (state === 'open' && !root.contains(event.target)) dispatch('escape', { refocus: false });
  });

  render();
  return { setState, shake };
}
