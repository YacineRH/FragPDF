// Opérations « document entier » basées sur pdf-lib : fusion, découpe, rotation, recadrage,
// numérotation, filigrane, métadonnées, images → PDF, aplatissement, nettoyage…
import { PDFDocument, PDFName, PDFDict, PDFArray, degrees, StandardFonts, PDFString } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { createFontEmbedder } from './fonts.js';
import { pageGeometry, gridPosition } from './geometry.js';
import { drawTextBlock, wrapText, color } from './draw.js';
import * as PDFLib from 'pdf-lib';
import { rasterizeImage } from './utils.js';

export const PRODUCER = 'FragPDF';

const LOAD_OPTS = { ignoreEncryption: false, updateMetadata: false, throwOnInvalidObject: false };

/** Charge un document pdf-lib ; un PDF protégé uniquement par mot de passe propriétaire est déchiffré à la volée (QPDF). */
export async function loadDoc(bytes) {
  try {
    return await PDFDocument.load(bytes, LOAD_OPTS);
  } catch (e) {
    if (!/encrypt/i.test(String(e?.message))) throw e;
    const { decryptPdf } = await import('./security.js');
    return PDFDocument.load(await decryptPdf(bytes, ''), LOAD_OPTS);
  }
}

export async function save(doc, { objectStreams = true } = {}) {
  doc.setProducer(PRODUCER);
  doc.setModificationDate(new Date());
  return doc.save({ useObjectStreams: objectStreams, addDefaultPage: false });
}

export async function pageCount(bytes) { return (await loadDoc(bytes)).getPageCount(); }

/** Fusionne plusieurs documents : items = [{bytes, indices?}] */
export async function mergePdfs(items) {
  const out = await PDFDocument.create();
  for (const it of items) {
    const src = await loadDoc(it.bytes);
    const idx = it.indices ?? src.getPageIndices();
    const pages = await out.copyPages(src, idx);
    pages.forEach((p) => out.addPage(p));
  }
  return save(out);
}

/** Extrait des pages (indices 0-based) dans un nouveau document. */
export async function extractPages(bytes, indices) {
  const src = await loadDoc(bytes);
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  pages.forEach((p) => out.addPage(p));
  copyInfo(src, out);
  return save(out);
}

export async function deletePages(bytes, indices) {
  const doc = await loadDoc(bytes);
  const set = new Set(indices);
  if (set.size >= doc.getPageCount()) throw new Error('Impossible de supprimer toutes les pages.');
  [...set].sort((a, b) => b - a).forEach((i) => doc.removePage(i));
  return save(doc);
}

function copyInfo(src, out) {
  try {
    out.setTitle(src.getTitle() ?? '');
    out.setAuthor(src.getAuthor() ?? '');
    out.setSubject(src.getSubject() ?? '');
    out.setKeywords((src.getKeywords() ?? '').split(/[,;]\s*/).filter(Boolean));
  } catch { /* ignoré */ }
}

/** Réorganise : layout = [{src, rotate?}|{blank:true,w,h}] */
export async function applyPageLayout(bytes, layout) {
  const src = await loadDoc(bytes);
  const out = await PDFDocument.create();
  copyInfo(src, out);
  for (const item of layout) {
    if (item.blank) {
      out.addPage([item.w || 595.28, item.h || 841.89]);
      continue;
    }
    const [p] = await out.copyPages(src, [item.src]);
    if (item.rotate) p.setRotation(degrees(((p.getRotation().angle + item.rotate) % 360 + 360) % 360));
    out.addPage(p);
  }
  return save(out);
}

/** Découpe : groupes d'indices -> tableau de PDF. */
export async function splitGroups(bytes, groups) {
  const src = await loadDoc(bytes);
  const results = [];
  for (const g of groups) {
    const out = await PDFDocument.create();
    const pages = await out.copyPages(src, g);
    pages.forEach((p) => out.addPage(p));
    copyInfo(src, out);
    results.push({ indices: g, bytes: await save(out) });
  }
  return results;
}

export function everyN(total, n) {
  const g = [];
  for (let i = 0; i < total; i += n) g.push(Array.from({ length: Math.min(n, total - i) }, (_, k) => i + k));
  return g;
}

export async function rotatePages(bytes, indices, delta) {
  const doc = await loadDoc(bytes);
  const idx = indices ?? doc.getPageIndices();
  for (const i of idx) {
    const p = doc.getPage(i);
    p.setRotation(degrees((((p.getRotation().angle + delta) % 360) + 360) % 360));
  }
  return save(doc);
}

/** Recadre en retirant des marges (en points) sur les pages indiquées. */
export async function cropPages(bytes, margins, indices) {
  const doc = await loadDoc(bytes);
  const idx = indices ?? doc.getPageIndices();
  for (const i of idx) {
    const p = doc.getPage(i);
    const geo = pageGeometry(p);
    const a = geo.map(margins.left, margins.top);
    const b = geo.map(geo.w - margins.right, geo.h - margins.bottom);
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    if (w < 10 || h < 10) throw new Error('Les marges sont trop grandes.');
    p.setCropBox(x, y, w, h);
    p.setMediaBox(x, y, w, h);
  }
  return save(doc);
}

