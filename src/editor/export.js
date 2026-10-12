// Application des annotations de l'éditeur sur le PDF (pdf-lib) — « cuisson » finale.
import * as PDFLib from 'pdf-lib';
import { PDFDocument, PDFName, PDFString, PDFArray, BlendMode, LineCapStyle, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { createFontEmbedder } from '../lib/fonts.js';
import { pageGeometry } from '../lib/geometry.js';
import { color, wrapText, drawTextBlock } from '../lib/draw.js';
import { loadDoc, PRODUCER } from '../lib/pdf-ops.js';
import { renderPageToCanvas } from '../lib/pdfjs.js';
import { canvasToBlob } from '../lib/utils.js';

const rotPoint = (px, py, cx, cy, deg) => {
  const r = (deg * Math.PI) / 180;
  const dx = px - cx, dy = py - cy;
  return [cx + dx * Math.cos(r) - dy * Math.sin(r), cy + dx * Math.sin(r) + dy * Math.cos(r)];
};

/** Chemin SVG (coordonnées utilisateur, y inversé pour drawSvgPath posé en (0,0)). */
function pathFromVisual(geo, pts, closed = true) {
  const u = pts.map(([x, y]) => geo.map(x, y));
  return `M ${u.map((p) => `${p.x.toFixed(3)} ${(-p.y).toFixed(3)}`).join(' L ')}${closed ? ' Z' : ''}`;
}

function svgOpts(o) {
  const out = { x: 0, y: 0 };
  if (o.fill) { out.color = color(o.fill); out.opacity = o.fillOpacity ?? 1; }
  if (o.stroke && o.strokeW > 0) {
    out.borderColor = color(o.stroke);
    out.borderWidth = o.strokeW;
    out.borderOpacity = o.opacity ?? 1;
    out.borderLineCap = LineCapStyle.Round;
  }
  if (o.blend) out.blendMode = o.blend;
  return out;
}

function boxCorners(a) {
  const cx = a.x + a.w / 2, cy = a.y + a.h / 2;
  return [[a.x, a.y], [a.x + a.w, a.y], [a.x + a.w, a.y + a.h], [a.x, a.y + a.h]].map(([px, py]) => rotPoint(px, py, cx, cy, a.rot || 0));
}

function ellipsePts(a, n = 90) {
  const cx = a.x + a.w / 2, cy = a.y + a.h / 2;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push(rotPoint(cx + (a.w / 2) * Math.cos(t), cy + (a.h / 2) * Math.sin(t), cx, cy, a.rot || 0));
  }
  return pts;
}

function arrowHead(x1, y1, x2, y2, size) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const s = size;
  return [[x2, y2], [x2 - s * Math.cos(ang - 0.42), y2 - s * Math.sin(ang - 0.42)], [x2 - s * Math.cos(ang + 0.42), y2 - s * Math.sin(ang + 0.42)]];
}

function smoothPath(geo, pts) {
  const u = pts.map(([x, y]) => geo.map(x, y));
  if (u.length === 1) u.push({ x: u[0].x + 0.01, y: u[0].y });
  const f = (n) => n.toFixed(3);
  let d = `M ${f(u[0].x)} ${f(-u[0].y)}`;
  for (let i = 1; i < u.length - 1; i++) {
    const mx = (u[i].x + u[i + 1].x) / 2, my = (u[i].y + u[i + 1].y) / 2;
    d += ` Q ${f(u[i].x)} ${f(-u[i].y)} ${f(mx)} ${f(-my)}`;
  }
  const last = u[u.length - 1];
  d += ` L ${f(last.x)} ${f(-last.y)}`;
  return d;
}

const MARKS = {
  check: [[0.12, 0.55], [0.38, 0.82], [0.9, 0.2]],
  cross: null,
};

/** Rasterise les pages contenant des caviardages (le contenu dessous est détruit). */
async function applyRedactions(doc, state, onProgress) {
  const pages = [...new Set(state.annots.filter((a) => a.type === 'redact').map((a) => a.page))].sort((a, b) => a - b);
  let n = 0;
  for (const i of pages) {
    onProgress?.(0.05 + 0.3 * (n++ / pages.length), `Caviardage page ${i + 1}…`);
    const page = await state.pdf.getPage(i + 1);
    const scale = 2.5;
    const canvas = await renderPageToCanvas(page, scale, { rotation: page.rotate });
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    for (const a of state.annots.filter((x) => x.type === 'redact' && x.page === i)) {
      ctx.fillRect(a.x * scale, a.y * scale, a.w * scale, a.h * scale);
    }
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
    const img = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const { w, h } = state.pages[i];
    const np = doc.insertPage(i, [w, h]);
    np.drawImage(img, { x: 0, y: 0, width: w, height: h });
    doc.removePage(i + 1);
    canvas.width = canvas.height = 0;
    page.cleanup();
  }
}

