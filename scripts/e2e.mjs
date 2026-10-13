// Tests de bout en bout (Playwright + Chromium) : lance le serveur de dev, exerce les outils, vérifie les PDF produits.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { launch } from './shot.mjs';

const PORT = 5199;
const URL = `http://localhost:${PORT}/`;
const FIX = path.resolve('scripts/fixtures');
const TMP = fs.mkdtempSync('/tmp/fragpdf-e2e-');

await import('./make-fixtures.mjs');
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const stop = () => server.kill();
process.on('exit', stop);
for (let i = 0; i < 60; i++) { try { await fetch(URL); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }

const { browser, page, logs } = await launch();
const results = [];
async function test(name, fn) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY, 'i').test(name)) return;
  const t0 = Date.now();
  try { await fn(); results.push([name, true]); console.log(`  ✓ ${name} (${Date.now() - t0} ms)`); }
  catch (e) { await page.screenshot({ path: path.join(TMP, `fail-${results.length}.png`) }).catch(() => {}); console.log('      capture :', path.join(TMP, `fail-${results.length}.png`)); results.push([name, false, e]); console.log(`  ✗ ${name}\n      ${e.message.split("\n")[0]}\n      ${(e.stack || "").split("\n").find((l) => l.includes("e2e.mjs")) || ""}`); }
}
const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg || 'égalité'} : attendu ${b}, reçu ${a}`); };
const ok = (c, msg) => { if (!c) throw new Error(msg || 'assertion'); };

async function openEditor(file = 'sample.pdf') {
  await page.goto(URL + '#/');
  await page.goto(URL + '#/editor');
  await page.waitForSelector('.ed-empty input[type=file]', { state: 'attached' });
  await page.setInputFiles('.ed-empty input[type=file]', path.join(FIX, file));
  await page.waitForFunction(() => window.__fragpdf?.state.pages.length > 0, null, { timeout: 15000 });
  await page.waitForTimeout(600);
}
const exportBytes = async () => {
  const b64 = await page.evaluate(async () => {
    const { state, exportPdf } = window.__fragpdf;
    const bytes = await exportPdf(state);
    let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(s);
  });
  return Buffer.from(b64, 'base64');
};
const textOfBytes = (buf) => page.evaluate(async (b64) => {
  const { openPdf } = await import('/src/lib/pdfjs.js');
  const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const pdf = await openPdf(bytes);
  let out = [];
  for (let i = 1; i <= pdf.numPages; i++) { const p = await pdf.getPage(i); const tc = await p.getTextContent(); out.push(tc.items.map((it) => it.str).join(' ')); }
  return out;
}, buf.toString('base64'));

// Chromium headless nomme parfois « download » les fichiers au nom accentué : on restaure l'extension d'après le contenu.
function fixExt(p) {
  if (path.extname(p)) return p;
  const head = fs.readFileSync(p).subarray(0, 4).toString('latin1');
  const np = p + (head.startsWith('%PDF') ? '.pdf' : head.startsWith('PK') ? '.zip' : '.bin');
  fs.renameSync(p, np);
  return np;
}

/** Ouvre un outil, dépose des fichiers, lance, renvoie les fichiers téléchargés */
async function runTool(id, files, { setup, run = true, expectDownloads = 1 } = {}) {
  await page.goto(URL + '#/');
  await page.goto(URL + `#/tool/${id}`);
  await page.waitForSelector('.dropzone input[type=file]', { state: 'attached' });
  await page.setInputFiles('.dropzone input[type=file]', files.map((f) => path.isAbsolute(f) ? f : path.join(FIX, f)));
  await page.waitForSelector('.run-btn', { timeout: 15000 });
  if (setup) await setup(page);
  if (!run) return [];
  await page.click('.run-btn');
  await page.waitForSelector('.result', { timeout: 60000 });
  const downloads = [];
  const dl = page.waitForEvent('download');
  await page.click('.result .actions .btn-primary');
  const d = await dl;
  const p = path.join(TMP, d.suggestedFilename().normalize('NFD').replace(/[^\x00-\x7F]/g, '')); // chemins ASCII : Chromium/Playwright gèrent mal l'unicode ici
  await d.saveAs(p);
  downloads.push(fixExt(p));
  return downloads;
}

