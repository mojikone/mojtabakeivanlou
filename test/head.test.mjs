import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeSite, renderContext } from '../assets/js/render/model.mjs';
import { renderHead, personJsonLd, indexJsonLd, cvJsonLd } from '../assets/js/render/head.mjs';

const site = normalizeSite(JSON.parse(await readFile('content/site.json', 'utf8')));
const ctx = renderContext(site, { today: new Date('2026-06-01T00:00:00Z'), versions: { 'assets/js/palette.js': 'abc123' } });

const YEARS_SCRIPT = `<script id="mk-years">(function(){var s=document.documentElement.getAttribute('data-experience-start');if(!s)return;var d=new Date(s),n=new Date(),y=n.getUTCFullYear()-d.getUTCFullYear();if(n.getUTCMonth()<d.getUTCMonth()||(n.getUTCMonth()===d.getUTCMonth()&&n.getUTCDate()<d.getUTCDate()))y--;document.addEventListener('DOMContentLoaded',function(){document.querySelectorAll('[data-years]').forEach(function(e){e.textContent=y;});});})();</script>`;

const head = (extra = {}) => renderHead({
  site, ctx, page: 'index', title: 'T & <x>', description: 'D', ogDescription: 'OG', canonicalPath: '',
  ogType: 'profile', image: 'assets/img/mojtaba-waterfront4.webp', jsonLd: indexJsonLd(site, ctx), styles: ['assets/css/main.css'], ...extra,
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
