// Parity normaliser: a TEST HELPER (Node only, no DOM library) that makes a rendered page and an
// original page comparable. normalizeHtml applies eight rules in a fixed order (see the function at
// the bottom). Anything NOT covered by a rule survives unchanged so that it shows up as a
// difference: tag and attribute-name case, end-tag text, <!DOCTYPE>, unlisted entities, class
// names, non-void self-closing tags, and so on.
//
// The document is split into tokens first (comment | declaration | start tag | end tag | text | raw
// script/style body), so a `>` inside a quoted attribute value or a script/style body is never taken
// for the end of a tag, and markup-looking text inside a script string is never treated as markup.

const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const LT = '', GT = ''; // &lt; and &gt; decode to these, so text can never look like a tag
const ENTITIES = {
  amp: '&', lt: LT, gt: GT, quot: '"', nbsp: ' ', middot: '·', rarr: '→', larr: '←',
  copy: '©', mdash: '—', ndash: '–', hellip: '…', times: '×',
};
const MAX_DIFFS = 20;

const QUOTED_OR_PLAIN = `(?:"[^"]*"|'[^']*'|[^'">])*`; // attribute source; quoted values may contain '>'
const TOKEN = new RegExp(
  `(<!--[\\s\\S]*?-->)|(<![^>]*>)|(</[a-zA-Z][^>]*>)|<([a-zA-Z][^ \\t\\r\\n\\f/>]*)(${QUOTED_OR_PLAIN})>`, 'g');
