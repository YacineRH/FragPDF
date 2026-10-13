// Édition du texte existant : détecte les lignes de texte du PDF, permet de les réécrire
// (l'original est recouvert par un aplat de la couleur du fond, puis remplacé par un nouveau texte).
import { h } from '../lib/utils.js';
import { pdfjs } from '../lib/pdfjs.js';

const ASC = 0.905, DESC = 0.212;
const BASELINE_OFFSET = (1.25 - (ASC + DESC)) / 2 + ASC; // ≈ 0.9635 × taille

export function guessFont(fontName = '', fontObj = {}, family = '') {
  const raw = String(fontObj.name || fontName || '').replace(/^[A-Z]{6}\+/, '');
  const n = raw.toLowerCase();
  const bold = !!fontObj.bold || /bold|black|heavy|semibold|demi|extrabold/.test(n);
  const italic = !!fontObj.italic || /italic|oblique|kursiv/.test(n);
  let fontId = 'helvetica';
  const named = [['inter', 'inter'], ['roboto mono', 'roboto-mono'], ['robotomono', 'roboto-mono'], ['roboto', 'roboto'], ['montserrat', 'montserrat'], ['lora', 'lora'], ['playfair', 'playfair-display'], ['caveat', 'caveat'], ['dancing', 'dancing-script'], ['pacifico', 'pacifico']];
  const hit = named.find(([k]) => n.includes(k));
  if (hit) fontId = hit[1];
  else if (/courier|mono|consolas|menlo|typewriter|lucida console|andale/.test(n) || fontObj.isMonospace || family === 'monospace') fontId = 'courier';
  else if ((/times|serif|georgia|garamond|palatino|minion|cambria|bookman|baskerville|century|didot|bodoni/.test(n) && !/sans/.test(n)) || ((fontObj.isSerifFont || family === 'serif') && !/arial|helvetica|calibri|verdana|tahoma/.test(n))) fontId = 'times';
  return { fontId, bold, italic };
}

function quantKey(r, g, b) { return ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4); }

/** Échantillonne couleur de fond (bords) et couleur du texte (pixels les plus éloignés du fond). */
export function sampleColors(canvas, pageW, box) {
  const k = canvas.width / pageW;
  const pad = 3;
  // copie de la zone seulement (lecture rapide, sans pénaliser le canvas de la page)
  const rx = Math.max(0, Math.floor((box.x - pad) * k)), ry = Math.max(0, Math.floor((box.y - pad) * k));
  const rw = Math.max(1, Math.min(canvas.width - rx, Math.ceil((box.w + pad * 2) * k))), rh = Math.max(1, Math.min(canvas.height - ry, Math.ceil((box.h + pad * 2) * k)));
  const tmp = document.createElement('canvas');
  tmp.width = rw; tmp.height = rh;
  const ctx = tmp.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, rx, ry, rw, rh, 0, 0, rw, rh);
  const full = ctx.getImageData(0, 0, rw, rh);
  const at = (x, y) => {
    const px = Math.max(0, Math.min(rw - 1, Math.round(x * k) - rx)), py = Math.max(0, Math.min(rh - 1, Math.round(y * k) - ry));
    const i = (py * rw + px) * 4;
    return [full.data[i], full.data[i + 1], full.data[i + 2]];
  };
  const counts = new Map();
  const edge = 1.5;
  for (let i = 0; i <= 8; i++) {
    const fx = box.x + (box.w * i) / 8, fy = box.y + (box.h * i) / 8;
    for (const [x, y] of [[fx, box.y - edge], [fx, box.y + box.h + edge], [box.x - edge, fy], [box.x + box.w + edge, fy]]) {
      const d = at(x, y);
      const key = quantKey(d[0], d[1], d[2]);
      const e = counts.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      e.n++; e.r += d[0]; e.g += d[1]; e.b += d[2];
      counts.set(key, e);
    }
  }
  let best = null;
  for (const e of counts.values()) if (!best || e.n > best.n) best = e;
  const bg = best ? [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)] : [255, 255, 255];
  // texte : pixels les plus éloignés du fond dans la boîte
  const cand = [];
  const x0 = Math.round(box.x * k) - rx, y0 = Math.round(box.y * k) - ry, x1 = Math.round((box.x + box.w) * k) - rx, y1 = Math.round((box.y + box.h) * k) - ry;
  for (let y = Math.max(0, y0); y < Math.min(rh, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(rw, x1); x++) {
      const i = (y * rw + x) * 4;
      const dist = Math.abs(full.data[i] - bg[0]) + Math.abs(full.data[i + 1] - bg[1]) + Math.abs(full.data[i + 2] - bg[2]);
      cand.push([dist, full.data[i], full.data[i + 1], full.data[i + 2]]);
    }
  }
  let fg = [0, 0, 0];
  if (cand.length) {
    cand.sort((a, b) => b[0] - a[0]);
    const top = cand.slice(0, Math.max(1, Math.floor(cand.length * 0.04)));
    if (top[0][0] > 60) fg = [0, 1, 2].map((c) => Math.round(top.reduce((s2, t2) => s2 + t2[c + 1], 0) / top.length));
  }
  const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  return { bg: hex(bg), fg: hex(fg) };
}

