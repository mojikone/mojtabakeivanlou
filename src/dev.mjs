// Local preview (Node only): builds the site into dist/, serves it and rebuilds when a source file changes.
//
//   npm run dev        ->  http://127.0.0.1:3004
//
// Every build runs `src/build.mjs` as a child process. A build imported into this long-running process would keep
// the page templates (assets/js/render/*.mjs) it loaded at start-up, since Node never re-reads an imported module;
// a fresh process per build sees every edit. A build that fails (invalid content, a template error) is logged and
// dist/ stays as the last good build left it, because build.mjs validates and renders before it touches dist/.

import { execFile } from 'node:child_process';
import { existsSync, watch as fsWatch } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isMain } from './is-main.mjs';
import { startServer } from './serve.mjs';

const BUILD_SCRIPT = fileURLToPath(new URL('./build.mjs', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
// vault/ is watched on top of the four folders in the brief, so a blob added by the vault CLI shows up without a restart.
const WATCHED = ['content', 'assets', 'admin', 'src', 'vault'];

// Runs one build in a child process. Resolves (never rejects) with { ok, lines }: `lines` is what the build printed
// on stderr, which is the validation errors when it failed and the warnings when it did not.
function runBuild(root) {
  return new Promise((resolveRun) => {
    execFile(process.execPath, [BUILD_SCRIPT], { cwd: root, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, _stdout, stderr) => {
      const lines = String(stderr).split(/\r?\n/).filter(Boolean);
      if (error && lines.length === 0) lines.push(error.message);
      resolveRun({ ok: !error, lines });
    });
  });
}

function watchDir(dir, onChange) {
  let watcher;
  try {
    watcher = fsWatch(dir, { recursive: true }, onChange);
  } catch (err) {
    if (err.code !== 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM') throw err;
    watcher = fsWatch(dir, onChange);   // no recursive watching here: the folder's own files only
  }
  watcher.on('error', () => {});        // a watched folder that is deleted must not take the server down with it
  return watcher;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Builds `root`, serves its dist/ and (unless `watch` is false) rebuilds whenever a source file changes.
 * @param {{ root?: string, port?: number, log?: (line: string) => void, debounceMs?: number, watch?: boolean }} [options]
 *   root: the project folder; defaults to the repository this file lives in.
 *   port: 0 picks a free port.
 *   debounceMs: quiet time after the last change before a rebuild starts.
 * @returns {Promise<{ url: string, port: number, rebuild: () => Promise<void>, close: () => Promise<void> }>}
 *   rebuild: builds now (after the build in progress, if there is one); never rejects.
 *   close: stops watching and serving and waits for a build in progress.
 */
export async function startDev({ root = REPO_ROOT, port = 3004, log = console.log, debounceMs = 200, watch = true } = {}) {
  const rootDir = resolve(root);
  let running = null;
  let again = false;
  let closed = false;
  let timer = null;
  let built = false;       // true once a build of this run has succeeded
  let lastWarnings = '';

  async function buildOnce() {
    const started = Date.now();
    const { ok, lines } = await runBuild(rootDir);
    if (!ok) {
      // build.mjs leaves dist/ alone when it fails, so whatever is there (if anything) is the last good build
      log(existsSync(join(rootDir, 'dist', 'index.html')) ? 'rebuild failed, still serving the last good build:' : 'build failed, nothing to serve yet:');
      for (const line of lines) log(`  ${line}`);
      return;
    }
    const warnings = lines.map((line) => line.replace(/^warning: /, ''));
    const suffix = warnings.length ? ` (${plural(warnings.length, 'warning')})` : '';
    log(`${built ? 'rebuilt' : 'built'} in ${Date.now() - started} ms${suffix}`);
    // A warning is repeated only when the set of warnings changes, so a steady one does not drown the rebuild lines.
    if (warnings.join('\n') !== lastWarnings) for (const warning of warnings) log(`  warning: ${warning}`);
    lastWarnings = warnings.join('\n');
    built = true;
  }

  function rebuild() {
    if (running) {
      again = true;      // a change arrived mid-build: build once more when this one is done
      return running;
    }
    running = (async () => {
      do {
        again = false;
        await buildOnce();
      } while (again && !closed);
    })().finally(() => { running = null; });
    return running;
  }

  await rebuild();
  const server = await startServer(join(rootDir, 'dist'), port);
  log(`Serving dist/ at ${server.url}`);

  const watchers = [];
  if (watch) {
    const onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(rebuild, debounceMs);
    };
    for (const dir of WATCHED) {
      if (existsSync(join(rootDir, dir))) watchers.push(watchDir(join(rootDir, dir), onChange));
    }
  }

  return {
    url: server.url,
    port: server.port,
    rebuild,
    async close() {
      closed = true;
      clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
      await running;
      await server.close();
    },
  };
}

if (isMain(import.meta.url)) {
  try {
    await startDev();
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
