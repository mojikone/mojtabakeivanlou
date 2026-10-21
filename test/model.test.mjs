import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateSite, normalizeSite, slugify, phoneToE164, renderContext, sortedTags } from '../assets/js/render/model.mjs';
import { shortHash } from '../src/hash.mjs';

const min = JSON.parse(readFileSync(new URL('./fixtures/site.min.json', import.meta.url), 'utf8'));
const TODAY = new Date('2026-06-01T00:00:00Z');
const ICONS = ['waves', 'dam'];

// Clone of the fixture with one value replaced; `path` is a dotted/indexed path such as "a.b[0].c".
function withValue(path, value) {
  const site = structuredClone(min);
  const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  const last = keys.pop();
  let node = site;
  for (const k of keys) node = node[k];
  if (value === undefined) delete node[last]; else node[last] = value;
  return site;
}
const errorsOf = (site, options = {}) => validateSite(site, { icons: ICONS, today: TODAY, ...options });

function deepFreeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}

// ---- The brief's tests ----------------------------------------------------------------------------------------

test('phoneToE164 tolerates spaces, dashes, brackets', () => {
  for (const d of ['+968 9297 0635', '+968-9297-0635', '(+968) 9297 0635']) assert.equal(phoneToE164(d), '+96892970635');
});
test('normalizeSite derives whatsapp and expand labels', () => {
  const s = normalizeSite(min);
  assert.equal(s.profile.whatsapp, '96892970635');
  assert.equal(s.experience.companies[0].expandLabel, 'View project');
});
test('validateSite reports paths', () => {
  const bad = structuredClone(min); bad.experience.companies[0].projects[0].bullets[0].text = ' ';
  bad.skills[0].tags[0].level = 'guru';
  const errs = validateSite(bad, { icons: ['waves'] });
  assert.ok(errs.includes('experience.companies[0].projects[0].bullets[0].text is empty'));
  assert.ok(errs.some(e => e.startsWith('skills[0].tags[0].level')));
});
test('slugify and sortedTags', () => {
  assert.equal(slugify('Majlas Dam — Quriyat', new Set(['majlas-dam-quriyat'])), 'majlas-dam-quriyat-2');
  assert.deepEqual(sortedTags([{name:'a',level:'familiar'},{name:'b',level:'expert'}]).map(t=>t.name), ['b','a']);
});
test('renderContext versions assets', () => {
  const c = renderContext(min, { today: new Date('2026-06-01T00:00:00Z'), versions: { 'assets/css/main.css': 'abcd1234' } });
  assert.equal(c.years, 16); assert.equal(c.v('assets/css/main.css'), 'assets/css/main.css?v=abcd1234'); assert.equal(c.v('x.js'), 'x.js?v=dev');
});

// ---- Fixture ----------------------------------------------------------------------------------------------------

test('the minimal fixture is valid and exercises derivation and placeholders', () => {
  assert.deepEqual(errorsOf(min), []);
  assert.deepEqual(validateSite(min), []);                          // icons and today are optional
  assert.equal(min.profile.phone.e164, undefined);
  assert.equal(min.experience.companies.length, 1);
  assert.equal(min.experience.companies[0].projects.length, 1);
  assert.match(min.experience.intro, /\{\{years\}\}/);
});

// ---- validateSite: required values ------------------------------------------------------------------------------

