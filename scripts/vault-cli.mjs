#!/usr/bin/env node
// Vault CLI (Node only), for local testing and recovery: manages vault/access.json, vault/keys.json
// and vault/files/ in the current directory (run it from the repository root). Spec section 12.
//
// Codes and the GitHub token come from arguments only and are written only inside sealed blobs.
// Nothing here prints them, with one deliberate exception: add-code prints the download code it
// added. Data goes to stdout (the new code, the file record, the entry table); notes go to stderr.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import process from 'node:process';
import {
  randomId, shortId, generateDownloadCode, codeStrength, generateKey, exportKey, importKey, encryptFile, formatSize,
  createAccessFile, createKeysFile, unlock, addEntry, readMeta, wrapFileKey, unwrapFileKey, rotateVault,
} from '../assets/js/vault.mjs';

const USAGE = `Usage: node scripts/vault-cli.mjs <command> [options]

Run from the repository root; reads and writes ./vault/.

Commands:
  init --admin-code <code> --token <token> [--owner mojikone] [--repo mojtabakeivanlou]
       [--branch redesign3_admin] [--force]
      Write vault/access.json with the admin entry and vault/keys.json with a new vault key.
      The admin code needs at least 12 characters from at least 3 of: lowercase, uppercase,
      digits, symbols. Refuses if an admin entry exists, unless --force (which discards every
      code and leaves the files already in vault/files undecryptable).

  add-code --admin-code <code> --label <label> [--code <code>]
      Add a download code (a new MK-XXXX-XXXX unless --code is given). Prints only the code.

  encrypt --admin-code <code> <file>
      Encrypt <file> to vault/files/<id>.bin, add its key to vault/keys.json and print the
      file record to paste into content/site.json.

  revoke --admin-code <code> <entryId>
      Remove an entry and rotate the vault key and the owner key: every file key and every
      remaining entry is rewrapped under the new keys. No file is re-encrypted.

  list --admin-code <code>
      List the entries: id, kind, label, created date and, for download entries, the code.

  --help
      Show this help.
`;

const COMMANDS = {
  init: { options: ['admin-code', 'token', 'owner', 'repo', 'branch', 'iterations'], required: ['admin-code', 'token'], flags: ['force'], args: [], run: init },
  'add-code': { options: ['admin-code', 'label', 'code'], required: ['admin-code', 'label'], flags: [], args: [], run: addCode },
  encrypt: { options: ['admin-code'], required: ['admin-code'], flags: [], args: ['file'], run: encrypt },
  revoke: { options: ['admin-code'], required: ['admin-code'], flags: [], args: ['entryId'], run: revoke },
  list: { options: ['admin-code'], required: ['admin-code'], flags: [], args: [], run: list },
};

const DEFAULTS = { owner: 'mojikone', repo: 'mojtabakeivanlou', branch: 'redesign3_admin' };

const MIME = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
};

const VAULT = resolve('vault');
const ACCESS = join(VAULT, 'access.json');
const KEYS = join(VAULT, 'keys.json');
const FILES = join(VAULT, 'files');

class UsageError extends Error {}   // exit 2, with usage
class CliError extends Error {}     // exit 1

const out = (s) => process.stdout.write(`${s}\n`);
const note = (s) => process.stderr.write(`${s}\n`);
// Local calendar date as YYYY-MM-DD (meta.created).
function today() {
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n, i) => String(n).padStart(i ? 2 : 4, '0')).join('-');
}
const mimeType = (file) => MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';

// --name value | --name=value | --flag | positionals. Error messages name the option, never echo a value.
function parseArgs(argv, spec) {
  const opts = {};
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      args.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq < 0 ? arg.slice(2) : arg.slice(2, eq);
    if (spec.flags.includes(name)) {
      if (eq >= 0) throw new UsageError(`--${name} takes no value`);
      opts[name] = true;
    } else if (spec.options.includes(name)) {
      const value = eq < 0 ? argv[++i] : arg.slice(eq + 1);
      if (value === undefined || value.trim() === '') throw new UsageError(`--${name} needs a value`);
      opts[name] = value;
    } else {
      throw new UsageError(`unknown option --${name}`);
    }
  }
  for (const name of spec.required) if (opts[name] === undefined) throw new UsageError(`missing --${name}`);
  if (args.length < spec.args.length) throw new UsageError(`missing <${spec.args[args.length]}>`);
  if (args.length > spec.args.length) throw new UsageError('too many arguments');
  return { opts, args };
}

