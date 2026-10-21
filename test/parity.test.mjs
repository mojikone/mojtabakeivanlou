import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeSite, renderContext } from '../assets/js/render/model.mjs';
import { renderIndex } from '../assets/js/render/index.mjs';
import { renderContact } from '../assets/js/render/contact.mjs';
import { renderThankYou } from '../assets/js/render/thank-you.mjs';
import { renderCv } from '../assets/js/render/cv.mjs';
import { normalizeHtml, diffLines } from './helpers/normalize.mjs';

// The content as extracted from the original pages, frozen (see CLAUDE.md). content/site.json is free to change; this is not.
const site = normalizeSite(JSON.parse(await readFile('test/fixtures/site.parity.json', 'utf8')));
const ctx = renderContext(site, { today: new Date('2026-06-01T00:00:00Z') });
const original = p => readFile(`test/fixtures/original/${p}.html`, 'utf8');

test('index.html matches the original', async () => {
  const a = normalizeHtml(renderIndex(site, ctx)), b = normalizeHtml(await original('index'));
  assert.equal(a, b, diffLines(a, b).join('\n'));
});

test('contact.html matches the original', async () => {
  const a = normalizeHtml(renderContact(site, ctx)), b = normalizeHtml(await original('contact'));
  assert.equal(a, b, diffLines(a, b).join('\n'));
});

test('thank-you.html matches the original', async () => {
  const a = normalizeHtml(renderThankYou(site, ctx)), b = normalizeHtml(await original('thank-you'));
  assert.equal(a, b, diffLines(a, b).join('\n'));
});

// ---- cv.html: exactly three sanctioned differences, each one a transformation of the ORIGINAL -------------------
// Each helper throws unless the original has exactly the text it expects, so none of them can widen silently.

const count = (text, needle) => text.split(needle).length - 1;

const STAT = String.raw`\s*<div><div class="stat-val">[^<]*</div><div class="stat-lbl">([^<]*)</div></div>`;

/** (1) site.json orders the stats Years / Countries / Projects (as the home page does); the original CV had Years / Projects / Countries. */
function reorderStats(originalHtml) {
  const found = [...originalHtml.matchAll(new RegExp(`(<div class="stats">)(${STAT})(${STAT})(${STAT})`, 'g'))];
  assert.equal(found.length, 1, 'reorderStats: the original has one stats block of three');
  const [whole, open, years, yearsLabel, projects, projectsLabel, countries, countriesLabel] = found[0];
  assert.deepEqual([yearsLabel, projectsLabel, countriesLabel], ['Years Experience', 'Projects Delivered', 'Countries + US Remote']);
  return originalHtml.replace(whole, () => open + years + countries + projects);
}

/** (2) The Surveying & Mapping description in site.json says "geospatial data collection" (as the home page does). */
function addGeospatial(originalHtml) {
  const SURVEY = /(Surveying &amp; Mapping<\/div>\s*<div class="exp-desc">[^<]*?)(data collection\.<\/div>)/g;
  assert.equal([...originalHtml.matchAll(SURVEY)].length, 1, 'addGeospatial: one Surveying & Mapping description');
  return originalHtml.replace(SURVEY, (_, before, after) => `${before}geospatial ${after}`);
}

/**
 * (3) The original's single inline <style>, split: `pageBlock` is the `@page { … }` rule with its nested `@bottom-center`
 * (it stays inline, generated from profile), `rest` is everything else (it is assets/css/cv.css now).
 */
function extractCvStyle(originalHtml) {
  const styles = [...originalHtml.matchAll(/<style>([^]*?)<\/style>/g)];
  assert.equal(styles.length, 1, 'extractCvStyle: the original has one <style>');
  const css = styles[0][1];
  const start = css.indexOf('@page {');
  assert.ok(start >= 0 && count(css, '@page') === 1, 'extractCvStyle: one @page rule');
  let depth = 0, end = start;
  for (; end < css.length; end++) {
    if (css[end] === '{') depth++;
    else if (css[end] === '}' && --depth === 0) break;
  }
  assert.ok(end < css.length, 'extractCvStyle: the @page rule is closed');
  return { pageBlock: css.slice(start, end + 1), rest: css.slice(0, start) + css.slice(end + 1) };
}

