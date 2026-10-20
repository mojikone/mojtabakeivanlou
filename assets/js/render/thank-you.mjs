// Pure and browser-safe: no Node-only imports. Used by the Node build and by the admin UI.
//
// The page the contact form redirects to. Heading and text come from site.json; what stays here is page furniture
// (the button labels, the check mark, the page's own CSS).

import { html, raw, fill, plainText } from './html.mjs';
import { icon } from './icons.mjs';
import { renderHead } from './head.mjs';
import { downloadCvOnclick } from './index.mjs';
import { topbar } from './topbar.mjs';

// The page's own CSS, on top of main.css. Code, not content.
const STYLE = String.raw`
  .thankyou-page {
    background: var(--dk);
    min-height: 100svh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 40px var(--pad);
  }
  .ty-check {
    width: 64px; height: 64px;
    background: var(--lime);
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    margin: 0 auto 32px;
  }
  .ty-heading {
    font-size: clamp(48px, 8vw, 100px);
    font-weight: 300;
    line-height: 0.93;
    letter-spacing: -0.03em;
    color: var(--text-lt);
    margin-bottom: 8px;
  }
  .ty-heading .lime { color: var(--lime); }
  .ty-sub {
    font-size: 16px;
    color: var(--text-lt2);
    max-width: 480px;
    margin: 20px auto 40px;
    line-height: 1.7;
  }
  .ty-actions { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }
`;

/** The whole thank-you page. */
export function renderThankYou(site, ctx) {
  const t = (text) => plainText(text, ctx);
  const [first, second] = site.thankYou.heading;
  const head = renderHead({
    site,
    ctx,
    page: 'thank-you',
    title: fill(site.seo.titleThankYou, ctx),
    description: fill(site.seo.descriptionThankYou, ctx),
    inlineStyles: [STYLE],
  });
  return html`${raw(head)}<body>

${topbar(ctx)}

<div class="thankyou-page">
  <div class="ty-check">
    ${icon('check')}
  </div>
  <div class="ty-heading">
    <div>${t(first)}</div>
    <div class="lime">${t(second)}</div>
  </div>
  <p class="ty-sub">${t(site.thankYou.text)}</p>
  <div class="ty-actions">
    <a class="btn-lime" href="index.html">
      Back to CV
      ${icon('arrowRight')}
    </a>
    <a class="btn-outline-lt" href="cv.html" target="_blank" rel="noopener" onclick="${downloadCvOnclick(site)}">
      ${icon('download', { width: '12', height: '12' })}
      Download CV
    </a>
  </div>
</div>

</body>
</html>
`;
}