test('validateSite: every required string is reported by path when blank, and when missing', () => {
  const required = [
    'site.domain', 'site.gaId', 'site.web3formsKey', 'site.formSubject',
    'profile.firstName', 'profile.lastName', 'profile.roleTitle', 'profile.roleTitleLong', 'profile.email', 'profile.phone.display',
    'profile.heroHeadline[0]', 'profile.heroHeadline[1]',
    'education[0].degree', 'education[0].school', 'education[0].year',
    'languages[0].name', 'languages[0].level',
    'services.intro', 'services.items[0].title', 'services.items[0].icon', 'services.items[0].description',
    'experience.intro',
    'experience.companies[0].name', 'experience.companies[0].period', 'experience.companies[0].role',
    'experience.companies[0].location', 'experience.companies[0].summary',
    'experience.companies[0].projects[0].name', 'experience.companies[0].projects[0].period',
    'experience.companies[0].projects[0].bullets[0].text',
    'skills[0].category', 'skills[0].tags[0].name',
    'contactPage.heading[0]', 'contactPage.heading[1]', 'contactPage.projectTypes[0]',
    'thankYou.heading[0]', 'thankYou.heading[1]', 'thankYou.text',
    'cta.heading[0]', 'cta.heading[1]', 'cta.sub',
    'seo.titleIndex', 'seo.titleCv', 'seo.descriptionIndex', 'seo.ogDescriptionIndex',
    'seo.descriptionCv', 'seo.ogDescriptionCv', 'seo.titleContact', 'seo.descriptionContact', 'seo.titleThankYou',
    'seo.personDescription', 'seo.knowsAbout[0]',
  ];
  for (const path of required) {
    assert.ok(errorsOf(withValue(path, '  ')).includes(`${path} is empty`), `${path} blank`);
    if (!/\[\d+\]$/.test(path)) assert.ok(errorsOf(withValue(path, undefined)).includes(`${path} is missing`), `${path} missing`);
  }
});

test('validateSite: seo.descriptionThankYou must be present and a string, but may be empty (the page has no description)', () => {
  assert.deepEqual(errorsOf(withValue('seo.descriptionThankYou', '')), []);
  assert.ok(errorsOf(withValue('seo.descriptionThankYou', undefined)).includes('seo.descriptionThankYou is missing'));
  assert.ok(errorsOf(withValue('seo.descriptionThankYou', 5)).includes('seo.descriptionThankYou must be a string'));
});

test('validateSite: wrong types are reported, never thrown', () => {
  assert.ok(errorsOf(withValue('profile.firstName', 5)).includes('profile.firstName must be a string'));
  assert.ok(errorsOf(withValue('experience.companies', 'x')).includes('experience.companies must be an array'));
  assert.ok(errorsOf(withValue('profile.phone', 'x')).includes('profile.phone must be an object'));
  assert.ok(errorsOf(withValue('experience.companies[0]', null)).includes('experience.companies[0] is missing'));
  assert.ok(errorsOf(withValue('skills', undefined)).includes('skills is missing'));
  assert.deepEqual(validateSite(null), ['(root) must be an object']);
  assert.deepEqual(validateSite([]), ['(root) must be an object']);
  assert.ok(validateSite({}).includes('site is missing'));
});

test('validateSite: schemaVersion must be 1', () => {
  assert.ok(errorsOf(withValue('schemaVersion', 2)).includes('schemaVersion must be 1'));
  assert.ok(errorsOf(withValue('schemaVersion', undefined)).includes('schemaVersion must be 1'));
});

test('validateSite: contactPage.projectTypes needs at least one entry', () => {
  assert.ok(errorsOf(withValue('contactPage.projectTypes', [])).includes('contactPage.projectTypes must have at least one entry'));
});

test('validateSite: fields that may be empty are allowed to be, but not absent or non-string', () => {
  assert.deepEqual(errorsOf(withValue('experience.companies[0].projects[0].scope', '')), []);
  assert.deepEqual(errorsOf(withValue('profile.stats[0].suffix', '')), []);
  assert.ok(errorsOf(withValue('experience.companies[0].projects[0].scope', undefined)).includes('experience.companies[0].projects[0].scope is missing'));
  assert.ok(errorsOf(withValue('profile.stats[0].suffix', 3)).includes('profile.stats[0].suffix must be a string'));
});

// ---- validateSite: shapes ---------------------------------------------------------------------------------------

test('validateSite: heading arrays must be exactly two strings', () => {
  for (const path of ['profile.heroHeadline', 'contactPage.heading', 'thankYou.heading', 'cta.heading']) {
    assert.ok(errorsOf(withValue(path, ['One'])).includes(`${path} must have exactly two strings`), `${path} one`);
    assert.ok(errorsOf(withValue(path, ['a', 'b', 'c'])).includes(`${path} must have exactly two strings`), `${path} three`);
    assert.ok(errorsOf(withValue(path, 'ab')).includes(`${path} must be an array`), `${path} string`);
  }
  assert.ok(errorsOf(withValue('cta.heading', ['ok', 7])).includes('cta.heading[1] must be a string'));
});

