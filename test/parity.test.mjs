import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeSite, renderContext } from '../assets/js/render/model.mjs';
import { renderIndex } from '../assets/js/render/index.mjs';
import { normalizeHtml, diffLines } from './helpers/normalize.mjs';

const site = normalizeSite(JSON.parse(await readFile('content/site.json', 'utf8')));
const ctx = renderContext(site, { today: new Date('2026-06-01T00:00:00Z') });
const original = p => readFile(`test/fixtures/original/${p}.html`, 'utf8');

test('index.html matches the original', async () => {
  const a = normalizeHtml(renderIndex(site, ctx)), b = normalizeHtml(await original('index'));
  assert.equal(a, b, diffLines(a, b).join('\n'));
});

// ---- What the normaliser hides: the additions the original page does not have -----------------------------------

const FILE = { id: '0123456789abcdef0123456789abcdef', name: 'Wadi_Majlas_Report.pdf', size: 4403211, type: 'application/pdf', enc: true };

// The site with one file attached to the Majlas assessment bullet.
function withFile(file = FILE) {
  const copy = structuredClone(site);
  const majlas = copy.experience.companies.flatMap((c) => c.projects).find((p) => p.name.startsWith('Majlas'));
  majlas.bullets.find((b) => b.text.startsWith('Techno-Economic')).files.push(file);
  return copy;
}

test('a bullet with files renders the hidden proj-files span inside its <li>', () => {
  const out = renderIndex(withFile(), ctx);
  const li = /<li>Techno-Economic and Flood-Hazard Assessment of the Wadi Majlas Scheme(<span[^]*?<\/span>)<\/li>/.exec(out);
  assert.ok(li, 'the span follows the bullet text directly, inside the <li>');
  assert.match(li[1], /^<span class="proj-files" hidden><a class="proj-dl" href="#" data-file="0123456789abcdef0123456789abcdef" data-name="Wadi_Majlas_Report.pdf" data-size="4403211" data-enc="true" title="Wadi_Majlas_Report.pdf · 4.2 MB" aria-label="Download Wadi_Majlas_Report.pdf"><svg width="13" height="13" /);
  assert.equal((out.match(/class="proj-files"/g) ?? []).length, 1, 'bullets without files get no span');
});

test('ctx.unlocked renders the proj-files span without hidden', () => {
  const out = renderIndex(withFile(), { ...ctx, unlocked: true });
  assert.match(out, /<span class="proj-files"><a class="proj-dl"/);
  assert.doesNotMatch(out, /proj-files" hidden/);
});

test('file names are escaped and data-enc follows the record', () => {
  const out = renderIndex(withFile({ ...FILE, name: 'a"<b>.pdf', size: 900, enc: false }), ctx);
  assert.match(out, /data-name="a&quot;&lt;b&gt;.pdf" data-size="900" data-enc="false" title="a&quot;&lt;b&gt;.pdf · 900 B"/);
});

test('the Access pill sits in the hero contact row right after WhatsApp', () => {
  const out = renderIndex(site, ctx);
  const row = /<div class="hero-contact-row">([^]*?)<div class="hero-br-actions">/.exec(out)[1];
  assert.match(row, /WhatsApp\s*<\/a>\s*<div class="hero-contact-link access-pill" id="accessPill" data-state="idle">/);
  assert.match(row, /<button type="button" class="access-pill-main" aria-expanded="false"><svg [^>]*>[^]*?<\/svg><span class="access-pill-label">Access<\/span><\/button>/);
  assert.match(row, /<form class="access-pill-form" hidden autocomplete="off">\s*<input type="password" name="code" placeholder="Access code" aria-label="Access code" autocomplete="off" autocapitalize="off" spellcheck="false">\s*<button type="submit">Enter<\/button>\s*<\/form>\s*<\/div>/);
});

test('access.mjs is loaded as a module, after main.js and before </body>', () => {
  const out = renderIndex(site, ctx);
  assert.match(out, /<script src="assets\/js\/main\.js\?v=dev"><\/script>\s*<script type="module" src="assets\/js\/access\.mjs\?v=dev"><\/script>\s*<\/body>/);
});

test('years stay live: body counts are <span data-years>, the <html> tag carries the start date', () => {
  const out = renderIndex(site, ctx);
  assert.match(out, /^<!DOCTYPE html>\s*<html lang="en" data-experience-start="2009-09-23">/);
  assert.match(out, /<div class="about-num-val"><span data-years>16<\/span><em>\+<\/em><\/div>/);
  assert.match(out, /<p class="exp-sidebar-sub"><span data-years>16<\/span> years across/);
});
