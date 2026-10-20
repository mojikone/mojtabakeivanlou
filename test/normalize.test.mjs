import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeHtml as n, diffLines } from './helpers/normalize.mjs';

const original = (page) => readFile(new URL(`./fixtures/original/${page}.html`, import.meta.url), 'utf8');

test('rule 1: comments are removed (also multi-line), and the gap they leave is whitespace-collapsed', () => {
  assert.equal(n('<p>a</p><!-- one -->\n<!--\n multi\n line --><p>b</p>'), '<p>a</p><p>b</p>');
});

test('rule 2: span.proj-files is removed with its nested <a>; look-alike classes are kept', () => {
  assert.equal(n('<p>a</p><span class="proj-files" hidden><a href="x.bin">f</a><a href="y">g</a></span><p>b</p>'), '<p>a</p><p>b</p>');
  assert.equal(n('<span class="x proj-files y">z</span>'), '');
  assert.equal(n('<span class="proj-files-x">z</span>'), '<span class="proj-files-x">z</span>');
});

test('rule 2: div.access-pill is removed with its nested <form> and <button>s', () => {
  const pill = '<div id="accessPill" class="access-pill"><button>Access</button><form><input name="code"><button type="submit">Go</button></form></div>';
  assert.equal(n(`<p>a</p>${pill}<p>b</p>`), '<p>a</p><p>b</p>');
  assert.equal(n('<div class="access-pill-main">x</div>'), '<div class="access-pill-main">x</div>');
});

test('rule 2: script#mk-years, script[type=module] and link[rel=modulepreload] go; other scripts and links stay', () => {
  assert.equal(n('<script id="mk-years">(function(){var s=1;})()</script><p>a</p>'), '<p>a</p>');
  assert.equal(n('<script src="assets/js/access.mjs?v=abc" type="module"></script><p>a</p>'), '<p>a</p>');
  assert.equal(n('<script type="module">import "./a.mjs";</script><p>a</p>'), '<p>a</p>');
  assert.equal(n('<link rel="modulepreload" href="assets/js/vault.mjs"><p>a</p>'), '<p>a</p>');
  assert.equal(n('<link rel="stylesheet" href="a.css"><script>var a=1;</script><script id="other"></script>'),
    '<link href="a.css" rel="stylesheet"><script>var a=1;</script><script id="other"></script>');
});

test('rule 2: a removable element without a closing tag throws instead of eating the rest of the page', () => {
  assert.throws(() => n('<div class="access-pill"><p>a</p>'), /no closing <\/div>/);
});

test('rule 3: <span data-years> is unwrapped to its text, and neighbouring text is merged', () => {
  assert.equal(n('<p>Over <span data-years>17</span> years, <span data-years="">9</span></p>'), '<p>Over 17 years, 9</p>');
  // Only the exact generated form is unwrapped; extra attributes would be a real difference.
  assert.equal(n('<span class="x" data-years>17</span>'), '<span class="x" data-years="">17</span>');
});

test('rule 4: data-experience-start is dropped wherever it appears', () => {
  assert.equal(n('<html data-experience-start="2009-09-23" lang="en"><div data-experience-start id="a">x</div>'),
    '<html lang="en"><div id="a">x</div>');
});

test('rule 4: ?v=... is dropped from href and src, and only there', () => {
  assert.equal(n('<link href="a.css?v=12" rel="stylesheet"><script src="b.js?v=12ab"></script><img src="c.webp?v=3"><a href="d.html?x=1">t</a>'),
    '<link href="a.css" rel="stylesheet"><script src="b.js"></script><img src="c.webp"><a href="d.html?x=1">t</a>');
  assert.equal(n('<meta content="a?v=1"><a data-href="b?v=2">t</a>'), '<meta content="a?v=1"><a data-href="b?v=2">t</a>');
});

