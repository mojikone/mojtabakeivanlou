// The dashboard's form controls (spec 13.3): fields, two-line headings, list editors, the icon picker, toasts and
// modals. DOM code for the browser only; the pure parts (throttle, bold/italic wrapping, the preview) are in forms.mjs.
//
// Safety: user text only ever reaches the page through textContent, input values or attributes set one by one. The
// two exceptions insert markup produced by the escaping helpers: the rich-text preview (inlineText / richText from
// html.mjs) and the icons (the fixed SVG strings of icons.mjs, attribute values escaped by icon()).
//
// Typing and the store: a field calls onInput at most every WRITE_MS while the user types (throttled), and at once on
// blur. Pending calls are tracked, so flushPending(root) / cancelPending(root) can settle the fields inside `root`
// (a list flushes before it moves rows, a section flushes in its teardown and cancels before it rebuilds).

import { icon } from '../../assets/js/render/icons.mjs';
import { throttle, wrapSelection, previewHtml } from './forms.mjs';

export const SERVICE_ICONS = Object.freeze(['waves', 'road', 'hydrology', 'dam', 'network', 'drop', 'globe', 'survey', 'automation']);

const WRITE_MS = 150;
const UNDO_MS = 6000;
// Rich previews without a context show the placeholders as typed.
const LITERAL_CTX = Object.freeze({ years: '{{years}}', year: '{{year}}', name: '{{name}}', roleTitle: '{{roleTitle}}', domain: '{{domain}}' });

let seq = 0;
const nextId = (prefix) => `${prefix}-${++seq}`;

/* ─── ELEMENTS ─── */

const PROPS = new Set(['value', 'checked', 'disabled', 'readOnly', 'hidden', 'draggable', 'tabIndex']);

