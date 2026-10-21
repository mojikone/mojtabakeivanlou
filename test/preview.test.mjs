// The pure parts of the dashboard preview (Task 21, spec 13.5): admin/modules/preview.mjs.
// The modal, the tabs and the iframe are DOM code, checked by hand in the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PAGES, pageForSection, pageForHref, withBase, validationNotice, previewDocument,
} from '../admin/modules/preview.mjs';

const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const SITE = read('site.parity.json');                // the full content, valid
const MIN = read('site.min.json');
const TODAY = new Date('2026-06-01T00:00:00Z');
const ORIGIN = 'http://127.0.0.1:3007';

/* ─── pageForSection ─── */

test('the Contact page section opens the Contact tab; every other section opens Home', () => {
  assert.equal(pageForSection('contact'), 'contact');
  for (const id of ['profile', 'education', 'languages', 'services', 'experience', 'skills', 'access', 'files', 'settings']) {
    assert.equal(pageForSection(id), 'index', id);
  }
});

test('pageForSection falls back to Home for anything unknown', () => {
  for (const id of [undefined, null, '', 'setup', 'nope', 42]) assert.equal(pageForSection(id), 'index', String(id));
});

/* ─── PAGES ─── */

test('the tabs are Home, Contact, Thank you, CV in that order', () => {
  assert.deepEqual(PAGES.map((p) => [p.id, p.label]), [
    ['index', 'Home'], ['contact', 'Contact'], ['thank-you', 'Thank you'], ['cv', 'CV'],
  ]);
  assert.ok(Object.isFrozen(PAGES));
});

/* ─── pageForHref: links inside the preview ─── */

test('pageForHref maps the site\'s own page links to a tab', () => {
  assert.equal(pageForHref('contact.html'), 'contact');
  assert.equal(pageForHref('index.html'), 'index');
  assert.equal(pageForHref('cv.html'), 'cv');
  assert.equal(pageForHref('thank-you.html'), 'thank-you');
  assert.equal(pageForHref('./contact.html'), 'contact');
  assert.equal(pageForHref('/contact.html'), 'contact');
  assert.equal(pageForHref('contact.html#form'), 'contact');
  assert.equal(pageForHref('index.html?x=1#about'), 'index');
});

test('pageForHref leaves everything else alone', () => {
  for (const href of ['#about', '#', '', 'https://example.com/contact.html', 'mailto:a@b.c', 'tel:+1', 'pdf/cv.pdf', 'contact.htmlx', null, undefined]) {
    assert.equal(pageForHref(href), null, String(href));
  }
});

/* ─── withBase ─── */

test('withBase puts <base href="origin/"> first in <head>', () => {
  const out = withBase('<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>x</title>\n</head>\n<body></body></html>', ORIGIN);
  assert.match(out, /<head><base href="http:\/\/127\.0\.0\.1:3007\/">\n<meta charset="utf-8">/);
  assert.equal(out.indexOf('<base'), out.indexOf('<head>') + '<head>'.length);
  assert.equal((out.match(/<base /g) ?? []).length, 1);
});

test('withBase handles <head> with attributes and any case, and only the first <head>', () => {
  assert.match(withBase('<html><HEAD data-x="1"><title>a</title></HEAD><body><p>&lt;head&gt;</p></body></html>', ORIGIN), /<HEAD data-x="1"><base href="http:\/\/127\.0\.0\.1:3007\/"><title>/);
  const twice = withBase('<head></head><body><head></head></body>', ORIGIN);
  assert.equal((twice.match(/<base /g) ?? []).length, 1);
});

test('withBase does not mistake <header> for <head>', () => {
  const out = withBase('<html><body><header>h</header></body></html>', ORIGIN);
  assert.doesNotMatch(out, /<header><base/);
  assert.match(out, /^<base href="http:\/\/127\.0\.0\.1:3007\/"><html>/, 'no <head>: the base goes in front');
});

test('withBase escapes the origin, and falls back to "/" when there is no http(s) origin', () => {
  assert.match(withBase('<head></head>', 'http://a.test"><script>x</script>'), /<base href="\/">/, 'not an origin: the safe default');
  assert.match(withBase('<head></head>', 'null'), /<base href="\/">/, 'file:// pages report the origin "null"');
  assert.match(withBase('<head></head>', undefined), /<base href="\/">/);
  assert.match(withBase('<head></head>', 'https://mojtabakeivanlou.com'), /<base href="https:\/\/mojtabakeivanlou\.com\/">/);
});

