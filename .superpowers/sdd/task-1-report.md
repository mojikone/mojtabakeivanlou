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