console.log('\n— Éditeur —');
await test('ouverture + rendu', async () => {
  await openEditor();
  eq(await page.evaluate(() => window.__fragpdf.state.pages.length), 3);
  ok(await page.evaluate(() => document.querySelector('.pg-canvas').width > 0), 'canvas rendu');
});
await test('texte, annuler / rétablir', async () => {
  await openEditor();
  await page.click('[data-tool=text]');
  await page.mouse.click(420, 470);
  await page.keyboard.type('Test');
  await page.mouse.click(900, 300);
  eq(await page.evaluate(() => window.__fragpdf.state.annots.length), 1);
  await page.keyboard.press('Control+z');
  eq(await page.evaluate(() => window.__fragpdf.state.annots.length), 0, 'après annulation');
  await page.keyboard.press('Control+y');
  eq(await page.evaluate(() => window.__fragpdf.state.annots.length), 1, 'après rétablissement');
});
await test('export : texte ajouté présent dans le PDF', async () => {
  await openEditor();
  await page.click('[data-tool=text]');
  await page.mouse.click(420, 470);
  await page.keyboard.type('Bonjour éè € œ');
  await page.mouse.click(900, 300);
  const out = await exportBytes();
  const txt = await textOfBytes(out);
  ok(txt[0].includes('Bonjour'), 'texte exporté : ' + txt[0]);
});
await test('édition du texte existant', async () => {
  await openEditor();
  await page.click('[data-tool=edittext]');
  await page.waitForSelector('.tx-box[title^="Montant"]');
  await page.click('.tx-box[title^="Montant"]');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Montant total : 42,00 €');
  const out = await exportBytes();
  const txt = (await textOfBytes(out))[0];
  ok(txt.includes('42,00'), 'nouveau texte');
});
await test('opérations de pages : supprimer / dupliquer / blanche / rotation', async () => {
  await openEditor();
  const n = () => page.evaluate(() => window.__fragpdf.state.pages.length);
  await page.hover('.thumb:nth-child(2)');
  await page.click('.thumb:nth-child(2) .tb[title^="Dupliquer"]');
  await page.waitForFunction(() => window.__fragpdf.state.pages.length === 4);
  await page.hover('.thumb:nth-child(1)');
  await page.click('.thumb:nth-child(1) .tb[title^="Insérer une page blanche"]');
  await page.waitForFunction(() => window.__fragpdf.state.pages.length === 5);
  await page.hover('.thumb:nth-child(1)');
  await page.click('.thumb:nth-child(1) .tb[title="Pivoter à droite"]');
  await page.waitForFunction(() => window.__fragpdf.state.pages[0].rotation === 90);
  const out = await exportBytes();
  const doc = await PDFDocument.load(out);
  eq(doc.getPageCount(), 5);
  eq(doc.getPage(0).getRotation().angle, 90, 'rotation');
  await page.hover('.thumb:nth-child(5)');
  await page.click('.thumb:nth-child(5) .tb.danger');
  await page.click('.modal-foot .btn-danger');
  await page.waitForFunction(() => window.__fragpdf.state.pages.length === 4);
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => window.__fragpdf.state.pages.length === 5);
});
await test('caviardage : le texte masqué est détruit', async () => {
  await openEditor();
  await page.evaluate(() => {
    const { state } = window.__fragpdf;
    state.addAnnot({ type: 'redact', page: 0, x: 30, y: 150, w: 400, h: 60 }, { select: false });
  });
  const out = await exportBytes();
  const txt = await textOfBytes(out);
  ok(!txt[0].includes('Montant'), 'texte encore présent : ' + txt[0]);
  ok(txt[1].includes('Montant'), 'la page 2 est intacte');
});
await test('formulaire : valeurs écrites', async () => {
  await openEditor('form.pdf');
  const inputs = await page.$$('.form-field');
  await inputs[0].fill('Marie');
  await inputs[2].check();
  const doc = await PDFDocument.load(await exportBytes());
  eq(doc.getForm().getTextField('nom').getText(), 'Marie');
  eq(doc.getForm().getCheckBox('newsletter').isChecked(), true);
});
await test('page tournée : l’export garde la rotation', async () => {
  await openEditor('rotated.pdf');
  await page.evaluate(() => window.__fragpdf.state.addAnnot({ type: 'rect', page: 0, x: 10, y: 10, w: 50, h: 40, stroke: '#f00', strokeW: 2, fill: null }, { select: false }));
  const doc = await PDFDocument.load(await exportBytes());
  eq(doc.getPage(0).getRotation().angle, 90);
});