function append(node, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(node, child);
    else node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/**
 * el('button', { class: 'x', type: 'button', onclick: fn, 'aria-label': 'Close' }, 'text', otherNode, [more])
 * `text` sets textContent, `dataset` is merged, on<event> functions become listeners, a few names are set as
 * properties (value, checked, disabled, readOnly, hidden, draggable, tabIndex), everything else is an attribute.
 * null, undefined and false are skipped; true becomes an empty attribute. Strings become text nodes, never markup.
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (PROPS.has(key)) node[key] = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  append(node, children);
  return node;
}

/** One of the fixed SVGs of icons.mjs as a node (hidden from screen readers). */
export function svg(name, attrs) {
  const t = document.createElement('template');
  t.innerHTML = icon(name, { 'aria-hidden': 'true', focusable: 'false', ...attrs }).html;
  return t.content.firstElementChild;
}

/* ─── PENDING WRITES ─── */

const live = new Set();                     // { element, write } with a call waiting

// A throttled onInput bound to `element`, flushed or cancelled through flushPending / cancelPending.
function writer(element, fn) {
  const entry = { element };
  entry.write = throttle((value) => {
    live.delete(entry);
    fn(value);
  }, WRITE_MS);
  const call = (value) => {
    live.add(entry);
    entry.write(value);
  };
  call.flush = () => entry.write.flush();
  return call;
}

/** Runs now every pending field write inside `root` (every one when root is omitted). */
export function flushPending(root) {
  for (const entry of [...live]) if (!root || root.contains(entry.element)) entry.write.flush();
}

/** Drops the pending field writes inside `root`: their fields are about to be replaced by fresh values. */
export function cancelPending(root) {
  for (const entry of [...live]) {
    if (root && !root.contains(entry.element)) continue;
    entry.write.cancel();
    live.delete(entry);
  }
}

/* ─── FIELD ─── */

const INPUT_TYPES = new Set(['text', 'date', 'number', 'url', 'email']);

/**
 * A labelled control. type: 'text' | 'textarea' | 'rich' | 'date' | 'number' | 'url' | 'email'.
 * onInput(value) gets the control's string value (throttled while typing, at once on blur).
 * 'rich' is a textarea with **B** / _I_ buttons (and Ctrl+B / Ctrl+I) that wrap the selection in ** or _, and a live
 * preview rendered the way the site renders it. Extra options for 'rich':
 *   inline   true for a one-line field (Enter is ignored, line breaks are pasted as spaces; preview via inlineText)
 *   context  the placeholder values for the preview, an object or a function returning one ({{...}} shown as typed
 *            without it)
 * rows: initial height of a textarea. The control has the class adm-input (query it to update the value in place).
 */
export function field({
  label, value, onInput, type = 'text', placeholder, hint, readOnly = false, inline = false, context, rows,
} = {}) {
  const id = nextId('adm-f');
  const text = value === null || value === undefined ? '' : String(value);
  const multiline = type === 'textarea' || type === 'rich';
  const wrap = el('div', { class: `adm-field${type === 'rich' ? ' adm-field-rich' : ''}` });
  const hintId = hint ? `${id}-hint` : null;

  const control = multiline
    ? el('textarea', { id, class: 'adm-input adm-textarea', rows: rows ?? textareaRows(text, inline), spellcheck: 'true' })
    : el('input', {
      id, class: 'adm-input', type: INPUT_TYPES.has(type) ? type : 'text',
      spellcheck: type === 'text' ? 'true' : 'false', autocapitalize: type === 'text' ? null : 'off',
    });
  control.value = text;
  control.autocomplete = 'off';
  if (placeholder) control.placeholder = placeholder;
  if (hintId) control.setAttribute('aria-describedby', hintId);
  if (readOnly) {
    control.readOnly = true;
    control.classList.add('adm-input-ro');
  }

  // The rich parts listen first, so a one-line field has dropped pasted line breaks before the value is written.
  const parts = type === 'rich' ? richParts(control, { inline, context }) : [control];
  const write = writer(control, (v) => onInput?.(v));
  control.addEventListener('input', () => { if (!control.readOnly) write(control.value); });
  control.addEventListener('change', () => write.flush());
  control.addEventListener('blur', () => write.flush());

  wrap.append(el('label', { class: 'adm-label', for: id, text: label ?? '' }), ...parts);
  if (hint) wrap.append(el('p', { class: 'adm-hint', id: hintId, text: hint }));
  return wrap;
}

function textareaRows(text, inline) {
  if (inline) return 2;
  const lines = text.split('\n').reduce((n, line) => n + 1 + Math.floor(line.length / 90), 0);
  return Math.min(Math.max(lines, 3), 12);
}

// The toolbar, the textarea and the preview of a 'rich' field.
function richParts(control, { inline, context }) {
  const body = el('div', { class: 'adm-preview-body' });
  const preview = el('div', { class: 'adm-preview' }, el('span', { class: 'adm-preview-label', text: 'Preview' }), body);

  const ctx = () => (typeof context === 'function' ? context() : context) ?? LITERAL_CTX;
  const showPreview = () => {
    const out = previewHtml(control.value, ctx(), { inline });
    body.classList.toggle('is-error', Boolean(out.error));
    if (out.error) body.textContent = out.error;
    else body.innerHTML = out.html;          // escaped by inlineText / richText: the only markup a user's text becomes
  };

  const apply = (marker) => {
    if (control.readOnly) return;
    const r = wrapSelection(control.value, control.selectionStart, control.selectionEnd, marker);
    control.focus();
    control.setSelectionRange(r.from, r.to);
    let done = false;
    try { done = document.execCommand('insertText', false, r.insert); } catch { /* not supported */ }   // keeps Ctrl+Z
    if (!done || control.value !== r.text) {
      control.value = r.text;
      control.dispatchEvent(new Event('input', { bubbles: true }));
    }
    control.setSelectionRange(r.start, r.end);
  };
  const tool = (marker, text, name, cls) => el('button', {
    type: 'button', class: `adm-rich-btn ${cls}`, title: `${name} (Ctrl+${text})`, 'aria-label': name,
    onmousedown: (e) => e.preventDefault(),   // keep the selection in the textarea
    onclick: () => apply(marker),
  }, text);

  control.addEventListener('keydown', (e) => {
    if (inline && e.key === 'Enter') e.preventDefault();
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'b' || e.key === 'i')) {
      e.preventDefault();
      apply(e.key === 'b' ? '**' : '_');
    }
  });
  control.addEventListener('input', () => {
    if (inline && /[\r\n]/.test(control.value)) {          // pasted line breaks: one line only
      const caret = control.selectionStart;
      control.value = control.value.replace(/\r\n?|\n/g, ' ');
      control.setSelectionRange(caret, caret);
    }
    showPreview();
  });
  showPreview();

  const help = inline ? '**bold**  _italic_' : '**bold**  _italic_  ·  blank line = new paragraph';
  return [
    el('div', { class: 'adm-rich-tools' },
      tool('**', 'B', 'Bold', 'is-bold'), tool('_', 'I', 'Italic', 'is-italic'),
      el('span', { class: 'adm-rich-help', text: help })),
    control,
    preview,
  ];
}

/* ─── PAIR ─── */

/**
 * A two-line heading (spec 8: rendered with a line break, the second line in the accent colour).
 * onInput(index, value), index 0 or 1, throttled like field().
 */
