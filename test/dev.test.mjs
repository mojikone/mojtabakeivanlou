import { test } from 'node:test'; import assert from 'node:assert/strict';
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startDev } from '../src/dev.mjs';
import { live } from './helpers/live.mjs';
import { editSite, withRoot } from './helpers/project.mjs';

const EMAIL = live.profile.email;   // from the live content: the dashboard may change it

// Polls `check` until it returns something truthy; fails with `what` after `ms`.
async function until(check, what, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

// A stub access.mjs keeps the build free of the "asset missing" warning, whatever the repository has by now.
const withAccessStub = (mutate) => async (root) => {
  await writeFile(join(root, 'assets/js/access.mjs'), 'export {};\n');
  if (mutate) await mutate(root);
};

const page = async (dev, path = '/') => {
  const res = await fetch(`${dev.url}${path}`);
  return { status: res.status, text: await res.text() };
};

// Tests that call dev.rebuild() themselves run without the watcher, so no second build can interleave with theirs.
const start = (root, lines, startFn = startDev) => startFn({ root, port: 0, watch: false, log: (line) => lines.push(line) });

test('dev builds, serves dist, and keeps serving the last good build while a rebuild fails', () => withRoot(async (root) => {
  const lines = [];
  const dev = await start(root, lines);
  try {
    assert.ok(lines.some((l) => l.includes(dev.url)), 'the URL is printed');
    assert.match(lines.join('\n'), /^built in \d+ ms$/m);
    let res = await page(dev);
    assert.equal(res.status, 200);
    assert.ok(res.text.includes(EMAIL));
    assert.equal((await page(dev, '/admin/')).status, 200);

    // A failing rebuild logs the errors, one per line, and the last good build stays up.
    await editSite(root, (site) => { site.profile.email = ''; site.profile.firstName = ''; });
    lines.length = 0;
    await dev.rebuild();
    assert.match(lines[0], /rebuild failed/);
    assert.deepEqual(lines.slice(1).map((l) => l.trim()), ['profile.firstName is empty', 'profile.email is empty']);
    res = await page(dev);
    assert.equal(res.status, 200);
    assert.ok(res.text.includes(EMAIL));

    // Fixing the content brings the next build through.
    await editSite(root, (site) => { site.profile.email = 'fixed@example.com'; site.profile.firstName = 'Moji'; });
    lines.length = 0;
    await dev.rebuild();
    assert.deepEqual(lines.map((l) => l.replace(/\d+/, 'N')), ['rebuilt in N ms']);
    assert.ok((await page(dev)).text.includes('fixed@example.com'));
  } finally {
    await dev.close();
  }
}, withAccessStub()));

test('dev logs a warning when it appears or goes away, not on every rebuild', () => withRoot(async (root) => {
  const lines = [];
  const dev = await start(root, lines);
  try {
    const warning = 'asset missing: assets/js/access.mjs';
    assert.equal(lines.filter((l) => l.includes(warning)).length, 1, 'shown by the first build');
    assert.match(lines.join('\n'), /^built in \d+ ms \(1 warning\)$/m);
    await dev.rebuild();
    assert.equal(lines.filter((l) => l.includes(warning)).length, 1, 'not repeated');
    assert.match(lines.at(-1), /^rebuilt in \d+ ms \(1 warning\)$/);
    await writeFile(join(root, 'assets/js/access.mjs'), 'export {};\n');
    await dev.rebuild();
    assert.match(lines.at(-1), /^rebuilt in \d+ ms$/);
  } finally {
    await dev.close();
  }
}, (root) => rm(join(root, 'assets/js/access.mjs'), { force: true })));

test('dev survives a first build that fails, and recovers once the content is fixed', () => withRoot(async (root) => {
  const lines = [];
  const dev = await start(root, lines);
  try {
    assert.match(lines.join('\n'), /build failed/);
    assert.match(lines.join('\n'), /profile\.email is empty/);
    assert.equal((await page(dev)).status, 404);
    await editSite(root, (site) => { site.profile.email = 'ok@example.com'; });
    await dev.rebuild();
    assert.equal((await page(dev)).status, 200);
  } finally {
    await dev.close();
  }
}, withAccessStub((root) => editSite(root, (site) => { site.profile.email = ''; }))));

test('dev rebuilds by itself when a watched file changes', () => withRoot(async (root) => {
  const lines = [];
  const dev = await startDev({ root, port: 0, log: (line) => lines.push(line), debounceMs: 50 });
  try {
    await editSite(root, (site) => { site.profile.email = 'watched@example.com'; });
    await until(async () => (await page(dev)).text.includes('watched@example.com'), 'the watcher to rebuild');
    await until(() => lines.some((l) => /^rebuilt in \d+ ms$/.test(l)), 'the rebuild to be logged');   // logged once the child process has exited

    await writeFile(join(root, 'admin/index.html'), '<p>edited admin</p>');
    await until(async () => (await page(dev, '/admin/')).text.includes('edited admin'), 'a change in admin/ to be rebuilt');
  } finally {
    await dev.close();
  }
}, withAccessStub()));

test('a rebuild runs in a fresh process, so edited templates are picked up', () => withRoot(async (root) => {
  // The project copy carries its own src/ and templates; dev.mjs is imported from that copy.
  const { startDev: startCopy } = await import(pathToFileURL(join(root, 'src/dev.mjs')).href);
  const dev = await start(root, [], startCopy);
  try {
    assert.ok(!(await page(dev, '/thank-you.html')).text.includes('<!-- edited template -->'));
    const file = join(root, 'assets/js/render/thank-you.mjs');
    const source = await readFile(file, 'utf8');
    const head = 'export function renderThankYou(site, ctx) {';
    assert.ok(source.includes(head));
    await writeFile(file, source.replace(head, `${head} return original(site, ctx) + '<!-- edited template -->'; }\nfunction original(site, ctx) {`));
    await dev.rebuild();
    assert.ok((await page(dev, '/thank-you.html')).text.includes('<!-- edited template -->'));
  } finally {
    await dev.close();
  }
}, withAccessStub((root) => cp('src', join(root, 'src'), { recursive: true }))));
