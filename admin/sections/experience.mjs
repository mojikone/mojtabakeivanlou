// Experience (spec 13.3): the intro, then companies, each holding projects, each holding bullets; a bullet can carry
// files (draft.site.experience). A file is encrypted the moment it is picked or dropped (spec 12, files.mjs): its
// ciphertext waits in the pending-file store (ctx.fileStore), the draft gets its record (in the bullet and in
// draft.pending) and its key wrapped under the vault key (draft.keys.files), and Publish uploads it.
//
// Folding: companies and projects fold. The open ones are remembered for the session by id (OPEN), because rows are
// rebuilt whenever their list changes. A company or project without an id yet (a new one) shows open; it gets its id,
// slugify(name) unique among all company and project ids, the first time a name is entered, and keeps it (spec 8).
//
// Late writes: rows write with the indexes they were built with, which holds while they are on screen. An Undo and
// an upload that finishes can come after their rows were rebuilt, so they find their place again (companies and
// projects by id, bullets by a token, see BULLETS) and, when their rows have left the document, write to the store
// directly: formSection counts that as foreign and rebuilds the form, so the change shows.

import { field, listEditor, toast, card, el, svg } from '../modules/ui.mjs';
import { prepareUpload, isLarge } from '../modules/files.mjs';
import { inflight } from '../modules/inflight.mjs';
import { FILE_MAX, FILE_NOTE } from '../modules/limits.mjs';
import { importKey, formatSize } from '../../assets/js/vault.mjs';
import { slugify } from '../../assets/js/render/model.mjs';
import { formSection, bound, checkbox, getIn, grid } from './_common.mjs';

const EXPERIENCE = ['site', 'experience'];
const COMPANIES = [...EXPERIENCE, 'companies'];
const LIMITS = { FILE_MAX, FILE_NOTE };
const MB = 1024 * 1024;
const GCM_EXTRA = 28;                       // IV and tag added to every ciphertext (files.mjs)

// Ids of the companies and projects shown open: module state, so it lasts for the session, across visits.
const OPEN = new Set();

// Bullets have no id. A bullet with an upload or an Undo in flight gets a token, kept here against the bullet object;
// every write this section makes into a bullet hands the token on to the bullet's new object (carry()), and moving
// rows keeps the objects. So a late write finds its bullet wherever it is now, or learns that it is gone.
const BULLETS = new WeakMap();

let seq = 0;
const nextId = (prefix) => `${prefix}-${++seq}`;
const isObject = (x) => x !== null && typeof x === 'object';
const asList = (x) => (Array.isArray(x) ? x : []);
const text = (x) => (typeof x === 'string' ? x.trim() : '');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const isFileDrag = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
const isPending = (draft, id) => asList(draft?.pending).some((f) => f?.id === id);

// view.write while `node` is on screen; the store itself (a foreign write: the form is rebuilt) once it is not.
const writer = (ctx, node) => (node?.isConnected ? ctx.view.write : ctx.store);

export function render(container, store, { session, fileStore } = {}) {
  const teardown = formSection(container, store, {
    title: 'Experience',
    hint: 'The Experience timeline of the home page and the CV. Files attached to a bullet are encrypted; visitors need an access code to download them.',
    keys: ['experience'],
    build: (view) => {
      const ctx = { view, store, session, fileStore };
      return [
        card(null, bound(view, [...EXPERIENCE, 'intro'], {
          label: 'Intro', type: 'textarea', rows: 2, hint: 'Beside the timeline. {{years}} becomes the years of experience.',
        })),
        card('Companies', nested(ctx, null, 'companies', () => {}, {
          addLabel: '+ Add company',
          empty: 'No companies yet.',
          describe: (company) => company?.name,
          newItem: () => ({ id: '', name: '', period: '', current: false, role: '', location: '', summary: '', expandLabel: '', projects: [] }),
          renderItem: (company, ci) => companyRow(ctx, company, ci),
        })),
      ];
    },
  });
  // A file dropped beside a drop zone would make the browser open it in place of the dashboard.
  const ignore = (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    if (e.type === 'dragover') e.dataTransfer.dropEffect = 'none';
  };
  container.addEventListener('dragover', ignore);
  container.addEventListener('drop', ignore);
  return teardown;
}

/* ─── LISTS ─── */

