// Outils complémentaires : redimensionner, plusieurs pages par feuille, pages blanches, niveaux de gris, extraction d'images.
import { PDFDocument } from 'pdf-lib';
import { h, formatBytes, baseName, canvasToBlob } from '../lib/utils.js';
import { t } from '../i18n.js';
import { fileTool, ui, outName } from './framework.js';
import { loadDoc, save, deletePages, PAGE_SIZES } from '../lib/pdf-ops.js';
import { pageGeometry } from '../lib/geometry.js';
import { openPdf, renderPageToCanvas, pdfjs } from '../lib/pdfjs.js';

const SIZE_OPTIONS = [['a4', 'A4 (210 × 297 mm)'], ['a3', 'A3'], ['a5', 'A5'], ['letter', 'Letter (US)'], ['legal', 'Legal (US)']];

/** Charge les pages d'un document dans un nouveau, avec une taille de page donnée, via embedPage (vectoriel conservé). */
export const resize = fileTool({
  accept: 'pdf', multiple: false, runLabel: 'Redimensionner', runIcon: 'layout',
  options: () => {
    const size = ui.select(SIZE_OPTIONS, 'a4');
    const orient = ui.select([['keep', t('Selon la page d’origine')], ['portrait', t('Portrait')], ['landscape', t('Paysage')]], 'keep');
    const margin = ui.range(0, 60, 0, 2, (v) => `${v} pt`);
    return { el: h('div', {}, ui.note(t('Chaque page est mise à l’échelle pour tenir dans le nouveau format, sans déformation (le contenu reste vectoriel).')), h('div', { style: { height: '.8rem' } }), ui.field(t('Nouveau format'), size), ui.field(t('Orientation'), orient), ui.field(t('Marge'), margin.el)), get: () => ({ size: size.value, orient: orient.value, margin: +margin.input.value }) };
  },
  async run({ files, opts, progress }) {
    const f = files[0];
    const src = await loadDoc(f.bytes);
    const out = await PDFDocument.create();
    const embedded = await out.embedPdf(src, src.getPageIndices());
    for (let i = 0; i < embedded.length; i++) {
      progress(i / embedded.length);
      const g = pageGeometry(src.getPage(i));
      let [pw, ph] = PAGE_SIZES[opts.size];
      const landscape = opts.orient === 'landscape' || (opts.orient === 'keep' && g.w > g.h);
      if (landscape && pw < ph) [pw, ph] = [ph, pw];
      if (!landscape && pw > ph) [pw, ph] = [ph, pw];
      const page = out.addPage([pw, ph]);
      const e = embedded[i];
      const rotated = g.rot === 90 || g.rot === 270;
      void rotated;
      const aw = pw - opts.margin * 2, ah = ph - opts.margin * 2;
      const s = Math.min(aw / g.w, ah / g.h);
      page.drawPage(e, { x: (pw - g.w * s) / 2, y: (ph - g.h * s) / 2, xScale: s, yScale: s });
    }
    const bytes = await save(out);
    return { title: t('PDF redimensionné !'), outputs: [{ name: outName(f, opts.size), data: bytes }], stats: [{ label: t('Pages'), value: String(embedded.length) }] };
  },
});

