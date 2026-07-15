# CLAUDE.md — redesign3 branch

Personal portfolio site for Mojtaba Keivanlou, deployed on GitHub Pages from `redesign3` branch at `mojikone/mojtabakeivanlou`. Three pages: `index.html`, `contact.html`, `thank-you.html`.

---

## Design System

| Token | Value |
|---|---|
| Background dark | `#141414` |
| Background light | `#EBEAE4` |
| Lime accent | `#A8CE2E` |
| Font | Poppins (200–700) from Google Fonts |
| CSS file | `assets/css/main.css` — cache-busted with `?v=N` query param |
| JS file | `assets/js/main.js` — cache-busted with `?v=N` query param |

**Always bump `?v=N`** on both files after any change, or browsers serve stale cache.

---

## Architecture

### Scroll-over hero effect
`section.hero` has `position: sticky; top: 0; z-index: 0`. All subsequent sections use `position: relative; z-index: 1`, so they scroll over the top of the hero. This is the core visual mechanic of the page.

### Hero photo
File: `assets/img/mojtaba-gray2.webp` (1280×1378 px, ~93 KB, grayscale).  
Positioning formula uses `svh` units so the subject stays centred regardless of viewport width:
- Desktop: `left: calc(80px - 58svh)`
- Mobile: `left: calc(80px - 45svh)`

### Pill nav
`position: fixed; bottom: 28px` on desktop (hidden above 860px); shown at `bottom: 16px` on mobile (`max-width: 768px`).  
Active state: scroll listener calls `getBoundingClientRect().top <= 10` on each `section[id]`. Works correctly for the sticky hero because it reads visual position, not `offsetTop`.  
Smooth scroll: `a[href="#home"]` always calls `smoothTo(0)` explicitly (sticky elements report `getBoundingClientRect().top = 0` at all scroll positions, making `offsetTop`-based scroll a no-op).

### Topbar
**Removed entirely from `index.html`.** Still present on `contact.html` and `thank-you.html` (absolute-positioned, not fixed).

---

## Pages

### index.html (current versions: CSS v17, JS v4)
Sections in order: `#home`, `#about`, `#expertise`, `#experience`, `#skills`, `#contact`.

**#home — Hero**
- Name overlaid top-left (desktop) / top-right column (mobile)
- Large role headline center-right (desktop) / right column (mobile)
- Contact pills (email, phone, WhatsApp) + action buttons (Start a Project, Download CV) bottom-right
- WhatsApp: JS UA-detects mobile → `wa.me/...`; desktop → `web.whatsapp.com/send?phone=...`

**#about**
- Title: "Senior Hydraulic and Water Resources Engineer"
- Subtitle: "Team Leader"
- No inline contact links

**#expertise**
- SVG icons (not numbers) on each card
- Reduced title size

**#experience**
- No sidebar — full-width layout
- Expanded projects show left lime border

**#skills**
- Outlined tag pills (no fill background)
- High-proficiency tags bold

**#contact**
- No photo
- Flip business card with QR code (click to flip; JS toggles `.flipped` class on `#biz-card-main`)
- QR URL: `https://api.qrserver.com/v1/create-qr-code/?size=64x64&data=https://mojtabakeivanlou.com`
- No footer (removed from all pages)

### contact.html
Standard contact form. Topbar retained (absolute). Footer removed.

### thank-you.html
Post-form confirmation. Topbar retained. No footer.

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