// The path of a company ({ id, index }) or a project ({ company, id, index }) now: by id, or by index while the item
// has no id yet. null when it is gone.
function pathOf(draft, ref) {
  const up = ref.company ? pathOf(draft, ref.company) : EXPERIENCE;
  if (!up) return null;
  const key = ref.company ? 'projects' : 'companies';
  const list = asList(getIn(draft, [...up, key]));
  const index = ref.id ? list.findIndex((item) => item?.id === ref.id) : (ref.index < list.length ? ref.index : -1);
  return index < 0 ? null : [...up, key, index];
}

const hasIds = (ref) => Boolean(ref.id) && (!ref.company || hasIds(ref.company));

// The path of the list `key` (companies, projects, bullets) of the company or project `ref` (of the experience itself
// when ref is null), or null. `attached`: the list asking is on screen, so its row's indexes are current. A detached
// list (an Undo after its parent list re-rendered) has stale indexes and is placed by ids only: below a company or
// project without an id yet it is not placed at all, rather than in whichever item now holds the old index.
export function listPath(draft, ref, key, attached) {
  if (!ref) return [...EXPERIENCE, key];
  if (!attached && !hasIds(ref)) return null;
  const up = pathOf(draft, ref);
  return up && [...up, key];
}

// listEditor over the list `key` of the company or project `ref` (see listPath). Removing an item releases the files
// inside it, putting it back restores them.
function nested(ctx, ref, key, onChange, opts) {
  let list = null;                          // the editor's root; at() already runs while it is being built
  const at = () => listPath(ctx.view.get(), ref, key, !list || list.isConnected);
  list = listEditor({
    ...opts,
    items: () => {
      const path = at();
      return path ? asList(getIn(ctx.view.get(), path)) : [];
    },
    onInsert: (index, item) => {
      const path = at();
      if (!path) {                          // only a late Undo gets here: "+ Add" comes from a list on screen
        toast(`Could not put the item back — its parent ${hasIds(ref) ? 'was removed' : 'moved'}`);
        return;
      }
      const w = writer(ctx, list);
      w.insert(path, index, item);
      restore(w, ctx.view.get(), item);
      onChange();
    },
    onRemove: (index) => {
      const path = at();
      if (!path) return;
      const item = getIn(ctx.view.get(), [...path, index]);
      const w = writer(ctx, list);
      w.remove(path, index);
      release(w, ctx.view.get(), item);
      onChange();
    },
    onMove: (from, to) => {
      const path = at();
      if (path) writer(ctx, list).move(path, from, to);
    },
  });
  return list;
}

// The file records inside a company, project or bullet.
function filesIn(node) {
  if (!isObject(node)) return [];
  if (Array.isArray(node.projects)) return node.projects.flatMap(filesIn);
  if (Array.isArray(node.bullets)) return node.bullets.flatMap(filesIn);
  return asList(node.files).filter(isObject);
}

// A removed company, project or bullet takes its files out of the draft as removeFile() does one by one: a pending
// file is no longer uploaded, a committed one is deleted on publish. The ciphertexts stay in the file store, so the
// Undo of the row (restore()) can bring the files back.
function release(w, draft, node) {
  const files = filesIn(node);
  if (files.length === 0) return;
  const ids = new Set(files.map((f) => f.id));
  const pending = asList(draft.pending);
  const deleted = asList(draft.deleted);
  const committed = [...ids].filter((id) => !isPending(draft, id) && !deleted.includes(id));
  if (pending.some((f) => ids.has(f?.id))) w.set(['pending'], pending.filter((f) => !ids.has(f?.id)));
  if (committed.length) w.set(['deleted'], [...deleted, ...committed]);
}

// The reverse, for a row put back: an id in `deleted` was committed and leaves it again; any other was pending.
function restore(w, draft, node) {
  const files = filesIn(node);
  if (files.length === 0) return;
  const deleted = asList(draft.deleted);
  const back = new Set(files.map((f) => f.id).filter((id) => deleted.includes(id)));
  const again = files.filter((f) => !back.has(f.id) && !isPending(draft, f.id));
  if (back.size) w.set(['deleted'], deleted.filter((id) => !back.has(id)));
  if (again.length) w.set(['pending'], [...asList(draft.pending), ...again.map((f) => ({ ...f }))]);
}

export { release as releaseFiles, restore as restoreFiles };   // for test/experience.test.mjs

/* ─── FOLDING ROWS ─── */

