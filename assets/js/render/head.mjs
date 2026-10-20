// Pure and browser-safe: no Node-only imports. Used by the Node build and by the admin UI.
//
// The shared document head (spec section 14) and the JSON-LD builders. JSON-LD reproduces the original pages'
// structure exactly, nothing added and nothing dropped, with every value sourced from site.json.

import { html, raw, fill } from './html.mjs';

/** The share image of every page (og:image, twitter:image, JSON-LD image), relative to the site root. */
export const OG_IMAGE = 'assets/img/mojtaba-waterfront4.webp';

// Rewrites the [data-years] counts in the browser, so a page built before an anniversary shows the right number.
const YEARS_SCRIPT = `<script id="mk-years">(function(){var s=document.documentElement.getAttribute('data-experience-start');if(!s)return;var d=new Date(s),n=new Date(),y=n.getUTCFullYear()-d.getUTCFullYear();if(n.getUTCMonth()<d.getUTCMonth()||(n.getUTCMonth()===d.getUTCMonth()&&n.getUTCDate()<d.getUTCDate()))y--;document.addEventListener('DOMContentLoaded',function(){document.querySelectorAll('[data-years]').forEach(function(e){e.textContent=y;});});})();</script>`;

// The "MK" tile; palette.js repaints it in the chosen theme colours.
const FAVICON = `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='14' fill='%231A3D2C'/%3E%3Ctext x='50' y='67' font-family='sans-serif' font-weight='700' font-size='44' text-anchor='middle' fill='%23A8CE2E'%3EMK%3C/text%3E%3C/svg%3E">`;

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,200;0,300;0,400;0,500;0,600;0,700;1,300&display=swap" rel="stylesheet">`;

/** A single-quoted JavaScript string literal that is also safe inside an HTML <script> or attribute. */
export function jsString(value) {
  return `'${String(value).replace(/[\\'"<>&\n\r\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}'`;
}

const siteUrl = (site) => `https://${site.site.domain}`;
const absolute = (site, path) => (path ? `${siteUrl(site)}/${path}` : siteUrl(site));

// JSON inside <script>: "<" is written as < so the text can never close the element or open a comment.
const jsonScript = (data) => JSON.stringify(data, null, 2).replace(/</g, '\\u003c');

/**
 * Everything from <!DOCTYPE html> through </head>, including the <html> start tag.
 * Optional parts are left out when their value is missing: `description` (null, undefined or ''), `ogDescription`
 * (Open Graph and Twitter), `canonicalPath` (null or undefined; '' is the site root), `jsonLd`. `styles` and `scripts`
 * are site-relative paths, versioned through `ctx.v`; `scripts` are extra synchronous includes after palette.js.
 * `inlineStyles` are CSS texts, each written verbatim (not escaped) as a <style> block, last in the head, so they
 * override the stylesheets. `page: 'thank-you'` adds robots noindex.
 */
export function renderHead({ site, ctx, page, title, description, ogDescription, canonicalPath, ogType, image = OG_IMAGE, jsonLd, styles = [], scripts = [], inlineStyles = [] }) {
  const gaId = site.site.gaId;
  const url = canonicalPath == null ? null : absolute(site, canonicalPath);
  const imageUrl = absolute(site, image);
  const lines = [
    html`<script async src="https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}"></script>`,
    `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${jsString(gaId)});</script>`,
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    html`<title>${title}</title>`,
    page === 'thank-you' && '<meta name="robots" content="noindex">',
    description != null && description !== '' && html`<meta name="description" content="${description}">`,
    ogDescription != null && [
      html`<meta property="og:title" content="${title}">`,
      html`<meta property="og:description" content="${ogDescription}">`,
      html`<meta property="og:type" content="${ogType}">`,
      url != null && html`<meta property="og:url" content="${url}">`,
      html`<meta property="og:image" content="${imageUrl}">`,
      '<meta name="twitter:card" content="summary">',
      html`<meta name="twitter:title" content="${title}">`,
      html`<meta name="twitter:image" content="${imageUrl}">`,
    ],
    url != null && html`<link rel="canonical" href="${url}">`,
    jsonLd != null && `<script type="application/ld+json">\n${jsonScript(jsonLd)}\n</script>`,
    FAVICON,
    FONTS,
    styles.map((path) => html`<link rel="stylesheet" href="${ctx.v(path)}">`),
    html`<script src="${ctx.v('assets/js/palette.js')}"></script>`,
    scripts.map((path) => html`<script src="${ctx.v(path)}"></script>`),
    YEARS_SCRIPT,
    inlineStyles.map((css) => `<style>${css}</style>`),
  ].flat(Infinity).filter((line) => typeof line === 'string' && line !== '');

  return html`<!DOCTYPE html>
<html lang="en" data-experience-start="${site.site.experienceStart}">
<head>
${raw(lines.join('\n'))}
</head>
`;
}

/** The Person both pages describe: profile name, job title, links, contact and address. */
export function personJsonLd(site, ctx) {
  const p = site.profile;
  return {
    '@type': 'Person',
    name: ctx.name,
    jobTitle: fill(p.roleTitle, ctx),
    url: siteUrl(site),
    image: absolute(site, OG_IMAGE),
    email: p.email,
    telephone: p.phone.e164,
    address: { '@type': 'PostalAddress', addressLocality: p.location.city, addressCountry: p.location.countryCode },
    sameAs: [p.linkedin],
  };
}

/** Home page: the Person plus employer (the `current` company), alumniOf, description, services and knowsAbout. */
export function indexJsonLd(site, ctx) {
  const f = (text) => fill(text, ctx);
  const current = site.experience.companies.find((company) => company.current === true);
  return {
    '@context': 'https://schema.org',
    ...personJsonLd(site, ctx),
    ...(current && { worksFor: { '@type': 'Organization', name: f(current.name) } }),
    alumniOf: site.education.map((edu) => ({ '@type': 'EducationalOrganization', name: f(edu.schoolShort || edu.school) })),
    description: f(site.seo.personDescription),
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'Engineering Services',
      itemListElement: site.services.items.map((service) => ({
        '@type': 'Offer',
        itemOffered: {
          '@type': 'Service',
          name: f(service.title),
          ...(service.keywords?.length && { serviceType: service.keywords.map(f) }),
          description: f(service.description),
        },
      })),
    },
    knowsAbout: site.seo.knowsAbout.map(f),
  };
}

/** CV page: a ProfilePage around the same Person. */
export function cvJsonLd(site, ctx) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url: absolute(site, 'cv.html'),
    name: `CV — ${ctx.name}`,
    mainEntity: personJsonLd(site, ctx),
  };
}
