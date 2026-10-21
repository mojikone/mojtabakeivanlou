// Education (spec 13.3): rows of degree, school, short school name and year (draft.site.education).

import { field, listEditor, card, el } from '../modules/ui.mjs';
import { schoolShortFrom } from '../modules/forms.mjs';
import { formSection, listAt, grid } from './_common.mjs';

const PATH = ['site', 'education'];

export function render(container, store) {
  return formSection(container, store, {
    title: 'Education',
    hint: 'Degrees, newest first: the About section, the CV and search engines.',
    keys: ['education'],
    build: (view) => card(null, listEditor({
      ...listAt(view, PATH),
      addLabel: '+ Add degree',
      empty: 'No degrees yet.',
      describe: (edu) => edu?.degree,
      newItem: () => ({ degree: '', school: '', schoolShort: '', year: '' }),
      renderItem: (edu, i) => row(view, edu, i),
    })),
  });
}

function row(view, edu, i) {
  const path = (key) => [...PATH, i, key];
  const short = field({
    label: 'School, short', value: edu?.schoolShort,
    hint: 'For search engines (alumniOf). Filled in from the school until you change it.',
    onInput: (v) => view.write.set(path('schoolShort'), v),
  });
  const shortInput = short.querySelector('.adm-input');

  // While the short name is empty or still the one derived from the school, it follows the school.
  const school = field({
    label: 'School', value: edu?.school,
    onInput: (v) => {
      const current = view.get().site.education?.[i];
      if (!current) return;
      const follows = !current.schoolShort || current.schoolShort === schoolShortFrom(current.school);
      const next = { ...current, school: v };
      if (follows) next.schoolShort = schoolShortFrom(v);
      view.write.set([...PATH, i], next);
      if (follows && document.activeElement !== shortInput) shortInput.value = next.schoolShort;
    },
  });

  return el('div', { class: 'adm-stack' },
    grid([
      field({ label: 'Degree', value: edu?.degree, onInput: (v) => view.write.set(path('degree'), v) }),
      field({ label: 'Year', value: edu?.year, placeholder: '2013', onInput: (v) => view.write.set(path('year'), v) }),
    ]),
    school,
    short);
}