// A header button with the row's summary line over a body that is built the first time it opens.
function fold({ id, title, build }) {
  let key = id;
  let built = false;
  const label = el('span', { class: 'adm-fold-title', text: title });
  const body = el('div', { class: 'adm-fold-body', id: nextId('adm-fold') });
  const head = el('button', { type: 'button', class: 'adm-fold-head', 'aria-controls': body.id },
    el('span', { class: 'adm-fold-chev', 'aria-hidden': 'true' }), label);
  const show = (open) => {
    if (open && !built) {
      built = true;
      body.append(...[build()].flat().filter(Boolean));
    }
    body.hidden = !open;
    head.setAttribute('aria-expanded', String(open));
  };
  head.addEventListener('click', () => {
    const open = body.hidden;
    if (key && open) OPEN.add(key);
    else if (key) OPEN.delete(key);
    show(open);
  });
  show(!key || OPEN.has(key));
  return {
    node: el('div', { class: 'adm-fold' }, head, body),
    title: (next) => { if (label.textContent !== next) label.textContent = next; },
    named: (next) => {
      key = next;
      if (!body.hidden) OPEN.add(next);
    },
  };
}

const takenIds = (draft) => new Set(asList(getIn(draft, COMPANIES)).flatMap((company) => [
  company?.id, ...asList(company?.projects).map((project) => project?.id),
]).filter((id) => typeof id === 'string' && id !== ''));

// The name of a company or project at `base`. The first time a name is entered (on change, so the slug is made from
// the whole name, not from the first letters typed) an item without an id gets slugify(name); it is never changed.
function nameField(ctx, ref, base, onName, onId) {
  const { view } = ctx;
  const wrap = field({
    label: 'Name', value: getIn(view.get(), base)?.name,
    onInput: (v) => { view.write.set([...base, 'name'], v); onName(); },
  });
  wrap.querySelector('.adm-input').addEventListener('change', () => {
    const item = getIn(view.get(), base);
    if (!isObject(item) || item.id || !text(item.name)) return;
    const id = slugify(text(item.name), takenIds(view.get()));
    view.write.set([...base, 'id'], id);
    ref.id = id;
    onId(id);
  });
  return wrap;
}

// The read-only id, filled in place when the name makes it: returns [node, set(id)].
function idField(value, hint) {
  const wrap = field({ label: 'Id', value, readOnly: true, placeholder: 'made from the name', hint });
  const input = wrap.querySelector('.adm-input');
  return [wrap, (id) => { input.value = id; }];
}

/* ─── COMPANY ─── */

const companyTitle = (c) => [text(c?.name) || 'New company', text(c?.period), plural(asList(c?.projects).length, 'project')]
  .filter(Boolean).join(' · ');
const defaultExpand = (c) => (asList(c?.projects).length === 1 ? 'View project' : 'View all projects');

function companyRow(ctx, company, ci) {
  const { view } = ctx;
  const ref = { id: company?.id || '', index: ci };
  const base = [...COMPANIES, ci];
  const now = () => getIn(view.get(), base);
  const set = (key, value) => view.write.set([...base, key], value);
  let expand = null;                        // the expand label's input, once the body is built

  // fold() may build the body at once (an open row), so everything body() uses is declared before it or hoisted.
  const row = fold({ id: ref.id, title: companyTitle(company), build: body });
  function retitle() {
    row.title(companyTitle(now()));
    if (expand) expand.placeholder = defaultExpand(now());
  }

  function body() {
    const c = now() ?? {};
    const [id, setId] = idField(c.id, 'Made once from the name; the page uses it to link to this company.');
    const label = field({
      label: 'Expand label', value: c.expandLabel, placeholder: defaultExpand(c),
      hint: 'The button that opens the projects. Empty: the default shown.',
      onInput: (v) => set('expandLabel', v),
    });
    expand = label.querySelector('.adm-input');
    return [
      grid([
        nameField(ctx, ref, base, retitle, (next) => { setId(next); row.named(next); }),
        field({ label: 'Period', value: c.period, placeholder: '2022 – Present', onInput: (v) => { set('period', v); retitle(); } }),
      ]),
      checkbox({ label: 'Current employer', checked: c.current === true, onChange: (on) => set('current', on) }),
      grid([
        field({ label: 'Role', value: c.role, onInput: (v) => set('role', v) }),
        field({ label: 'Location', value: c.location, onInput: (v) => set('location', v) }),
      ]),
      field({ label: 'Summary', type: 'textarea', value: c.summary, onInput: (v) => set('summary', v) }),
      grid([label, id]),
      el('h3', { class: 'adm-sub', text: 'Projects' }),
      nested(ctx, ref, 'projects', retitle, {
        addLabel: '+ Add project',
        empty: 'No projects yet.',
        describe: (project) => project?.name,
        newItem: () => ({ id: '', name: '', period: '', role: '', scope: '', bullets: [] }),
        renderItem: (project, pi) => projectRow(ctx, ref, project, [...base, 'projects', pi], pi),
      }),
    ];
  }

  return row.node;
}