export function fillTokens(tpl, ctx) {
  return tpl
    .replace(/\{n\}/g, String(ctx.n))
    .replace(/\{total\}/g, String(ctx.total))
    .replace(/\{date\}/g, ctx.date)
    .replace(/\{title\}/g, ctx.title || '')
    .replace(/\{file\}/g, ctx.file || '');
}

/**
 * Tampon de texte sur les pages (numérotation, en-tête/pied de page, filigrane texte).
 * o = {text, fontId, bold, italic, size, color, opacity, position, margin, rotation, indices, startAt,
 *      tile, fileName, bgColor}
 */
export async function stampText(bytes, o) {
  const doc = await loadDoc(bytes);
  const fonts = createFontEmbedder(doc, PDFLib, fontkit);
  const total = doc.getPageCount();
  const idx = o.indices ?? doc.getPageIndices();
  const date = new Date().toLocaleDateString('fr-FR');
  let k = 0;
  for (const i of idx) {
    const page = doc.getPage(i);
    const geo = pageGeometry(page);
    const n = (o.startAt ?? 1) + k;
    k++;
    const text = fillTokens(o.text, { n, total, date, title: doc.getTitle(), file: o.fileName });
    const font = await fonts.embed(o.fontId || 'helvetica', !!o.bold, !!o.italic, text);
    const safe = fonts.sanitize(font, text);
    const lines = safe.split('\n');
    const size = o.size || 12;
    const lh = size * 1.25;
    const tw = Math.max(...lines.map((l) => font.widthOfTextAtSize(l, size)));
    const th = lines.length * lh;
    const base = { size, color: o.color || '#000000', opacity: o.opacity ?? 1, lineHeight: 1.25, align: 'center' };
    const place = (x, y) => {
      if (o.bgColor) {
        const r = geo.rect(x - 3, y - 2, tw + 6, th + 4);
        page.drawRectangle({ ...r, color: color(o.bgColor), opacity: o.opacity ?? 1 });
      }
      drawTextBlock(page, geo, font, lines, { ...base, x, y, w: tw, deg: -(o.rotation || 0) });
    };
    if (o.tile) {
      const gx = tw * 1.8 + 40, gy = th * 3 + 60;
      for (let y = -gy; y < geo.h + gy; y += gy) {
        for (let x = -gx; x < geo.w + gx; x += gx) place(x + ((Math.round(y / gy) % 2) * gx) / 2, y);
      }
    } else {
      const pos = gridPosition(o.position || 'bottom-center', geo.w, geo.h, tw, th, o.margin ?? 24);
      place(pos.x, pos.y);
    }
  }
  return save(doc);
}

/** Filigrane image. */
export async function stampImage(bytes, imgBytes, mime, o) {
  const doc = await loadDoc(bytes);
  const img = mime === 'image/png' ? await doc.embedPng(imgBytes) : await doc.embedJpg(imgBytes);
  const idx = o.indices ?? doc.getPageIndices();
  for (const i of idx) {
    const page = doc.getPage(i);
    const geo = pageGeometry(page);
    const iw = (geo.w * (o.scale ?? 0.5));
    const ih = iw * (img.height / img.width);
    const pos = o.position === 'center' || !o.position ? { x: (geo.w - iw) / 2, y: (geo.h - ih) / 2 } : gridPosition(o.position, geo.w, geo.h, iw, ih, o.margin ?? 24);
    const pl = geo.placeBox(pos.x, pos.y, iw, ih, o.rotation || 0);
    page.drawImage(img, { x: pl.x, y: pl.y, width: iw, height: ih, rotate: degrees(pl.angle), opacity: o.opacity ?? 0.5 });
  }
  return save(doc);
}

export async function getMetadata(bytes) {
  const doc = await loadDoc(bytes);
  return {
    title: doc.getTitle() ?? '',
    author: doc.getAuthor() ?? '',
    subject: doc.getSubject() ?? '',
    keywords: doc.getKeywords() ?? '',
    creator: doc.getCreator() ?? '',
    producer: doc.getProducer() ?? '',
    created: doc.getCreationDate() ?? null,
    modified: doc.getModificationDate() ?? null,
    pages: doc.getPageCount(),
  };
}

export async function setMetadata(bytes, m) {
  const doc = await loadDoc(bytes);
  doc.setTitle(m.title ?? '');
  doc.setAuthor(m.author ?? '');
  doc.setSubject(m.subject ?? '');
  doc.setKeywords(String(m.keywords || '').split(/[,;]\s*/).filter(Boolean));
  doc.setCreator(m.creator ?? '');
  doc.setProducer(m.producer || PRODUCER);
  doc.setModificationDate(new Date());
  return doc.save({ useObjectStreams: true });
}

