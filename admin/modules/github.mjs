// GitHub REST client of the dashboard (spec 13.4, 13.6, 13.7). Browser-safe: only fetch, btoa/atob (through
// vault.mjs) and TextEncoder; `fetch` is injectable, so the Node tests run it against a recording fake.
//
// The token travels only in the Authorization header: never in a URL, a request body, an error message or a log.
// Every non-2xx answer becomes a GitHubError with its HTTP status (0 when GitHub could not be reached at all):
//   403, 429 of a rate limit    GitHubError with rateLimited: true (X-RateLimit-Remaining: 0, a Retry-After header or
//                               "rate limit" in GitHub's message): not the token's fault, so no AuthError
//   401, 403                    AuthError (the token is wrong, expired or lacks a permission; spec 13.7)
//   409, 422 on the ref update  ConflictError (the branch moved since `parent`; spec 13.6 step 3)
//   404 from getFile            no error: getFile returns null

import { toB64, fromB64 } from '../../assets/js/vault.mjs';

const API = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const MAX_DETAIL = 200;                     // characters of GitHub's own error message kept in ours

/** What the dashboard says when GitHub rate-limits it (the load card, the token check). */
export const RATE_LIMIT_TEXT = 'GitHub rate limit — try again in a few minutes';

export class GitHubError extends Error {
  constructor(status, message, options) {
    super(message, options);
    this.name = 'GitHubError';
    this.status = status;
    this.rateLimited = false;               // true for a 403 or 429 that is a rate limit
  }
}

export class AuthError extends GitHubError {
  constructor(status, message, options) {
    super(status, message, options);
    this.name = 'AuthError';
  }
}

export class ConflictError extends GitHubError {
  constructor(status, message, options) {
    super(status, message, options);
    this.name = 'ConflictError';
  }
}

// A 403 or 429 that GitHub sends for a (primary or secondary) rate limit rather than for the token. The headers are
// readable across origins: api.github.com exposes them (Access-Control-Expose-Headers).
function isRateLimit(res, message) {
  if (res.status === 429) return true;
  if (res.status !== 403) return false;
  const header = (name) => {
    try { return res.headers?.get?.(name) ?? null; } catch { return null; }
  };
  return header('x-ratelimit-remaining') === '0' || header('retry-after') !== null || /rate limit/i.test(message);
}

// 'a b/c#d' -> 'a%20b/c%23d': every segment encoded, the slashes kept.
const encodePath = (path) => String(path).split('/').map(encodeURIComponent).join('/');

/**
 * createGitHub({ token, owner, repo, branch, fetch }) -> the client below. All methods return promises.
 *   validate()            { ok, status } of GET /repos/{owner}/{repo} (plus rateLimited: true during a rate limit);
 *                         never throws (status 0: unreachable)
 *   getHead()             { sha, tree } of the branch head
 *   getFile(path, ref?)   { sha, bytes } of the file on the branch (or at commit `ref`), or null when it does not exist
 *   listTree(treeSha?)    the paths of every file (blob) in the head commit (or in the tree `treeSha`), recursively
 *   commitFiles({ message, files: [{ path, bytes }], deletes: [path], parent })  -> { sha } of the new commit
 *   latestRun(headSha)    { id, status, conclusion, html_url } of the push run for that commit, or null
 *   latestSuccessfulRun() { updated_at } of the newest successful run on the branch, or null
 *   runJobs(runId)        [{ name, status, conclusion }] of the jobs of that run
 */
