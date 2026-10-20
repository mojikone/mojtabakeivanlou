// The site build (Node only). Reads content/site.json, renders the four pages with the templates in
// assets/js/render/ and writes a complete, deployable copy of the site to one output folder.
//
//   node src/build.mjs            (npm run build; run from the repository root)
//
// Pipeline: read -> normalizeSite -> validateSite -> render. That order is mandatory: the validator does not check
// the fields normalizeSite derives (ids, the e164 phone number), so it must see the normalised copy. Everything is
// validated and rendered in memory before the output folder is touched, so a build that fails leaves the previous
// output as it was.

import { cp, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { icons } from '../assets/js/render/icons.mjs';
import { normalizeSite, renderContext, validateSite } from '../assets/js/render/model.mjs';
import { renderIndex } from '../assets/js/render/index.mjs';
import { renderContact } from '../assets/js/render/contact.mjs';
import { renderThankYou } from '../assets/js/render/thank-you.mjs';
import { renderCv } from '../assets/js/render/cv.mjs';
import { shortHash } from './hash.mjs';
import { isMain } from './is-main.mjs';

const SITE_FILE = 'content/site.json';

const PAGES = [
  ['index.html', renderIndex],
  ['contact.html', renderContact],
  ['thank-you.html', renderThankYou],
  ['cv.html', renderCv],
];

// Files the pages link with a `?v=<hash>` cache-buster (renderContext's `ctx.v`). A file that is not there is
// skipped with a warning, and `ctx.v` then falls back to `?v=dev` for it.
const VERSIONED = [
  'assets/css/main.css',
  'assets/css/cv.css',
  'assets/js/main.js',
  'assets/js/palette.js',
  'assets/js/access.mjs',
];

const REQUIRED_DIR = 'assets';
const OPTIONAL_DIRS = ['vault', 'admin'];            // copied as they are, only when present
const STATIC_FILES = ['CNAME', '.nojekyll', 'robots.txt'];
// Folders the build reads from: the output folder must never be, or lie inside, one of them.
const SOURCE_DIRS = ['content', REQUIRED_DIR, ...OPTIONAL_DIRS];

/** Thrown for a problem with the content or the build setup. `errors` holds one message per problem; `message` joins them with newlines. */
export class BuildError extends Error {
  constructor(errors) {
    super(errors.join('\n'));
    this.name = 'BuildError';
    this.errors = errors;
  }
}

const isInside = (parent, child) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

const isFile = (path) => stat(path).then((s) => s.isFile(), () => false);
const isDirectory = (path) => stat(path).then((s) => s.isDirectory(), () => false);

// The output folder is emptied before every build, so it must not be able to take the sources with it.
function assertSafeOutDir(rootDir, dist) {
  if (isInside(dist, rootDir)) throw new BuildError([`outDir must not be the project root or a folder that contains it (${dist})`]);
  for (const dir of SOURCE_DIRS) {
    if (isInside(join(rootDir, dir), dist)) throw new BuildError([`outDir must not be inside ${dir}/ (${dist})`]);
  }
}

async function readSite(rootDir) {
  let text;
  try {
    text = await readFile(join(rootDir, SITE_FILE), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') throw new BuildError([`${SITE_FILE} not found`]);
    throw err;
  }
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch (err) {
    throw new BuildError([`${SITE_FILE} is not valid JSON: ${err.message}`]);
  }
}

// Short hash of each versioned asset that exists; one warning for each that does not.
async function hashAssets(rootDir) {
  const versions = {};
  const warnings = [];
  for (const path of VERSIONED) {
    try {
      versions[path] = shortHash(await readFile(join(rootDir, path)));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      warnings.push(`asset missing: ${path}`);
    }
  }
  return { versions, warnings };
}

// One warning for every file record whose sealed blob is not in vault/files/ (the site still builds: the file is
// simply not downloadable until the blob is committed).
async function missingBlobWarnings(rootDir, site) {
  const warnings = [];
  for (const [i, company] of site.experience.companies.entries()) {
    for (const [j, project] of company.projects.entries()) {
      for (const [k, bullet] of project.bullets.entries()) {
        for (const file of bullet.files ?? []) {
          if (await isFile(join(rootDir, 'vault', 'files', `${file.id}.bin`))) continue;
          warnings.push(`vault/files/${file.id}.bin missing for experience.companies[${i}].projects[${j}].bullets[${k}]`);
        }
      }
    }
  }
  return warnings;
}

// Every file under `dir`, relative to it, with forward slashes, sorted.
async function listFiles(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
    .sort();
}

/**
 * Builds the site from the project in `root` into `outDir`, which is emptied first.
 * @param {{ root?: string, outDir?: string, today?: Date }} [options]
 *   root: the project folder (content/, assets/, ...); defaults to the working directory.
 *   outDir: the output folder; a relative path is resolved against `root`.
 *   today: the date the pages are rendered for (years of experience, copyright year).
 * @returns {Promise<{ years: number, written: string[], warnings: string[] }>}
 *   years: the years of experience as of `today`.
 *   written: every file now in the output folder, relative to it, with forward slashes, sorted.
 *   warnings: content problems first (`vault/files/<id>.bin missing for <bullet path>`), then
 *     `asset missing: <path>`, then `static file missing: <name>`.
 * @throws {BuildError} when the content is invalid (`errors` lists every problem) or a source is missing.
 */
export async function build({ root = process.cwd(), outDir = 'dist', today = new Date() } = {}) {
  const rootDir = resolve(root);
  const dist = resolve(rootDir, outDir);
  assertSafeOutDir(rootDir, dist);
  if (!(await isDirectory(join(rootDir, REQUIRED_DIR)))) throw new BuildError([`${REQUIRED_DIR}/ not found in ${rootDir}`]);

  const site = normalizeSite(await readSite(rootDir));
  const errors = validateSite(site, { icons: Object.keys(icons), today });
  if (errors.length) throw new BuildError(errors);

  const contentWarnings = await missingBlobWarnings(rootDir, site);
  const { versions, warnings: assetWarnings } = await hashAssets(rootDir);
  const ctx = renderContext(site, { today, versions });
  const pages = PAGES.map(([name, render]) => [name, render(site, ctx)]);

  // Nothing above has touched the disk. From here on the output folder is rebuilt from scratch.
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  for (const [name, html] of pages) await writeFile(join(dist, name), html);

  await cp(join(rootDir, REQUIRED_DIR), join(dist, REQUIRED_DIR), { recursive: true });
  for (const dir of OPTIONAL_DIRS) {
    if (await isDirectory(join(rootDir, dir))) await cp(join(rootDir, dir), join(dist, dir), { recursive: true });
  }
  const staticWarnings = [];
  for (const name of STATIC_FILES) {
    if (await isFile(join(rootDir, name))) await copyFile(join(rootDir, name), join(dist, name));
    else staticWarnings.push(`static file missing: ${name}`);
  }
  await mkdir(join(dist, 'pdf'), { recursive: true });   // the CV PDF is rendered into it by `npm run pdf`

  return {
    years: ctx.years,
    written: await listFiles(dist),
    warnings: [...contentWarnings, ...assetWarnings, ...staticWarnings],
  };
}

// ---- command line -----------------------------------------------------------------------------------------------

if (isMain(import.meta.url)) {
  try {
    const { years, written, warnings } = await build();
    for (const warning of warnings) console.error(`warning: ${warning}`);
    console.log(`built ${written.length} files into dist (${years} years of experience)`);
  } catch (err) {
    if (err instanceof BuildError) for (const line of err.errors) console.error(line);
    else console.error(err);
    process.exitCode = 1;
  }
}
