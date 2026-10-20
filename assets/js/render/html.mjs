// Pure and browser-safe: no Node-only imports. Used by the Node build and by the admin UI.
//
// Everything is escaped by default. The only values inserted verbatim are Raw instances.

/** @typedef {{ years: number, year: number, name: string, roleTitle: string, domain: string }} Ctx */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

// Marks a string as trusted HTML so that `html` and friends insert it verbatim.
export class Raw {
  constructor(html) { this.html = html; }
}

export function raw(html) {
  return new Raw(html);
}

function render(value) {
  if (value instanceof Raw) return value.html;
  if (value === null || value === undefined || value === false) return '';
  if (Array.isArray(value)) return value.map(render).join('');
  return esc(value);
}

// Tagged template: the template's own text is verbatim, every interpolated value goes through `render`.
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return out;
}

const PLACEHOLDERS = ['years', 'year', 'name', 'roleTitle', 'domain'];

// Single pass, so substituted values are never rescanned for placeholders.
function substitute(text, ctx, yearsText) {
  return text.replace(/\{\{[^{}]*\}\}/g, (token) => {
    const key = token.slice(2, -2);
    if (!PLACEHOLDERS.includes(key)) throw new Error(`Unknown placeholder ${token}`);
    return key === 'years' ? yearsText : String(ctx[key]);
  });
}

// Plain-text substitution: no escaping, no markup.
export function fill(text, ctx) {
  return substitute(text, ctx, String(ctx.years));
}

// html`` returns a string, which an enclosing html`` would escape; a fragment built to be nested is therefore Raw.
export const frag = (strings, ...values) => raw(html(strings, ...values));

/**
 * A plain (not rich) text field: placeholders filled and escaped, the {{years}} count kept live as
 * <span data-years>, no **bold** or _italic_ markers.
 */
export function plainText(text, ctx) {
  return raw(String(text).split('{{years}}').map((part) => esc(fill(part, ctx))).join(`<span data-years>${ctx.years}</span>`));
}

// Stands in for {{years}} while the text is escaped and the markers are converted, so the span is not escaped.
// A private-use character; any real occurrence in the input is dropped so it cannot forge a span.
const YEARS_MARK = '';

export function inlineText(text, ctx) {
  const filled = substitute(text.replaceAll(YEARS_MARK, ''), ctx, YEARS_MARK);
  const rendered = esc(filled)                                                  // escape before any markup is added
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])_([^_\n]+?)_(?!\w)/g, '$1<em>$2</em>')                   // not inside words: d_e_f, CV_X_2026.pdf
    .replaceAll(YEARS_MARK, `<span data-years>${ctx.years}</span>`);
  return raw(rendered);
}

export function richText(text, ctx) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p !== '');
  return raw(paragraphs.map((p) => `<p>${inlineText(p, ctx).html}</p>`).join(''));
}
