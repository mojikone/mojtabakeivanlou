// Languages (spec 13.3): rows of name and level (draft.site.languages).

import { field, listEditor, card } from '../modules/ui.mjs';
import { formSection, listAt, grid } from './_common.mjs';

const PATH = ['site', 'languages'];

export function render(container, store) {
  return formSection(container, store, {
    title: 'Languages',
    hint: 'The languages you work in and how well: the About section and the CV.',
    keys: ['languages'],
    build: (view) => card(null, listEditor({
      ...listAt(view, PATH),
      addLabel: '+ Add language',
      empty: 'No languages yet.',
      describe: (lang) => lang?.name,
      newItem: () => ({ name: '', level: '' }),
      renderItem: (lang, i) => grid([
        field({ label: 'Language', value: lang?.name, onInput: (v) => view.write.set([...PATH, i, 'name'], v) }),
        field({ label: 'Level', value: lang?.level, placeholder: 'Fluent', onInput: (v) => view.write.set([...PATH, i, 'level'], v) }),
      ]),
    })),
  });
}
