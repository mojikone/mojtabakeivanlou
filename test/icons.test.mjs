import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { icons, icon } from '../assets/js/render/icons.mjs';
import { Raw } from '../assets/js/render/html.mjs';

test('every required icon exists and renders with attrs', () => {
  for (const n of ['mail','phone','whatsapp','download','arrowRight','chevron','waves','road','hydrology','dam','network','drop','globe','survey','automation','linkedin','pin','send','check','key','lockOpen','paperclip']) assert.ok(icons[n], n);
  assert.match(icon('chevron', { class: 'exp-card-chev' }).html, /^<svg[^>]*class="exp-card-chev"/);
  assert.throws(() => icon('nope'));
});

test('every icon is a complete <svg> element without a class attribute', () => {
  for (const [name, svg] of Object.entries(icons)) {
    assert.ok(svg.startsWith('<svg'), `${name} starts with <svg`);
    assert.ok(svg.endsWith('</svg>'), `${name} ends with </svg>`);
    assert.ok(!/^<svg[^>]*\bclass=/.test(svg), `${name} has no class in its start tag`);
  }
});

test('icon() without attrs returns the stored markup unchanged, as Raw', () => {
  for (const name of Object.keys(icons)) {
    const out = icon(name);
    assert.ok(out instanceof Raw, name);
    assert.equal(out.html, icons[name], name);
  }
});

test('icon() replaces present attributes in place and puts new ones first', () => {
  const out = icon('waves', { class: 'x', width: '16', height: '16' }).html;
  assert.ok(out.startsWith('<svg class="x" width="16" height="16" viewBox="0 0 24 24" '), out);
  assert.equal(out.match(/ width=/g).length, 1);
  assert.equal(out.slice(out.indexOf('>')), icons.waves.slice(icons.waves.indexOf('>')), 'children untouched');
});

test('icon() escapes attribute values and rejects unsafe attribute names', () => {
  assert.match(icon('mail', { 'aria-label': 'a "b" <c> & \'d\'' }).html, /^<svg aria-label="a &quot;b&quot; &lt;c&gt; &amp; &#39;d&#39;" /);
  assert.throws(() => icon('mail', { 'x onload="alert(1)"': '1' }), /Invalid attribute name/);
});

test('icon() removes an attribute whose value is null, undefined or false', () => {
  const out = icon('mail', { width: null, height: undefined, 'stroke-width': false, class: 'k' }).html;
  assert.ok(out.startsWith('<svg class="k" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"'), out);
  assert.ok(!/width=|height=/.test(out.slice(0, out.indexOf('>'))));
});

test('icon() throws Unknown icon for names that are not own keys', () => {
  assert.throws(() => icon('nope'), { message: 'Unknown icon nope' });
  for (const n of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) assert.throws(() => icon(n), /Unknown icon/);
});

// Every <svg> in the four original pages must be reproducible from the library: same children, and a start tag that
// differs from the stored one only in class, width, height and stroke-width (the attributes callers override).
// icon() fed that difference must give back the original markup byte for byte.
test('every svg in the original pages is covered by an icon', () => {
  const OVERRIDABLE = ['class', 'width', 'height', 'stroke-width'];
  const parse = (svg) => {
    const m = svg.match(/^<svg([^>]*)>([\s\S]*)<\/svg>$/);
    const all = new Map([...m[1].matchAll(/([^\s=]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    const fixed = Object.fromEntries([...all].filter(([k]) => !OVERRIDABLE.includes(k)));
    return { all, fixed, inner: m[2] };
  };
  const stored = Object.entries(icons).map(([name, svg]) => ({ name, ...parse(svg) }));
  let seen = 0;
  for (const page of ['index', 'contact', 'thank-you', 'cv']) {
    const text = readFileSync(new URL(`./fixtures/original/${page}.html`, import.meta.url), 'utf8');
    for (const [svg] of text.matchAll(/<svg[\s\S]*?<\/svg>/g)) {
      const { all, fixed, inner } = parse(svg);
      const match = stored.find((s) => s.inner === inner);
      assert.ok(match, `${page}: no icon has the children of ${svg.slice(0, 120)}`);
      assert.deepEqual(fixed, match.fixed, `${page}: ${match.name} start tag differs beyond class/size/stroke-width`);

      const attrs = {};
      for (const [k, v] of all) if (match.all.get(k) !== v) attrs[k] = v;
      for (const k of match.all.keys()) if (!all.has(k)) attrs[k] = null;
      assert.equal(icon(match.name, attrs).html, svg, `${page}: ${match.name} with ${JSON.stringify(attrs)}`);
      seen++;
    }
  }
  assert.ok(seen >= 80, `expected to check every svg in the fixtures, saw ${seen}`);
});

test('icons.mjs is browser-safe: it imports nothing from Node', () => {
  const source = readFileSync(new URL('../assets/js/render/icons.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from\s+['"]node:/);
  assert.doesNotMatch(source, /\brequire\s*\(/);
  assert.doesNotMatch(source, /\bprocess\./);
});
