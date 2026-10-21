// GitHub client of the dashboard (Task 16, spec 13.4, 13.6, 13.7). Every call goes through a recording fake fetch:
// no network is ever touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGitHub, GitHubError, AuthError, ConflictError } from '../admin/modules/github.mjs';

const TOKEN = 'ghp_FAKE_TEST_TOKEN_0123456789';
const OWNER = 'octo';
const REPO = 'site';
const BRANCH = 'main';
const API = 'https://api.github.com';
const R = `${API}/repos/${OWNER}/${REPO}`;
const b64 = (s) => Buffer.from(s).toString('base64');

// routes: { 'METHOD url': response | (call) => response }, response = { status = 200, body } or an Error to throw.
// Unknown routes answer 599, so a test notices an unexpected request.
function fakeFetch(routes) {
  const calls = [];
  async function fetch(url, init = {}) {
    const method = init.method ?? 'GET';
    const call = { method, url: String(url), headers: { ...init.headers }, body: init.body === undefined ? undefined : JSON.parse(init.body) };
    calls.push(call);
    const key = `${method} ${call.url}`;
    let out = key in routes ? routes[key] : { status: 599, body: { message: `no route for ${key}` } };
    if (typeof out === 'function') out = out(call, calls);
    if (out instanceof Error) throw out;
    const status = out.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => out.body ?? {},
      text: async () => JSON.stringify(out.body ?? {}),
    };
  }
  return { fetch, calls };
}

const client = (routes, over = {}) => {
  const fake = fakeFetch(routes);
  return { gh: createGitHub({ token: TOKEN, owner: OWNER, repo: REPO, branch: BRANCH, fetch: fake.fetch, ...over }), calls: fake.calls };
};

const HEAD_ROUTES = {
  [`GET ${R}/git/ref/heads/${BRANCH}`]: { body: { ref: `refs/heads/${BRANCH}`, object: { sha: 'head-sha', type: 'commit' } } },
  [`GET ${R}/git/commits/head-sha`]: { body: { sha: 'head-sha', tree: { sha: 'head-tree' }, parents: [] } },
};

// Routes for a full commitFiles run: the parent commit, blobs numbered in order, tree, commit and the ref update.
function commitRoutes({ patch = { body: { object: { sha: 'new-commit' } } }, tree = { status: 201, body: { sha: 'new-tree' } } } = {}) {
  let blobs = 0;
  return {
    [`GET ${R}/git/commits/parent-sha`]: { body: { sha: 'parent-sha', tree: { sha: 'parent-tree' } } },
    [`POST ${R}/git/blobs`]: () => ({ status: 201, body: { sha: `blob-${++blobs}` } }),
    [`POST ${R}/git/trees`]: tree,
    [`POST ${R}/git/commits`]: { status: 201, body: { sha: 'new-commit' } },
    [`PATCH ${R}/git/refs/heads/${BRANCH}`]: patch,
  };
}

const COMMIT_INPUT = {
  message: 'Content update from dashboard: profile',
  files: [
    { path: 'content/site.json', bytes: new TextEncoder().encode('{"a":1}') },
    { path: 'vault/files/0123.bin', bytes: new Uint8Array([0, 255, 1, 254]) },
  ],
  deletes: ['vault/files/dead.bin'],
  parent: 'parent-sha',
};

/* ─── getHead ─── */

test('getHead reads the branch ref, then the tree of that commit', async () => {
  const { gh, calls } = client(HEAD_ROUTES);
  assert.deepEqual(await gh.getHead(), { sha: 'head-sha', tree: 'head-tree' });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    `GET ${R}/git/ref/heads/${BRANCH}`,
    `GET ${R}/git/commits/head-sha`,
  ]);
});

/* ─── getFile ─── */

