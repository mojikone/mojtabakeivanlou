// Skills section (Task 20, spec 13.3): the pure helper behind the tag list, displayOrder() in admin/sections/skills.mjs.
// The list shows experts first and then the rest (sortedTags, the order of the site) while the draft keeps the tags in
// the order the owner arranged them; displayOrder maps between the two. The DOM part is checked by hand in the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayOrder } from '../admin/sections/skills.mjs';
import { sortedTags } from '../assets/js/render/model.mjs';
import { createStore } from '../admin/modules/state.mjs';

const tag = (name, level) => ({ name, level });
const names = (tags) => tags.map((t) => t.name);

// stored: f1 e1 f2 e2 e3 f3  ->  displayed: e1 e2 e3 f1 f2 f3
const MIXED = [tag('f1', 'familiar'), tag('e1', 'expert'), tag('f2', 'familiar'), tag('e2', 'expert'), tag('e3', 'expert'), tag('f3', 'familiar')];

const TAGS_PATH = ['site', 'skills', 0, 'tags'];
const memStorage = () => {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, String(v)); }, removeItem: (k) => { data.delete(k); } };
};

// The tags after a move, made by the real draft store (so the helper's indices are checked against store.move).
function applyMove(tags, move) {
  const store = createStore({ storage: memStorage() });
  store.init({
    commit: 'c0ffee1',
    shas: { site: 's', access: 'a', keys: 'k' },
    site: { skills: [{ category: 'C', tags: structuredClone(tags) }] },
    access: { v: 1, entries: [] },
    keys: { v: 1, vk: '', files: {} },
  });
  store.move(TAGS_PATH, move.fromStored, move.toStored);
  return store.get().site.skills[0].tags;
}

/* ─── order ─── */

test('order lists the stored indices in display order: experts first, each group in stored order', () => {
  const { order } = displayOrder(MIXED);
  assert.deepEqual(order, [1, 3, 4, 0, 2, 5]);
  assert.deepEqual(order.map((i) => MIXED[i].name), ['e1', 'e2', 'e3', 'f1', 'f2', 'f3']);
});

test('order agrees with sortedTags, which the site renders with', () => {
  const { order } = displayOrder(MIXED);
  assert.deepEqual(order.map((i) => MIXED[i]), sortedTags(MIXED));
});

test('order is the identity when the tags are already experts first, and for one level only', () => {
  const sorted = [tag('a', 'expert'), tag('b', 'expert'), tag('c', 'familiar')];
  assert.deepEqual(displayOrder(sorted).order, [0, 1, 2]);
  assert.deepEqual(displayOrder([tag('a', 'familiar'), tag('b', 'familiar')]).order, [0, 1]);
  assert.deepEqual(displayOrder([tag('a', 'expert'), tag('b', 'expert')]).order, [0, 1]);
});

test('an empty list, a missing list and a level that is neither expert nor familiar', () => {
  assert.deepEqual(displayOrder([]).order, []);
  assert.deepEqual(displayOrder(undefined).order, []);
  assert.equal(displayOrder([]).moveDisplayed(0, 1), null);
  // like sortedTags: anything but "expert" sorts with the familiar tags
  const odd = [tag('x', undefined), tag('e', 'expert'), tag('y', 'guru')];
  assert.deepEqual(displayOrder(odd).order, [1, 0, 2]);
  assert.deepEqual(displayOrder(odd).order.map((i) => odd[i]), sortedTags(odd));
});

test('displayOrder does not touch the tags it is given', () => {
  const copy = structuredClone(MIXED);
  displayOrder(MIXED).moveDisplayed(0, 2);
  assert.deepEqual(MIXED, copy);
});

/* ─── moveDisplayed ─── */

test('moveDisplayed within the experts gives the stored indices of the two slots', () => {
  const { moveDisplayed } = displayOrder(MIXED);
  // display 0 (e1, stored 1) to display 2 (e3, stored 4)
  assert.deepEqual(moveDisplayed(0, 2), { fromStored: 1, toStored: 4 });
  assert.deepEqual(names(applyMove(MIXED, moveDisplayed(0, 2))), ['f1', 'f2', 'e2', 'e3', 'e1', 'f3']);
  assert.deepEqual(names(sortedTags(applyMove(MIXED, moveDisplayed(0, 2)))), ['e2', 'e3', 'e1', 'f1', 'f2', 'f3']);
});

test('moveDisplayed one step up or down swaps with the neighbour of the same level, whatever lies between in the draft', () => {
  const { moveDisplayed } = displayOrder(MIXED);
  // e3 up: it passes e2 (stored 3) and the draft's familiar f2 does not matter
  assert.deepEqual(names(sortedTags(applyMove(MIXED, moveDisplayed(2, 1)))), ['e1', 'e3', 'e2', 'f1', 'f2', 'f3']);
  // f1 down: it passes f2 (stored 2), the familiar next in the display
  assert.deepEqual(moveDisplayed(3, 4), { fromStored: 0, toStored: 2 });
  assert.deepEqual(names(sortedTags(applyMove(MIXED, moveDisplayed(3, 4)))), ['e1', 'e2', 'e3', 'f2', 'f1', 'f3']);
});

