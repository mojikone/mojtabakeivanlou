# CLAUDE.md — redesign3_admin branch

Personal portfolio site for Mojtaba Keivanlou (mojtabakeivanlou.com), repo `mojikone/mojtabakeivanlou`. On this branch the site is **generated**: `content/site.json` plus the templates in `assets/js/render/` are turned into `dist/` by `src/build.mjs`, and a GitHub Actions workflow deploys `dist/` to GitHub Pages. Four pages come out (`index.html`, `contact.html`, `thank-you.html`, `cv.html`) plus the CV PDF. There are no hand-written HTML pages any more.

The generated pages are meant to be identical to the old hand-written site, and the parity test enforces it. The only visible additions are the **Access pill** in the hero contact row (unlocks private downloads) and the small **download icons** beside project bullets that have files attached.

Spec: `docs/superpowers/specs/2026-10-20-admin-dashboard-design.md` (section numbers below, such as §16, refer to it). Plan: `docs/superpowers/plans/2026-10-21-admin-dashboard.md`.

Until the cutover (see below) the live site is still served from branch `redesign3_colors_firebase`; that branch is also the rollback.

---

## Working rules

- **Content lives in `content/site.json`**, and nowhere else: text, lists, links, file attachments. Edit it through the dashboard at `/admin/` (first-run setup at `/admin/#setup`; the code is under `admin/`, every section of §13.3 included) or by hand followed by `npm run build`. The build validates it and fails with a message that names the path, for example `experience.companies[2].projects[0].bullets[3].text is empty`.
  - Placeholders in strings: `{{years}}`, `{{year}}`, `{{name}}`, `{{roleTitle}}`, `{{domain}}`. Years of experience are computed from `site.experienceStart` (full UTC years); never type the number.
  - Rich-text fields accept `**bold**`, `_italic_` and a blank line for a new paragraph. Everything is HTML-escaped; never put HTML in content.
- **Never edit `dist/`.** It is git-ignored and is emptied and rewritten by every build.
- **Markup changes go in the templates** (`assets/js/render/*.mjs`), styles in `assets/css/main.css` / `assets/css/cv.css`, behaviour in `assets/js/main.js`.
- **`npm test` must pass** before every commit and before every push. The workflow runs it too, and a red test stops the deploy.
- **Never write a GitHub token, a vault key, an admin code or a download code** into a file, a commit message, a log or the chat. The owner creates the fine-grained token on GitHub himself and pastes it into the dashboard's setup wizard; Claude never asks for it or handles it.
- The cutover (below) is the owner's job, in the GitHub web UI. Claude does not change repository settings.

---

## Commands

Node 22 or newer, ES modules, no bundler. The only dependency is `puppeteer` (a devDependency, used for the PDF); run `npm ci` once.

