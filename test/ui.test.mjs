// Pure helpers behind the dashboard's form controls and sections (Task 18, spec 13.3): admin/modules/forms.mjs.
// The controls themselves (admin/modules/ui.mjs) and the sections are DOM code, checked by hand in the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  throttle, wrapSelection, keywordsFromText, keywordsToText, linesToArray, arrayToLines, schoolShortFrom,
  issuesFor, previewContext, previewHtml,
} from '../admin/modules/forms.mjs';
import { icons } from '../assets/js/render/icons.mjs';

const SITE = JSON.parse(readFileSync(new URL('./fixtures/site.min.json', import.meta.url), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const TODAY = new Date('2026-06-01T00:00:00Z');

/* ─── throttle ─── */

test('throttle calls once per window with the latest arguments', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const f = throttle((...args) => calls.push(args), 150);
  f('a');
  f('ab');
  f('abc');
  assert.deepEqual(calls, []);
  assert.equal(f.pending(), true);
  t.mock.timers.tick(149);
  assert.deepEqual(calls, []);
  t.mock.timers.tick(1);
  assert.deepEqual(calls, [['abc']]);
  assert.equal(f.pending(), false);
  f('abcd');
  t.mock.timers.tick(150);
  assert.deepEqual(calls, [['abc'], ['abcd']]);
});

test('throttle keeps firing during continuous input, not only after a pause', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const f = throttle((v) => calls.push(v), 150);
  for (let i = 1; i <= 10; i++) { f(i); t.mock.timers.tick(50); }   // 500 ms of typing, a key every 50 ms
  assert.deepEqual(calls, [3, 6, 9]);
  t.mock.timers.tick(150);
  assert.deepEqual(calls, [3, 6, 9, 10]);
});

test('throttle.flush runs a pending call at once; cancel drops it; both are no-ops when idle', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const f = throttle((v) => calls.push(v), 150);
  f.flush();
  f.cancel();
  f('x');
  f.flush();
  assert.deepEqual(calls, ['x']);
  t.mock.timers.tick(500);
  assert.deepEqual(calls, ['x'], 'the timer was cleared by flush');
  f('y');
  f.cancel();
  t.mock.timers.tick(500);
  assert.deepEqual(calls, ['x']);
  assert.equal(f.pending(), false);
});

/* ─── bold / italic buttons ─── */

test('wrapSelection wraps the selection and keeps the same words selected', () => {
  const r = wrapSelection('make this bold', 5, 9, '**');
  assert.equal(r.text, 'make **this** bold');
  assert.equal(r.text.slice(r.start, r.end), 'this');
  assert.deepEqual([r.from, r.to, r.insert], [5, 9, '**this**']);
});

test('wrapSelection leaves surrounding whitespace outside the markers (a double-click selects the trailing space)', () => {
  const r = wrapSelection('an italic word', 3, 10, '_');
  assert.equal(r.text, 'an _italic_ word');
  assert.equal(r.text.slice(r.start, r.end), 'italic');
});

test('wrapSelection with nothing selected inserts the pair and puts the caret between them', () => {
  const r = wrapSelection('ab', 1, 1, '**');
  assert.equal(r.text, 'a****b');
  assert.deepEqual([r.start, r.end], [3, 3]);
});

test('wrapSelection unwraps an already wrapped selection, inside or including the markers', () => {
  const inside = wrapSelection('make **this** bold', 7, 11, '**');
  assert.equal(inside.text, 'make this bold');
  assert.equal(inside.text.slice(inside.start, inside.end), 'this');
  const including = wrapSelection('an _italic_ word', 3, 11, '_');
  assert.equal(including.text, 'an italic word');
  assert.equal(including.text.slice(including.start, including.end), 'italic');
});

test('wrapSelection over several lines wraps each non-empty line, so every paragraph renders', () => {
  const text = 'one\n\ntwo';
  const r = wrapSelection(text, 0, text.length, '**');
  assert.equal(r.text, '**one**\n\n**two**');
  assert.deepEqual([r.start, r.end], [0, r.text.length]);
});

/* ─── list fields stored as arrays ─── */

test('keywordsFromText splits on commas, trims and drops empty entries', () => {
  assert.deepEqual(keywordsFromText(' Flood modelling, HEC-RAS ,, ,Hazard mapping, '), ['Flood modelling', 'HEC-RAS', 'Hazard mapping']);
  assert.deepEqual(keywordsFromText(''), []);
  assert.equal(keywordsToText(['a', 'b c']), 'a, b c');
  assert.equal(keywordsToText(undefined), '');
});