export const nup = fileTool({
  accept: 'pdf', multiple: false, runLabel: 'Assembler', runIcon: 'grid',
  options: () => {
    const per = ui.select([['2', t('2 pages par feuille')], ['4', t('4 pages par feuille')], ['6', t('6 pages par feuille')], ['9', t('9 pages par feuille')]], '2');
    const size = ui.select(SIZE_OPTIONS, 'a4');
    const orient = ui.select([['auto', t('Automatique')], ['portrait', t('Portrait')], ['landscape', t('Paysage')]], 'auto');
    const border = ui.check(t('Tracer un cadre autour des pages'), true);
    const gap = ui.range(0, 40, 10, 2, (v) => `${v} pt`);
    return { el: h('div', {}, ui.field(t('Disposition'), per), ui.field(t('Format de la feuille'), size), ui.field(t('Orientation'), orient), ui.field(t('Espacement'), gap.el), border.el), get: () => ({ per: +per.value, size: size.value, orient: orient.value, border: border.input.checked, gap: +gap.input.value }) };
  },
  async run({ files, opts, progress }) {
    const f = files[0];
    const src = await loadDoc(f.bytes);
    const out = await PDFDocument.create();
    const embedded = await out.embedPdf(src, src.getPageIndices());
    const GRID = { 2: [2, 1], 4: [2, 2], 6: [3, 2], 9: [3, 3] }; // [colonnes, lignes] en portrait
    let [cols, rows] = GRID[opts.per];
    let [pw, ph] = PAGE_SIZES[opts.size];
    const landscape = opts.orient === 'landscape' || (opts.orient === 'auto' && opts.per === 2);
    if (landscape && pw < ph) [pw, ph] = [ph, pw];
    if (!landscape && pw > ph) [pw, ph] = [ph, pw];
    if (!landscape && opts.per === 2) [cols, rows] = [1, 2];
    if (landscape && opts.per === 6) [cols, rows] = [3, 2];
    if (!landscape && opts.per === 6) [cols, rows] = [2, 3];
    const m = 20, gap = opts.gap;
    const cw = (pw - m * 2 - gap * (cols - 1)) / cols, ch = (ph - m * 2 - gap * (rows - 1)) / rows;
    for (let i = 0; i < embedded.length; i += opts.per) {
      progress(i / embedded.length);
      const page = out.addPage([pw, ph]);
      for (let k = 0; k < opts.per && i + k < embedded.length; k++) {
        const e = embedded[i + k];
        const g = pageGeometry(src.getPage(i + k));
        const s = Math.min(cw / g.w, ch / g.h);
        const col = k % cols, row = Math.floor(k / cols);
        const x = m + col * (cw + gap) + (cw - g.w * s) / 2;
        const y = ph - m - (row + 1) * ch - row * gap + (ch - g.h * s) / 2;
        page.drawPage(e, { x, y, xScale: s, yScale: s });
        if (opts.border) page.drawRectangle({ x, y, width: g.w * s, height: g.h * s, borderWidth: 0.6, borderColor: { type: 'RGB', red: 0.6, green: 0.6, blue: 0.6 } });
      }
    }
    const bytes = await save(out);
    return { title: t('Feuilles assemblées !'), outputs: [{ name: outName(f, `${opts.per}en1`), data: bytes }], stats: [{ label: t('Feuilles'), value: String(out.getPageCount()) }, { label: t('Pages source'), value: String(embedded.length) }] };
  },
});

export const removeBlank = fileTool({
  accept: 'pdf', multiple: false, runLabel: 'Détecter et supprimer', runIcon: 'trash',
  options: () => {
    const sens = ui.range(1, 10, 3, 1, (v) => `${v}`);
    return { el: h('div', {}, ui.note(t('Les pages presque entièrement blanches (feuilles vierges, versos de scan) sont détectées et retirées.')), h('div', { style: { height: '.8rem' } }), ui.field(t('Tolérance au bruit (scans)'), sens.el)), get: () => ({ tol: +sens.input.value }) };
  },
  async run({ files, opts, progress }) {
    const f = files[0];
    const pdf = await openPdf(f.bytes);
    const blank = [];
    const limit = opts.tol * 0.0001; // part de pixels « encre » tolérée (≈ bruit de scan)
    for (let i = 1; i <= pdf.numPages; i++) {
      progress(i / pdf.numPages, `${i} / ${pdf.numPages}`);
      const page = await pdf.getPage(i);
      const c = await renderPageToCanvas(page, 0.5);
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let ink = 0;
      for (let p = 0; p < d.length; p += 4) if (d[p] < 200 || d[p + 1] < 200 || d[p + 2] < 200) ink++;
      if (ink / (c.width * c.height) <= limit) blank.push(i - 1);
      page.cleanup();
    }
    pdf.destroy();
    if (!blank.length) return { title: t('Aucune page blanche'), message: t('Toutes les pages contiennent du contenu.'), outputs: [{ name: outName(f, ''), data: f.bytes }], stats: [{ label: t('Pages blanches'), value: '0' }] };
    if (blank.length >= f.pages) throw new Error(t('Toutes les pages semblent blanches : rien n’a été supprimé.'));
    const bytes = await deletePages(f.bytes, blank);
    return { title: t('{n} page(s) blanche(s) supprimée(s)', { n: blank.length }), message: t('Pages retirées : {list}', { list: blank.map((i) => i + 1).join(', ') }), outputs: [{ name: outName(f, 'sans-blancs'), data: bytes }], stats: [{ label: t('Retirées'), value: String(blank.length) }, { label: t('Restantes'), value: String(f.pages - blank.length) }] };
  },
});

