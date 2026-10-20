import { test } from 'node:test'; import assert from 'node:assert/strict';
import { esc, Raw, raw, html, frag, fill, plainText, inlineText, richText } from '../assets/js/render/html.mjs';

const ctx = { years: 17, year: 2026, name: 'Mojtaba Keivanlou', roleTitle: 'Senior', domain: 'x.com' };
test('html tag escapes values and passes raw through', () => {
  assert.equal(html`<b>${'<i>&'}</b>${raw('<u>')}${['a', raw('<s>')]}${null}`, '<b>&lt;i&gt;&amp;</b><u>a<s>');
});
test('fill replaces known placeholders and throws on unknown', () => {
  assert.equal(fill('{{years}} yrs, {{name}}', ctx), '17 yrs, Mojtaba Keivanlou');
  assert.throws(() => fill('{{nope}}', ctx), /Unknown placeholder/);
});
test('inlineText: bold, italic, escaping, years span, underscores in words', () => {
  assert.equal(inlineText('**A** _b_ <c> & d_e_f CV_X_2026.pdf {{years}}', ctx).html,
    '<strong>A</strong> <em>b</em> &lt;c&gt; &amp; d_e_f CV_X_2026.pdf <span data-years>17</span>');
});
test('richText splits paragraphs on blank lines', () => {
  assert.equal(richText('one\n\ntwo **2**', ctx).html, '<p>one</p><p>two <strong>2</strong></p>');
});