test('rule 5: JSON-LD keys are sorted recursively, arrays keep their order, whitespace is gone', () => {
  assert.equal(
    n('<script type="application/ld+json">\n{ "b": 1,\n  "a": { "d": [ { "z": 1, "y": 2 }, 3 ], "c": null } }\n</script>'),
    '<script type="application/ld+json">{"a":{"c":null,"d":[{"y":2,"z":1},3]},"b":1}</script>');
  assert.equal(n('<script type="application/ld+json">{"x":[2,1]}</script>'), n('<script type="application/ld+json">{ "x": [2, 1] }</script>'));
  assert.notEqual(n('<script type="application/ld+json">{"x":[2,1]}</script>'), n('<script type="application/ld+json">{"x":[1,2]}</script>'));
});

test('rule 5: invalid JSON-LD throws with a clear message; ordinary scripts are not parsed', () => {
  assert.throws(() => n('<script type="application/ld+json">{"a":}</script>'), /invalid JSON-LD/);
  assert.equal(n('<script>{not json}</script>'), '<script>{not json}</script>');
});

test('rule 6: listed entities decode, &nbsp;&middot; becomes NBSP + middle dot, NBSP survives trim', () => {
  assert.equal(n('&nbsp;&middot;'), ' ·');
  assert.equal(
    n('<p>A&amp;B &middot; &rarr;&larr; &copy; &mdash;&ndash;&hellip;&times; &quot;q&quot; &#39;s&#39; &#65;&#x42;&#X43;</p>'),
    '<p>A&B · →← © —–…× "q" \'s\' ABC</p>');
});

test('rule 6: &lt; and &gt; (named or numeric) become private markers, never < or >', () => {
  assert.equal(n('<p>&lt;div&gt; &#60;b&#x3e;</p>'), '<p>div b</p>');
  assert.ok(!n('<p>&lt;b&gt;</p>').includes('<b'));
});

test('rule 6: entities are decoded in attribute values too; unknown ones and double-encoding are left alone', () => {
  assert.equal(n('<a title="x &lt; y &amp; z" href="?q=1&amp;r=2">t</a>'), '<a href="?q=1&r=2" title="x  y & z">t</a>');
  assert.equal(n('<p>&eacute; &AMP; &#xZZ; &#99999999; &amp;lt;</p>'), '<p>&eacute; &AMP; &#xZZ; &#99999999; &lt;</p>');
  assert.notEqual(n('<p>&eacute;</p>'), n('<p>é</p>'));
});

test('rule 7: attributes are sorted by name', () => {
  assert.equal(n('<a b="1" a="2">x</a>'), '<a a="2" b="1">x</a>');
  assert.equal(n('<a href=x b=y>t</a>'), '<a b="y" href="x">t</a>');
});

test('rule 7: bare attr equals attr="", single quotes become double quotes', () => {
  assert.equal(n(`<input disabled value='v' id="i" checked="">`), '<input checked="" disabled="" id="i" value="v">');
  assert.equal(n('<input disabled>'), n('<input disabled="">'));
  assert.equal(n(`<a title='say "hi"'>x</a>`), '<a title="say "hi"">x</a>'); // inner " is not re-escaped (rule 6 already ran)
});

test('rule 7: /> on void elements becomes >, other self-closing tags keep /> in one canonical spelling', () => {
  assert.equal(n('<br/><hr /><img src="a" /><meta charset="UTF-8"/>'), '<br><hr><img src="a"><meta charset="UTF-8">');
  assert.equal(n('<path d="M0 0" /><path d="M1 1"/>'), '<path d="M0 0"/><path d="M1 1"/>');
});

test('rule 8: whitespace runs collapse to one space, vanish between tags, and the result is trimmed', () => {
  assert.equal(n('  <p>\n   a \t\r\n  b\n</p>\n  <p> c </p>  \n'), '<p> a b </p><p> c </p>');
  assert.equal(n('<a title="a   b\n c" href="x">t</a>'), '<a href="x" title="a b c">t</a>');
});

test('rule 8: NBSP is not whitespace', () => {
  assert.equal(n('<p>   a </p>'), '<p>   a </p>');
  assert.equal(n('<b>a</b> <i>b</i>'), '<b>a</b> <i>b</i>');
  assert.equal(n('  x  '), ' x ');
});