test('getFile reads the Contents API on the branch and decodes the base64 (with line breaks)', async () => {
  const text = '{"profile":{"firstName":"Ada"}}\n'.repeat(5);
  const wrapped = b64(text).replace(/.{20}/g, '$&\n');
  const { gh, calls } = client({
    [`GET ${R}/contents/content/site.json?ref=${BRANCH}`]: { body: { sha: 'file-sha', encoding: 'base64', content: wrapped } },
  });
  const file = await gh.getFile('content/site.json');
  assert.equal(file.sha, 'file-sha');
  assert.ok(file.bytes instanceof Uint8Array);
  assert.equal(new TextDecoder().decode(file.bytes), text);
  assert.equal(calls.length, 1);
});

test('getFile returns null on 404', async () => {
  const { gh } = client({ [`GET ${R}/contents/vault/keys.json?ref=${BRANCH}`]: { status: 404, body: { message: 'Not Found' } } });
  assert.equal(await gh.getFile('vault/keys.json'), null);
});

test('getFile falls back to the blob API when the Contents API leaves the content out (files over 1 MB)', async () => {
  const { gh, calls } = client({
    [`GET ${R}/contents/vault/files/big.bin?ref=${BRANCH}`]: { body: { sha: 'big-sha', encoding: 'none', content: '' } },
    [`GET ${R}/git/blobs/big-sha`]: { body: { sha: 'big-sha', encoding: 'base64', content: b64('large bytes') } },
  });
  const file = await gh.getFile('vault/files/big.bin');
  assert.equal(file.sha, 'big-sha');
  assert.equal(new TextDecoder().decode(file.bytes), 'large bytes');
  assert.equal(calls.length, 2);
});

test('paths, branch, owner and repo are URL-encoded segment by segment', async () => {
  const fake = fakeFetch({
    [`GET ${API}/repos/my%20org/my%20repo/contents/docs/a%20b%23c.txt?ref=feature%2Fx`]: { body: { sha: 's', encoding: 'base64', content: b64('x') } },
  });
  const gh = createGitHub({ token: TOKEN, owner: 'my org', repo: 'my repo', branch: 'feature/x', fetch: fake.fetch });
  assert.equal(new TextDecoder().decode((await gh.getFile('docs/a b#c.txt')).bytes), 'x');
});

/* ─── listTree ─── */

test('listTree lists the file paths of the head commit, recursively', async () => {
  const { gh, calls } = client({
    ...HEAD_ROUTES,
    [`GET ${R}/git/trees/head-tree?recursive=1`]: { body: { sha: 'head-tree', truncated: false, tree: [
      { path: 'content', type: 'tree', sha: 't1' },
      { path: 'content/site.json', type: 'blob', sha: 'b1' },
      { path: 'vault/files/0123.bin', type: 'blob', sha: 'b2' },
      { path: 'vendor/lib', type: 'commit', sha: 'c1' },
    ] } },
  });
  assert.deepEqual(await gh.listTree(), ['content/site.json', 'vault/files/0123.bin']);
  assert.equal(calls.at(-1).url, `${R}/git/trees/head-tree?recursive=1`);
});

test('listTree refuses a truncated tree instead of returning part of it', async () => {
  const { gh } = client({
    ...HEAD_ROUTES,
    [`GET ${R}/git/trees/head-tree?recursive=1`]: { body: { truncated: true, tree: [{ path: 'a', type: 'blob' }] } },
  });
  await assert.rejects(gh.listTree(), GitHubError);
});

/* ─── commitFiles ─── */