export function pair({ label, values = ['', ''], onInput, hint, placeholders = [] } = {}) {
  const id = nextId('adm-p');
  const input = (index) => {
    const control = el('input', {
      class: `adm-input${index === 1 ? ' adm-input-accent' : ''}`, type: 'text', spellcheck: 'true',
      'aria-label': `${label}, ${index === 0 ? 'first line' : 'second line (accent colour)'}`,
      placeholder: placeholders[index],
    });
    control.value = values?.[index] ?? '';
    control.autocomplete = 'off';
    const write = writer(control, (v) => onInput?.(index, v));
    control.addEventListener('input', () => write(control.value));
    control.addEventListener('change', () => write.flush());
    control.addEventListener('blur', () => write.flush());
    return control;
  };
  return el('div', { class: 'adm-field adm-pair', role: 'group', 'aria-labelledby': id },
    el('span', { class: 'adm-label', id, text: label ?? '' }),
    el('div', { class: 'adm-pair-inputs' }, input(0), input(1)),
    el('p', { class: 'adm-hint', text: hint ?? 'Two lines; the second shows in the accent colour.' }));
}

/* ─── LIST EDITOR ─── */

let drag = null;                            // { rows, from }: the list a row is being dragged in

/**
 * Rows with a ⋮⋮ drag handle (HTML5 drag and drop), ▲ / ▼ buttons, a × with a 6-second undo toast, and "+ Add".
 *   items       the current array, or (better) a function returning it: rows are re-rendered from it after every
 *               change, so a getter keeps edits made inside rows; with a plain array the editor keeps its own copy
 *   renderItem  (item, index, api) -> HTMLElement, the row's content; api = { index, count, remove(), move(to),
 *               refresh() }. Rows are rebuilt after every insert, remove and move, so closures may keep `index`.
 *   onInsert(index, item), onRemove(index), onMove(from, to)   apply the change (store.insert / remove / move)
 *   newItem()   the item "+ Add" inserts at the end
 *   addLabel    the add button's text ('+ Add')
 *   empty       text shown when there are no rows
 *   describe    item -> short name, for the undo toast and the buttons' labels
 *   fixed       true: no add and no remove, only reordering (a list of exactly three stats, nine cells)
 * Remove takes the row out at once (onRemove) and the toast's Undo puts it back at its old index (onInsert).
 */