test('validateSite: skill tag levels', () => {
  assert.ok(errorsOf(withValue('skills[0].tags[0].level', 'guru')).includes('skills[0].tags[0].level must be expert or familiar'));
  assert.ok(errorsOf(withValue('skills[0].tags[1].level', undefined)).includes('skills[0].tags[1].level must be expert or familiar'));
});

test('validateSite: experienceStart must be a real, non-future YYYY-MM-DD date', () => {
  const start = (v) => errorsOf(withValue('site.experienceStart', v));
  assert.ok(start('2030-01-01').includes('site.experienceStart is in the future'));
  assert.ok(start('2026-06-02').includes('site.experienceStart is in the future'));
  assert.deepEqual(start('2026-06-01'), []);                        // today itself is not the future
  assert.deepEqual(start('2026-05-31'), []);
  for (const bad of ['2009-9-23', '23/09/2009', '2009-02-30', '2009-13-01', '']) {
    assert.ok(start(bad).some((e) => e.startsWith('site.experienceStart ') && !e.includes('future')), `rejects "${bad}"`);
  }
  assert.ok(start(undefined).includes('site.experienceStart is missing'));
});

test('validateSite: the future check follows the injected today, defaulting to the real clock', () => {
  const site = withValue('site.experienceStart', '2026-06-02');
  assert.deepEqual(validateSite(site, { today: new Date('2026-06-02T00:00:00Z') }), []);
  assert.ok(validateSite(site, { today: new Date('2026-06-01T23:59:59Z') }).includes('site.experienceStart is in the future'));
  const farFuture = withValue('site.experienceStart', '9999-12-31');
  assert.ok(validateSite(farFuture).includes('site.experienceStart is in the future'));
});

test('validateSite: profile.linkedin must start with http:// or https:// (it becomes an href: never javascript:)', () => {
  const message = 'profile.linkedin must start with http:// or https://';
  for (const bad of [
    'javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', '\u0001javascript:alert(1)', 'data:text/html,<b>x</b>',
    'vbscript:x', 'mailto:me@example.com', 'linkedin.com/in/x', '//linkedin.com/in/x', 'HTTPS://linkedin.com/in/x', 'https:/x',
  ]) {
    assert.ok(errorsOf(withValue('profile.linkedin', bad)).includes(message), JSON.stringify(bad));
  }
  for (const good of ['https://linkedin.com/in/MojtabaKeivanlou', 'http://example.com/x']) {
    assert.deepEqual(errorsOf(withValue('profile.linkedin', good)), [], good);
  }
  assert.deepEqual(errorsOf(withValue('profile.linkedin', ' ')), ['profile.linkedin is empty'], 'one message per problem');
});

test('validateSite: site.cvPdfFilename must be a plain file name (no folder, no parent step)', () => {
  const message = 'site.cvPdfFilename must be a plain file name';
  for (const bad of ['pdf/cv.pdf', '../cv.pdf', '..\\cv.pdf', 'a\\b.pdf', '/etc/cv.pdf', 'cv..pdf', '..']) {
    assert.ok(errorsOf(withValue('site.cvPdfFilename', bad)).includes(message), bad);
  }
  assert.deepEqual(errorsOf(withValue('site.cvPdfFilename', 'CV_Mojtaba_Keivanlou_2026.pdf')), []);
  assert.deepEqual(errorsOf(withValue('site.cvPdfFilename', 'cv.v2.pdf')), []);
  assert.deepEqual(errorsOf(withValue('site.cvPdfFilename', '../cv.txt')).sort(), [message, 'site.cvPdfFilename must end in .pdf'].sort());
});

test('validateSite: site.domain must match ^[a-z0-9.-]+$', () => {
  const message = 'site.domain must be a host name: lower-case letters, digits, dots and hyphens only';
  for (const bad of ['Example.com', 'example.com/path', 'https://example.com', 'example.com:8080', 'ex ample.com', 'évil.com', 'x.com"><b>', 'user@example.com']) {
    assert.ok(errorsOf(withValue('site.domain', bad)).includes(message), bad);
  }
  for (const good of ['mojtabakeivanlou.com', 'sub-domain.example.co.uk', 'localhost', '127.0.0.1']) {
    assert.deepEqual(errorsOf(withValue('site.domain', good)), [], good);
  }
  assert.deepEqual(errorsOf(withValue('site.domain', '')), ['site.domain is empty'], 'one message per problem');
});