/* ─── PROJECT ─── */

const projectTitle = (p) => [text(p?.name) || 'New project', text(p?.period), plural(asList(p?.bullets).length, 'bullet')]
  .filter(Boolean).join(' · ');

function projectRow(ctx, companyRef, project, base, pi) {
  const { view } = ctx;
  const ref = { company: companyRef, id: project?.id || '', index: pi };
  const now = () => getIn(view.get(), base);
  const set = (key, value) => view.write.set([...base, key], value);

  // fold() may build the body at once (an open row), so everything body() uses is declared before it or hoisted.
  const row = fold({ id: ref.id, title: projectTitle(project), build: body });
  function retitle() {
    row.title(projectTitle(now()));
  }

  function body() {
    const p = now() ?? {};
    const [id, setId] = idField(p.id, 'Made once from the name; the page uses it to link to this project.');
    return [
      grid([
        nameField(ctx, ref, base, retitle, (next) => { setId(next); row.named(next); }),
        field({ label: 'Period', value: p.period, placeholder: 'Jan 2026 – Present', onInput: (v) => { set('period', v); retitle(); } }),
      ]),
      grid([
        field({ label: 'Role', value: p.role, hint: 'Optional.', onInput: (v) => set('role', v) }),
        field({ label: 'Scope', value: p.scope, hint: 'Optional.', onInput: (v) => set('scope', v) }),
      ]),
      grid([id, el('div')]),
      el('h3', { class: 'adm-sub', text: 'Bullets' }),
      nested(ctx, ref, 'bullets', retitle, {
        addLabel: '+ Add bullet',
        empty: 'No bullets yet.',
        describe: (bullet) => bullet?.text,
        newItem: () => ({ text: '', files: [] }),
        renderItem: (bullet, bi) => bulletRow(ctx, bullet, [...base, 'bullets', bi]),
      }),
    ];
  }

  return row.node;
}

/* ─── BULLET AND ITS FILES ─── */

function tokenOf(bullet) {
  if (!isObject(bullet)) return null;
  if (!BULLETS.has(bullet)) BULLETS.set(bullet, {});
  return BULLETS.get(bullet);
}

// Where the bullet holding `token` is now, or null.
function findBullet(draft, token) {
  if (!token) return null;
  const companies = asList(getIn(draft, COMPANIES));
  for (let ci = 0; ci < companies.length; ci++) {
    const projects = asList(companies[ci]?.projects);
    for (let pi = 0; pi < projects.length; pi++) {
      const bi = asList(projects[pi]?.bullets).findIndex((b) => isObject(b) && BULLETS.get(b) === token);
      if (bi >= 0) return [...COMPANIES, ci, 'projects', pi, 'bullets', bi];
    }
  }
  return null;
}

// Runs write(), which changes the bullet at `path`, and hands the bullet's token (if any) on to its new object.
function carry(ctx, path, write) {
  const before = getIn(ctx.view.get(), path);
  const token = isObject(before) ? BULLETS.get(before) : undefined;
  write();
  const after = getIn(ctx.view.get(), path);
  if (token && isObject(after)) BULLETS.set(after, token);
}

// Deletes a pending file's ciphertext once nothing can bring the file back.
function dropBlob(ctx, id) {
  if (isPending(ctx.store.get(), id)) return;
  ctx.fileStore?.delete(id).catch(() => { /* an orphan in the browser's store is harmless */ });
}

