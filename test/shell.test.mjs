// Dashboard shell helpers, section registry and size limits (Task 16, spec 13.1, 13.3, 13.4, 13.8, 13.9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSION_KEYS, toSession, readSession, writeSession, clearSession, loadBase, relativeTime, changesText, statusText,
  profileName, routeOf,
} from '../admin/modules/shell.mjs';
import { sections, setupSection } from '../admin/sections/index.mjs';
import { FILE_MAX, FILE_NOTE, TOTAL_AMBER, TOTAL_RED } from '../admin/modules/limits.mjs';
import { GitHubError } from '../admin/modules/github.mjs';

const GITHUB = { token: 'ghp_FAKE', owner: 'octo', repo: 'site', branch: 'main' };
const SESSION = { entryId: 'ab12cd34', vk: 'dmF1bHQta2V5', kek: 'a2VrLWtleQ==', github: GITHUB };

function memStorage(initial = {}, { failOn } = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => {
      if (k === failOn) throw new Error('QuotaExceededError');
      data.set(k, String(v));
    },
    removeItem: (k) => { data.delete(k); },
  };
}

const stored = (s = SESSION) => ({ 'mk.admin': JSON.stringify({ entryId: s.entryId, vk: s.vk, github: s.github }), 'mk.vault': s.vk, 'mk.kek': s.kek });

/* ─── session ─── */

test('readSession returns the session the public unlock flow stores', () => {
  assert.deepEqual(readSession(memStorage(stored())), SESSION);
});

test('readSession is null when any of the three keys is missing or malformed', () => {
  for (const key of SESSION_KEYS) {
    const data = stored();
    delete data[key];
    assert.equal(readSession(memStorage(data)), null, `without ${key}`);
  }
  assert.equal(readSession(memStorage({ ...stored(), 'mk.admin': '{not json' })), null);
  assert.equal(readSession(memStorage({ ...stored(), 'mk.admin': JSON.stringify({ vk: 'x', github: { ...GITHUB, token: '' } }) })), null);
  assert.equal(readSession(memStorage({ ...stored(), 'mk.admin': 'null' })), null);
  assert.equal(readSession(null), null);
  assert.equal(readSession({ getItem() { throw new Error('SecurityError'); } }), null);
});

test('writeSession stores all three keys, or none of them when storage fails', () => {
  const ok = memStorage();
  assert.equal(writeSession(ok, SESSION), true);
  assert.deepEqual(readSession(ok), SESSION);
  assert.deepEqual(JSON.parse(ok.data.get('mk.admin')), { entryId: SESSION.entryId, vk: SESSION.vk, github: GITHUB });

  const full = memStorage({}, { failOn: 'mk.kek' });
  assert.equal(writeSession(full, SESSION), false);
  assert.equal(full.data.size, 0, 'no partial session');
  assert.equal(writeSession(null, SESSION), false);
});

test('clearSession removes exactly the three session keys (the draft stays)', () => {
  const s = memStorage({ ...stored(), 'mk.draft': '{}' });
  clearSession(s);
  assert.deepEqual([...s.data.keys()], ['mk.draft']);
  clearSession(null);
  clearSession({ removeItem() { throw new Error('SecurityError'); } });
});

test('toSession keeps only the known fields and refuses an incomplete one', () => {
  assert.deepEqual(toSession({ ...SESSION, extra: 1, github: { ...GITHUB, extra: 2 } }), SESSION);
  assert.equal(toSession({ ...SESSION, kek: '' }), null);
  assert.equal(toSession({ ...SESSION, github: undefined }), null);
  assert.equal(toSession(), null);
});

/* ─── draft base ─── */

const enc = (value) => new TextEncoder().encode(JSON.stringify(value));

function fakeGitHub(files, { head = { sha: 'head-sha', tree: 'tree-sha' }, fail } = {}) {
  const calls = [];
  return {
    calls,
    async getHead() { calls.push('head'); if (fail) throw fail; return head; },
    async getFile(path) {
      calls.push(path);
      return Object.hasOwn(files, path) ? files[path] : null;
    },
  };
}

test('loadBase fetches the head and the three files and shapes them for store.init()', async () => {
  const site = { profile: { firstName: 'Ada', lastName: 'Lovelace' } };
  const access = { v: 1, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 1000, salt: 'c2FsdHNhbHRzYWx0c2FsdA==' }, entries: [] };
  const keys = { v: 1, vk: 'abcd1234', files: {} };
  const gh = fakeGitHub({
    'content/site.json': { sha: 'sha-site', bytes: enc(site) },
    'vault/access.json': { sha: 'sha-access', bytes: enc(access) },
    'vault/keys.json': { sha: 'sha-keys', bytes: enc(keys) },
  });
  assert.deepEqual(await loadBase(gh), {
    commit: 'head-sha',
    shas: { site: 'sha-site', access: 'sha-access', keys: 'sha-keys' },
    site,
    access,
    keys,
  });
  assert.deepEqual(gh.calls.sort(), ['content/site.json', 'head', 'vault/access.json', 'vault/keys.json']);
});

test('loadBase turns a missing access or keys file into the empty shapes', async () => {
  const gh = fakeGitHub({ 'content/site.json': { sha: 'sha-site', bytes: enc({}) } });
  const base = await loadBase(gh);
  assert.deepEqual(base.shas, { site: 'sha-site', access: null, keys: null });
  assert.equal(base.access.v, 1);
  assert.deepEqual(base.access.entries, []);
  assert.equal(base.access.kdf.name, 'PBKDF2');
  assert.deepEqual(base.keys, { v: 1, vk: '', files: {} });
});

