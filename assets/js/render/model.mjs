// Pure and browser-safe: no Node-only imports. Used by the Node build and by the admin UI.
//
// The content model is the parsed `content/site.json` (spec section 8). This module validates it, normalises it
// and derives the render context from it. Intended order: normalizeSite -> validateSite -> renderContext.

import { yearsOfExperience } from './years.mjs';
import { fill } from './html.mjs';

const ID = /^[a-z0-9-]+$/;
const FILE_ID = /^[0-9a-f]{32}$/;
const E164 = /^\+\d+$/;
const DIGITS = /^\d+$/;
const LEVELS = ['expert', 'familiar'];

// Only used to find unknown placeholders: the values are never rendered.
const DUMMY_CTX = { years: 0, year: 0, name: '', roleTitle: '', domain: '' };

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const join = (path, key) => (path === '' ? key : `${path}.${key}`);

function requireDate(value, fn) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError(`${fn}: options.today must be a valid Date`);
}

// ---- Validation -------------------------------------------------------------------------------------------------

// Every `{{...}}` in every string must be a placeholder the renderer knows. `fill` is the source of truth for that.
function scanPlaceholders(value, path, fail) {
  if (typeof value === 'string') {
    try {
      fill(value, DUMMY_CTX);
    } catch (e) {
      const unknown = /^Unknown placeholder (.+)$/s.exec(e.message);
      fail(path, unknown ? `has unknown placeholder ${unknown[1]}` : `has an invalid placeholder (${e.message})`);
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => scanPlaceholders(item, `${path}[${i}]`, fail));
  } else if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) scanPlaceholders(item, join(path, key), fail);
  }
}

/**
 * Checks `site` against the content model and returns one message per problem, `<json path> <problem>`.
 * An empty array means the site is valid. Bad content is reported, never thrown; only an invalid `today` throws.
 * @param {object} site
 * @param {{ icons?: Iterable<string>, today?: Date }} [options]
 *   icons: names `services.items[].icon` may use; icons are not checked when omitted.
 *   today: used for the "experienceStart is in the future" rule; defaults to the current time.
 * @returns {string[]}
 */