function bulletRow(ctx, bullet, base) {
  const { view } = ctx;
  const filesPath = [...base, 'files'];
  const now = () => getIn(view.get(), base);
  const files = () => asList(now()?.files);
  let replacing = null;                     // the file a pick replaces

  const line = field({
    label: 'Bullet', value: bullet?.text,
    onInput: (v) => carry(ctx, base, () => view.write.set([...base, 'text'], v)),
  });
  const panel = el('div', { class: 'adm-files', id: nextId('adm-files') });
  const count = el('span', { class: 'adm-clip-count' });
  const clip = el('button', { type: 'button', class: 'adm-clip', 'aria-controls': panel.id, onclick: () => toggle(panel.hidden) },
    svg('paperclip', { width: '14', height: '14' }), count);
  const list = el('div');
  const uploads = el('div', { class: 'adm-uploads' });
  const add = el('button', { type: 'button', class: 'adm-add', onclick: () => pick(null) });
  const input = el('input', { type: 'file', multiple: true, hidden: true, tabIndex: -1 });
  panel.append(list, uploads, el('div', { class: 'adm-drop' }, add, el('span', { text: 'or drop files here' }), input));
  const block = el('div', { class: 'adm-compact adm-bullet' }, el('div', { class: 'adm-bullet-line' }, line, clip), panel);

  function toggle(open) {
    panel.hidden = !open;
    clip.setAttribute('aria-expanded', String(open));
  }
  function pick(file) {
    replacing = file;
    input.multiple = !file;
    input.click();
  }
  input.addEventListener('change', () => {
    const picked = [...input.files];
    input.value = '';                       // the same file can be picked again
    attach(picked, replacing);
    replacing = null;
  });

  // Drops anywhere on the bullet attach the files (row drags of the lists carry no files and pass through).
  block.addEventListener('dragover', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    block.classList.add('is-drop');
  });
  block.addEventListener('dragleave', (e) => { if (!block.contains(e.relatedTarget)) block.classList.remove('is-drop'); });
  block.addEventListener('drop', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    block.classList.remove('is-drop');
    attach([...e.dataTransfer.files], null);
  });

  // This row again after a change of its files, while it is on screen (a rebuilt form shows the change by itself).
  const repaint = () => {
    if (!block.isConnected) return;
    paint();
    toggle(true);
  };

  function paint() {
    const current = files();
    count.textContent = current.length ? String(current.length) : '';
    const label = current.length ? `${plural(current.length, 'file')} attached` : 'Attach files';
    clip.title = label;
    clip.setAttribute('aria-label', label);
    add.textContent = current.length ? '+ Add another file' : '+ Add a file';
    list.replaceChildren(...(current.length ? [filesList()] : []));
  }

  function filesList() {
    const editor = listEditor({
      items: files,
      onMove: (from, to) => carry(ctx, base, () => writer(ctx, editor).move(filesPath, from, to)),
      fixed: true,
      describe: (file) => file?.name,
      renderItem: (file, index) => fileRow(file, index),
    });
    return editor;
  }

  function fileRow(file, index) {
    const name = typeof file?.name === 'string' ? file.name : '';
    const size = Number.isFinite(file?.size) && file.size >= 0 ? file.size : null;
    const plain = file?.enc === false;
    return el('div', { class: 'adm-file' },
      el('div', { class: 'adm-file-line' },
        el('span', { class: 'adm-file-name', text: name, title: name }),
        size === null ? null : el('span', { class: 'adm-file-size', text: formatSize(size) }),
        el('span', { class: `adm-badge${plain ? ' is-plain' : ''}`, text: plain ? 'plain' : 'encrypted' }),
        el('span', { class: 'adm-file-acts' },
          el('button', { type: 'button', class: 'adm-linkbtn', 'aria-label': `Replace ${name}`, onclick: () => pick(file) }, 'replace'),
          el('button', { type: 'button', class: 'adm-linkbtn adm-linkbtn-danger', 'aria-label': `Remove ${name}`, onclick: () => remove(file, index) }, 'remove'))),
      size !== null && isLarge(size, LIMITS) ? el('p', { class: 'adm-file-note', text: largeNote(size) }) : null);
  }

  // Remove with Undo: the same record goes back. A pending file's ciphertext is deleted only once the toast is gone.
  function remove(file, index) {
    const wasPending = isPending(view.get(), file.id);
    carry(ctx, base, () => view.write.removeFile(base, file.id));
    const token = tokenOf(now());
    paint();
    const removes = list.querySelectorAll('.adm-linkbtn-danger');
    (removes[Math.min(index, removes.length - 1)] ?? add).focus();
    toast(`Removed ${file.name}`, {
      actionLabel: 'Undo',
      onAction: () => putBack(ctx, token, file, index, wasPending, block, repaint),
      onClose: (undone) => { if (!undone && wasPending) dropBlob(ctx, file.id); },
    });
  }

  // The whole batch counts as in flight (inflight.mjs): Publish waits until its last file is placed, so no late file
  // is dropped by the rebase after a publish or wrapped under a vault key the publish rotated away.
  async function attach(picked, replaced) {
    if (picked.length === 0) return;
    const done = inflight.begin('attachments');
    try {
      await encryptAll(picked, replaced);
    } finally {
      done();
    }
  }

  // Encrypts the files one after the other (one file's bytes in memory at a time) with the session's vault key.
  async function encryptAll(picked, replaced) {
    toggle(true);
    const token = tokenOf(now());
    const rows = picked.map((file) => progress(file));
    uploads.append(...rows.map((r) => r.node));
    let vk;
    try {
      vk = await importKey(ctx.session?.vk);
    } catch {
      rows.forEach((r) => r.node.remove());
      toast('This session has no usable vault key: sign out and sign in again to attach files');
      return;
    }
    for (const [i, file] of picked.entries()) {
      rows[i].encrypting();
      try {
        const prepared = await prepareUpload(file, vk, { limits: LIMITS, fileStore: ctx.fileStore });
        place(ctx, token, prepared, replaced, block, repaint);
      } catch (err) {
        toast(failure(file, err));
      } finally {
        rows[i].node.remove();
      }
    }
  }

  paint();
  toggle(files().length > 0);
  return block;
}

