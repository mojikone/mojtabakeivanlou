// Skills & software (spec 13.3): categories, each with tags that are Expert or Familiar (draft.site.skills, spec 8:
// [{ category, tags: [{ name, level: 'expert' | 'familiar' }] }]).
//
// Display order. The site renders every category with sortedTags(): experts first, then the rest, each group in the
// order stored in the draft. The dashboard lists the tags the same way, so the owner sees what the page will show,
// while the draft keeps the tags in the order they were arranged in. displayOrder() maps between the two:
//   - `order[d]` is the draft index of the tag shown in row d (the "displayToStored" map). The tag list builds it from
//     the current draft on every render and every action, so a row never trusts a stale index;
//   - the switch changes a tag's level in place (the draft keeps its position), so the tag appears in the other group
//     at the place its draft position gives it: at the end of that group when it was the newest tag, otherwise
//     between its neighbours of that level. The arrows and the handle then put it where it belongs;
//   - a move acts inside one group (the level is the switch's job): dropping an expert among the familiar tags puts it
//     at the end of the experts. In the draft it takes the slot of the tag it lands on, whatever lies between.

import { field, listEditor, card, el, flushPending } from '../modules/ui.mjs';
import { formSection, listAt, getIn } from './_common.mjs';

const SKILLS = ['site', 'skills'];
const LEVELS = [['expert', 'Expert'], ['familiar', 'Familiar']];

/* ─── display order (pure, tested in test/skills.test.mjs) ─── */

/**
 * The order a category's tags are shown in (experts first, then the rest, each group in draft order: sortedTags) and
 * how a move in that order maps onto the draft.
 *   order                  draft indices in display order
 *   moveDisplayed(from, to)  { fromStored, toStored } for store.move(path, fromStored, toStored), or null when nothing
 *                          would change (same place, an index that is no row). `to` is held inside the group of the
 *                          moved tag, since a tag's level is changed with the switch.
 */
export function displayOrder(tags) {
  const list = Array.isArray(tags) ? tags : [];
  const experts = [];
  const rest = [];
  list.forEach((tag, index) => (tag?.level === 'expert' ? experts : rest).push(index));
  const order = [...experts, ...rest];
  const row = (n) => Number.isInteger(n) && n >= 0 && n < order.length;

  function moveDisplayed(fromDisplay, toDisplay) {
    if (!row(fromDisplay) || !Number.isInteger(toDisplay)) return null;
    const [low, high] = fromDisplay < experts.length ? [0, experts.length - 1] : [experts.length, order.length - 1];
    const to = Math.min(Math.max(toDisplay, low), high);
    if (to === fromDisplay) return null;
    return { fromStored: order[fromDisplay], toStored: order[to] };
  }
  return { order, moveDisplayed };
}

const summaryText = (tags) => {
  const list = Array.isArray(tags) ? tags : [];
  const experts = list.filter((tag) => tag?.level === 'expert').length;
  if (list.length === 0) return 'no tags yet';
  const total = `${list.length} ${list.length === 1 ? 'tag' : 'tags'}`;
  return experts > 0 ? `${total} · ${experts} expert` : total;
};

let seq = 0;
const nextId = () => `adm-skill-${++seq}`;

/* ─── the section ─── */

// Which categories are open is kept here, not in the DOM: the rows are rebuilt after every move and remove, and the
// draft has no ids. `ids` runs in step with draft.site.skills (the list callbacks below keep it so; build() trims or
// extends it when the draft changed while another section was shown). Module level, so it survives a visit elsewhere.
// `live` maps a category id to the tag list that is mounted for it right now (see tagList).
const remembered = { ids: [], open: new Set(), live: new Map() };

