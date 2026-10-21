import { test } from 'node:test'; import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../src/build.mjs';
import { shortHash } from '../src/hash.mjs';
import { yearsOfExperience } from '../assets/js/render/years.mjs';
import { live } from './helpers/live.mjs';
import { editSite, withRoot } from './helpers/project.mjs';

const TODAY = new Date('2026-06-01T00:00:00Z');
const YEARS = yearsOfExperience(live.site.experienceStart, TODAY);   // from the live content: the dashboard may change experienceStart
const PAGES = ['index.html', 'contact.html', 'thank-you.html', 'cv.html'];
const BLOB_ID = 'a'.repeat(32);
const BULLET = 'experience.companies[0].projects[0].bullets[0]';
const MISSING_BLOB = `vault/files/${BLOB_ID}.bin missing for ${BULLET}`;

// ---- helpers ------------------------------------------------------------------------------------------------------

const withBlobRecord = (site) => {
  site.experience.companies[0].projects[0].bullets[0].files = [{ id: BLOB_ID, name: 'x.pdf', size: 1, type: 'application/pdf', enc: true }];
};

// Every file under `dir`, relative and with forward slashes, sorted.
async function listFiles(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name).slice(dir.length + 1).replaceAll('\\', '/')).sort();
}

// ---- the repository itself ---------------------------------------------------------------------------------------

