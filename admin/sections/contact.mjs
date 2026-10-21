// Contact page (spec 13.3): the contact page's heading, project types, description placeholder and form subject, the
// thank-you page, and the call to action that closes the home page (draft.site.contactPage, .thankYou, .cta and
// .site.formSubject).

import { field, listEditor, card, el } from '../modules/ui.mjs';
import { formSection, bound, boundPair, listAt } from './_common.mjs';

const TYPES = ['site', 'contactPage', 'projectTypes'];

export function render(container, store) {
  return formSection(container, store, {
    title: 'Contact page',
    hint: 'The contact form, the page after sending it, and the call to action at the end of the home page.',
    keys: ['contactPage', 'thankYou', 'cta', 'site.formSubject'],
    build: (view) => [
      card('Contact page', [
        boundPair(view, ['site', 'contactPage', 'heading'], 'Heading'),
        el('div', { class: 'adm-field' },
          el('span', { class: 'adm-label', text: 'Project types' }),
          el('p', { class: 'adm-hint adm-hint-top', text: 'The choices of the form\'s project type menu, in this order.' }),
          listEditor({
            ...listAt(view, TYPES),
            addLabel: '+ Add project type',
            empty: 'No project types yet: the form needs at least one.',
            describe: (type) => type,
            newItem: () => '',
            renderItem: (type, i) => el('div', { class: 'adm-compact' },
              field({ label: `Project type ${i + 1}`, value: type, onInput: (v) => view.write.set([...TYPES, i], v) })),
          })),
        bound(view, ['site', 'contactPage', 'descriptionPlaceholder'], {
          label: 'Description placeholder', type: 'textarea', rows: 2, hint: 'The grey sample text in the empty message box.',
        }),
        bound(view, ['site', 'site', 'formSubject'], { label: 'Form subject', hint: 'The subject line of the enquiry emails you receive.' }),
      ]),
      card('Thank-you page', [
        boundPair(view, ['site', 'thankYou', 'heading'], 'Heading'),
        bound(view, ['site', 'thankYou', 'text'], { label: 'Text', type: 'textarea', rows: 3 }),
      ]),
      card('Call to action', [
        el('p', { class: 'adm-card-hint', text: 'The dark closing section of the home page.' }),
        boundPair(view, ['site', 'cta', 'heading'], 'Heading'),
        bound(view, ['site', 'cta', 'sub'], { label: 'Text', type: 'textarea', rows: 2 }),
      ]),
    ],
  });
}
