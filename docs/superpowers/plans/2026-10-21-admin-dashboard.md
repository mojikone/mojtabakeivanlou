# Admin Dashboard and Data-Driven Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the hand-written portfolio site into a build from one `content/site.json`, with a browser dashboard that edits it, encrypted report attachments unlocked by access codes, and a GitHub Actions deploy that regenerates the pages and the CV PDF.

**Architecture:** Three layers that share code: (A) a Node build (`src/`) that renders four pages from `content/site.json` through ES-module templates in `assets/js/render/`, hashes assets, copies static files into `dist/` and prints the CV to PDF with puppeteer; (B) a vault (`assets/js/vault.mjs`) of WebCrypto primitives used by the public unlock flow (`assets/js/access.mjs`), the dashboard and the tests; (C) a static dashboard (`admin/`) that keeps a draft on the device and publishes one commit through the GitHub Git Data API. Phase A alone ships a working data-driven site; Phase B adds gated downloads (verifiable with a CLI); Phase C adds the dashboard.

**Tech Stack:** Node 22 ES modules, `node --test`, WebCrypto (`crypto.subtle`), puppeteer (devDependency, PDF only), GitHub REST API (Git Data, Contents, Actions), GitHub Actions `upload-pages-artifact` / `deploy-pages`. No runtime dependencies, no bundler, no framework.

**Spec:** `docs/superpowers/specs/2026-10-20-admin-dashboard-design.md` (read it first; section numbers below refer to it).

## Global Constraints