test('commitFiles: one blob per file, one tree on the parent tree (deletes as sha: null), one commit, then the ref', async () => {
  const { gh, calls } = client(commitRoutes());
  assert.deepEqual(await gh.commitFiles(COMMIT_INPUT), { sha: 'new-commit' });

  const blobs = calls.filter((c) => c.method === 'POST' && c.url === `${R}/git/blobs`);
  assert.equal(blobs.length, 2);
  assert.deepEqual(blobs.map((c) => c.body), [
    { content: b64('{"a":1}'), encoding: 'base64' },
    { content: Buffer.from([0, 255, 1, 254]).toString('base64'), encoding: 'base64' },
  ]);

  const trees = calls.filter((c) => c.url === `${R}/git/trees`);
  assert.equal(trees.length, 1);
  assert.deepEqual(trees[0].body, {
    base_tree: 'parent-tree',
    tree: [
      { path: 'content/site.json', mode: '100644', type: 'blob', sha: 'blob-1' },
      { path: 'vault/files/0123.bin', mode: '100644', type: 'blob', sha: 'blob-2' },
      { path: 'vault/files/dead.bin', mode: '100644', type: 'blob', sha: null },
    ],
  });

  const commits = calls.filter((c) => c.method === 'POST' && c.url === `${R}/git/commits`);
  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0].body, { message: COMMIT_INPUT.message, tree: 'new-tree', parents: ['parent-sha'] });

  const patches = calls.filter((c) => c.method === 'PATCH');
  assert.equal(patches.length, 1);
  assert.equal(patches[0].url, `${R}/git/refs/heads/${BRANCH}`);
  assert.deepEqual(patches[0].body, { sha: 'new-commit', force: false });
  assert.equal(calls.at(-1), patches[0], 'the ref moves last');
  assert.ok(calls.indexOf(trees[0]) > calls.indexOf(blobs.at(-1)) && calls.indexOf(commits[0]) > calls.indexOf(trees[0]));
});

test('commitFiles with no deletes sends only the file entries', async () => {
  const { gh, calls } = client(commitRoutes());
  await gh.commitFiles({ message: 'm', files: [COMMIT_INPUT.files[0]], parent: 'parent-sha' });
  assert.deepEqual(calls.find((c) => c.url === `${R}/git/trees`).body.tree, [
    { path: 'content/site.json', mode: '100644', type: 'blob', sha: 'blob-1' },
  ]);
});

test('commitFiles base64-encodes a large binary blob without blowing the stack', async () => {
  const big = new Uint8Array(3 * 1024 * 1024);
  for (let i = 0; i < big.length; i++) big[i] = (i * 31 + 7) & 255;
  const { gh, calls } = client(commitRoutes());
  await gh.commitFiles({ message: 'm', files: [{ path: 'vault/files/big.bin', bytes: big }], deletes: [], parent: 'parent-sha' });
  const sent = calls.find((c) => c.url === `${R}/git/blobs`).body.content;
  assert.ok(Buffer.from(sent, 'base64').equals(Buffer.from(big)));
});

test('a 422 or a 409 on the ref update rejects with ConflictError', async () => {
  for (const status of [422, 409]) {
    const { gh } = client(commitRoutes({ patch: { status, body: { message: 'Update is not a fast forward' } } }));
    const err = await gh.commitFiles(COMMIT_INPUT).then(() => null, (e) => e);
    assert.ok(err instanceof ConflictError, `status ${status}`);
    assert.ok(err instanceof GitHubError);
    assert.equal(err.status, status);
  }
});

test('a 422 anywhere but the ref update is a plain GitHubError, not a conflict', async () => {
  const { gh } = client(commitRoutes({ tree: { status: 422, body: { message: 'tree.sha is invalid' } } }));
  const err = await gh.commitFiles(COMMIT_INPUT).then(() => null, (e) => e);
  assert.ok(err instanceof GitHubError);
  assert.ok(!(err instanceof ConflictError));
  assert.equal(err.status, 422);
});

test('a failed blob upload names the file it was uploading, and stops before the tree', async () => {
  const routes = commitRoutes();
  let n = 0;
  routes[`POST ${R}/git/blobs`] = () => (++n === 2 ? { status: 502, body: { message: 'Server Error' } } : { status: 201, body: { sha: 'blob-1' } });
  const { gh, calls } = client(routes);
  const err = await gh.commitFiles(COMMIT_INPUT).then(() => null, (e) => e);
  assert.ok(err instanceof GitHubError);
  assert.equal(err.status, 502);
  assert.equal(err.path, 'vault/files/0123.bin');
  assert.match(err.message, /vault\/files\/0123\.bin/);
  assert.ok(!calls.some((c) => c.url === `${R}/git/trees`), 'no tree after a failed blob');
});