export function createGitHub({ token, owner, repo, branch, fetch: fetchImpl = globalThis.fetch } = {}) {
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const branchQuery = encodeURIComponent(branch);
  const hide = (text) => (token ? String(text).split(token).join('[token]') : String(text));

  // One API call. `path` starts with '/'. Options: body (sent as JSON), notFound (the value to return on a 404
  // instead of throwing), conflict (409 and 422 throw ConflictError: the ref update only).
  async function request(method, path, { body, notFound, conflict = false } = {}) {
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const what = `${method} ${path.split('?')[0]}`;

    let res;
    try {
      res = await fetchImpl(API + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',                  // the conflict check and the run polling need fresh answers
      });
    } catch {
      throw new GitHubError(0, `Could not reach GitHub (${what})`);
    }

    if (res.ok) return res.status === 204 ? null : res.json();
    if (res.status === 404 && notFound !== undefined) return notFound;

    let detail = '';
    let raw = '';
    try {
      const data = await res.json();
      if (data && typeof data.message === 'string') {
        raw = data.message;
        detail = `: ${hide(data.message).slice(0, MAX_DETAIL)}`;
      }
    } catch { /* no JSON body */ }
    const message = `GitHub answered ${res.status} to ${what}${detail}`;
    if (isRateLimit(res, raw)) {
      const err = new GitHubError(res.status, message);
      err.rateLimited = true;
      throw err;
    }
    if (res.status === 401 || res.status === 403) throw new AuthError(res.status, message);
    if (conflict && (res.status === 409 || res.status === 422)) throw new ConflictError(res.status, message);
    throw new GitHubError(res.status, message);
  }

  const get = (path, options) => request('GET', `${repoPath}${path}`, options);
  const post = (path, body) => request('POST', `${repoPath}${path}`, { body });

  const decode = (content) => fromB64(String(content ?? '').replace(/\s+/g, ''));

  async function validate() {
    try {
      await request('GET', repoPath);
      return { ok: true, status: 200 };
    } catch (err) {
      if (err instanceof GitHubError) return err.rateLimited ? { ok: false, status: err.status, rateLimited: true } : { ok: false, status: err.status };
      throw err;
    }
  }

  async function commitTree(sha) {
    const commit = await get(`/git/commits/${encodeURIComponent(sha)}`);
    return commit.tree.sha;
  }

  async function getHead() {
    const ref = await get(`/git/ref/heads/${encodePath(branch)}`);
    const sha = ref.object.sha;
    return { sha, tree: await commitTree(sha) };
  }

  // `ref` (a commit sha, say) reads the file as it was there; the default is the branch head.
  async function getFile(path, ref) {
    const at = ref === undefined || ref === null ? branchQuery : encodeURIComponent(ref);
    const file = await get(`/contents/${encodePath(path)}?ref=${at}`, { notFound: null });
    if (file === null) return null;
    if (Array.isArray(file) || typeof file.sha !== 'string') throw new GitHubError(200, `${path} is not a file`);
    if (file.encoding === 'base64') return { sha: file.sha, bytes: decode(file.content) };
    // Files over 1 MB come without content from the Contents API; the blob API serves them up to 100 MB.
    const blob = await get(`/git/blobs/${encodeURIComponent(file.sha)}`);
    return { sha: file.sha, bytes: decode(blob.content) };
  }

  async function listTree(treeSha) {
    const tree = typeof treeSha === 'string' && treeSha ? treeSha : (await getHead()).tree;
    const data = await get(`/git/trees/${encodeURIComponent(tree)}?recursive=1`);
    if (data.truncated) throw new GitHubError(200, 'The repository tree is too large to list in one request');
    return (data.tree ?? []).filter((entry) => entry.type === 'blob').map((entry) => entry.path);
  }

  // Blobs one at a time (each upload holds one base64 copy of one file), then one tree on top of the parent's tree,
  // one commit, and the branch moved to it only if it still points at `parent` (force: false).
  async function commitFiles({ message, files = [], deletes = [], parent }) {
    const baseTree = await commitTree(parent);
    const entries = [];
    for (const { path, bytes } of files) {
      let blob;
      try {
        blob = await post('/git/blobs', { content: toB64(bytes), encoding: 'base64' });
      } catch (err) {
        if (err instanceof GitHubError) {
          err.message = `Uploading ${path} failed. ${err.message}`;
          err.path = path;
        }
        throw err;
      }
      entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    for (const path of deletes) entries.push({ path, mode: '100644', type: 'blob', sha: null });

    const tree = await post('/git/trees', { base_tree: baseTree, tree: entries });
    const commit = await post('/git/commits', { message, tree: tree.sha, parents: [parent] });
    await request('PATCH', `${repoPath}/git/refs/heads/${encodePath(branch)}`, {
      body: { sha: commit.sha, force: false },
      conflict: true,
    });
    return { sha: commit.sha };
  }

  async function latestRun(headSha) {
    const data = await get(`/actions/runs?branch=${branchQuery}&event=push&per_page=5`);
    const run = (data.workflow_runs ?? []).find((r) => r.head_sha === headSha);
    return run ? { id: run.id, status: run.status, conclusion: run.conclusion, html_url: run.html_url } : null;
  }

  // The jobs of one run (the publish UI reads whether `deploy` was skipped: DEPLOY_FROM_ACTIONS is off).
  async function runJobs(runId) {
    const data = await get(`/actions/runs/${encodeURIComponent(String(runId))}/jobs`);
    return (data.jobs ?? []).map((job) => ({ name: job.name, status: job.status, conclusion: job.conclusion }));
  }

  // `status=success` is how the runs API filters on a conclusion (it has no `conclusion` parameter).
  async function latestSuccessfulRun() {
    const data = await get(`/actions/runs?branch=${branchQuery}&status=success&per_page=1`);
    const run = (data.workflow_runs ?? [])[0];
    return run ? { updated_at: run.updated_at } : null;
  }

  return { validate, getHead, getFile, listTree, commitFiles, latestRun, latestSuccessfulRun, runJobs };
}