test('validateSite: cvPdfFilename must end in .pdf', () => {
  assert.ok(errorsOf(withValue('site.cvPdfFilename', 'cv.docx')).includes('site.cvPdfFilename must end in .pdf'));
  assert.ok(errorsOf(withValue('site.cvPdfFilename', 'cv.pdf.txt')).includes('site.cvPdfFilename must end in .pdf'));
  assert.ok(errorsOf(withValue('site.cvPdfFilename', '')).includes('site.cvPdfFilename is empty'));
  assert.deepEqual(errorsOf(withValue('site.cvPdfFilename', 'CV.pdf')), []);
});

test('validateSite: phone display must hold digits; override values must be well formed', () => {
  assert.ok(errorsOf(withValue('profile.phone.display', 'call me')).includes('profile.phone.display must contain digits'));
  const override = withValue('profile.phoneOverride', true);
  assert.ok(errorsOf(override).includes('profile.phone.e164 is missing'));
  assert.ok(errorsOf(override).includes('profile.whatsapp is missing'));
  override.profile.phone.e164 = '96892970635'; override.profile.whatsapp = '+96892970635';
  const errs = errorsOf(override);
  assert.ok(errs.includes('profile.phone.e164 must be + followed by digits'));
  assert.ok(errs.includes('profile.whatsapp must be digits only'));
  override.profile.phone.e164 = '+96892970635'; override.profile.whatsapp = '96892970635';
  assert.deepEqual(errorsOf(override), []);
  assert.ok(errorsOf(withValue('profile.phoneOverride', 'yes')).includes('profile.phoneOverride must be true or false'));
});

// ---- validateSite: ids, files, icons, placeholders --------------------------------------------------------------

test('validateSite: ids must be slugs', () => {
  assert.ok(errorsOf(withValue('experience.companies[0].id', 'Bad Id')).includes('experience.companies[0].id must match ^[a-z0-9-]+$'));
  assert.ok(errorsOf(withValue('experience.companies[0].projects[0].id', '')).includes('experience.companies[0].projects[0].id must match ^[a-z0-9-]+$'));
  assert.ok(errorsOf(withValue('experience.companies[0].id', undefined)).includes('experience.companies[0].id is missing'));
});

test('validateSite: ids are unique across companies and projects together', () => {
  const clash = withValue('experience.companies[0].projects[0].id', 'renardet');
  assert.deepEqual(errorsOf(clash).filter((e) => e.includes('renardet')),
    ['experience.companies[0].projects[0].id duplicates experience.companies[0].id ("renardet")']);

  const twoCompanies = structuredClone(min);
  twoCompanies.experience.companies.push({ ...structuredClone(min.experience.companies[0]), projects: [] });
  const errs = errorsOf(twoCompanies);
  assert.deepEqual(errs, ['experience.companies[1].id duplicates experience.companies[0].id ("renardet")']);

  const twoProjects = structuredClone(min);
  twoProjects.experience.companies[0].projects.push(structuredClone(min.experience.companies[0].projects[0]));
  assert.deepEqual(errorsOf(twoProjects),
    ['experience.companies[0].projects[1].id duplicates experience.companies[0].projects[0].id ("majlas")']);
});

