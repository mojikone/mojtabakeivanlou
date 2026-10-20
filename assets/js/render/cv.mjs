// Pure and browser-safe: no Node-only imports. Used by the Node build and by the admin UI.
//
// The CV (cv.html; the PDF is this page printed). Every text comes from site.json; what stays here is page furniture
// (the section titles, the "(WhatsApp)" note) and the print rule. The page's CSS is assets/css/cv.css, except the
// @page rule: its footer line is built from profile, so it is generated here and written inline.

import { html, raw, frag, fill, plainText, richText } from './html.mjs';
import { icon } from './icons.mjs';
import { sortedTags } from './model.mjs';
import { renderHead, cvJsonLd } from './head.mjs';

// The CV asks Google Fonts for its own weights: no 200, italic 400 added.
const CV_FONTS_URL = 'https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400&display=swap';

// As the original: palette.js before the favicon, JSON-LD after it.
const CV_HEAD_ORDER = ['ga', 'charset', 'viewport', 'title', 'robots', 'description', 'og', 'twitter', 'canonical', 'palette', 'favicon',
  'jsonLd', 'fonts', 'stylesheets', 'scripts', 'yearsScript', 'inlineStyles'];

// The CV sizes its icons in CSS (cv.css), so the library's width and height are removed.
const NO_SIZE = { width: null, height: null };

// A double-quoted CSS string that is also safe inside <style>: quotes, backslashes, line breaks and angle brackets
// become CSS escapes (a hex escape ends at the space that follows it).
const cssString = (text) => `"${String(text).replace(/[\\"<>\n\r\f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}"`;

/** The print rule: A4 with the original margins, and a footer with the contact line and the page counters. */
function pageStyle(site, ctx) {
  const p = site.profile;
  const footer = [ctx.name, site.site.domain, fill(p.email, ctx), fill(p.phone.display, ctx)].join('  ·  ');
  return `
@page {
  size: A4;
  margin: 13mm 0 16mm;
  @bottom-center {
    content: ${cssString(`${footer}  —  Page `)} counter(page) " of " counter(pages);
    font-family: 'Poppins', Arial, sans-serif;
    font-size: 7pt;
    letter-spacing: .03em;
    color: #6B7570;
  }
}
`;
}

function header(site, ctx) {
  const p = site.profile;
  const t = (text) => plainText(text, ctx);
  const heavy = { ...NO_SIZE, 'stroke-width': '2' };
  return frag`<!-- ══ HEADER ══════════════════════════════════════════ -->
  <header class="cv-header">
    <div class="cv-name">${ctx.name}</div>
    <div class="cv-role">${t(p.roleTitle)} <em>· ${t(p.roleSubtitle)}</em></div>
    <div class="cv-contact">
      <span>${icon('pin', heavy)}${t(p.location.city)}, ${t(p.location.country)}</span>
      <span>${icon('phone', NO_SIZE)}${t(p.phone.display)} (WhatsApp)</span>
      <span>${icon('mail', NO_SIZE)}${t(p.email)}</span>
      <span>${icon('globe', heavy)}${t(site.site.domain)}</span>
    </div>
  </header>
`;
}

function summary(site, ctx) {
  const p = site.profile;
  const t = (text) => plainText(text, ctx);
  return frag`<!-- ══ SUMMARY ═════════════════════════════════════════ -->
  <section class="summary">
    <h2 class="sec-title">Professional <b>Summary</b></h2>
    ${richText(p.cvSummary, ctx)}
    <div class="stats">
${p.stats.map((stat) => frag`      <div><div class="stat-val">${t(stat.value)}${stat.suffix ? t(stat.suffix) : ''}</div><div class="stat-lbl">${t(stat.cvLabel)}</div></div>
`)}    </div>
  </section>
`;
}

function expertise(site, ctx) {
  const t = (text) => plainText(text, ctx);
  return frag`<!-- ══ EXPERTISE ═══════════════════════════════════════ -->
  <section>
    <h2 class="sec-title">Areas of <b>Expertise</b></h2>
    <div class="exp-grid">
${site.services.items.map((service) => frag`      <div class="exp-item">
        <div class="exp-name">${icon(service.icon, NO_SIZE)}${t(service.title)}</div>
        <div class="exp-desc">${t(service.description)}</div>
      </div>
`)}    </div>
  </section>
`;
}

