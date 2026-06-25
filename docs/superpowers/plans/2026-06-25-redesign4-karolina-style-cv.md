# Redesign4 Karolina-Style CV Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Mojtaba Keivanlou's website as a React/Vite GitHub Pages site using Mojtaba's content and assets with a Karolina Hess-style visual system.

**Architecture:** Create a Vite React app that renders data-driven sections from typed content modules. Keep the Karolina reference as a local-only styling source, preserve contact and thank-you routes, and verify desktop/mobile visual parity with browser checks before completion.

**Tech Stack:** React, Vite, TypeScript, CSS, Vitest, Testing Library, Playwright, GitHub Pages.

## Global Constraints

- Work on branch `redesign4`.
- Use content and assets from `mojikone/mojtabakeivanlou`, branch `claude/personal-website-redesign-cvgdai`.
- Query `https://karolinahess.com/` before implementing each major section or effect.
- Do not copy Karolina Hess text, images, generated Framer bundles, or proprietary assets into the deployable project.
- Use Karolina palette values: `#1a5241`, `#18231d`, `#bfdb39`, `#fafafa`, `#e9e8e8`, `#5c5c5c`, `#c2c2c2`.
- Use a Neue Montreal-style primary typeface and Inter-style UI labels.
- Use `Data/image/Hero/Mojtaba Hero.png` as the hero portrait.
- Hero portrait must stay left-anchored and clipped offscreen at every breakpoint.
- Pill nav must remain visible on every screen size; shrink labels, gaps, and padding before hiding content.
- Do not include a "Selected Work" section in this version.
- Keep the contact form route/page.
- Keep the thank-you route/page.
- Place `hydraulic-illustration.webp` only on white/off-white/light backgrounds or inside a light panel.
- Preserve `CNAME`, PDF CV, SEO metadata, and structured person data.

---

## File Structure

- Create `package.json`: scripts, dependencies, dev dependencies.
- Create `vite.config.ts`: React plugin and GitHub Pages-safe build config.
- Create `tsconfig.json`, `tsconfig.node.json`: TypeScript settings.
- Create `index.html`: Vite shell and SEO baseline.
- Create `.github/workflows/pages.yml`: GitHub Pages deployment.
- Create `src/main.tsx`: React entry point.
- Create `src/App.tsx`: route selection for `/`, `/contact`, and `/thank-you`.
- Create `src/styles/tokens.css`: palette, fonts, motion, breakpoints.
- Create `src/styles/global.css`: reset and global layout rules.
- Create `src/data/profile.ts`: profile, contact, stats, education, skills.
- Create `src/data/services.tsx`: nine services and their selected SVG icons.
- Create `src/data/experience.ts`: career and project history.
- Create `src/components/PillNav.tsx`: all-size pill navigation.
- Create `src/components/Hero.tsx`: left-clipped hero portrait and headline.
- Create `src/components/Services.tsx`: service section.
- Create `src/components/About.tsx`: profile plus light artwork treatment.
- Create `src/components/Experience.tsx`: career/project disclosure section.
- Create `src/components/Skills.tsx`: technical toolkit.
- Create `src/components/ContactCTA.tsx`: closing contact section.
- Create `src/components/ContactPage.tsx`: Web3Forms form and business cards.
- Create `src/components/ThankYouPage.tsx`: thank-you route.
- Create `src/components/BusinessCards.tsx`: responsive business card front/back.
- Create `src/hooks/useReveal.ts`: intersection reveal helper.
- Create `src/__tests__/content.test.ts`: content integrity tests.
- Create `src/__tests__/routing.test.tsx`: route rendering tests.
- Create `tests/visual.spec.ts`: Playwright visual/DOM smoke tests.
- Copy existing deploy assets into `public/assets/img/` and `public/pdf/`.
- Copy `Data/image/Hero/Mojtaba Hero.png` into `public/assets/img/mojtaba-hero.png`.

---

### Task 1: Scaffold Vite React App And Preserve Assets