export function listEditor({
  items, renderItem, onInsert, onRemove, onMove, newItem, addLabel = '+ Add', empty = 'Nothing here yet.',
  describe, fixed = false,
} = {}) {
  let local = typeof items === 'function' ? null : [...(items ?? [])];
  const current = () => (local ?? items() ?? []);
  const name = (item, index) => {
    const text = typeof describe === 'function' ? String(describe(item) ?? '').trim() : '';
    return text ? (text.length > 48 ? `${text.slice(0, 47)}…` : text) : `row ${index + 1}`;
  };

  const rows = el('ol', { class: 'adm-rows' });
  const emptyNote = el('p', { class: 'adm-list-empty', text: empty });
  const add = fixed ? null : el('button', { type: 'button', class: 'adm-add', onclick: () => addRow() }, addLabel);
  const root = el('div', { class: 'adm-list' }, rows, emptyNote, add);

  function render() {
    const list = current();
    rows.replaceChildren(...list.map((item, index) => row(item, index, list.length)));
    emptyNote.hidden = list.length > 0;
  }

  function row(item, index, count) {
    const api = { index, count, remove: () => removeAt(index), move: (to) => moveTo(index, to), refresh: render };
    const li = el('li', { class: 'adm-row', dataset: { index: String(index) } });
    const grip = el('span', { class: 'adm-grip', title: 'Drag to reorder', 'aria-hidden': 'true' }, '⋮⋮');
    // Only the handle starts a drag (the row is draggable while it is pressed), so text in the row stays selectable.
    grip.addEventListener('mousedown', () => {
      li.draggable = true;
      window.addEventListener('mouseup', () => { li.draggable = false; }, { once: true });   // pressed, not dragged
    });
    li.addEventListener('dragstart', (e) => {
      if (!li.draggable) return;
      e.stopPropagation();
      flushPending(root);
      drag = { rows, from: index };
      e.dataTransfer.effectAllowed = 'move';
      // Firefox starts a drag only with data; not text/plain, which a text field elsewhere would accept as a drop
      e.dataTransfer.setData('application/x-adm-row', String(index));
      li.classList.add('is-dragging');
    });
    li.addEventListener('dragend', () => {
      li.draggable = false;
      li.classList.remove('is-dragging');
      clearMarks();
      drag = null;
    });

    const label = name(item, index);
    const tools = el('div', { class: 'adm-row-tools' },
      el('button', {
        type: 'button', class: 'adm-icon-btn', dataset: { act: 'up' }, disabled: index === 0,
        title: 'Move up', 'aria-label': `Move ${label} up`, onclick: () => moveTo(index, index - 1, 'up'),
      }, '▲'),
      el('button', {
        type: 'button', class: 'adm-icon-btn', dataset: { act: 'down' }, disabled: index === count - 1,
        title: 'Move down', 'aria-label': `Move ${label} down`, onclick: () => moveTo(index, index + 1, 'down'),
      }, '▼'),
      fixed ? null : el('button', {
        type: 'button', class: 'adm-icon-btn adm-row-remove', dataset: { act: 'remove' },
        title: 'Remove', 'aria-label': `Remove ${label}`, onclick: () => removeAt(index),
      }, '×'));
    li.append(grip, el('div', { class: 'adm-row-body' }, renderItem(item, index, api)), tools);
    return li;
  }

  function moveTo(from, to, focusAct) {
    flushPending(root);
    const list = current();
    if (from < 0 || from >= list.length || to < 0 || to >= list.length || to === from) return;
    if (local) local.splice(to, 0, local.splice(from, 1)[0]);
    onMove?.(from, to);
    render();
    if (focusAct) {
      const buttons = rows.children[to]?.querySelectorAll('[data-act="up"], [data-act="down"]') ?? [];
      const target = [...buttons].find((b) => b.dataset.act === focusAct && !b.disabled) ?? [...buttons].find((b) => !b.disabled);
      target?.focus();
    }
  }

  function removeAt(index) {
    flushPending(root);
    const list = current();
    if (index < 0 || index >= list.length) return;
    const item = structuredClone(list[index]);
    const label = name(item, index);
    if (local) local.splice(index, 1);
    onRemove?.(index);
    render();
    const next = rows.children[Math.min(index, rows.children.length - 1)];
    (next?.querySelector('[data-act="remove"]') ?? add)?.focus();
    toast(`Removed ${label}`, {
      actionLabel: 'Undo',
      onAction: () => {
        const at = Math.min(index, current().length);
        if (local) local.splice(at, 0, item);
        onInsert?.(at, structuredClone(item));
        render();
      },
    });
  }

  function addRow() {
    flushPending(root);
    const item = newItem ? newItem() : '';
    const at = current().length;
    if (local) local.push(item);
    onInsert?.(at, item);
    render();
    rows.children[at]?.querySelector('input:not([readonly]), textarea:not([readonly])')?.focus();
  }

  // Drops: only rows of this list take a drag that started in this list (nested lists ignore each other).
  const rowOf = (node) => {
    let n = node;
    while (n && n.parentElement !== rows) n = n.parentElement;
    return n;
  };
  const clearMarks = () => {
    for (const li of rows.children) li.classList.remove('is-drop-before', 'is-drop-after');
  };
  const dropPlace = (e) => {
    const li = rowOf(e.target);
    if (!li) return null;
    const box = li.getBoundingClientRect();
    return { li, after: e.clientY > box.top + box.height / 2 };
  };
  rows.addEventListener('dragover', (e) => {
    if (drag?.rows !== rows) return;
    const place = dropPlace(e);
    if (!place) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    clearMarks();
    place.li.classList.add(place.after ? 'is-drop-after' : 'is-drop-before');
  });
  rows.addEventListener('dragleave', (e) => {
    if (drag?.rows === rows && !rows.contains(e.relatedTarget)) clearMarks();
  });
  rows.addEventListener('drop', (e) => {
    if (drag?.rows !== rows) return;
    const place = dropPlace(e);
    if (!place) return;
    e.preventDefault();
    e.stopPropagation();
    const from = drag.from;
    drag = null;                            // the dragged row is re-rendered away, so its dragend may never come
    const before = Number(place.li.dataset.index) + (place.after ? 1 : 0);   // insertion point in the old order
    clearMarks();
    moveTo(from, from < before ? before - 1 : before);
  });

  render();
  return root;
}

/* ─── ICON PICKER ─── */

/**
 * A grid of the icons in `names` (the caller passes SERVICE_ICONS); one is selected. onChange(name) on a pick.
 * Keyboard: a radio group, Tab reaches the selected icon, the arrow keys move and pick.
 */
