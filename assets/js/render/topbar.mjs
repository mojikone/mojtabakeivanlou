// Pure and browser-safe: no Node-only imports. Used by the Node build and by the admin UI.
//
// The bar across the top of the contact and thank-you pages: the name, and a way back to the home page.

import { frag } from './html.mjs';

/** `onLight` is for the light background of the contact page; the thank-you page is dark. */
export function topbar(ctx, { onLight = false } = {}) {
  return frag`<header class="topbar${onLight ? ' on-light' : ''}" id="topbar">
  <a class="topbar-logo" href="index.html">${ctx.name}</a>
  <div class="topbar-right">
    <a class="topbar-cta" href="index.html">&larr; Back to CV</a>
  </div>
</header>`;
}
