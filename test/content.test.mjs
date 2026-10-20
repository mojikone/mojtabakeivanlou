import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { icons } from '../assets/js/render/icons.mjs';
import { normalizeSite, validateSite } from '../assets/js/render/model.mjs';

// The live-content guard. The parity tests render the frozen test/fixtures/site.parity.json, so they no longer notice a
// content change; this is what still fails in CI (and stops the deploy) when content/site.json, the file the dashboard
// edits and publishes, stops being valid.
test('content/site.json is valid', async () => {
  const live = JSON.parse(await readFile('content/site.json', 'utf8'));
  assert.deepEqual(validateSite(normalizeSite(live), { icons: Object.keys(icons) }), []);
});