- Node `>=22` (`engines` in package.json), `"type": "module"`, every JS file is `.mjs` ES module; code under `assets/js/` must run unchanged in browsers and in Node (no Node-only imports there).
- Dependencies: `devDependencies` = `puppeteer` only. Nothing under `dependencies`.
- `assets/js/palette.js` is copied through byte-identical; never edited (spec §5, §7).
- Repo: owner `mojikone`, repo `mojtabakeivanlou`, branch `redesign3_admin`. Local folder `D:\Personal\Website Mojtaba\redesign3_admin`. Preview port `3004`.
- Crypto (spec §12): PBKDF2-SHA-256, 600000 iterations, 16-byte salt; AES-256-GCM with 12-byte random IV; file blob = `IV || ciphertext`; file id `^[0-9a-f]{32}$`; download code `MK-XXXX-XXXX` from alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`; admin code ≥ 12 chars from ≥ 3 of {lower, upper, digit, other}.
- `sessionStorage` keys: `mk.vault` (base64 raw vault key), `mk.admin` (JSON `{ entryId, vk, github }`: the unlocked admin entry's id plus its payload), `mk.kek` (base64 raw code-derived key, admin sessions only). `localStorage["mk.draft"]`, IndexedDB database `mk-files`, store `pending`.
- File limits (spec §13.9): refuse > 100 MB (`104857600` bytes); note above 50 MB; gauge amber ≥ 700 MB, red ≥ 900 MB. All four live in `admin/modules/limits.mjs`.
- Years of experience from `site.experienceStart = "2009-09-23"`, full UTC years. Parity fixtures assume `today = 2026-06-01` (16 years).
- `cvPdfFilename` initial value `CV_Mojtaba_Keivanlou_2026.pdf`. Cron `30 3 24 9 *`.
- Every rendered page is compared to the original (fixtures from commit `1de3ce8`) with the normaliser of Task 6; `index`, `contact`, `thank-you` must match with zero differences, `cv` with exactly the two exceptions in spec §8/§15.
- Commit after every task. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Never print, log or commit a token, a vault key or a code. Test fixtures use obviously fake values (`ghp_FAKE…`).

## Review Focus

1. **Codes typed with surrounding spaces or in lower case** — a hirer pasting `" mk-7h2k-9qpd "` expects it to work. Pinned in Task 14 (`unlock` trims and retries upper-cased).
2. **Content with HTML characters and underscores** — a bullet like `Flow 3D & "GCM" <2 m/s> report_v2` must render escaped, with no stray italics. Pinned in Task 3.
3. **A referenced file blob missing from `vault/files/`** — the build must still succeed and warn by path; the site must show the icon in an error state rather than download garbage. Pinned in Task 10 (build warning) and Task 15 (download failure state).
4. **The branch moved between loading the draft and publishing** (a code push) — the ref update must fail cleanly and the dashboard must retry from the conflict check, never force-push. Pinned in Task 16.
5. **Date and phone edge cases** — exactly 23 September rolls the years over; phone displays with spaces, dashes or brackets derive the same `e164`. Pinned in Tasks 2 and 4.

---

## File map

| Path | Responsibility |
|---|---|
| `package.json`, `.gitignore`, `.nojekyll`, `robots.txt` | project scaffold, static files copied to `dist/` |
| `content/site.json` | all content (spec §8) |
| `vault/access.json`, `vault/keys.json`, `vault/files/` | code entries, wrapped file keys, ciphertexts (spec §12) |
| `assets/js/render/html.mjs` | `html` tag, escaping, `raw`, placeholders, rich text |
| `assets/js/render/years.mjs` | years of experience |
| `assets/js/render/icons.mjs` | named SVG strings |
| `assets/js/render/model.mjs` | validation, normalisation, slugs, phone derivation, render context |
| `assets/js/render/head.mjs` | shared `<head>`, JSON-LD builders, inline years script |
| `assets/js/render/index.mjs`, `contact.mjs`, `thank-you.mjs`, `cv.mjs` | page templates |
| `assets/js/vault.mjs` | crypto primitives, access-file and keys-file operations |
| `assets/js/access-pill.mjs` | the Access pill component (hero and dashboard gate) |
| `assets/js/access.mjs` | public unlock flow, icons, downloads |
| `assets/css/main.css` (modify), `assets/css/cv.css` (new) | site styles + pill/icons; CV styles moved out of `cv.html` |
| `src/hash.mjs`, `src/build.mjs`, `src/serve.mjs`, `src/pdf.mjs`, `src/dev.mjs` | build pipeline |
| `scripts/extract-content.mjs`, `scripts/vault-cli.mjs` | one-time extraction helper; local vault tool for Phase B testing and recovery |
| `admin/index.html`, `admin/admin.css`, `admin/admin.mjs` | dashboard shell and gate |
| `admin/modules/limits.mjs`, `state.mjs`, `github.mjs`, `files.mjs`, `publish.mjs`, `ui.mjs`, `preview.mjs`, `setup.mjs`, `codes.mjs` | dashboard logic, pure where possible |
| `admin/sections/profile.mjs`, `education.mjs`, `languages.mjs`, `services.mjs`, `experience.mjs`, `skills.mjs`, `contact.mjs`, `access.mjs`, `files.mjs`, `settings.mjs` | one render function per section |
| `.github/workflows/site.yml` | test, build, PDF, deploy |
| `test/**` | `node --test` suites, fixtures, normaliser |

---

# Phase A — Data-driven build

### Task 1: Scaffold, fixtures, static server

**Files:**
- Create: `package.json`, `.gitignore`, `.nojekyll`, `robots.txt`, `src/serve.mjs`, `test/serve.test.mjs`
- Create: `test/fixtures/original/index.html`, `contact.html`, `thank-you.html`, `cv.html` (byte copies from commit `1de3ce8`)

**Interfaces:**
- Produces: `startServer(dir: string, port = 0): Promise<{ port: number, url: string, close(): Promise<void> }>` in `src/serve.mjs` — serves files under `dir`, `index.html` for directories, MIME types for html/css/js/mjs/json/png/jpg/jpeg/webp/svg/pdf/bin/txt/ico, 404 otherwise, no directory listing.

- [ ] **Step 1: Write package.json and .gitignore**

`package.json`: `"name": "mojtabakeivanlou-site"`, `"private": true`, `"type": "module"`, `"engines": { "node": ">=22" }`, scripts `test: node --test test/`, `build: node src/build.mjs`, `pdf: node src/pdf.mjs`, `dev: node src/dev.mjs`, `devDependencies: { "puppeteer": "^24" }`. `.gitignore`: `node_modules/`, `dist/`, `.superpowers/`. `robots.txt` exactly:

```
User-agent: *
Disallow: /admin/
Disallow: /vault/
```

`.nojekyll` empty.

- [ ] **Step 2: Copy fixtures**

Run: `for f in index contact thank-you cv; do git show 1de3ce8:$f.html > test/fixtures/original/$f.html; done`
Expected: four files; `grep -c "Senior Hydraulic" test/fixtures/original/index.html` prints a number ≥ 3.

- [ ] **Step 3: Write the failing server test**

```js
// test/serve.test.mjs
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { startServer } from '../src/serve.mjs';
test('serves index.html for a directory and sets content-type', async () => {
  const s = await startServer('test/fixtures/original');
  const r = await fetch(`${s.url}/`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.match(await r.text(), /Mojtaba Keivanlou/);
  const missing = await fetch(`${s.url}/nope.html`);
  assert.equal(missing.status, 404);
  await s.close();
});
```

- [ ] **Step 4: Run it to see it fail** — `npm test` → FAIL (module not found).

- [ ] **Step 5: Implement `startServer` in `src/serve.mjs`** with `node:http`, `node:fs/promises`, `node:path`; reject paths containing `..`.

- [ ] **Step 6: Run `npm test`** → PASS.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "Scaffold build project: package.json, fixtures from 1de3ce8, static server"`.

### Task 2: Years of experience

**Files:**
- Create: `assets/js/render/years.mjs`, `test/years.test.mjs`

**Interfaces:**
- Produces: `yearsOfExperience(startISO: string, today: Date): number` — full years elapsed using UTC month/day comparison.

- [ ] **Step 1: Write failing tests**

```js
import { yearsOfExperience as y } from '../assets/js/render/years.mjs';
test('counts full years', () => {
  assert.equal(y('2009-09-23', new Date('2026-10-20T00:00:00Z')), 17);
  assert.equal(y('2009-09-23', new Date('2026-06-01T00:00:00Z')), 16);
  assert.equal(y('2009-09-23', new Date('2026-09-22T23:59:59Z')), 16);
  assert.equal(y('2009-09-23', new Date('2026-09-23T00:00:00Z')), 17);   // rollover day
  assert.equal(y('2008-02-29', new Date('2009-02-28T00:00:00Z')), 0);
  assert.equal(y('2008-02-29', new Date('2009-03-01T00:00:00Z')), 1);
});
test('rejects a bad date', () => { assert.throws(() => y('23/09/2009', new Date())); });
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `"Add yearsOfExperience"`.

### Task 3: HTML helpers: escaping, placeholders, rich text

**Files:**
- Create: `assets/js/render/html.mjs`, `test/html.test.mjs`

**Interfaces:**
- Produces:
  - `esc(value: unknown): string` — escapes `& < > " '`.
  - `class Raw { html: string }`, `raw(html: string): Raw`.
  - `html(strings, ...values): string` — tag; `Raw` inserted verbatim, arrays joined with `''` (each item by the same rule), `null | undefined | false` → `''`, anything else escaped.
  - `type Ctx = { years: number, year: number, name: string, roleTitle: string, domain: string }`
  - `fill(text: string, ctx: Ctx): string` — replaces `{{years}} {{year}} {{name}} {{roleTitle}} {{domain}}`; throws `Error('Unknown placeholder {{x}}')` for anything else.
  - `inlineText(text: string, ctx: Ctx): Raw` — fill (with `{{years}}` → `<span data-years>N</span>`), escape, `**x**` → `<strong>x</strong>`, `_x_` → `<em>x</em>` only when the underscores are not adjacent to word characters.
  - `richText(text: string, ctx: Ctx): Raw` — `inlineText` per paragraph (split on blank lines), each wrapped in `<p>…</p>`.

- [ ] **Step 1: Write failing tests**

```js
const ctx = { years: 17, year: 2026, name: 'Mojtaba Keivanlou', roleTitle: 'Senior', domain: 'x.com' };
test('html tag escapes values and passes raw through', () => {
  assert.equal(html`<b>${'<i>&'}</b>${raw('<u>')}${['a', raw('<s>')]}${null}`, '<b>&lt;i&gt;&amp;</b><u>a<s>');
});
test('fill replaces known placeholders and throws on unknown', () => {
  assert.equal(fill('{{years}} yrs, {{name}}', ctx), '17 yrs, Mojtaba Keivanlou');
  assert.throws(() => fill('{{nope}}', ctx), /Unknown placeholder/);
});
test('inlineText: bold, italic, escaping, years span, underscores in words', () => {
  assert.equal(inlineText('**A** _b_ <c> & d_e_f CV_X_2026.pdf {{years}}', ctx).html,
    '<strong>A</strong> <em>b</em> &lt;c&gt; &amp; d_e_f CV_X_2026.pdf <span data-years>17</span>');
});
test('richText splits paragraphs on blank lines', () => {
  assert.equal(richText('one\n\ntwo **2**', ctx).html, '<p>one</p><p>two <strong>2</strong></p>');
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (italic regex: `(^|[^\w])_([^_\n]+?)_(?!\w)`). **Step 4: Run** → PASS. **Step 5: Commit** `"Add html rendering helpers"`.

### Task 4: Content model: validation, normalisation, context

**Files:**
- Create: `assets/js/render/model.mjs`, `src/hash.mjs`, `test/model.test.mjs`, `test/fixtures/site.min.json`

**Interfaces:**
- Produces:
  - `validateSite(site: object): string[]` — empty array when valid; otherwise messages like `experience.companies[2].projects[0].bullets[3].text is empty`. Rules: spec §8 required fields; `services.items[].icon` ∈ icon names (passed in as `validateSite(site, { icons: string[] })`); `files[]` entries have `id` matching `^[0-9a-f]{32}$`, non-empty `name`, integer `size ≥ 0`, string `type`, boolean `enc`; `tags[].level ∈ {expert, familiar}`; `companies[].id`/`projects[].id` match `^[a-z0-9-]+$` and are unique across the site; `heading` arrays have exactly two strings; `site.experienceStart` is `YYYY-MM-DD`; `site.cvPdfFilename` ends in `.pdf`; every `{{…}}` in any string is a known placeholder.
  - `normalizeSite(site): object` — deep clone with strings trimmed, `profile.phone.e164` and `profile.whatsapp` derived from `profile.phone.display` unless `profile.phoneOverride === true`, `expandLabel` filled (`View project` / `View all projects`), ids slugified where missing.
  - `slugify(text: string, taken: Set<string>): string` — lower-case, `[^a-z0-9]+` → `-`, trimmed `-`, suffix `-2`, `-3`… if taken.
  - `phoneToE164(display: string): string` — digits only with leading `+`.
  - `renderContext(site, { today: Date, versions?: Record<string,string>, unlocked?: boolean }): Ctx & { today, v(path): string, unlocked: boolean }` — `v(path)` returns `path?v=<versions[path]>` or `path?v=dev`.
  - `sortedTags(tags): tags` — experts first, stable.
  - `src/hash.mjs`: `shortHash(buf: Buffer | string): string` — first 8 hex of SHA-1.
- `test/fixtures/site.min.json`: the smallest valid site (one of everything) used by unit tests from here on.

- [ ] **Step 1: Write failing tests**

```js
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
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `model.mjs` and `hash.mjs`; write `site.min.json`. **Step 4: Run** → PASS. **Step 5: Commit** `"Add content model validation and normalisation"`.

### Task 5: Icon library

**Files:**
- Create: `assets/js/render/icons.mjs`, `test/icons.test.mjs`

**Interfaces:**
- Produces: `icons: Record<string, string>` (complete `<svg …>…</svg>` strings exactly as in the originals, class attribute removed) and `icon(name: string, attrs?: Record<string,string>): Raw` — throws `Error('Unknown icon x')`; `attrs` are merged into the `<svg>` start tag (used for `class="exp-card-chev"` etc.).
- Required names (source in brackets): `mail`, `phone`, `whatsapp` (hero pills); `download` (Download CV tray-and-arrow); `arrowRight` (CTA "Start a Project" button); `chevron` (`exp-card-chev`, `tl-expand`); `waves`, `road`, `hydrology`, `dam`, `network`, `drop`, `globe`, `survey`, `automation` (the nine service cards, in page order); `linkedin`, `pin` (CTA row, contact sidebar, card contacts); `card-*` for each of the nine business-card cell SVGs if they differ from the service ones (`cardFlood`, …, `cardConsultation`); `send` (contact submit); `check` (thank-you); `key`, `lockOpen`, `paperclip` (new; any 24×24 stroke icons in the same style).

- [ ] **Step 1: Write failing test**

```js
test('every required icon exists and renders with attrs', () => {
  for (const n of ['mail','phone','whatsapp','download','arrowRight','chevron','waves','road','hydrology','dam','network','drop','globe','survey','automation','linkedin','pin','send','check','key','lockOpen','paperclip']) assert.ok(icons[n], n);
  assert.match(icon('chevron', { class: 'exp-card-chev' }).html, /^<svg[^>]*class="exp-card-chev"/);
  assert.throws(() => icon('nope'));
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Extract SVGs** from `test/fixtures/original/*.html` into `icons.mjs` (one constant per name; keep path data byte-exact). **Step 4: Run** → PASS. **Step 5: Commit** `"Add icon library extracted from original pages"`.

### Task 6: Parity normaliser

**Files:**
- Create: `test/helpers/normalize.mjs`, `test/normalize.test.mjs`

**Interfaces:**
- Produces: `normalizeHtml(html: string): string` applying, in order:
  1. remove `<!-- … -->`;
  2. remove whole elements `div.access-pill`, `span.proj-files`, `script#mk-years`, `script[type="module"]` (the access.mjs include), `link[rel="modulepreload"]`;
  3. unwrap `<span data-years>…</span>` to its text;
  4. drop attributes `data-experience-start`, and `?v=…` suffixes inside `href`/`src`;
  5. for `<script type="application/ld+json">` replace the body with `JSON.stringify(sortKeys(JSON.parse(body)))`;
  6. decode entities `&amp; &lt; &gt; &quot; &#39; &nbsp; &middot; &rarr; &larr; &copy; &mdash; &ndash; &hellip; &times;` and numeric `&#NNN;`/`&#xHH;` to characters (`&lt;`/`&gt;` decode to a private marker so they are still distinguishable from tags);
  7. sort attributes alphabetically in every start tag; `attr=""` ≡ `attr`;
  8. collapse runs of `[ \t\r\n]` to one space, remove them between `>` and `<`, trim.
- `diffLines(a: string, b: string): string[]` — first 20 differing lines after splitting on `>`.

- [ ] **Step 1: Write failing tests** covering each rule with one-line inputs (e.g. `normalizeHtml('<a b="1" a="2">x</a>') === '<a a="2" b="1">x</a>'`, `'&nbsp;&middot;'` → `'\u00a0·'`, a `span.proj-files` removed, JSON-LD key sorting, `?v=12` dropped).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** with a regex tokenizer (tags vs text); no DOM library. **Step 4: Run** → PASS. **Step 5: Commit** `"Add HTML parity normaliser"`.

### Task 7: content/site.json and the home page template

**Files:**
- Create: `scripts/extract-content.mjs`, `content/site.json`, `assets/js/render/head.mjs`, `assets/js/render/index.mjs`, `test/parity.test.mjs`, `test/head.test.mjs`

**Interfaces:**
- Produces:
  - `renderHead({ site, ctx, page: 'index'|'contact'|'thank-you'|'cv', title: string, description: string, ogDescription: string, canonicalPath: string, ogType: string, image: string, jsonLd: object, styles: string[], scripts?: string[] }): string` — everything from `<!DOCTYPE html>` through `</head>` plus the `<html lang="en" data-experience-start="…">` start tag; includes GA snippet, fonts, favicon, `palette.js` sync include (`ctx.v`), the inline years script (`id="mk-years"`, exact text below), meta/OG/Twitter/canonical, JSON-LD.
  - `personJsonLd(site, ctx): object` and `indexJsonLd(site, ctx)`, `cvJsonLd(site, ctx)` reproducing the originals' structure (spec §14).
  - `renderIndex(site, ctx): string` — the whole home page; bullets with files render the `.proj-files` span (spec §11.2); the hero contact row renders the Access pill (markup below) after WhatsApp; `access.mjs` is included as `<script type="module" src="${ctx.v('assets/js/access.mjs')}">` before `</body>`.
- Inline years script (exact):
  `<script id="mk-years">(function(){var s=document.documentElement.getAttribute('data-experience-start');if(!s)return;var d=new Date(s),n=new Date(),y=n.getUTCFullYear()-d.getUTCFullYear();if(n.getUTCMonth()<d.getUTCMonth()||(n.getUTCMonth()===d.getUTCMonth()&&n.getUTCDate()<d.getUTCDate()))y--;document.addEventListener('DOMContentLoaded',function(){document.querySelectorAll('[data-years]').forEach(function(e){e.textContent=y;});});})();</script>`
- Access pill markup (exact; the `div` replaces the spec's `<button>` because a form cannot sit inside a button):

```html
<div class="hero-contact-link access-pill" id="accessPill" data-state="idle">
  <button type="button" class="access-pill-main" aria-expanded="false">[icon key]<span class="access-pill-label">Access</span></button>
  <form class="access-pill-form" hidden autocomplete="off">
    <input type="password" name="code" placeholder="Access code" aria-label="Access code" autocomplete="off" autocapitalize="off" spellcheck="false">
    <button type="submit">Enter</button>
  </form>
</div>
```

- Files span (exact, per file): `<a class="proj-dl" href="#" data-file="<id>" data-name="<name>" data-size="<size>" data-enc="true|false" title="<name> · <size as 4.2 MB>" aria-label="Download <name>">[icon download]</a>` inside `<span class="proj-files" hidden>…</span>` appended inside the `<li>`.

- [ ] **Step 1: Write the extraction helper** `scripts/extract-content.mjs` that prints JSON for the repetitive lists from `test/fixtures/original/index.html` and `cv.html` (companies → projects → bullets, skills categories/tags with `hi` → `expert`, services, project types, knowsAbout, service keywords from the JSON-LD `hasOfferCatalog`). Regex per block is fine; it runs once.
- [ ] **Step 2: Author `content/site.json`** per spec §8 from the script's output plus the hand-copied texts (hero, about, quote, bio with `{{years}}`, CV summary, stats with `{{years}}`, business card, CTA, thank-you, SEO fields with `{{years}}`, `schoolShort`, `keywords`). Every bullet gets `"files": []`. Run `node -e "import('./assets/js/render/model.mjs').then(m=>console.log(m.validateSite(JSON.parse(require('fs').readFileSync('content/site.json','utf8')), {icons: Object.keys(require('./assets/js/render/icons.mjs').icons)})))"` → `[]`.
- [ ] **Step 3: Write the failing parity test**

```js
// test/parity.test.mjs
const site = normalizeSite(JSON.parse(await readFile('content/site.json', 'utf8')));
const ctx = renderContext(site, { today: new Date('2026-06-01T00:00:00Z') });
const original = p => readFile(`test/fixtures/original/${p}.html`, 'utf8');
test('index.html matches the original', async () => {
  const a = normalizeHtml(renderIndex(site, ctx)), b = normalizeHtml(await original('index'));
  assert.equal(a, b, diffLines(a, b).join('\n'));
});
```

plus `test/head.test.mjs`: `renderHead` output contains `data-experience-start="2009-09-23"`, the `mk-years` script, `palette.js?v=`, and `JSON.parse` of the JSON-LD block succeeds.

- [ ] **Step 4: Run** → FAIL. **Step 5: Implement `head.mjs` and `index.mjs`**, iterating on the diff output until the parity test passes. Keep today's `onclick` handlers, `reveal d1/d2` cadence (cards cycle `''`, `d1`, `d2`), `&nbsp;&middot;&nbsp;` separators (the model stores ` · `; the template joins with the entity sequence), and the `about-numbers` `<em>+</em>` suffix markup.
- [ ] **Step 6: Run `npm test`** → PASS. **Step 7: Commit** `"Add site.json and the home page template with parity test"`.

### Task 8: Contact and thank-you templates

**Files:**
- Create: `assets/js/render/contact.mjs`, `assets/js/render/thank-you.mjs`
- Modify: `test/parity.test.mjs`

**Interfaces:**
- Produces: `renderContact(site, ctx): string`, `renderThankYou(site, ctx): string`. The contact page's inline WhatsApp script is carried over verbatim from the original into the template as a `raw()` block; hidden inputs use `site.site.web3formsKey`, `site.site.formSubject`, redirect `https://${domain}/thank-you.html`; `<option>` list from `contactPage.projectTypes`.

- [ ] **Step 1: Add two parity tests** (`contact`, `thank-you`) in the same shape as Task 7.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement both templates.** **Step 4: Run** → PASS. **Step 5: Commit** `"Add contact and thank-you templates"`.

### Task 9: CV template and cv.css

**Files:**
- Create: `assets/css/cv.css`, `assets/js/render/cv.mjs`
- Modify: `test/parity.test.mjs`, `test/helpers/normalize.mjs` (nothing new; exceptions live in the test)

**Interfaces:**
- Produces: `renderCv(site, ctx): string`. The `<style>` in the original is split: the `@page { … }` block stays inline in the template with the footer `content` string built from `profile` (`"{name}  ·  {domain}  ·  {email}  ·  {phone.display}  —  Page " counter(page) " of " counter(pages)`); every other rule moves verbatim to `assets/css/cv.css`, linked via `ctx.v('assets/css/cv.css')`.
- Parity exceptions, encoded in the test: before comparing, (1) the original's stats block is reordered to Years / Countries / Projects, (2) the original's Surveying description gains `geospatial ` before `data collection`, (3) the original's inline `<style>` minus the `@page` block is compared separately against `cv.css` after whitespace collapsing, and the built page's `<link>` to `cv.css` is dropped. Nothing else is tolerated.

- [ ] **Step 1: Add the CV parity test** with those three explicit transformations as named helper functions in the test file.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `cv.css` and `cv.mjs`** (job timeline markup, `job--current` for `current: true`, `proj-meta` joined with ` · ` and `<b>role</b>`, education, skills with `tag hi`, languages). **Step 4: Run** → PASS. **Step 5: Commit** `"Add CV template; move CV styles to cv.css"`.

### Task 10: The build

**Files:**
- Create: `src/build.mjs`, `src/dev.mjs`, `test/build.test.mjs`
- Modify: `../.claude/launch.json` (parent folder; add `website-admin`: `npm run dev` in `redesign3_admin`, port 3004)
- Delete: `index.html`, `contact.html`, `thank-you.html`, `cv.html`, `netlify.toml`, `pdf/CV_Mojtaba_Keivanlou_2026.pdf`

**Interfaces:**
- Produces: `build({ root = process.cwd(), outDir = 'dist', today = new Date() }): Promise<{ years: number, written: string[], warnings: string[] }>` in `src/build.mjs`; runs as CLI when executed directly (`process.argv[1]` check), exit code 1 on validation errors (printed one per line). `src/dev.mjs`: build, `startServer(dist, 3004)`, watch `content/`, `assets/`, `admin/`, `src/`, rebuild debounced 200 ms, log one line per rebuild.
- Build steps: read + `normalizeSite` + `validateSite` (icons from `icons.mjs`); `versions` = `shortHash` of `assets/css/main.css`, `assets/css/cv.css`, `assets/js/main.js`, `assets/js/palette.js`, `assets/js/access.mjs`; render four pages; `fs.cp` `assets/`, `vault/`, `admin/` recursively; copy `CNAME`, `.nojekyll`, `robots.txt`; create `dist/pdf/`; warning (not error) `vault/files/<id>.bin missing for <bullet path>` for any referenced file whose blob is absent.

- [ ] **Step 1: Write failing tests**

```js
test('build writes pages, copies statics, hashes assets, warns on missing blob', async () => {
  const out = await mkdtemp(join(tmpdir(), 'dist-'));
  const r = await build({ outDir: out, today: new Date('2026-06-01T00:00:00Z') });
  for (const f of ['index.html','contact.html','thank-you.html','cv.html','CNAME','.nojekyll','robots.txt','assets/js/palette.js','admin/index.html']) assert.ok(existsSync(join(out, f)), f);
  const idx = await readFile(join(out, 'index.html'), 'utf8');
  assert.match(idx, /main\.css\?v=[0-9a-f]{8}/); assert.match(idx, /<span data-years>16<\/span>/);
  assert.equal(await readFile(join(out,'assets/js/palette.js')), await readFile('assets/js/palette.js'));
  assert.equal(r.years, 16);
});
test('build warns when a referenced blob is missing', async () => { /* temp copy of site.json with a bullet file id 'a'.repeat(32); expect r.warnings[0] to match /vault\/files\/a{32}\.bin missing/ */ });
test('build fails on invalid content', async () => { /* site with empty profile.email → rejects with message containing 'profile.email' */ });
```

(`admin/index.html` may be a placeholder file created in this task so the copy step is testable; Task 16 replaces it.)

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `build.mjs`, `dev.mjs`; delete the generated originals; add the launch.json entry.** **Step 4: Run `npm test` and `npm run build`** → PASS; `dist/index.html` exists. Open `preview_start` `website-admin` and check the home page renders like the live site. **Step 5: Commit** `"Add build pipeline; remove hand-written pages"`.

### Task 11: PDF rendering

**Files:**
- Create: `src/pdf.mjs`, `test/pdf.test.mjs`

**Interfaces:**
- Produces: `renderPdf({ distDir = 'dist', filename }): Promise<string>` (absolute path written) — `startServer(distDir)`, puppeteer `launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] })`, `goto(url + '/cv.html', { waitUntil: 'networkidle0' })`, `page.evaluate(() => document.fonts.ready)`, `page.pdf({ path, preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false })`. CLI reads `filename` from `content/site.json` (`site.cvPdfFilename`).

- [ ] **Step 1: Write the smoke test** (skipped when `process.env.CI !== 'true'` and `process.env.PDF_TEST !== '1'`): after `build` to a temp dir and `renderPdf`, assert file size > 50000 and the count of `/Type /Page` (not `/Pages`) occurrences ≥ 2.
- [ ] **Step 2: `npm i -D puppeteer`**; run with `PDF_TEST=1 npm test` → FAIL (module missing). **Step 3: Implement.** **Step 4: Run** → PASS; open `dist/pdf/CV_Mojtaba_Keivanlou_2026.pdf` and confirm page numbers in the footer and A4 pages. **Step 5: Commit** `"Add PDF rendering with puppeteer"` (lockfile included).

### Task 12: Workflow and CLAUDE.md

**Files:**
- Create: `.github/workflows/site.yml`
- Modify: `CLAUDE.md` (rewrite)

- [ ] **Step 1: Write the workflow** exactly:

```yaml
name: site
on:
  push: { branches: [redesign3_admin, redesign3_admin_test] }
  schedule: [{ cron: "30 3 24 9 *" }]
  workflow_dispatch:
