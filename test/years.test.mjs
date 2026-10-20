import { test } from 'node:test'; import assert from 'node:assert/strict';
import { yearsOfExperience as y } from '../assets/js/render/years.mjs';
test('counts full years', () => {
  assert.equal(y('2009-09-23', new Date('2026-10-20T00:00:00Z')), 17);
  assert.equal(y('2009-09-23', new Date('2026-06-01T00:00:00Z')), 16);
  assert.equal(y('2009-09-23', new Date('2026-09-22T23:59:59Z')), 16);
  assert.equal(y('2009-09-23', new Date('2026-09-23T00:00:00Z')), 17);   // rollover day
  assert.equal(y('2008-02-29', new Date('2009-02-28T00:00:00Z')), 0);
  assert.equal(y('2008-02-29', new Date('2009-03-01T00:00:00Z')), 1);
});
test('rejects a bad date', () => { assert.throws(() => y('23/09/2009', new Date())); });
test('rejects an impossible calendar date', () => { assert.throws(() => y('2009-13-40', new Date())); });