test('esc escapes & < > " \' and stringifies non-strings', () => {
  assert.equal(esc(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  assert.equal(esc(5), '5');
});
test('raw returns a Raw carrying the html string', () => {
  const r = raw('<u>');
  assert.ok(r instanceof Raw);
  assert.equal(r.html, '<u>');
});
test('html tag: template text is verbatim, falsy-but-meaningful values are kept, null/undefined/false vanish', () => {
  assert.equal(html`<a href="${'x"y'}" title='${"it's"}'>${0}${undefined}${false}${true}</a>`,
    '<a href="x&quot;y" title=\'it&#39;s\'>0true</a>');
});
test('html tag: arrays are joined with no separator, nested arrays one level deep, items follow the same rule', () => {
  assert.equal(html`${['<a>', raw('<b>'), null, false, 1]}`, '&lt;a&gt;<b>1');
  assert.equal(html`${['a', ['<b>', raw('<c>'), undefined], 'd']}`, 'a&lt;b&gt;<c>d');
  assert.equal(html`${[]}`, '');
});
test('html tag returns a plain string, so a nested html result is escaped unless wrapped in raw', () => {
  const inner = html`<i>${'x'}</i>`;
  assert.equal(typeof inner, 'string');
  assert.equal(html`${inner}`, '&lt;i&gt;x&lt;/i&gt;');
  assert.equal(html`${raw(inner)}`, '<i>x</i>');
});

test('fill replaces every occurrence of every known placeholder and does not escape', () => {
  assert.equal(
    fill('{{years}}/{{year}}/{{name}}/{{roleTitle}}/{{domain}} {{years}} {{name}}', ctx),
    '17/2026/Mojtaba Keivanlou/Senior/x.com 17 Mojtaba Keivanlou');
  assert.equal(fill('{{name}}', { ...ctx, name: 'A & <B>' }), 'A & <B>');
});
test('fill leaves text without placeholders alone and reports the offending placeholder', () => {
  assert.equal(fill('no placeholders {single} here', ctx), 'no placeholders {single} here');
  assert.throws(() => fill('hi {{nope}}', ctx), { message: 'Unknown placeholder {{nope}}' });
  assert.throws(() => fill('{{years}} {{ years }}', ctx), { message: 'Unknown placeholder {{ years }}' });
});
test('fill rejects inherited object keys as placeholders', () => {
  assert.throws(() => fill('{{constructor}}', ctx), { message: 'Unknown placeholder {{constructor}}' });
  assert.throws(() => fill('{{toString}}', ctx), /Unknown placeholder/);
});
test('fill does not rescan substituted values for placeholders', () => {
  assert.equal(fill('{{name}}', { ...ctx, name: '{{nope}}' }), '{{nope}}');
});

test('inlineText returns Raw', () => {
  assert.ok(inlineText('x', ctx) instanceof Raw);
});
test('inlineText: other placeholders are plain text and are escaped', () => {
  assert.equal(inlineText('{{name}} {{roleTitle}} {{domain}} {{year}}', { ...ctx, name: 'A <b> & "C"', roleTitle: "D'E" }).html,
    'A &lt;b&gt; &amp; &quot;C&quot; D&#39;E x.com 2026');
});
test('inlineText: years span appears for every occurrence and inside bold', () => {
  assert.equal(inlineText('**{{years}}** and {{years}}', ctx).html,
    '<strong><span data-years>17</span></strong> and <span data-years>17</span>');
});
test('inlineText throws on an unknown placeholder', () => {
  assert.throws(() => inlineText('a {{nope}}', ctx), { message: 'Unknown placeholder {{nope}}' });
});
test('inlineText: HTML in content cannot leak through the markers', () => {
  assert.equal(inlineText('**<script>alert(1)</script>** _<img src=x onerror=y>_', ctx).html,
    '<strong>&lt;script&gt;alert(1)&lt;/script&gt;</strong> <em>&lt;img src=x onerror=y&gt;</em>');
});
test('inlineText: italic at string start and end, nested with bold, and not inside words', () => {
  assert.equal(inlineText('_a_', ctx).html, '<em>a</em>');
  assert.equal(inlineText('x _a b_', ctx).html, 'x <em>a b</em>');
  assert.equal(inlineText('**_a_**', ctx).html, '<strong><em>a</em></strong>');
  assert.equal(inlineText('_**a**_', ctx).html, '<em><strong>a</strong></em>');
  assert.equal(inlineText('snake_case_name and a_b_', ctx).html, 'snake_case_name and a_b_');
  assert.equal(inlineText('_a_b', ctx).html, '_a_b');
});
test('inlineText: lone markers are left as written', () => {
  assert.equal(inlineText('2 * 3 ** 4 and _ alone', ctx).html, '2 * 3 ** 4 and _ alone');
});
test('inlineText: italic does not span lines', () => {
  assert.equal(inlineText('_a\nb_', ctx).html, '_a\nb_');
});
test('inlineText: a stray private-use character in the input never becomes a years span', () => {
  assert.equal(inlineText('ab {{years}}', ctx).html, 'ab <span data-years>17</span>');
});

test('richText returns Raw', () => {
  assert.ok(richText('x', ctx) instanceof Raw);
});
test('richText: blank lines may contain whitespace, paragraphs are trimmed, CRLF is handled', () => {
  assert.equal(richText('  one  \n \t \n\n  two\r\n\r\nthree  ', ctx).html, '<p>one</p><p>two</p><p>three</p>');
});
test('richText: a single newline stays inside its paragraph', () => {
  assert.equal(richText('one\ntwo', ctx).html, '<p>one\ntwo</p>');
});
test('richText: leading/trailing blank lines and empty input produce no empty paragraphs', () => {
  assert.equal(richText('\n\none\n\n', ctx).html, '<p>one</p>');
  assert.equal(richText('', ctx).html, '');
});
test('richText: markers, years and escaping work per paragraph; unknown placeholders throw', () => {
  assert.equal(richText('{{years}} <b>\n\n_i_ & **b**', ctx).html,
    '<p><span data-years>17</span> &lt;b&gt;</p><p><em>i</em> &amp; <strong>b</strong></p>');
  assert.throws(() => richText('ok\n\n{{nope}}', ctx), /Unknown placeholder/);
});

test('plainText: placeholders filled, text escaped, {{years}} kept live, bold and italic markers left alone', () => {
  const out = plainText('A & <b> **x** _y_ {{name}}, {{years}} years', ctx);
  assert.ok(out instanceof Raw);
  assert.equal(out.html, 'A &amp; &lt;b&gt; **x** _y_ Mojtaba Keivanlou, <span data-years>17</span> years');
  assert.equal(plainText('{{roleTitle}}', ctx).html, 'Senior');
  assert.throws(() => plainText('{{nope}}', ctx), /Unknown placeholder/);
});

test('frag: like html, but returns Raw so an enclosing html leaves it alone', () => {
  const inner = frag`<b>${'<i>'}</b>`;
  assert.ok(inner instanceof Raw);
  assert.equal(html`<p>${inner}</p>`, '<p><b>&lt;i&gt;</b></p>');
});
