// The dashboard's sections (spec 13.3), in nav order. The shell (admin.mjs) builds the left nav from this list and
// shows the section named by location.hash (#profile, #education, ...).
//
// Contract for every section (Tasks 18-24 replace the placeholders one by one, keeping id, label and group):
//   render(container, store, ctx) -> optional teardown function
//     container  a fresh, empty <section class="adm-section"> inside the main area, owned by the section
//     store      the draft store (admin/modules/state.mjs), already init()ed: read with store.get(), write with
//                store.set / insert / remove / move / addPendingFile / removeFile. Every write updates the nav dots
//                and the top bar by itself (the shell subscribes); a section that shows derived values subscribes too.
//     ctx        { github, session }: the GitHub client (admin/modules/github.mjs) and the signed-in session
//                { entryId, vk, kek, github }. Never log or render session values.
//   The shell calls the teardown (if returned) before it shows another section: unsubscribe and drop listeners on
//   anything outside `container` there. Listeners on elements inside `container` die with it.
//   group  'content' or 'admin': the nav draws its separator where the group changes.

import { html } from '../../assets/js/render/html.mjs';

// A section that is not built yet: its heading and nothing else.
function comingSoon(id, label, group) {
  return {
    id,
    label,
    group,
    render(container) {
      container.innerHTML = html`<div class="adm-card"><h1 class="adm-title">${label} — coming soon</h1></div>`;
    },
  };
}

export const sections = [
  comingSoon('profile', 'Profile & contact', 'content'),
  comingSoon('education', 'Education', 'content'),
  comingSoon('languages', 'Languages', 'content'),
  comingSoon('services', 'Engineering services', 'content'),
  comingSoon('experience', 'Experience', 'content'),
  comingSoon('skills', 'Skills & software', 'content'),
  comingSoon('contact', 'Contact page', 'content'),
  comingSoon('access', 'Access codes', 'admin'),
  comingSoon('files', 'Files', 'admin'),
  comingSoon('settings', 'Settings', 'admin'),
];

// First-run setup (spec 13.2), reached through #setup with or without a session (there is no admin code yet the
// first time). Task 24 replaces it with the wizard. Same signature, but `store` is always null (the wizard needs no
// draft) and ctx is { github: null, session: null } when nobody is signed in.
export const setupSection = {
  id: 'setup',
  label: 'Setup',
  render(container) {
    container.innerHTML = html`<div class="adm-card"><h1 class="adm-title">Setup wizard — Task 24</h1></div>`;
  },
};