permissions: { contents: read, pages: write, id-token: write }
concurrency: { group: pages, cancel-in-progress: true }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - uses: actions/cache@v4
        with: { path: ~/.cache/puppeteer, key: puppeteer-${{ runner.os }}-${{ hashFiles('package-lock.json') }} }
      - run: npm ci
      - run: npm test
        env: { CI: "true" }
      - run: npm run build
      - run: npm run pdf
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
  deploy:
    needs: build
    if: github.ref == 'refs/heads/redesign3_admin' && vars.DEPLOY_FROM_ACTIONS == 'true'
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: ${{ steps.deployment.outputs.page_url }} }
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Rewrite `CLAUDE.md`** for the new branch: content lives in `content/site.json`; never edit `dist/`; `npm run dev` on 3004; `npm test` must pass; parity test and how to update fixtures deliberately; `palette.js` untouched; vault files are ciphertext; cutover steps reference spec §16; keep the existing Design System, hero-layout and CSS-pitfall sections verbatim.
- [ ] **Step 3: Push the branch** (`git push -u origin redesign3_admin`) and confirm on GitHub that the `site` workflow's build job passes and the deploy job is skipped. Fix CI-only issues (Chromium deps) if any.
- [ ] **Step 4: Commit** `"Add GitHub Actions workflow; rewrite CLAUDE.md for the data-driven build"`.