| Command | What it does |
|---|---|
| `npm test` | `node --test "test/**/*.test.mjs"` |
| `npm run build` | `node src/build.mjs`: read and validate `content/site.json`, render the four pages, hash the assets, write `dist/`. Exits 1 on invalid content (one error per line on stderr). Warnings (`warning: …` on stderr) for a missing vault blob, asset or static file; they do not fail the build. |
| `npm run pdf` | `node src/pdf.mjs`: renders `dist/cv.html` with puppeteer to `dist/pdf/<site.cvPdfFilename>`. **Run it after `npm run build`**, because the build empties `dist/`. Firebase and Google Analytics requests are blocked while rendering (the PDF uses the palette's built-in default colours, and CI renders count no page views); a missing `dist/cv.html` fails instead of printing a "Not found" page. Poppins comes from Google Fonts, so it needs network; offline the PDF falls back to Arial. |
| `npm run dev` | Builds, serves `dist/` at http://127.0.0.1:3004 and rebuilds when something under `content/`, `assets/`, `admin/`, `src/` or `vault/` changes. A failed rebuild keeps serving the last good build and logs the errors. It does not render the PDF, so the Download CV link has no file locally. |

Preview server: `.claude/launch.json` in this repo has the entry `website` (`npm run dev`, port 3004). The parent folder (`D:\Personal\Website Mojtaba\.claude\launch.json`) has `website-admin`, which runs the same thing as `npm --prefix redesign3_admin run dev`; the other entry there, `website-fb`, serves the old Firebase branch on port 3003.

---

## Tests, and the parity test

`npm test` runs everything under `test/`. The PDF render test (`test/pdf.test.mjs`) starts Chromium and therefore runs only when `CI=true` (GitHub Actions sets it, and the workflow sets it explicitly) or `PDF_TEST=1`; otherwise it is reported as skipped with its reason.

`test/parity.test.mjs` is the guard that the generated pages still equal the old site. It renders the four pages from `test/fixtures/site.parity.json` (below), with `today` fixed at 2026-06-01 (16 years of experience), and compares each with `test/fixtures/original/<page>.html` after normalisation (`test/helpers/normalize.mjs`): comments dropped, whitespace collapsed, attributes sorted, entities decoded, JSON-LD canonicalised, `?v=` values ignored, and the additions removed (the Access pill, the `.proj-files` spans, the years safety-net script and `data-years` spans, `data-experience-start`, the module script and its preload).

- `index.html`, `contact.html`, `thank-you.html`: **zero** differences.
- `cv.html`: exactly **three sanctioned differences**, each encoded in the test as a transformation of the original, so a fourth fails the test:
  1. `site.json` orders the CV stats Years / Countries / Projects (as the home page does); the original CV had Years / Projects / Countries.
  2. The "Surveying & Mapping" description says "geospatial data collection" (as the home page does).
  3. The original's single inline `<style>` is split: the `@page` rule (A4, margins, `@bottom-center` page-number footer) stays inline because the footer text is generated from `profile`; everything else is `assets/css/cv.css`, linked from the page.

**Updating fixtures is deliberate, never casual.** `test/fixtures/original/*.html` are byte copies of the hand-written pages at commit `1de3ce8` (`git show 1de3ce8:index.html > test/fixtures/original/index.html`). They define "the site as it was". A parity failure means a template or the normaliser changed a page (the frozen content cannot change): find out which, and fix that. Never refresh a fixture, loosen a normaliser rule or add a fourth CV exception just to turn a test green, and never paste a built page into a fixture (the test would then compare the builder with itself). Change a fixture only when the owner has decided the baseline itself should change, for example a deliberate markup change in a template:

1. Change the template first and read the diff the test prints (up to 20 normalised differences).
2. Edit only the affected fragment of the fixture, or re-extract it from a named commit with `git show <commit>:<page>.html`.
3. Commit the fixture change on its own, with a message that says who decided and why.

The fixtures are byte-exact on purpose: `.gitattributes` marks `test/fixtures/** -text` (no CRLF conversion), and the "inline @page rule … byte for byte" test depends on it. Do not let an editor re-save them. `test/fixtures/site.min.json` is the smallest valid site, used by the unit tests; keep it valid against the validator.

**The parity tests render a frozen copy of the content, not the live one.** `test/fixtures/site.parity.json` is a byte copy of `content/site.json` as it was extracted from the original pages (`cp content/site.json test/fixtures/site.parity.json`, run once when it was frozen, in Task 12b). `test/parity.test.mjs` and the other tests whose expected values are the original site (`test/cv.test.mjs`, `test/head.test.mjs`, `test/contact.test.mjs`) read it instead of `content/site.json`. So `content/site.json` is free to change, which is exactly what the dashboard publishes, without touching the parity tests or stopping the deploy. Treat the file like `test/fixtures/original/*`: never edit it by hand, never refresh it from the live content to turn a test green; change it only together with a deliberate fixture-baseline change decided by the owner.

What still guards the live content in CI is `test/content.test.mjs` (`validateSite` returns no errors for `content/site.json`) and the build test, which builds the real content. The template tests, which render the frozen content, prove the templates; those two prove the content. A test that builds or serves the live content (`test/build.test.mjs`, `test/dev.test.mjs`) must not hard-code a value taken from it (the years of experience, the email, a name): it derives the expected value from `content/site.json` through `test/helpers/live.mjs`, because the dashboard may change any of them.

---

## Palette and Firebase

`assets/js/palette.js` is **untouched** and is copied to `dist/` byte for byte (a test checks it). It is loaded synchronously in `<head>` on every page. Firebase is used **only** for the palette's global default colour; nothing else on the site, in the build or in the workflow uses it, and no Firebase credentials are needed in CI. Its header comment still says to "bump ?v=" — that is obsolete (the build hashes the file) and the file is left as it is on purpose.

---

## Vault (private downloads)

`vault/` holds **ciphertext only**, so it is safe in git:

- `vault/access.json` — one entry per access code: the vault key wrapped under that code (the admin entry also seals the owner key and the GitHub token). Each entry's label and code (its meta) are sealed under the owner key, so a download code reveals nothing about the other codes.
- `vault/keys.json` — one entry per attached file: the file's own key wrapped under the vault key.
- `vault/files/<id>.bin` — the encrypted attachments; `<id>` is 32 hex characters.

The two JSON files in the repo today are an empty skeleton; first-run setup in the dashboard (§13.2) or `vault-cli init` fills them. The crypto is `assets/js/vault.mjs` (WebCrypto, shared by the public pages, the dashboard and the tests). Never commit plaintext attachments, codes, tokens or a test vault.

`scripts/vault-cli.mjs` is the Node-only tool for local testing and recovery. It reads and writes `./vault/` of the **current directory**, so for experiments run it from a scratch folder, not from the repo root:

```
node scripts/vault-cli.mjs init --admin-code <code> --token <token> [--owner mojikone] [--repo mojtabakeivanlou] [--branch redesign3_admin] [--force]
node scripts/vault-cli.mjs add-code --admin-code <code> --label <label> [--code <code>]   # prints the new download code (MK-XXXX-XXXX)
node scripts/vault-cli.mjs encrypt --admin-code <code> <file>     # writes vault/files/<id>.bin + the key; prints the file record to paste into site.json
node scripts/vault-cli.mjs revoke --admin-code <code> <entryId>   # removes an entry and rotates the vault key and the owner key (no file is re-encrypted)
node scripts/vault-cli.mjs list --admin-code <code>               # id, kind, label, created date, and the code for download entries
```

An admin code needs 12 or more characters from at least three of: lowercase, uppercase, digits, symbols. `init` refuses to overwrite an existing admin entry; `--force` discards every code and leaves the files already in `vault/files/` undecryptable, so never use it on the real vault. The build warns (`vault/files/<id>.bin missing for …`) when a file record in `site.json` has no blob.

---

## Assets and cache-busting

The build writes `?v=<first 8 hex digits of the SHA-1 of the file's bytes>` on `assets/css/main.css`, `assets/css/cv.css`, `assets/js/main.js`, `assets/js/palette.js` and `assets/js/access.mjs` (`src/hash.mjs`). **Nobody bumps `?v=` numbers by hand any more.** A missing asset gets `?v=dev` and a build warning. Images are not hashed: the hero photo URL carries a fixed `?v=2` in `assets/js/render/index.mjs`, so bump it there if you replace that photo under the same name.

The build also copies `assets/`, `vault/`, `admin/`, `CNAME`, `.nojekyll` and `robots.txt` into `dist/` (`robots.txt` disallows `/admin/` and `/vault/`) and creates the empty `dist/pdf/`. `src/`, `scripts/`, `docs/` and `test/` never reach `dist/`.

---

## Deploy: GitHub Actions

`.github/workflows/site.yml`, workflow `site`:

- **Triggers:** push to `redesign3_admin` or `redesign3_admin_test`; manual `workflow_dispatch`; and a yearly schedule, `30 3 24 9 *` (24 September 03:30 UTC), so the years-of-experience number rolls over. GitHub only runs schedules from the **default branch**, which is why the cutover makes `redesign3_admin` the default.
- **Permissions:** the workflow default is `contents: read`, which the `build` job uses; only the `deploy` job has its own `permissions:` block with `pages: write` and `id-token: write`.
- **`build` job (always):** checkout, Node 22 with npm cache, a cache of `~/.cache/puppeteer` (the Chromium download, keyed on `package-lock.json`), `npm ci`, `npm test` (with `CI=true`, which switches the PDF render test on), `npm run build`, `npm run pdf`, then upload `dist/` as the Pages artifact. Invalid content fails the build, and a failed build never replaces the live site.
- **`deploy` job:** runs only when the ref is `refs/heads/redesign3_admin` **and** the repository variable `DEPLOY_FROM_ACTIONS` is `true`. A scratch branch such as `redesign3_admin_test` can therefore never deploy, and until the owner sets the variable nothing goes live.
- `concurrency` group `site-${{ github.ref }}` with `cancel-in-progress`: a newer run on the same branch cancels an older one still running. The group is per ref, so a push to `redesign3_admin_test` can never cancel a running `redesign3_admin` deploy.

---

## Cutover (spec §16)

1. Develop and test on `redesign3_admin`; pushes run only the build job.
2. First run (§13.2), done once by the owner:
   - On GitHub: Settings (of the account) → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token. Repository access: only `mojikone/mojtabakeivanlou`. Repository permissions: **Contents: Read and write**, **Actions: Read-only**, **Metadata: Read-only** (GitHub adds it by itself). Note the expiry date; the dashboard's Settings has a field for it.
   - Open the setup wizard. Before the cutover: `http://localhost:3004/admin/#setup` from `npm run dev`, with `redesign3_admin` pulled. `https://mojtabakeivanlou.com/admin/#setup` only after the cutover (until then the domain serves the old branch, which has no dashboard). Setup runs once; a second run refuses because an admin code exists.
   - Paste the token and Validate, choose the admin code (12 or more characters, three of lower case, upper case, digits, symbols; it seals the token and cannot be recovered), then Create vault. The wizard commits `vault/access.json` and `vault/keys.json` to the branch. Then `git pull` before signing in on the local preview (the gate reads the vault the site serves); on the live site, wait for the Actions run.
3. The owner checks the local preview and the dashboard end to end (edit, attach, publish; optionally to the scratch branch `redesign3_admin_test`, which the wizard's branch field allows).
4. The owner does the cutover in the GitHub web UI (about two minutes):
   - Settings → General → Default branch → `redesign3_admin` (needed for the yearly scheduled rebuild). Do this **before** the Pages source: switching the source to GitHub Actions limits the `github-pages` environment to the default branch of that moment.
   - Settings → Pages → Build and deployment → Source: **GitHub Actions**.
   - Settings → Secrets and variables → Actions → Variables → `DEPLOY_FROM_ACTIONS` = `true`.
   - Check Settings → Environments → `github-pages` → Deployment branches and tags: `redesign3_admin` must be allowed (add it if only another branch is listed), or the deploy job is rejected.
   - Re-run the latest workflow, or push. The first Actions deployment replaces the branch deployment; the custom domain and HTTPS settings are untouched.
   - GitHub disables scheduled workflows after 60 days without activity in the repository. Every dashboard publish is a commit and counts as activity; if the Actions tab ever shows the `site` workflow's schedule disabled, re-enable it there, or the yearly rebuild of the years of experience does not run.
5. Rollback, in the GitHub web UI:
   - Settings → Pages → Source back to "Deploy from a branch", branch `redesign3_colors_firebase`.
   - Settings → Secrets and variables → Actions → Variables → set `DEPLOY_FROM_ACTIONS` to `false`, so no workflow run (a push, the yearly schedule) tries to deploy again.
   - Check Settings → Environments → `github-pages` → Deployment branches and tags: `redesign3_colors_firebase` must still be allowed (the switch to GitHub Actions may have limited it to `redesign3_admin`); add it if it is not, or the branch deployment is rejected.
6. After a week of normal use the owner may create the usual `V<n>_` backup branch of `redesign3_admin` and delete the obsolete `CV/cv.html` master in the parent folder.

---

## Pages are generated

There is no page-by-page documentation here because there is no page source to document: change `content/site.json` or the template, never an HTML file.

| Template (`assets/js/render/`) | Output |
|---|---|
| `index.mjs` | `index.html` — sections `#home`, `#about`, `#expertise`, `#experience`, `#skills`, `#contact`; the Access pill sits in the hero contact row; bullets with files get a hidden `.proj-files` span of download icons |
| `contact.mjs` | `contact.html` — contact form, topbar |
| `thank-you.mjs` | `thank-you.html` — post-form confirmation, topbar |
| `cv.mjs` | `cv.html`, and `pdf/<cvPdfFilename>` after `npm run pdf` |

Shared: `head.mjs` (title, description, canonical, Open Graph, Twitter, JSON-LD, GA, favicon, fonts, the `palette.js` include), `topbar.mjs`, `html.mjs` (the auto-escaping `html` tag, `raw()`, rich text), `icons.mjs` (named inline SVGs), `years.mjs`, `model.mjs` (normalise, validate, derive the render context). All of them are pure and browser-safe, so the dashboard preview and the tests use the very same code as the build. The JSON-LD reproduces the old structure exactly, every value sourced from `site.json`.

---

## Design System

| Token | Value |
|---|---|
| Background dark | `#141414` |
| Background light | `#EBEAE4` |
| Lime accent | `#A8CE2E` |
| Font | Poppins (200–700) from Google Fonts |
| CSS files | `assets/css/main.css` (home, contact, thank-you) and `assets/css/cv.css` (CV) — cache-busted by the build with a content-hash `?v=` |
| JS files | `assets/js/main.js` (home), `assets/js/palette.js` (all pages), `assets/js/access.mjs` (home, public unlock flow) — cache-busted the same way |

**Never bump `?v=` by hand**: the build rewrites it from each file's bytes, so browsers fetch a file again exactly when it changed.

---

## Architecture

### Scroll-over hero effect
`section.hero` has `position: sticky; top: 0; z-index: 0`. All subsequent sections use `position: relative; z-index: 1`, so they scroll over the top of the hero. This is the core visual mechanic of the page.

### Hero photo
File: `assets/img/mojtaba-waterfront4-gray.webp` (689×1429 px, ~64 KB, grayscale), with the blurred placeholder `assets/img/hero-waterfront4-gray-lq.png` behind it while it loads.  
Positioning uses `svh` units so the subject keeps its place regardless of viewport width (`.hero-photo-main` in `main.css`):
- Desktop: `height: 90svh; left: calc(4px - 1svh)`
- Mobile: `height: 70svh; left: calc(4px - 1svh)`

### Pill nav
`position: fixed; bottom: 28px` on desktop (hidden above 860px); shown at `bottom: 16px` on mobile (`max-width: 768px`).  
Active state: scroll listener calls `getBoundingClientRect().top <= 10` on each `section[id]`. Works correctly for the sticky hero because it reads visual position, not `offsetTop`.  
Smooth scroll: `a[href="#home"]` always calls `smoothTo(0)` explicitly (sticky elements report `getBoundingClientRect().top = 0` at all scroll positions, making `offsetTop`-based scroll a no-op).

### Topbar
**Removed entirely from `index.html`.** Still present on `contact.html` and `thank-you.html` (absolute-positioned, not fixed).

---

## Mobile Hero Layout (max-width: 768px)

Right column starts at `left: 28%` (gives ~250px width on 375px phones — wide enough for the role title in 2 lines).

| Element | Position |
|---|---|
| `.hero-name-over` | `top: 28px; left: 28%; right: var(--pad)` |
| `.hero-center-block` | `top: 54px; left: 28%; right: var(--pad)` |
| `.hero-br` (contact + buttons) | `bottom: 64px; right: var(--pad)` |
| `.pill-nav` | `bottom: 16px` |

Role headline forced to 2 lines by `<br>` in HTML: `Senior Hydraulic &<br>Water Resources Engineer`.

**Landscape phones (max-height: 500px):** separate rules prevent name/title block from overlapping the contact/button block — a real 40px overlap existed on 800×360px viewports where desktop CSS applies and `hero-br` (179px tall) started above `hero-center-block` bottom.

---

## Known CSS Pitfalls

- `@media (max-width: 860px)` hides the pill nav. `@media (max-width: 768px)` re-shows it. Order matters — 860px rule must come first.
- `hero-contact-row` base CSS is `flex-direction: column` (stacked pills). The mobile override `display: flex` does NOT reset `flex-direction`, so pills remain stacked on mobile too. Mobile override only changes `display` back from `none`.
- Two rules for the same selector in the same media block: last one wins. Previously caused `hero-br` to be hidden (`display: none` overrode `display: flex`).