const collapse = (css) => css.replace(/\s+/g, ' ').trim();
const CV_CSS_LINK = `<link rel="stylesheet" href="${ctx.v('assets/css/cv.css')}">`;
const inlineStyleOf = (page) => {
  const styles = [...page.matchAll(/<style>([^]*?)<\/style>/g)];
  assert.equal(styles.length, 1, 'one inline <style>');
  return styles[0][1];
};

test('cv.html matches the original, apart from the three sanctioned differences', async () => {
  const originalHtml = await original('cv');
  const built = renderCv(site, ctx);
  // (3) on the built side: the <link> to cv.css, which the original (with its CSS inline) cannot have.
  assert.equal(count(built, CV_CSS_LINK), 1, 'the page links cv.css once');
  const { pageBlock } = extractCvStyle(originalHtml);
  const reduced = originalHtml.replace(/<style>[^]*?<\/style>/, () => `<style>\n${pageBlock}\n</style>`);
  const a = normalizeHtml(built.replace(CV_CSS_LINK, ''));
  const b = normalizeHtml(addGeospatial(reorderStats(reduced)));
  assert.equal(a, b, diffLines(a, b).join('\n'));
});

test('assets/css/cv.css is the rest of the original inline CSS (whitespace collapsed)', async () => {
  const { rest } = extractCvStyle(await original('cv'));
  assert.equal(collapse(await readFile('assets/css/cv.css', 'utf8')), collapse(rest));
});

test('the inline @page rule of cv.html is the original one, byte for byte', async () => {
  const { pageBlock } = extractCvStyle(await original('cv'));
  assert.equal(inlineStyleOf(renderCv(site, ctx)), `\n${pageBlock}\n`);
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

test('a javascript: LinkedIn URL never reaches an href, even unvalidated (the preview renders invalid drafts)', () => {
  for (const evil of ['javascript:alert(document.domain)', 'data:text/html,<script>alert(1)</script>', '\u0001javascript:alert(1)']) {
    const bad = normalizeSite({ ...site, profile: { ...site.profile, linkedin: evil } });
    const badCtx = renderContext(bad, { today: new Date('2026-06-01T00:00:00Z') });
    for (const page of [renderIndex(bad, badCtx), renderContact(bad, badCtx)]) {
      const hrefs = [...page.matchAll(/<a\b[^>]*\shref="([^"]*)"/g)].map((m) => m[1]);   // links (the favicon is a data: <link>)
      assert.ok(hrefs.every((h) => !/^\s*(javascript|data|vbscript):/i.test(h.replace(/[\u0000-\u001f]/g, ''))), evil);
      assert.ok(hrefs.includes('#'), 'the LinkedIn link points nowhere instead');
    }
  }
});

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

// The dashboard preview (Task 21) renders with unlocked: true; the public page and the build stay hidden.
test('unlocked: true shows the download icons, unlocked: false hides them', () => {
  const shown = renderIndex(withFile(), { ...ctx, unlocked: true });
  const hidden = renderIndex(withFile(), { ...ctx, unlocked: false });
  assert.match(shown, /<span class="proj-files"><a class="proj-dl" href="#" data-file="0123456789abcdef0123456789abcdef"/);
  assert.doesNotMatch(shown, /<span class="proj-files" hidden>/);
  assert.match(hidden, /<span class="proj-files" hidden><a class="proj-dl"/);
  assert.doesNotMatch(hidden, /<span class="proj-files">/);
  assert.equal(renderIndex(withFile(), ctx), hidden, 'the default context is locked');
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
