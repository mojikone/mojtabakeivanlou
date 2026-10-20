import { test } from 'node:test'; import assert from 'node:assert/strict';
import { nextState, STATES, EVENTS } from '../assets/js/access-pill.mjs';

// The Access pill's state machine (spec 11.1). The DOM layer is verified by hand; this pins the reducer.

test('the brief\'s transition table', () => {
  const table = [
    ['idle', 'open', 'open'],
    ['open', 'submit', 'checking'],
    ['checking', 'ok-download', 'unlocked'],
    ['checking', 'ok-admin', 'admin'],
    ['checking', 'fail', 'idle'],
    ['unlocked', 'lock', 'idle'],
    ['admin', 'open', 'admin'],
  ];
  for (const [state, event, expected] of table) {
    assert.equal(nextState(state, event), expected, `${state} + ${event}`);
  }
});

test('Escape (or an outside click) collapses the open pill', () => {
  assert.equal(nextState('open', 'escape'), 'idle');
});

test('an unlocked pill does not reopen the code field', () => {
  assert.equal(nextState('unlocked', 'open'), 'unlocked');
});

test('nothing interrupts a check: only its result leaves the checking state', () => {
  for (const event of ['open', 'submit', 'lock', 'escape']) {
    assert.equal(nextState('checking', event), 'checking', `checking + ${event}`);
  }
});

test('a result arriving outside a check changes nothing', () => {
  for (const state of ['idle', 'open', 'unlocked', 'admin']) {
    for (const event of ['ok-download', 'ok-admin', 'fail']) {
      assert.equal(nextState(state, event), state, `${state} + ${event}`);
    }
  }
});

test('submit only counts while the field is open', () => {
  for (const state of ['idle', 'unlocked', 'admin']) assert.equal(nextState(state, 'submit'), state, `${state} + submit`);
});

test('lock only leaves an unlocked session', () => {
  for (const state of ['idle', 'open', 'admin']) assert.equal(nextState(state, 'lock'), state, `${state} + lock`);
});

test('an unknown event leaves every state as it is (inherited property names included)', () => {
  for (const state of STATES) {
    for (const event of ['bogus', '', undefined, null, 'constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      assert.equal(nextState(state, event), state, `${state} + ${String(event)}`);
    }
  }
});

test('an unknown state is returned unchanged', () => {
  assert.equal(nextState('bogus', 'open'), 'bogus');
  assert.equal(nextState('constructor', 'open'), 'constructor');
});

test('every transition stays inside the five states, and every listed event is used', () => {
  assert.deepEqual([...STATES], ['idle', 'open', 'checking', 'unlocked', 'admin']);
  assert.deepEqual([...EVENTS], ['open', 'submit', 'ok-download', 'ok-admin', 'fail', 'lock', 'escape']);
  const used = new Set();
  for (const state of STATES) {
    for (const event of EVENTS) {
      const next = nextState(state, event);
      assert.ok(STATES.includes(next), `${state} + ${event} -> ${next}`);
      if (next !== state) used.add(event);
    }
  }
  assert.deepEqual([...used].sort(), [...EVENTS].sort());
});
