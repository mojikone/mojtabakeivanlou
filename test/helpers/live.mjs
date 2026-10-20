// The live content, content/site.json, read once. For the tests that build or serve the repository's real content (build.test.mjs,
// dev.test.mjs): the dashboard edits that file, so such a test derives what it expects from it and never hard-codes a value from it.
// The tests that need the content as it was extracted from the original pages read test/fixtures/site.parity.json instead.
// Paths are relative to the working directory, which is the repository root under `npm test`.
import { readFile } from 'node:fs/promises';

export const live = JSON.parse(await readFile('content/site.json', 'utf8'));