/* ─── Actions runs ─── */

test('latestRun picks the run whose head_sha matches, among the latest push runs of the branch', async () => {
  const runs = { workflow_runs: [
    { head_sha: 'other', status: 'completed', conclusion: 'success', html_url: 'https://github.com/run/1' },
    { head_sha: 'mine', status: 'in_progress', conclusion: null, html_url: 'https://github.com/run/2', id: 2 },
  ] };
  const { gh, calls } = client({ [`GET ${R}/actions/runs?branch=${BRANCH}&event=push&per_page=5`]: { body: runs } });
  assert.deepEqual(await gh.latestRun('mine'), { id: 2, status: 'in_progress', conclusion: null, html_url: 'https://github.com/run/2' });
  assert.equal(await gh.latestRun('absent'), null);
  assert.equal(calls.length, 2);
});

test('runJobs lists the jobs of a run: name, status and conclusion of each', async () => {
  const url = `GET ${R}/actions/runs/42/jobs`;
  const jobs = { total_count: 2, jobs: [
    { id: 1, run_id: 42, name: 'build', status: 'completed', conclusion: 'success', steps: [{ name: 'npm test' }] },
    { id: 2, run_id: 42, name: 'deploy', status: 'completed', conclusion: 'skipped', steps: [] },
  ] };
  const { gh, calls } = client({ [url]: { body: jobs } });
  assert.deepEqual(await gh.runJobs(42), [
    { name: 'build', status: 'completed', conclusion: 'success' },
    { name: 'deploy', status: 'completed', conclusion: 'skipped' },
  ]);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [url]);
  assert.deepEqual(await client({ [url]: { body: {} } }).gh.runJobs(42), []);
  // the id is a path segment: encoded, never able to reach another endpoint
  const odd = client({});
  await odd.gh.runJobs('1/../x').catch(() => {});
  assert.equal(odd.calls[0].url, `${R}/actions/runs/1%2F..%2Fx/jobs`);
});

test('latestSuccessfulRun returns the time of the newest successful run on the branch, or null', async () => {
  const url = `GET ${R}/actions/runs?branch=${BRANCH}&status=success&per_page=1`;
  const { gh } = client({ [url]: { body: { workflow_runs: [{ status: 'completed', conclusion: 'success', updated_at: '2026-10-21T08:00:00Z' }] } } });
  assert.deepEqual(await gh.latestSuccessfulRun(), { updated_at: '2026-10-21T08:00:00Z' });
  const empty = client({ [url]: { body: { total_count: 0, workflow_runs: [] } } });
  assert.equal(await empty.gh.latestSuccessfulRun(), null);
});

/* ─── validate ─── */

test('validate reports whether the token can read the repository, without throwing', async () => {
  assert.deepEqual(await client({ [`GET ${R}`]: { body: { full_name: 'octo/site' } } }).gh.validate(), { ok: true, status: 200 });
  assert.deepEqual(await client({ [`GET ${R}`]: { status: 401, body: { message: 'Bad credentials' } } }).gh.validate(), { ok: false, status: 401 });
  assert.deepEqual(await client({ [`GET ${R}`]: { status: 404, body: { message: 'Not Found' } } }).gh.validate(), { ok: false, status: 404 });
  assert.deepEqual(await client({ [`GET ${R}`]: new TypeError('fetch failed') }).gh.validate(), { ok: false, status: 0 });
});

/* ─── errors ─── */

