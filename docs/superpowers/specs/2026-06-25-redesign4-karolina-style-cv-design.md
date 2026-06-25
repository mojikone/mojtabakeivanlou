# Redesign4 Karolina-Style CV Design

## Purpose

Build Mojtaba Keivanlou's personal CV/consulting website as a React/Vite site
for GitHub Pages, using the content and assets from
`mojikone/mojtabakeivanlou`, branch `claude/personal-website-redesign-cvgdai`,
while matching the visual language of `karolinahess.com`.

The reference site is a style contract, not a content source. The implementation
must query the reference before coding each major section or effect, then apply
the observed styling, spacing, typography, motion, and responsive behavior to
Mojtaba's own content.

## Source Material

Use the `claude/personal-website-redesign-cvgdai` branch as the content source:

- Detailed professional profile and positioning.
- Engineering services and the nine selected SVG service icons.
- Work history, project history, expandable project details, and education.
- Skills/software groups.
- Contact details, LinkedIn, WhatsApp, PDF CV, and form/thank-you content.
- Assets including `hydraulic-illustration.webp`, dam/drone artwork, profile
  image, `hero-project.jpg`, and the CV PDF.

Use the local workspace hero image:

- `Data/image/Hero/Mojtaba Hero.png`

## Reference Constraints

The implementation must follow the Karolina Hess reference closely:

- Palette: `#1a5241`, `#18231d`, `#bfdb39`, `#fafafa`, `#e9e8e8`,
  `#5c5c5c`, and `#c2c2c2`.
- Typography: Neue Montreal Regular/Medium feel for display and body text,
  Inter-style small UI labels where appropriate.
- Desktop display type should preserve the reference's very large editorial
  scale, tight line-height, and sparse composition.
- Motion should use staged Framer-like reveals with 0.4s to 0.8s tweens,
  light springs, and staggered delays matching the observed reference rhythm.
- The site must be checked at desktop, tablet, and mobile breakpoints against
  the reference before completion.

Do not copy the reference site's text, imagery, generated Framer bundle, or
proprietary assets into the deployable project.

## Structure

Create a React/Vite app on branch `redesign4`.

Primary sections:

1. Hero
2. Services / What I Do
3. About / Profile
4. Selected Work / Experience
5. Technical Toolkit
6. Contact / Footer
7. Contact form and thank-you route/page if retained from the current branch

The section order may follow the reference's emotional rhythm more than a
traditional CV order: strong hero, compact navigation, large editorial section
titles, content blocks with generous spacing, and a large closing contact
section.

## Hero

Use `Mojtaba Hero.png` as the primary visual.

Hero image rules:

- The image must be anchored to the left edge on all screen sizes.
- The arm touching the left edge must remain clipped offscreen.
- The portrait must remain visible on mobile, tablet, and desktop.
- Do not center-crop the portrait into a circular frame.
- The name, job title, and subtitle must be arranged around the fixed left
  image constraint.

Hero copy:

- Name: Mojtaba Keivanlou.
- Role/title from the content branch: Principal Hydraulic & Water Resources
  Engineer / Team Leader.
- Subtitle/tagline should use the branch's positioning, such as turning complex
  water systems into engineered certainty, but set in the reference's sparse
  editorial style.

## Navigation

Replace the existing full-width nav with a Karolina-style pill nav.

Requirements:

- Pill nav must be visible at all screen sizes.
- On small screens, reduce font size, gap, and padding before removing content.
- Do not use a hamburger menu unless explicitly requested later.
- Use compact labels such as Home, Work, About, Services, Contact if needed.
- Match reference-style pill behavior, hover/active states, and entrance motion.

## Services And Icons

Preserve the selected SVG icons and service categories from the content branch:

- Flood Modelling & Protection
- Road & Drainage Design
- Hydrology & Climate Analysis
- Dam Engineering
- Stormwater & Sewage Networks
- Water Supply & Irrigation
- GIS & Spatial Analysis
- Surveying & Mapping
- Engineering Automation

Restyle these into the reference system. Icons should be reduced, clean, and
treated as accent details rather than heavy card decoration.

## Artwork

`hydraulic-illustration.webp` is line artwork and must be placed on white,
off-white, or similarly light backgrounds so it remains clearly visible.

Acceptable backgrounds:

- `#fafafa`
- `#e9e8e8`
- very pale neutral variants aligned with the reference palette

Do not place this illustration directly on dark green/ink sections unless it is
inside a dedicated light panel.

## Experience And Projects

Use the detailed career history from the content branch. Keep the project depth,
but present it in a style closer to the reference:

- Large "Recent works" / "Selected work" style section title.
- Editorial project blocks rather than dense resume cards where possible.
- Progressive disclosure for full project details is allowed.
- Preserve important quantitative details: 16+ years, 3 countries, 50+ projects,
  Batinah 15,000 km², OMR 6M / USD 15.6M, and major project scopes.

## Contact

Close with a large reference-style contact section:

- Big "Let's work together" treatment.
- Email, phone, WhatsApp, LinkedIn, CV download.
- Contact form can remain as a route/page if it fits the final architecture.

## Technical Architecture

- Use React and Vite.
- Configure GitHub Pages deployment.
- Preserve `CNAME` for the custom domain.
- Preserve PDF CV and reusable assets.
- Use structured data from local constants/modules rather than hardcoding large
  repeated markup into components.
- Use CSS modules or plain CSS organized by component/section, following a
  consistent token system.
- Use a small intersection observer helper for reveal animations.
- Avoid adding heavy animation libraries unless reference parity cannot be
  reached with CSS and lightweight React.

## Responsiveness

Reference breakpoints observed around:

- Desktop: 1200px and above.
- Tablet: 810px to 1199px.
- Mobile: below 810px.

The implementation must explicitly verify:

- Desktop hero composition with left-clipped portrait.
- Mobile hero composition with portrait still visible and clipped correctly.
- Pill nav remains visible and legible at mobile widths.
- No text overlaps or spills from controls.
- `hydraulic-illustration.webp` remains legible on light backgrounds.

## Verification

Before claiming implementation is complete:

- Query the reference for the relevant section/effect.
- Run the local Vite build.
- Run the site locally.
- Use browser verification at desktop and mobile widths.
- Compare screenshots or measured layout against the reference behavior.
- Confirm GitHub Pages build settings and routing.

## Non-Goals

- Do not publish an identical copy of Karolina Hess's site.
- Do not include reference site source code in the deployable project.
- Do not hide the pill navigation on mobile.
- Do not use the old dark blue/gold visual system from the current branch as
  the primary presentation.
- Do not place the line artwork on dark backgrounds without a light panel.