/* ─── validationNotice ─── */

test('validationNotice is empty for no issues and counts them otherwise', () => {
  assert.equal(validationNotice(0), '');
  assert.equal(validationNotice([]), '');
  assert.equal(validationNotice(3), '3 validation issue(s) — the published build would be rejected');
  assert.equal(validationNotice(['a', 'b']), '2 validation issue(s) — the published build would be rejected');
  assert.equal(validationNotice(1), '1 validation issue(s) — the published build would be rejected');
});

/* ─── previewDocument ─── */

test('previewDocument renders all four pages from the draft, with the base first in <head>', () => {
  for (const { id } of PAGES) {
    const { html, issues } = previewDocument(SITE, id, { today: TODAY, origin: ORIGIN });
    assert.match(html, /^<!DOCTYPE html>/i, id);
    assert.match(html, /<head>\s*<base href="http:\/\/127\.0\.0\.1:3007\/">/, id);
    assert.deepEqual(issues, [], id);
  }
});

test('previewDocument shows the current draft, not the published content', () => {
  const draft = structuredClone(SITE);
  draft.profile.heroHeadline = ['A brand new headline', 'Typed a second ago'];
  const { html } = previewDocument(draft, 'index', { today: TODAY, origin: ORIGIN });
  assert.match(html, /<p class="hero-role-headline">A brand new headline<br>Typed a second ago<\/p>/);
  assert.doesNotMatch(html, /<p class="hero-role-headline">Senior Hydraulic/);
});

test('previewDocument normalises the draft first (derived phone, trimmed strings) and leaves it untouched', () => {
  const draft = structuredClone(SITE);
  draft.profile.phone = { display: '+968 9297 0635' };            // as the dashboard writes it before e164 exists
  delete draft.profile.whatsapp;
  draft.profile.firstName = '  Mojtaba  ';
  const before = structuredClone(draft);
  const { html } = previewDocument(draft, 'index', { today: TODAY, origin: ORIGIN });
  assert.match(html, /wa\.me\/96892970635/);
  assert.doesNotMatch(html, /  Mojtaba  /);
  assert.deepEqual(draft, before, 'the draft is not mutated');
});

test('previewDocument is unlocked: download icons are not hidden', () => {
  const draft = structuredClone(SITE);
  const bullet = draft.experience.companies[0].projects[0].bullets[0];
  bullet.files = [{ id: '0123456789abcdef0123456789abcdef', name: 'Report.pdf', size: 2048, type: 'application/pdf', enc: true }];
  const { html } = previewDocument(draft, 'index', { today: TODAY, origin: ORIGIN });
  assert.match(html, /<span class="proj-files"><a class="proj-dl"/);
  assert.doesNotMatch(html, /proj-files" hidden/);
});

test('previewDocument computes the years from today', () => {
  const a = previewDocument(SITE, 'index', { today: new Date('2026-06-01T00:00:00Z'), origin: ORIGIN }).html;
  const b = previewDocument(SITE, 'index', { today: new Date('2027-06-01T00:00:00Z'), origin: ORIGIN }).html;
  assert.notEqual(a, b);
  assert.match(a, /16\+? years/i);
  assert.match(b, /17\+? years/i);
});

test('previewDocument counts validation issues but still renders', () => {
  const draft = structuredClone(MIN);
  draft.profile.email = '';
  draft.profile.bio = '';
  const { html, issues } = previewDocument(draft, 'index', { today: TODAY, origin: ORIGIN });
  assert.equal(issues.length, 2);
  assert.ok(issues.every((m) => typeof m === 'string'));
  assert.match(html, /<base href=/);
});

test('previewDocument falls back to Home for an unknown page', () => {
  assert.equal(
    previewDocument(SITE, 'nope', { today: TODAY, origin: ORIGIN }).html,
    previewDocument(SITE, 'index', { today: TODAY, origin: ORIGIN }).html,
  );
});

test('previewDocument reports a draft the templates cannot render as an error, not a throw', () => {
  const { html, issues, error } = previewDocument({ schemaVersion: 1 }, 'index', { today: TODAY, origin: ORIGIN });
  assert.equal(html, null);
  assert.equal(typeof error, 'string');
  assert.ok(error.length > 0);
  assert.ok(issues.length > 0, 'the validator still lists what is missing');
});
