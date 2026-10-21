# Admin dashboard and data-driven build for mojtabakeivanlou.com

Date: 2026-10-20
Branch: `redesign3_admin` (cloned from `origin/redesign3_colors_firebase` at commit `1de3ce8`)
Status: implemented on branch redesign3_admin; awaiting cutover (owner actions in §16 step 4)

---

## 1. Intent

The site owner (Mojtaba Keivanlou, a hydraulic engineer, not a web developer) wants to change
anything on his portfolio site himself, from a browser, without editing HTML or asking for help:
texts, numbers, links, education, languages, services, companies, projects, project bullets,
skills, the contact-form dropdown. Every change must land on the website, the HTML CV page and
the CV PDF at the same time, because today those three copies are maintained by hand and have
already drifted apart. Years of experience must count themselves up from 23 September 2009.
Project bullets must be able to carry report files that only the owner, and people he chooses,
can download.

The site stays on GitHub Pages, in the existing public repository, on the free plan, with no
server of its own.

## 2. Goals

1. One file, `content/site.json`, is the single source of truth for all content on `index.html`,
   `contact.html`, `thank-you.html`, `cv.html` and the CV PDF.
2. A dashboard at `/admin/`, opened by typing the admin code into the new "Access" pill in the
   hero, edits that file and uploads attachments. It keeps a draft on the device and publishes
   with one button.
3. Publishing is one git commit. A GitHub Actions workflow then rebuilds the four pages and the
   PDF and deploys them. The owner sees progress in the dashboard and the result is live within
   a few minutes.
4. Years of experience are computed at build time from the start date and written into every
   place the number appears, including meta tags, JSON-LD and the PDF. A scheduled rebuild each
   24 September rolls the number over. A small script recomputes the visible number on page load
   as a safety net.
5. Each project bullet can carry zero or more files. Files are encrypted in the browser before
   upload, so the public repo only ever holds ciphertext. A download code, typed into the same
   Access pill, reveals a download icon at the right end of each bullet that has files.
6. The public pages look exactly as they do today. The only visible additions are the Access
   pill under WhatsApp and, after a valid code, the download icons.
7. Firebase stays, untouched, for the colour-palette switcher only. Nothing else uses it.
8. Visual parity is verified: the built pages are compared with the current live pages.

## 3. Non-goals

- Instant content updates (a Firebase mirror that patches pages before the deploy finishes).
  The templates are shared between the build and the browser so this can be added later.
- Editing images (hero photo, about illustration, business-card QR). They stay as files in
  `assets/img/` and are swapped by committing new files.
- Custom icons. Services and business-card cells pick from a fixed icon library.
- Multiple admins, roles, audit trails, comments.
- Changing the design, layout, CSS tokens or palette mechanics of the public site.
- A private repository. The repo stays public; encryption protects the reports.
- Instant global colour change through the dashboard. The existing "o" switcher with Firebase
  already does that and is kept as is.

## 4. Anti-goals (what would make this a failure even if it works)

- The public site depending on any runtime service to render content. If GitHub Pages is up,
  the site is up, complete, and indexable.
- A secret (GitHub token, vault key, any code) stored in plain text in the repo, in a build
  artifact, in a log, or in this document.
- The owner needing a terminal, Node, or git to make a routine content change.
- The built `index.html` looking different from today's `index.html` in any way the owner did
  not ask for.
- A hirer needing an account, an app, or anything beyond a code typed into the site.

## 5. Facts about the current site that shape the design

- Deployed from branch `redesign3_colors_firebase` by the default GitHub Pages branch build
  (Jekyll pass, no workflow). Custom domain `mojtabakeivanlou.com` via `CNAME`.
- Four hand-written pages. Services, education, experience, projects, skills and languages each
  appear in both `index.html` and `cv.html`. "16 years" is typed in seven places and is already
  wrong (17 since 23 September 2026).
- `cv.html` is self-contained (own CSS, A4 `@page` rules with a `@bottom-center` footer and page
  counters). The PDF `pdf/CV_Mojtaba_Keivanlou_2026.pdf` is produced by printing `cv.html` with
  headless Chrome. The master copy `D:\Personal\Website Mojtaba\CV\cv.html` becomes obsolete.
- `assets/js/palette.js` (loaded synchronously in `<head>`) implements the colour switcher
  triggered by the "o" in "Mojtaba", with Firebase Realtime Database for the global default and
  Google sign-in locked to one UID. It must be copied through unchanged.
- `assets/js/main.js` handles topbar, hamburger drawer, smooth scroll, pill nav, reveal
  animations, experience expand/collapse (`toggleExp`), business-card flip, WhatsApp routing.
- Contact form posts to Web3Forms with a public access key in a hidden input; the project-type
  dropdown is static HTML; the form redirects to `thank-you.html`.
- Google Analytics tag `G-FMKJ61FF7F` in every head; Search Console verification depends on it.
- Cache busting is manual: `main.css?v=59`, `palette.js?v=5`, `main.js?v=12` and the CLAUDE.md
  rule to bump them.
- The live branch on GitHub is four commits ahead of the owner's local
  `redesign3_colors_firebase` folder (role title changed from "Principal" to "Senior", Majlas Dam
  start date to Jan 2026 with a new bullet, grayscale hero photo). The new branch starts from the
  GitHub version. All content in `site.json` is extracted from the GitHub version.
- `netlify.toml` is a leftover with no effect on GitHub Pages. It is removed.

## 6. Architecture