test('validateSite: file entries', () => {
  const FILE = { id: 'a'.repeat(32), name: 'report.pdf', size: 10, type: 'application/pdf', enc: true };
  const bulletFiles = 'experience.companies[0].projects[0].bullets[0].files';
  assert.deepEqual(errorsOf(withValue(bulletFiles, [FILE, { ...FILE, id: '0123456789abcdef0123456789abcdef', size: 0, type: '', enc: false }])), []);

  const prefix = `${bulletFiles}[0]`;
  const err = (patch) => errorsOf(withValue(bulletFiles, [{ ...FILE, ...patch }]));
  for (const id of ['XYZ', 'A'.repeat(32), 'a'.repeat(31), 'a'.repeat(33), 'g'.repeat(32), 7]) {
    assert.ok(err({ id }).includes(`${prefix}.id must be 32 lowercase hex characters`), `id ${id}`);
  }
  assert.ok(errorsOf(withValue(bulletFiles, [{ ...FILE, id: undefined }])).includes(`${prefix}.id must be 32 lowercase hex characters`));
  assert.ok(err({ name: ' ' }).includes(`${prefix}.name is empty`));
  for (const size of [-1, 1.5, '10', null, NaN]) assert.ok(err({ size }).includes(`${prefix}.size must be a non-negative integer`), `size ${size}`);
  assert.ok(err({ type: 5 }).includes(`${prefix}.type must be a string`));
  assert.ok(err({ enc: 'yes' }).includes(`${prefix}.enc must be true or false`));
  assert.ok(errorsOf(withValue(bulletFiles, 'x')).includes(`${bulletFiles} must be an array`));
  assert.ok(errorsOf(withValue(bulletFiles, undefined)).includes(`${bulletFiles} is missing`));
});

test('validateSite: service icons are checked only when icons are supplied', () => {
  const site = withValue('services.items[0].icon', 'nope');
  assert.ok(errorsOf(site).includes('services.items[0].icon "nope" is not a known icon'));
  assert.deepEqual(validateSite(site, { today: TODAY }), []);
  assert.deepEqual(errorsOf(withValue('services.items[0].icon', 'dam')), []);
});

test('validateSite: unknown placeholders are reported with the field path, in any string', () => {
  const bullet = 'experience.companies[0].projects[0].bullets[0].text';
  assert.deepEqual(errorsOf(withValue(bullet, 'Hello {{nope}}')), [`${bullet} has unknown placeholder {{nope}}`]);
  assert.deepEqual(errorsOf(withValue('seo.knowsAbout[0]', '{{bad}} term')), ['seo.knowsAbout[0] has unknown placeholder {{bad}}']);
  assert.deepEqual(errorsOf(withValue('cta.heading[1]', 'x {{ years }}')), ['cta.heading[1] has unknown placeholder {{ years }}']);
  assert.deepEqual(errorsOf(withValue('profile.bio', '{{years}} {{year}} {{name}} {{roleTitle}} {{domain}}')), []);
  assert.deepEqual(errorsOf(withValue('profile.bio', 'only {{ half')), []);
});

test('validateSite: reports every problem in one pass', () => {
  const bad = withValue('profile.firstName', '');
  bad.cta.sub = ''; bad.site.cvPdfFilename = 'x.txt';
  assert.deepEqual(errorsOf(bad).sort(), ['cta.sub is empty', 'profile.firstName is empty', 'site.cvPdfFilename must end in .pdf']);
});

// ---- normalizeSite ----------------------------------------------------------------------------------------------

test('normalizeSite never mutates its input and returns an independent deep clone', () => {
  const frozen = deepFreeze(structuredClone(min));
  const before = JSON.stringify(frozen);
  const out = normalizeSite(frozen);                                // assignment to a frozen object would throw
  assert.equal(JSON.stringify(frozen), before);
  assert.notEqual(out, frozen);
  assert.notEqual(out.profile, frozen.profile);
  assert.notEqual(out.experience.companies[0].projects[0].bullets, frozen.experience.companies[0].projects[0].bullets);
  out.profile.heroHeadline[0] = 'changed'; out.skills[0].tags.pop();
  assert.equal(frozen.profile.heroHeadline[0], 'Senior Hydraulic &');
  assert.equal(frozen.skills[0].tags.length, 2);
});

test('normalizeSite trims every string, keeps other values', () => {
  const site = structuredClone(min);
  site.profile.firstName = '  Mojtaba \n';
  site.profile.heroHeadline = [' a ', 'b  '];
  site.experience.companies[0].projects[0].bullets[0].text = '\t text ';
  site.experience.companies[0].current = false;
  site.experience.companies[0].projects[0].bullets[0].files = [{ id: 'a'.repeat(32), name: ' f.pdf ', size: 3, type: 'application/pdf', enc: true }];
  const s = normalizeSite(site);
  assert.equal(s.profile.firstName, 'Mojtaba');
  assert.deepEqual(s.profile.heroHeadline, ['a', 'b']);
  assert.equal(s.experience.companies[0].projects[0].bullets[0].text, 'text');
  assert.equal(s.experience.companies[0].current, false);
  assert.deepEqual(s.experience.companies[0].projects[0].bullets[0].files, [{ id: 'a'.repeat(32), name: 'f.pdf', size: 3, type: 'application/pdf', enc: true }]);
  assert.equal(s.schemaVersion, 1);
  assert.equal(s.profile.bio, min.profile.bio);                     // inner blank lines survive
});

