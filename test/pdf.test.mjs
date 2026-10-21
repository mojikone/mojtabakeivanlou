import { test } from 'node:test'; import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { build } from '../src/build.mjs';
import { isBlockedUrl, renderPdf } from '../src/pdf.mjs';
import { withRoot } from './helpers/project.mjs';

// The render needs Chromium (downloaded by `npm i`) and Google Fonts, so it only runs on CI or when asked for:
//   PDF_TEST=1 npm test        (PowerShell: $env:PDF_TEST='1'; npm test)
const RUN = process.env.CI === 'true' || process.env.PDF_TEST === '1';
const SKIP = RUN ? false : 'renders a PDF with Chromium: set PDF_TEST=1 (or CI=true) to run';

test('the PDF render blocks the Firebase SDK and database and Google Analytics, and nothing else (fonts must load)', () => {
  const blocked = [
    'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
    'https://mojtaba-website-default-rtdb.europe-west1.firebasedatabase.app/.lp?start=t',
    'wss://s-gke-euw1-nssi1-1.europe-west1.firebasedatabase.app/.ws?v=5',
    'https://mojtaba-website.firebaseio.com/.json',
    'https://www.googletagmanager.com/gtag/js?id=G-FMKJ61FF7F',
    'https://region1.google-analytics.com/g/collect?v=2&tid=G-FMKJ61FF7F',
    'https://www.google-analytics.com/g/collect?v=2',
    'https://google-analytics.com/collect',
  ];
  const allowed = [
    'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap',
    'https://fonts.gstatic.com/s/poppins/v21/pxiByp8kv8JHgFVrLDz8Z1xlFQ.woff2',
    'http://127.0.0.1:51234/cv.html',
    'http://127.0.0.1:51234/assets/css/cv.css?v=1a2b3c4d',
    'https://www.gstatic.com.example.com/x.js',
    'https://notfirebasedatabase.app/',
    'https://evilfirebaseio.com/',
    'https://evilgoogle-analytics.com/',
    'https://www.googletagmanager.com.example.com/gtag/js',
    'data:image/svg+xml;base64,PHN2Zy8+',
    'about:blank',
    'not a url',
  ];
  for (const url of blocked) assert.equal(isBlockedUrl(url), true, url);
  for (const url of allowed) assert.equal(isBlockedUrl(url), false, url);
});

test('renderPdf rejects a missing or non-plain filename before starting anything', async () => {
  await assert.rejects(renderPdf({}), /filename/);
  await assert.rejects(renderPdf({ filename: '../escape.pdf' }), /filename/);
  await assert.rejects(renderPdf({ filename: 'sub/cv.pdf' }), /filename/);
});

test('renderPdf writes a multi-page CV PDF into dist/pdf/', { skip: SKIP, timeout: 90_000 }, async () => {
  await withRoot(async (root) => {
    await build({ root });
    const path = await renderPdf({ distDir: join(root, 'dist'), filename: 'CV_smoke_test.pdf' });

    assert.ok(isAbsolute(path), `absolute path expected, got ${path}`);
    assert.equal(path, join(root, 'dist', 'pdf', 'CV_smoke_test.pdf'));
    assert.ok((await stat(path)).size > 50000, 'the PDF is more than 50 kB');

    const bytes = await readFile(path, 'latin1');
    assert.ok(bytes.startsWith('%PDF-'), 'it is a PDF');
    // A page object is `/Type /Page`; the page tree is `/Type /Pages`, hence the [^s].
    const pages = bytes.match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;
    assert.ok(pages >= 2, `the CV spans at least two pages, found ${pages}`);
  });
});

test('renderPdf fails on a dist without cv.html instead of writing a "Not found" PDF', { skip: SKIP, timeout: 90_000 }, async () => {
  const distDir = await mkdtemp(join(tmpdir(), 'mk-pdf-empty-'));
  try {
    await assert.rejects(renderPdf({ distDir, filename: 'CV_missing.pdf' }), /cv.html returned HTTP 404/);
    await assert.rejects(stat(join(distDir, 'pdf', 'CV_missing.pdf')), { code: 'ENOENT' }, 'no PDF is written');
  } finally {
    await rm(distDir, { recursive: true, force: true });
  }
});