---

# Phase B — Vault and public unlock

### Task 13: Crypto primitives

**Files:**
- Create: `assets/js/vault.mjs` (part 1), `test/vault.test.mjs`

**Interfaces:**
- Produces (all in `vault.mjs`, browser + Node):
  - `toB64(bytes: Uint8Array): string`, `fromB64(s: string): Uint8Array`
  - `randomBytes(n): Uint8Array`, `randomId(): string` (32 hex), `generateDownloadCode(): string`
  - `codeStrength(code: string): { ok: boolean, length: number, classes: number }` (admin rule)
  - `deriveKek(code: string, saltB64: string, iterations: number): Promise<CryptoKey>` (AES-GCM, extractable)
  - `generateKey(): Promise<CryptoKey>`, `exportKey(key): Promise<string>` (b64 raw), `importKey(b64: string): Promise<CryptoKey>`
  - `seal(key, bytes: Uint8Array): Promise<{ iv: string, data: string }>`, `open(key, { iv, data }): Promise<Uint8Array>` (rejects on tamper/wrong key)
  - `encryptFile(fk, plain: Uint8Array): Promise<Uint8Array>` (`IV || ct`), `decryptFile(fk, blob: Uint8Array): Promise<Uint8Array>`
  - `formatSize(bytes: number): string` → `4.2 MB`, `812 kB`, `1.1 GB`