export function render(container, store) {
  const state = { ...remembered, summaries: new Map() };   // ids, open and live are the shared containers

  const teardown = formSection(container, store, {
    title: 'Skills & software',
    hint: 'The Skills section of the home page and the CV: categories of tags, experts first.',
    keys: ['skills'],
    build: (view) => {
      const length = getIn(view.get(), SKILLS)?.length ?? 0;
      while (state.ids.length < length) state.ids.push(nextId());
      state.ids.length = length;

      view.derive((draft) => {
        for (const [id, node] of state.summaries) {
          if (!node.isConnected) {
            state.summaries.delete(id);
            continue;
          }
          const text = summaryText(getIn(draft, [...SKILLS, state.ids.indexOf(id), 'tags']));
          if (node.textContent !== text) node.textContent = text;
        }
      });

      const categories = listAt(view, SKILLS);
      return card(null, [
        el('p', {
          class: 'adm-card-hint',
          text: 'Experts are listed first, as on the site. The arrows and the handle reorder a tag within its group; '
            + 'the switch moves it to the other group.',
        }),
        listEditor({
          ...categories,
          addLabel: '+ Add category',
          empty: 'No categories yet.',
          describe: (item) => item?.category,
          newItem: () => ({ category: '', tags: [] }),
          onInsert: (index, item) => {
            const id = nextId();
            state.ids.splice(index, 0, id);
            state.open.add(id);                 // a new (or restored) category opens, so its tags are in reach
            categories.onInsert(index, item);
          },
          onRemove: (index) => {
            const [id] = state.ids.splice(index, 1);
            state.open.delete(id);
            state.live.delete(id);
            categories.onRemove(index);
          },
          onMove: (from, to) => {
            state.ids.splice(to, 0, ...state.ids.splice(from, 1));
            categories.onMove(from, to);
          },
          renderItem: (item, i) => categoryRow(view, state, item, state.ids[i]),
        }),
      ]);
    },
  });
  return () => {
    teardown();
    state.live.clear();                     // nothing is mounted any more
  };
}

// One category: its name, the open / closed switch with a summary, and the tags.
function categoryRow(view, state, category, id) {
  const bodyId = `${id}-tags`;
  const open = state.open.has(id);
  const summary = el('span', { class: 'adm-skill-count', text: summaryText(category?.tags) });
  state.summaries.set(id, summary);

  const body = el('div', { class: 'adm-skill-body', id: bodyId, hidden: !open }, tagList(view, state, id));
  const toggle = el('button', {
    type: 'button', class: 'adm-skill-toggle', 'aria-expanded': String(open), 'aria-controls': bodyId,
    onclick: () => {
      const now = !state.open.has(id);
      if (now) state.open.add(id);
      else state.open.delete(id);
      body.hidden = !now;
      toggle.setAttribute('aria-expanded', String(now));
    },
  }, el('span', { class: 'adm-chev', 'aria-hidden': 'true' }, '▸'), 'Tags', summary);

  return el('div', { class: 'adm-skill' },
    field({
      label: 'Category', value: category?.category,
      onInput: (v) => {
        const at = state.ids.indexOf(id);
        if (at >= 0) view.write.set([...SKILLS, at, 'category'], v);
      },
    }),
    toggle,
    body);
}

// The tags of one category, in display order. The category is found by its id each time, so an Undo that comes after the
// categories were reordered still lands in the right one.
//
// A tag list is rebuilt whenever the categories list re-renders (add, move or remove a category), and the Undo toast of
// a tag removed before that belongs to the OLD list. That list is detached, and its write is an "own" write, so nothing
// would redraw the visible list: the restored tag would be missing and the rows would keep draft indices from before
// the insert, writing into the neighbouring tag. So every mounted list registers in state.live (category id -> list),
// and a structural write made through any other instance of the category first settles and then rebuilds the live one.
// (The alternative, looking the draft index up at write time, would not make the restored tag appear.)
function tagList(view, state, id) {
  const where = () => state.ids.indexOf(id);
  const path = () => [...SKILLS, where(), 'tags'];
  const tagsNow = () => (where() < 0 ? [] : getIn(view.get(), path()) ?? []);
  const removed = [];                         // where each removed tag stood in the draft, so Undo can put it back there
  const added = new WeakSet();                // what "+ Add tag" made, to tell an add from an Undo in onInsert

  const self = { root: null, remount: null };
  // An insert, remove or move runs through here. The list the user is working in redraws itself (listEditor does,
  // after the callback); a stale instance leaves that to the live one, which is settled before the write (pending
  // field writes carry draft indices from before it) and rebuilt after it.
  const structural = (write) => {
    const live = state.live.get(id);
    const other = live && live !== self ? live : null;
    if (other) flushPending(other.root);
    write();
    other?.remount();
  };

  const root = listEditor({
    items: () => {
      const tags = tagsNow();
      return displayOrder(tags).order.map((stored) => tags[stored]);
    },
    addLabel: '+ Add tag',
    empty: 'No tags yet.',
    describe: (tag) => tag?.name,
    newItem: () => {
      const tag = { name: '', level: 'familiar' };   // familiar tags come last, so the new row appears at the end
      added.add(tag);
      return tag;
    },
    onInsert: (_display, tag) => {
      if (where() < 0) return;
      const tags = tagsNow();
      let at = tags.length;
      if (!added.has(tag)) {                          // Undo
        const k = removed.findLastIndex((r) => r.name === tag?.name && r.level === tag?.level);
        if (k >= 0) at = Math.min(removed.splice(k, 1)[0].stored, tags.length);
      }
      structural(() => view.write.insert(path(), at, tag));
    },
    onRemove: (display) => {
      if (where() < 0) return;
      const tags = tagsNow();
      const stored = displayOrder(tags).order[display];
      if (stored === undefined) return;
      removed.push({ stored, name: tags[stored]?.name, level: tags[stored]?.level });
      structural(() => view.write.remove(path(), stored));
    },
    onMove: (from, to) => {
      const move = where() < 0 ? null : displayOrder(tagsNow()).moveDisplayed(from, to);
      if (move) structural(() => view.write.move(path(), move.fromStored, move.toStored));
      else keepFocus(from);
    },
    renderItem: (tag, display, api) => {
      const stored = displayOrder(tagsNow()).order[display];
      return tagRow(tag, display, stored, {
        write: (key, value) => { if (where() >= 0) view.write.set([...path(), stored, key], value); },
        refresh: api.refresh,
      });
    },
  });

  self.root = root;
  self.remount = () => {
    if (!root.isConnected) return;          // not on the page (another section, a rebuilt form): nothing to redraw
    root.replaceWith(tagList(view, state, id));   // the new list registers itself as the live one
  };
  state.live.set(id, self);
  return root;
}

