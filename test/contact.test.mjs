import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeSite, renderContext } from '../assets/js/render/model.mjs';
import { renderIndex, downloadCvOnclick } from '../assets/js/render/index.mjs';
import { renderContact } from '../assets/js/render/contact.mjs';
import { renderThankYou } from '../assets/js/render/thank-you.mjs';

// What the parity test cannot see (the normaliser hides it) or what content drives: the form, the sidebar, the head.

const site = normalizeSite(JSON.parse(await readFile('content/site.json', 'utf8')));
const contextFor = (s) => renderContext(s, { today: new Date('2026-06-01T00:00:00Z') });
const ctx = contextFor(site);

// A normalised copy of the site with `edit` applied, and the render context that goes with it.
function changed(edit) {
  const copy = structuredClone(site);
  edit(copy);
  const next = normalizeSite(copy);
  return [next, contextFor(next)];
}
const contact = (edit) => renderContact(...changed(edit));
const thankYou = (edit) => renderThankYou(...changed(edit));

const count = (text, needle) => text.split(needle).length - 1;
const decode = (text) => text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&amp;', '&');

// ---- Contact: the form ------------------------------------------------------------------------------------------

test('the options are the disabled placeholder, then contactPage.projectTypes in order', () => {
  const select = /<select name="project_type" required>([^]*?)<\/select>/.exec(renderContact(site, ctx))[1];
  const options = [...select.matchAll(/<option([^>]*)>([^]*?)<\/option>/g)];
  assert.equal(options[0][1], ' value="" disabled selected');
  assert.equal(options[0][2], 'Select project type…');
  assert.deepEqual(options.slice(1).map((o) => decode(o[2])), site.contactPage.projectTypes);
  assert.ok(options.slice(1).every((o) => o[1] === ''), 'only the placeholder carries attributes');
});

test('project types are escaped and take their values from the data', () => {
  const out = contact((s) => { s.contactPage.projectTypes = ['Flood & <Dams>', 'Other {{years}}']; });
  assert.match(out, /<option value="" disabled selected>Select project type…<\/option>\s*<option>Flood &amp; &lt;Dams&gt;<\/option>\s*<option>Other 16<\/option>\s*<\/select>/);
});

test('the redirect and the canonical use site.site.domain, and nothing else carries the domain', () => {
  const out = contact((s) => { s.site.domain = 'example.org'; s.site.formSubject = 'New enquiry'; });
  assert.match(out, /<input type="hidden" name="redirect" value="https:\/\/example\.org\/thank-you\.html">/);
  assert.match(out, /<link rel="canonical" href="https:\/\/example\.org\/contact\.html">/);
  assert.doesNotMatch(out, /mojtabakeivanlou\.com/);
});

test('the web3forms key appears exactly once, as access_key, and the subject is escaped', () => {
  const out = contact((s) => { s.site.web3formsKey = 'key-1234'; s.site.formSubject = 'Enquiry "X" & <Y>'; });
  assert.equal(count(out, 'key-1234'), 1);
  assert.match(out, /<input type="hidden" name="access_key" value="key-1234">/);
  assert.match(out, /<input type="hidden" name="subject" value="Enquiry &quot;X&quot; &amp; &lt;Y&gt;">/);
  assert.equal(count(renderContact(site, ctx), site.site.web3formsKey), 1);
  assert.equal(count(renderThankYou(site, ctx), site.site.web3formsKey), 0);
});

test('the heading and the description placeholder come from contactPage, escaped', () => {
  const out = contact((s) => { s.contactPage.heading = ['A & B', 'C']; s.contactPage.descriptionPlaceholder = 'Say "hi" <now>'; });
  assert.match(out, /<h1 class="contact-heading">A &amp; B<br><span class="lime">C<\/span><\/h1>/);
  assert.match(out, /<textarea name="description" placeholder="Say &quot;hi&quot; &lt;now&gt;" required><\/textarea>/);
});

// ---- Contact: head, sidebar, card, script -----------------------------------------------------------------------

test('the head takes title and description from seo, escaped and filled, with no Open Graph and no JSON-LD', () => {
  const out = contact((s) => { s.seo.titleContact = 'Hire {{name}} & co'; s.seo.descriptionContact = 'D "{{years}}"'; });
  assert.match(out, /<title>Hire Mojtaba Keivanlou &amp; co<\/title>/);
  assert.match(out, /<meta name="description" content="D &quot;16&quot;">/);
  assert.doesNotMatch(out, /property="og:|name="twitter:|application\/ld\+json|noindex/);
});

test('the sidebar is rendered from the profile, in the order mail, phone, WhatsApp, LinkedIn, location', () => {
  const out = contact((s) => {
    s.profile.email = 'a@b.co'; s.profile.phone.display = '+1 555 0100'; s.profile.linkedin = 'https://linkedin.com/in/x';
    s.profile.location.city = 'Salalah'; s.profile.location.country = 'Oman';
  });
  const block = /<div class="contact-sidebar">\s*<div class="sidebar-block">([^]*?)<hr class="sidebar-divider">/.exec(out)[1];
  const lines = [...block.matchAll(/<div class="sidebar-contact-item">[^]*?<\/svg>\s*(<div>[^]*?<\/div>)\s*<\/div>/g)].map((m) => m[1]);
  assert.deepEqual(lines, [
    '<div><a href="mailto:a@b.co">a@b.co</a></div>',
    '<div><a href="tel:+15550100">+1 555 0100</a></div>',
    '<div><a href="https://wa.me/15550100" target="_blank" rel="noopener">WhatsApp</a></div>',
    '<div><a href="https://linkedin.com/in/x" target="_blank" rel="noopener">LinkedIn</a></div>',
    '<div>Salalah, Oman</div>',
  ]);
  assert.equal(count(block, 'class="sidebar-contact-icon"'), 5);
});