- [ ] **Step 1: Write failing tests**: b64 roundtrip; `randomId()` matches `^[0-9a-f]{32}$`; `generateDownloadCode()` matches `^MK-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$` over 50 draws; `codeStrength('127377k1K1@@').ok === true`, `codeStrength('password1').ok === false`; `seal`/`open` roundtrip and `open` with another key rejects; `encryptFile` output length = plain + 12 + 16 and `decryptFile` roundtrips 1 MB of random bytes; `deriveKek` with 1000 iterations is deterministic for the same code+salt (compare `exportKey`); `formatSize(4403211) === '4.2 MB'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `"Add vault crypto primitives"`.

### Task 14: Access file and keys file operations

**Files:**
- Modify: `assets/js/vault.mjs` (part 2), `test/vault.test.mjs`
- Create: `vault/access.json`, `vault/keys.json` (initial, empty), `scripts/vault-cli.mjs`

**Interfaces:**
- Types: `AccessFile = { v: 1, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: string }, entries: AccessEntry[] }`; `AccessEntry = { id: string(8 hex), kind: 'admin' | 'download', iv, data, meta: { iv, data } }`; `KeysFile = { v: 1, vk: string(8 hex), files: Record<fileId, { iv, key }> }`; admin payload `{ vk: string, github: { token, owner, repo, branch } }`; download payload `{ vk }`; meta plaintext `{ label, created, code? }` (admin meta has no `code`).
- Produces:
  - `createAccessFile(iterations = 600000): AccessFile` (fresh salt, no entries); `createKeysFile(vkId): KeysFile`
  - `unlock(access: AccessFile, code: string): Promise<{ entry: AccessEntry, kind, payload, kek: CryptoKey } | null>` — trims the code; tries as typed, then upper-cased; derives once; tries `admin` entries first.
  - `addEntry(access, { kind, code, payload, meta }, vk: CryptoKey): Promise<AccessFile>`
  - `readMeta(entry, vk): Promise<object>`
  - `wrapFileKey(vk, fk): Promise<{ iv, key }>`, `unwrapFileKey(vk, wrapped): Promise<CryptoKey>`
  - `rotateVault({ access, keys, vk, kek, adminEntryId, codesById: Record<entryId, string>, dropIds: string[] }): Promise<{ access, keys, vk: CryptoKey }>` — new VK + new `keys.vk` id; every file key rewrapped; every kept entry's payload and meta re-sealed under its own KEK (`kek` for the admin entry, derived from `codesById[id]` for download entries); entries in `dropIds` removed.
- `scripts/vault-cli.mjs` (Node only, for local testing and recovery): `init --admin-code … --token … [--branch …]`, `add-code --admin-code … --label … [--code …]` (prints the code), `encrypt --admin-code … <file>` (writes `vault/files/<id>.bin`, updates `keys.json`, prints the JSON file record to paste into `site.json`), `revoke --admin-code … <entryId>`. Codes are passed as arguments only; never written to disk.

- [ ] **Step 1: Write failing tests** (use `iterations: 1000` in tests for speed, via `createAccessFile(1000)`):
  - full flow: create → `addEntry` admin → `addEntry` download (generated code) → `unlock(access, '  ' + code.toLowerCase() + ' ')` returns kind `download` with `payload.vk` equal to the admin's; `unlock(access, 'wrong')` → `null`; `readMeta(downloadEntry, vk).code === code`;
  - `wrapFileKey`/`unwrapFileKey` roundtrip; `rotateVault` keeps unlocking with the remaining code, the dropped code returns `null`, every `keys.files[id]` still unwraps to a key that decrypts a file encrypted before rotation, and `keys.vk` changed.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**; write initial `vault/access.json` = `createAccessFile()` output and `vault/keys.json` = `{ "v": 1, "vk": "", "files": {} }`; write the CLI. **Step 4: Run** → PASS; `node scripts/vault-cli.mjs --help` prints usage. **Step 5: Commit** `"Add access-file and keys-file operations; vault CLI"`.

### Task 15: Public unlock flow, pill and download icons

**Files:**
- Create: `assets/js/access-pill.mjs`, `assets/js/access.mjs`, `test/access-pill.test.mjs`
- Modify: `assets/css/main.css` (append), `assets/js/render/index.mjs` (already renders markup; verify), `test/parity.test.mjs` (unchanged, must still pass)

**Interfaces:**
- `access-pill.mjs`: `mountAccessPill(root: HTMLElement, { onSubmit(code: string): Promise<'admin'|'download'|'none'>, onLock(): void, onDashboard(): void }): { setState(state: 'idle'|'open'|'checking'|'unlocked'|'admin'), shake() }` — pure DOM, no crypto; `root` is the `div.access-pill` from Task 7's markup. Keyboard: Enter submits, Escape and outside click collapse. Labels: `Access`, `Unlocked`, `Dashboard`.
- `access.mjs` (module script on index): on load, reads `sessionStorage`; mounts the pill; `onSubmit` fetches `vault/access.json` (`cache: 'no-store'`), calls `unlock`; admin → store `mk.admin`, `mk.vault`, `mk.kek`, `location.href = 'admin/'`; download → store `mk.vault`, un-hide `.proj-files`, state `unlocked`; none → `shake()`. Click on `.proj-dl`: fetch `vault/keys.json` (no-store) and `vault/files/<id>.bin`; `enc === 'true'` → unwrap + decrypt, else raw; `Blob` + temporary `<a download>`; while fetching the icon gets class `is-busy`, on any failure class `is-error` with `title="Download failed"` for 4 s. `formatSize` for titles comes from the template, not here.
- CSS: `.access-pill[data-state=…]` rules; open state `padding: 2px 2px 2px 10px`, input `width: 118px; background: transparent; border: 0; font-size: 11px`, Enter button as a nested grey pill; `@keyframes mk-shake` 300 ms; `.proj-bullets li { display: flex; align-items: center; gap: 10px }` keeping the existing `padding-left`/`::before`; `.proj-files { margin-left: auto; display: inline-flex; gap: 6px }`; `.proj-dl svg { width: 13px; height: 13px; color: var(--text-2); opacity: .55 }`, hover `opacity: 1; color: var(--dk)`; `.is-busy` spins, `.is-error` turns `var(--lime-dk)`; mobile (`max-width: 768px`) lets `.proj-files` wrap to a new line (`flex-basis: 100%` on the `li` via `flex-wrap: wrap`).

- [ ] **Step 1: Write the failing DOM-free test** for the pure parts of `access-pill.mjs`: export `nextState(state, event)` reducer (`events: open, submit, ok-download, ok-admin, fail, lock, escape`) and assert the table: `idle+open→open`, `open+submit→checking`, `checking+ok-download→unlocked`, `checking+ok-admin→admin`, `checking+fail→idle`, `unlocked+lock→idle`, `admin+open→admin`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `access-pill.mjs`, `access.mjs`, the CSS.** **Step 4: Run `npm test`** → PASS including parity (pill and spans are excluded by the normaliser).
- [ ] **Step 5: Manual verification with the CLI**: `node scripts/vault-cli.mjs init --admin-code <throwaway> --token ghp_FAKE`, `add-code … --label test`, `encrypt … <any pdf>`; paste the printed file record into one bullet in `content/site.json`; `npm run dev`; in the preview (`website-admin`, port 3004): wrong code shakes with no text; the download code shows the icon on that bullet only; clicking downloads a byte-identical file (`fc` / `cmp` against the original); phone width 375 shows the pill row and the wrapped icon; `git checkout vault/ content/site.json` afterwards and delete the test blob so nothing fake is committed.
- [ ] **Step 6: Commit** `"Add Access pill, unlock flow and gated download icons"`.

---

# Phase C — Dashboard

### Task 16: Dashboard shell, gate and GitHub client

**Files:**
- Create: `admin/index.html` (replaces placeholder), `admin/admin.css`, `admin/admin.mjs`, `admin/modules/limits.mjs`, `admin/modules/github.mjs`, `test/github.test.mjs`

**Interfaces:**
- `limits.mjs`: `export const FILE_MAX = 104857600, FILE_NOTE = 52428800, TOTAL_AMBER = 734003200, TOTAL_RED = 943718400`.
- `github.mjs`: `createGitHub({ token, owner, repo, branch, fetch = globalThis.fetch }): GitHub` with methods
  - `validate(): Promise<{ ok: boolean, status: number }>` (`GET /repos/{o}/{r}`)
  - `getHead(): Promise<{ sha: string, tree: string }>`
  - `getFile(path): Promise<{ sha: string, bytes: Uint8Array } | null>` (Contents API, base64 decoded; `null` on 404)
  - `listTree(): Promise<string[]>` (recursive tree paths)
  - `commitFiles({ message, files: { path: string, bytes: Uint8Array }[], deletes: string[], parent: string }): Promise<{ sha: string }>` — blobs → tree (`base_tree` = parent's tree, deletes as `sha: null`) → commit → `PATCH refs/heads/{branch}` with `{ sha, force: false }`; a 422 or 409 on the PATCH throws `class ConflictError extends Error`.
  - `latestRun(headSha): Promise<{ status, conclusion, html_url } | null>` and `latestSuccessfulRun(): Promise<{ updated_at } | null>`
  - All requests: `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`; non-2xx (other than handled 404/409/422) throws `GitHubError(status, message)`; 401/403 throws `AuthError`.
- `admin/index.html`: `<meta name="robots" content="noindex">`, loads `admin.css`, `../assets/css/main.css` (for tokens and Poppins), and `admin.mjs` as module. `admin.mjs`: gate (uses `mountAccessPill` on a centred pill; `onSubmit` identical to the public one but ignores download codes), then renders the shell: top bar (name, "Admin", status area, Preview, Publish, Sign out), left nav with the ten sections in spec §13.3 order plus separator, main area; section modules are registered in `admin/sections/index.mjs` as `{ id, label, render(container, store) }`; "Sign out" clears the three session keys and reloads. `#setup` hash routes to Task 24's wizard.

