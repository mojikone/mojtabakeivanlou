// Pure helpers behind the dashboard's form controls (ui.mjs) and sections (sections/*.mjs). No DOM, so the Node tests
// cover them (test/ui.test.mjs).

import { inlineText, richText } from '../../assets/js/render/html.mjs';
import { normalizeSite, validateSite } from '../../assets/js/render/model.mjs';
import { yearsOfExperience } from '../../assets/js/render/years.mjs';

/* ─── THROTTLE ─── */

/**
 * Calls `fn` with the latest arguments at most once per `ms`: the first call of a window starts the timer, later calls
 * only replace the arguments. So a field typed into continuously still reaches the store every `ms`, and the last
 * keystroke at most `ms` later. `.flush()` runs a pending call now, `.cancel()` drops it, `.pending()` tells.
 */
export function throttle(fn, ms = 150) {
  let timer = null;
  let args = null;
  const run = () => {
    timer = null;
    const next = args;
    args = null;
    fn(...next);
  };
  function throttled(...next) {
    args = next;
    if (timer === null) timer = setTimeout(run, ms);
  }
  throttled.flush = () => {
    if (timer === null) return;
    clearTimeout(timer);
    run();
  };
  throttled.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    args = null;
  };
  throttled.pending = () => timer !== null;
  return throttled;
}

/* ─── BOLD / ITALIC ─── */

const isSpace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r';

/**
 * The text after the **B** or _I_ button: the selection [start, end) wrapped in `marker` (or unwrapped when it already
 * is), with the same words selected afterwards. Whitespace at the edges of the selection stays outside the markers,
 * because `_word _` would not render. A selection over several lines wraps each non-empty line, because the markers
 * work within a paragraph only. Returns { text, start, end } plus the replacement { from, to, insert } of the old text.
 */
export function wrapSelection(text, start, end, marker) {
  const m = marker.length;
  let a = Math.min(start, end);
  let b = Math.max(start, end);
  while (a < b && isSpace(text[a])) a++;
  while (b > a && isSpace(text[b - 1])) b--;
  const selected = text.slice(a, b);
  const edit = (from, to, insert, selStart, selEnd) => ({
    text: text.slice(0, from) + insert + text.slice(to), start: selStart, end: selEnd, from, to, insert,
  });

  if (selected.includes('\n')) {
    const insert = selected.split('\n').map((line) => {
      const lead = line.length - line.trimStart().length;
      const core = line.trim();
      return core ? `${line.slice(0, lead)}${marker}${core}${marker}${line.slice(lead + core.length)}` : line;
    }).join('\n');
    return edit(a, b, insert, a, a + insert.length);
  }
  if (a >= m && text.slice(a - m, a) === marker && text.slice(b, b + m) === marker) {
    return edit(a - m, b + m, selected, a - m, b - m);                     // the markers sit just outside the selection
  }
  if (selected.length >= 2 * m && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(m, -m);
    return edit(a, b, inner, a, a + inner.length);                         // the selection includes the markers
  }
  return edit(a, b, marker + selected + marker, a + m, b + m);
}

/* ─── LISTS STORED AS ARRAYS ─── */

/** "Flood modelling, HEC-RAS, …" -> ['Flood modelling', 'HEC-RAS', …]: trimmed, empty entries dropped. */
export const keywordsFromText = (text) => String(text ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
export const keywordsToText = (list) => (Array.isArray(list) ? list.join(', ') : '');

/** One term per line (seo.knowsAbout): trimmed, blank lines dropped. */
export const linesToArray = (text) => String(text ?? '').split(/\r?\n/).map((s) => s.trim()).filter((s) => s !== '');
export const arrayToLines = (list) => (Array.isArray(list) ? list.join('\n') : '');

/** education[].schoolShort pre-filled from school (spec 8): brackets dropped, then the last ", country" part. */
export function schoolShortFrom(school) {
  const parts = String(school ?? '').replace(/\s*\([^)]*\)/g, '').split(',').map((s) => s.trim()).filter((s) => s !== '');
  return (parts.length > 1 ? parts.slice(0, -1) : parts).join(', ');
}

/* ─── VALIDATION HINTS ─── */

// "profile.email is empty" -> "profile.email"; the validator writes the JSON path, a space, then the problem.
const pathOf = (message) => (message.includes(' ') ? message.slice(0, message.indexOf(' ')) : message);
const under = (path, key) => path === key || path.startsWith(`${key}.`) || path.startsWith(`${key}[`);

/**
 * The validator's messages for one section: problems of the normalised draft (what the build will check) whose path
 * is one of `keys` or below it, minus those below an `exclude` key. `icons` as for validateSite.
 */
export function issuesFor(site, { keys, exclude = [], icons } = {}) {
  return validateSite(normalizeSite(site), { icons })
    .filter((message) => {
      const path = pathOf(message);
      return keys.some((key) => under(path, key)) && !exclude.some((key) => under(path, key));
    });
}

/* ─── RICH-TEXT PREVIEW ─── */

/** The placeholder values for previews, from the draft; a broken start date leaves {{years}} as it is. */
export function previewContext(site, today = new Date()) {
  let years = '{{years}}';
  try { years = yearsOfExperience(site?.site?.experienceStart, today); } catch { /* shown as typed */ }
  const p = site?.profile ?? {};
  const text = (v) => (typeof v === 'string' ? v.trim() : '');
  return {
    years,
    year: today.getUTCFullYear(),
    name: [text(p.firstName), text(p.lastName)].filter((s) => s !== '').join(' '),
    roleTitle: text(p.roleTitle),
    domain: text(site?.site?.domain),
  };
}

/**
 * The preview of a rich field as the site renders it: { html } (escaped by inlineText / richText, so safe to insert)
 * or { error } for text the renderer refuses (an unknown placeholder).
 */
export function previewHtml(text, ctx, { inline = false } = {}) {
  try {
    return { html: (inline ? inlineText : richText)(String(text ?? ''), ctx).html };
  } catch (err) {
    return { error: String(err?.message || err) };
  }
}
