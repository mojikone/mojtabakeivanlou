// The public unlock flow when the vault key of a session has gone stale (M3): assets/js/access.mjs, loaded in Node on
// a small fake page (the pill markup, two download icons, sessionStorage, fetch and timers stubbed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKey, exportKey, encryptFile, wrapFileKey, randomId, createKeysFile, shortId } from '../assets/js/vault.mjs';

class El {
  constructor(tag, { cls = [], dataset = {} } = {}) {
    this.tagName = tag.toUpperCase();
    this.attrs = {};
    this.dataset = { ...dataset };
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.textContent = '';
    this.listeners = {};
    this.parts = {};                        // selector -> element, for querySelector
    this.offsetWidth = 0;
    const classes = new Set(cls);
    this.classList = {
      add: (...names) => names.forEach((n) => classes.add(n)),
      remove: (...names) => names.forEach((n) => classes.delete(n)),
      contains: (name) => classes.has(name),
    };
  }

  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null; }
  removeAttribute(name) { delete this.attrs[name]; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  querySelector(selector) { return this.parts[selector] ?? null; }
  contains(node) { return node === this; }
  closest(selector) { return selector === 'a.proj-dl' && this.classList.contains('proj-dl') ? this : null; }
  focus() {}
  replaceChild() {}
}

function memoryStorage(initial) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
}

// The hero pill as the index template renders it, wired for mountAccessPill.
function pillMarkup() {
  const root = new El('div', { cls: ['hero-contact-link', 'access-pill'] });
  const main = new El('button');
  const label = new El('span');
  const form = new El('form');
  main.parts.svg = new El('svg');
  form.parts['input[name="code"]'] = new El('input');
  form.parts['button[type="submit"]'] = new El('button');
  Object.assign(root.parts, { '.access-pill-main': main, '.access-pill-label': label, '.access-pill-form': form });
  return root;
}

test('a download with a vault key that no longer opens the files: session forgotten, icons hidden, pill idle and marked for 4 s', async () => {
  // the vault as it is now: one file, its key wrapped under the CURRENT vault key
  const current = await generateKey();
  const fk = await generateKey();
  const fileId = randomId();
  const blob = await encryptFile(fk, new TextEncoder().encode('report'));
  const keys = { ...createKeysFile(shortId()), files: { [fileId]: await wrapFileKey(current, fk) } };
  const staleKey = await exportKey(await generateKey());   // what the session kept from before a rotation

  const root = pillMarkup();
  const spans = [new El('span', { cls: ['proj-files'] }), new El('span', { cls: ['proj-files'] })];
  spans.forEach((s) => { s.hidden = true; });
  const docListeners = {};
  const document = {
    body: new El('body'),
    activeElement: null,
    getElementById: (id) => (id === 'accessPill' ? root : null),
    querySelectorAll: (selector) => (selector === '.proj-files' ? spans : []),
    addEventListener: (type, fn) => { (docListeners[type] ??= []).push(fn); },
    createElement: (tag) => (tag === 'template' ? { innerHTML: '', content: { firstElementChild: new El('svg') } } : new El(tag)),
  };
  const storage = memoryStorage({ 'mk.vault': staleKey });
  const warnings = [];
  const timers = [];
  const saved = Object.fromEntries(['document', 'Element', 'sessionStorage', 'fetch', 'setTimeout', 'clearTimeout'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const realWarn = console.warn;
  const define = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  try {
    define('document', document);
    define('Element', El);
    define('sessionStorage', storage);
    define('fetch', async (path) => {
      if (path === 'vault/keys.json') return { ok: true, status: 200, json: async () => keys };
      if (path === `vault/files/${fileId}.bin`) return { ok: true, status: 200, arrayBuffer: async () => blob.slice().buffer };
      return { ok: false, status: 404 };
    });
    define('setTimeout', (fn, ms) => { timers.push({ fn, ms }); return timers.length; });
    define('clearTimeout', () => {});
    console.warn = (message) => { warnings.push(String(message)); };

    await import('../assets/js/access.mjs');
    assert.equal(root.dataset.state, 'unlocked', 'a stored vault key unlocks the page on load');
    assert.ok(spans.every((s) => !s.hidden));

    // The click handler leaves the promise of the download it started on the anchor (_mkDownload); awaiting it is
    // deterministic, where polling the event loop races the WebCrypto work, which runs on the thread pool.
    const click = async (anchor) => {
      for (const fn of docListeners.click) fn({ target: anchor, preventDefault() {} });
      assert.ok(anchor._mkDownload instanceof Promise, 'the click handler started a download');
      await anchor._mkDownload;
    };

    // a file the keys file does not list is an ordinary failure: the icon is marked, the session stays
    const unknown = new El('a', { cls: ['proj-dl'], dataset: { file: randomId(), enc: 'true', name: 'x.pdf' } });
    await click(unknown);
    assert.equal(unknown.classList.contains('is-error'), true);
    assert.equal(storage.getItem('mk.vault'), staleKey);
    assert.equal(root.dataset.state, 'unlocked');

    // the stale key: it opens no file key
    const icon = new El('a', { cls: ['proj-dl'], dataset: { file: fileId, enc: 'true', name: 'report.pdf' } });
    await click(icon);
    assert.equal(storage.getItem('mk.vault'), null, 'mk.vault is cleared');
    assert.ok(spans.every((s) => s.hidden), 'the icons are hidden again');
    assert.equal(root.dataset.state, 'idle', 'the pill is back to idle');
    assert.equal(root.classList.contains('is-error'), true);
    assert.equal(root.getAttribute('title'), 'Code no longer valid — enter it again');
    assert.equal(icon.classList.contains('is-error'), false, 'the reason is on the pill, not on a hidden icon');
    assert.deepEqual(warnings.slice(-1), ['[access] download failed: StaleKeyError']);
    for (const w of warnings) assert.ok(!w.includes(staleKey), 'no key in a warning');

    // four seconds later the mark goes, and the pill's own title with it
    const mark = timers.filter((t) => t.ms === 4000).at(-1);
    mark.fn();
    assert.equal(root.classList.contains('is-error'), false);
    assert.equal(root.getAttribute('title'), null);
  } finally {
    console.warn = realWarn;
    for (const [name, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