export function validateSite(site, { icons, today = new Date() } = {}) {
  requireDate(today, 'validateSite');
  if (!isObject(site)) return ['(root) must be an object'];

  const errors = [];
  const fail = (path, problem) => { errors.push(`${path} ${problem}`); return false; };
  const knownIcons = icons == null ? null : new Set(icons);

  // Each checker returns true when the value is usable, so callers can go on to check it further.
  const object = (value, path) => {
    if (value === undefined || value === null) return fail(path, 'is missing');
    if (!isObject(value)) return fail(path, 'must be an object');
    return true;
  };
  const array = (value, path) => {
    if (value === undefined || value === null) return fail(path, 'is missing');
    if (!Array.isArray(value)) return fail(path, 'must be an array');
    return true;
  };
  const string = (value, path, { empty = false } = {}) => {
    if (value === undefined || value === null) return fail(path, 'is missing');
    if (typeof value !== 'string') return fail(path, 'must be a string');
    if (!empty && value.trim() === '') return fail(path, 'is empty');
    return true;
  };
  const strings = (parent, path, keys, options) => keys.forEach((key) => string(parent[key], join(path, key), options));
  const each = (value, path, check) => { if (array(value, path)) value.forEach((item, i) => check(item, `${path}[${i}]`)); };
  const entries = (value, path, check) => each(value, path, (item, itemPath) => { if (object(item, itemPath)) check(item, itemPath); });
  const stringList = (value, path) => each(value, path, (item, itemPath) => string(item, itemPath));
  const flag = (value, path) => {
    if (value !== undefined && typeof value !== 'boolean') fail(path, 'must be true or false');
  };
  const heading = (value, path) => {
    if (!array(value, path)) return;
    if (value.length !== 2) fail(path, 'must have exactly two strings');
    value.forEach((item, i) => string(item, `${path}[${i}]`));
  };

  if (site.schemaVersion !== 1) fail('schemaVersion', 'must be 1');

  // site
  if (object(site.site, 'site')) {
    const s = site.site;
    strings(s, 'site', ['domain', 'gaId', 'web3formsKey', 'formSubject']);
    if (string(s.experienceStart, 'site.experienceStart')) {
      let real = true;
      try { yearsOfExperience(s.experienceStart, today); } catch { real = false; }
      if (!real) fail('site.experienceStart', 'must be a real date in YYYY-MM-DD format');
      else if (s.experienceStart > today.toISOString().slice(0, 10)) fail('site.experienceStart', 'is in the future');
    }
    if (string(s.cvPdfFilename, 'site.cvPdfFilename') && !s.cvPdfFilename.endsWith('.pdf')) fail('site.cvPdfFilename', 'must end in .pdf');
  }

  // profile
  if (object(site.profile, 'profile')) {
    const p = site.profile;
    strings(p, 'profile', ['firstName', 'lastName', 'roleTitle', 'roleTitleLong', 'roleSubtitle', 'quote', 'bio', 'cvSummary', 'email', 'linkedin']);
    heading(p.heroHeadline, 'profile.heroHeadline');

    if (object(p.phone, 'profile.phone') && string(p.phone.display, 'profile.phone.display') && !/\d/.test(p.phone.display)) {
      fail('profile.phone.display', 'must contain digits');
    }
    flag(p.phoneOverride, 'profile.phoneOverride');
    if (p.phoneOverride === true) {   // otherwise e164 and whatsapp are derived from the display number, so there is nothing to check
      const given = (value, path, pattern, problem) => {
        if (value === undefined || value === null) fail(path, 'is missing');
        else if (typeof value !== 'string' || !pattern.test(value)) fail(path, problem);
      };
      if (isObject(p.phone)) given(p.phone.e164, 'profile.phone.e164', E164, 'must be + followed by digits');
      given(p.whatsapp, 'profile.whatsapp', DIGITS, 'must be digits only');
    }

    if (object(p.location, 'profile.location')) strings(p.location, 'profile.location', ['city', 'country', 'short', 'countryCode']);
    entries(p.stats, 'profile.stats', (stat, path) => {
      strings(stat, path, ['value', 'label', 'cvLabel']);
      string(stat.suffix, join(path, 'suffix'), { empty: true });
    });
    if (object(p.businessCard, 'profile.businessCard')) {
      stringList(p.businessCard.titleLines, 'profile.businessCard.titleLines');
      entries(p.businessCard.cells, 'profile.businessCard.cells', (cell, path) => strings(cell, path, ['label', 'icon']));
    }
  }

  // education, languages
  entries(site.education, 'education', (edu, path) => {
    strings(edu, path, ['degree', 'school', 'year']);
    if (edu.schoolShort !== undefined) string(edu.schoolShort, join(path, 'schoolShort'), { empty: true });
  });
  entries(site.languages, 'languages', (lang, path) => strings(lang, path, ['name', 'level']));

  // services
  if (object(site.services, 'services')) {
    string(site.services.intro, 'services.intro');
    entries(site.services.items, 'services.items', (item, path) => {
      strings(item, path, ['title', 'description']);
      const iconPath = join(path, 'icon');
      if (string(item.icon, iconPath) && knownIcons && !knownIcons.has(item.icon)) fail(iconPath, `"${item.icon}" is not a known icon`);
      if (item.keywords !== undefined) stringList(item.keywords, join(path, 'keywords'));
    });
  }

  // experience: company and project ids share one namespace because both become `id` attributes
  if (object(site.experience, 'experience')) {
    const idOwners = new Map();
    const id = (value, path) => {
      if (value === undefined || value === null) fail(path, 'is missing');
      else if (typeof value !== 'string' || !ID.test(value)) fail(path, 'must match ^[a-z0-9-]+$');
      else if (idOwners.has(value)) fail(path, `duplicates ${idOwners.get(value)} ("${value}")`);
      else idOwners.set(value, path);
    };

    string(site.experience.intro, 'experience.intro');
    entries(site.experience.companies, 'experience.companies', (company, path) => {
      id(company.id, join(path, 'id'));
      strings(company, path, ['name', 'period', 'role', 'location', 'summary']);
      flag(company.current, join(path, 'current'));
      if (company.expandLabel !== undefined) string(company.expandLabel, join(path, 'expandLabel'), { empty: true });

      entries(company.projects, join(path, 'projects'), (project, projectPath) => {
        id(project.id, join(projectPath, 'id'));
        strings(project, projectPath, ['name', 'period']);
        strings(project, projectPath, ['role', 'scope'], { empty: true });

        entries(project.bullets, join(projectPath, 'bullets'), (bullet, bulletPath) => {
          string(bullet.text, join(bulletPath, 'text'));
          entries(bullet.files, join(bulletPath, 'files'), (file, filePath) => {
            if (typeof file.id !== 'string' || !FILE_ID.test(file.id)) fail(join(filePath, 'id'), 'must be 32 lowercase hex characters');
            string(file.name, join(filePath, 'name'));
            if (!Number.isInteger(file.size) || file.size < 0) fail(join(filePath, 'size'), 'must be a non-negative integer');
            string(file.type, join(filePath, 'type'), { empty: true });
            if (typeof file.enc !== 'boolean') fail(join(filePath, 'enc'), 'must be true or false');
          });
        });
      });
    });
  }

  // skills
  entries(site.skills, 'skills', (skill, path) => {
    string(skill.category, join(path, 'category'));
    entries(skill.tags, join(path, 'tags'), (tag, tagPath) => {
      string(tag.name, join(tagPath, 'name'));
      if (!LEVELS.includes(tag.level)) fail(join(tagPath, 'level'), 'must be expert or familiar');
    });
  });

  // contact, thank-you, call to action, SEO
  if (object(site.contactPage, 'contactPage')) {
    heading(site.contactPage.heading, 'contactPage.heading');
    stringList(site.contactPage.projectTypes, 'contactPage.projectTypes');
    if (Array.isArray(site.contactPage.projectTypes) && site.contactPage.projectTypes.length === 0) {
      fail('contactPage.projectTypes', 'must have at least one entry');
    }
    string(site.contactPage.descriptionPlaceholder, 'contactPage.descriptionPlaceholder');
  }
  if (object(site.thankYou, 'thankYou')) {
    heading(site.thankYou.heading, 'thankYou.heading');
    string(site.thankYou.text, 'thankYou.text');
  }
  if (object(site.cta, 'cta')) {
    heading(site.cta.heading, 'cta.heading');
    string(site.cta.sub, 'cta.sub');
  }
  if (object(site.seo, 'seo')) {
    strings(site.seo, 'seo', ['titleIndex', 'titleCv', 'descriptionIndex', 'ogDescriptionIndex', 'descriptionCv', 'ogDescriptionCv', 'titleContact', 'descriptionContact', 'titleThankYou', 'personDescription']);
    string(site.seo.descriptionThankYou, 'seo.descriptionThankYou', { empty: true });   // the thank-you page may have no description
    stringList(site.seo.knowsAbout, 'seo.knowsAbout');
  }

  scanPlaceholders(site, '', fail);
  return errors;
}