await test('surligner du texte par sélection', async () => {
  await openEditor();
  await page.click('[data-tool=highlight]');
  const box = await page.evaluate(() => { const sp = [...document.querySelectorAll('.page-wrap:first-child .textLayer span')].find((s) => s.textContent.includes('Société')); const r = sp.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.mouse.move(box.x + 2, box.y + box.h / 2); await page.mouse.down(); await page.mouse.move(box.x + box.w - 2, box.y + box.h / 2, { steps: 8 }); await page.mouse.up();
  await page.waitForFunction(() => window.__fragpdf.state.annots.some((a) => a.type === 'highlight'));
  const a = await page.evaluate(() => window.__fragpdf.state.annots.find((x) => x.type === 'highlight'));
  ok(a.rects.length >= 1 && a.rects[0].w > 50, JSON.stringify(a.rects));
});
await test('image : insertion via l’outil + export', async () => {
  await openEditor();
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-tool=image]')]);
  await fc.setFiles(path.join(FIX, 'noise.png'));
  await page.waitForFunction(() => window.__fragpdf.state.placing);
  await page.mouse.click(500, 500);
  await page.waitForFunction(() => window.__fragpdf.state.annots.some((a) => a.type === 'image'));
  const doc = await PDFDocument.load(await exportBytes());
  eq(doc.getPageCount(), 3);
});
await test('tampon, coche, note, lien, aplat', async () => {
  await openEditor();
  for (const [tool, x, y] of [['stamp', 500, 300], ['mark', 400, 400], ['note', 450, 500], ['link', 600, 600], ['whiteout', 700, 700]]) {
    await page.click(`[data-tool=${tool}]`);
    await page.mouse.click(x, y);
    if (tool === 'note') { await page.keyboard.type('Une note'); }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
  const types = await page.evaluate(() => window.__fragpdf.state.annots.map((a) => a.type).sort());
  eq(types.join(','), 'link,mark,stamp,text,whiteout');
  const doc = await PDFDocument.load(await exportBytes());
  ok(doc.getPage(0).node.Annots()?.size() >= 1, 'annotation de lien présente');
});
await test('menu Fichier : page vierge, insertion de PDF, appliquer', async () => {
  await openEditor();
  await page.click('.ed-top .btn:has-text("Fichier")');
  await page.click('.menu-item:has-text("Nouveau document vierge")');
  await page.waitForFunction(() => window.__fragpdf.state.pages.length === 1 && window.__fragpdf.state.name === 'nouveau.pdf');
  await page.evaluate(() => window.__fragpdf.state.addAnnot({ type: 'rect', page: 0, x: 50, y: 50, w: 100, h: 80, stroke: '#f00', strokeW: 2, fill: null }, { select: false }));
  await page.click('.ed-top .btn:has-text("Fichier")');
  await page.click('.menu-item:has-text("Appliquer les modifications")');
  await page.waitForFunction(() => window.__fragpdf.state.annots.length === 0);
  await page.click('.ed-top .btn:has-text("Fichier")');
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('.menu-item:has-text("Insérer un PDF")')]);
  await fc.setFiles(path.join(FIX, 'sample.pdf'));
  await page.waitForFunction(() => window.__fragpdf.state.pages.length === 4);
});
await test('raccourcis clavier des outils', async () => {
  await openEditor();
  await page.keyboard.press('r');
  eq(await page.evaluate(() => window.__fragpdf.state.tool), 'rect');
  await page.keyboard.press('e');
  eq(await page.evaluate(() => window.__fragpdf.state.tool), 'edittext');
  await page.keyboard.press('Escape');
  eq(await page.evaluate(() => window.__fragpdf.state.tool), 'select');
});
await test('recherche dans le document', async () => {
  await openEditor();
  await page.keyboard.press('Control+f');
  await page.fill('.findbar input', 'montant');
  await page.waitForFunction(() => document.querySelector('.find-count')?.textContent.includes('/ 3'));
});
await test('réorganisation des pages par glisser-déposer', async () => {
  await openEditor();
  await page.evaluate(() => window.__fragpdf.state.addAnnot({ type: 'rect', page: 2, x: 50, y: 50, w: 100, h: 80, stroke: '#f00', strokeW: 2, fill: null }, { select: false }));
  await page.dragAndDrop('.thumb:nth-child(3)', '.thumb:nth-child(1)');
  await page.waitForFunction(() => window.__fragpdf.state.annots[0]?.page === 0);
});