export function iconPicker({ value, onChange, names = SERVICE_ICONS, label = 'Icon' } = {}) {
  let current = value;
  const group = el('div', { class: 'adm-icons', role: 'radiogroup', 'aria-label': label });
  const buttons = names.map((name) => el('button', {
    type: 'button', class: 'adm-icon-choice', role: 'radio', title: name, 'aria-label': name, dataset: { name },
    onclick: () => choose(name, false),
  }, svg(name, { width: '18', height: '18' })));

  function sync() {
    const selected = names.includes(current) ? current : null;
    buttons.forEach((b, i) => {
      const on = b.dataset.name === selected;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on || (!selected && i === 0) ? 0 : -1;
    });
  }
  function choose(name, focus) {
    if (focus) buttons[names.indexOf(name)]?.focus();
    if (name === current) return;
    current = name;
    sync();
    onChange?.(name);
  }
  group.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const at = Math.max(names.indexOf(current), 0);
    choose(names[(at + step + names.length) % names.length], true);
  });
  group.append(...buttons);
  sync();
  return group;
}

/* ─── TOAST ─── */

let toastHost = null;

/**
 * A message at the bottom of the screen for `ms` (6 s by default; paused while hovered or focused), with an optional
 * action button. onClose(acted) runs once when the toast goes: acted is true when its action button closed it, false
 * when it timed out or was dismissed. Returns { close }.
 */
export function toast(message, { actionLabel, onAction, onClose, ms = UNDO_MS } = {}) {
  if (!toastHost?.isConnected) {
    toastHost = el('div', { class: 'adm-toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  let timer = null;
  let left = ms;
  let since = 0;
  const node = el('div', { class: 'adm-toast' });
  let closed = false;
  const close = (acted = false) => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    node.remove();
    onClose?.(acted === true);
  };
  const start = () => {
    since = Date.now();
    timer = setTimeout(close, left);
  };
  const pause = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    left = Math.max(left - (Date.now() - since), 1500);
  };
  node.append(
    el('span', { class: 'adm-toast-text', text: message }),
    actionLabel ? el('button', { type: 'button', class: 'adm-toast-action', onclick: () => { close(true); onAction?.(); } }, actionLabel) : null,
    el('button', { type: 'button', class: 'adm-toast-close', 'aria-label': 'Dismiss', onclick: () => close() }, '×'),
  );
  node.addEventListener('mouseenter', pause);
  node.addEventListener('focusin', pause);
  node.addEventListener('mouseleave', () => { if (timer === null && !node.contains(document.activeElement)) start(); });
  node.addEventListener('focusout', (e) => { if (timer === null && !node.contains(e.relatedTarget)) start(); });
  toastHost.append(node);
  start();
  return { close: () => close() };
}

/* ─── MODAL ─── */

/**
 * A modal <dialog> (focus stays inside, Esc cancels). body: an element, or a string shown as a paragraph.
 * actions: [{ label, onClick, primary }]. A click runs onClick({ close }) and then closes the modal, unless onClick
 * returns false (or a promise of false); while a returned promise is pending the buttons are disabled.
 * Returns { close, element }.
 */
export function modal({ title, body, actions = [], onClose } = {}) {
  const id = nextId('adm-m');
  const dialog = el('dialog', { class: 'adm-modal', 'aria-labelledby': id });
  let busy = false;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    if (dialog.open) dialog.close();
    dialog.remove();
    onClose?.();
  };
  const buttons = actions.map((action) => el('button', {
    type: 'button', class: `adm-btn ${action.primary ? 'adm-btn-dark' : 'adm-btn-plain'}`, onclick: () => run(action),
  }, action.label));
  async function run(action) {
    if (busy) return;
    busy = true;
    buttons.forEach((b) => { b.disabled = true; });
    try {
      if ((await action.onClick?.({ close })) !== false) close();
    } finally {
      busy = false;
      if (!closed) buttons.forEach((b) => { b.disabled = false; });
    }
  }
  dialog.append(
    el('h2', { class: 'adm-modal-title', id, text: title ?? '' }),
    typeof body === 'string' ? el('p', { class: 'adm-modal-text', text: body }) : body ?? null,
    el('div', { class: 'adm-modal-actions' }, buttons),
  );
  dialog.addEventListener('cancel', (e) => { if (busy) e.preventDefault(); });
  dialog.addEventListener('close', close);
  document.body.append(dialog);
  dialog.showModal();
  return { close, element: dialog };
}

/* ─── LAYOUT ─── */

/** A white card with an optional title; children: nodes, strings or arrays of them. */
export function card(title, children = []) {
  return el('div', { class: 'adm-card' }, title ? el('h2', { class: 'adm-card-title', text: title }) : null, children);
}

/** The section header: title and an optional one-line hint. */
export function section(title, hint) {
  return el('header', { class: 'adm-head' },
    el('h1', { class: 'adm-title', text: title ?? '' }),
    hint ? el('p', { class: 'adm-head-hint', text: hint }) : null);
}