```
owner's browser                      GitHub                         visitor's browser
┌───────────────────┐   1 commit    ┌──────────────────────────┐   static files   ┌──────────────┐
│ /admin/ dashboard │ ────────────▶ │ repo, branch redesign3_… │ ───────────────▶ │ index.html   │
│  draft in device  │  Git Data API │  content/site.json       │  GitHub Pages    │ contact.html │
│  encrypts files   │               │  vault/access.json       │  (from workflow  │ thank-you    │
│  polls run status │ ◀──────────── │  vault/files/<id>.bin    │   artifact)      │ cv.html      │
└───────────────────┘  Actions API  │  assets/, admin/, src/   │                  │ pdf/*.pdf    │
                                    │        │ push             │                  │ admin/       │
                                    │        ▼                  │                  │ vault/       │
                                    │  GitHub Actions workflow │                  └──────┬───────┘
                                    │   npm test               │                         │ code typed
                                    │   node src/build.mjs     │                         ▼
                                    │   node src/pdf.mjs       │                  decrypts in browser
                                    │   deploy dist/ to Pages  │                  (WebCrypto)
                                    └──────────────────────────┘
Firebase Realtime Database: palette default only (unchanged palette.js). Not drawn; not involved.
```

Three moving parts: a **build** (Node, runs in CI and locally), a **dashboard** (static page,
talks to GitHub directly with the owner's token), and a **vault** (client-side encryption, shared
code used by the public pages, the dashboard and the tests).

## 7. Repository layout on the new branch

```
content/site.json                 all content; the dashboard edits this
vault/access.json                 one entry per access code: the vault key wrapped under that code
vault/keys.json                   one entry per file: the file's own key wrapped under the vault key
vault/files/<id>.bin              encrypted attachments; <id> = 32 hex chars
assets/css/main.css               existing + rules for the Access pill, download icons
assets/css/cv.css                 the CSS that is inline in today's cv.html, moved to a file
assets/js/palette.js              UNCHANGED
assets/js/main.js                 existing + nothing (access logic lives in access.mjs)
assets/js/access.mjs              public unlock flow: pill, codes, icons, downloads
assets/js/vault.mjs               crypto: PBKDF2, AES-GCM, wrap/unwrap, file encrypt/decrypt
assets/js/render/                 templates shared by build, dashboard preview and tests
  html.mjs                        `html` tag with auto-escaping, `raw()`, rich-text mini-markdown
  icons.mjs                       named inline SVGs (all SVGs from today's pages)
  years.mjs                       yearsOfExperience(startDate, today)
  index.mjs contact.mjs thank-you.mjs cv.mjs   page templates
  head.mjs                        shared <head>: meta, OG, Twitter, JSON-LD, GA, favicon, fonts
admin/index.html admin/admin.css admin/admin.mjs (+ admin/modules/*.mjs)   the dashboard
src/build.mjs                     reads site.json, writes dist/
src/pdf.mjs                       puppeteer: dist/cv.html → dist/pdf/<filename>
src/serve.mjs                     tiny static server for dist/ (local preview)
scripts/extract-content.mjs       one-time: today's HTML → content/site.json (kept for reference)
test/                             node --test suites
.github/workflows/site.yml        test, build, PDF, deploy
package.json                      devDependency: puppeteer only; scripts: test, build, pdf, dev
CNAME  .nojekyll  robots.txt      copied into dist/
docs/superpowers/specs/…          this document
CLAUDE.md                         rewritten for the new workflow
dist/                             build output, git-ignored
```

Removed from the branch: `index.html`, `contact.html`, `thank-you.html`, `cv.html`,
`pdf/CV_Mojtaba_Keivanlou_2026.pdf` (all generated now), `netlify.toml`.

## 8. Content model: `content/site.json`

JSON, UTF-8, 2-space indented, keys in the order below so diffs stay readable. Every string that
is rendered as text supports two things:

- **Placeholders**: `{{years}}` (integer years of experience), `{{year}}` (current calendar
  year), `{{name}}` (full name), `{{roleTitle}}` (`profile.roleTitle`), `{{domain}}`.
- **Rich text** (only in fields marked *rich*): `**bold**` → `<strong>`, `_italic_` → `<em>`,
  blank line → new paragraph. Everything is HTML-escaped first; no raw HTML is ever accepted.

