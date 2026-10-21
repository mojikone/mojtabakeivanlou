// Profile & contact (spec 13.3): names, titles, texts, stats, contact details, location, business card.
// Every value lives under draft.site.profile (spec 8).

import { field, listEditor, iconPicker, card, el, SERVICE_ICONS } from '../modules/ui.mjs';
import { phoneToE164 } from '../../assets/js/render/model.mjs';
import { formSection, bound, boundPair, listAt, grid, readout, checkbox } from './_common.mjs';

const P = ['site', 'profile'];
const at = (...rest) => [...P, ...rest];

export function render(container, store) {
  return formSection(container, store, {
    title: 'Profile & contact',
    hint: 'Who you are and how to reach you: the home page, the CV, the contact page and the business card.',
    keys: ['profile'],
    build: (view) => [
      card('Name and titles', [
        grid([bound(view, at('firstName'), { label: 'First name' }), bound(view, at('lastName'), { label: 'Last name' })]),
        bound(view, at('roleTitle'), { label: 'Role title', hint: 'Short form: the CV header, page titles and {{roleTitle}}.' }),
        bound(view, at('roleTitleLong'), { label: 'Role title, long', hint: 'The heading of the About section.' }),
        boundPair(view, at('heroHeadline'), 'Hero headline', 'The role in the hero, on two lines; the second shows in the accent colour.'),
        bound(view, at('roleSubtitle'), { label: 'Subtitle', hint: 'Under the About heading, and after the role on the CV.' }),
      ]),
      card('Texts', [
        bound(view, at('quote'), { label: 'Quote', type: 'rich', inline: true, hint: 'One line, in the About section.' }),
        bound(view, at('bio'), { label: 'Bio', type: 'rich', hint: 'The About section of the home page.' }),
        bound(view, at('cvSummary'), { label: 'CV summary', type: 'rich', hint: 'The summary at the top of the CV.' }),
      ]),
      card('Stats', [
        el('p', { class: 'adm-card-hint', text: 'Three figures: Label on the home page, CV label on the CV. {{years}} keeps the years current.' }),
        listEditor({
          ...listAt(view, at('stats')),
          fixed: true,
          describe: (stat) => stat?.label,
          renderItem: (stat, i) => grid([
            field({ label: 'Value', value: stat?.value, onInput: (v) => view.write.set(at('stats', i, 'value'), v) }),
            field({ label: 'Suffix', value: stat?.suffix, placeholder: 'none', onInput: (v) => view.write.set(at('stats', i, 'suffix'), v) }),
            field({ label: 'Label', value: stat?.label, onInput: (v) => view.write.set(at('stats', i, 'label'), v) }),
            field({ label: 'CV label', value: stat?.cvLabel, onInput: (v) => view.write.set(at('stats', i, 'cvLabel'), v) }),
          ], 4),
        }),
      ]),
      card('Contact', [
        bound(view, at('email'), { label: 'Email', type: 'email' }),
        phone(view),
        bound(view, at('linkedin'), { label: 'LinkedIn', type: 'url', placeholder: 'https://linkedin.com/in/…', hint: 'The full address, starting with https://…' }),
      ]),
      card('Location', [
        grid([
          bound(view, at('location', 'city'), { label: 'City', hint: 'The CV, the contact page and search engines.' }),
          bound(view, at('location', 'country'), { label: 'Country', hint: 'The CV and the contact page.' }),
          bound(view, at('location', 'short'), { label: 'Short form', hint: 'The hero and the footer, e.g. "Muscat, Oman".' }),
          bound(view, at('location', 'countryCode'), { label: 'Country code', hint: 'Two letters, for search engines (OM).' }),
        ]),
      ]),
      card('Business card', [
        el('p', { class: 'adm-card-hint', text: 'Front: three title lines. Back: a grid of nine cells, each a label and an icon.' }),
        grid([0, 1, 2].map((i) => bound(view, at('businessCard', 'titleLines', i), { label: `Title line ${i + 1}` })), 3),
        el('h3', { class: 'adm-sub', text: 'Cells' }),
        listEditor({
          ...listAt(view, at('businessCard', 'cells')),
          fixed: true,
          describe: (cell) => cell?.label,
          renderItem: (cell, i) => el('div', { class: 'adm-cell-row' },
            field({ label: 'Label', value: cell?.label, onInput: (v) => view.write.set(at('businessCard', 'cells', i, 'label'), v) }),
            iconPicker({
              value: cell?.icon, names: SERVICE_ICONS, label: `Icon of ${cell?.label || `cell ${i + 1}`}`,
              onChange: (name) => view.write.set(at('businessCard', 'cells', i, 'icon'), name),
            })),
        }),
      ]),
    ],
  });
}

// Phone (spec 8): e164 is derived from the display number (digits only, leading +) and whatsapp is e164 without the +.
// The dashboard stores both. "Enter WhatsApp number manually" (profile.phoneOverride) makes whatsapp editable.
function phone(view) {
  const profile = () => view.get().site.profile;
  const e164 = readout('Phone link (derived)');
  const whatsappField = field({
    label: 'WhatsApp number',
    value: profile().whatsapp,
    hint: 'Digits only, with the country code and no +.',
    onInput: (v) => { if (profile().phoneOverride === true) view.write.set(at('whatsapp'), v); },
  });
  const whatsappInput = whatsappField.querySelector('.adm-input');

  const writeDisplay = (display) => {
    const p = profile();
    const next = { ...p, phone: { ...p.phone, display, e164: phoneToE164(display) } };
    if (p.phoneOverride !== true) next.whatsapp = next.phone.e164.slice(1);
    view.write.set(P, next);
  };
  const setOverride = (on) => {
    const { phoneOverride, ...rest } = profile();   // off: the key goes, so the profile can be clean again
    const next = on ? { ...rest, phoneOverride: true } : rest;
    if (!on) next.whatsapp = phoneToE164(rest.phone?.display ?? '').slice(1);
    view.write.set(P, next);
    if (on) whatsappInput.focus();
  };

  view.derive((draft) => {
    const p = draft.site.profile;
    e164.set(p.phone?.e164 ?? '');
    const manual = p.phoneOverride === true;
    whatsappInput.readOnly = !manual;
    whatsappInput.classList.toggle('adm-input-ro', !manual);
    if (!manual && whatsappInput.value !== (p.whatsapp ?? '')) whatsappInput.value = p.whatsapp ?? '';
  });

  return el('div', { class: 'adm-phone' },
    field({ label: 'Phone', value: profile().phone?.display, hint: 'As shown on the site, e.g. +968 9297 0635.', onInput: writeDisplay }),
    el('div', { class: 'adm-derived' },
      e164.node,
      whatsappField,
      checkbox({ label: 'Enter WhatsApp number manually', checked: profile().phoneOverride === true, onChange: setOverride })));
}
