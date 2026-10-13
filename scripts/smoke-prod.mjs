// Test de fumée sur le build de production (vite preview) : moteur pdf.js, polices embarquées, QPDF/WASM, service worker.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';
import { launch } from './shot.mjs';

const PORT = 4199;
const URL = `http://localhost:${PORT}/`;
const FIX = path.resolve('scripts/fixtures');
await import('./make-fixtures.mjs');
if (!fs.existsSync('dist/index.html')) throw new Error('Lancez d’abord « npm run build ».');
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; i < 60; i++) { try { await fetch(URL); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }

const { browser, page, logs } = await launch();
let failed = 0;
const check = (name, cond, extra = '') => { console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' ' + extra}`); if (!cond) failed++; };

await page.goto(URL + '#/editor');
await page.waitForSelector('.ed-empty input[type=file]', { state: 'attached' });
await page.setInputFiles('.ed-empty input[type=file]', path.join(FIX, 'sample.pdf'));
await page.waitForFunction(() => window.__fragpdf?.state.pages.length === 3, null, { timeout: 15000 });
await page.waitForFunction(() => document.querySelector('.pg-canvas')?.width > 0, null, { timeout: 15000 });
check('rendu pdf.js (worker de production)', true);

const out = await page.evaluate(async () => {
  const { state, exportPdf } = window.__fragpdf;
  for (const [i, f] of ['playfair-display', 'caveat', 'roboto', 'courier'].entries()) {
    state.addAnnot({ type: 'text', page: 0, x: 40, y: 200 + i * 40, w: 400, h: 30, text: `Police ${f} — éèà € œ`, fontId: f, size: 20, color: '#111', bold: i % 2 === 0, italic: false, align: 'left', opacity: 1, lineHeight: 1.25 }, { select: false });
  }
  const bytes = await exportPdf(state);
  let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
});
const doc = await PDFDocument.load(Buffer.from(out, 'base64'));
const fontNames = [];
for (const [, obj] of doc.context.enumerateIndirectObjects()) {
  if (obj instanceof PDFDict && String(obj.get(PDFName.of('Type'))) === '/Font') { const bf = String(obj.get(PDFName.of('BaseFont')) || ''); if (/Playfair|Caveat|Roboto/.test(bf)) fontNames.push(bf); }
}
check('export avec polices Unicode embarquées', doc.getPageCount() === 3 && fontNames.length >= 3, `polices intégrées : ${fontNames.join(', ')}`);

// QPDF/WASM via l'outil « Protéger »
await page.goto(URL + '#/'); await page.goto(URL + '#/tool/protect');
await page.waitForSelector('.dropzone input[type=file]', { state: 'attached' });
await page.setInputFiles('.dropzone input[type=file]', path.join(FIX, 'sample.pdf'));
await page.waitForSelector('.run-btn');
const pw = await page.$$('input[type=password]');
await pw[0].fill('secret'); await pw[1].fill('secret');
await page.click('.run-btn');
await page.waitForSelector('.result', { timeout: 30000 });
check('chiffrement QPDF (WebAssembly) en production', true);

// service worker : activé et cache rempli
await page.goto(URL);
await page.waitForTimeout(2500);
const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); const keys = await caches.keys(); return { active: !!r?.active, caches: keys.length }; });
check('service worker actif + cache hors ligne', sw.active && sw.caches >= 1, JSON.stringify(sw));

const errors = logs.filter((l) => /pageerror|\[error\]/.test(l) && !/favicon|Failed to load resource/.test(l));
check('aucune erreur JavaScript', errors.length === 0, '\n' + errors.join('\n'));
await browser.close();
server.kill();
process.exit(failed ? 1 : 0);