test('moveDisplayed within the familiars, upwards', () => {
  const { moveDisplayed } = displayOrder(MIXED);
  // f3 (display 5, stored 5) to the top of the familiars (display 3, stored 0)
  assert.deepEqual(moveDisplayed(5, 3), { fromStored: 5, toStored: 0 });
  assert.deepEqual(names(sortedTags(applyMove(MIXED, moveDisplayed(5, 3)))), ['e1', 'e2', 'e3', 'f3', 'f1', 'f2']);
});

test('a move across the Expert / Familiar boundary stops at the edge of its own group', () => {
  const { moveDisplayed } = displayOrder(MIXED);
  // e1 dropped far below: it goes to the end of the experts, not into the familiars
  assert.deepEqual(moveDisplayed(0, 5), { fromStored: 1, toStored: 4 });
  assert.deepEqual(names(sortedTags(applyMove(MIXED, moveDisplayed(0, 5)))), ['e2', 'e3', 'e1', 'f1', 'f2', 'f3']);
  // f2 dropped on the top of the list: it goes to the start of the familiars
  assert.deepEqual(moveDisplayed(4, 0), { fromStored: 2, toStored: 0 });
  assert.deepEqual(names(sortedTags(applyMove(MIXED, moveDisplayed(4, 0)))), ['e1', 'e2', 'e3', 'f2', 'f1', 'f3']);
});

test('moveDisplayed is null when nothing would change or the indices are not rows', () => {
  const { moveDisplayed } = displayOrder(MIXED);
  assert.equal(moveDisplayed(1, 1), null);                  // same place
  assert.equal(moveDisplayed(2, 3), null);                  // last expert one step down: clamped to where it is
  assert.equal(moveDisplayed(3, 2), null);                  // first familiar one step up
  assert.equal(moveDisplayed(-1, 2), null);
  assert.equal(moveDisplayed(6, 2), null);
  assert.equal(moveDisplayed(0, 1.5), null);
  assert.equal(moveDisplayed(0, Number.NaN), null);
  assert.equal(moveDisplayed(undefined, 2), null);
  assert.equal(moveDisplayed(0, undefined), null);
  assert.equal(displayOrder([tag('only', 'expert')]).moveDisplayed(0, 0), null);
});

test('moveDisplayed past either end of the list lands on the nearest row of the group', () => {
  const { moveDisplayed } = displayOrder(MIXED);
  assert.deepEqual(moveDisplayed(1, -4), { fromStored: 3, toStored: 1 });      // e2 to the top of the experts
  assert.deepEqual(moveDisplayed(3, 99), { fromStored: 0, toStored: 5 });      // f1 to the end of the familiars
});

test('moveDisplayed with one group only: a plain array move', () => {
  const experts = [tag('a', 'expert'), tag('b', 'expert'), tag('c', 'expert')];
  assert.deepEqual(names(applyMove(experts, displayOrder(experts).moveDisplayed(0, 2))), ['b', 'c', 'a']);
  assert.deepEqual(names(applyMove(experts, displayOrder(experts).moveDisplayed(2, 0))), ['c', 'a', 'b']);
});

test('for every arrangement of up to five tags and every move, the display changes exactly as the move asks', () => {
  for (let size = 0; size <= 5; size += 1) {
    for (let mask = 0; mask < (1 << size); mask += 1) {
      const tags = Array.from({ length: size }, (_, i) => tag(`t${i}`, (mask >> i) & 1 ? 'expert' : 'familiar'));
      const before = sortedTags(tags);
      const { order, moveDisplayed } = displayOrder(tags);
      assert.deepEqual(order.map((i) => tags[i]), before);
      const experts = tags.filter((t) => t.level === 'expert').length;
      for (let from = -1; from <= size; from += 1) {
        for (let to = -1; to <= size; to += 1) {
          const move = moveDisplayed(from, to);
          const inGroup = from >= 0 && from < size;
          if (!inGroup) { assert.equal(move, null, `${mask}:${size} ${from}->${to}`); continue; }
          const lo = from < experts ? 0 : experts;
          const hi = from < experts ? experts - 1 : size - 1;
          const target = Math.min(Math.max(to, lo), hi);
          const expected = [...before];
          expected.splice(target, 0, expected.splice(from, 1)[0]);
          if (target === from) { assert.equal(move, null, `${mask}:${size} ${from}->${to}`); continue; }
          const after = applyMove(tags, move);
          assert.deepEqual(sortedTags(after), expected, `${mask}:${size} ${from}->${to}`);
          // a move only reorders: every tag keeps its name and level
          assert.deepEqual([...after].sort((a, b) => a.name.localeCompare(b.name)), tags, `${mask}:${size} ${from}->${to}`);
        }
      }
    }
  }
});