// Puts an encrypted file into the bullet holding `token`: the record (bullet and draft.pending) and its wrapped key
// (draft.keys.files). A replacement takes the replaced file's place in the list, and the replaced file is removed as
// by removeFile (a pending one's ciphertext is deleted at once: a replace has no Undo).
function place(ctx, token, { record, wrapped }, replaced, node, done) {
  const path = findBullet(ctx.view.get(), token);
  if (!path) {
    dropBlob(ctx, record.id);
    toast(`${record.name} was not attached: its bullet is gone`);
    return;
  }
  const w = writer(ctx, node);
  const filesPath = [...path, 'files'];
  carry(ctx, path, () => {
    const at = replaced ? asList(getIn(ctx.view.get(), filesPath)).findIndex((f) => f?.id === replaced.id) : -1;
    if (at >= 0) {
      const wasPending = isPending(ctx.view.get(), replaced.id);
      w.removeFile(path, replaced.id);
      if (wasPending) dropBlob(ctx, replaced.id);
    }
    w.addPendingFile(path, record);
    w.set(['keys', 'files', record.id], wrapped);
    const last = asList(getIn(ctx.view.get(), filesPath)).length - 1;
    if (at >= 0 && at < last) w.move(filesPath, last, at);
  });
  done();
}

// The Undo of a file's removal: the same record goes back to its old place. A pending file returns to draft.pending
// (its ciphertext is still in the store); a committed one leaves draft.deleted again.
function putBack(ctx, token, file, index, wasPending, node, done) {
  const path = findBullet(ctx.view.get(), token);
  if (!path) {
    toast(`${file.name} could not be put back: its bullet is gone`);
    if (wasPending) dropBlob(ctx, file.id);
    return;
  }
  const w = writer(ctx, node);
  const filesPath = [...path, 'files'];
  carry(ctx, path, () => {
    if (wasPending) {
      w.addPendingFile(path, file);
      const last = asList(getIn(ctx.view.get(), filesPath)).length - 1;
      if (index < last) w.move(filesPath, last, index);
    } else {
      w.insert(filesPath, index, file);
      w.set(['deleted'], asList(ctx.view.get().deleted).filter((id) => id !== file.id));
    }
  });
  done();
}

// Spec 13.9: above FILE_NOTE the upload is one large request (the ciphertext, base64) and phones download slowly.
const largeNote = (size) => `Large file: publishing sends it as a request of about ${formatSize(Math.ceil(((size + GCM_EXTRA) * 4) / 3))}, and visitors on phones will find the download slow.`;

function failure(file, err) {
  if (err?.message === 'too-large') return `${file.name} is larger than ${Math.round(FILE_MAX / MB)} MB and was skipped`;
  if (err?.name === 'QuotaExceededError') return `Not enough browser storage for ${file.name}; publish what you have first`;
  return `${file.name} could not be attached: ${err?.message || err?.name || 'unknown error'}`;
}

// The "Encrypting…" line of one file of a batch.
function progress(file) {
  const spinner = el('span', { class: 'adm-spinner', hidden: true });
  const state = el('span', { class: 'adm-upload-state', text: 'Waiting…' });
  const node = el('div', { class: 'adm-upload', role: 'status' },
    spinner, el('span', { class: 'adm-file-name', text: file.name }), el('span', { class: 'adm-file-size', text: formatSize(file.size) }), state);
  return {
    node,
    encrypting: () => {
      spinner.hidden = false;
      state.textContent = 'Encrypting…';
    },
  };
}