function readJson(path, name) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new CliError(`${name} not found; run init first.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new CliError(`${name} is not valid JSON.`);
  }
}

const rel = (path) => `vault/${basename(path)}`;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Windows reports these while another program (antivirus, indexer, editor) briefly holds a file.
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);
const ATTEMPTS = 5;
const RETRY_MS = 100;

async function retrying(fn) {
  for (let attempt = 1; ; attempt++) {
    try {
      return fn();
    } catch (e) {
      if (!TRANSIENT.has(e.code) || attempt >= ATTEMPTS) throw e;
      await sleep(RETRY_MS);
    }
  }
}

function tryRemove(path) {
  try {
    rmSync(path, { force: true });
    return true;
  } catch {
    return false;
  }
}

// Leftovers of an interrupted writeJsonFiles, and how to recover from them, or null when there
// are none. Each step writes all <name>.tmp files first, then per file copies the original to
// <name>.bak and renames <name>.tmp over it; it removes the .bak files only after every rename
// succeeded, and removes the .tmp files after a rollback only once every original is restored.
// So: .tmp without .bak = stopped before replacing anything; .tmp with .bak = stopped half-way,
// restore from .bak; .bak alone = finished, only the backups are left.
function leftoverAdvice() {
  let names;
  try {
    names = readdirSync(VAULT);
  } catch {
    return null;
  }
  const tmps = names.filter((n) => n.endsWith('.tmp')).sort().map((n) => `vault/${n}`);
  const baks = names.filter((n) => n.endsWith('.bak')).sort().map((n) => `vault/${n}`);
  if (tmps.length === 0 && baks.length === 0) return null;
  const lines = [];
  if (baks.length && tmps.length) {
    lines.push('A previous run stopped half-way through replacing vault files. To restore the files as they were before it:');
    for (const b of baks) lines.push(`  rename ${b} to ${b.slice(0, -4)} (replacing it)`);
    for (const t of tmps) lines.push(`  delete ${t}`);
  } else if (baks.length) {
    lines.push('A previous run replaced the vault files but could not remove its backups. The current files are complete:');
    for (const b of baks) lines.push(`  delete ${b}`);
  } else {
    lines.push('A previous run stopped before replacing any vault file, so nothing changed:');
    for (const t of tmps) lines.push(`  delete ${t}`);
  }
  lines.push('Then run the command again.');
  return lines.join('\n');
}

function refuseLeftovers() {
  const advice = leftoverAdvice();
  if (advice) throw new CliError(advice);
}

// Replaces vault JSON files (access.json and keys.json must change together) as one recoverable
// step. Every new file is written to <name>.tmp first; a failure there changes nothing. Then, one
// file at a time, the original is copied to <name>.bak and <name>.tmp is renamed over it, retrying
// briefly on EPERM/EBUSY/EACCES. If a rename still fails, the files already replaced are restored
// from their .bak copies and every temporary file is removed, so the vault is as it was before.
// This is not atomic: the renames are separate operations, and a crash or a failed restore can stop
// it half-way. The .tmp/.bak files left behind then make every command refuse to run and print the
// recovery step (leftoverAdvice) instead of working on a split state.
async function writeJsonFiles(pairs) {
  mkdirSync(VAULT, { recursive: true });
  refuseLeftovers();
  const items = pairs.map(([path, value]) => ({ path, tmp: `${path}.tmp`, bak: `${path}.bak`, text: `${JSON.stringify(value, null, 2)}\n` }));

  for (const item of items) {
    try {
      writeFileSync(item.tmp, item.text);
    } catch (e) {
      for (const it of items) tryRemove(it.tmp);
      throw new CliError(`Could not write ${rel(item.tmp)} (${e.code ?? e.message}). Nothing was changed.`);
    }
  }

  const replaced = [];
  for (const item of items) {
    try {
      item.hadOriginal = existsSync(item.path);
      // Written by hand, not copyFileSync, which on Windows would copy a read-only attribute too.
      if (item.hadOriginal) writeFileSync(item.bak, readFileSync(item.path));
      await retrying(() => renameSync(item.tmp, item.path));
      replaced.push(item);
    } catch (e) {
      await rollBack(items, replaced, item, e);
    }
  }
  for (const item of items) tryRemove(item.bak);
}

// Undoes the renames of a failed writeJsonFiles and always throws.
async function rollBack(items, replaced, failed, error) {
  const reason = `Could not replace ${rel(failed.path)} (${error.code ?? error.message}).`;
  tryRemove(failed.bak); // its original was never replaced
  const stuck = [];
  for (const item of [...replaced].reverse()) {
    try {
      if (item.hadOriginal) await retrying(() => renameSync(item.bak, item.path));
      else await retrying(() => rmSync(item.path, { force: true }));
    } catch {
      stuck.push(rel(item.path));
    }
  }
  if (stuck.length) {
    throw new CliError(`${reason} Could not restore ${stuck.join(', ')} either.\n${leftoverAdvice() ?? ''}`.trimEnd());
  }
  for (const item of items) tryRemove(item.tmp);
  const restored = replaced.length ? ` ${replaced.map((it) => rel(it.path)).join(', ')} restored from backup;` : '';
  throw new CliError(`${reason}${restored} nothing was changed. Close any program that holds the file and run the command again.`);
}

// Unlocks with the admin code and returns the files and keys every admin command needs: the vault key `vk` (it wraps
// the file keys) and the owner key `ok` (it seals every entry's meta), both from the admin payload.
async function openAsAdmin(code) {
  const access = readJson(ACCESS, 'vault/access.json');
  const keys = readJson(KEYS, 'vault/keys.json');
  const admin = await unlock(access, code);
  if (!admin || admin.kind !== 'admin') throw new CliError('The admin code was not accepted.');
  if (typeof admin.payload.ok !== 'string') throw new CliError('The admin entry holds no owner key; this vault was made by an older version. Run init --force.');
  const vk = await importKey(admin.payload.vk);
  const ok = await importKey(admin.payload.ok);
  if (!keys.vk || !keys.files) throw new CliError('vault/keys.json has no vault key; run init first.');
  const sample = Object.values(keys.files)[0];
  if (sample) {
    try {
      await unwrapFileKey(vk, sample);
    } catch {
      throw new CliError('vault/keys.json is not wrapped under the vault key in vault/access.json.');
    }
  }
  return { access, keys, admin, vk, ok };
}

async function init(opts) {
  const code = opts['admin-code'].trim();
  if (!codeStrength(code).ok) {
    throw new CliError('The admin code is too weak: use at least 12 characters from at least 3 of lowercase, uppercase, digits and symbols.');
  }
  let iterations;
  if (opts.iterations !== undefined) {
    iterations = Number(opts.iterations);
    if (!Number.isInteger(iterations) || iterations < 1) throw new UsageError('--iterations must be a positive integer');
  }
  if (existsSync(ACCESS) && !opts.force) {
    let existing = null;
    try {
      existing = JSON.parse(readFileSync(ACCESS, 'utf8'));
    } catch {
      // unreadable: treat as occupied
    }
    if (!Array.isArray(existing?.entries) || existing.entries.some((e) => e.kind === 'admin')) {
      throw new CliError('vault/access.json already has an admin entry. Use --force to replace it; that discards every existing code and leaves the files already in vault/files undecryptable.');
    }
  }

  const vk = await generateKey();
  const ok = await generateKey();
  const github = {
    token: opts.token.trim(),
    owner: opts.owner ?? DEFAULTS.owner,
    repo: opts.repo ?? DEFAULTS.repo,
    branch: opts.branch ?? DEFAULTS.branch,
  };
  const access = await addEntry(
    createAccessFile(iterations),
    { kind: 'admin', code, payload: { vk: await exportKey(vk), ok: await exportKey(ok), github }, meta: { label: 'Admin', created: today() } },
    ok,
  );
  const keys = createKeysFile(shortId());
  await writeJsonFiles([[KEYS, keys], [ACCESS, access]]);
  note(`Wrote vault/access.json (admin entry ${access.entries[0].id}, ${github.owner}/${github.repo}@${github.branch}) and vault/keys.json (vault key ${keys.vk}).`);
}

async function addCode(opts) {
  const { access, admin, ok } = await openAsAdmin(opts['admin-code']);
  const code = (opts.code ?? generateDownloadCode()).trim();
  const label = opts.label.trim();
  let next;
  try {
    next = await addEntry(access, { kind: 'download', code, payload: { vk: admin.payload.vk }, meta: { label, created: today(), code } }, ok);
  } catch (e) {
    if (/already in use/.test(e.message)) throw new CliError('That code is already in use.');
    throw e;
  }
  await writeJsonFiles([[ACCESS, next]]);
  note(`Added download entry ${next.entries.at(-1).id} (${label}).`);
  out(code);
}

async function encrypt(opts, [file]) {
  const { keys, vk } = await openAsAdmin(opts['admin-code']);
  let bytes;
  try {
    bytes = readFileSync(file);
  } catch {
    throw new CliError(`Cannot read ${file}.`);
  }
  const fk = await generateKey();
  const blob = await encryptFile(fk, bytes);
  let id;
  do id = randomId(); while (keys.files[id] || existsSync(join(FILES, `${id}.bin`)));
  const next = { ...keys, files: { ...keys.files, [id]: await wrapFileKey(vk, fk) } };
  mkdirSync(FILES, { recursive: true });
  writeFileSync(join(FILES, `${id}.bin`), blob);
  await writeJsonFiles([[KEYS, next]]);
  note(`Wrote vault/files/${id}.bin (${formatSize(blob.length)}) and added its key to vault/keys.json. File record:`);
  out(JSON.stringify({ id, name: basename(file), size: bytes.length, type: mimeType(file), enc: true }, null, 2));
}

async function revoke(opts, [entryId]) {
  if (!/^[0-9a-f]{8}$/.test(entryId)) throw new CliError('<entryId> must be an 8-character hex entry id, as shown by list.');
  const { access, keys, admin, vk, ok } = await openAsAdmin(opts['admin-code']);
  const target = access.entries.find((e) => e.id === entryId);
  if (!target) throw new CliError(`No entry ${entryId} in vault/access.json.`);
  if (target.id === admin.entry.id) throw new CliError('Refusing to revoke the admin entry.');

  const codesById = {};
  for (const e of access.entries) {
    if (e.id === admin.entry.id || e.id === entryId) continue;
    const { code } = await readMeta(e, ok);
    if (code) codesById[e.id] = code;
  }
  const { label } = await readMeta(target, ok);
  const rotated = await rotateVault({ access, keys, vk, ok, kek: admin.kek, adminEntryId: admin.entry.id, codesById, dropIds: [entryId] });
  await writeJsonFiles([[KEYS, rotated.keys], [ACCESS, rotated.access]]);
  note(`Revoked ${entryId} (${label}). New vault key ${rotated.keys.vk}: ${Object.keys(rotated.keys.files).length} file key(s) rewrapped, ${rotated.access.entries.length} entry(ies) re-sealed.`);
}

async function list(opts) {
  const { access, ok } = await openAsAdmin(opts['admin-code']);
  const rows = [['ID', 'KIND', 'LABEL', 'CREATED', 'CODE']];
  for (const e of access.entries) {
    const meta = await readMeta(e, ok);
    rows.push([e.id, e.kind, meta.label ?? '', meta.created ?? '', e.kind === 'download' ? meta.code ?? '' : '-']);
  }
  const widths = rows[0].map((_, col) => Math.max(...rows.map((r) => String(r[col]).length)));
  for (const r of rows) out(r.map((cell, col) => String(cell).padEnd(widths[col])).join('  ').trimEnd());
}

async function main(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE);
    return;
  }
  const [name, ...rest] = argv;
  const spec = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : null;
  if (!spec) throw new UsageError(/^[a-z][a-z-]{0,30}$/.test(name) ? `unknown command "${name}"` : 'unknown command');
  const { opts, args } = parseArgs(rest, spec);
  refuseLeftovers(); // never work on, or add to, a half-replaced vault
  await spec.run(opts, args);
}

try {
  await main(process.argv.slice(2));
} catch (e) {
  if (e instanceof UsageError) {
    process.stderr.write(`error: ${e.message}\n\n${USAGE}`);
    process.exitCode = 2;
  } else {
    process.stderr.write(`error: ${e.message}\n`);
    process.exitCode = 1;
  }
}
