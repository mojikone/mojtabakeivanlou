// Shared by the form sections (profile, education, languages, services, contact, settings, and the later ones).
//
// formSection() owns the re-render rule every section follows, so typing never loses focus or the caret:
//   - the form is built once from the draft (build(view));
//   - the section writes through view.write (set / insert / remove / move). Those writes are "own": the store
//     notifies, and the section only refreshes its derived displays (the validation hints and every view.derive
//     callback). Fields keep their own DOM state, lists re-render their rows themselves;
//   - any other change of the draft (Reset draft, a newer base after Publish, an undo toast from an earlier visit)
//     rebuilds the whole form from the new draft, after cancelling the pending writes of the old fields.

import { el, section, field, pair, flushPending, cancelPending } from '../modules/ui.mjs';
import { issuesFor, previewContext } from '../modules/forms.mjs';
import { icons } from '../../assets/js/render/icons.mjs';

const ICON_NAMES = Object.keys(icons);

export const getIn = (node, path) => path.reduce((n, k) => (n == null ? undefined : n[k]), node);

/**
 * Mounts a form section into `container` and returns its teardown.
 *   title, hint     the header
 *   keys, exclude   which validator paths the hint list shows (see issuesFor in forms.mjs)
 *   build(view)     returns the section's content (a node or an array of nodes); view is
 *                   { get(), write: { set, insert, remove, move }, context(), derive(fn) }
 *                   derive(fn): fn(draft) runs after the build and after every own write (derived read-only values)
 *                   context(): the placeholder values for rich previews, from the current draft
 */
export function formSection(container, store, { title, hint, keys, exclude = [], build }) {
  let own = 0;
  const mine = (fn) => (...args) => {
    own += 1;
    try { fn(...args); } finally { own -= 1; }
  };
  const derived = [];
  const view = {
    get: () => store.get(),
    write: {
      set: mine((path, value) => store.set(path, value)),
      insert: mine((path, index, item) => store.insert(path, index, item)),
      remove: mine((path, index) => store.remove(path, index)),
      move: mine((path, from, to) => store.move(path, from, to)),
    },
    context: () => previewContext(store.get()?.site),
    derive: (fn) => { derived.push(fn); },
  };

  const issues = el('div', { class: 'adm-issues', 'aria-live': 'polite', hidden: true });
  const body = el('div', { class: 'adm-body' });
  container.replaceChildren(section(title, hint), issues, body);

  let shown = null;
  function refresh() {
    const draft = store.get();
    const list = issuesFor(draft.site, { keys, exclude, icons: ICON_NAMES });
    const key = list.join('\n');
    if (key !== shown) {                    // only touch the list when it changes (it is a live region)
      shown = key;
      issues.hidden = list.length === 0;
      issues.replaceChildren(...(list.length === 0 ? [] : [
        el('p', { class: 'adm-issues-title', text: `To fix before publishing (${list.length})` }),
        el('ul', { class: 'adm-issues-list' }, list.map((message) => el('li', { text: message }))),
      ]));
    }
    for (const fn of derived) fn(draft);
  }

  function rebuild() {
    cancelPending(body);
    derived.length = 0;
    body.replaceChildren(...[build(view)].flat().filter(Boolean));
    refresh();
  }

  const unsubscribe = store.subscribe(() => {
    if (own > 0) refresh();
    else rebuild();
  });
  rebuild();
  return () => {
    flushPending(container);                // a keystroke typed just before leaving still reaches the draft
    unsubscribe();
  };
}

/* ─── bound controls ─── */

/** field() showing the draft value at `path` and writing it back; opts as for field(). Rich fields get the context. */
export function bound(view, path, opts = {}) {
  return field({
    ...opts,
    value: getIn(view.get(), path) ?? '',
    onInput: (value) => view.write.set(path, value),
    context: opts.type === 'rich' ? view.context : undefined,
  });
}

/** pair() for the two-string heading at `path`. */
export function boundPair(view, path, label, hint) {
  const values = getIn(view.get(), path);
  return pair({
    label,
    hint,
    values: Array.isArray(values) ? values : ['', ''],
    onInput: (index, value) => view.write.set([...path, index], value),
  });
}

/** listEditor() wiring for the array at `path`: rows re-read the draft, changes go through view.write. */
export function listAt(view, path) {
  return {
    items: () => getIn(view.get(), path) ?? [],
    onInsert: (index, item) => view.write.insert(path, index, item),
    onRemove: (index) => view.write.remove(path, index),
    onMove: (from, to) => view.write.move(path, from, to),
  };
}

/* ─── layout ─── */

/** Fields side by side (two columns, or `cols`), one column on narrow screens. */
export const grid = (children, cols = 2) => el('div', { class: `adm-grid adm-grid-${cols}` }, children);

/** A labelled read-only value that derive() can update: returns { node, set(text) }. */
export function readout(label, text = '') {
  const value = el('output', { class: 'adm-readout-value', text });
  return {
    node: el('div', { class: 'adm-readout' }, el('span', { class: 'adm-label', text: label }), value),
    set: (next) => { if (value.textContent !== next) value.textContent = next; },
  };
}

/** A checkbox with its label; onChange(checked). */
export function checkbox({ label, checked = false, onChange }) {
  const input = el('input', { type: 'checkbox', class: 'adm-check-input', checked: Boolean(checked) });
  input.addEventListener('change', () => onChange?.(input.checked));
  return el('label', { class: 'adm-check' }, input, el('span', { text: label }));
}

