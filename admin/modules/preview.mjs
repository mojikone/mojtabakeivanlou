// The dashboard preview (spec 13.5, Task 21): a modal with a tab per page (Home, Contact, Thank you, CV) and an
// iframe whose srcdoc is the page rendered from the CURRENT draft by the very templates the build uses.
//
// The top half is pure (Node tests cover it); openPreview() at the bottom is the DOM part.
//   - the draft is normalised before it is rendered (the dashboard may hold a half-edited draft);
//   - the context is `unlocked`, so the download icons of attached files are visible (they are hidden on the public page);
//   - `<base href="<origin>/">` is the first child of <head>, so `assets/...` and the other relative URLs resolve from
//     the served site root and not from /admin/;
//   - a draft that fails validation is still rendered; the owner gets a one-line count above the frame;
//   - the page is rendered with a blank Google Analytics id, so no GA tag runs inside the dashboard's origin (Firebase,
//     for the palette's colours, stays: palette.js is the site's own);
//   - the Contact form does not submit: a capture-phase handler cancels it and says so inside the frame.

import { normalizeSite, renderContext, validateSite } from '../../assets/js/render/model.mjs';
import { esc } from '../../assets/js/render/html.mjs';
import { icons } from '../../assets/js/render/icons.mjs';
import { renderIndex } from '../../assets/js/render/index.mjs';
import { renderContact } from '../../assets/js/render/contact.mjs';
import { renderThankYou } from '../../assets/js/render/thank-you.mjs';
import { renderCv } from '../../assets/js/render/cv.mjs';
import { modal, el } from './ui.mjs';

/* ─── PURE ─── */

/** The tabs, in order. `id` is the page's file name without .html. */
export const PAGES = Object.freeze([
  Object.freeze({ id: 'index', label: 'Home', render: renderIndex }),
  Object.freeze({ id: 'contact', label: 'Contact', render: renderContact }),
  Object.freeze({ id: 'thank-you', label: 'Thank you', render: renderThankYou }),
  Object.freeze({ id: 'cv', label: 'CV', render: renderCv }),
]);

// The Preview button opens the page the open section edits: the Contact page section shows the Contact tab,
// everything else (profile, settings, ...) shows Home.
const SECTION_PAGES = { contact: 'contact' };

/** The tab to open from the dashboard section `sectionId`: 'contact' for the Contact page section, else 'index'. */
export function pageForSection(sectionId) {
  return (typeof sectionId === 'string' && Object.hasOwn(SECTION_PAGES, sectionId)) ? SECTION_PAGES[sectionId] : 'index';
}

