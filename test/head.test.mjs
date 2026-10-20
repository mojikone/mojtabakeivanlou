import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeSite, renderContext } from '../assets/js/render/model.mjs';
import { renderHead, personJsonLd, indexJsonLd, cvJsonLd, HEAD_ORDER } from '../assets/js/render/head.mjs';

const site = normalizeSite(JSON.parse(await readFile('content/site.json', 'utf8')));
const ctx = renderContext(site, { today: new Date('2026-06-01T00:00:00Z'), versions: { 'assets/js/palette.js': 'abc123' } });

const YEARS_SCRIPT = `<script id="mk-years">(function(){var s=document.documentElement.getAttribute('data-experience-start');if(!s)return;var d=new Date(s),n=new Date(),y=n.getUTCFullYear()-d.getUTCFullYear();if(n.getUTCMonth()<d.getUTCMonth()||(n.getUTCMonth()===d.getUTCMonth()&&n.getUTCDate()<d.getUTCDate()))y--;document.addEventListener('DOMContentLoaded',function(){document.querySelectorAll('[data-years]').forEach(function(e){e.textContent=y;});});})();</script>`;

const head = (extra = {}) => renderHead({
  site, ctx, page: 'index', title: 'T & <x>', description: 'D', ogDescription: 'OG', canonicalPath: '',
  ogType: 'profile', image: 'assets/img/mojtaba-waterfront4.webp', jsonLd: indexJsonLd(site, ctx), ...extra,
});
const jsonLdOf = (out) => JSON.parse(/<script type="application\/ld\+json">([^]*?)<\/script>/.exec(out)[1]);
const originalJsonLd = async (page) => jsonLdOf(await readFile(`test/fixtures/original/${page}.html`, 'utf8'));

test('renderHead: doctype, <html> start tag with the experience start, through </head>', () => {
  const out = head();
  assert.match(out, /^<!DOCTYPE html>\n<html lang="en" data-experience-start="2009-09-23">\n<head>\n/);
  assert.match(out, /<\/head>\n$/);
});

test('renderHead: the inline years script, verbatim', () => {
  assert.ok(head().includes(YEARS_SCRIPT));
});

test('renderHead: palette.js is a synchronous, versioned include', () => {
  assert.match(head(), /<script src="assets\/js\/palette\.js\?v=abc123"><\/script>/);
});

test('renderHead: title and meta values are escaped; canonical, OG and Twitter use the domain', () => {
  const out = head();
  assert.match(out, /<title>T &amp; &lt;x&gt;<\/title>/);
  assert.match(out, /<link rel="canonical" href="https:\/\/mojtabakeivanlou\.com">/);
  assert.match(out, /<meta property="og:image" content="https:\/\/mojtabakeivanlou\.com\/assets\/img\/mojtaba-waterfront4\.webp">/);
  assert.match(head({ canonicalPath: 'cv.html' }), /<meta property="og:url" content="https:\/\/mojtabakeivanlou\.com\/cv\.html">/);
});

test('renderHead: the JSON-LD block parses, and "<" cannot close the script', () => {
  const out = head({ jsonLd: { name: '</script><b>' } });
  assert.deepEqual(jsonLdOf(out), { name: '</script><b>' });
  assert.ok(!out.includes('</script><b>'));
  assert.deepEqual(jsonLdOf(head()), indexJsonLd(site, ctx));
});

test('JSON-LD: the home page Person equals the original, sourced from site.json', async () => {
  const ld = indexJsonLd(site, ctx);
  assert.deepEqual(ld, await originalJsonLd('index'));
  assert.equal(ld['@context'], 'https://schema.org');
  assert.equal(ld['@type'], 'Person');
  assert.equal(ld.description, 'Senior hydraulic and water resources engineer with 16 years of international experience across Iran, Oman, and the USA.');
  assert.deepEqual(ld.worksFor, { '@type': 'Organization', name: 'Renardet S.A. & Partners' });
  assert.deepEqual(ld.knowsAbout, site.seo.knowsAbout);
  assert.equal(ld.hasOfferCatalog.itemListElement.length, 9);
});