export const grayscale = fileTool({
  accept: 'pdf', multiple: false, runLabel: 'Convertir en niveaux de gris', runIcon: 'drop',
  options: () => {
    const mode = ui.select([['gray', t('Niveaux de gris')], ['bw', t('Noir et blanc (seuil)')]], 'gray');
    const dpi = ui.select([['1.5', '108 dpi'], ['2', '144 dpi'], ['3', '216 dpi']], '2');
    return { el: h('div', {}, ui.field(t('Mode'), mode), ui.field(t('Résolution'), dpi), ui.note(t('Les pages sont converties en images : le texte ne sera plus sélectionnable.'))), get: () => ({ mode: mode.value, scale: +dpi.value }) };
  },
  async run({ files, opts, progress }) {
    const f = files[0];
    const pdf = await openPdf(f.bytes);
    const out = await PDFDocument.create();
    for (let i = 1; i <= pdf.numPages; i++) {
      progress(i / pdf.numPages);
      const page = await pdf.getPage(i);
      const vp1 = page.getViewport({ scale: 1 });
      const c = await renderPageToCanvas(page, opts.scale);
      const ctx = c.getContext('2d');
      const id = ctx.getImageData(0, 0, c.width, c.height);
      const d = id.data;
      for (let p = 0; p < d.length; p += 4) {
        let g = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
        if (opts.mode === 'bw') g = g > 150 ? 255 : 0;
        d[p] = d[p + 1] = d[p + 2] = g;
      }
      ctx.putImageData(id, 0, 0);
      const blob = await canvasToBlob(c, 'image/jpeg', opts.mode === 'bw' ? 0.8 : 0.72);
      const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      out.addPage([vp1.width, vp1.height]).drawImage(img, { x: 0, y: 0, width: vp1.width, height: vp1.height });
      c.width = c.height = 0;
      page.cleanup();
    }
    pdf.destroy();
    const bytes = await save(out);
    return { title: t('Conversion terminée !'), outputs: [{ name: outName(f, opts.mode === 'bw' ? 'nb' : 'gris'), data: bytes }], stats: [{ label: t('Avant'), value: formatBytes(f.size) }, { label: t('Après'), value: formatBytes(bytes.length) }] };
  },
});

export const extractImages = fileTool({
  accept: 'pdf', multiple: false, runLabel: 'Extraire les images', runIcon: 'image',
  options: () => {
    const min = ui.select([['1', t('Toutes')], ['64', t('Plus de 64 px')], ['200', t('Plus de 200 px')]], '64');
    return { el: h('div', {}, ui.field(t('Taille minimale'), min)), get: () => ({ min: +min.value }) };
  },
  async run({ files, opts, progress }) {
    const f = files[0];
    const pdf = await openPdf(f.bytes);
    const OPS = pdfjs.OPS;
    const seen = new Set();
    const outputs = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      progress(i / pdf.numPages, `${i} / ${pdf.numPages}`);
      const page = await pdf.getPage(i);
      const list = await page.getOperatorList();
      // le rendu (même minuscule) force la résolution des images dans page.objs
      await renderPageToCanvas(page, 0.05).catch(() => {});
      let n = 0;
      for (let k = 0; k < list.fnArray.length; k++) {
        const fn = list.fnArray[k];
        if (fn !== OPS.paintImageXObject && fn !== OPS.paintInlineImageXObject) continue;
        const arg = list.argsArray[k][0];
        let img = null;
        try { img = fn === OPS.paintInlineImageXObject ? list.argsArray[k][0] : await new Promise((res) => { page.objs.get(arg, res); setTimeout(() => res(null), 1500); }); } catch { /* ignoré */ }
        if (!img) continue;
        const key = typeof arg === 'string' ? arg : `inline-${i}-${k}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const w = img.width, hgt = img.height;
        if (!w || !hgt || Math.max(w, hgt) < opts.min) continue;
        const c = document.createElement('canvas');
        c.width = w; c.height = hgt;
        const ctx = c.getContext('2d');
        if (img.bitmap) ctx.drawImage(img.bitmap, 0, 0);
        else if (img.data) {
          let rgba = img.data;
          if (img.data.length === w * hgt * 3) { rgba = new Uint8ClampedArray(w * hgt * 4); for (let p = 0, q = 0; p < img.data.length; p += 3, q += 4) { rgba[q] = img.data[p]; rgba[q + 1] = img.data[p + 1]; rgba[q + 2] = img.data[p + 2]; rgba[q + 3] = 255; } }
          else if (img.data.length === w * hgt) { rgba = new Uint8ClampedArray(w * hgt * 4); for (let p = 0, q = 0; p < img.data.length; p++, q += 4) { rgba[q] = rgba[q + 1] = rgba[q + 2] = img.data[p]; rgba[q + 3] = 255; } }
          else if (img.data.length !== w * hgt * 4) continue;
          ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, hgt), 0, 0);
        } else continue;
        const blob = await canvasToBlob(c, 'image/png');
        if (blob) { n++; outputs.push({ name: `${baseName(f.name)}-p${i}-img${n}.png`, data: blob }); }
      }
      page.cleanup();
    }
    pdf.destroy();
    if (!outputs.length) throw new Error(t('Aucune image trouvée dans ce document.'));
    return { title: t('{n} image(s) extraite(s) !', { n: outputs.length }), outputs, zipName: `${baseName(f.name)}-images`, stats: [{ label: t('Images'), value: String(outputs.length) }] };
  },
});
