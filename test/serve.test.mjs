import { test } from 'node:test'; import assert from 'node:assert/strict';
import { startServer } from '../src/serve.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('serves index.html for a directory and sets content-type', async () => {
  const s = await startServer('test/fixtures/original');
  const r = await fetch(`${s.url}/`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.match(await r.text(), /Mojtaba Keivanlou/);
  const missing = await fetch(`${s.url}/nope.html`);
  assert.equal(missing.status, 404);
  await s.close();
});

// Extra coverage for the rules in the task decisions: MIME table, no listing, no traversal.
// fetch() normalises dot segments, so raw requests need node:http.
function rawGet(port, path) {
  return new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port, path }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    }).on('error', reject).end();
  });
}

async function withSite(run) {
  const base = await mkdtemp(join(tmpdir(), 'serve-test-'));
  const site = join(base, 'site');
  await mkdir(join(site, 'empty'), { recursive: true });
  await writeFile(join(base, 'secret.txt'), 'outside the served root');
  await writeFile(join(site, 'index.html'), '<p>home</p>');
  const types = {
    css: /^text\/css/, js: /^text\/javascript/, mjs: /^text\/javascript/, json: /^application\/json/,
    png: /^image\/png$/, jpg: /^image\/jpeg$/, jpeg: /^image\/jpeg$/, webp: /^image\/webp$/,
    svg: /^image\/svg\+xml$/, pdf: /^application\/pdf$/, bin: /^application\/octet-stream$/,
    txt: /^text\/plain/, ico: /^image\/x-icon$/,
  };
  for (const ext of Object.keys(types)) await writeFile(join(site, `f.${ext}`), 'x');
  const s = await startServer(site);
  try { await run(s, types); } finally { await s.close(); await rm(base, { recursive: true, force: true }); }
}

test('sends the right content-type for each supported extension', () => withSite(async (s, types) => {
  for (const [ext, expected] of Object.entries(types)) {
    const r = await fetch(`${s.url}/f.${ext}`);
    assert.equal(r.status, 200, ext);
    assert.match(r.headers.get('content-type'), expected, ext);
    await r.arrayBuffer();
  }
}));

test('never lists a directory without index.html', () => withSite(async (s) => {
  const r = await fetch(`${s.url}/empty/`);
  assert.equal(r.status, 404);
  assert.doesNotMatch(await r.text(), /f\.css/);
}));

test('rejects any path containing ".." with 404', () => withSite(async (s) => {
  for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/empty/../../secret.txt', '/..%5csecret.txt']) {
    assert.equal(await rawGet(s.port, path), 404, path);
  }
}));

test('binds to 127.0.0.1 and reports a url without trailing slash', () => withSite(async (s) => {
  assert.equal(s.url, `http://127.0.0.1:${s.port}`);
  assert.ok(s.port > 0);
}));
