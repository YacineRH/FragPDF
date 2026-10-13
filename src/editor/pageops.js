// Opérations sur les pages depuis l'éditeur (pivoter, supprimer, dupliquer, déplacer, insérer)
// avec adaptation des annotations existantes.
import { PDFDocument } from 'pdf-lib';
import { applyPageLayout, deletePages, rotatePages, loadDoc, save } from '../lib/pdf-ops.js';
import { bboxOf } from './annots.js';

function rotPoint(x, y, W, H, deg) {
  switch (((deg % 360) + 360) % 360) {
    case 90: return [H - y, x];
    case 180: return [W - x, H - y];
    case 270: return [y, W - x];
    default: return [x, y];
  }
}

/** Transforme une annotation lorsque la page (W×H avant rotation) est tournée de `deg` (sens horaire). */
export function rotateAnnot(a, W, H, deg) {
  const swap = deg % 180 !== 0;
  const mapRect = (r) => {
    const p1 = rotPoint(r.x, r.y, W, H, deg), p2 = rotPoint(r.x + r.w, r.y + r.h, W, H, deg);
    return { ...r, x: Math.min(p1[0], p2[0]), y: Math.min(p1[1], p2[1]), w: Math.abs(p2[0] - p1[0]), h: Math.abs(p2[1] - p1[1]) };
  };
  switch (a.type) {
    case 'line': case 'arrow': {
      const [x1, y1] = rotPoint(a.x1, a.y1, W, H, deg), [x2, y2] = rotPoint(a.x2, a.y2, W, H, deg);
      Object.assign(a, { x1, y1, x2, y2 });
      break;
    }
    case 'ink': a.points = a.points.map(([x, y]) => rotPoint(x, y, W, H, deg)); break;
    case 'highlight': case 'underline': case 'strike': a.rects = a.rects.map(mapRect); break;
    case 'whiteout': case 'redact': case 'link': Object.assign(a, mapRect(a)); break;
    default: {
      // objets rigides (texte, image, formes…) : le centre se déplace, l'angle augmente
      const b = bboxOf(a);
      const [cx, cy] = rotPoint(b.x + b.w / 2, b.y + b.h / 2, W, H, deg);
      a.x = cx - a.w / 2; a.y = cy - a.h / 2;
      a.rot = (((a.rot || 0) + deg) % 360 + 360) % 360;
      if (a.covers) a.covers = a.covers.map(mapRect);
    }
  }
  void swap;
}

/** Remappe les liens internes (#page=N, 1-based) ; fn reçoit l'index 0-based et renvoie le nouveau (ou null = lien cassé). */
function remapLinks(state, fn) {
  for (const a of state.annots) {
    if (a.type !== 'link' || !String(a.url || '').startsWith('#page=')) continue;
    const n = parseInt(a.url.slice(6), 10) - 1;
    if (!Number.isFinite(n)) continue;
    const m = fn(n);
    a.url = m === null || m === undefined ? '#page=1' : `#page=${m + 1}`;
  }
}

async function commit(state, bytes, mutateAnnots) {
  state.checkpoint();
  mutateAnnots?.();
  await state.setBytes(bytes);
  state.dirty = true;
  state.emit('annots', { all: true });
}

export async function rotatePage(state, i, delta) {
  const { w, h } = state.pages[i];
  const bytes = await rotatePages(state.bytes, [i], delta);
  await commit(state, bytes, () => {
    state.annots.filter((a) => a.page === i).forEach((a) => rotateAnnot(a, w, h, delta));
  });
}

export async function deletePage(state, indices) {
  const set = new Set(indices);
  if (set.size >= state.pages.length) throw new Error('Impossible de supprimer toutes les pages.');
  const bytes = await deletePages(state.bytes, indices);
  await commit(state, bytes, () => {
    const sorted = [...set].sort((a, b) => a - b);
    state.annots = state.annots.filter((a) => !set.has(a.page));
    state.annots.forEach((a) => { a.page -= sorted.filter((d) => d < a.page).length; });
    remapLinks(state, (n) => (set.has(n) ? null : n - sorted.filter((d) => d < n).length));
    state.sel = new Set();
  });
}

/** Réorganise : `order` = tableau d'indices sources (peut dupliquer) ; remappe les annotations. */
export async function reorderPages(state, order, extraRotate = {}) {
  const layout = order.map((src) => ({ src, rotate: extraRotate[src] || 0 }));
  const bytes = await applyPageLayout(state.bytes, layout);
  await commit(state, bytes, () => {
    const out = [];
    order.forEach((src, newIdx) => {
      state.annots.filter((a) => a.page === src).forEach((a) => {
        const c = structuredClone(a);
        c.page = newIdx;
        c.id = `${a.id}-${newIdx}-${Math.random().toString(36).slice(2, 5)}`;
        // première occurrence : garde l'identifiant d'origine
        if (!out.some((o) => o.id === a.id)) c.id = a.id;
        out.push(c);
      });
    });
    state.annots = out;
    state.sel = new Set();
    remapLinks(state, (n) => { const k = order.indexOf(n); return k < 0 ? null : k; });
  });
}

export async function duplicatePage(state, i) {
  const order = state.pages.map((_, k) => k);
  order.splice(i + 1, 0, i);
  await reorderPages(state, order);
}

export async function movePage(state, from, to) {
  const order = state.pages.map((_, k) => k);
  const [m] = order.splice(from, 1);
  order.splice(to, 0, m);
  await reorderPages(state, order);
}

export async function insertBlank(state, at) {
  const doc = await loadDoc(state.bytes);
  const ref = state.pages[Math.min(Math.max(at - 1, 0), state.pages.length - 1)];
  doc.insertPage(at, [ref.w, ref.h]);
  const bytes = await save(doc);
  await commit(state, bytes, () => { state.annots.forEach((a) => { if (a.page >= at) a.page += 1; }); remapLinks(state, (n) => (n >= at ? n + 1 : n)); });
}

export async function insertPdf(state, otherBytes, at) {
  const doc = await loadDoc(state.bytes);
  const other = await loadDoc(otherBytes);
  const pages = await doc.copyPages(other, other.getPageIndices());
  pages.forEach((p, k) => doc.insertPage(at + k, p));
  const bytes = await save(doc);
  const n = pages.length;
  await commit(state, bytes, () => { state.annots.forEach((a) => { if (a.page >= at) a.page += n; }); remapLinks(state, (m) => (m >= at ? m + n : m)); });
  return n;
}

export async function blankDocument() {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);
  return save(doc);
}