test('a 401 or 403 anywhere rejects with AuthError', async () => {
  for (const status of [401, 403]) {
    const deny = () => ({ status, body: { message: 'Bad credentials' } });
    const all = new Proxy({}, { has: () => true, get: () => deny });
    const { gh } = client(all);
    for (const [name, run] of Object.entries({
      getHead: () => gh.getHead(),
      getFile: () => gh.getFile('content/site.json'),
      listTree: () => gh.listTree(),
      commitFiles: () => gh.commitFiles(COMMIT_INPUT),
      latestRun: () => gh.latestRun('x'),
      latestSuccessfulRun: () => gh.latestSuccessfulRun(),
      runJobs: () => gh.runJobs(7),
    })) {
      const err = await run().then(() => null, (e) => e);
      assert.ok(err instanceof AuthError, `${name} on ${status}`);
      assert.ok(err instanceof GitHubError);
      assert.equal(err.status, status);
    }
  }
  // the ref update too (a 401 there is about the token, not a conflict)
  const { gh } = client(commitRoutes({ patch: { status: 401, body: {} } }));
  assert.ok(await gh.commitFiles(COMMIT_INPUT).then(() => false, (e) => e instanceof AuthError));
});

test('other failures reject with GitHubError carrying the status (0 when GitHub cannot be reached)', async () => {
  const ref = `GET ${R}/git/ref/heads/${BRANCH}`;
  const err = await client({ [ref]: { status: 500, body: { message: 'Server Error' } } }).gh.getHead().then(() => null, (e) => e);
  assert.ok(err instanceof GitHubError && !(err instanceof AuthError));
  assert.equal(err.status, 500);
  const offline = await client({ [ref]: new TypeError('fetch failed') }).gh.getHead().then(() => null, (e) => e);
  assert.ok(offline instanceof GitHubError);
  assert.equal(offline.status, 0);
  const notFound = await client({ [ref]: { status: 404, body: { message: 'Not Found' } } }).gh.getHead().then(() => null, (e) => e);
  assert.ok(notFound instanceof GitHubError);
  assert.equal(notFound.status, 404);
});

/* ─── headers and the token ─── */

// Every method once, against routes that answer everything sensibly.
async function exerciseAll() {
  const { gh, calls } = client({
    ...HEAD_ROUTES,
    ...commitRoutes(),
    [`GET ${R}`]: { body: {} },
    [`GET ${R}/contents/content/site.json?ref=${BRANCH}`]: { body: { sha: 's', encoding: 'base64', content: b64('{}') } },
    [`GET ${R}/git/trees/head-tree?recursive=1`]: { body: { tree: [] } },
    [`GET ${R}/actions/runs?branch=${BRANCH}&event=push&per_page=5`]: { body: { workflow_runs: [] } },
    [`GET ${R}/actions/runs?branch=${BRANCH}&status=success&per_page=1`]: { body: { workflow_runs: [] } },
    [`GET ${R}/actions/runs/7/jobs`]: { body: { jobs: [] } },
  });
  await gh.validate();
  await gh.getHead();
  await gh.getFile('content/site.json');
  await gh.listTree();
  await gh.commitFiles(COMMIT_INPUT);
  await gh.latestRun('x');
  await gh.latestSuccessfulRun();
  await gh.runJobs(7);
  return calls;
}

test('every request carries the bearer token, the GitHub media type and the API version', async () => {
  const calls = await exerciseAll();
  assert.equal(calls.length, 16);
  for (const c of calls) {
    assert.ok(c.url.startsWith(`${API}/`), c.url);
    assert.equal(c.headers.Authorization, `Bearer ${TOKEN}`, c.url);
    assert.equal(c.headers.Accept, 'application/vnd.github+json', c.url);
    assert.equal(c.headers['X-GitHub-Api-Version'], '2022-11-28', c.url);
  }
});

test('the token never appears in a request URL, a request body or an error message', async () => {
  const calls = await exerciseAll();
  for (const c of calls) {
    assert.ok(!c.url.includes(TOKEN), c.url);
    assert.ok(!JSON.stringify(c.body ?? '').includes(TOKEN), c.url);
  }
  const echo = { status: 500, body: { message: `boom ${TOKEN}` } };
  const err = await client({ [`GET ${R}/git/ref/heads/${BRANCH}`]: echo }).gh.getHead().then(() => null, (e) => e);
  assert.ok(err instanceof GitHubError);
  assert.ok(!err.message.includes(TOKEN) && !String(err.stack).includes(TOKEN));
});