```jsonc
{
  "schemaVersion": 1,
  "site": {
    "domain": "mojtabakeivanlou.com",
    "gaId": "G-FMKJ61FF7F",
    "web3formsKey": "48578b9d-2262-418b-a5b9-4d9bd167ffb4",
    "formSubject": "New Project Enquiry — mojtabakeivanlou.com",
    "experienceStart": "2009-09-23",
    "cvPdfFilename": "CV_Mojtaba_Keivanlou_2026.pdf"
  },
  "profile": {
    "firstName": "Mojtaba",
    "lastName": "Keivanlou",
    "roleTitle": "Senior Hydraulic & Water Resources Engineer",
    "roleTitleLong": "Senior Hydraulic and Water Resources Engineer",
    "heroHeadline": ["Senior Hydraulic &", "Water Resources Engineer"],
    "roleSubtitle": "Team Leader",
    "quote": "Deep hydraulic engineering paired with _modern computational practice_ — a combination rarely found at this seniority.",   // rich
    "bio": "I am a **Senior Hydraulic and Water Resources Engineer** with {{years}} years of experience …\n\nI specialise in …\n\nWhat distinguishes my practice: …",   // rich, 3 paragraphs
    "cvSummary": "Senior Hydraulic and Water Resources Engineer with {{years}} years …\n\nSpecialised in …",   // rich, 2 paragraphs
    "email": "keyvanlu.m@gmail.com",
    "phone": { "display": "+968 9297 0635", "e164": "+96892970635" },
    "whatsapp": "96892970635",
    "linkedin": "https://linkedin.com/in/MojtabaKeivanlou",
    "location": { "city": "Muscat", "country": "Sultanate of Oman", "short": "Muscat, Oman", "countryCode": "OM" },
    "stats": [
      { "value": "{{years}}", "suffix": "+", "label": "Years",     "cvLabel": "Years Experience" },
      { "value": "2",         "suffix": "",  "label": "Countries", "cvLabel": "Countries + US Remote" },
      { "value": "50",        "suffix": "+", "label": "Projects",  "cvLabel": "Projects Delivered" }
    ],
    "businessCard": {
      "titleLines": ["Hydraulic & Hydrology", "Water Resources", "Wet Utilities"],
      "cells": [ { "label": "Flood Modeling", "icon": "waves" }, …, { "label": "Consultation", "icon": "chat" } ]   // 9 today
    }
  },
  "education": [
    { "degree": "MSc — Hydraulic Structures Engineering", "school": "Sari University of Agricultural Sciences and Natural Resources (SANRU), Iran", "schoolShort": "Sari University of Agricultural Sciences and Natural Resources", "year": "2013" },
    { "degree": "BSc — Water Sciences and Engineering", "school": "University of Birjand, Iran", "schoolShort": "University of Birjand", "year": "2009" }
  ],   // schoolShort feeds JSON-LD alumniOf; the dashboard pre-fills it from school minus the bracket and country
  "languages": [ { "name": "Persian", "level": "Native" }, { "name": "English", "level": "Fluent" } ],
  "services": {
    "intro": "From national flood masterplans to GIS automation — specialised hydraulic engineering delivered at international standards.",
    "items": [ { "title": "Flood Modelling & Protection", "icon": "waves", "description": "1D/2D hydraulic modelling, …",
                 "keywords": ["Flood modelling", "HEC-RAS", "Flood hazard mapping", "…"] }, … ]   // 9 today; keywords feed JSON-LD serviceType (about 45 terms today)
  },
  "experience": {
    "intro": "{{years}} years across Iran and Oman, plus remote international projects — progressively leading larger and more complex water engineering programmes.",
    "companies": [
      {
        "id": "renardet",
        "name": "Renardet S.A. & Partners",
        "period": "2022 – Present",
        "current": true,
        "role": "Senior Hydraulic Engineer · Team Leader",
        "location": "Muscat, Sultanate of Oman",
        "summary": "Leading the hydraulic team on …",
        "expandLabel": "View all projects",
        "projects": [
          {
            "id": "majlas",
            "name": "Majlas Dam Design Review — Quriyat",
            "period": "Jan 2026 – Present",
            "role": "Hydrology & Hydraulic Engineer",
            "scope": "",
            "bullets": [
              { "text": "Techno-Economic and Flood-Hazard Assessment of the Wadi Majlas Scheme",
                "files": [ { "id": "3f9c…(32 hex)", "name": "Wadi_Majlas_Techno_Economic_Report.pdf", "size": 4403211, "type": "application/pdf" } ] },
              { "text": "…", "files": [] }
            ]
          }
        ]
      }
    ]
  },
  "skills": [
    { "category": "Hydraulic & Hydrological Modelling",
      "tags": [ { "name": "HEC-RAS 1D-2D", "level": "expert" }, { "name": "InfoWorks ICM", "level": "familiar" } ] }
  ],
  "contactPage": {
    "heading": ["Start a", "Project"],
    "projectTypes": [ "Flood Modelling & Hazard Mapping", …, "Other / General Enquiry" ],
    "descriptionPlaceholder": "Tell me about your project — scope, location, timeline, and any specific requirements…"
  },
  "thankYou": {
    "heading": ["Message", "received"],
    "text": "Thank you for reaching out. I'll review your enquiry and get back to you within 1–2 business days."
  },
  "cta": {
    "heading": ["Let's work", "together"],
    "sub": "Available for consultancy, design review, hydraulic modelling, and international project collaboration."
  },
  "seo": {
    "titleIndex": "{{name}} — {{roleTitle}}",
    "titleCv": "CV — {{name}} — {{roleTitle}}",
    "descriptionIndex": "Senior Hydraulic Engineer · HEC-RAS, HEC-HMS, SewerGEMS, InfoWorks ICM, Flow 3D, QGIS, Civil 3D, Python · {{years}} years · Oman, Iran, USA",
    "ogDescriptionIndex": "{{years}} years of international experience in flood modelling, dam design, climate adaptation, and engineering automation.",
    "descriptionCv": "CV of {{name}}, {{roleTitle}} — {{years}} years across Oman, Iran and the USA: …",
    "ogDescriptionCv": "{{years}} years of international experience: …",
    "personDescription": "Senior hydraulic and water resources engineer with {{years}} years of international experience across Iran, Oman, and the USA.",
    "knowsAbout": [ "…", "…" ]   // the 77 terms from today's JSON-LD, one per line in the dashboard
  }
}
```

Rules:

- `companies[].id` and `projects[].id` are stable slugs generated once by the dashboard
  (lower-case, hyphens, unique); they become `id` attributes so the site can link to a project.
