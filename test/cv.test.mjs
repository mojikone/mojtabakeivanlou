import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeSite, renderContext } from '../assets/js/render/model.mjs';
import { renderCv } from '../assets/js/render/cv.mjs';

// What the CV parity test cannot see (the normaliser collapses whitespace, unwraps the years span and drops ?v=) or what
// its exceptions cover (the inline <style>): the footer string, the current job, the tag order, bullets without files.

const site = normalizeSite(JSON.parse(await readFile('content/site.json', 'utf8')));
const today = new Date('2026-06-01T00:00:00Z');
const contextFor = (s, options = {}) => renderContext(s, { today, ...options });
const ctx = contextFor(site);

// A normalised copy of the site with `edit` applied, and the render context that goes with it.
function changed(edit) {
  const copy = structuredClone(site);
  edit(copy);
  const next = normalizeSite(copy);
  return [next, contextFor(next)];
}
const cv = (edit) => renderCv(...changed(edit));
const count = (text, needle) => text.split(needle).length - 1;

const FOOTER = /\n {2}@bottom-center \{\n {4}content: (.*);\n/;
const footerOf = (page) => FOOTER.exec(page)[1];
const inlineStyleOf = (page) => /<style>([^]*?)<\/style>/.exec(page)[1];

// ---- The @page footer -----------------------------------------------------------------------------------------------

test('the @page footer is name · domain · email · phone, then the page counters', () => {
  assert.equal(footerOf(renderCv(site, ctx)),
    '"Mojtaba Keivanlou  ·  mojtabakeivanlou.com  ·  keyvanlu.m@gmail.com  ·  +968 9297 0635  —  Page " counter(page) " of " counter(pages)');
  const out = cv((s) => {
    Object.assign(s.profile, { firstName: 'Ada', lastName: 'Lovelace', email: 'someone@example.org' });
    s.profile.phone.display = '+1 555 0100';
    s.site.domain = 'example.org';
  });
  assert.equal(footerOf(out), '"Ada Lovelace  ·  example.org  ·  someone@example.org  ·  +1 555 0100  —  Page " counter(page) " of " counter(pages)');
});

test('footer values are CSS-escaped: they cannot end the string or the <style> element', () => {
  const out = cv((s) => { s.profile.lastName = 'K"\\</style><i>'; });
  assert.equal(footerOf(out),
    String.raw`"Mojtaba K\22 \5c \3c /style\3e \3c i\3e   ·  mojtabakeivanlou.com  ·  keyvanlu.m@gmail.com  ·  +968 9297 0635  —  Page " counter(page) " of " counter(pages)`);
  assert.equal(count(out, '</style>'), 1);
  assert.doesNotMatch(inlineStyleOf(out), /</);
});

test('the @page rule is the only inline CSS, last in the head; everything else is linked from cv.css', () => {
  const out = renderCv(site, contextFor(site, { versions: { 'assets/css/cv.css': 'c55' } }));
  assert.equal(count(out, '<style>'), 1);
  assert.match(out, /<style>\n@page \{\n {2}size: A4;\n {2}margin: 13mm 0 16mm;\n {2}@bottom-center \{\n[^]*\n {2}\}\n\}\n<\/style>\n<\/head>\n/);
  assert.match(out, /<link rel="stylesheet" href="assets\/css\/cv\.css\?v=c55">/);
  assert.doesNotMatch(out, /main\.css/);
});

// ---- The head -------------------------------------------------------------------------------------------------------

test('the CV head: palette.js before the favicon, JSON-LD after it, then the CV fonts, cv.css and the @page style', () => {
  const out = renderCv(site, ctx);
  const at = ['rel="canonical" href="https://mojtabakeivanlou.com/cv.html"', 'assets/js/palette.js', 'rel="icon"', '"@type": "ProfilePage"',
    'family=Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400&display=swap', 'assets/css/cv.css', '<style>'].map((part) => out.indexOf(part));
  assert.ok(at.every((pos, i) => pos > (at[i - 1] ?? -1)), `head segments in the CV order (${at})`);
  assert.doesNotMatch(out, /0,200/);
  assert.match(out, /<title>CV — Mojtaba Keivanlou — Senior Hydraulic &amp; Water Resources Engineer<\/title>/);
});

// ---- The body -------------------------------------------------------------------------------------------------------

test('{{years}} stays live: a <span data-years> in the summary and the stats, the start date on <html>', () => {
  const out = renderCv(site, ctx);
  assert.match(out, /^<!DOCTYPE html>\n<html lang="en" data-experience-start="2009-09-23">/);
  assert.ok(out.includes('<script id="mk-years">'));
  assert.match(out, /<h2 class="sec-title">Professional <b>Summary<\/b><\/h2>\s*<p>Senior Hydraulic and Water Resources Engineer with <span data-years>16<\/span> years of experience/);
  assert.equal(count(out, '<p>'), 2, 'cvSummary renders as two paragraphs');
  assert.match(out, /<div><div class="stat-val"><span data-years>16<\/span>\+<\/div><div class="stat-lbl">Years Experience<\/div><\/div>/);
});

test('the stats come from profile.stats, in data order, labelled with cvLabel', () => {
  const out = cv((s) => {
    s.profile.stats = [
      { value: '7', suffix: '', label: 'Dams', cvLabel: 'Dams <Built>' },
      { value: '{{years}}', suffix: '+', label: 'Years', cvLabel: 'Years & Counting' },
    ];
  });
  const stats = /<div class="stats">([^]*?)\n {4}<\/div>/.exec(out)[1];
  assert.deepEqual([...stats.matchAll(/<div class="stat-val">(.*?)<\/div><div class="stat-lbl">(.*?)<\/div>/g)].map((m) => [m[1], m[2]]),
    [['7', 'Dams &lt;Built&gt;'], ['<span data-years>16</span>+', 'Years &amp; Counting']]);
});

test('job--current marks the current company only', () => {
  const jobs = (page) => [...page.matchAll(/<div class="(job[^"]*)">\s*<div class="job-head">\s*<div class="job-line1">\s*<div class="job-company">([^<]*)</g)]
    .map((m) => [m[1], m[2]]);
  assert.equal(site.experience.companies[0].current, true);
  assert.deepEqual(jobs(renderCv(site, ctx)), site.experience.companies.map((c, i) => [i === 0 ? 'job job--current' : 'job', c.name.replace('&', '&amp;')]));
  const moved = cv((s) => { s.experience.companies[0].current = false; s.experience.companies[2].current = true; });
  assert.deepEqual(jobs(moved).map(([cls]) => cls), ['job', 'job', 'job job--current', 'job', 'job']);
  assert.equal(count(moved, 'job--current'), 1);
});

test('within a skill category, expert tags come first (tag hi), then the rest, each group in data order', () => {
  const out = cv((s) => {
    s.skills[0].tags = [{ name: 'F1', level: 'familiar' }, { name: 'E1', level: 'expert' }, { name: 'F2', level: 'familiar' }, { name: 'E<2>', level: 'expert' }];
  });
  assert.match(out, /<div class="tags"><span class="tag hi">E1<\/span><span class="tag hi">E&lt;2&gt;<\/span><span class="tag">F1<\/span><span class="tag">F2<\/span><\/div>/);
});

test('bullets are plain <li> text: no download links or icons, even with files attached and unlocked', () => {
  const file = { id: '0123456789abcdef0123456789abcdef', name: 'Wadi_Majlas_Report.pdf', size: 4403211, type: 'application/pdf', enc: true };
  const [withFile, fileCtx] = changed((s) => {
    const majlas = s.experience.companies.flatMap((c) => c.projects).find((p) => p.name.startsWith('Majlas'));
    majlas.bullets.find((b) => b.text.startsWith('Techno-Economic')).files.push(file);
  });
  for (const out of [renderCv(withFile, fileCtx), renderCv(withFile, { ...fileCtx, unlocked: true })]) {
    assert.doesNotMatch(out, /proj-files|proj-dl|data-file|Wadi_Majlas_Report/);
    assert.match(out, /<li>Techno-Economic and Flood-Hazard Assessment of the Wadi Majlas Scheme<\/li>/);
    assert.doesNotMatch(out, /<li>[^<]*<(?!\/li>)/, 'nothing but text inside a bullet');
  }
});

test('proj-meta is period · <b>role</b> · scope with a plain " · ", leaving out what is empty', () => {
  const out = renderCv(site, ctx);
  assert.ok(out.includes('<div class="proj-meta">Feb 2023 – Present · <b>Team Leader</b> · OMR 6M (~USD 15.6M) · 15,000 km² study area</div>'));
  assert.ok(out.includes('<div class="proj-meta">Jan 2026 – Present · <b>Hydrology &amp; Hydraulic Engineer</b></div>'));
  assert.ok(out.includes('<div class="proj-meta">Jan 2020 – Sep 2020 · 127 km of river system</div>'));
  assert.ok(out.includes('<div class="proj-meta">Jan 2021 – Nov 2021</div>'));
  assert.doesNotMatch(out, /&nbsp;|&middot;/);
  const bare = cv((s) => { Object.assign(s.experience.companies[1].projects[0], { period: '', role: '', scope: '' }); });
  assert.match(bare, /<div class="proj-name">Shadow Lake Dam Safety Assessment — Glover, VT<\/div>\s*<ul>/, 'no empty proj-meta');
});

test('the header follows profile: name, role with its subtitle, location, phone (WhatsApp), email, domain', () => {
  const out = cv((s) => {
    Object.assign(s.profile, { roleTitle: 'Hydro <Lead>', roleSubtitle: 'Chief & Co', email: 'a@b.c' });
    Object.assign(s.profile.location, { city: 'Sohar', country: 'Oman' });
    s.profile.phone.display = '+968 1111 2222';
    s.site.domain = 'example.org';
  });
  assert.match(out, /<div class="cv-name">Mojtaba Keivanlou<\/div>\s*<div class="cv-role">Hydro &lt;Lead&gt; <em>· Chief &amp; Co<\/em><\/div>/);
  const contact = /<div class="cv-contact">([^]*?)<\/div>/.exec(out)[1];
  assert.deepEqual([...contact.matchAll(/<span><svg [^>]*>[^]*?<\/svg>([^<]*)<\/span>/g)].map((m) => m[1]),
    ['Sohar, Oman', '+968 1111 2222 (WhatsApp)', 'a@b.c', 'example.org']);
});

test('every text is escaped: services, jobs, projects, education, skills, languages', () => {
  const out = cv((s) => {
    s.services.items[0].title = 'S<1>';
    s.services.items[0].description = 'D & <d>';
    const job = s.experience.companies[0];
    Object.assign(job, { name: 'J<1>', period: 'P<1>', role: 'R<1>', location: 'L<1>', summary: 'Sum <1>' });
    Object.assign(job.projects[0], { name: 'N<1>', period: 'PP<1>', role: 'PR<1>', scope: 'Sc<1>' });
    job.projects[0].bullets[0].text = 'B<1>';
    Object.assign(s.education[0], { degree: 'Deg<1>', school: 'Sch<1>', year: 'Y<1>' });
    s.skills[0].category = 'C<1>';
    Object.assign(s.languages[0], { name: 'Lang<1>', level: 'Lev<1>' });
  });
  for (const html of ['</svg>S&lt;1&gt;</div>', '<div class="exp-desc">D &amp; &lt;d&gt;</div>', '<div class="job-company">J&lt;1&gt;</div>',
    '<div class="job-period">P&lt;1&gt;</div>', '<div class="job-role">R&lt;1&gt;</div>', '<div class="job-loc">L&lt;1&gt;</div>',
    '<p class="job-summary">Sum &lt;1&gt;</p>', '<div class="proj-name">N&lt;1&gt;</div>',
    '<div class="proj-meta">PP&lt;1&gt; · <b>PR&lt;1&gt;</b> · Sc&lt;1&gt;</div>', '<li>B&lt;1&gt;</li>',
    '<div class="edu-deg">Deg&lt;1&gt;</div>', '<div class="edu-school">Sch&lt;1&gt;</div>', '<div class="edu-year">Y&lt;1&gt;</div>',
    '<div class="skill-cat-name">C&lt;1&gt;</div>', '<div class="lang"><b>Lang&lt;1&gt;</b> <span>— Lev&lt;1&gt;</span></div>']) {
    assert.ok(out.includes(html), html);
  }
});

test('cv.mjs is browser-safe: it imports nothing from Node', async () => {
  const source = await readFile(new URL('../assets/js/render/cv.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from\s+['"]node:/);
  assert.doesNotMatch(source, /\brequire\s*\(/);
  assert.doesNotMatch(source, /\bprocess\./);
});
