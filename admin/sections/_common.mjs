// Shared by the form sections (profile, education, languages, services, contact, settings, and the later ones).
//
// formSection() owns the re-render rule every section follows, so typing never loses focus or the caret:
//   - the form is built once from the draft (build(view));
//   - the section writes through view.write (set / insert / remove / move / addPendingFile / removeFile). Those writes
//     are "own": the store notifies, and the section only refreshes its derived displays (the validation hints and
//     every view.derive callback). Fields keep their own DOM state, lists re-render their rows themselves;
//   - any other change of the draft (Reset draft, a newer base after Publish, an undo toast from an earlier visit)
//     rebuilds the whole form from the new draft, after cancelling the pending writes of the old fields.
//   - every build gets its own view, and its writes count as own only while that build is on screen. A write that
//     comes late through the view of an older build (an Undo toast, an upload finishing after a rebuild) is foreign:
//     the form is rebuilt and shows it, where a mere refresh would leave the change in rows that are gone.

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
 *                   { get(), write: { set, insert, remove, move, addPendingFile, removeFile }, context(), derive(fn) }
 *                   derive(fn): fn(draft) runs after the build and after every own write (derived read-only values)
 *                   context(): the placeholder values for rich previews, from the current draft
 */
export function formSection(container, store, { title, hint, keys, exclude = [], build }) {
  let own = 0;
  let generation = 0;                       // the build on screen (see the rule above)
  const derived = [];
  const viewOf = (gen) => {
    const mine = (fn) => (...args) => {
      if (gen !== generation) return fn(...args);   // an older build: foreign, so the form rebuilds
      own += 1;
      try { return fn(...args); } finally { own -= 1; }
    };
    return {
      get: () => store.get(),
      write: {
        set: mine((path, value) => store.set(path, value)),
        insert: mine((path, index, item) => store.insert(path, index, item)),
        remove: mine((path, index) => store.remove(path, index)),
        move: mine((path, from, to) => store.move(path, from, to)),
        addPendingFile: mine((bulletPath, record) => store.addPendingFile(bulletPath, record)),
        removeFile: mine((bulletPath, fileId) => store.removeFile(bulletPath, fileId)),
      },
      context: () => previewContext(store.get()?.site),
      derive: (fn) => { derived.push(fn); },
    };
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
    generation += 1;
    body.replaceChildren(...[build(viewOf(generation))].flat().filter(Boolean));
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

