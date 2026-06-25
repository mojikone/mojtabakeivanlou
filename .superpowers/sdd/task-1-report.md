Status: DONE_WITH_CONCERNS

Summary:
- Queried `https://karolinahess.com` and confirmed the reference shell exposes Neue Montreal font declarations, Framer breakpoint metadata, and appear animation metadata before implementing the scaffold.
- Replaced the static root page with a Vite/React entry shell, added TypeScript/Vite config, baseline token/global styles, a route-based `App`, and a GitHub Pages workflow.
- Preserved deploy assets in `public/`, including the copied hero image at `/assets/img/mojtaba-hero.png` and the CV PDF at `/pdf/CV_Mojtaba_Keivanlou_2026.pdf`.
- Installed dependencies and verified the production build succeeds.

Verification:
- `npm install` succeeded.
- `npm run build` succeeded after a minimal Vite config typing adjustment.

Concern:
- The exact config shape from the brief required a small TypeScript compatibility workaround in `vite.config.ts` (`as any`) so `tsc -b` would accept the `test` block with the specified dependency versions.

Commit:
- Created after staging Task 1 files with message: `chore: scaffold react vite site`

---

Review Fix Addendum:
- Added `public/CNAME` with the exact custom domain value from the repository root CNAME so Vite copies it into the deployable output for the Pages workflow upload.
- Restored the pre-scaffold SEO baseline in `index.html`: title, description, canonical URL, Open Graph tags, Twitter tags, and the Person JSON-LD block from the original content branch.
- Replaced the broad `as any` in `vite.config.ts` with explicit config typing using `UserConfig` plus Vitest `InlineConfig`, keeping the `test` block type-safe without the prior cast.
- Added `.gitignore` entries for `node_modules/`, `dist/`, `*.tsbuildinfo`, `vite.config.js`, and `vite.config.d.ts`, and removed those generated artifacts from the working tree after verification.

Verification Addendum:
- Command: `npm run build`
- Result: succeeded (`tsc -b && vite build` exit code 0) and the built output included `dist/CNAME` with `mojtabakeivanlou.com` before cleanup.

Commit Addendum:
- Created follow-up fix commit after staging the targeted Task 1 files.