/** Aplatit les champs de formulaire (les valeurs deviennent du contenu statique). */
export async function flattenForms(bytes) {
  const doc = await loadDoc(bytes);
  try { doc.getForm().flatten(); } catch { /* pas de formulaire */ }
  return save(doc);
}

/** Supprime métadonnées, JavaScript, pièces jointes, signets, annotations selon les options. */
export async function sanitize(bytes, o = {}) {
  const doc = await loadDoc(bytes);
  const ctx = doc.context;
  if (o.metadata !== false) {
    doc.setTitle(''); doc.setAuthor(''); doc.setSubject(''); doc.setKeywords([]); doc.setCreator(''); doc.setProducer('');
    const info = ctx.trailerInfo.Info;
    if (info) { try { ctx.delete(info); delete ctx.trailerInfo.Info; } catch { /* ignoré */ } }
    doc.catalog.delete(PDFName.of('Metadata'));
  }
  if (o.javascript !== false) {
    doc.catalog.delete(PDFName.of('OpenAction'));
    doc.catalog.delete(PDFName.of('AA'));
    const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
    if (names) { names.delete(PDFName.of('JavaScript')); names.delete(PDFName.of('EmbeddedFiles')); }
    for (const p of doc.getPages()) {
      const annots = p.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
      if (!annots) continue;
      for (let i = 0; i < annots.size(); i++) {
        const a = annots.lookupMaybe(i, PDFDict);
        if (a) { a.delete(PDFName.of('AA')); const act = a.lookupMaybe(PDFName.of('A'), PDFDict); if (act && String(act.get(PDFName.of('S'))) === '/JavaScript') a.delete(PDFName.of('A')); }
      }
    }
  }
  if (o.attachments) {
    const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
    if (names) names.delete(PDFName.of('EmbeddedFiles'));
  }
  if (o.bookmarks) doc.catalog.delete(PDFName.of('Outlines'));
  if (o.annotations) for (const p of doc.getPages()) p.node.delete(PDFName.of('Annots'));
  if (o.forms) { try { doc.getForm().flatten(); } catch { /* ignoré */ } }
  const out = await doc.save({ useObjectStreams: true });
  return out;
}

export const PAGE_SIZES = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  a3: [841.89, 1190.55],
  a5: [419.53, 595.28],
  legal: [612, 1008],
};

/**
 * Images → PDF. files = File[]; o = {size:'fit'|'a4'|'letter'…, orientation:'auto'|'portrait'|'landscape', margin, fit:'contain'|'cover'}
 */
export async function imagesToPdf(files, o = {}) {
  const doc = await PDFDocument.create();
  for (const f of files) {
    let bytes = new Uint8Array(await f.arrayBuffer());
    let img;
    const type = f.type;
    if (type === 'image/jpeg') img = await doc.embedJpg(bytes);
    else if (type === 'image/png') img = await doc.embedPng(bytes);
    else {
      bytes = await rasterizeImage(f, 'image/png');
      img = await doc.embedPng(bytes);
    }
    let pw, ph;
    const margin = o.margin ?? 0;
    if (!o.size || o.size === 'fit') { pw = img.width + margin * 2; ph = img.height + margin * 2; }
    else {
      [pw, ph] = PAGE_SIZES[o.size] || PAGE_SIZES.a4;
      const landscape = o.orientation === 'landscape' || (o.orientation !== 'portrait' && img.width > img.height);
      if (landscape && pw < ph) [pw, ph] = [ph, pw];
      if (!landscape && pw > ph) [pw, ph] = [ph, pw];
    }
    const page = doc.addPage([pw, ph]);
    const aw = pw - margin * 2, ah = ph - margin * 2;
    const s = Math.min(aw / img.width, ah / img.height);
    const w = img.width * s, h = img.height * s;
    page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }
  return save(doc);
}

/** Texte brut → PDF paginé. */
export async function textToPdf(text, o = {}) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fonts = createFontEmbedder(doc, PDFLib, fontkit);
  const font = await fonts.embed(o.fontId || 'helvetica', false, false, text);
  const size = o.size || 11;
  const [pw, ph] = PAGE_SIZES[o.pageSize || 'a4'];
  const margin = 54;
  const lines = wrapText(font, fonts.sanitize(font, text), size, pw - margin * 2);
  const lh = size * 1.4;
  let page = doc.addPage([pw, ph]);
  let y = ph - margin;
  for (const l of lines) {
    if (y < margin) { page = doc.addPage([pw, ph]); y = ph - margin; }
    if (l) page.drawText(l, { x: margin, y: y - size, size, font });
    y -= lh;
  }
  return save(doc);
}

/** Ajoute une page blanche à la position donnée (0-based). */
export async function insertBlankPage(bytes, at, size) {
  const doc = await loadDoc(bytes);
  const ref = doc.getPage(Math.min(at, doc.getPageCount() - 1));
  const g = pageGeometry(ref);
  doc.insertPage(at, size || [g.w, g.h]);
  return save(doc);
}

export { StandardFonts, PDFString };