test('the business card is the home page card, in the sidebar wrapper', () => {
  const card = (page) => /<div class="card-scene">[^]*?<p class="biz-card-flip-hint">Tap to flip<\/p>/.exec(page)[0];
  const out = renderContact(site, ctx);
  assert.equal(card(out), card(renderIndex(site, ctx)));
  assert.match(out, /<div class="sidebar-biz-card">\s*<div class="card-scene">/);
  assert.doesNotMatch(out, /biz-card-cta/);
  assert.match(renderIndex(site, ctx), /<div class="biz-card-cta">\s*<div class="card-scene">/);
});

test('the Download CV button uses the shared onclick and fills the sidebar width', () => {
  const [other, otherCtx] = changed((s) => { s.site.cvPdfFilename = 'CV_Other.pdf'; });
  const out = renderContact(other, otherCtx);
  assert.ok(out.includes(`onclick="${downloadCvOnclick(other).html}"`));
  assert.match(out, /a\.download='CV_Other\.pdf'/);
  assert.match(out, / style="width:100%;justify-content:center;">/);
  assert.ok(renderContact(site, ctx).includes(`onclick="${downloadCvOnclick(site).html}"`));
});

test('the inline script is carried over from the original byte for byte', async () => {
  const original = (await readFile('test/fixtures/original/contact.html', 'utf8')).replace(/\r\n/g, '\n');
  const script = /<script>\n  \/\/ Populate local time on submit[^]*?<\/script>/.exec(original)[0];
  assert.match(script, /wa\\\.me\\\/\(\\d\+\)/, 'the regular expression keeps its backslashes');
  const out = renderContact(site, ctx);
  assert.ok(out.includes(script));
  assert.match(out, /<\/div>\s*<script>\n {2}\/\/ Populate local time on submit[^]*<\/script>\s*<\/body>\s*<\/html>\s*$/);
});

test('the topbar shows the name and is on-light on the contact page only', () => {
  const [other, otherCtx] = changed((s) => { s.profile.firstName = 'Ada'; s.profile.lastName = 'Lovelace'; });
  assert.match(renderContact(other, otherCtx), /<header class="topbar on-light" id="topbar">\s*<a class="topbar-logo" href="index\.html">Ada Lovelace<\/a>\s*<div class="topbar-right">\s*<a class="topbar-cta" href="index\.html">&larr; Back to CV<\/a>/);
  assert.match(renderThankYou(other, otherCtx), /<header class="topbar" id="topbar">\s*<a class="topbar-logo" href="index\.html">Ada Lovelace<\/a>/);
});

// ---- Thank-you ---------------------------------------------------------------------------------------------------

test('renderThankYou contains thankYou.text, escaped', () => {
  const real = renderThankYou(site, ctx);
  assert.ok(real.includes(`<p class="ty-sub">Thank you for reaching out. I&#39;ll review your enquiry and get back to you within 1–2 business days.</p>`));

  const out = thankYou((s) => { s.thankYou.text = '<b>Hi</b> & "bye" in {{years}} years'; });
  assert.match(out, /<p class="ty-sub">&lt;b&gt;Hi&lt;\/b&gt; &amp; &quot;bye&quot; in <span data-years>16<\/span> years<\/p>/);
  assert.doesNotMatch(out, /<b>Hi/);
});

test('the thank-you heading comes from thankYou.heading', () => {
  const out = thankYou((s) => { s.thankYou.heading = ['A & B', 'C']; });
  assert.match(out, /<div class="ty-heading">\s*<div>A &amp; B<\/div>\s*<div class="lime">C<\/div>\s*<\/div>/);
});

test('the thank-you head: noindex, title from seo, and no description, canonical, Open Graph or JSON-LD', () => {
  const out = renderThankYou(site, ctx);
  assert.match(out, /<title>Message Received — Mojtaba Keivanlou<\/title>\s*<meta name="robots" content="noindex">/);
  assert.doesNotMatch(out, /name="description"|rel="canonical"|property="og:|name="twitter:|application\/ld\+json/);
  assert.match(thankYou((s) => { s.seo.descriptionThankYou = 'Thanks & bye'; }), /<meta name="description" content="Thanks &amp; bye">/);
});

test('the thank-you buttons: Back to CV, and Download CV with the shared onclick', () => {
  const out = renderThankYou(site, ctx);
  assert.match(out, /<a class="btn-lime" href="index\.html">\s*Back to CV\s*<svg /);
  assert.ok(out.includes(`<a class="btn-outline-lt" href="cv.html" target="_blank" rel="noopener" onclick="${downloadCvOnclick(site).html}">`));
});

// ---- Both -------------------------------------------------------------------------------------------------------

test('contact.mjs, thank-you.mjs and topbar.mjs are browser-safe: they import nothing from Node', async () => {
  for (const file of ['contact.mjs', 'thank-you.mjs', 'topbar.mjs']) {
    const source = await readFile(new URL(`../assets/js/render/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from\s+['"]node:/, file);
    assert.doesNotMatch(source, /\brequire\s*\(/, file);
    assert.doesNotMatch(source, /\bprocess\./, file);
  }
});
