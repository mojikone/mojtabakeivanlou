// One-time helper (Task 7): extracts the long, repetitive lists of content/site.json from the original pages in
// test/fixtures/original/ and prints them as JSON. Regex per block; it ran once and its output was reviewed by hand
// before it went into content/site.json. Nothing imports this file.
//
//   node scripts/extract-content.mjs > lists.json     (disagreements between index.html and cv.html go to stderr)

import { readFileSync } from 'node:fs';
import { icons } from '../assets/js/render/icons.mjs';

const read = (page) => readFileSync(new URL(`../test/fixtures/original/${page}.html`, import.meta.url), 'utf8');
const index = read('index'), cv = read('cv'), contact = read('contact');

// ---- text helpers ----------------------------------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ', middot: '·', rarr: '→', mdash: '—', ndash: '–', hellip: '…', copy: '©' };

// Markup to site.json text: the &nbsp;&middot;&nbsp; separator becomes " · ", <strong>/<em> become **/_ markers,
// entities are decoded, whitespace collapsed.
function text(markup = '') {
  return markup
    .replace(/\s*&nbsp;&middot;&nbsp;\s*/g, ' · ')
    .replace(/<strong>([^]*?)<\/strong>/g, '**$1**')
    .replace(/<em>([^]*?)<\/em>/g, '_$1_')
    .replace(/&(#39|[a-z]+);/g, (whole, name) => ENTITIES[name] ?? whole)
    .replace(/\s+/g, ' ')
    .trim();
}
const one = (re, s) => re.exec(s)?.[1];
const all = (re, s) => [...s.matchAll(re)].map((m) => m[1]);
const between = (s, start, end) => s.slice(s.indexOf(start), s.indexOf(end, s.indexOf(start)));

// An inline <svg> is identified by its children (everything after the start tag): sizes and classes vary by place.
const children = (svg) => svg.replace(/^<svg[^>]*>/, '');
const iconNames = new Map();
for (const [name, svg] of Object.entries(icons)) if (!iconNames.has(children(svg))) iconNames.set(children(svg), name);
function iconOf(svg) {
  const name = iconNames.get(children(svg));
  if (!name) throw new Error(`No icon matches ${svg.slice(0, 80)}…`);
  return name;
}

const disagreements = [];
const differ = (what, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) disagreements.push({ what, index: a, cv: b }); };

// ---- JSON-LD (index.html) ---------------------------------------------------------------------------------------

const ld = JSON.parse(one(/<script type="application\/ld\+json">([^]*?)<\/script>/, index));
const offers = ld.hasOfferCatalog.itemListElement.map((o) => o.itemOffered);

// ---- experience (index.html timeline) --------------------------------------------------------------------------

const COMPANY_IDS = ['renardet', 'dubois-king', 'sazeh-pardazi', 'hydrotech-toos', 'earlier-positions'];
const PROJECT_IDS = [
  ['batinah', 'majlas', 'dhofar', 'batinah-carriageway', 'yankit'],
  ['shadow-lake'],
  ['hormozgan', 'lorestan', 'kerman', 'karaj-pipeline'],
  ['khorasan-network', 'mashhad-water', 'mashhad-sewage'],
  ['majd-ab-shargh', 'behin-ab-pazh', 'zharfab-pay', 'abgostaran'],
];

const timeline = between(index, '<div class="timeline">', '<!-- /.timeline -->');
const companies = timeline.split('<div class="tl-item').slice(1).map((block, i) => {
  const projects = block.split('<div class="proj-item">').slice(1).map((p, j) => {
    const [period, ...role] = text(one(/<div class="proj-meta">([^]*?)<\/div>/, p)).split(' · ');
    return {
      id: PROJECT_IDS[i][j],
      name: text(one(/<div class="proj-name">([^]*?)<\/div>/, p)),
      period,
      role: role.join(' · '),
      scope: text(one(/<div class="proj-scope">([^]*?)<\/div>/, p)),
      bullets: all(/<li>([^]*?)<\/li>/g, p).map((li) => ({ text: text(li), files: [] })),
    };
  });
  const company = {
    id: COMPANY_IDS[i],
    name: text(one(/<div class="tl-company">([^]*?)<\/div>/, block)),
    period: text(one(/<div class="tl-period">([^]*?)<\/div>/, block)),
  };
  if (block.startsWith(' now"')) company.current = true;
  Object.assign(company, {
    role: text(one(/<div class="tl-role">([^]*?)<\/div>/, block)),
    location: text(one(/<div class="tl-loc">([^]*?)<\/div>/, block)),
    summary: text(one(/<div class="tl-summary">([^]*?)<\/div>/, block)),
    expandLabel: text(one(/<button class="tl-expand"[^>]*>\s*<span>([^]*?)<\/span>/, block)),
    projects,
  });
  return company;
});

// The CV's copy of the same timeline, for the disagreement report.
const cvJobs = between(cv, '<div class="job', '<!-- ══ EDUCATION').split(/<div class="job(?: job--current)?">/).slice(1).map((block) => ({
  name: text(one(/<div class="job-company">([^]*?)<\/div>/, block)),
  period: text(one(/<div class="job-period">([^]*?)<\/div>/, block)),
  role: text(one(/<div class="job-role">([^]*?)<\/div>/, block)),
  location: text(one(/<div class="job-loc">([^]*?)<\/div>/, block)),
  summary: text(one(/<p class="job-summary">([^]*?)<\/p>/, block)),
  projects: block.split('<div class="proj">').slice(1).map((p) => ({
    name: text(one(/<div class="proj-name">([^]*?)<\/div>/, p)),
    meta: text(one(/<div class="proj-meta">([^]*?)<\/div>/, p).replace(/<\/?b>/g, '')),
    bullets: all(/<li>([^]*?)<\/li>/g, p).map(text),
  })),
}));
companies.forEach((c, i) => {
  const j = cvJobs[i];
  for (const key of ['name', 'period', 'role', 'location', 'summary']) differ(`experience.companies[${i}].${key}`, c[key], j[key]);
  differ(`experience.companies[${i}].projects.length`, c.projects.length, j.projects.length);
  c.projects.forEach((p, k) => {
    const q = j.projects[k];
    if (!q) return;
    differ(`experience.companies[${i}].projects[${k}].name`, p.name, q.name);
    differ(`experience.companies[${i}].projects[${k}].meta`, [p.period, p.role, p.scope].filter(Boolean).join(' · '), q.meta);
    differ(`experience.companies[${i}].projects[${k}].bullets`, p.bullets.map((b) => b.text), q.bullets);
  });
});

// ---- services (index.html expertise cards + JSON-LD keywords) ---------------------------------------------------

const services = index.split('<div class="exp-card reveal').slice(1).map((card, i) => {
  const title = text(one(/<span class="exp-card-title">([^]*?)<\/span>/, card));
  const description = text(one(/<div class="exp-card-desc">([^]*?)<\/div>/, card));
  const offer = offers[i];
  if (offer.name !== title) disagreements.push({ what: `services.items[${i}].title vs JSON-LD`, index: title, jsonLd: offer.name });
  if (offer.description !== description) disagreements.push({ what: `services.items[${i}].description vs JSON-LD`, index: description, jsonLd: offer.description });
  return { title, icon: iconOf(one(/<span class="exp-card-icon">(<svg[^]*?<\/svg>)<\/span>/, card)), description, keywords: offer.serviceType };
});
const cvServices = all(/<div class="exp-item">([^]*?)<\/div>\s*<\/div>/g, cv).map((item) => ({
  title: text(item.replace(/^[^]*?<\/svg>/, '').replace(/<\/div>[^]*$/, '')),
  description: text(one(/<div class="exp-desc">([^]*?)$/, item)),
}));
services.forEach((s, i) => {
  differ(`services.items[${i}].title`, s.title, cvServices[i]?.title);
  differ(`services.items[${i}].description`, s.description, cvServices[i]?.description);
});

// ---- skills ---------------------------------------------------------------------------------------------------

const skillsOf = (html, tagClass) => html.split(/<div class="skill-cat(?:"| reveal)/).slice(1).map((cat) => ({
  category: text(one(/<div class="skill-cat-name">([^]*?)<\/div>/, cat)),
  tags: [...cat.matchAll(new RegExp(`<span class="${tagClass}( hi)?">([^]*?)</span>`, 'g'))]
    .map((m) => ({ name: text(m[2]), level: m[1] ? 'expert' : 'familiar' })),
}));
const skills = skillsOf(index, 'tag-lt');
differ('skills', skills, skillsOf(cv, 'tag'));
skills.forEach((s, i) => {
  const firstFamiliar = s.tags.findIndex((t) => t.level === 'familiar');
  if (firstFamiliar >= 0 && s.tags.slice(firstFamiliar).some((t) => t.level === 'expert')) {
    disagreements.push({ what: `skills[${i}] has an expert tag after a familiar one: the template sorts experts first` });
  }
});