const END_TAG_NAME = /^<\/([^ \t\r\n\f>/]+)/;
const ATTR = /[ \t\r\n\f]*(?:([^ \t\r\n\f"'<>/=]+)(?:[ \t\r\n\f]*=[ \t\r\n\f]*(?:"([^"]*)"|'([^']*)'|([^ \t\r\n\f"'<>`]+)))?|(\/))/y;
const RAW_END = { script: /<\/script[\s/>]/gi, style: /<\/style[\s/>]/gi }; // bodies of these are opaque text
const CLASS_SPLIT = /[ \t\r\n\f]+/;
const VERSION_QUERY = /\?v=[\s\S]*$/; // rule 4: from "?v=" to the end of the value (the closing quote)
const ENTITY = /&(?:([a-z]+)|#(\d+)|#[xX]([0-9a-fA-F]+));/g;
const WS_RUN = /[ \t\r\n]+/g, WS_ONLY = /^[ \t\r\n]*$/, WS_EDGES = /^[ \t\r\n]+|[ \t\r\n]+$/g; // never \s: NBSP is content

// ---- tokenizer ---------------------------------------------------------------------------------
function parseAttrs(tagName, src) {
  const attrs = []; let selfClose = false, pos = 0;
  while (pos < src.length) {
    ATTR.lastIndex = pos;
    const m = ATTR.exec(src);
    if (!m) {
      if (WS_ONLY.test(src.slice(pos))) break;
      throw new Error(`normalizeHtml: cannot parse attributes of <${tagName}${src}>`);
    }
    pos = ATTR.lastIndex;
    selfClose = m[5] !== undefined;
    if (!selfClose) attrs.push({ name: m[1], value: m[2] ?? m[3] ?? m[4] ?? '' });
  }
  return { attrs, selfClose };
}

function tokenize(html) {
  const out = []; let last = 0, m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(html))) {
    if (m.index > last) out.push({ t: 'text', s: html.slice(last, m.index) });
    last = TOKEN.lastIndex;
    if (m[1] !== undefined) out.push({ t: 'comment' });
    else if (m[2] !== undefined) out.push({ t: 'decl', s: m[2] });
    else if (m[3] !== undefined) out.push({ t: 'end', s: m[3], name: END_TAG_NAME.exec(m[3])[1].toLowerCase() });
    else {
      const tag = { t: 'start', name: m[4], ...parseAttrs(m[4], m[5]) };
      out.push(tag);
      const rawEnd = RAW_END[tag.name.toLowerCase()];
      if (rawEnd) { // script/style: everything up to the matching close tag is one opaque body
        rawEnd.lastIndex = last;
        const close = rawEnd.exec(html), stop = close ? close.index : html.length;
        if (stop > last) out.push({ t: 'raw', s: html.slice(last, stop), owner: tag });
        last = TOKEN.lastIndex = stop;
      }
    }
  }
  if (last < html.length) out.push({ t: 'text', s: html.slice(last) });
  return out;
}

const mergeText = (tokens) => tokens.reduce((out, tk) => {
  const prev = out[out.length - 1];
  if (tk.t === 'text' && prev?.t === 'text') prev.s += tk.s; else out.push(tk.t === 'text' ? { ...tk } : tk);
  return out;
}, []);

const attr = (tk, name) => tk.attrs.find((a) => a.name.toLowerCase() === name);
const attrIs = (tk, name, want) => attr(tk, name)?.value.trim().toLowerCase() === want;
const hasClass = (tk, cls) => (attr(tk, 'class')?.value.split(CLASS_SPLIT) ?? []).includes(cls);
const isTag = (tk) => tk?.t === 'start' || tk?.t === 'end' || tk?.t === 'decl';

// Index of the first end tag called `name` after tokens[i]. ASSUMPTION (documented, not enforced):
// the first such end tag closes the element. That holds for what we remove: div.access-pill holds
// a <form> and <button>s but never another <div>, span.proj-files never holds another <span>, and a
// data-years span only holds a number. A violation leaves a stray end tag, which shows as a diff.
function closeOf(tokens, i, name) {
  for (let j = i + 1; j < tokens.length; j++) if (tokens[j].t === 'end' && tokens[j].name === name) return j;
  throw new Error(`normalizeHtml: <${tokens[i].name}> has no closing </${name}>`);
}

// ---- the eight rules ---------------------------------------------------------------------------
const removeComments = (tokens) => mergeText(tokens.filter((tk) => tk.t !== 'comment')); // 1

const REMOVED_ELEMENTS = [ // 2: [tag name, test on the start tag]
  ['div', (tk) => hasClass(tk, 'access-pill')],
  ['span', (tk) => hasClass(tk, 'proj-files')],
  ['script', (tk) => attrIs(tk, 'id', 'mk-years')],
  ['script', (tk) => attrIs(tk, 'type', 'module')],
];
function removeElements(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i], name = tk.t === 'start' ? tk.name.toLowerCase() : '';
    if (name === 'link' && attrIs(tk, 'rel', 'modulepreload')) continue; // void element: the tag only
    if (REMOVED_ELEMENTS.some(([n, test]) => n === name && test(tk))) i = closeOf(tokens, i, name);
    else out.push(tk);
  }
  return mergeText(out);
}

function unwrapYears(tokens) { // 3: only the exact generated form <span data-years>, with no other attribute
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.t === 'start' && tk.name.toLowerCase() === 'span' && tk.attrs.length === 1 && attrIs(tk, 'data-years', '')) {
      const j = closeOf(tokens, i, 'span');
      out.push(...tokens.slice(i + 1, j)); i = j;
    } else out.push(tk);
  }
  return mergeText(out);
}

function dropVersioning(tokens) { // 4
  for (const tk of tokens) {
    if (tk.t !== 'start') continue;
    tk.attrs = tk.attrs.filter((a) => a.name.toLowerCase() !== 'data-experience-start');
    for (const a of tk.attrs) if (/^(href|src)$/i.test(a.name)) a.value = a.value.replace(VERSION_QUERY, '');
  }
}

const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;
function canonicalJsonLd(tokens) { // 5: the body is canonical afterwards, so rules 6 and 8 leave it alone
  for (const tk of tokens) {
    if (tk.t !== 'raw' || !attrIs(tk.owner, 'type', 'application/ld+json')) continue;
    let data;
    try { data = JSON.parse(tk.s); } catch (e) { throw new Error(`normalizeHtml: invalid JSON-LD, the generator is broken (${e.message})`); }
    tk.s = JSON.stringify(sortKeys(data)); tk.fixed = true;
  }
}

function decodeEntity(whole, name, dec, hex) {
  if (name) return Object.hasOwn(ENTITIES, name) ? ENTITIES[name] : whole; // unknown names stay as written
  const cp = dec ? Number(dec) : parseInt(hex, 16);
  if (cp === 60) return LT;
  if (cp === 62) return GT;
  if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) || cp === 0xe001 || cp === 0xe002) return whole;
  return String.fromCodePoint(cp);
}
function decodeEntities(tokens) { // 6: text and attribute values only; raw script/style bodies are not entity-decoded by browsers either
  for (const tk of tokens) {
    if (tk.t === 'text') tk.s = tk.s.replace(ENTITY, decodeEntity);
    else if (tk.t === 'start') for (const a of tk.attrs) a.value = a.value.replace(ENTITY, decodeEntity);
  }
}

// 7: sort by name (stable, so duplicate names keep their order). The canonical spelling (attr="v" with
// double quotes, bare attr as attr="", `/>` dropped on void elements) comes from `serialize`. An inner
// `"` (only possible via &quot; or a single-quoted value) is NOT re-escaped: rule 6 already ran.
const sortAttributes = (tokens) => tokens.forEach((tk) => {
  if (tk.t === 'start') tk.attrs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
});

function collapseWhitespace(tokens) { // 8 (the whole-result trim happens after serialising)
  return tokens.filter((tk, i) => {
    if (tk.t === 'start') for (const a of tk.attrs) a.value = a.value.replace(WS_RUN, ' ');
    if ((tk.t !== 'text' && tk.t !== 'raw') || tk.fixed) return true;
    if (WS_ONLY.test(tk.s) && isTag(tokens[i - 1]) && isTag(tokens[i + 1])) return false; // between '>' and '<'
    tk.s = tk.s.replace(WS_RUN, ' ');
    return true;
  });
}

const serialize = (tokens) => tokens.map((tk) => tk.t !== 'start' ? tk.s
  : `<${tk.name}${tk.attrs.map((a) => ` ${a.name}="${a.value}"`).join('')}${tk.selfClose && !VOID.has(tk.name.toLowerCase()) ? '/' : ''}>`).join('');

/** Normalise `html` for parity comparison; the eight rules run in this order. */
export function normalizeHtml(html) {
  let tokens = removeComments(tokenize(String(html)));  // 1 comments
  tokens = removeElements(tokens);                      // 2 access pill, proj-files, mk-years, module script, modulepreload
  tokens = unwrapYears(tokens);                         // 3 <span data-years>
  dropVersioning(tokens);                               // 4 data-experience-start, ?v= on href/src
  canonicalJsonLd(tokens);                              // 5 JSON-LD with sorted keys
  decodeEntities(tokens);                               // 6 entities
  sortAttributes(tokens);                               // 7 attribute order
  return serialize(collapseWhitespace(tokens)).replace(WS_EDGES, ''); // 8 whitespace
}

/** First 20 segments (split after each `>`, 0-based index) that differ, as "#i\n- a\n+ b"; [] when equal. */
export function diffLines(a, b) {
  const A = String(a).split(/(?<=>)/), B = String(b).split(/(?<=>)/), out = [];
  for (let i = 0; i < Math.max(A.length, B.length) && out.length < MAX_DIFFS; i++) {
    if (A[i] !== B[i]) out.push(`#${i}\n- ${A[i] ?? ''}\n+ ${B[i] ?? ''}`);
  }
  return out;
}