test('build writes pages, copies statics, hashes assets', async () => {
  const out = await mkdtemp(join(tmpdir(), 'dist-'));
  try {
    const r = await build({ outDir: out, today: TODAY });
    for (const f of [...PAGES, 'CNAME', '.nojekyll', 'robots.txt', 'assets/js/palette.js', 'assets/css/cv.css', 'admin/index.html', 'vault/access.json']) {
      assert.ok(existsSync(join(out, f)), f);
    }
    const idx = await readFile(join(out, 'index.html'), 'utf8');
    assert.match(idx, /main\.css\?v=[0-9a-f]{8}/);
    assert.ok(idx.includes(`<span data-years>${YEARS}</span>`), `index.html shows ${YEARS} years`);
    assert.ok((await readFile(join(out, 'assets/js/palette.js'))).equals(await readFile('assets/js/palette.js')), 'palette.js is byte-identical');
    assert.equal(r.years, YEARS);
    assert.ok((await stat(join(out, 'pdf'))).isDirectory(), 'dist/pdf/ exists');
    assert.deepEqual(await readdir(join(out, 'pdf')), [], 'dist/pdf/ is empty');
    assert.match(await readFile(join(out, 'admin/index.html'), 'utf8'), /<meta name="robots" content="noindex">/);
    assert.ok((await readFile(join(out, 'vault/access.json'))).equals(await readFile('vault/access.json')), 'vault/access.json is copied as is');
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('build returns { years, written, warnings } with written listing every file in the output, sorted', async () => {
  const out = await mkdtemp(join(tmpdir(), 'dist-'));
  try {
    const r = await build({ outDir: out, today: TODAY });
    assert.deepEqual(Object.keys(r).sort(), ['warnings', 'written', 'years']);
    assert.equal(typeof r.years, 'number');
    assert.ok(Array.isArray(r.warnings) && r.warnings.every((w) => typeof w === 'string'));
    assert.deepEqual(r.written, await listFiles(out));
    for (const f of [...PAGES, 'CNAME', '.nojekyll', 'robots.txt', 'admin/index.html', 'assets/js/palette.js']) assert.ok(r.written.includes(f), f);
    assert.ok(r.written.every((f) => !f.startsWith('/') && !f.includes('\\')), 'relative, forward slashes');
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('every ?v= in the pages is the short hash of the file it points at', async () => {
  const out = await mkdtemp(join(tmpdir(), 'dist-'));
  try {
    const r = await build({ outDir: out, today: TODAY });
    const hash = async (path) => shortHash(await readFile(path));
    const index = await readFile(join(out, 'index.html'), 'utf8');
    const cv = await readFile(join(out, 'cv.html'), 'utf8');
    for (const path of ['assets/css/main.css', 'assets/js/main.js', 'assets/js/palette.js']) assert.ok(index.includes(`${path}?v=${await hash(path)}`), `index.html: ${path}`);
    for (const path of ['assets/css/cv.css', 'assets/js/palette.js']) assert.ok(cv.includes(`${path}?v=${await hash(path)}`), `cv.html: ${path}`);
    assert.ok(!index.includes('cv.css') && !cv.includes('main.css'), 'each page links only its own stylesheet');
    assert.deepEqual(r.warnings.filter((w) => /main\.css|cv\.css|main\.js|palette\.js/.test(w)), [], 'the four existing assets raise no warning');
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

// ---- temp roots: warnings ----------------------------------------------------------------------------------------

test('build warns, in the documented form, when a referenced blob is missing', () => withRoot(async (root) => {
  const r = await build({ root, today: TODAY });
  assert.match(r.warnings[0], /vault\/files\/a{32}\.bin missing/);
  assert.equal(r.warnings[0], MISSING_BLOB);
  assert.deepEqual(r.warnings.filter((w) => w.startsWith('vault/files/')), [MISSING_BLOB]);
  assert.ok(existsSync(join(root, 'dist/index.html')), 'a warning does not stop the build');
}, (root) => editSite(root, withBlobRecord)));

test('build warns once per missing file, naming the bullet by its indexes', () => withRoot(async (root) => {
  const r = await build({ root, today: TODAY });
  assert.deepEqual(r.warnings.filter((w) => w.startsWith('vault/files/')), [
    MISSING_BLOB,
    `vault/files/${'b'.repeat(32)}.bin missing for ${BULLET}`,
    `vault/files/${BLOB_ID}.bin missing for experience.companies[1].projects[0].bullets[0]`,
  ]);
}, (root) => editSite(root, (site) => {
  withBlobRecord(site);
  site.experience.companies[0].projects[0].bullets[0].files.push({ id: 'b'.repeat(32), name: 'y.pdf', size: 2, type: 'application/pdf', enc: true });
  site.experience.companies[1].projects[0].bullets[0].files = [{ id: BLOB_ID, name: 'x.pdf', size: 1, type: 'application/pdf', enc: true }];
})));

test('build does not warn when the blob is present, and ships it', () => withRoot(async (root) => {
  const r = await build({ root, today: TODAY });
  assert.deepEqual(r.warnings.filter((w) => w.startsWith('vault/files/')), []);
  assert.equal(await readFile(join(root, 'dist/vault/files', `${BLOB_ID}.bin`), 'utf8'), 'sealed');
  assert.ok(r.written.includes(`vault/files/${BLOB_ID}.bin`));
}, async (root) => {
  await editSite(root, withBlobRecord);
  await mkdir(join(root, 'vault/files'), { recursive: true });
  await writeFile(join(root, 'vault/files', `${BLOB_ID}.bin`), 'sealed');
}));

test('a listed asset that does not exist is skipped with a warning and its ?v= falls back to dev', () => withRoot(async (root) => {
  const r = await build({ root, today: TODAY });
  assert.ok(r.warnings.includes('asset missing: assets/js/main.js'));
  assert.ok(r.warnings.includes('asset missing: assets/js/access.mjs'));
  assert.equal(r.warnings.filter((w) => w.startsWith('asset missing: ')).length, 2);
  const index = await readFile(join(root, 'dist/index.html'), 'utf8');
  assert.ok(index.includes('assets/js/main.js?v=dev') && index.includes('assets/js/access.mjs?v=dev'));
  assert.match(index, /main\.css\?v=[0-9a-f]{8}/);
}, async (root) => {
  await rm(join(root, 'assets/js/main.js'));
  await rm(join(root, 'assets/js/access.mjs'), { force: true });   // absent today; the line keeps the test valid once a later task adds it
}));

test('access.mjs, once it exists, is hashed like the others and raises no warning', () => withRoot(async (root) => {
  const r = await build({ root, today: TODAY });
  assert.deepEqual(r.warnings, []);
  const index = await readFile(join(root, 'dist/index.html'), 'utf8');
  assert.ok(index.includes(`assets/js/access.mjs?v=${shortHash(Buffer.from('export {};\n'))}`));
}, (root) => writeFile(join(root, 'assets/js/access.mjs'), 'export {};\n')));

test('missing static files are warnings, not failures', () => withRoot(async (root) => {
  const r = await build({ root, today: TODAY });
  assert.ok(r.warnings.includes('static file missing: robots.txt'));
  assert.ok(r.warnings.includes('static file missing: CNAME'));
  assert.ok(!existsSync(join(root, 'dist/robots.txt')) && !existsSync(join(root, 'dist/CNAME')));
  assert.ok(existsSync(join(root, 'dist/.nojekyll')));
}, async (root) => {
  await rm(join(root, 'robots.txt'));
  await rm(join(root, 'CNAME'));
}));

// ---- temp roots: optional folders, stale output, output location -------------------------------------------------

test('building a root without vault/ and admin/ succeeds and ships neither', () => withRoot(async (root) => {
  const r = await build({ root, today: TODAY });
  for (const f of PAGES) assert.ok(existsSync(join(root, 'dist', f)), f);
  assert.ok(!existsSync(join(root, 'dist/vault')) && !existsSync(join(root, 'dist/admin')));
  assert.ok(r.written.every((f) => !f.startsWith('vault/') && !f.startsWith('admin/')));
  // The live content may reference attachments; with vault/ absent their blobs are (correctly) reported missing.
  // Only the FOLDERS' absence must stay silent.
  const folderWarnings = r.warnings.filter((w) => /vault|admin/.test(w) && !/^vault\/files\/[0-9a-f]{32}\.bin missing/.test(w));
  assert.deepEqual(folderWarnings, [], 'their absence is not worth a warning');
  assert.ok((await stat(join(root, 'dist/pdf'))).isDirectory());
}, async (root) => {
  await rm(join(root, 'vault'), { recursive: true });
  await rm(join(root, 'admin'), { recursive: true });
}));

test('vault/ is copied recursively, blobs included', () => withRoot(async (root) => {
  await build({ root, today: TODAY });
  assert.ok((await readFile(join(root, 'dist/vault/access.json'))).equals(await readFile(join(root, 'vault/access.json'))));
  assert.ok((await readFile(join(root, 'dist/vault/keys.json'))).equals(await readFile(join(root, 'vault/keys.json'))));
  assert.equal(await readFile(join(root, 'dist/vault/files/deep/x.bin'), 'utf8'), 'x');
}, async (root) => {
  await mkdir(join(root, 'vault/files/deep'), { recursive: true });
  await writeFile(join(root, 'vault/files/deep/x.bin'), 'x');
}));

test('build empties the output folder first, so stale files never linger', () => withRoot(async (root) => {
  const dist = join(root, 'dist');
  await mkdir(join(dist, 'assets'), { recursive: true });
  await mkdir(join(dist, 'old-dir'), { recursive: true });
  await writeFile(join(dist, 'stale.txt'), 'x');
  await writeFile(join(dist, 'assets/removed.js'), 'x');
  await writeFile(join(dist, 'old-dir/a.html'), 'x');
  const r = await build({ root, today: TODAY });   // outDir defaults to "dist", relative to the root
  assert.ok(!existsSync(join(dist, 'stale.txt')) && !existsSync(join(dist, 'assets/removed.js')) && !existsSync(join(dist, 'old-dir')));
  assert.deepEqual(r.written, await listFiles(dist));
}));

test('a relative outDir is resolved against root, not the working directory', () => withRoot(async (root) => {
  await build({ root, outDir: 'out/site', today: TODAY });
  assert.ok(existsSync(join(root, 'out/site/index.html')));
  assert.ok(!existsSync(join('out', 'site')), 'nothing written below the working directory');
}));

test('build refuses an output folder that would delete its own sources', () => withRoot(async (root) => {
  for (const outDir of ['.', '..', root, join(root, 'assets'), join(root, 'vault', 'files'), join(root, 'content')]) {
    await assert.rejects(build({ root, outDir, today: TODAY }), /outDir/, outDir);
  }
  for (const f of ['content/site.json', 'assets/css/main.css', 'CNAME', 'vault/access.json', 'admin/index.html']) assert.ok(existsSync(join(root, f)), `${f} survived`);
}));

// ---- temp roots: invalid input -----------------------------------------------------------------------------------

test('build fails on invalid content, listing every problem, and leaves the previous output alone', () => withRoot(async (root) => {
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'dist/last-good.html'), 'last good');
  await assert.rejects(build({ root, today: TODAY }), (err) => {
    assert.match(err.message, /profile\.email/);
    assert.match(err.message, /profile\.firstName/);
    assert.deepEqual(err.errors, err.message.split('\n'), 'one error per line');
    assert.equal(err.errors.length, 2);
    return true;
  });
  assert.equal(await readFile(join(root, 'dist/last-good.html'), 'utf8'), 'last good');
  assert.ok(!existsSync(join(root, 'dist/index.html')));
}, (root) => editSite(root, (site) => { site.profile.email = ''; site.profile.firstName = '   '; })));

test('build reports a content file that is not JSON, or not there, by name', async () => {
  await withRoot(async (root) => {
    await assert.rejects(build({ root, today: TODAY }), (err) => /content\/site\.json/.test(err.message) && Array.isArray(err.errors) && err.errors.length === 1);
  }, (root) => writeFile(join(root, 'content/site.json'), '{ "schemaVersion": 1, '));
  await withRoot(async (root) => {
    await assert.rejects(build({ root, today: TODAY }), (err) => /content\/site\.json/.test(err.message));
  }, (root) => rm(join(root, 'content/site.json')));
});

test('build normalises before it validates: a company without an id is given one', () => withRoot(async (root) => {
  // The validator reports a missing id as an error, so this only builds because normalizeSite ran first.
  const r = await build({ root, today: TODAY });
  assert.equal(r.years, YEARS);
  assert.ok(existsSync(join(root, 'dist/index.html')));
}, (root) => editSite(root, (site) => { delete site.experience.companies[0].id; })));

test('build validates the icon names against the icon table', () => withRoot(async (root) => {
  await assert.rejects(build({ root, today: TODAY }), /services\.items\[0\]\.icon .*not a known icon/);
}, (root) => editSite(root, (site) => { site.services.items[0].icon = 'no-such-icon'; })));

test('build validates against the given today: an experienceStart in its future is an error', () => withRoot(async (root) => {
  await assert.rejects(build({ root, today: new Date('2001-01-01T00:00:00Z') }), /site\.experienceStart is in the future/);
}));