- [ ] **Step 1: Write failing tests for `github.mjs`** with a recording fake `fetch` (returns canned JSON per URL and method): `getHead` parses `object.sha` then commit `tree.sha`; `getFile` decodes base64 and returns `null` on 404; `commitFiles` posts N blobs, one tree whose entries include `{ path, mode: '100644', type: 'blob', sha }` for files and `{ path, mode: '100644', type: 'blob', sha: null }` for deletes, one commit with `parents: [parent]`, then PATCHes the ref with `force: false`; a 422 on the PATCH rejects with `ConflictError`; a 401 anywhere rejects with `AuthError`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `github.mjs`, `limits.mjs`, the shell, the gate, the CSS skeleton** (dark green top bar `var(--dk)`, sidebar `var(--bg2)`, cards white, accents `var(--lime)`). **Step 4: Run** → PASS; `npm run dev`, open `/admin/`: gate shows; an admin session from the hero pill (set via the CLI vault) opens the shell with empty sections. **Step 5: Commit** `"Add dashboard shell, gate and GitHub client"`.

### Task 17: Draft store

**Files:**
- Create: `admin/modules/state.mjs`, `test/state.test.mjs`

**Interfaces:**
- `Draft = { v: 1, baseCommit: string, baseShas: { site, access, keys }, site: object, access: AccessFile, keys: KeysFile, pending: { id, name, size, type }[], deleted: string[], revoked: string[], rotate: boolean, loadedAt: string }`
- `createStore({ storage = localStorage }): Store` with
  - `init(base: { commit, shas, site, access, keys }): Draft` — loads `mk.draft` if present and `v === 1`, else creates from `base`; a stored draft with another `v` is discarded.
  - `get(): Draft`, `subscribe(fn): unsubscribe`
  - `set(path: (string|number)[], value): void` — immutable update, persists
  - `insert(path, index, item)`, `remove(path, index)`, `move(path, from, to)`
  - `addPendingFile(bulletPath, record)`, `removeFile(bulletPath, fileId)` (moves committed ids to `deleted`, drops pending ones)
  - `dirty(): { total: number, bySection: Record<sectionId, number> }` — counts top-level keys changed vs `base` (section map: `profile → profile`, `education`, `languages`, `services`, `experience`, `skills`, `contactPage|thankYou|cta → contact`, `access|revoked|rotate → access`, `pending|deleted → files`, `site|seo → settings`)
  - `reset()` — drops the draft and re-inits from the last `base`.