- `expandLabel` defaults to "View project" for one project, "View all projects" otherwise; the
  owner may override (today's "View all positions").
- Skills: within a category, the build renders all `expert` tags first, then `familiar`, each
  group in the stored order. The dashboard shows them in the same order with a toggle per tag.
- `files[].id` is 32 lowercase hex characters, random, generated at upload; the ciphertext lives
  at `vault/files/<id>.bin`. `name` is the original filename (used for the download), `size` the
  plaintext size in bytes, `type` the MIME type.
- `cvPdfFilename` is a plain editable string, not templated. Today's `_2026` suffix is kept; the
  owner changes it when he wants. Every "Download CV" button uses it.
- Phone `e164` is derived by the dashboard from `display` (digits only, leading `+`); `whatsapp`
  is `e164` without `+`. Both are stored so templates stay dumb.
- Every string field is trimmed; `heading` pairs are two strings rendered with `<br>` between
  them and the second one in the accent colour, exactly like today.

Deliberately duplicated fields (`roleTitle` vs `roleTitleLong`, `bio` vs `cvSummary`, `label` vs
`cvLabel`): today's pages genuinely differ in those places and the owner must be able to keep
them different.

Accidental differences between today's `index.html` and `cv.html` are resolved in favour of
`index.html`, with no per-page override field, because removing that drift is the point of the
project. Two are known and become documented parity exceptions (§15): the stats order (the CV
will follow the home page: Years, Countries, Projects) and the "Surveying & Mapping" description
(the CV gains the words "geospatial data collection" the home page already has). JSON-LD values
that have no other home get a field (`schoolShort`, `keywords`); `worksFor` is derived from the
company marked `current`.

## 9. Build: `src/build.mjs`

Plain Node 22, ES modules, no bundler, no templating library.

1. Read `content/site.json`, validate against the shape above (fail the build with a clear
   message naming the path, e.g. `experience.companies[2].projects[0].bullets[3].text is empty`).
2. Compute `years = yearsOfExperience(site.experienceStart, today)` where `today` is the UTC
   date; full years elapsed (17 on 2026-10-20, 18 on 2027-09-23).
3. Resolve placeholders and rich text through `html.mjs`. The `html` tag escapes every
   interpolated value; `raw()` marks pre-rendered fragments (icons, rich text output) as trusted.
4. Render the four pages with the templates in `assets/js/render/`. The templates reproduce
   today's markup class-for-class, including comments that matter for nothing (dropped) and
   inline `onclick` handlers (kept, so `main.js` keeps working unchanged).
5. Asset versioning: `?v=` becomes the first 8 hex characters of the SHA-1 of each file's
   content (`main.css`, `main.js`, `palette.js`, `access.mjs`, `cv.css`). Nobody bumps numbers by
   hand any more.
6. Copy `assets/`, `vault/`, `admin/`, `CNAME`, `.nojekyll`, `robots.txt` into `dist/`.
   `robots.txt` disallows `/admin/` and `/vault/`. `admin/index.html` also carries
   `<meta name="robots" content="noindex">`.
7. Years safety net: every rendered occurrence of the number (about numbers, experience intro,
   bio, CV stats) is wrapped as `<span data-years>17</span>`; a 6-line inline script in `head.mjs`
   recomputes the value on load from `data-experience-start` on `<html>`. Meta tags and JSON-LD
   are not patched at runtime; the scheduled rebuild covers them.
8. Write `dist/`. Exit non-zero on any error.

`src/pdf.mjs` then launches puppeteer (bundled Chromium, `--no-sandbox` in CI), opens
`dist/cv.html` through `src/serve.mjs` on a random local port (so Google Fonts load exactly as in
the browser), waits for `document.fonts.ready`, and calls `page.pdf({ preferCSSPageSize: true,
printBackground: true, displayHeaderFooter: false })`. Today's `@page` block (A4, 13mm/16mm
margins, `@bottom-center` footer with page counters) stays **inline in the CV template**, because
its footer text is generated from `profile`; everything else from today's inline CV styles moves
to `cv.css`. Output: `dist/pdf/<cvPdfFilename>`.

