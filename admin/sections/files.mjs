// Files (spec 13.3, 13.9): every attachment of the site with the bullet it belongs to, the total against the size
// budget, and the orphaned blobs: vault/files/<id>.bin on the branch that no bullet uses any more. Attaching and
// replacing files happens in Experience; here they can be removed, and orphans queued for deletion (draft.deleted),
// which the next publish carries out.

import { el, card, section, toast } from '../modules/ui.mjs';
import { formatSize } from '../../assets/js/vault.mjs';
import { TOTAL_AMBER, TOTAL_RED } from '../modules/limits.mjs';
import { listAttachments, totalAttachmentBytes, budgetLevel, orphanBlobs } from '../modules/codes.mjs';
import { getIn } from './_common.mjs';

const GAUGE_MAX = 1024 * 1024 * 1024;       // the bar's full width: about where GitHub Pages sites degrade (1 GB)
const SNIPPET = 60;                         // characters of a bullet's text shown as its name

const asList = (x) => (Array.isArray(x) ? x : []);
const isPending = (draft, id) => asList(draft?.pending).some((f) => f?.id === id);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const snippet = (s) => (s.length > SNIPPET ? `${s.slice(0, SNIPPET - 1).trimEnd()}…` : s);

export function render(container, store, ctx = {}) {
  let alive = true;
  const gauge = el('div');
  const list = el('div');
  const orphans = el('div', { 'aria-live': 'polite' });
  container.replaceChildren(
    section('Files', 'Every file attached to a bullet in Experience, and the space they take.'),
    card('Storage', gauge),
    card('Attachments', list),
    card('Orphaned blobs', [
      el('p', { class: 'adm-card-hint', text: 'Encrypted files on GitHub (vault/files/) that no bullet uses. Deleting one removes it from the site when you publish; it stays in the git history, still encrypted.' }),
      orphans,
    ]),
  );

  /* gauge */

  function paintGauge(draft) {
    const total = totalAttachmentBytes(draft.site);
    const level = budgetLevel(total);
    const share = (n) => `${Math.min(100, (n / GAUGE_MAX) * 100).toFixed(2)}%`;
    const waiting = listAttachments(draft.site).filter(({ file }) => isPending(draft, file.id));
    const note = {
      ok: `Turns amber at ${formatSize(TOTAL_AMBER)} and red at ${formatSize(TOTAL_RED)}.`,
      amber: `Over ${formatSize(TOTAL_AMBER)}: the repository and the site slow down near 1 GB. Consider removing or compressing large files.`,
      red: `Over ${formatSize(TOTAL_RED)}: close to the 1 GB where GitHub Pages sites degrade. Remove or compress files before adding more.`,
    }[level];
    gauge.replaceChildren(
      el('p', { class: 'adm-gauge-total' },
        el('strong', { text: formatSize(total) }), ' of attachments',
        waiting.length ? ` · ${plural(waiting.length, 'file')} waiting to be published` : null),
      el('div', {
        class: 'adm-gauge', dataset: { level }, role: 'meter', 'aria-label': 'Total size of the attachments',
        'aria-valuemin': '0', 'aria-valuemax': String(GAUGE_MAX), 'aria-valuenow': String(Math.min(total, GAUGE_MAX)),
        'aria-valuetext': `${formatSize(total)}${level === 'ok' ? '' : `, ${level}`}`,
      },
      el('span', { class: 'adm-gauge-fill', style: `width: ${share(total)}` }),
      el('span', { class: 'adm-gauge-mark is-amber', style: `left: ${share(TOTAL_AMBER)}`, title: formatSize(TOTAL_AMBER) }),
      el('span', { class: 'adm-gauge-mark is-red', style: `left: ${share(TOTAL_RED)}`, title: formatSize(TOTAL_RED) })),
      el('p', { class: `adm-hint adm-gauge-note is-${level}`, text: note }),
      el('p', { class: 'adm-hint', text: 'Counts the files the site uses now. Every upload also stays in the public git history for good.' }));
  }

  /* attachments */

  function paintList(draft) {
    const items = listAttachments(draft.site);
    if (items.length === 0) {
      list.replaceChildren(el('p', { class: 'adm-list-empty', text: 'No files attached yet. Attach them to bullets in Experience.' }));
      return;
    }
    list.replaceChildren(el('div', { class: 'adm-table-wrap' }, el('table', { class: 'adm-table adm-attachments' },
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col', text: 'File' }), el('th', { scope: 'col', text: 'Size' }), el('th', { scope: 'col', text: 'Used in' }),
        el('th', { scope: 'col', text: 'State' }), el('th', { scope: 'col' }, el('span', { class: 'adm-sr', text: 'Actions' })))),
      el('tbody', {}, items.map((item) => attachmentRow(draft, item))))));
  }

  function attachmentRow(draft, item) {
    const { file } = item;
    const name = typeof file.name === 'string' ? file.name : '';
    const size = Number.isFinite(file.size) && file.size >= 0 ? formatSize(file.size) : '—';
    const pending = isPending(draft, file.id);
    const where = [item.company, item.project].filter(Boolean).join(' › ');
    return el('tr', {},
      el('td', {}, el('span', { class: 'adm-file-name', text: name, title: name })),
      el('td', { class: 'adm-nowrap adm-file-size', text: size }),
      el('td', {},
        el('span', { class: 'adm-where', text: where }),
        el('span', { class: 'adm-where-bullet', text: `Bullet ${item.bulletIndex + 1}: ${snippet(item.bullet) || '(empty)'}`, title: item.bullet })),
      el('td', {}, el('span', { class: `adm-badge${pending ? ' is-pending' : ''}`, text: pending ? 'pending' : 'committed' })),
      el('td', { class: 'adm-row-acts' },
        el('button', { type: 'button', class: 'adm-linkbtn adm-linkbtn-danger', 'aria-label': `Remove ${name}`, onclick: () => remove(item) }, 'Remove')));
  }

  // As in Experience: a pending file leaves the draft (its ciphertext is deleted once the Undo is gone), a committed one
  // is deleted at the next publish. Undo puts the same record back where it was.
  function remove(item) {
    const { file, path } = item;
    const wasPending = isPending(store.get(), file.id);
    store.removeFile(path, file.id);
    toast(`Removed ${file.name}`, {
      actionLabel: 'Undo',
      onAction: () => putBack(item, wasPending),
      onClose: (undone) => {
        if (!undone && wasPending && !isPending(store.get(), file.id)) {
          ctx.fileStore?.delete(file.id).catch(() => { /* an orphan in the browser's store is harmless */ });
        }
      },
    });
  }

  function putBack({ file, path, index, bullet: text }, wasPending) {
    const bullet = getIn(store.get(), path);
    if (!bullet || bullet.text !== text) {    // the bullet moved or went meanwhile
      toast(`${file.name} could not be put back: its bullet has changed`);
      if (wasPending) ctx.fileStore?.delete(file.id).catch(() => {});
      return;
    }
    const filesPath = [...path, 'files'];
    if (wasPending) {
      store.addPendingFile(path, file);
      const last = asList(getIn(store.get(), filesPath)).length - 1;
      if (index < last) store.move(filesPath, last, index);
    } else {
      store.insert(filesPath, index, file);
      store.set(['deleted'], asList(store.get().deleted).filter((id) => id !== file.id));
    }
  }

  /* orphaned blobs */

  let tree;                                  // undefined while loading, null when it failed, else the paths
  let treeError = '';
  let treeBase = null;                       // the draft base the tree was read for; a publish moves it

  async function loadTree() {
    tree = undefined;
    treeBase = store.get()?.baseCommit ?? null;
    paintOrphans(store.get());
    try {
      if (!ctx.github) throw new Error('No GitHub connection in this session');
      const paths = await ctx.github.listTree();
      if (!alive) return;
      tree = paths;
    } catch (err) {
      if (!alive) return;
      tree = null;
      treeError = String(err?.message || 'unknown error').split('\n')[0];
    }
    paintOrphans(store.get());
  }

  function paintOrphans(draft) {
    const again = el('button', { type: 'button', class: 'adm-linkbtn', onclick: loadTree }, 'Check again');
    if (tree === undefined) {
      orphans.replaceChildren(el('p', { class: 'adm-loading-line' }, el('span', { class: 'adm-spinner' }), 'Listing the files on GitHub…'));
      return;
    }
    if (tree === null) {
      orphans.replaceChildren(el('p', { class: 'adm-form-error' }, `The orphan check could not list the files on GitHub (${treeError}). `, again));
      return;
    }
    const ids = orphanBlobs(tree, draft.site);
    if (ids.length === 0) {
      orphans.replaceChildren(el('p', { class: 'adm-list-empty' }, 'None: every file in vault/files/ belongs to a bullet. ', again));
      return;
    }
    const deleted = asList(draft.deleted);
    orphans.replaceChildren(
      el('ul', { class: 'adm-orphans' }, ids.map((id) => {
        const queued = deleted.includes(id);
        return el('li', { class: queued ? 'is-queued' : null },
          el('code', { class: 'adm-code', text: `${id}.bin`, title: `vault/files/${id}.bin` }),
          el('span', { class: 'adm-hint', text: queued ? 'deleted when you publish' : 'not used' }),
          queued
            ? el('button', { type: 'button', class: 'adm-linkbtn', onclick: () => store.set(['deleted'], asList(store.get().deleted).filter((d) => d !== id)) }, 'Keep')
            : el('button', { type: 'button', class: 'adm-linkbtn adm-linkbtn-danger', 'aria-label': `Delete ${id}.bin`, onclick: () => store.set(['deleted'], [...asList(store.get().deleted), id]) }, 'Delete'));
      })),
      el('p', { class: 'adm-hint' }, `${plural(ids.length, 'orphaned blob')}. `, again));
  }

  function paint() {
    const draft = store.get();
    paintGauge(draft);
    paintList(draft);
    if (tree !== undefined && (draft.baseCommit ?? null) !== treeBase) loadTree();   // published meanwhile
    else paintOrphans(draft);
  }

  const unsubscribe = store.subscribe(() => { if (alive) paint(); });
  paint();
  loadTree();
  return () => {
    alive = false;
    unsubscribe();
  };
}
