import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.bin': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

function send(res, status, headers, body) {
  res.writeHead(status, { 'Content-Length': body.length, ...headers });
  res.end(body);
}

function notFound(res) {
  send(res, 404, { 'Content-Type': MIME['.txt'] }, Buffer.from('Not found'));
}

// Maps a request URL to a file path under root, or null when it must be refused.
function resolveTarget(root, rawUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(rawUrl, 'http://localhost').pathname);
  } catch {
    return null;
  }
  if (pathname.includes('..') || pathname.includes('\0')) return null;
  const target = resolve(join(root, pathname));
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

export async function startServer(dir, port = 0) {
  const root = resolve(dir);

  const server = createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, { Allow: 'GET, HEAD', 'Content-Type': MIME['.txt'] }, Buffer.from('Method not allowed'));
    }
    let file = resolveTarget(root, req.url);
    if (!file) return notFound(res);
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR' || err.code === 'EISDIR') return notFound(res);
      send(res, 500, { 'Content-Type': MIME['.txt'] }, Buffer.from('Internal server error'));
    }
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, '127.0.0.1', resolveListen);
  });

  const { port: boundPort } = server.address();
  return {
    port: boundPort,
    url: `http://127.0.0.1:${boundPort}`,
    close: () => new Promise((resolveClose, rejectClose) => {
      server.close((err) => (err ? rejectClose(err) : resolveClose()));
      server.closeAllConnections();
    }),
  };
}
