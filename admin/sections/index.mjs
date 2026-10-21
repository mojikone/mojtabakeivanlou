// The dashboard's sections (spec 13.3), in nav order. The shell (admin.mjs) builds the left nav from this list and
// shows the section named by location.hash (#profile, #education, ...).
//
// Contract for every section (each is ./<id>.mjs, built in Tasks 18-23; ids, labels and groups as in spec 13.3):
//   render(container, store, ctx) -> optional teardown function
//     container  a fresh, empty <section class="adm-section"> inside the main area, owned by the section
//     store      the draft store (admin/modules/state.mjs), already init()ed: read with store.get(), write with
//                store.set / insert / remove / move / addPendingFile / removeFile. Every write updates the nav dots
//                and the top bar by itself (the shell subscribes); a section that shows derived values subscribes too.
//     ctx        { github, session, fileStore, onTokenExpiry }: the GitHub client (admin/modules/github.mjs), the
//                signed-in session { entryId, vk, kek, github } and the pending-file store (admin/modules/files.mjs).
//                Never log or render session values. A section that changes the session (a new admin code or GitHub token) calls
//                sessionChanged() of admin/modules/codes.mjs; the shell's onSessionChanged handler applies it and
//                mounts the section again. ctx.onTokenExpiry() tells the top bar that Settings changed the token's
//                expiry date (localStorage mk.tokenExpires).
//   The shell calls the teardown (if returned) before it shows another section: unsubscribe and drop listeners on
//   anything outside `container` there. Listeners on elements inside `container` die with it.
//   Form sections are built with formSection() (./_common.mjs), which owns the re-render rule that keeps the focus and
//   the caret while the owner types, and the controls of ../modules/ui.mjs.
//   group  'content' or 'admin': the nav draws its separator where the group changes.

import { html } from '../../assets/js/render/html.mjs';
import * as profile from './profile.mjs';
import * as education from './education.mjs';
import * as languages from './languages.mjs';
import * as services from './services.mjs';
import * as experience from './experience.mjs';
import * as contact from './contact.mjs';
import * as skills from './skills.mjs';
import * as access from './access.mjs';
import * as files from './files.mjs';
import * as settings from './settings.mjs';

export const sections = [
  { id: 'profile', label: 'Profile & contact', group: 'content', render: profile.render },
  { id: 'education', label: 'Education', group: 'content', render: education.render },
  { id: 'languages', label: 'Languages', group: 'content', render: languages.render },
  { id: 'services', label: 'Engineering services', group: 'content', render: services.render },
  { id: 'experience', label: 'Experience', group: 'content', render: experience.render },
  { id: 'skills', label: 'Skills & software', group: 'content', render: skills.render },
  { id: 'contact', label: 'Contact page', group: 'content', render: contact.render },
  { id: 'access', label: 'Access codes', group: 'admin', render: access.render },
  { id: 'files', label: 'Files', group: 'admin', render: files.render },
  { id: 'settings', label: 'Settings', group: 'admin', render: settings.render },
];

// First-run setup (spec 13.2): the wizard of ../modules/setup.mjs, reached through #setup. The shell shows it on its own,
// and only while nobody is signed in (admin.mjs sends a signed-in owner to #profile). Same signature as a section, but
// `store` is always null (the wizard needs no draft) and ctx is { github: null, session: null }; the wizard builds its
// own GitHub client from the token the owner pastes. render returns the teardown that empties the secret fields.
import { runSetup } from '../modules/setup.mjs';
import { createGitHub } from '../modules/github.mjs';

export const setupSection = {
  id: 'setup',
  label: 'Setup',
  render(container) {
    return runSetup(container, { createGitHub });
  },
};
