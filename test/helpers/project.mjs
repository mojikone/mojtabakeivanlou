// A temp project root that mirrors the repository's source files, for tests that build or serve it.
// The root is a folder of its own inside a fresh temp folder, so that a test of a runaway outDir ("..") can only ever hit that
// temp folder, never the user's real one. Remove the root with removeRoot().
// Paths are relative to the working directory, which is the repository root under `npm test`.
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const removeRoot = (root) => rm(dirname(root), { recursive: true, force: true });

export async function makeRoot(mutate) {
  const root = join(await mkdtemp(join(tmpdir(), 'project-')), 'project');
  try {
    await mkdir(root);
    for (const dir of ['content', 'assets', 'vault', 'admin']) await cp(dir, join(root, dir), { recursive: true });
    for (const file of ['CNAME', '.nojekyll', 'robots.txt']) await cp(file, join(root, file));
    if (mutate) await mutate(root);
  } catch (err) {
    await removeRoot(root);
    throw err;
  }
  return root;
}

// Runs `run(root)` against a fresh root (changed by `mutate(root)` first) and removes the root afterwards.
export async function withRoot(run, mutate) {
  const root = await makeRoot(mutate);
  try {
    return await run(root);
  } finally {
    await removeRoot(root);
  }
}

// Reads content/site.json of `root`, lets `change(site)` edit it and writes it back.
export async function editSite(root, change) {
  const path = join(root, 'content/site.json');
  const site = JSON.parse(await readFile(path, 'utf8'));
  change(site);
  await writeFile(path, JSON.stringify(site, null, 2));
}