- [ ] **Step 1: Write failing tests** with an in-memory `storage` object (`getItem/setItem/removeItem`): `set` persists and `get` reflects it; `move` reorders; `removeFile` on a committed id adds to `deleted`; `dirty().bySection.experience === 1` after one bullet edit and `total` counts sections; a stored draft with `v: 0` is ignored; `reset()` restores base.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `"Add dashboard draft store"`.

### Task 18: UI primitives and the simple sections

**Files:**
- Create: `admin/modules/ui.mjs`, `admin/sections/index.mjs`, `profile.mjs`, `education.mjs`, `languages.mjs`, `services.mjs`, `contact.mjs`, `settings.mjs`

**Interfaces:**
- `ui.mjs`:
  - `field({ label, value, onInput, type = 'text' | 'textarea' | 'rich' | 'date' | 'number', placeholder, hint }): HTMLElement` — `rich` renders a textarea with **B**/_I_ buttons and a live preview using `inlineText`/`richText`.
  - `pair({ label, values: [a, b], onInput })` for two-line headings.
  - `listEditor({ items, renderItem(item, index, api): HTMLElement, onInsert, onRemove, onMove, addLabel, empty }): HTMLElement` — drag handle `⋮⋮` (HTML5 drag and drop) plus ▲▼ buttons, delete with a 6-second undo toast, "+ Add".
  - `iconPicker({ value, onChange })` — grid of every icon in `icons.mjs`.
  - `toast(message, { actionLabel, onAction, ms })`, `modal({ title, body, actions })`.
- Sections (each `render(container, store)` re-renders on `store.subscribe`): Profile & contact, Education, Languages, Engineering services, Contact page, Settings, with exactly the fields listed in spec §13.3; Settings also hosts "Replace GitHub token" (Task 23) and "Reset draft".

- [ ] **Step 1: Implement `ui.mjs` and the six sections.** (DOM code; no unit tests. Use the mockup `docs/superpowers/mockups/02-…html` for the look.)
- [ ] **Step 2: Manual check** in the preview: every field in spec §13.3 for these sections is present and editing updates the nav badge count; list reorder works by drag and by buttons; undo restores a deleted row.
- [ ] **Step 3: Run `npm test`** → PASS (nothing broke). **Step 4: Commit** `"Add dashboard UI primitives and simple sections"`.

### Task 19: Pending-file storage and the Experience section

**Files:**
- Create: `admin/modules/files.mjs`, `admin/sections/experience.mjs`, `test/files.test.mjs`

**Interfaces:**
- `files.mjs`: `createFileStore({ idb = indexedDB }): { put(id, bytes: Uint8Array), get(id): Promise<Uint8Array|null>, delete(id), list(): Promise<string[]> }` over database `mk-files`, store `pending`; plus `createMemoryFileStore()` with the same interface (used by tests and as a fallback when IndexedDB is unavailable).
- `prepareUpload(file: File, vk: CryptoKey, { limits, fileStore, keysDraft }): Promise<{ record: { id, name, size, type, enc: true }, wrapped: { iv, key } }>` in `files.mjs` — rejects with `Error('too-large')` above `FILE_MAX`; generates `fk`, `encryptFile`, stores ciphertext under a new `randomId()`, returns the site record and the wrapped key for `keys.files[id]`. Streams via `file.arrayBuffer()` once; no extra copies.
- `experience.mjs`: intro field; companies list (fields spec §8) → projects list → bullets list; each bullet row has the text field, a paperclip button with count, and beneath it the files list (name, `formatSize`, `encrypted` badge, replace, remove) + "Add another file" + a drop zone accepting multiple files; above `FILE_NOTE` shows the note from spec §13.9.

- [ ] **Step 1: Write failing tests** with `createMemoryFileStore()`: `prepareUpload` of a 1 MB fake `File` (`new File([bytes], 'r.pdf', { type: 'application/pdf' })`) returns `record.id` matching the id regex, `record.size === bytes.length`, `record.enc === true`, and `unwrapFileKey(vk, wrapped)` decrypts the stored ciphertext back to `bytes`; a `File` of `FILE_MAX + 1` bytes (use a lazy `File`-like with `size` and `arrayBuffer`) rejects with `too-large`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `files.mjs` and `experience.mjs`.** **Step 4: Run** → PASS; manual: attach two files to one bullet, reorder them, remove one; the Files badge counts them. **Step 5: Commit** `"Add experience section with encrypted attachments"`.

### Task 20: Skills section

**Files:**
- Create: `admin/sections/skills.mjs`

- [ ] **Step 1: Implement**: categories list → tags list with an Expert/Familiar segmented toggle per tag; the list shows experts first (`sortedTags`) while preserving stored order within groups; toggling a tag moves it between groups.
- [ ] **Step 2: Manual check** in the preview and `npm test` → PASS. **Step 3: Commit** `"Add skills section"`.

### Task 21: Preview

**Files:**
- Create: `admin/modules/preview.mjs`

**Interfaces:**
- `openPreview(store, page = 'index')`: modal with tabs Home / Contact / Thank you / CV; iframe `srcdoc` = `render<Page>(normalizeSite(draft.site), renderContext(draft.site, { today: new Date(), unlocked: true }))` with `<base href="${location.origin}/">` injected after `<head>`; `unlocked: true` makes the index template omit `hidden` on `.proj-files`.
- Modify `renderIndex` (Task 7) to honour `ctx.unlocked` (parity test unaffected: default `false`).

- [ ] **Step 1: Add a template test**: `renderIndex(site, { ...ctx, unlocked: true })` contains `<span class="proj-files">` without `hidden` for a bullet with a file.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; manual: Preview shows the draft's edits and icons. **Step 5: Commit** `"Add dashboard preview"`.

### Task 22: Publish

**Files:**
- Create: `admin/modules/publish.mjs`, `test/publish.test.mjs`
- Modify: `admin/admin.mjs` (status area, Publish button wiring)

