// Renders the CV page (dist/cv.html) to a PDF with headless Chromium (Node only).
//
//   npm run build && npm run pdf       (the build empties dist/, so the PDF is always rendered after it)
//
// The page's own @page rule (A4, margins, page-number footer) is what shapes the PDF, hence `preferCSSPageSize` and no
// puppeteer header/footer.

import { mkdir, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import { isMain } from './is-main.mjs';
import { startServer } from './serve.mjs';

// The CV loads assets/js/palette.js, which pulls the Firebase SDK from www.gstatic.com and then keeps a Realtime Database
// connection open. Left alone, that connection would stop `networkidle0` from ever settling and the colours would depend
// on whatever the global default is in the database at render time. So the renderer refuses those requests: the PDF is
// deterministic and always uses palette.js's own DEFAULT_ID colours, not the Firebase global default.
// Google Fonts (fonts.googleapis.com / fonts.gstatic.com) must stay reachable, so www.gstatic.com is matched exactly.
const FIREBASE_HOSTS = ['www.gstatic.com'];
const FIREBASE_DOMAINS = ['firebasedatabase.app', 'firebaseio.com'];   // the domains themselves and every subdomain

/** True for a request the PDF renderer must refuse: the Firebase SDK (www.gstatic.com) or the Realtime Database. */
export function isFirebaseUrl(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return FIREBASE_HOSTS.includes(host) || FIREBASE_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/**
 * Renders `<distDir>/cv.html` to `<distDir>/pdf/<filename>`.
 * Serves distDir on a random local port and drives Chromium; both are always closed again, also on failure.
 * Google Fonts needs network: offline the PDF still renders, with the fallback font.
 * @param {{ distDir?: string, filename: string }} options
 *   distDir: the built site (the output of build()); defaults to `dist`.
 *   filename: the PDF's file name (site.cvPdfFilename), a plain name without a folder.
 * @returns {Promise<string>} the absolute path of the PDF written.
 */
export async function renderPdf({ distDir = 'dist', filename } = {}) {
  if (typeof filename !== 'string' || !filename || basename(filename) !== filename) {
    throw new TypeError(`renderPdf: filename must be a plain file name, got ${JSON.stringify(filename)}`);
  }
  const outDir = resolve(distDir, 'pdf');
  const path = join(outDir, filename);

  // Loaded here, not at the top, so that importing this module (and running the other tests) does not need puppeteer.
  const { default: puppeteer } = await import('puppeteer');

  await mkdir(outDir, { recursive: true });
  const server = await startServer(distDir);
  try {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        if (isFirebaseUrl(request.url())) request.abort('blockedbyclient');
        else request.continue();
      });
      await page.goto(`${server.url}/cv.html`, { waitUntil: 'networkidle0' });
      await page.evaluate(async () => { await document.fonts.ready; });
      await page.pdf({ path, preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
    } finally {
      await browser.close();
    }
  } finally {
    await server.close();
  }
  return path;
}

// ---- command line -----------------------------------------------------------------------------------------------

if (isMain(import.meta.url)) {
  try {
    const site = JSON.parse((await readFile('content/site.json', 'utf8')).replace(/^\uFEFF/, ''));
    console.log(await renderPdf({ filename: site.site.cvPdfFilename }));
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
}