export class TextEditTool {
  constructor(state, viewer, annots) {
    this.state = state;
    this.viewer = viewer;
    this.annots = annots;
    this.cache = new Map(); // pageIdx -> {version, blocks}
    state.on('tool', () => this.refreshAll());
    state.on('pageRendered', (i) => { if (state.tool === 'edittext') this.buildLayer(i); });
    state.on('annots', () => { if (state.tool === 'edittext') this.refreshAll(); });
    viewer.onPageDom(() => { this.cache.clear(); });
  }

  refreshAll() {
    const on = this.state.tool === 'edittext';
    this.viewer.root.classList.toggle('mode-edittext', on);
    this.viewer.wraps.forEach((d, i) => {
      let layer = d.inner.querySelector('.edit-layer');
      if (!on) { layer?.remove(); return; }
      if (this.viewer.visible.has(i)) this.buildLayer(i);
    });
  }

  async blocksOf(i) {
    const c = this.cache.get(i);
    if (c && c.version === this.state.version) return c.blocks;
    const page = await this.state.pdf.getPage(i + 1);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const tr = pdfjs.Util.transform(vp.transform, it.transform);
      const fs = Math.hypot(tr[2], tr[3]);
      const ang = Math.atan2(tr[1], tr[0]);
      if (Math.abs(ang) > 0.03 || fs < 2) continue; // texte tourné : non éditable ici
      const style = tc.styles[it.fontName] || {};
      const asc = style.ascent ?? ASC, desc = style.descent ?? -DESC;
      let fontObj = {};
      try { if (page.commonObjs.has(it.fontName)) fontObj = page.commonObjs.get(it.fontName) || {}; } catch { /* police non chargée */ }
      const w = Math.hypot(tr[0], tr[1]) * (it.width / Math.max(Math.hypot(it.transform[0], it.transform[1]), 1e-6));
      items.push({ str: it.str, x: tr[4], base: tr[5], fs, w: it.width || w, asc, desc, fontName: it.fontName, fontObj, family: fontObj.fallbackName || style.fontFamily || '' });
    }
    // regroupement par ligne de base
    items.sort((a, b) => a.base - b.base || a.x - b.x);
    const lines = [];
    for (const it of items) {
      const line = lines.find((l) => Math.abs(l.base - it.base) < Math.max(1.2, it.fs * 0.25));
      if (line) line.items.push(it); else lines.push({ base: it.base, items: [it] });
    }
    const blocks = [];
    for (const line of lines) {
      line.items.sort((a, b) => a.x - b.x);
      let cur = null;
      for (const it of line.items) {
        const gap = cur ? it.x - (cur.x + cur.w) : 0;
        if (!cur || gap > Math.max(it.fs, cur.fs) * 2.2 || gap < -it.fs * 2) {
          cur = { x: it.x, w: it.w, base: line.base, fs: it.fs, items: [it], text: it.str, asc: it.asc, desc: it.desc };
          blocks.push(cur);
        } else {
          const needSpace = gap > it.fs * 0.12 && !cur.text.endsWith(' ') && !it.str.startsWith(' ');
          cur.text += (needSpace ? ' ' : '') + it.str;
          cur.w = it.x + it.w - cur.x;
          cur.fs = Math.max(cur.fs, it.fs);
          cur.items.push(it);
        }
      }
    }
    for (const b of blocks) {
      const dom = b.items.reduce((m, it) => (it.str.length > (m?.str.length ?? 0) ? it : m), null);
      b.top = b.base - Math.max(b.asc, 0.8) * b.fs;
      b.bottom = b.base + Math.max(Math.abs(b.desc), 0.22) * b.fs;
      b.h = b.bottom - b.top;
      b.font = guessFont(dom.fontName, dom.fontObj, dom.family);
    }
    page.cleanup();
    this.cache.set(i, { version: this.state.version, blocks });
    return blocks;
  }

  async buildLayer(i) {
    if (this.state.tool !== 'edittext') return;
    const d = this.viewer.dom(i);
    if (!d) return;
    const blocks = await this.blocksOf(i);
    if (this.state.tool !== 'edittext') return;
    d.inner.querySelector('.edit-layer')?.remove();
    const layer = h('div', { class: 'edit-layer' });
    const existing = this.state.annotsOnPage(i).filter((a) => a.type === 'text' && a.covers?.length);
    for (const b of blocks) {
      const done = existing.some((a) => a.covers.some((c) => Math.abs(c.x - (b.x - 1)) < 3 && Math.abs(c.y - (b.top - 1)) < 3));
      if (done) continue;
      const box = h('div', { class: 'tx-box', title: b.text, style: { left: `${b.x - 1}px`, top: `${b.top - 1}px`, width: `${b.w + 2}px`, height: `${b.h + 2}px` } });
      box.addEventListener('click', (e) => { e.stopPropagation(); this.editBlocks(i, [b]); });
      layer.append(box);
    }
    // sélection par rectangle
    layer.addEventListener('pointerdown', (e) => {
      if (e.target !== layer) return;
      e.preventDefault();
      const start = this.viewer.pointToPage(e.clientX, e.clientY, i);
      const ghost = h('div', { class: 'ghost' });
      layer.append(ghost);
      const move = (ev) => {
        const p = this.viewer.pointToPage(ev.clientX, ev.clientY, i);
        ghost.style.cssText = `left:${Math.min(start.x, p.x)}px;top:${Math.min(start.y, p.y)}px;width:${Math.abs(p.x - start.x)}px;height:${Math.abs(p.y - start.y)}px`;
      };
      const up = (ev) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        ghost.remove();
        const p = this.viewer.pointToPage(ev.clientX, ev.clientY, i);
        const r = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
        if (r.w < 6 || r.h < 6) return;
        const hit = blocks.filter((b) => b.x < r.x + r.w && b.x + b.w > r.x && b.top < r.y + r.h && b.bottom > r.y);
        if (hit.length) this.editBlocks(i, hit);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    d.inner.append(layer);
  }

  /** Crée une annotation texte à partir d'un ou plusieurs blocs de texte. */
  editBlocks(pageIdx, blocks) {
    const st = this.state;
    const d = this.viewer.dom(pageIdx);
    const sorted = [...blocks].sort((a, b) => a.base - b.base || a.x - b.x);
    // regroupe les blocs de même ligne (séparés visuellement) en lignes de texte
    const rows = [];
    for (const b of sorted) {
      const row = rows.find((r) => Math.abs(r.base - b.base) < 1.5);
      if (row) row.blocks.push(b); else rows.push({ base: b.base, blocks: [b] });
    }
    const first = rows[0].blocks[0];
    const left = Math.min(...sorted.map((b) => b.x));
    const fs = Math.round(first.fs * 10) / 10;
    const lines = rows.map((r) => r.blocks.sort((a, b) => a.x - b.x).map((b) => b.text).join('   '));
    const pitch = rows.length > 1 ? (rows[rows.length - 1].base - rows[0].base) / (rows.length - 1) : fs * 1.25;
    const lineHeight = Math.max(1, pitch / fs);
    const { bg, fg } = sampleColors(d.canvas, st.pages[pageIdx].w, { x: first.x, y: first.top, w: Math.max(first.w, 4), h: first.h });
    const covers = sorted.map((b) => {
      const c = sampleColors(d.canvas, st.pages[pageIdx].w, { x: b.x, y: b.top, w: Math.max(b.w, 4), h: b.h });
      return { x: b.x - 1, y: b.top - 0.5, w: b.w + 2, h: b.h + 1, color: c.bg };
    });
    const baselineTop = first.base - ((lineHeight * fs) - (ASC + DESC) * fs) / 2 - ASC * fs;
    st.checkpoint();
    const ann = st.addAnnot({
      type: 'text', page: pageIdx, x: left, y: baselineTop, w: Math.max(...sorted.map((b) => b.x + b.w)) - left + 4, h: lines.length * lineHeight * fs,
      text: lines.join('\n'), fontId: first.font.fontId, bold: first.font.bold, italic: first.font.italic, size: fs, color: fg, lineHeight,
      align: 'left', autoW: true, covers, opacity: 1, underline: false, bg: null,
    });
    void bg;
    st.setSelection([ann.id]);
    requestAnimationFrame(() => this.annots.startEdit(ann.id, false));
    return ann;
  }
}