test('loadBase rejects a missing or broken site.json, and passes GitHub errors through', async () => {
  await assert.rejects(loadBase(fakeGitHub({})), /content\/site\.json is missing/);
  await assert.rejects(
    loadBase(fakeGitHub({ 'content/site.json': { sha: 's', bytes: new TextEncoder().encode('{oops') } })),
    /content\/site\.json on GitHub is not valid JSON/,
  );
  const auth = new GitHubError(401, 'GitHub answered 401');
  await assert.rejects(loadBase(fakeGitHub({}, { fail: auth })), (err) => err === auth);
});

/* ─── top bar ─── */

test('relativeTime', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');
  const ago = (ms) => new Date(now - ms).toISOString();
  assert.equal(relativeTime(ago(5e3), now), 'just now');
  assert.equal(relativeTime(ago(-30e3), now), 'just now');
  assert.equal(relativeTime(ago(2 * 60e3 + 5e3), now), '2 min ago');
  assert.equal(relativeTime(ago(3 * 3600e3), now), '3 h ago');
  assert.equal(relativeTime(ago(26 * 3600e3), now), '1 day ago');
  assert.equal(relativeTime(ago(12 * 86400e3), now), '12 days ago');
  assert.equal(relativeTime('2026-03-03T09:00:00Z', now), 'on 3 Mar 2026');
  assert.equal(relativeTime('not a date', now), '—');
});

test('statusText: Live, the last publish when known, and the unpublished changes once the draft is loaded', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');
  assert.equal(statusText({ published: undefined, now }), 'Live');
  assert.equal(statusText({ published: null, now }), 'Live · —');
  assert.equal(statusText({ published: '2026-10-21T11:58:00Z', changes: 3, now }), 'Live · published 2 min ago · 3 unpublished changes');
  assert.equal(statusText({ published: null, changes: 1, now }), 'Live · — · 1 unpublished change');
  assert.equal(changesText(0), 'no unpublished changes');
});

test('profileName joins the draft profile names', () => {
  assert.equal(profileName({ profile: { firstName: 'Ada', lastName: 'Lovelace' } }), 'Ada Lovelace');
  assert.equal(profileName({ profile: { firstName: 'Ada', lastName: ' ' } }), 'Ada');
  assert.equal(profileName(null), '');
});

/* ─── route and sections ─── */

test('the nav lists the ten sections of spec 13.3 in order, content first, then the admin group', () => {
  assert.deepEqual(sections.map((s) => s.id), ['profile', 'education', 'languages', 'services', 'experience', 'skills', 'contact', 'access', 'files', 'settings']);
  assert.deepEqual(sections.map((s) => s.label), [
    'Profile & contact', 'Education', 'Languages', 'Engineering services', 'Experience', 'Skills & software',
    'Contact page', 'Access codes', 'Files', 'Settings',
  ]);
  assert.deepEqual(sections.map((s) => s.group), [...Array(7).fill('content'), ...Array(3).fill('admin')]);
  for (const s of [...sections, setupSection]) assert.equal(typeof s.render, 'function', s.id);
});

test('a placeholder section writes its escaped "coming soon" heading; setup names Task 24', () => {
  const container = { innerHTML: '' };
  sections[0].render(container, null, {});
  assert.equal(container.innerHTML, '<div class="adm-card"><h1 class="adm-title">Profile &amp; contact — coming soon</h1></div>');
  setupSection.render(container, null, { github: null, session: null });
  assert.match(container.innerHTML, /Setup wizard — Task 24/);
});

test('routeOf maps the hash to a section id, #setup to setup, and anything else to the first section', () => {
  const ids = sections.map((s) => s.id);
  assert.equal(routeOf('#experience', ids), 'experience');
  assert.equal(routeOf('#setup', ids), 'setup');
  assert.equal(routeOf('', ids), 'profile');
  assert.equal(routeOf('#nope', ids), 'profile');
  assert.equal(routeOf('#%E0%A4%A', ids), 'profile', 'a malformed escape does not throw');
});

/* ─── limits ─── */

test('size limits (spec 13.9)', () => {
  assert.equal(FILE_MAX, 100 * 1024 * 1024);
  assert.equal(FILE_NOTE, 50 * 1024 * 1024);
  assert.equal(TOTAL_AMBER, 700 * 1024 * 1024);
  assert.equal(TOTAL_RED, 900 * 1024 * 1024);
});

/* ─── the page ─── */

test('admin modules import only relative, browser-safe paths, so the page works from dist/admin/', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const files = (await readdir('admin', { recursive: true })).filter((f) => f.endsWith('.mjs'));
  assert.ok(files.length >= 6, files.join(', '));
  for (const file of files) {
    const source = await readFile(`admin/${file}`, 'utf8');
    for (const [, spec] of source.matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]/gm)) {
      assert.match(spec, /^\.\.?\//, `${file} imports ${spec}`);
    }
    assert.doesNotMatch(source, /\bprocess\.|\brequire\(|['"]node:/, file);
  }
});

test('admin/index.html: noindex, the site stylesheet then admin.css, and admin.mjs as a module', async () => {
  const { readFile } = await import('node:fs/promises');
  const page = await readFile('admin/index.html', 'utf8');
  assert.match(page, /<meta name="robots" content="noindex">/);
  assert.ok(page.indexOf('href="../assets/css/main.css"') < page.indexOf('href="admin.css"'));
  assert.match(page, /<script type="module" src="admin\.mjs"><\/script>/);
  assert.match(page, /fonts\.googleapis\.com\/css2\?family=Poppins/);
});