// ---- education, business card, contact page --------------------------------------------------------------------

const eduOf = (html) => all(/<div class="edu-item">([^]*?)<div class="edu-year">/g, html).map((item, i) => ({
  degree: text(one(/<div class="edu-deg">([^]*?)<\/div>/, item)),
  school: text(one(/<div class="edu-school">([^]*?)<\/div>/, item)),
  year: text(all(/<div class="edu-year">([^]*?)<\/div>/g, html)[i]),
}));
const education = eduOf(index).map((e, i) => ({ degree: e.degree, school: e.school, schoolShort: ld.alumniOf[i].name, year: e.year }));
differ('education', eduOf(index), eduOf(cv));

const businessCard = {
  titleLines: one(/<div class="bc-title">([^]*?)<\/div>/, index).split('<br>').map(text),
  cells: [...index.matchAll(/<div class="bc-cell">(<svg[^]*?<\/svg>)<span class="bc-cell-label">([^]*?)<\/span><\/div>/g)]
    .map((m) => ({ label: text(m[2]), icon: iconOf(m[1]) })),
};

const projectTypes = all(/<option>([^]*?)<\/option>/g, contact).map(text);

// ---- output -----------------------------------------------------------------------------------------------------

console.log(JSON.stringify({
  businessCard,
  education,
  services,
  experience: { companies },
  skills,
  projectTypes,
  knowsAbout: ld.knowsAbout,
}, null, 2));
if (disagreements.length) console.error(JSON.stringify({ disagreements }, null, 2));