`npm run dev` builds, serves `dist/` on port 3004 and rebuilds on changes to `content/`,
`assets/`, `admin/` (Node's `fs.watch`). `.claude/launch.json` in the parent folder gets a
`website-admin` entry for it.

## 10. GitHub Actions workflow: `.github/workflows/site.yml`

```yaml
on:
  push: { branches: [redesign3_admin] }
  schedule: [{ cron: "30 3 24 9 *" }]      # 24 September, 03:30 UTC: years rollover
  workflow_dispatch:
permissions: { contents: read }              # the build job: read the repository, nothing more
concurrency: { group: pages, cancel-in-progress: true }
jobs:
  build:   ubuntu-latest · checkout · setup-node 22 (npm cache) · cache ~/.cache/puppeteer ·
           npm ci · npm test · npm run build · npm run pdf · upload-pages-artifact (dist)
  deploy:  needs build · if: github.ref == 'refs/heads/redesign3_admin' && vars.DEPLOY_FROM_ACTIONS == 'true' ·
           permissions: { pages: write, id-token: write } (its own block) · environment github-pages · deploy-pages
```

The `deploy` job is gated twice: by the branch name, so a scratch branch such as
`redesign3_admin_test` (also listed under `push.branches` so it gets the build job) can never
deploy, and by the repository variable `DEPLOY_FROM_ACTIONS`, so the branch can be pushed and
tested without touching the live site until cutover (§16). Typical run time: 2 to 3 minutes,
most of it Chromium download on a cache miss.

**Scheduled trigger.** GitHub runs `schedule` triggers only from the repository's default
branch, which is `master` today. The owner decided that `redesign3_admin` becomes the default
branch at cutover (§16 step 4), so the cron above runs as written. Until cutover the scheduled
rebuild simply does not fire, which is harmless.

The dashboard reads this workflow's runs to show progress. A failed build never replaces the
live site; the previous deployment stays up.

## 11. Public site changes

### 11.1 The Access pill

Rendered in the hero contact row directly under WhatsApp, same class `hero-contact-link`, same
grey, with a small key icon and the label "Access". It is a `<button>` so it is keyboard
reachable. States:

| State | Looks like | Click does |
|---|---|---|
| idle | key icon + "Access" | expands to *open* |
| open | key icon + password field (placeholder "Access code", `autocomplete=off`, masked) + grey "Enter" button, inside the same pill; the pill stretches leftwards | Enter key or button submits; Escape or outside click collapses to idle |
| checking | field disabled for the ~1 s key derivation | nothing |
| unlocked (download) | lock-open icon + "Unlocked" | locks again (clears the session, hides icons), back to idle |
| admin | key icon + "Dashboard" | navigates to `/admin/` |

A wrong code: the pill shakes once (CSS keyframes, 300 ms), the field clears, state returns to
idle. No message, as the owner asked.

The pill is the only entry point on the site. `/admin/` has its own identical gate (§13.1) for
direct visits. There is no URL-based unlock.

On phones (the `max-width: 768px` and landscape `max-height: 500px` layouts in `main.css`) the
extra pill adds one row to the stacked contact pills; the builder verifies on 375×667, 390×844
and 800×360 that the name/title block and the contact block still do not overlap (CLAUDE.md
documents that this overlapped before).

### 11.2 Download icons

The index template renders, for every bullet that has files:

```html
<li>Techno-Economic and Flood-Hazard Assessment …
  <span class="proj-files" hidden>
    <a class="proj-dl" href="#" data-file="3f9c…" data-name="Wadi_Majlas_Techno_Economic_Report.pdf"
       data-size="4403211" title="Wadi_Majlas_Techno_Economic_Report.pdf · 4.2 MB" aria-label="Download …">[tray-and-arrow svg]</a>
  </span>
</li>
```

`hidden` is removed only after a valid code. The icon is the tray-and-arrow SVG used by the
Download CV buttons, 13 px, `color: var(--text-2)` at 55 % opacity, full opacity and
`var(--dk)` on hover, pushed to the right end of the bullet with `margin-left: auto` (the `li`
becomes `display: flex`). Several files sit side by side with a 6 px gap; on narrow screens the
group wraps under the text. Bullet text, dash marker, sizes and spacing stay as today.

File names and sizes are present in the HTML (and in `site.json`) even when locked. They are not
secret: the bullet text already names the report. What is protected is the file content.

### 11.3 Unlock flow (`assets/js/access.mjs`, loaded as `type="module"` on `index.html`)

1. On submit, fetch `vault/access.json` with `cache: "no-store"`.
2. Derive the KEK with PBKDF2-SHA-256 from the typed code and the file's salt (§12).
3. Try to unwrap every entry; AES-GCM authentication makes wrong keys fail cleanly.
4. First `admin` entry that opens: store its payload under `sessionStorage["mk.admin"]`, the vault
   key under `sessionStorage["mk.vault"]`, navigate to `/admin/`.
5. First `download` entry that opens: store the vault key under `sessionStorage["mk.vault"]`,
   un-hide every `.proj-files`, switch the pill to *unlocked*.
6. Nothing opens: shake, clear, idle.
7. On every page load, if `sessionStorage["mk.vault"]` exists the icons are shown and the pill
   starts in *unlocked* (or *admin* if `mk.admin` exists). Closing the tab ends the session.

Download click: fetch `vault/files/<id>.bin`, decrypt with the vault key (§12), build a Blob
with the stored MIME type, trigger a download with the stored name. Files up to the GitHub limit
(95 MB enforced by the dashboard) decrypt in memory; a spinner replaces the icon while fetching.

### 11.4 Other pages

`contact.html` and `thank-you.html` are generated but gain nothing visible. `cv.html` and the PDF
show bullets exactly as today, with no icons and no file names; the PDF cannot decrypt.

## 12. Vault: keys, codes and file format (`assets/js/vault.mjs`)

All cryptography is WebCrypto (`crypto.subtle`), available in browsers and Node 22. No library.

Three layers of keys, so that revoking a code can rotate the shared key without re-uploading
a single file:

- **File key** (FK, one per file): 256-bit AES-GCM key generated at upload.
  `vault/files/<id>.bin` = `IV (12 bytes) || AES-256-GCM(FK, IV, plaintext)`. The GCM tag is
  included by WebCrypto. Metadata (name, size, type) lives in `site.json`, not in the blob.
- **Vault key** (VK): 256-bit AES-GCM key, generated by first-run setup and **replaced on every
  revoke**. `vault/keys.json` = `{ "v": 1, "vk": "<8 hex id of the current VK>", "files": { "<file id>":
  { "iv": "<b64>", "key": "<b64 AES-GCM(VK, iv, FK)>" } } }`. VK is never stored unwrapped
  anywhere except `sessionStorage` while a session is open.
- **Code-derived key** (KEK, one per code): wraps VK inside `vault/access.json`, below.
- **Owner key** (OK): 256-bit AES-GCM key, generated by first-run setup, held only in the admin
  payload and **replaced together with VK on every rotation**. It seals every entry's `meta`
  (labels and download codes), so that a download code, which yields VK, reveals nothing about
  the other codes.
- **Codes**: a code is a string the owner types or the dashboard generates (download codes:
  `MK-XXXX-XXXX` from an unambiguous alphabet, ~41 bits; admin code: at least 12 characters from
  at least three character classes, enforced by the dashboard with a strength meter and a
  warning that the code protects the GitHub token).
- **`vault/access.json`**:

  ```jsonc
  {
    "v": 1,
    "kdf": { "name": "PBKDF2", "hash": "SHA-256", "iterations": 600000, "salt": "<base64, 16 bytes>" },
    "entries": [
      { "id": "<8 hex>", "kind": "admin",    "iv": "<b64>", "data": "<b64>", "meta": "<b64>" },
      { "id": "<8 hex>", "kind": "download", "iv": "<b64>", "data": "<b64>", "meta": "<b64>" }
    ]
  }
  ```

  - One site-wide salt, so a typed code costs one PBKDF2 derivation regardless of how many
    entries exist (then one cheap unwrap attempt per entry).
  - `data` = AES-GCM(KEK, iv, payload). Download payload: exactly `{ "vk": "<b64>" }`. Admin payload:
    `{ "vk": "<b64>", "ok": "<b64>", "github": { "token": "…", "owner": "mojikone", "repo": "mojtabakeivanlou", "branch": "redesign3_admin" } }`,
    where `ok` is the owner key (base64 raw), present in the admin payload only.
  - `meta` = AES-GCM(OK, iv', `{ "label": "Hirer — X", "created": "2026-10-20", "code": "MK-…" }`),
    sealed under the owner key held in the admin payload, never under the vault key: the dashboard
    can list labels and show or copy download codes later, while neither the public file nor a
    download code reveals anything about who has access (every download code yields VK, so a meta
    under VK would let any hirer read every other code and label, and use another hirer's code
    after their own was revoked). The admin entry's `meta` never contains the admin code.
  - `kind` is public. It tells an attacker which blob holds the token; it tells the site which
    entry to try first. Acceptable.
- **Revoke** a download code = in one publish: generate a new VK (and a new OK), rewrap every file
  key in `keys.json` and every remaining entry's payload and `meta` in `access.json` under them,
  drop the revoked entry. No file is re-uploaded; the commit carries two small JSON files. Git history
  still holds the old `access.json`, so a revoked hirer who kept their code can recover the
  **old** VK from history and with it every file that existed at revocation time, which they
  could already have downloaded. They can never open a file added after the revoke, because
  new file keys are wrapped only under the new VK. That is the guarantee, stated in the
  dashboard's revoke confirmation in plain words.
- **Change admin code** = rewrap the admin payload under the new KEK, and rotate VK as above
  (the old admin code could otherwise still unwrap the old VK from history). A leaked admin
  code also means a leaked GitHub token: the "change admin code" screen tells the owner to
  revoke the token on GitHub and paste a new one in the same step.
- **Replacing a file** gives it a new id and a new FK; the old blob is deleted from the tree
  (it remains in history, encrypted under a key only old VKs can unwrap).
- **Provision for a plain mode.** The owner may later decide to drop encryption if it proves
  slow (he accepts the exposure). To keep that a small change, every file record in `site.json`
  carries `"enc": true`, and the download path checks it: with `enc: false` the blob at
  `vault/files/<id>.bin` is the raw file and is served to the browser without decryption, while
  icons stay gated by a code. Plain mode is not built in v1; only the flag and the branch in the
  download code are. For reference, WebCrypto AES-GCM handles 100 MB in roughly a second on a
  laptop and a few seconds on a phone; the slow parts are the network and the one-second
  PBKDF2 step, not the cipher.
- **Threat model, stated plainly**: everything in the repo is public, including history, so an
  attacker can try codes offline against any version of `access.json`. At 600 000 PBKDF2
  iterations a 12-character mixed code is far beyond reach; a generated download code is
  reachable only with roughly a decade of GPU time, which does not matter for files the owner
  would email on request anyway. Possession of a VK, current or historical, opens exactly the
  files whose keys were wrapped under it, and no label or code: the metas are sealed under an
  owner-only key (OK) held in the admin payload, which no download code opens. The GitHub token
  is fine-grained and limited to this one repository's contents and Actions metadata; its worst
  case is defacement, reversible from git history.

## 13. The dashboard (`/admin/`)

Static HTML + CSS + vanilla ES modules. No framework, no bundler, no dependencies. Uses the
site's Poppins font and CSS variables (reads `main.css` for tokens) so it feels like the site.
Desktop-first; usable on a tablet; not designed for phones.

### 13.1 Gate

If `sessionStorage["mk.admin"]` is absent, the page shows only a centred Access pill (same
component as the hero) and nothing else. A valid admin code fills the session and reveals the
dashboard. A download code or a wrong code does nothing here except the shake.

### 13.2 First-run setup (when `vault/access.json` is missing or has no admin entry)

Only reachable by opening `/admin/#setup` on the locally served build. A three-step wizard:
paste the GitHub token (field is `type=password`; the token is never echoed) → choose and confirm
the admin code (strength meter) → the page generates the vault key and salt, writes
`vault/access.json` through the GitHub API, and tells the owner to reopen the dashboard with the
code. The token is validated with `GET /repos/{owner}/{repo}` before anything is written. The
wizard also records `owner`, `repo`, `branch` (defaults as above, editable).

### 13.3 Layout

Top bar: name + "Admin", status area ("Live · published 2 min ago · N unpublished changes"),
Preview, Publish, Sign out. Left nav: Profile & contact · Education · Languages · Engineering
services · Experience · Skills & software · Contact page · ─ · Access codes · Files · Settings.
Main area: the selected section. Sections with unpublished changes show a dot and count.

Every list (education, languages, services, companies, projects, bullets, files, tags, project
types, business-card cells, knowsAbout) uses the same pattern: rows with a drag handle (native
HTML drag and drop plus up/down buttons for keyboards), a delete control with an undo toast, and
an "+ Add" at the bottom. Nested lists (companies → projects → bullets → files) are collapsible
and remember what is open.

Section contents:

- **Profile & contact**: names, role title (short and long), hero headline (two lines),
  subtitle, quote, bio (rich text editor: a textarea with **bold**/_italic_ buttons and a live
  preview beneath), CV summary, stats (three rows), email, phone, WhatsApp (derived, read-only
  with an override toggle), LinkedIn, location fields, business card title lines and cells.
- **Education**, **Languages**: simple rows.
- **Engineering services**: intro + rows of icon picker, title, description. The icon picker
  shows the library from `icons.mjs` as a grid.
- **Experience**: intro, then companies (fields as in §8) each holding projects each holding
  bullets. A bullet row is a text field plus a paperclip button showing the file count; files
  list beneath with name, size, "encrypted" badge, replace and remove; "+ Add another file" and a
  drop zone accept several files at once. Allowed: any type, each ≤ 95 MB; a warning appears
  above 25 MB (slow for hirers on phones).
- **Skills & software**: categories, each with tags; each tag has an Expert/Familiar toggle;
  experts render first in both the dashboard and the site.
- **Contact page**: heading, project types list, description placeholder, form subject,
  thank-you heading and text, CTA heading and sub.
- **Access codes**: table (label, kind, code or ••••, created, actions). "+ New download code"
  generates a code and shows it in a copyable field, with a label field. Revoke asks for
  confirmation with the sentence "This person will no longer be able to open any file added
  from now on; files they could already download stay downloadable for them." and rotates the
  vault key (§12) as part of the next publish. "Change admin code" (asks for the current code,
  then the new code twice, then optionally a new token).
- **Files**: every attachment across the site with where it is used; remove; detects orphaned
  `vault/files/*.bin` (in the repo but not referenced) and offers deletion. A gauge shows the
  total size of all attachments against a budget (defaults in §13.9), because each upload
  stays in the public git history forever and GitHub Pages sites are soft-limited at about
  1 GB.
- **Settings**: experience start date, CV PDF filename, SEO fields and knowsAbout list, GA id,
  Web3Forms key, GitHub repo/branch (read-only display), "Replace GitHub token", "Reset draft".

### 13.4 Draft

On open, the dashboard fetches `content/site.json` and `vault/access.json` from the GitHub API
(`GET /repos/{o}/{r}/contents/{path}?ref={branch}`, which also returns each blob SHA) and the
latest commit SHA of the branch. Edits go to a draft in `localStorage["mk.draft"]`: `{ baseCommit,
baseShas, site, access, pendingFiles: [ {id, name, size, type} ], deletedFiles: [id] }`. Pending
file ciphertexts go to IndexedDB (`mk-files` store) because they can be large. The draft survives
closing the browser; the keys do not, so reopening asks for the code again and the draft is
still there. "Reset draft" discards it and reloads from GitHub.

### 13.5 Preview

Opens a modal with an iframe whose `srcdoc` is the rendered page from the draft, using the same
templates as the build, with `<base href="/">` so assets load from the served site. Years are
computed in the browser. A tab switcher offers Home, Contact, Thank you, CV. Download icons are
shown un-hidden in the preview. The PDF is not previewed; the CV tab is close enough.

### 13.6 Publish

1. Validate the draft (same validator as the build; errors are listed with "go to field" links).
   Then check the session's keys: the vault key and owner key must be the ones the session's own
   admin entry in the draft holds (opened with the session's KEK); otherwise nothing is committed
   ("session vault key does not match the vault"), because an attachment wrapped under a stale key
   could never be decrypted. The dashboard also adopts those keys each time the draft loads, and
   signs out ("Your sign-in is out of date") when the entry no longer opens.
2. Conflict check: fetch the current `content/site.json` SHA; if it differs from `baseShas`,
   show a modal: "The site content changed on GitHub since you loaded it (probably a code
   update). Reload and reapply? / Overwrite with my draft". The same for `access.json`.
3. One commit via the Git Data API: get the branch head → create blobs for `content/site.json`,
   `vault/access.json` (if changed) and every pending file (base64) → create a tree on top of the
   head tree with those paths, and `sha: null` for deleted files that the head tree still holds
   (GitHub refuses a tree that deletes a missing path) → create the commit (message
   "Content update from dashboard: <sections changed>") → update `refs/heads/<branch>` with the
   head SHA as the expected parent (the update fails if someone pushed meanwhile; then go back to
   step 2). When the commit rotated the vault, the session takes the new vault key and owner key
   the moment the ref update succeeds, not after the build. A 401 or 403 before the commit opens
   "Replace GitHub token" (§13.7), and the publish runs again with the new token.
4. Show the progress toast: "Saved to GitHub ✓" → poll
   `GET /repos/{o}/{r}/actions/runs?branch=<branch>&event=push&per_page=1` every 10 s until the
   run for that commit SHA concludes → "Building pages & PDF" → "Live on mojtabakeivanlou.com"
   with a link, or the run's URL on failure. A run concluded `cancelled` means a newer push
   superseded it (the workflow cancels in-progress runs): the dashboard then follows the newest
   run on the branch instead. Then clear the draft and refetch the base.
5. The status area's "published N min ago" comes from the last successful run's timestamp.

### 13.7 Token lifecycle

The fine-grained token needs, on this one repository: Contents read and write, Actions read,
Metadata read (implicit). Any 401 or 403 from GitHub opens "Replace GitHub token": the owner
pastes a new one, the dashboard rewraps the admin payload and commits `access.json` (that commit
is made with the new token). Settings shows a free-text "token expires on" note the owner fills
in, because the API does not expose it.

### 13.8 Sign out

Clears `sessionStorage` keys `mk.admin` and `mk.vault` and returns to the gate. The draft stays.

### 13.9 File size limits

The owner expects reports of up to about 100 MB and asked for no limit below GitHub's own. So:
a file is refused only above 100 MB, GitHub's hard per-file limit; above 50 MB the dashboard
shows a note that the upload is a 130 MB request and the download is slow on phones. The Files
gauge shows the total of all attachments and turns amber at 700 MB and red at 900 MB, because
the public repo and the Pages site both degrade near 1 GB and history never shrinks; the owner
manages the budget himself. The numbers are constants in one place. The upload path must
stream: read the file, encrypt, base64-encode and send without holding more than about three
copies in memory, and report a failed blob upload (GitHub may reject very large bodies) with
the file name so the owner can compress or split it.

## 14. SEO and head

`head.mjs` generates per page: `<title>`, description, canonical, Open Graph, Twitter card,
`theme-color`, favicon (the inline SVG favicon stays; `palette.js` repaints it), Google Fonts
links, GA tag, the synchronous `palette.js` include, and JSON-LD. The rule for JSON-LD is:
reproduce today's structure exactly, nothing added and nothing dropped, with every value
sourced from `site.json`. Today's home-page Person schema uses `profile` (name, jobTitle,
description, address, sameAs, image), `education` → `alumniOf` (via `schoolShort`),
`services` → `hasOfferCatalog` with each offer's `serviceType` list (via `keywords`), the
`current` company → `worksFor`, and `seo.knowsAbout`. The CV page keeps its `ProfilePage`
wrapper around the same Person. The parity test (§15) catches anything dropped.

## 15. Migration and parity

1. `scripts/extract-content.mjs` parses the four pages from commit `1de3ce8` and writes the first
   `content/site.json`. It is a one-time tool, kept in the repo for reference, and its output is
   reviewed by hand.
2. Parity test (`test/parity.test.mjs`): builds the pages from that `site.json` with `today`
   fixed to a date that yields 16 years (any date between 2025-09-23 and 2026-09-22), then
   compares each built page to the fixture copy of the original page after normalisation:
   collapse whitespace between tags, sort attributes, ignore `?v=` values, drop HTML comments,
   remove the Access pill `<button>` and every `.proj-files` span from the built output. The test
   must pass with zero differences for `index.html`, `contact.html` and `thank-you.html`, and
   with exactly the two listed exceptions for `cv.html` (stats order; the "Surveying & Mapping"
   wording, §8), which the test encodes explicitly so any third difference fails. It stays in
   the suite as a regression guard for the template markup.
3. The first dashboard publish must not change any rendered page except through the content the
   owner edits.

## 16. Cutover plan

1. Develop and test on `redesign3_admin`; pushes run the workflow's build job only.
2. First-run setup from the locally served build (§13.2) creates `vault/access.json` on the
   branch. The owner creates the fine-grained token on GitHub himself and pastes it into the
   wizard; the assistant never handles it.
3. Owner checks the local preview and the dashboard end to end (edit, attach, publish to a
   scratch branch `redesign3_admin_test` if desired, which the wizard's branch field allows).
4. Cutover, done by the owner in the GitHub web UI, about two minutes, in this order (as in
   CLAUDE.md):
   - Settings → General → Default branch → `redesign3_admin` (owner's decision; needed for the
     yearly scheduled rebuild, §10). Before the Pages source: switching the source to GitHub
     Actions limits the `github-pages` environment to the default branch of that moment.
   - Settings → Pages → Build and deployment → Source: **GitHub Actions**.
   - Settings → Secrets and variables → Actions → Variables → `DEPLOY_FROM_ACTIONS` = `true`.
   - Settings → Environments → `github-pages` → Deployment branches and tags: `redesign3_admin`
     must be allowed.
   - Re-run the latest workflow (or push). The first Actions deployment replaces the branch
     deployment; the custom domain and HTTPS settings are untouched.
5. Keep `redesign3_colors_firebase` as the rollback. Rollback = Source back to "Deploy from a
   branch", branch `redesign3_colors_firebase`; set `DEPLOY_FROM_ACTIONS` to `false`; and check
   that the `github-pages` environment still allows `redesign3_colors_firebase` (add it if not).
6. After a week of normal use, the owner may create the usual `V<n>_` backup branch of the
   admin branch and delete the obsolete `CV/cv.html` master in the parent folder.

## 17. Testing

- `npm test` runs `node --test test/`. No test framework or extra dependencies.
- Unit: `years.mjs` (boundaries on 22/23 September, leap years), `html.mjs` (escaping, rich text,
  placeholders, no raw HTML leakage), `vault.mjs` (encrypt/decrypt roundtrip, wrong-code
  failure, wrap/unwrap, `access.json` roundtrip), validator (every required field, slug
  uniqueness, file id format, ordering of expert/familiar), build (asset hashing, `data-years`
  spans, robots, copied files), dashboard pure modules (draft reducer, commit tree builder
  against a fake `fetch`, conflict detection, phone/WhatsApp derivation, slug generation).
- Parity (§15).
- PDF smoke: `pdf.mjs` produces a file > 50 kB with ≥ 2 pages (checked by counting `/Type /Page`
  objects), run in CI; locally optional.
- Manual checklist before cutover, recorded in the PR: pill states on desktop and phone, wrong
  code, download code with one and several files, admin code opens dashboard, each section
  edit, publish, deploy, live check, PDF opens with page numbers, palette switcher still works,
  contact form still submits, GA tag present, Search Console unaffected.

## 18. Security notes for the builder

- Escape by default; the only `raw()` inputs are icons from `icons.mjs` and the output of the
  rich-text renderer, which itself escapes before converting markers.
- Never log, display or persist the token or the vault key outside `sessionStorage`; never put
  either in a URL, a commit message or an error report.
- The dashboard and the site are the same origin on purpose (shared `sessionStorage`,
  `localStorage`, IndexedDB). Do not move the dashboard to another host.
- `access.json` is fetched with `cache: "no-store"`; GitHub Pages' 10-minute cache would
  otherwise delay a revoke.
- Validate file ids with `^[0-9a-f]{32}$` before building any path.

## 19. Left to the builder

- Exact split of `admin.mjs` into modules, the look of the dashboard beyond the mockups (which
  are the reference: dark green top bar, light sidebar, white cards, lime accents), toast and
  modal styling, keyboard shortcuts. The approved mockups are copied into
  `docs/superpowers/mockups/` on this branch so the reference lives in the repo.
- Which existing SVGs become named icons and their names.
- Whether `src/serve.mjs` is a hand-written 40-line server or `npx serve` for local preview.
- How the drag-and-drop ordering is implemented, as long as keyboard reordering exists too.
- The parity normaliser's details, as long as the test is strict enough to catch a dropped
  attribute or a changed class.

## 20. Decisions the owner made in the brainstorm (for the record)

- Option 2: repo as the content store, static build, one to two minutes delay accepted.
- Firebase kept for the palette only; nothing else uses it on the new branch.
- Repo stays public; reports encrypted; access codes, no sign-in for hirers.
- Access pill under WhatsApp, grey, code field inside the pill with a grey Enter button; admin
  code opens the dashboard; invalid code does nothing visible; download code reveals icons only.
- Download icon = the Download CV tray-and-arrow, light grey, at the right end of the bullet,
  only on bullets with files; several files = several icons.
- Experts before familiars within each skills category.
- Draft on device, one Publish button.
- Years of experience from 23 September 2009.
- `redesign3_admin` becomes the repository's default branch at cutover.
- No file size limit below GitHub's 100 MB; the owner manages the 1 GB Pages budget himself.
- Encryption stays unless the owner finds it slow in practice; a plain mode is provisioned for,
  not built.
