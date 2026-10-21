// Engineering services (spec 13.3): the intro, then rows of icon, title, description and keywords
// (draft.site.services). Keywords are typed as one comma-separated line and stored as an array (spec 8).

import { field, listEditor, iconPicker, card, el, SERVICE_ICONS } from '../modules/ui.mjs';
import { keywordsFromText, keywordsToText } from '../modules/forms.mjs';
import { formSection, bound, listAt } from './_common.mjs';

const ITEMS = ['site', 'services', 'items'];

export function render(container, store) {
  return formSection(container, store, {
    title: 'Engineering services',
    hint: 'The Expertise section of the home page, and the services search engines see.',
    keys: ['services'],
    build: (view) => [
      card(null, bound(view, ['site', 'services', 'intro'], { label: 'Intro', type: 'textarea', rows: 2 })),
      card('Services', listEditor({
        ...listAt(view, ITEMS),
        addLabel: '+ Add service',
        empty: 'No services yet.',
        describe: (item) => item?.title,
        newItem: () => ({ title: '', icon: SERVICE_ICONS[0], description: '', keywords: [] }),
        renderItem: (item, i) => row(view, item, i),
      })),
    ],
  });
}

function row(view, item, i) {
  const path = (key) => [...ITEMS, i, key];
  return el('div', { class: 'adm-stack' },
    el('div', { class: 'adm-field' },
      el('span', { class: 'adm-label', text: 'Icon' }),
      iconPicker({
        value: item?.icon, names: SERVICE_ICONS, label: `Icon of ${item?.title || `service ${i + 1}`}`,
        onChange: (name) => view.write.set(path('icon'), name),
      })),
    field({ label: 'Title', value: item?.title, onInput: (v) => view.write.set(path('title'), v) }),
    field({ label: 'Description', type: 'textarea', value: item?.description, onInput: (v) => view.write.set(path('description'), v) }),
    field({
      label: 'Keywords', value: keywordsToText(item?.keywords),
      hint: 'Comma-separated. Not shown on the page: search engines read them as the services you offer.',
      onInput: (v) => view.write.set(path('keywords'), keywordsFromText(v)),
    }));
}