async function applyForm(doc, state, flatten) {
  let form;
  try { form = doc.getForm(); } catch { return; }
  for (const [name, val] of state.formValues) {
    let field;
    try { field = form.getField(name); } catch { continue; }
    try {
      const type = field.constructor.name;
      if (type === 'PDFTextField') field.setText(val == null ? undefined : String(val));
      else if (type === 'PDFCheckBox') (val ? field.check() : field.uncheck());
      else if (type === 'PDFRadioGroup') { if (val) field.select(String(val)); }
      else if (type === 'PDFDropdown' || type === 'PDFOptionList') { if (val) field.select(String(val)); }
    } catch { /* valeur non applicable */ }
  }
  try {
    const f = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    form.updateFieldAppearances(f);
  } catch { /* ignoré */ }
  if (flatten) { try { form.flatten(); } catch { /* ignoré */ } }
}

export async function exportPdf(state, { flattenForms = false, onProgress } = {}) {
  const doc = await loadDoc(state.bytes);
  doc.registerFontkit(fontkit);
  const fonts = createFontEmbedder(doc, PDFLib, fontkit);

  await applyRedactions(doc, state, onProgress);
  await applyForm(doc, state, flattenForms);

  const imgCache = new Map();
  const getImage = async (assetId) => {
    if (imgCache.has(assetId)) return imgCache.get(assetId);
    const as = state.assets.get(assetId);
    if (!as) return null;
    const img = as.mime === 'image/jpeg' ? await doc.embedJpg(as.bytes) : await doc.embedPng(as.bytes);
    imgCache.set(assetId, img);
    return img;
  };

  const total = doc.getPageCount();
  for (let pi = 0; pi < total; pi++) {
    const list = state.annots.filter((a) => a.page === pi);
    if (!list.length) continue;
    onProgress?.(0.4 + 0.55 * (pi / total), `Page ${pi + 1} / ${total}`);
    const page = doc.getPage(pi);
    const geo = pageGeometry(page);

    for (const a of list) {
      const op = a.opacity ?? 1;
      switch (a.type) {
        case 'text': {
          for (const cv of a.covers || []) {
            page.drawRectangle({ ...geo.rect(cv.x, cv.y, cv.w, cv.h), color: color(cv.color || '#ffffff') });
          }
          if (!a.text) break;
          const font = await fonts.embed(a.fontId, a.bold, a.italic, a.text);
          const safe = fonts.sanitize(font, a.text);
          const lines = wrapText(font, safe, a.size, a.autoW ? 0 : a.w);
          const lh = a.size * (a.lineHeight || 1.25);
          if (a.bg) {
            const c = boxCorners({ x: a.x, y: a.y, w: a.w, h: lines.length * lh, rot: a.rot });
            page.drawSvgPath(pathFromVisual(geo, c), { x: 0, y: 0, color: color(a.bg), opacity: a.bgOpacity ?? 1 });
          }
          drawTextBlock(page, geo, font, lines, { x: a.x, y: a.y, w: a.w, size: a.size, lineHeight: a.lineHeight || 1.25, align: a.align, deg: a.rot || 0, color: a.color, opacity: op, underline: a.underline });
          break;
        }
        case 'image': {
          const img = await getImage(a.assetId);
          if (!img) break;
          const pl = geo.placeBox(a.x, a.y, a.w, a.h, a.rot || 0);
          page.drawImage(img, { x: pl.x, y: pl.y, width: a.w, height: a.h, rotate: degrees(pl.angle), opacity: op });
          break;
        }
        case 'rect': case 'ellipse': {
          const k = (a.strokeW || 0) / 2; // le trait CSS est à l'intérieur de la boîte, le trait PDF est centré
          const ia = { ...a, x: a.x + k, y: a.y + k, w: Math.max(1, a.w - 2 * k), h: Math.max(1, a.h - 2 * k) };
          page.drawSvgPath(pathFromVisual(geo, a.type === 'rect' ? boxCorners(ia) : ellipsePts(ia)), svgOpts({ ...a, opacity: op }));
          break;
        }
        case 'line':
        case 'arrow': {
          const o = { stroke: a.stroke, strokeW: a.strokeW, opacity: op };
          page.drawSvgPath(pathFromVisual(geo, [[a.x1, a.y1], [a.x2, a.y2]], false), svgOpts(o));
          if (a.type === 'arrow' || a.arrow) {
            const head = arrowHead(a.x1, a.y1, a.x2, a.y2, Math.max(8, a.strokeW * 4.5));
            page.drawSvgPath(pathFromVisual(geo, head), svgOpts({ stroke: a.stroke, strokeW: 1, fill: a.stroke, fillOpacity: op, opacity: op }));
          }
          break;
        }
        case 'ink':
          if (a.points?.length) page.drawSvgPath(smoothPath(geo, a.points), svgOpts({ stroke: a.stroke, strokeW: a.strokeW, opacity: op }));
          break;
        case 'highlight':
          for (const r of a.rects) {
            const u = geo.rect(r.x, r.y, r.w, r.h);
            page.drawRectangle({ ...u, color: color(a.color), opacity: op, blendMode: BlendMode.Multiply });
          }
          break;
        case 'underline':
        case 'strike':
          for (const r of a.rects) {
            const y = a.type === 'underline' ? r.y + r.h - 1 : r.y + r.h * 0.55;
            page.drawLine({ start: geo.map(r.x, y), end: geo.map(r.x + r.w, y), thickness: Math.max(0.8, r.h / 14), color: color(a.color), opacity: op });
          }
          break;
        case 'whiteout':
          page.drawRectangle({ ...geo.rect(a.x, a.y, a.w, a.h), color: color(a.color || '#ffffff') });
          break;
        case 'redact':
          break; // déjà intégré par rasterisation
        case 'mark': {
          const cx = a.x + a.w / 2, cy = a.y + a.h / 2;
          const tr = (u, v) => rotPoint(a.x + u * a.w, a.y + v * a.h, cx, cy, a.rot || 0);
          const sw = Math.max(1.5, Math.min(a.w, a.h) * 0.12);
          if (a.kind === 'check') page.drawSvgPath(pathFromVisual(geo, MARKS.check.map(([u, v]) => tr(u, v)), false), svgOpts({ stroke: a.color, strokeW: sw }));
          else if (a.kind === 'cross') {
            page.drawSvgPath(pathFromVisual(geo, [tr(0.18, 0.18), tr(0.82, 0.82)], false), svgOpts({ stroke: a.color, strokeW: sw }));
            page.drawSvgPath(pathFromVisual(geo, [tr(0.82, 0.18), tr(0.18, 0.82)], false), svgOpts({ stroke: a.color, strokeW: sw }));
          } else if (a.kind === 'circle') page.drawSvgPath(pathFromVisual(geo, ellipsePts({ x: a.x + a.w * 0.08, y: a.y + a.h * 0.08, w: a.w * 0.84, h: a.h * 0.84, rot: a.rot })), svgOpts({ stroke: a.color, strokeW: sw }));
          else page.drawSvgPath(pathFromVisual(geo, ellipsePts({ x: a.x + a.w * 0.25, y: a.y + a.h * 0.25, w: a.w * 0.5, h: a.h * 0.5, rot: a.rot })), svgOpts({ fill: a.color, fillOpacity: 1 }));
          break;
        }
        case 'stamp': {
          const font = await fonts.embed('helvetica', true, false, a.label);
          const label = fonts.sanitize(font, a.label);
          const size = Math.min(a.h * 0.55, 200);
          const tw = font.widthOfTextAtSize(label, size);
          const fit = Math.min(1, (a.w - 16) / tw);
          const fs = size * fit;
          const bw = Math.max(1.5, a.h * 0.06);
          const corners = boxCorners({ x: a.x + bw / 2, y: a.y + bw / 2, w: a.w - bw, h: a.h - bw, rot: a.rot });
          page.drawSvgPath(pathFromVisual(geo, corners), svgOpts({ stroke: a.color, strokeW: bw, opacity: op }));
          const th = fs * 1.25;
          drawTextBlock(page, geo, font, [label], { x: a.x + (a.w - font.widthOfTextAtSize(label, fs)) / 2, y: a.y + (a.h - th) / 2, w: font.widthOfTextAtSize(label, fs), size: fs, color: a.color, opacity: op, deg: a.rot || 0, lineHeight: 1.25 });
          break;
        }
        case 'link': {
          const r = geo.rect(a.x, a.y, a.w, a.h);
          const ctx = doc.context;
          const action = a.url?.startsWith('#page=')
            ? { Dest: [doc.getPage(Math.max(0, Math.min(total - 1, parseInt(a.url.slice(6), 10) - 1))).ref, PDFName.of('Fit')] }
            : { A: ctx.obj({ Type: 'Action', S: 'URI', URI: PDFString.of(a.url || '') }) };
          const annot = ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [r.x, r.y, r.x + r.width, r.y + r.height], Border: [0, 0, 0], F: 4, ...action });
          const ref = ctx.register(annot);
          const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
          if (annots) annots.push(ref); else page.node.set(PDFName.of('Annots'), ctx.obj([ref]));
          break;
        }
        default: break;
      }
    }
  }
  doc.setProducer(PRODUCER);
  doc.setModificationDate(new Date());
  onProgress?.(0.97, 'Enregistrement…');
  return doc.save({ useObjectStreams: true });
}