// "period · <b>role</b> · scope", leaving out the empty parts; the bullets are text only (no download links on the CV).
function project(proj, ctx) {
  const t = (text) => plainText(text, ctx);
  const meta = [proj.period && t(proj.period), proj.role && frag`<b>${t(proj.role)}</b>`, proj.scope && t(proj.scope)].filter(Boolean);
  return frag`      <div class="proj">
        <div class="proj-name">${t(proj.name)}</div>
${meta.length > 0 && frag`        <div class="proj-meta">${raw(meta.map((part) => part.html).join(' · '))}</div>
`}        <ul>
${proj.bullets.map((bullet) => frag`          <li>${t(bullet.text)}</li>
`)}        </ul>
      </div>
`;
}

function job(company, ctx) {
  const t = (text) => plainText(text, ctx);
  return frag`
    <div class="job${company.current ? ' job--current' : ''}">
      <div class="job-head">
        <div class="job-line1">
          <div class="job-company">${t(company.name)}</div>
          <div class="job-period">${t(company.period)}</div>
        </div>
        <div class="job-line2">
          <div class="job-role">${t(company.role)}</div>
          <div class="job-loc">${t(company.location)}</div>
        </div>
        <p class="job-summary">${t(company.summary)}</p>
      </div>
${(company.projects ?? []).map((proj) => project(proj, ctx))}    </div>
`;
}

function experience(site, ctx) {
  return frag`<!-- ══ EXPERIENCE ══════════════════════════════════════ -->
  <section>
    <h2 class="sec-title">Professional <b>Experience</b></h2>
${site.experience.companies.map((company) => job(company, ctx))}
  </section>
`;
}

function education(site, ctx) {
  const t = (text) => plainText(text, ctx);
  return frag`<!-- ══ EDUCATION ═══════════════════════════════════════ -->
  <section>
    <h2 class="sec-title">Education</h2>
${site.education.map((edu) => frag`    <div class="edu-item">
      <div>
        <div class="edu-deg">${t(edu.degree)}</div>
        <div class="edu-school">${t(edu.school)}</div>
      </div>
      <div class="edu-year">${t(edu.year)}</div>
    </div>
`)}  </section>
`;
}

function skills(site, ctx) {
  const t = (text) => plainText(text, ctx);
  return frag`<!-- ══ SKILLS ══════════════════════════════════════════ -->
  <section>
    <h2 class="sec-title">Skills &amp; <b>Software</b></h2>
${site.skills.map((skill) => frag`    <div class="skill-cat">
      <div class="skill-cat-name">${t(skill.category)}</div>
      <div class="tags">${sortedTags(skill.tags).map((tag) => frag`<span class="tag${tag.level === 'expert' ? ' hi' : ''}">${t(tag.name)}</span>`)}</div>
    </div>
`)}  </section>
`;
}

function languages(site, ctx) {
  const t = (text) => plainText(text, ctx);
  return frag`<!-- ══ LANGUAGES ═══════════════════════════════════════ -->
  <section>
    <h2 class="sec-title">Languages</h2>
    <div class="langs">
${site.languages.map((lang) => frag`      <div class="lang"><b>${t(lang.name)}</b> <span>— ${t(lang.level)}</span></div>
`)}    </div>
  </section>
`;
}

/** The whole CV page. */
export function renderCv(site, ctx) {
  const head = renderHead({
    site,
    ctx,
    page: 'cv',
    title: fill(site.seo.titleCv, ctx),
    description: fill(site.seo.descriptionCv, ctx),
    ogDescription: fill(site.seo.ogDescriptionCv, ctx),
    canonicalPath: 'cv.html',
    ogType: 'profile',
    jsonLd: cvJsonLd(site, ctx),
    fonts: CV_FONTS_URL,
    stylesheets: ['assets/css/cv.css'],
    inlineStyles: [pageStyle(site, ctx)],
    order: CV_HEAD_ORDER,
  });
  return html`${raw(head)}<body>

<div class="sheet">

  ${header(site, ctx)}
  ${summary(site, ctx)}
  ${expertise(site, ctx)}
  ${experience(site, ctx)}
  ${education(site, ctx)}
  ${skills(site, ctx)}
  ${languages(site, ctx)}
</div><!-- /.sheet -->

</body>
</html>
`;
}