const PAGE_LINK = /^(?:\.?\/)?(index|contact|thank-you|cv)\.html(?:[?#].*)?$/;

/** The tab a link inside the preview points at ('contact.html', './cv.html#x', ...), or null for any other link. */
export function pageForHref(href) {
  const match = PAGE_LINK.exec(typeof href === 'string' ? href.trim() : '');
  return match ? match[1] : null;
}

// location.origin is "null" for file:// and has no use as a base; '/' is then the best that can be done.
const ORIGIN = /^https?:\/\/[^\s/"'<>&]+$/i;

/**
 * Puts `<base href="<origin>/">` right after the opening <head> tag (before any relative URL is seen), or in front
 * of the document when it has no <head>. An `origin` that is not an http(s) origin gives `<base href="/">`.
 */
export function withBase(html, origin) {
  const base = `<base href="${esc(ORIGIN.test(origin ?? '') ? `${origin}/` : '/')}">`;
  const head = /<head(?=[\s>])[^>]*>/i;
  return head.test(html) ? html.replace(head, (tag) => tag + base) : base + html;
}

/** What the frame says when its Contact form is submitted. */
export const FORM_DISABLED_TEXT = 'Form submission is disabled in the preview';

const FORM_NOTICE_STYLE = 'margin:12px 0 0;padding:8px 12px;border-radius:8px;border:1px solid #e3a72f;background:#fff5dc;color:#5c4400;font:500 13px/1.4 Poppins,Arial,sans-serif;';

/**
 * Cancels every form submission in the preview's document `doc` (capture phase, before the page's own handlers) and
 * shows FORM_DISABLED_TEXT under the form once: the Contact form would otherwise post the draft's test message to the
 * live form service.
 */
export function guardFormSubmit(doc) {
  let notice = null;
  doc.addEventListener('submit', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!notice) {
      notice = doc.createElement('p');
      notice.setAttribute('role', 'status');
      notice.setAttribute('style', FORM_NOTICE_STYLE);
      notice.className = 'adm-preview-form-notice';
      notice.textContent = FORM_DISABLED_TEXT;
    }
    const form = event.target;
    if (form && typeof form.append === 'function') form.append(notice);
    else doc.body?.append(notice);
  }, true);
}

/** The amber line above the frame: '' for no issues, else the count only (the list is in the sections). */
export function validationNotice(issues) {
  const count = Array.isArray(issues) ? issues.length : Number(issues) || 0;
  return count > 0 ? `${count} validation issue(s) — the published build would be rejected` : '';
}

/**
 * One page of the preview.
 * @param {object} draftSite  the draft's `site` (content/site.json shape); not modified
 * @param {string} page       a PAGES id; anything else shows Home
 * @param {{ today?: Date, origin?: string }} [options]
 * @returns {{ html: string|null, issues: string[], error?: string }}
 *   html    the full document for iframe.srcdoc, or null when the templates cannot render the draft yet; rendered
 *           with a blank site.gaId (no GA tag), so analytics never runs inside the dashboard
 *   issues  the validator's messages (the same ones the build would fail with), for the draft as it is
 *   error   why html is null
 */
export function previewDocument(draftSite, page = 'index', { today = new Date(), origin = '' } = {}) {
  const entry = PAGES.find((p) => p.id === page) ?? PAGES[0];
  let issues = [];
  try {
    const site = normalizeSite(draftSite);
    issues = validateSite(site, { icons: Object.keys(icons), today });
    const shown = site?.site && typeof site.site === 'object' ? { ...site, site: { ...site.site, gaId: '' } } : site;
    const ctx = renderContext(shown, { today, unlocked: true });
    return { html: withBase(entry.render(shown, ctx), origin), issues };
  } catch (err) {
    return { html: null, issues, error: String(err?.message || err) };
  }
}

/* ─── DOM ─── */

let counter = 0;

/**
 * Opens the preview modal on `page` (a PAGES id, default Home). The frame shows the draft as it is when a tab is
 * shown, so switching tabs re-renders. Returns the modal handle ({ close, element }), or null when no draft is loaded.
 * Esc closes it, also while the focus is inside the frame; links to the site's own pages switch tabs instead of
 * leaving the draft, and #anchors scroll inside the frame.
 */
export function openPreview(store, page = 'index') {
  if (!store.get()?.site) return null;
  const uid = `adm-pv${++counter}`;
  let current = PAGES.some((p) => p.id === page) ? page : PAGES[0].id;

  const tabs = PAGES.map((p) => el('button', {
    type: 'button', class: 'adm-preview-tab', role: 'tab', id: `${uid}-tab-${p.id}`, 'aria-controls': `${uid}-panel`,
    text: p.label, onclick: () => show(p.id),
  }));
  const tablist = el('div', { class: 'adm-preview-tabs', role: 'tablist', 'aria-label': 'Page to preview' }, tabs);
  tablist.addEventListener('keydown', (e) => {
    const at = PAGES.findIndex((p) => p.id === current);
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: PAGES.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    show(PAGES[(to + PAGES.length) % PAGES.length].id, { focus: true });
  });

  const notice = el('p', { class: 'adm-preview-notice', role: 'status', hidden: true });
  const failure = el('p', { class: 'adm-preview-failure', role: 'alert', hidden: true });
  // No sandbox (the page needs its own scripts and the dashboard's origin), and no referrer for anything it loads.
  const frame = el('iframe', { class: 'adm-preview-frame', title: 'Page preview', referrerpolicy: 'no-referrer' });
  const panel = el('div', { class: 'adm-preview-panel', role: 'tabpanel', id: `${uid}-panel` }, failure, frame);
  // A name of its own: the box class of the rich-text field preview (ui.mjs) already carries other rules.
  const body = el('div', { class: 'adm-preview-modal-body' }, tablist, notice, panel);

  const handle = modal({ title: 'Preview', body, actions: [{ label: 'Close', primary: true }] });
  handle.element.classList.add('adm-modal-preview');

  function show(id, { focus = false } = {}) {
    current = id;
    const { html, issues, error } = previewDocument(store.get().site, id, { today: new Date(), origin: location.origin });
    PAGES.forEach((p, i) => {
      const on = p.id === id;
      tabs[i].setAttribute('aria-selected', String(on));
      tabs[i].tabIndex = on ? 0 : -1;
    });
    panel.setAttribute('aria-labelledby', `${uid}-tab-${id}`);
    if (focus) tabs[PAGES.findIndex((p) => p.id === id)].focus();

    notice.textContent = validationNotice(issues);
    notice.hidden = notice.textContent === '';
    failure.hidden = html !== null;
    failure.textContent = html === null ? `This page cannot be previewed yet: ${error}` : '';
    frame.hidden = html === null;
    if (html !== null) frame.srcdoc = html;
  }

  // The srcdoc document has the dashboard's origin, so its document can be reached. A link that was left to the browser
  // would resolve against <base> and load the published page (not the draft) into the frame.
  frame.addEventListener('load', () => {
    let doc = null;
    try { doc = frame.contentDocument; } catch { /* the frame left the origin */ }
    if (!doc?.documentElement) return;
    doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') handle.close(); });
    guardFormSubmit(doc);
    // Capture phase: the page's own handlers (the Download CV buttons fetch the PDF) must not run for a page link.
    doc.addEventListener('click', (e) => {
      const link = e.target?.closest?.('a[href]');
      const target = link && pageForHref(link.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      show(target);
    }, true);
    doc.addEventListener('click', (e) => {
      const link = e.target?.closest?.('a[href]');
      if (!link || e.defaultPrevented) return;
      const href = link.getAttribute('href');
      if (href.startsWith('#')) {
        e.preventDefault();
        let id = href.slice(1);
        try { id = decodeURIComponent(id); } catch { /* keep it as typed */ }
        (id ? doc.getElementById(id) : null)?.scrollIntoView();
      } else if (/^https?:$/.test(link.protocol) && link.origin !== location.origin) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
    });
  });

  show(current, { focus: true });
  return handle;
}
