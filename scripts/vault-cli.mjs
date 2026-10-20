#!/usr/bin/env node
// Vault CLI (Node only), for local testing and recovery: manages vault/access.json, vault/keys.json
// and vault/files/ in the current directory (run it from the repository root). Spec section 12.
//
// Codes and the GitHub token come from arguments only and are written only inside sealed blobs.
// Nothing here prints them, with one deliberate exception: add-code prints the download code it
// added. Data goes to stdout (the new code, the file record, the entry table); notes go to stderr.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
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
      Remove an entry and rotate the vault key: every file key and every remaining entry is
      rewrapped under a new key. No file is re-encrypted.

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

// Writes every file to a temporary name first, then renames them all, so an interrupted run never
// leaves access.json and keys.json under different vault keys.
function writeJsonFiles(pairs) {
  mkdirSync(VAULT, { recursive: true });
  for (const [path, value] of pairs) writeFileSync(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  for (const [path] of pairs) renameSync(`${path}.tmp`, path);
}

// Unlocks with the admin code and returns the files and keys every admin command needs.
async function openAsAdmin(code) {
  const access = readJson(ACCESS, 'vault/access.json');
  const keys = readJson(KEYS, 'vault/keys.json');
  const admin = await unlock(access, code);
  if (!admin || admin.kind !== 'admin') throw new CliError('The admin code was not accepted.');
  const vk = await importKey(admin.payload.vk);
  if (!keys.vk || !keys.files) throw new CliError('vault/keys.json has no vault key; run init first.');
  const sample = Object.values(keys.files)[0];
  if (sample) {
    try {
      await unwrapFileKey(vk, sample);
    } catch {
      throw new CliError('vault/keys.json is not wrapped under the vault key in vault/access.json.');
    }
  }
  return { access, keys, admin, vk };
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
  const github = {
    token: opts.token.trim(),
    owner: opts.owner ?? DEFAULTS.owner,
    repo: opts.repo ?? DEFAULTS.repo,
    branch: opts.branch ?? DEFAULTS.branch,
  };
  const access = await addEntry(
    createAccessFile(iterations),
    { kind: 'admin', code, payload: { vk: await exportKey(vk), github }, meta: { label: 'Admin', created: today() } },
    vk,
  );
  const keys = createKeysFile(shortId());
  writeJsonFiles([[KEYS, keys], [ACCESS, access]]);
  note(`Wrote vault/access.json (admin entry ${access.entries[0].id}, ${github.owner}/${github.repo}@${github.branch}) and vault/keys.json (vault key ${keys.vk}).`);
}

async function addCode(opts) {
  const { access, admin, vk } = await openAsAdmin(opts['admin-code']);
  const code = (opts.code ?? generateDownloadCode()).trim();
  const label = opts.label.trim();
  let next;
  try {
    next = await addEntry(access, { kind: 'download', code, payload: { vk: admin.payload.vk }, meta: { label, created: today(), code } }, vk);
  } catch (e) {
    if (/already in use/.test(e.message)) throw new CliError('That code is already in use.');
    throw e;
  }
  writeJsonFiles([[ACCESS, next]]);
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
  writeJsonFiles([[KEYS, next]]);
  note(`Wrote vault/files/${id}.bin (${formatSize(blob.length)}) and added its key to vault/keys.json. File record:`);
  out(JSON.stringify({ id, name: basename(file), size: bytes.length, type: mimeType(file), enc: true }, null, 2));
}

async function revoke(opts, [entryId]) {
  if (!/^[0-9a-f]{8}$/.test(entryId)) throw new CliError('<entryId> must be an 8-character hex entry id, as shown by list.');
  const { access, keys, admin, vk } = await openAsAdmin(opts['admin-code']);
  const target = access.entries.find((e) => e.id === entryId);
  if (!target) throw new CliError(`No entry ${entryId} in vault/access.json.`);
  if (target.id === admin.entry.id) throw new CliError('Refusing to revoke the admin entry.');

  const codesById = {};
  for (const e of access.entries) {
    if (e.id === admin.entry.id || e.id === entryId) continue;
    const { code } = await readMeta(e, vk);
    if (code) codesById[e.id] = code;
  }
  const { label } = await readMeta(target, vk);
  const rotated = await rotateVault({ access, keys, vk, kek: admin.kek, adminEntryId: admin.entry.id, codesById, dropIds: [entryId] });
  writeJsonFiles([[KEYS, rotated.keys], [ACCESS, rotated.access]]);
  note(`Revoked ${entryId} (${label}). New vault key ${rotated.keys.vk}: ${Object.keys(rotated.keys.files).length} file key(s) rewrapped, ${rotated.access.entries.length} entry(ies) re-sealed.`);
}

async function list(opts) {
  const { access, vk } = await openAsAdmin(opts['admin-code']);
  const rows = [['ID', 'KIND', 'LABEL', 'CREATED', 'CODE']];
  for (const e of access.entries) {
    const meta = await readMeta(e, vk);
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