test('normalizeSite derives e164 and whatsapp from the display number, replacing stale values', () => {
  const s = normalizeSite(min);
  assert.equal(s.profile.phone.e164, '+96892970635');
  assert.equal(s.profile.phone.display, '+968 9297 0635');
  const stale = structuredClone(min);
  stale.profile.phone.e164 = '+1'; stale.profile.whatsapp = '1';
  const t = normalizeSite(stale);
  assert.equal(t.profile.phone.e164, '+96892970635'); assert.equal(t.profile.whatsapp, '96892970635');
});

test('normalizeSite keeps e164 and whatsapp when profile.phoneOverride is true', () => {
  const site = structuredClone(min);
  site.profile.phoneOverride = true; site.profile.phone.e164 = ' +441234567890 '; site.profile.whatsapp = '441234567899';
  const s = normalizeSite(site);
  assert.equal(s.profile.phone.e164, '+441234567890'); assert.equal(s.profile.whatsapp, '441234567899');
  assert.equal(s.profile.phoneOverride, true);
});

test('normalizeSite fills expandLabel by project count and keeps an existing one', () => {
  const site = structuredClone(min);
  const company = site.experience.companies[0];
  company.projects.push({ ...structuredClone(company.projects[0]), id: 'second' });
  assert.equal(normalizeSite(site).experience.companies[0].expandLabel, 'View all projects');
  company.projects = [];
  assert.equal(normalizeSite(site).experience.companies[0].expandLabel, 'View all projects');
  company.expandLabel = '  View all positions ';
  assert.equal(normalizeSite(site).experience.companies[0].expandLabel, 'View all positions');
  company.expandLabel = '   ';
  assert.equal(normalizeSite(site).experience.companies[0].expandLabel, 'View all projects');
});

test('normalizeSite slugifies missing ids without clashing with any existing id', () => {
  const site = structuredClone(min);
  const first = site.experience.companies[0];
  delete first.id;
  first.name = 'Majlas';                                            // slug "majlas" is taken by a project id further down
  first.projects[0].id = 'majlas';
  site.experience.companies.push({ ...structuredClone(first), id: undefined, name: 'Majlas', projects: [{ ...structuredClone(first.projects[0]), id: '', name: 'Majlas' }] });
  const s = normalizeSite(site);
  const ids = [s.experience.companies[0].id, s.experience.companies[0].projects[0].id, s.experience.companies[1].id, s.experience.companies[1].projects[0].id];
  assert.deepEqual(ids, ['majlas-2', 'majlas', 'majlas-3', 'majlas-4']);
  assert.equal(new Set(ids).size, 4);
  assert.deepEqual(errorsOf(s), []);
});

test('normalizeSite leaves existing ids alone and tolerates partial input', () => {
  assert.equal(normalizeSite(min).experience.companies[0].id, 'renardet');
  assert.deepEqual(normalizeSite({}), {});
  assert.deepEqual(normalizeSite({ profile: {}, experience: {} }), { profile: {}, experience: {} });
  assert.deepEqual(normalizeSite({ profile: { phone: {} } }), { profile: { phone: {} } });
});

test('a normalised, valid site stays valid and normalising twice changes nothing', () => {
  const once = normalizeSite(min);
  assert.deepEqual(errorsOf(once), []);
  assert.deepEqual(normalizeSite(once), once);
});

// ---- slugify / phoneToE164 / sortedTags -------------------------------------------------------------------------