test('linesToArray keeps one term per line, trimmed, without blank lines (CRLF too)', () => {
  assert.deepEqual(linesToArray('Hydraulics\r\n  Hydrology  \n\n\nGIS\n'), ['Hydraulics', 'Hydrology', 'GIS']);
  assert.deepEqual(linesToArray('   '), []);
  assert.equal(arrayToLines(['a', 'b']), 'a\nb');
  assert.equal(arrayToLines(null), '');
});

test('schoolShortFrom drops the bracket and the country (spec 8: schoolShort feeds alumniOf)', () => {
  assert.equal(schoolShortFrom('Sari University of Agricultural Sciences and Natural Resources (SANRU), Iran'), 'Sari University of Agricultural Sciences and Natural Resources');
  assert.equal(schoolShortFrom('University of Birjand, Iran'), 'University of Birjand');
  assert.equal(schoolShortFrom('ETH Zurich'), 'ETH Zurich');
  assert.equal(schoolShortFrom(''), '');
});

/* ─── validation hints per section ─── */

test('issuesFor keeps the problems under the section keys, from the normalised draft', () => {
  const site = clone(SITE);
  site.profile.email = '   ';
  site.languages[0].name = '';
  site.services.items[0].icon = 'nope';
  const iconNames = Object.keys(icons);
  assert.deepEqual(issuesFor(site, { keys: ['profile'], icons: iconNames }), ['profile.email is empty']);
  assert.deepEqual(issuesFor(site, { keys: ['languages'], icons: iconNames }), ['languages[0].name is empty']);
  assert.deepEqual(issuesFor(site, { keys: ['services'], icons: iconNames }), ['services.items[0].icon "nope" is not a known icon']);
  assert.deepEqual(issuesFor(site, { keys: ['education'], icons: iconNames }), []);
});

test('issuesFor matches whole keys and honours exclusions (formSubject lives on the Contact page)', () => {
  const site = clone(SITE);
  site.site.formSubject = '';
  site.site.gaId = '';
  assert.deepEqual(issuesFor(site, { keys: ['site', 'seo'], exclude: ['site.formSubject'] }), ['site.gaId is empty']);
  assert.deepEqual(issuesFor(site, { keys: ['contactPage', 'thankYou', 'cta', 'site.formSubject'] }), ['site.formSubject is empty']);
  assert.deepEqual(issuesFor(site, { keys: ['sit'] }), [], 'a key is not a bare string prefix');
});

test('issuesFor does not report the derived phone fields while the override is off', () => {
  const site = clone(SITE);
  site.profile.phone.e164 = 'garbage';
  site.profile.whatsapp = '';
  assert.deepEqual(issuesFor(site, { keys: ['profile'] }), []);
  site.profile.phoneOverride = true;
  assert.deepEqual(issuesFor(site, { keys: ['profile'] }), ['profile.phone.e164 must be + followed by digits', 'profile.whatsapp must be digits only']);
});

/* ─── rich-text preview ─── */

test('previewContext fills the placeholders from the draft and survives a broken start date', () => {
  assert.deepEqual(previewContext(SITE, TODAY), {
    years: 16, year: 2026, name: `${SITE.profile.firstName} ${SITE.profile.lastName}`, roleTitle: SITE.profile.roleTitle, domain: SITE.site.domain,
  });
  const broken = clone(SITE);
  broken.site.experienceStart = '2009-13-40';
  assert.equal(previewContext(broken, TODAY).years, '{{years}}');
  assert.equal(previewContext({}, TODAY).name, '');
});

test('previewHtml renders bold and italic, escapes everything else, and splits paragraphs', () => {
  const ctx = previewContext(SITE, TODAY);
  assert.deepEqual(previewHtml('**Bold** and _it_ <script>x</script>', ctx, { inline: true }), {
    html: '<strong>Bold</strong> and <em>it</em> &lt;script&gt;x&lt;/script&gt;',
  });
  assert.deepEqual(previewHtml('one {{years}}\n\ntwo', ctx), { html: '<p>one <span data-years>16</span></p><p>two</p>' });
});

test('previewHtml reports an unknown placeholder instead of throwing', () => {
  assert.deepEqual(previewHtml('Hello {{nmae}}', previewContext(SITE, TODAY)), { error: 'Unknown placeholder {{nmae}}' });
});