test('tokenizer: > inside a quoted attribute value does not end the tag', () => {
  assert.equal(n(`<a title="a > b" href='c > d'>t</a>`), '<a href="c > d" title="a > b">t</a>');
});

test('tokenizer: script and style bodies are opaque (no tags, no comments, no entity decoding), whitespace still collapses', () => {
  assert.equal(
    n('<script>\n  if (a < b && c > d) {\n    x = "&amp;" + \'<div class="access-pill">\' + "<!-- k -->";\n  }\n</script>'),
    '<script> if (a < b && c > d) { x = "&amp;" + \'<div class="access-pill">\' + "<!-- k -->"; } </script>');
  assert.equal(n('<style>\n  .a > .b { c: d; }\n  /* <!-- */\n</style><p>x</p>'), '<style> .a > .b { c: d; } /* <!-- */ </style><p>x</p>');
  assert.equal(n('<SCRIPT>a<b</SCRIPT><p>x</p>'), '<SCRIPT>a<b</SCRIPT><p>x</p>');
});

test('tokenizer: <!DOCTYPE> and a bare < in text survive', () => {
  assert.equal(n('<!DOCTYPE html>\n<html lang="en">\n<body>a < b</body>\n</html>'), '<!DOCTYPE html><html lang="en"><body>a < b</body></html>');
});

test('tokenizer: a start tag whose attributes cannot be parsed throws', () => {
  assert.throws(() => n('<a href="x" ="y">t</a>'), /cannot parse attributes/);
});

test('strict: differences outside the eight rules survive normalisation', () => {
  const base = n('<a class="x" href="a" id="i">t</a>');
  for (const other of [
    '<a class="y" href="a" id="i">t</a>', '<a class="x" href="a">t</a>', '<a class="x" href="b" id="i">t</a>',
    '<a class="x" href="a" id="i">T</a>', '<a class="x" href="a" id="i" title="">t</a>', '<a class="x" href="a" id="i">t</a><br>',
    '<a class="x" href="a?w=1" id="i">t</a>', '<a class="x y" href="a" id="i">t</a>',
  ]) assert.notEqual(n(other), base, other);
  assert.notEqual(n('<p>a b</p>'), n('<p>ab</p>'));
  assert.notEqual(n('<p> a</p>'), n('<p>a</p>'));
});

test('real pages: normalised output is non-empty, comment-free and idempotent', async () => {
  for (const page of ['index', 'contact', 'thank-you', 'cv']) {
    const once = n(await original(page));
    assert.ok(once.length > 1000, `${page} is non-empty`);
    assert.ok(!once.includes('<!--'), `${page} has no comments`);
    assert.equal(n(once), once, `${page} is idempotent`);
  }
  const index = n(await original('index'));
  assert.match(index, /^<!DOCTYPE html><html /);
  assert.match(index, /<script type="application\/ld\+json">\{"@context":/);
  assert.ok(!/\?v=\d/.test(index), 'no ?v= left');
});

test('diffLines: reports the segments (split on ">") that differ, 0-based', () => {
  assert.deepEqual(diffLines('<p><b>x</b></p>', '<p><b>y</b></p>'), ['#2\n- x</b>\n+ y</b>']);
  assert.deepEqual(diffLines('<p>a</p>tail', '<p>a</p>TAIL'), ['#2\n- tail\n+ TAIL']);
  assert.deepEqual(diffLines('<p>a</p>', '<p>a</p><i>'), ['#2\n- \n+ <i>']);
});

test('diffLines: identical inputs give [], and at most 20 differences are returned', () => {
  assert.deepEqual(diffLines('<p>a</p>', '<p>a</p>'), []);
  assert.deepEqual(diffLines('', ''), []);
  const make = (c) => Array.from({ length: 30 }, (_, i) => `<p>${c}${i}</p>`).join('');
  const d = diffLines(make('a'), make('b'));
  assert.equal(d.length, 20);
  assert.equal(d[0], '#1\n- a0</p>\n+ b0</p>');
});