test('JSON-LD: the CV wraps the base Person in a ProfilePage, as the original does', async () => {
  const ld = cvJsonLd(site, ctx);
  assert.deepEqual(ld, await originalJsonLd('cv'));
  assert.equal(ld['@type'], 'ProfilePage');
  assert.equal(ld.url, 'https://mojtabakeivanlou.com/cv.html');
  assert.equal(ld.name, 'CV — Mojtaba Keivanlou');
  assert.deepEqual(ld.mainEntity, personJsonLd(site, ctx));
  assert.deepEqual(Object.keys(ld.mainEntity), ['@type', 'name', 'jobTitle', 'url', 'image', 'email', 'telephone', 'address', 'sameAs']);
});

test('head.mjs and index.mjs are browser-safe: they import nothing from Node', async () => {
  for (const file of ['head.mjs', 'index.mjs']) {
    const source = await readFile(new URL(`../assets/js/render/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from\s+['"]node:/, file);
    assert.doesNotMatch(source, /\brequire\s*\(/, file);
    assert.doesNotMatch(source, /\bprocess\./, file);
  }
});

test('renderHead: inlineStyles become verbatim <style> blocks after palette.js, in order', () => {
  const css = '\n  .a > .b { content: "x & y"; }\n';
  const out = head({ inlineStyles: [css, '.c{}'], scripts: ['assets/js/extra.js'] });
  assert.ok(out.includes(`<style>${css}</style>\n<style>.c{}</style>`), 'verbatim, not escaped');
  const order = ['main.css', 'palette.js', 'extra.js', '<style>.c'].map((part) => out.indexOf(part));
  assert.ok(order.every((at, i) => at > (order[i - 1] ?? -1)), `main.css, palette.js, scripts, then the styles (${order})`);
  assert.doesNotMatch(head(), /<style>/);
});

test('renderHead: an empty description is left out, like a missing one', () => {
  assert.doesNotMatch(head({ description: '' }), /name="description"/);
  assert.doesNotMatch(head({ description: undefined }), /name="description"/);
  assert.match(head({ description: 'D' }), /<meta name="description" content="D">/);
});

test('renderHead: a page without Open Graph, canonical or JSON-LD gets none of them; thank-you adds noindex', () => {
  const out = head({ page: 'thank-you', title: 'T', description: undefined, ogDescription: undefined, canonicalPath: undefined, jsonLd: undefined });
  assert.match(out, /<title>T<\/title>\n<meta name="robots" content="noindex">\n<link rel="icon"/);
  assert.doesNotMatch(out, /property="og:|name="twitter:|rel="canonical"|application\/ld\+json/);
  assert.doesNotMatch(head(), /noindex/);
});

// ---- Named segments and their order --------------------------------------------------------------------------------

const FAVICON = `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='14' fill='%231A3D2C'/%3E%3Ctext x='50' y='67' font-family='sans-serif' font-weight='700' font-size='44' text-anchor='middle' fill='%23A8CE2E'%3EMK%3C/text%3E%3C/svg%3E">`;

// The head as index.html, contact.html and thank-you.html have always had it, one segment after the other.
const INDEX_HEAD_LINES = (ld) => [
  '<!DOCTYPE html>',
  '<html lang="en" data-experience-start="2009-09-23">',
  '<head>',
  /* ga */ '<script async src="https://www.googletagmanager.com/gtag/js?id=G-FMKJ61FF7F"></script>',
  /* ga */ `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-FMKJ61FF7F');</script>`,
  /* charset */ '<meta charset="UTF-8">',
  /* viewport */ '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
  /* title */ '<title>T &amp; &lt;x&gt;</title>',
  /* robots: not on this page; description */ '<meta name="description" content="D">',
  /* og */ '<meta property="og:title" content="T &amp; &lt;x&gt;">',
  /* og */ '<meta property="og:description" content="OG">',
  /* og */ '<meta property="og:type" content="profile">',
  /* og */ '<meta property="og:url" content="https://mojtabakeivanlou.com">',
  /* og */ '<meta property="og:image" content="https://mojtabakeivanlou.com/assets/img/mojtaba-waterfront4.webp">',
  /* twitter */ '<meta name="twitter:card" content="summary">',
  /* twitter */ '<meta name="twitter:title" content="T &amp; &lt;x&gt;">',
  /* twitter */ '<meta name="twitter:image" content="https://mojtabakeivanlou.com/assets/img/mojtaba-waterfront4.webp">',
  /* canonical */ '<link rel="canonical" href="https://mojtabakeivanlou.com">',
  /* jsonLd */ `<script type="application/ld+json">\n${ld}\n</script>`,
  /* favicon */ FAVICON,
  /* fonts */ '<link rel="preconnect" href="https://fonts.googleapis.com">',
  /* fonts */ '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  /* fonts */ '<link href="https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,200;0,300;0,400;0,500;0,600;0,700;1,300&display=swap" rel="stylesheet">',
  /* stylesheets */ '<link rel="stylesheet" href="assets/css/main.css?v=dev">',
  /* palette */ '<script src="assets/js/palette.js?v=abc123"></script>',
  /* scripts */ '<script src="assets/js/extra.js?v=dev"></script>',
  /* yearsScript */ YEARS_SCRIPT,
  /* inlineStyles */ '<style>.c{}</style>',
  '</head>',
  '',
];

test('renderHead: the default order renders the head the existing pages have always had, segment by segment', () => {
  const out = head({ scripts: ['assets/js/extra.js'], inlineStyles: ['.c{}'] });
  assert.equal(out, INDEX_HEAD_LINES(JSON.stringify(indexJsonLd(site, ctx), null, 2)).join('\n'));
});

test('renderHead: HEAD_ORDER names the segments in the default order', () => {
  assert.deepEqual(HEAD_ORDER, ['ga', 'charset', 'viewport', 'title', 'robots', 'description', 'og', 'twitter', 'canonical', 'jsonLd',
    'favicon', 'fonts', 'stylesheets', 'palette', 'scripts', 'yearsScript', 'inlineStyles']);
  assert.ok(Object.isFrozen(HEAD_ORDER));
});

test('renderHead: stylesheets default to main.css; a list replaces it, each path versioned through ctx.v', () => {
  assert.equal(head().match(/rel="stylesheet" href=/g).length, 1);
  const out = head({ stylesheets: ['assets/css/cv.css', 'assets/css/x.css'] });
  assert.match(out, /<link rel="stylesheet" href="assets\/css\/cv\.css\?v=dev">\n<link rel="stylesheet" href="assets\/css\/x\.css\?v=dev">\n<script src="assets\/js\/palette/);
  assert.doesNotMatch(out, /main\.css/);
  assert.doesNotMatch(head({ stylesheets: [] }), /rel="stylesheet" href=/);
});

test('renderHead: fonts replaces the Google Fonts stylesheet URL and keeps the preconnects', () => {
  const url = 'https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,300;1,400&display=swap';
  const out = head({ fonts: url });
  assert.ok(out.includes(`<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link href="${url}" rel="stylesheet">`));
  assert.doesNotMatch(out, /0,200/);
  for (const bad of ['https://x/"><script>', 'https://x/a b', 'https://x/<b>', 'http://x/', 'javascript:alert(1)']) {
    assert.throws(() => head({ fonts: bad }), /fonts/, bad);
  }
});

test('renderHead: order rearranges the segments (the CV: palette.js before the favicon, JSON-LD after it)', () => {
  const order = ['ga', 'charset', 'viewport', 'title', 'robots', 'description', 'og', 'twitter', 'canonical', 'palette', 'favicon', 'jsonLd',
    'fonts', 'stylesheets', 'scripts', 'yearsScript', 'inlineStyles'];
  const out = head({ order, inlineStyles: ['.c{}'] });
  const at = ['rel="canonical"', 'palette.js', 'rel="icon"', 'application/ld+json', 'fonts.googleapis', 'main.css', 'mk-years', '<style>.c{}'].map((part) => out.indexOf(part));
  assert.ok(at.every((pos, i) => pos > (at[i - 1] ?? -1)), `segments in the given order (${at})`);
  assert.match(out, /<link rel="canonical" href="https:\/\/mojtabakeivanlou\.com">\n<script src="assets\/js\/palette\.js\?v=abc123"><\/script>\n<link rel="icon"/);
  const lines = (text) => text.split('\n').sort();
  assert.deepEqual(lines(out), lines(head({ inlineStyles: ['.c{}'] })), 'the same lines, only moved');
});

test('renderHead: order must name every segment exactly once', () => {
  assert.throws(() => head({ order: [...HEAD_ORDER, 'extra'] }), /order/);
  assert.throws(() => head({ order: HEAD_ORDER.slice(1) }), /order/);
  assert.throws(() => head({ order: [...HEAD_ORDER.slice(1), 'charset'] }), /order/);
  assert.throws(() => head({ order: ['toString', ...HEAD_ORDER.slice(1)] }), /order/);
});