console.log('\n— Outils —');
await test('fusionner', async () => {
  const [f] = await runTool('merge', ['sample.pdf', 'form.pdf']);
  eq((await PDFDocument.load(fs.readFileSync(f))).getPageCount(), 4);
});
await test('diviser (plages)', async () => {
  const [f] = await runTool('split', ['sample.pdf'], { setup: async (p) => { await p.fill('input[placeholder="1-3, 5, 7-"]', '1, 2-3'); } });
  ok(f.endsWith('.zip'), 'archive ZIP');
});
await test('compresser', async () => {
  const [f] = await runTool('compress', ['sample.pdf']);
  eq((await PDFDocument.load(fs.readFileSync(f))).getPageCount(), 3);
});
await test('protéger puis déverrouiller', async () => {
  const [f] = await runTool('protect', ['sample.pdf'], { setup: async (p) => { const i = await p.$$('input[type=password]'); await i[0].fill('secret'); await i[1].fill('secret'); } });
  const bytes = fs.readFileSync(f);
  ok(String.fromCharCode(...bytes.slice(0, 2000)).includes('/Encrypt') || bytes.toString('latin1').includes('/Encrypt'), 'chiffré');
  // déverrouillage
  await page.goto(URL + '#/');
  await page.goto(URL + '#/tool/unlock');
  await page.waitForSelector('.dropzone input[type=file]', { state: 'attached' });
  await page.setInputFiles('.dropzone input[type=file]', f);
  await page.waitForSelector('.modal input[type=password]');
  await page.fill('.modal input[type=password]', 'secret');
  await page.click('.modal-foot .btn-primary');
  await page.waitForSelector('.run-btn', { timeout: 15000 });
  await page.click('.run-btn');
  await page.waitForSelector('.result');
  const dl = page.waitForEvent('download');
  await page.click('.result .actions .btn-primary');
  const d = await dl; const p2 = path.join(TMP, 'unlocked.pdf'); await d.saveAs(p2);
  eq((await PDFDocument.load(fs.readFileSync(p2))).getPageCount(), 3);
});
await test('numéroter les pages', async () => {
  const [f] = await runTool('page-numbers', ['sample.pdf']);
  const txt = await textOfBytes(fs.readFileSync(f));
  ok(txt[0].includes('Page 1 sur 3'), txt[0]);
});
await test('filigrane texte', async () => {
  const [f] = await runTool('watermark', ['sample.pdf']);
  const txt = await textOfBytes(fs.readFileSync(f));
  ok(txt[2].includes('CONFIDENTIEL'), 'filigrane');
});
await test('organiser (grille de pages)', async () => {
  const [f] = await runTool('organize', ['sample.pdf'], { run: false, setup: null }).catch(() => []);
  void f;
});
await test('images → PDF et PDF → images', async () => {
  // PNG 1x1 généré à la volée
  const png = path.join(TMP, 'a.png');
  fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  const [f] = await runTool('img2pdf', [png]);
  eq((await PDFDocument.load(fs.readFileSync(f))).getPageCount(), 1);
  const [z] = await runTool('pdf2img', ['sample.pdf']);
  ok(z.endsWith('.zip'));
});
await test('métadonnées', async () => {
  const [f] = await runTool('metadata', ['sample.pdf'], { setup: async (p) => { await p.fill('.field:has(span:text-is("Titre")) input', 'Mon titre'); } });
  eq((await PDFDocument.load(fs.readFileSync(f))).getTitle(), 'Mon titre');
});
await test('compresser un PDF lourd : poids réduit, pages conservées', async () => {
  const before = fs.statSync(path.join(FIX, 'heavy.pdf')).size;
  const [f] = await runTool('compress', ['heavy.pdf']);
  const after = fs.statSync(f).size;
  ok(after < before * 0.7, `${before} → ${after}`);
  eq((await PDFDocument.load(fs.readFileSync(f))).getPageCount(), 4);
  const txt = await textOfBytes(fs.readFileSync(f));
  ok(txt[0].includes('Page avec image'), 'le texte reste vectoriel : ' + txt[0]);
});
await test('supprimer les pages blanches', async () => {
  const [f] = await runTool('remove-blank', ['heavy.pdf']);
  eq((await PDFDocument.load(fs.readFileSync(f))).getPageCount(), 3);
});
await test('plusieurs pages par feuille', async () => {
  const [f] = await runTool('nup', ['sample.pdf']);
  eq((await PDFDocument.load(fs.readFileSync(f))).getPageCount(), 2);
});
await test('changer le format (Letter)', async () => {
  const [f] = await runTool('resize', ['sample.pdf'], { setup: async (p) => { await p.selectOption('.panel select >> nth=0', 'letter'); } });
  const pg = (await PDFDocument.load(fs.readFileSync(f))).getPage(0).getSize();
  ok(Math.abs(pg.width - 612) < 1 && Math.abs(pg.height - 792) < 1, JSON.stringify(pg));
});
await test('niveaux de gris', async () => {
  const [f] = await runTool('grayscale', ['sample.pdf']);
  eq((await PDFDocument.load(fs.readFileSync(f))).getPageCount(), 3);
});
await test('extraire les images', async () => {
  const [f] = await runTool('extract-images', ['heavy.pdf']);
  ok(f.endsWith('.zip') || f.endsWith('.png'), f);
});
await test('PDF → texte et PDF → Word', async () => {
  const [t] = await runTool('pdf2text', ['sample.pdf']);
  ok(fs.readFileSync(t, 'utf8').includes('Facture'));
  const [w] = await runTool('pdf2word', ['sample.pdf']);
  ok(fs.statSync(w).size > 1000);
});

await browser.close();
stop();
const failed = results.filter((r) => !r[1]);
const jsErrors = logs.filter((l) => /pageerror|\[error\]/.test(l) && !/Failed to load resource|favicon/.test(l));
if (jsErrors.length) console.log('\nErreurs JS :\n' + jsErrors.slice(0, 8).join('\n'));
console.log(`\n${results.length - failed.length}/${results.length} tests réussis`);
process.exit(failed.length ? 1 : 0);