**Files:**
- Create: `package.json`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/styles/tokens.css`
- Create: `src/styles/global.css`
- Create: `.github/workflows/pages.yml`
- Modify: `CNAME`
- Copy: `assets/img/*` to `public/assets/img/`
- Copy: `pdf/CV_Mojtaba_Keivanlou_2026.pdf` to `public/pdf/CV_Mojtaba_Keivanlou_2026.pdf`
- Copy: `../Data/image/Hero/Mojtaba Hero.png` to `public/assets/img/mojtaba-hero.png`

**Interfaces:**
- Produces: Vite app shell with route rendering from `App`.
- Produces: public asset paths `/assets/img/mojtaba-hero.png`, `/assets/img/hydraulic-illustration.webp`, `/pdf/CV_Mojtaba_Keivanlou_2026.pdf`.

- [ ] **Step 1: Query the reference shell**

Run: `Invoke-WebRequest -Uri 'https://karolinahess.com' -UseBasicParsing | Select-Object -ExpandProperty Content | Select-String -Pattern 'Neue Montreal|--token|__framer__breakpoints|__framer__appearAnimationsContent'`

Expected: Output includes font declarations, token colors, breakpoint metadata, and appear animation metadata.

- [ ] **Step 2: Create Vite dependencies**

Write `package.json`:

```json
{
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "build": "tsc -b && vite build",
    "preview": "vite preview --host 127.0.0.1",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@vitejs/plugin-react": "^4.3.4",
    "vite": "^6.0.0",
    "typescript": "^5.6.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.0",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "jsdom": "^25.0.1",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 3: Create Vite config**

Write `vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/",
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts"
  }
});
```

- [ ] **Step 4: Create TypeScript configs**

Write `tsconfig.json` and `tsconfig.node.json` using Vite React TypeScript defaults with `jsx: "react-jsx"`, `strict: true`, and `moduleResolution: "bundler"`.

- [ ] **Step 5: Create app shell**

Write `src/App.tsx`:

```tsx
import "./styles/tokens.css";
import "./styles/global.css";

export function App() {
  const path = window.location.pathname.replace(/\/$/, "") || "/";

  if (path === "/contact" || path === "/contact.html") {
    return <main data-route="contact">Contact route shell</main>;
  }

  if (path === "/thank-you" || path === "/thank-you.html") {
    return <main data-route="thank-you">Thank you route shell</main>;
  }

  return <main data-route="home">Home route shell</main>;
}
```

- [ ] **Step 6: Create React entry**

Write `src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 7: Copy assets**

Run:

```powershell
New-Item -ItemType Directory -Force public/assets/img, public/pdf
Copy-Item assets/img/* public/assets/img/ -Force
Copy-Item pdf/CV_Mojtaba_Keivanlou_2026.pdf public/pdf/CV_Mojtaba_Keivanlou_2026.pdf -Force
Copy-Item '..\Data\image\Hero\Mojtaba Hero.png' public/assets/img/mojtaba-hero.png -Force
```

Expected: `public/assets/img/mojtaba-hero.png` exists.

- [ ] **Step 8: Add Pages workflow**

Write `.github/workflows/pages.yml` with checkout, setup-node, `npm ci`, `npm run build`, upload `dist`, and deploy Pages.

- [ ] **Step 9: Install and verify build**

Run: `npm install`

Run: `npm run build`

Expected: TypeScript and Vite build exit with code 0.

- [ ] **Step 10: Commit**

Run:

```bash
git add package.json package-lock.json vite.config.ts tsconfig.json tsconfig.node.json index.html src .github public
git commit -m "chore: scaffold react vite site"
```

---

### Task 2: Extract Data Modules From Existing Content

**Files:**
- Create: `src/data/profile.ts`
- Create: `src/data/services.tsx`
- Create: `src/data/experience.ts`
- Create: `src/__tests__/content.test.ts`

**Interfaces:**
- Produces: `profile`, `services`, `experience`, `skills`, and `education` named exports.
- Consumes: content from existing `index.html` and `contact.html`.

- [ ] **Step 1: Write content integrity tests**

Write `src/__tests__/content.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { profile, skills, education } from "../data/profile";
import { services } from "../data/services";
import { experience } from "../data/experience";

describe("site content", () => {
  it("contains Mojtaba's core profile and contact details", () => {
    expect(profile.name).toBe("Mojtaba Keivanlou");
    expect(profile.email).toBe("keyvanlu.m@gmail.com");
    expect(profile.phoneDisplay).toBe("+968 9297 0635");
    expect(profile.location).toBe("Muscat, Oman");
  });

  it("keeps the nine selected service icons and labels", () => {
    expect(services.map((service) => service.title)).toEqual([
      "Flood Modelling & Protection",
      "Road & Drainage Design",
      "Hydrology & Climate Analysis",
      "Dam Engineering",
      "Stormwater & Sewage Networks",
      "Water Supply & Irrigation",
      "GIS & Spatial Analysis",
      "Surveying & Mapping",
      "Engineering Automation"
    ]);
  });

  it("keeps detailed career and technical content", () => {
    expect(experience[0].company).toBe("Renardet S.A. & Partners");
    expect(experience[0].projects[0].name).toContain("Batinah Flood Protection");
    expect(skills.some((group) => group.items.includes("HEC-RAS 1D/2D"))).toBe(true);
    expect(education).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/content.test.ts`

Expected: FAIL because `src/data/profile.ts`, `src/data/services.tsx`, and `src/data/experience.ts` do not exist.

- [ ] **Step 3: Create profile data**

Write `src/data/profile.ts` with `profile`, `stats`, `education`, `skills`, and `contactForm` exports. Include:

```ts
export const profile = {
  name: "Mojtaba Keivanlou",
  title: "Principal Hydraulic & Water Resources Engineer",
  subtitle: "Team Leader",
  tagline: "Turning complex water systems into engineered certainty",
  email: "keyvanlu.m@gmail.com",
  phoneDisplay: "+968 9297 0635",
  phoneHref: "tel:+96892970635",
  whatsappHref: "https://wa.me/96892970635",
  linkedinHref: "https://linkedin.com/in/MojtabaKeivanlou",
  location: "Muscat, Oman",
  cvHref: "/pdf/CV_Mojtaba_Keivanlou_2026.pdf"
} as const;
```

- [ ] **Step 4: Create services with selected SVG icons**

Write `src/data/services.tsx` and paste the nine SVG icons from the source branch as React JSX nodes. Each object must have `{ title, description, icon }`.

- [ ] **Step 5: Create experience data**

Write `src/data/experience.ts` with company, period, role, location, summary, and project arrays from the source branch. Include Renardet, DuBois & King, Sazeh Pardazi Iran, Hydrotech Toos, and Earlier Positions.

- [ ] **Step 6: Run data tests**

Run: `npm test -- src/__tests__/content.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/data src/__tests__/content.test.ts
git commit -m "feat: extract site content data"
```

---

### Task 3: Implement Tokens, Global Styles, And Reveal Motion

**Files:**
- Modify: `src/styles/tokens.css`
- Modify: `src/styles/global.css`
- Create: `src/hooks/useReveal.ts`
- Create: `src/test/setup.ts`

**Interfaces:**
- Produces: CSS variables used by all components.
- Produces: `useReveal<T extends HTMLElement>()` returning `React.RefObject<T | null>`.

- [ ] **Step 1: Query reference tokens and motion**

Run: `Invoke-WebRequest -Uri 'https://karolinahess.com' -UseBasicParsing | Select-Object -ExpandProperty Content | Select-String -Pattern '#1a5241|#bfdb39|Neue Montreal|transition|duration|ease'`

Expected: Output includes the known palette, fonts, and animation declarations.

- [ ] **Step 2: Write a route shell test**

Write a small test in `src/__tests__/routing.test.tsx` that renders `<App />` and verifies the home, contact, and thank-you route shells still render after style imports.

- [ ] **Step 3: Implement tokens**

Write `src/styles/tokens.css` with:

```css
:root {
  --color-green: #1a5241;
  --color-ink: #18231d;
  --color-lime: #bfdb39;
  --color-paper: #fafafa;
  --color-mist: #e9e8e8;
  --color-gray: #5c5c5c;
  --color-soft: #c2c2c2;
  --font-display: "Neue Montreal", "Inter", system-ui, sans-serif;
  --font-ui: "Inter", system-ui, sans-serif;
  --ease-framer: cubic-bezier(0.53, 0, 0.44, 1);
  --ease-snap: cubic-bezier(0.67, 0, 0.39, 1);
  --bp-mobile: 810px;
  --bp-desktop: 1200px;
}
```

- [ ] **Step 4: Implement global reset and reveal classes**

Write `src/styles/global.css` with reset, body background, smooth scroll, `.reveal`, `.reveal.in`, `.section`, `.section-title`, and reduced-motion overrides.

- [ ] **Step 5: Implement reveal hook**

Write `src/hooks/useReveal.ts`:

```ts
import { useEffect, useRef } from "react";

export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          node.classList.add("in");
          observer.disconnect();
        }
      },
      { threshold: 0.12 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return ref;
}
```

- [ ] **Step 6: Run tests and build**

Run: `npm test`

Run: `npm run build`

Expected: both exit with code 0.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/styles src/hooks src/test src/__tests__
git commit -m "feat: add visual tokens and reveal motion"
```

---

### Task 4: Build Home Page Sections Without Selected Work

**Files:**
- Modify: `src/App.tsx`
- Create: `src/components/PillNav.tsx`
- Create: `src/components/Hero.tsx`
- Create: `src/components/Services.tsx`
- Create: `src/components/About.tsx`
- Create: `src/components/Experience.tsx`
- Create: `src/components/Skills.tsx`
- Create: `src/components/ContactCTA.tsx`
- Modify: `src/__tests__/routing.test.tsx`

**Interfaces:**
- Consumes: `profile`, `services`, `experience`, `skills`, `education`.
- Produces: `HomePage` composition inside `App`.

- [ ] **Step 1: Query reference hero, pill nav, and mobile layout**

Use browser inspection on `https://karolinahess.com/` at `1280x720` and `390x844`. Record hero font sizes, pill nav placement, and right-side quick info behavior in `_local-reference/karolinahess-reference-notes.md`.

- [ ] **Step 2: Write route tests**

Extend `src/__tests__/routing.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../App";

describe("home page", () => {
  it("renders required sections and omits selected work", () => {
    window.history.pushState({}, "", "/");
    render(<App />);
    expect(screen.getByText("Mojtaba Keivanlou")).toBeInTheDocument();
    expect(screen.getByText("Engineering Services")).toBeInTheDocument();
    expect(screen.getByText("Experience")).toBeInTheDocument();
    expect(screen.queryByText("Selected Work")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/__tests__/routing.test.tsx`

Expected: FAIL because home components are not implemented.

- [ ] **Step 4: Implement `PillNav`**

Create a visible all-size pill nav with Home, Services, About, Experience, Skills, Contact. CSS must use reduced padding and smaller font sizes under `810px`, not `display:none`.

- [ ] **Step 5: Implement `Hero`**

Use `/assets/img/mojtaba-hero.png` in an absolutely positioned left visual layer:

```tsx
<div className="hero-portrait" aria-hidden="true">
  <img src="/assets/img/mojtaba-hero.png" alt="" />
</div>
```

CSS must anchor it with `left: min(-8vw, -42px)` on desktop and keep negative left offset on mobile so the arm remains clipped.

- [ ] **Step 6: Implement `Services`**

Render the nine services from `services`. Use icons as thin lime details and avoid heavy card styling.

- [ ] **Step 7: Implement `About`**

Place `/assets/img/hydraulic-illustration.webp` inside a light `#fafafa` or `#e9e8e8` band. Verify no dark background sits behind the line artwork.

- [ ] **Step 8: Implement `Experience`**

Render career history and project disclosure buttons. Use an editorial career title, not "Selected Work".

- [ ] **Step 9: Implement `Skills` and `ContactCTA`**

Render technical toolkit groups and closing contact CTA with email, phone, WhatsApp, LinkedIn, and CV download.

- [ ] **Step 10: Wire home page in `App`**

Replace the home route shell with `PillNav`, `Hero`, `Services`, `About`, `Experience`, `Skills`, and `ContactCTA`.

- [ ] **Step 11: Run tests and build**

Run: `npm test -- src/__tests__/routing.test.tsx`

Run: `npm run build`

Expected: both exit with code 0.

- [ ] **Step 12: Commit**

Run:

```bash
git add src/App.tsx src/components src/__tests__/routing.test.tsx src/styles
git commit -m "feat: build karolina-style home page"
```

---

### Task 5: Build Contact Form, Thank-You Route, And Business Cards

**Files:**
- Create: `src/components/ContactPage.tsx`
- Create: `src/components/ThankYouPage.tsx`
- Create: `src/components/BusinessCards.tsx`
- Modify: `src/App.tsx`
- Modify: `src/__tests__/routing.test.tsx`

**Interfaces:**
- Consumes: `profile`, `services`, and `contactForm` from data modules.
- Produces: routes `/contact`, `/contact.html`, `/thank-you`, `/thank-you.html`.

- [ ] **Step 1: Query reference contact section**

Inspect `https://karolinahess.com/` contact/footer area at desktop and mobile. Record final section typography, email treatment, and social icon placement.

- [ ] **Step 2: Write route and form tests**

Extend `src/__tests__/routing.test.tsx`:

```tsx
it("renders contact form with Web3Forms fields", () => {
  window.history.pushState({}, "", "/contact.html");
  render(<App />);
  const form = screen.getByRole("form", { name: "Project enquiry" });
  expect(form).toHaveAttribute("method", "POST");
  expect(form).toHaveAttribute("action", "https://api.web3forms.com/submit");
  expect(screen.getByDisplayValue("48578b9d-2262-418b-a5b9-4d9bd167ffb4")).toBeInTheDocument();
  expect(screen.getByDisplayValue("https://mojtabakeivanlou.com/thank-you.html")).toBeInTheDocument();
});

it("renders thank-you route", () => {
  window.history.pushState({}, "", "/thank-you.html");
  render(<App />);
  expect(screen.getByText("Enquiry Received")).toBeInTheDocument();
});
```

- [ ] **Step 3: Run tests to verify failure**

Run: `npm test -- src/__tests__/routing.test.tsx`

Expected: FAIL because contact and thank-you components are not implemented.

- [ ] **Step 4: Implement `ContactPage`**

Create a form with:

```tsx
<form method="POST" action="https://api.web3forms.com/submit" aria-label="Project enquiry">
  <input type="hidden" name="access_key" value="48578b9d-2262-418b-a5b9-4d9bd167ffb4" />
  <input type="hidden" name="subject" value="New Project Enquiry — mojtabakeivanlou.com" />
  <input type="hidden" name="redirect" value="https://mojtabakeivanlou.com/thank-you.html" />
  <input type="checkbox" name="botcheck" className="botcheck" tabIndex={-1} />
  <input type="hidden" name="Received (Oman Time)" value={omanTime} />
</form>
```

Fields: name, email, phone, organisation, project-type, description.

- [ ] **Step 5: Implement Oman time field**

Use component state:

```ts
const omanTime = new Date().toLocaleString("en-GB", { timeZone: "Asia/Muscat" });
```

- [ ] **Step 6: Implement `BusinessCards`**

Port the front/back business card content and selected icons from `contact.html`. Keep the responsive scale behavior with CSS `transform: scale(...)` driven by container queries or a resize effect.

- [ ] **Step 7: Implement `ThankYouPage`**

Render the thank-you content and links back home, contact, and CV download.

- [ ] **Step 8: Wire routes**

Update `App` to render `ContactPage` and `ThankYouPage` for both extensionless and `.html` paths.

- [ ] **Step 9: Run tests and build**

Run: `npm test -- src/__tests__/routing.test.tsx`

Run: `npm run build`

Expected: both exit with code 0.

- [ ] **Step 10: Commit**

Run:

```bash
git add src/components/ContactPage.tsx src/components/ThankYouPage.tsx src/components/BusinessCards.tsx src/App.tsx src/__tests__/routing.test.tsx
git commit -m "feat: add contact and thank-you routes"
```

---

### Task 6: Add SEO, Metadata, And Structured Data

**Files:**
- Modify: `index.html`
- Create: `src/components/StructuredData.tsx`
- Modify: `src/App.tsx`
- Create: `src/__tests__/metadata.test.tsx`

**Interfaces:**
- Produces: `StructuredData` component with schema.org Person JSON-LD.

- [ ] **Step 1: Write metadata test**

Write `src/__tests__/metadata.test.tsx` verifying title text, canonical URL, OG image, and JSON-LD profile fields.

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- src/__tests__/metadata.test.tsx`

Expected: FAIL because structured data is not implemented.

- [ ] **Step 3: Update `index.html` metadata**

Include title, description, canonical, OG, Twitter, favicon, and `theme-color` using Mojtaba content and `/assets/img/profile.jpeg`.

- [ ] **Step 4: Implement `StructuredData`**

Create a JSON-LD component with name, title, URL, image, email, telephone, address, sameAs, worksFor, alumniOf, and knowsAbout.

- [ ] **Step 5: Mount `StructuredData`**

Render it inside `App` so every route has the Person schema.

- [ ] **Step 6: Run tests and build**

Run: `npm test -- src/__tests__/metadata.test.tsx`

Run: `npm run build`

Expected: both exit with code 0.

- [ ] **Step 7: Commit**

Run:

```bash
git add index.html src/components/StructuredData.tsx src/App.tsx src/__tests__/metadata.test.tsx
git commit -m "feat: add seo metadata"
```

---

### Task 7: Browser Verification Against Reference

**Files:**
- Create: `tests/visual.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: local Vite preview.
- Produces: Playwright smoke checks for desktop/mobile layout constraints.

- [ ] **Step 1: Query reference screenshots**

Use browser automation to capture or inspect the reference at `1280x720` and `390x844`. Note hero typography, pill nav visibility, and mobile spacing in `_local-reference/karolinahess-reference-notes.md`.

- [ ] **Step 2: Write Playwright smoke tests**

Write `tests/visual.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("desktop hero keeps portrait clipped left and nav visible", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  const portrait = page.locator(".hero-portrait img");
  await expect(portrait).toBeVisible();
  const box = await page.locator(".hero-portrait").boundingBox();
  expect(box?.x).toBeLessThanOrEqual(0);
});

test("mobile keeps pill nav visible and omits selected work", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.getByText("Selected Work")).toHaveCount(0);
});

test("line artwork is on a light section", async ({ page }) => {
  await page.goto("/");
  const bg = await page.locator(".about-artwork").evaluate((node) => getComputedStyle(node.closest("section")!).backgroundColor);
  expect(["rgb(250, 250, 250)", "rgb(233, 232, 232)"]).toContain(bg);
});
```

- [ ] **Step 3: Run build and preview**

Run: `npm run build`

Run preview in a separate terminal: `npm run preview -- --port 4173`

- [ ] **Step 4: Run Playwright**

Run: `npm run test:e2e -- --config=playwright.config.ts`

Expected: tests pass at desktop and mobile sizes.

- [ ] **Step 5: Fix layout issues found by Playwright**

If a Playwright assertion fails, inspect the failing selector, query the reference for that section again, adjust CSS, and rerun `npm run build` and `npm run test:e2e`.

- [ ] **Step 6: Commit**

Run:

```bash
git add tests package.json package-lock.json src
git commit -m "test: add responsive visual smoke checks"
```

---

### Task 8: Final Build, Status Check, And Push

**Files:**
- Modify only files required by failing final checks.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: pushed `redesign4` branch ready for review/deploy.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm test
npm run build
npm run test:e2e
git status --short
```

Expected: tests pass, build passes, e2e passes, and git status is clean.

- [ ] **Step 2: Confirm no reference source is committed**

Run:

```bash
git ls-files | Select-String -Pattern 'karolinahess|framerusercontent|script_main|__framer'
```

Expected: no deployable reference-source files are listed. Mentions inside docs are acceptable.

- [ ] **Step 3: Push branch**

Run:

```bash
git push -u origin redesign4
```

Expected: branch is pushed to GitHub.

- [ ] **Step 4: Report verification evidence**

Report the exact passing commands and branch URL. Do not claim completion without the fresh command outputs from Step 1.