// A tag: its name and the Expert / Familiar switch.
function tagRow(tag, display, stored, { write, refresh }) {
  const name = field({
    label: `Tag ${display + 1} name`, value: tag?.name,
    onInput: (v) => write('name', v),
  });
  const level = levelSwitch({
    value: tag?.level, label: `Level of ${tag?.name?.trim() || `tag ${display + 1}`}`,
    onChange: (next) => {
      const list = level.closest('.adm-list');
      const hadFocus = level.contains(document.activeElement);
      flushPending(list);
      write('level', next);                           // the draft keeps the tag in place; the display re-sorts
      refresh();
      if (hadFocus) list?.querySelector(`[data-stored="${stored}"] [role="radio"][aria-checked="true"]`)?.focus();
    },
  });
  return el('div', { class: 'adm-compact', dataset: { stored: String(stored) } },
    el('div', { class: 'adm-tagrow' }, name, level));
}

// A move across the Expert / Familiar boundary changes nothing, but ui.mjs still puts the focus on the row the tag
// "moved to". Put it back on the arrow that was pressed.
function keepFocus(row) {
  const pressed = document.activeElement;
  const act = pressed?.dataset?.act;
  const list = pressed?.closest?.('.adm-list');
  if (!act || !list) return;
  queueMicrotask(() => list.querySelector(`:scope > .adm-rows > .adm-row[data-index="${row}"] [data-act="${act}"]`)?.focus());
}

// Expert | Familiar as a segmented control: a radio group like the icon picker (Tab reaches the selected one, the arrow
// keys move and pick). A level that is neither (a hand-edited file) shows neither selected until one is picked.
function levelSwitch({ value, label, onChange }) {
  let current = value;
  const group = el('div', { class: 'adm-seg', role: 'radiogroup', 'aria-label': label });
  const buttons = LEVELS.map(([level, text]) => el('button', {
    type: 'button', class: `adm-seg-btn is-${level}`, role: 'radio', dataset: { level },
    onclick: () => choose(level),
  }, text));

  function sync() {
    const known = LEVELS.some(([level]) => level === current);
    buttons.forEach((button, i) => {
      const on = button.dataset.level === current;
      button.setAttribute('aria-checked', String(on));
      button.tabIndex = on || (!known && i === 0) ? 0 : -1;
    });
  }
  function choose(level) {
    if (level === current) return;
    current = level;
    sync();
    onChange?.(level);
  }
  group.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const at = LEVELS.findIndex(([level]) => level === current);
    const next = at < 0 ? (step > 0 ? 0 : LEVELS.length - 1) : (at + step + LEVELS.length) % LEVELS.length;
    buttons[next].focus();
    choose(LEVELS[next][0]);
  });
  group.append(...buttons);
  sync();
  return group;
}