test('slugify: lower-cases, collapses runs, trims hyphens, numbers duplicates', () => {
  assert.equal(slugify('  Renardet S.A. & Partners! ', new Set()), 'renardet-s-a-partners');
  assert.equal(slugify('Wadi--Majlas __ Dam', new Set()), 'wadi-majlas-dam');
  const taken = new Set(['dam', 'dam-2', 'dam-3']);
  assert.equal(slugify('DAM', taken), 'dam-4');
  assert.deepEqual([...taken], ['dam', 'dam-2', 'dam-3']);          // the caller owns `taken`
});
test('slugify: text with no usable characters still yields a valid slug', () => {
  assert.equal(slugify('—', new Set()), 'item');
  assert.equal(slugify('', new Set(['item'])), 'item-2');
  assert.match(slugify('سد مجلس', new Set()), /^[a-z0-9-]+$/);
});

test('phoneToE164 keeps digits only behind a single leading plus', () => {
  assert.equal(phoneToE164('96892970635'), '+96892970635');
  assert.equal(phoneToE164('+ (968) 9297-0635 ext.'), '+96892970635');
  assert.equal(phoneToE164('none'), '+');
});

test('sortedTags puts experts first, keeps order within each group, and does not mutate', () => {
  const tags = [{ name: 'f1', level: 'familiar' }, { name: 'e1', level: 'expert' }, { name: 'f2', level: 'familiar' }, { name: 'e2', level: 'expert' }];
  const copy = structuredClone(tags);
  assert.deepEqual(sortedTags(tags).map((t) => t.name), ['e1', 'e2', 'f1', 'f2']);
  assert.deepEqual(tags, copy);
  assert.deepEqual(sortedTags([]), []);
});

// ---- renderContext ----------------------------------------------------------------------------------------------

test('renderContext exposes the placeholder values plus today, v() and unlocked', () => {
  const c = renderContext(min, { today: TODAY });
  assert.equal(c.today, TODAY);
  assert.equal(c.years, 16); assert.equal(typeof c.years, 'number');
  assert.equal(c.year, 2026);
  assert.equal(c.name, 'Mojtaba Keivanlou');
  assert.equal(c.roleTitle, 'Senior Hydraulic & Water Resources Engineer');
  assert.equal(c.domain, 'mojtabakeivanlou.com');
  assert.equal(c.unlocked, false);
  assert.equal(c.v('assets/js/main.js'), 'assets/js/main.js?v=dev');
  assert.equal(renderContext(min, { today: TODAY, unlocked: true }).unlocked, true);
});

test('renderContext years and year follow the UTC date', () => {
  assert.equal(renderContext(min, { today: new Date('2026-09-22T23:59:59Z') }).years, 16);
  assert.equal(renderContext(min, { today: new Date('2026-09-23T00:00:00Z') }).years, 17);
  assert.equal(renderContext(min, { today: new Date('2026-12-31T23:59:59Z') }).year, 2026);
  assert.equal(renderContext(min, { today: new Date('2027-01-01T00:00:00Z') }).year, 2027);
});

test('renderContext v() ignores inherited object keys and empty version values', () => {
  const c = renderContext(min, { today: TODAY, versions: { a: 'x1', b: null } });
  assert.equal(c.v('a'), 'a?v=x1');
  assert.equal(c.v('b'), 'b?v=dev');
  assert.equal(c.v('constructor'), 'constructor?v=dev');
  assert.equal(c.v('toString'), 'toString?v=dev');
});

test('renderContext needs a valid today', () => {
  assert.throws(() => renderContext(min, {}), /valid Date/);
  assert.throws(() => renderContext(min), /valid Date/);
  assert.throws(() => renderContext(min, { today: new Date('nope') }), /valid Date/);
});

// ---- hash and browser safety ------------------------------------------------------------------------------------

test('shortHash is the first 8 hex digits of SHA-1, for strings and buffers', () => {
  assert.equal(shortHash('abc'), 'a9993e36');
  assert.equal(shortHash(Buffer.from('abc')), 'a9993e36');
  assert.equal(shortHash(''), 'da39a3ee');
  assert.equal(shortHash('é'), shortHash(Buffer.from('é', 'utf8')));
  assert.match(shortHash(Buffer.alloc(1000, 1)), /^[0-9a-f]{8}$/);
});

test('model.mjs is browser-safe: it imports nothing from Node', () => {
  const source = readFileSync(new URL('../assets/js/render/model.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from\s+['"]node:/);
  assert.doesNotMatch(source, /\brequire\s*\(/);
  assert.doesNotMatch(source, /\bprocess\./);
});