**Interfaces:**
- `buildCommit(draft: Draft, blobs: Record<fileId, Uint8Array>): { message: string, files: { path, bytes }[], deletes: string[] }` — pure: always `content/site.json` (2-space JSON, trailing newline); `vault/access.json` and `vault/keys.json` when changed or when `rotate`; `vault/files/<id>.bin` for each pending id; deletes for `deleted` ids and for revoked entries' nothing (entries live in access.json). Message: `Content update from dashboard: <comma-separated dirty section labels>`.
- `publish({ store, gh, fileStore, vk, kek, adminEntryId, onProgress(step: 'validating'|'checking'|'committing'|'building'|'live'|'failed'|'conflict', info) }): Promise<void>` — steps per spec §13.6: validate (`validateSite`) → conflict check (`getFile` SHAs vs `baseShas`; on mismatch `onProgress('conflict', { paths })` and return) → if `draft.rotate`: `rotateVault` (codes read via `readMeta` for every download entry, `dropIds = draft.revoked`) and replace `access`/`keys` in the draft → `buildCommit` → `gh.commitFiles` with `parent = getHead().sha` → poll `latestRun(sha)` every 10 s (cancelled → follow `latestRun` of the newest head) → `live` or `failed` → `fileStore.delete` each pending id, store `reset()` with the new base.
- Top bar status: `Live · published <relative time>` from `latestSuccessfulRun()`, `· N unpublished changes` from `dirty().total`.

- [ ] **Step 1: Write failing tests** for `buildCommit`: minimal draft with one pending file and one deleted id → `files` paths are `content/site.json`, `vault/files/<id>.bin` (bytes identical), `vault/keys.json` (because pending implies keys changed); `deletes` = `['vault/files/<deleted>.bin']`; message lists `Experience`. And for `publish` with the fake GitHub from Task 16 and a fake `onProgress`: the sequence of steps is `validating, checking, committing, building, live`; when `getFile('content/site.json').sha !== baseShas.site` the sequence stops at `conflict` and `commitFiles` is never called; a `ConflictError` from `commitFiles` reports `conflict` too.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**, including the progress toast (Saved ✓ / Building / Live with link / Failed with run link) and the conflict modal (Reload and reapply = `reset()` then reopen; Overwrite = re-run with `baseShas` refreshed). **Step 4: Run** → PASS. **Step 5: End-to-end** against the scratch branch `redesign3_admin_test` (set in the admin payload via the CLI `init --branch redesign3_admin_test`): edit a bullet, attach a file, Publish; watch the toast reach "Live" (build job only; deploy skipped) and confirm the commit on GitHub holds `site.json`, `keys.json` and the `.bin`. **Step 6: Commit** `"Add publish flow with run polling and conflict handling"`.

### Task 23: Access codes, Files and token sections

**Files:**
- Create: `admin/modules/codes.mjs`, `admin/sections/access.mjs`, `admin/sections/files.mjs`
- Modify: `admin/sections/settings.mjs` ("Replace GitHub token", "Change admin code")

**Interfaces:**
- `codes.mjs`: `listCodes(draft, vk): Promise<{ id, kind, label, created, code? }[]>`; `createDownloadCode(store, vk, { label, code? }): Promise<string>` (returns the code; `addEntry` into the draft's `access`); `revoke(store, entryId)` (pushes to `revoked`, sets `rotate = true`); `changeAdminCode(store, { currentCode, newCode, newToken? }, vk)` — verifies `currentCode` with `unlock`, enforces `codeStrength(newCode).ok`, re-adds the admin entry under the new code (new `kek`, stored in `sessionStorage.mk.kek`), sets `rotate = true`, replaces `github.token` when given; `replaceToken(store, kek, token)` reseals the admin payload.
- Access section: table per spec §13.3 (admin row shows `••••`, download rows show the code with copy); "+ New download code" with label and optional custom code; Revoke with the exact confirmation sentence from spec §13.3; Change admin code form with strength meter and the token warning (spec §12).
- Files section: table of every file across the site (name, size, bullet it belongs to, remove), gauge with amber/red thresholds from `limits.mjs`, "Orphaned blobs" list from `gh.listTree()` minus referenced ids with "delete" adding to `deleted`.

- [ ] **Step 1: Add tests** for `codes.mjs` pure parts using an in-memory store (Task 17) and `iterations: 1000`: `createDownloadCode` then `listCodes` shows it with its label and code; `revoke` marks `rotate`; `changeAdminCode` with a weak code rejects; with a strong code the old code no longer unlocks and the new one does.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; manual: create a code, publish, open the site in a private window, unlock with it; revoke, publish, confirm the code fails afterwards. **Step 5: Commit** `"Add access codes, files and token management"`.

### Task 24: First-run setup wizard

**Files:**
- Create: `admin/modules/setup.mjs`
- Modify: `admin/admin.mjs` (`#setup` route)

**Interfaces:**
- `runSetup(container)`: three steps per spec §13.2: token (password field; `createGitHub(...).validate()` must return `ok`), admin code twice with strength meter, then generate VK + salt, build `access.json` (admin entry), `keys.json`, commit both via `commitFiles` with message `Initialise vault`, show "Done — reopen /admin/ and enter your code". Defaults `owner: mojikone`, `repo: mojtabakeivanlou`, `branch: redesign3_admin`, editable. Refuses to run when the fetched `access.json` already has an admin entry (shows a message pointing to "Change admin code").

- [ ] **Step 1: Implement.** **Step 2: Manual check** against `redesign3_admin_test` with a throwaway token: wizard completes, the gate then accepts the code; a second visit to `#setup` is refused. Revert the test branch afterwards. **Step 3: `npm test`** → PASS. **Step 4: Commit** `"Add first-run setup wizard"`.

### Task 25: Pre-cutover checklist and handover

**Files:**
- Modify: `CLAUDE.md` (final notes), `docs/superpowers/specs/…` (status line → "implemented; awaiting cutover")

- [ ] **Step 1: Run the manual checklist from spec §17** on the local preview and record each line as done in the PR/commit message: pill states on desktop and phone, wrong code, download code with one and several files, admin code opens dashboard, each section edit, publish to the test branch, PDF opens with page numbers, palette switcher still works (change colour via the "o"), contact form markup unchanged, GA tag present.
- [ ] **Step 2: Clean the test branch and vault**: no fake files or test codes remain in `vault/` on `redesign3_admin`; `vault/access.json` on the branch holds only the entries the owner created through the real setup (the owner runs §13.2 himself with his own token).
- [ ] **Step 3: `npm test` and `npm run build` pass; push.** Confirm the workflow's build job is green on GitHub.
- [ ] **Step 4: Commit** `"Finalise admin branch for cutover"` and hand the owner the three cutover actions from spec §16 step 4.

---

## Self-review notes

- Spec coverage: §8 model → Tasks 4, 7; §9 build → 10; PDF → 11; §10 workflow → 12; §11 pill/icons/unlock → 7, 15; §12 vault → 13, 14, 23; §13.1 gate → 16; §13.2 setup → 24; §13.3 sections → 18, 19, 20, 23; §13.4 draft → 17; §13.5 preview → 21; §13.6 publish → 22; §13.7 token → 23; §13.8 sign out → 16; §13.9 limits → 16, 19; §14 head/JSON-LD → 7; §15 migration/parity → 6, 7, 8, 9; §16 cutover → 25 (owner actions); §17 tests → throughout; §18 security → constraints and Tasks 3, 15, 22.
- Names used consistently: `normalizeSite`, `validateSite`, `renderContext`, `renderIndex/Contact/ThankYou/Cv`, `unlock`, `addEntry`, `rotateVault`, `wrapFileKey`, `createGitHub`, `commitFiles`, `ConflictError`, `createStore`, `createFileStore`, `prepareUpload`, `buildCommit`, `publish`.
- Review Focus items are pinned: 1 → Task 14 test, 2 → Task 3 test, 3 → Task 10 warning test and Task 15 `is-error` state (manual), 4 → Task 16 `ConflictError` and Task 22 conflict sequence, 5 → Tasks 2 and 4.