// ---- Normalisation ----------------------------------------------------------------------------------------------

/**
 * Lower-case, runs of anything outside [a-z0-9] become "-", edges trimmed; "-2", "-3"... appended while the result is
 * in `taken`. Text with nothing usable (for instance non-Latin names) yields "item". Does not modify `taken`.
 * @param {string} text
 * @param {Set<string>} [taken]
 */
export function slugify(text, taken = new Set()) {
  const base = String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  return slug;
}

/** "+" followed by the digits of `display` only: "(+968) 9297 0635" -> "+96892970635". */
export function phoneToE164(display) {
  return `+${String(display).replace(/\D/g, '')}`;
}

// Deep copy in one pass: new objects and arrays all the way down, every string trimmed.
function cloneTrimmed(value) {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(cloneTrimmed);
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneTrimmed(item)]));
  return value;
}

const hasText = (value) => typeof value === 'string' && value !== '';

/**
 * Returns a normalised deep copy of `site` and leaves `site` itself untouched: strings are trimmed,
 * `profile.phone.e164` and `profile.whatsapp` are derived from `profile.phone.display` (unless
 * `profile.phoneOverride === true`), empty `expandLabel`s are filled and missing ids are generated.
 * Tolerates partial input, so the dashboard can call it on a half-edited draft.
 */
export function normalizeSite(site) {
  const out = cloneTrimmed(site);

  const profile = out?.profile;
  if (isObject(profile) && profile.phoneOverride !== true && isObject(profile.phone) && typeof profile.phone.display === 'string') {
    profile.phone.e164 = phoneToE164(profile.phone.display);
    profile.whatsapp = profile.phone.e164.slice(1);
  }

  const companies = isObject(out?.experience) ? out.experience.companies : undefined;
  if (Array.isArray(companies)) {
    const companyObjects = companies.filter(isObject);
    const withIds = companyObjects.flatMap((company) => [company, ...(Array.isArray(company.projects) ? company.projects.filter(isObject) : [])]);

    // Existing ids are reserved first so a generated id can never take one that appears later in the document.
    const taken = new Set(withIds.filter((entity) => hasText(entity.id)).map((entity) => entity.id));
    for (const entity of withIds) {
      if (hasText(entity.id)) continue;
      entity.id = slugify(typeof entity.name === 'string' ? entity.name : '', taken);
      taken.add(entity.id);
    }

    for (const company of companyObjects) {
      if (!hasText(company.expandLabel)) company.expandLabel = Array.isArray(company.projects) && company.projects.length === 1 ? 'View project' : 'View all projects';
    }
  }

  return out;
}

// ---- Rendering helpers ------------------------------------------------------------------------------------------

/** Experts first, then everything else; the order inside each group is kept. Returns a new array. */
export function sortedTags(tags) {
  return [...tags.filter((tag) => tag.level === 'expert'), ...tags.filter((tag) => tag.level !== 'expert')];
}

/**
 * The values every page template needs: the placeholder context (`years`, `year`, `name`, `roleTitle`, `domain`)
 * plus `today`, `unlocked` and `v(path)`, which appends the cache-busting `?v=` query (`dev` when there is no hash).
 * @param {object} site
 * @param {{ today: Date, versions?: Record<string, string>, unlocked?: boolean }} options
 */
export function renderContext(site, { today, versions, unlocked = false } = {}) {
  requireDate(today, 'renderContext');
  const hashes = versions ?? {};
  return {
    today,
    years: Number(yearsOfExperience(site.site.experienceStart, today)),
    year: today.getUTCFullYear(),
    name: `${site.profile.firstName} ${site.profile.lastName}`,
    roleTitle: site.profile.roleTitle,
    domain: site.site.domain,
    v: (path) => `${path}?v=${(Object.hasOwn(hashes, path) ? hashes[path] : undefined) ?? 'dev'}`,
    unlocked: Boolean(unlocked),
  };
}
