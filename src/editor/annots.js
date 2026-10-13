// Calque d'annotations : rendu DOM de chaque annotation (coordonnées en points PDF),
// sélection, déplacement, redimensionnement, rotation, saisie de texte en place.
import { h, clamp } from '../lib/utils.js';
import { cssFont, ensureFontLoaded } from '../lib/fonts.js';
import { icon } from '../ui/icons.js';

export const rgba = (hex, a = 1) => {
  let s = (hex || '#000000').replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

export const ROTATABLE = new Set(['text', 'image', 'rect', 'ellipse', 'stamp', 'mark']);
export const BOX_TYPES = new Set(['text', 'image', 'rect', 'ellipse', 'stamp', 'mark', 'whiteout', 'redact', 'link']);

export function bboxOf(a) {
  switch (a.type) {
    case 'line': case 'arrow':
      return { x: Math.min(a.x1, a.x2), y: Math.min(a.y1, a.y2), w: Math.abs(a.x2 - a.x1), h: Math.abs(a.y2 - a.y1), rot: 0 };
    case 'ink': {
      const xs = a.points.map((p) => p[0]), ys = a.points.map((p) => p[1]);
      const pad = a.strokeW / 2;
      return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2, rot: 0 };
    }
    case 'highlight': case 'underline': case 'strike': {
      const x0 = Math.min(...a.rects.map((r) => r.x)), y0 = Math.min(...a.rects.map((r) => r.y));
      const x1 = Math.max(...a.rects.map((r) => r.x + r.w)), y1 = Math.max(...a.rects.map((r) => r.y + r.h));
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, rot: 0 };
    }
    default: return { x: a.x, y: a.y, w: a.w, h: a.h, rot: a.rot || 0 };
  }
}

/** Renvoie le patch à appliquer pour translater l'annotation d'origine `o` de (dx, dy). */
export function translatePatch(o, dx, dy) {
  switch (o.type) {
    case 'line': case 'arrow': return { x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy };
    case 'ink': return { points: o.points.map(([x, y]) => [x + dx, y + dy]) };
    case 'highlight': case 'underline': case 'strike': return { rects: o.rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy })) };
    default: return { x: o.x + dx, y: o.y + dy };
  }
}

function smoothD(points) {
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]} l 0.01 0`;
  let d = `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i][0] + points[i + 1][0]) / 2, my = (points[i][1] + points[i + 1][1]) / 2;
    d += ` Q ${points[i][0].toFixed(2)} ${points[i][1].toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}`;
  }
  const l = points[points.length - 1];
  return `${d} L ${l[0].toFixed(2)} ${l[1].toFixed(2)}`;
}

const SVGNS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

const MARK_PATHS = {
  check: (s) => `M ${0.12 * s} ${0.55 * s} L ${0.38 * s} ${0.82 * s} L ${0.9 * s} ${0.2 * s}`,
  cross: (s) => `M ${0.18 * s} ${0.18 * s} L ${0.82 * s} ${0.82 * s} M ${0.82 * s} ${0.18 * s} L ${0.18 * s} ${0.82 * s}`,
};

export class AnnotManager {
  constructor(state, viewer) {
    this.state = state;
    this.viewer = viewer;
    this.els = new Map(); // id -> [elements]
    this.frame = null;
    this.editing = null;
    this.drag = null;
    this.ghost = null;
    this.onRequestPlace = null; // callback(page, rect) pour le placement d'images
    this.unsub = [];
    this.bind();
  }

  bind() {
    const s = this.state;
    this.unsub.push(
      s.on('annots', (e) => this.sync(e)),
      s.on('selection', () => this.updateFrame()),
      s.on('tool', () => this.updateCapture()),
      s.on('zoom', () => this.updateFrame()),
    );
    this.viewer.onPageDom(() => { this.els.clear(); this.syncAll(); this.updateCapture(); });
    const root = this.viewer.root;
    root.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    root.addEventListener('dblclick', (e) => this.onDblClick(e));
    this.onMove = (e) => this.onPointerMove(e);
    this.onUp = (e) => this.onPointerUp(e);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
  }

  destroy() {
    this.unsub.forEach((u) => u());
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
  }

  /* ---------- rendu ---------- */
  syncAll() { for (let i = 0; i < this.state.pages.length; i++) this.syncPage(i); this.updateFrame(); }

  sync(e = {}) {
    if (e.all) { this.syncAll(); return; }
    const pages = e.pages ?? [];
    pages.forEach((p) => this.syncPage(p));
    this.updateFrame();
  }

  syncPage(i) {
    const d = this.viewer.dom(i);
    if (!d) return;
    const list = this.state.annotsOnPage(i);
    const keep = new Set(list.map((a) => a.id));
    // supprime les éléments d'annotations disparues ou déplacées vers une autre page
    for (const [id, els] of [...this.els]) {
      if (els[0]?.dataset.page === String(i) && !keep.has(id)) { els.forEach((e) => e.remove()); this.els.delete(id); }
    }
    for (const a of list) {
      const prev = this.els.get(a.id);
      if (prev && prev[0].dataset.page !== String(i)) { prev.forEach((e) => e.remove()); this.els.delete(a.id); }
      const els = this.build(a, i);
      const old = this.els.get(a.id);
      if (old) {
        old.forEach((e) => e.remove());
      }
      els.forEach((e) => d.annotLayer.append(e));
      this.els.set(a.id, els);
    }
    // ordre = z-index = ordre du tableau
    list.forEach((a, k) => { this.els.get(a.id)?.forEach((e) => { e.style.zIndex = String(10 + k * 2 + (e.classList.contains('an-cover') ? -1 : 0)); }); });
    if (this.frame && this.frame.parentElement !== d.annotLayer && this.frame.dataset.page === String(i) === false) { /* géré par updateFrame */ }
  }

  build(a, pageIdx) {
    const st = this.state;
    const els = [];
    const base = (cls) => h('div', { class: `an an-${a.type} ${cls || ''}`, dataset: { id: a.id, page: pageIdx } });
    const place = (el) => {
      const b = bboxOf(a);
      el.style.left = `${b.x}px`; el.style.top = `${b.y}px`; el.style.width = `${b.w}px`; el.style.height = `${b.h}px`;
      if (a.rot) el.style.transform = `rotate(${a.rot}deg)`;
    };
    switch (a.type) {
      case 'text': {
        for (const cv of a.covers || []) {
          els.push(h('div', { class: 'an-cover', dataset: { id: a.id, page: pageIdx }, style: { left: `${cv.x}px`, top: `${cv.y}px`, width: `${cv.w}px`, height: `${cv.h}px`, background: cv.color || '#fff' } }));
        }
        const el = base();
        ensureFontLoaded(a.fontId).then(() => { if (el.isConnected) this.measure(a, el); });
        el.style.left = `${a.x}px`; el.style.top = `${a.y}px`;
        if (a.autoW) { el.style.width = 'max-content'; el.style.whiteSpace = 'pre'; } else { el.style.width = `${a.w}px`; }
        el.style.font = cssFont(a.fontId, a.bold, a.italic, a.size);
        el.style.lineHeight = String(a.lineHeight || 1.25);
        el.style.color = a.color; el.style.textAlign = a.align || 'left';
        el.style.opacity = a.opacity ?? 1;
        if (a.underline) el.style.textDecoration = 'underline';
        if (a.bg) el.style.background = rgba(a.bg, a.bgOpacity ?? 1);
        if (a.rot) el.style.transform = `rotate(${a.rot}deg)`;
        el.textContent = a.text;
        if (!a.text) el.classList.add('empty');
        els.push(el);
        requestAnimationFrame(() => { if (el.isConnected && !this.editing) this.measure(a, el); });
        break;
      }
      case 'image': {
        const el = base();
        place(el);
        const as = st.assets.get(a.assetId);
        el.append(h('img', { src: as?.url, draggable: 'false', alt: '' }));
        el.style.opacity = a.opacity ?? 1;
        els.push(el);
        break;
      }
      case 'rect': case 'ellipse': {
        const el = base();
        place(el);
        el.style.border = `${a.strokeW}px solid ${a.stroke}`;
        el.style.boxSizing = 'border-box';
        if (a.fill) el.style.background = rgba(a.fill, a.fillOpacity ?? 1);
        if (a.type === 'ellipse') el.style.borderRadius = '50%';
        el.style.opacity = a.opacity ?? 1;
        if (!a.strokeW) el.style.border = 'none';
        els.push(el);
        break;
      }
      case 'line': case 'arrow': {
        const el = base();
        const pad = Math.max(12, a.strokeW * 5);
        const b = bboxOf(a);
        el.style.left = `${b.x - pad}px`; el.style.top = `${b.y - pad}px`; el.style.width = `${b.w + pad * 2}px`; el.style.height = `${b.h + pad * 2}px`;
        const svg = svgEl('svg', { width: b.w + pad * 2, height: b.h + pad * 2, viewBox: `${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}` });
        svg.style.overflow = 'visible';
        svg.append(svgEl('line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, stroke: a.stroke, 'stroke-width': a.strokeW, 'stroke-linecap': 'round' }));
        svg.append(svgEl('line', { class: 'hit', x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, stroke: 'transparent', 'stroke-width': Math.max(a.strokeW, 12), 'stroke-linecap': 'round' }));
        if (a.type === 'arrow') {
          const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1), s = Math.max(8, a.strokeW * 4.5);
          const p1 = [a.x2 - s * Math.cos(ang - 0.42), a.y2 - s * Math.sin(ang - 0.42)], p2 = [a.x2 - s * Math.cos(ang + 0.42), a.y2 - s * Math.sin(ang + 0.42)];
          svg.append(svgEl('polygon', { points: `${a.x2},${a.y2} ${p1.join(',')} ${p2.join(',')}`, fill: a.stroke, stroke: a.stroke, 'stroke-width': 1, 'stroke-linejoin': 'round' }));
        }
        el.append(svg);
        el.style.opacity = a.opacity ?? 1;
        // zone cliquable étroite : on laisse l'élément capter, mais pointer-events:none sur le svg sauf trait
        els.push(el);
        break;
      }
      case 'ink': {
        const el = base();
        const b = bboxOf(a);
        const pad = 4;
        el.style.left = `${b.x - pad}px`; el.style.top = `${b.y - pad}px`; el.style.width = `${b.w + pad * 2}px`; el.style.height = `${b.h + pad * 2}px`;
        const svg = svgEl('svg', { width: b.w + pad * 2, height: b.h + pad * 2, viewBox: `${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}` });
        svg.append(svgEl('path', { d: smoothD(a.points), fill: 'none', stroke: a.stroke, 'stroke-width': a.strokeW, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
        svg.append(svgEl('path', { class: 'hit', d: smoothD(a.points), fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(a.strokeW, 12), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
        el.append(svg);
        el.style.opacity = a.opacity ?? 1;
        els.push(el);
        break;
      }
      case 'highlight': case 'underline': case 'strike': {
        a.rects.forEach((r) => {
          const el = h('div', { class: `an an-${a.type}`, dataset: { id: a.id, page: pageIdx }, style: { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, opacity: a.opacity ?? 1 } });
          if (a.type === 'highlight') { el.style.background = a.color; el.style.mixBlendMode = 'multiply'; }
          else {
            const line = h('div', { style: { position: 'absolute', left: 0, right: 0, height: `${Math.max(1, r.h / 14)}px`, background: a.color, top: a.type === 'underline' ? `${r.h - 1 - Math.max(1, r.h / 14) / 2}px` : `${r.h * 0.55}px` } });
            el.append(line);
          }
          els.push(el);
        });
        break;
      }
      case 'whiteout': { const el = base(); place(el); el.style.background = a.color || '#fff'; els.push(el); break; }
      case 'redact': { const el = base(); place(el); el.append(h('span', {}, 'CAVIARDÉ')); els.push(el); break; }
      case 'stamp': {
        const el = base();
        place(el);
        const bw = Math.max(1.5, a.h * 0.06);
        el.style.border = `${bw}px solid ${a.color}`;
        el.style.color = a.color;
        el.style.borderRadius = `${Math.min(6, a.h * 0.1)}px`;
        el.style.boxSizing = 'border-box';
        el.style.opacity = a.opacity ?? 1;
        const label = h('span', {}, a.label);
        el.append(label);
        label.style.font = `700 ${Math.min(a.h * 0.55, 200)}px Helvetica, Arial, sans-serif`;
        els.push(el);
        requestAnimationFrame(() => {
          if (!label.isConnected) return;
          const avail = a.w - 16;
          const k = Math.min(1, avail / (label.offsetWidth || 1));
          label.style.fontSize = `${Math.min(a.h * 0.55, 200) * k}px`;
        });
        break;
      }
      case 'mark': {
        const el = base();
        place(el);
        const s = 100;
        const svg = svgEl('svg', { viewBox: `0 0 ${s} ${s}`, width: '100%', height: '100%', preserveAspectRatio: 'none' });
        const sw = 12;
        if (a.kind === 'circle') svg.append(svgEl('ellipse', { cx: 50, cy: 50, rx: 42, ry: 42, fill: 'none', stroke: a.color, 'stroke-width': sw }));
        else if (a.kind === 'dot') svg.append(svgEl('ellipse', { cx: 50, cy: 50, rx: 25, ry: 25, fill: a.color }));
        else svg.append(svgEl('path', { d: MARK_PATHS[a.kind](s), fill: 'none', stroke: a.color, 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
        el.append(svg);
        els.push(el);
        break;
      }
      case 'link': {
        const el = base();
        place(el);
        el.append(icon('link', 14));
        els.push(el);
        break;
      }
      default: break;
    }
    return els;
  }

  measure(a, el) {
    const hh = el.offsetHeight, ww = el.offsetWidth;
    let changed = false;
    if (hh && Math.abs(hh - (a.h || 0)) > 0.5) { a.h = hh; changed = true; }
    if (a.autoW && ww && Math.abs(ww - (a.w || 0)) > 0.5) { a.w = ww; changed = true; }
    if (changed && this.state.sel.has(a.id)) this.updateFrame();
  }

  /* ---------- sélection : cadre + poignées ---------- */
  selectionBox() {
    const sel = this.state.selected();
    if (!sel.length) return null;
    const page = sel[0].page;
    const items = sel.filter((a) => a.page === page);
    if (items.length === 1) {
      const a = items[0];
      return { page, a, ...bboxOf(a), single: true };
    }
    const bs = items.map(bboxOf);
    const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y));
    const x1 = Math.max(...bs.map((b) => b.x + b.w)), y1 = Math.max(...bs.map((b) => b.y + b.h));
    return { page, items, x: x0, y: y0, w: x1 - x0, h: y1 - y0, rot: 0, single: false };
  }

  updateFrame() {
    this.frame?.remove();
    this.frame = null;
    const sb = this.selectionBox();
    if (!sb) return;
    const d = this.viewer.dom(sb.page);
    if (!d) return;
    const z = this.state.zoom;
    const hs = 11 / z; // taille des poignées en points
    const a = sb.a;
    const isLine = a && (a.type === 'line' || a.type === 'arrow');
    const frame = h('div', { class: 'sel-frame', dataset: { page: sb.page } });
    if (isLine) {
      frame.style.cssText = 'left:0;top:0;width:0;height:0;border:none';
      [['p1', a.x1, a.y1], ['p2', a.x2, a.y2]].forEach(([k, x, y]) => frame.append(h('div', { class: 'handle', dataset: { h: k }, style: { left: `${x}px`, top: `${y}px`, width: `${hs}px`, height: `${hs}px` } })));
    } else {
      const pad = 2 / z;
      frame.style.left = `${sb.x - pad}px`; frame.style.top = `${sb.y - pad}px`;
      frame.style.width = `${sb.w + pad * 2}px`; frame.style.height = `${sb.h + pad * 2}px`;
      frame.style.borderWidth = `${1.5 / z}px`;
      if (sb.rot) frame.style.transform = `rotate(${sb.rot}deg)`;
      const type = a?.type;
      const resizable = sb.single && BOX_TYPES.has(type);
      if (resizable) {
        const dirs = type === 'text' ? ['nw', 'ne', 'sw', 'se', 'e', 'w'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
        for (const dir of dirs) {
          const px = dir.includes('w') ? 0 : dir.includes('e') ? 100 : 50, py = dir.includes('n') ? 0 : dir.includes('s') ? 100 : 50;
          frame.append(h('div', { class: 'handle', dataset: { h: dir }, style: { left: `${px}%`, top: `${py}%`, width: `${hs}px`, height: `${hs}px`, cursor: `${dir === 'e' || dir === 'w' ? 'ew' : dir === 'n' || dir === 's' ? 'ns' : dir === 'nw' || dir === 'se' ? 'nwse' : 'nesw'}-resize` } }));
        }
      }
      if (sb.single && ROTATABLE.has(type)) {
        frame.append(h('div', { class: 'rot-line', style: { height: `${22 / z}px`, width: `${1.5 / z}px` } }), h('div', { class: 'handle rot', dataset: { h: 'rot' }, style: { width: `${hs}px`, height: `${hs}px`, top: `${-22 / z}px` } }));
      }
    }
    frame.style.setProperty('--hs', `${hs}px`);
    d.annotLayer.append(frame);
    this.frame = frame;
  }

  /* ---------- création : calques de capture ---------- */
  updateCapture() {
    const tool = this.state.tool;
    const active = CREATE_TOOLS.has(tool) || (HL_TOOLS.has(tool) && this.state.opts.hlMode === 'area');
    this.viewer.wraps.forEach((d) => {
      d.capture.classList.toggle('active', active);
      d.capture.dataset.tool = tool;
    });
    this.viewer.root.dataset.tool = tool;
  }

  /* ---------- pointeur ---------- */
  pt(e, page) { return this.viewer.pointToPage(e.clientX, e.clientY, page); }

  onPointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const st = this.state;
    const handle = e.target.closest('.handle');
    if (handle) { this.startHandleDrag(e, handle); return; }
    if (this.editing && e.target.closest('.an')?.dataset.id === this.editing.id) return; // saisie
    if (this.editing) this.endEdit();
    const cap = e.target.closest('.capture.active');
    if (cap) { this.startCreate(e, +cap.closest('.page-wrap').dataset.page); return; }
    if (st.tool !== 'select') return;
    const an = e.target.closest('.an');
    if (an && an.dataset.id) {
      const id = an.dataset.id;
      const a = st.getAnnot(id);
      if (!a) return;
      const alreadySel = st.sel.size === 1 && st.sel.has(id) && !e.shiftKey;
      if (e.shiftKey) {
        const set = new Set(st.sel);
        if (set.has(id)) set.delete(id); else set.add(id);
        st.setSelection([...set].filter((x) => st.getAnnot(x)?.page === a.page));
      } else if (!st.sel.has(id)) st.setSelection([id]);
      this.startMove(e, a, alreadySel);
      return;
    }
    if (!e.target.closest('.sel-frame') && !e.target.closest('.form-field')) {
      if (st.sel.size) st.setSelection([]);
    }
  }

  startMove(e, a, alreadySel = false) {
    const st = this.state;
    const items = st.selected().filter((x) => x.page === a.page);
    const p = this.viewer.pointToPage(e.clientX, e.clientY, a.page);
    this.drag = { kind: 'move', start: p, startClient: [e.clientX, e.clientY], origs: items.map((x) => structuredClone(x)), page: a.page, moved: false, clickedId: a.id, alreadySel };
    e.preventDefault();
  }

  startHandleDrag(e, handle) {
    e.preventDefault();
    e.stopPropagation();
    const st = this.state;
    const sb = this.selectionBox();
    if (!sb?.single) return;
    const a = sb.a;
    const kind = handle.dataset.h;
    const b = bboxOf(a);
    this.drag = { kind: kind === 'rot' ? 'rotate' : kind === 'p1' || kind === 'p2' ? 'endpoint' : 'resize', handle: kind, orig: structuredClone(a), box: b, page: a.page, moved: false };
  }

  onPointerMove(e) {
    const d = this.drag;
    if (!d) return;
    const st = this.state;
    if (d.kind === 'move') {
      const dxC = e.clientX - d.startClient[0], dyC = e.clientY - d.startClient[1];
      if (!d.moved && Math.hypot(dxC, dyC) < 3) return;
      if (!d.moved) { st.checkpoint(); d.moved = true; }
      const p = this.viewer.pointToPage(e.clientX, e.clientY, d.page);
      let dx = p.x - d.start.x, dy = p.y - d.start.y;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const single = d.origs.length === 1;
      if (single) {
        // changement de page par glisser (images, textes, formes…)
        const o = d.origs[0];
        const under = this.viewer.pointToPage(e.clientX, e.clientY);
        if (under && under.page !== d.page && BOX_TYPES.has(o.type)) {
          const a = st.getAnnot(o.id);
          const b = bboxOf(o);
          const gx = d.start.x - b.x, gy = d.start.y - b.y;
          const oldPage = a.page;
          a.page = under.page;
          d.page = under.page;
          d.origs = [{ ...structuredClone(a), x: under.x - gx, y: under.y - gy }];
          d.start = under;
          st.annots.splice(st.annots.indexOf(a), 1);
          st.annots.push(a);
          Object.assign(a, { x: under.x - gx, y: under.y - gy });
          st.emit('annots', { pages: [oldPage, under.page] });
          return;
        }
      }
      for (const o of d.origs) {
        const a = st.getAnnot(o.id);
        Object.assign(a, translatePatch(o, dx, dy));
        this.refresh(a);
      }
      this.updateFrame();
    } else if (d.kind === 'resize') this.doResize(e);
    else if (d.kind === 'rotate') this.doRotate(e);
    else if (d.kind === 'endpoint') this.doEndpoint(e);
    else if (d.kind === 'create') this.doCreateMove(e);
  }

  onPointerUp(e) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const st = this.state;
    if (d.kind === 'move') {
      if (d.moved) { st.dirty = true; st.emit('annots', { pages: [d.page], ids: d.origs.map((o) => o.id) }); st.emit('history'); }
      else {
        // simple clic sur un texte déjà sélectionné -> édition
        const a = st.getAnnot(d.clickedId);
        if (a?.type === 'text' && st.sel.size === 1 && d.alreadySel) this.startEdit(a.id);
      }
    } else if (d.kind === 'create') this.endCreate(e, d);
    else if (d.moved) { st.dirty = true; st.emit('annots', { pages: [d.page] }); st.emit('history'); }
  }

  refresh(a) {
    const els = this.els.get(a.id);
    if (!els) return;
    const d = this.viewer.dom(a.page);
    const fresh = this.build(a, a.page);
    els.forEach((e) => e.remove());
    fresh.forEach((e) => d.annotLayer.append(e));
    this.els.set(a.id, fresh);
    const k = this.state.annotsOnPage(a.page).indexOf(a);
    fresh.forEach((e) => { e.style.zIndex = String(10 + k * 2 + (e.classList.contains('an-cover') ? -1 : 0)); });
  }

  doResize(e) {
    const d = this.drag, st = this.state;
    if (!d.moved) { st.checkpoint(); d.moved = true; }
    const o = d.orig, b = d.box;
    const a = st.getAnnot(o.id);
    const p = this.viewer.pointToPage(e.clientX, e.clientY, d.page);
    const r = ((o.rot || 0) * Math.PI) / 180;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const cos = Math.cos(r), sin = Math.sin(r);
    // pointeur dans le repère local (centré, non tourné)
    const lx = (p.x - cx) * cos + (p.y - cy) * sin;
    const ly = -(p.x - cx) * sin + (p.y - cy) * cos;
    const dir = d.handle;
    let x0 = -b.w / 2, x1 = b.w / 2, y0 = -b.h / 2, y1 = b.h / 2;
    const min = 6;
    const keepAspect = (o.type === 'image' || o.type === 'mark' || o.type === 'stamp' || e.shiftKey) && dir.length === 2;
    if (dir.includes('e')) x1 = Math.max(x0 + min, lx);
    if (dir.includes('w')) x0 = Math.min(x1 - min, lx);
    if (dir.includes('s')) y1 = Math.max(y0 + min, ly);
    if (dir.includes('n')) y0 = Math.min(y1 - min, ly);
    if (o.type === 'text') {
      // coins : mise à l'échelle de la police ; côtés : largeur seulement
      if (dir.length === 2) {
        const nw = x1 - x0, k = nw / b.w;
        y0 = dir.includes('n') ? y1 - b.h * k : -b.h / 2;
        y1 = dir.includes('s') ? y0 + b.h * k : b.h / 2;
      } else { y0 = -b.h / 2; y1 = b.h / 2; }
    } else if (keepAspect) {
      const nw = x1 - x0, nh = y1 - y0;
      const k = Math.max(nw / b.w, nh / b.h);
      const tw = b.w * k, th = b.h * k;
      if (dir.includes('e')) x1 = x0 + tw; else x0 = x1 - tw;
      if (dir.includes('s')) y1 = y0 + th; else y0 = y1 - th;
    }
    const nw = x1 - x0, nh = y1 - y0;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const ncx = cx + mx * cos - my * sin, ncy = cy + mx * sin + my * cos;
    const patch = { x: ncx - nw / 2, y: ncy - nh / 2, w: nw, h: nh };
    if (o.type === 'text') {
      if (dir.length === 2) patch.size = Math.max(4, o.size * (nw / b.w));
      patch.autoW = false;
    }
    Object.assign(a, patch);
    this.refresh(a);
    this.updateFrame();
  }

  doRotate(e) {
    const d = this.drag, st = this.state;
    if (!d.moved) { st.checkpoint(); d.moved = true; }
    const a = st.getAnnot(d.orig.id);
    const p = this.viewer.pointToPage(e.clientX, e.clientY, d.page);
    const b = d.box;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    let deg = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
    deg = ((deg % 360) + 360) % 360;
    const step = e.shiftKey ? 15 : 0;
    if (step) deg = Math.round(deg / step) * step;
    else for (const snap of [0, 45, 90, 135, 180, 225, 270, 315, 360]) if (Math.abs(deg - snap) < 3) deg = snap % 360;
    a.rot = Math.round(deg * 10) / 10;
    this.refresh(a);
    this.updateFrame();
  }

  doEndpoint(e) {
    const d = this.drag, st = this.state;
    if (!d.moved) { st.checkpoint(); d.moved = true; }
    const a = st.getAnnot(d.orig.id);
    const p = this.viewer.pointToPage(e.clientX, e.clientY, d.page);
    let { x, y } = p;
    const other = d.handle === 'p1' ? [a.x2, a.y2] : [a.x1, a.y1];
    if (e.shiftKey) {
      const ang = Math.round(Math.atan2(y - other[1], x - other[0]) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(x - other[0], y - other[1]);
      x = other[0] + len * Math.cos(ang); y = other[1] + len * Math.sin(ang);
    }
    if (d.handle === 'p1') { a.x1 = x; a.y1 = y; } else { a.x2 = x; a.y2 = y; }
    this.refresh(a);
    this.updateFrame();
  }

  /* ---------- création par glisser ---------- */
  startCreate(e, page) {
    e.preventDefault();
    const st = this.state;
    let tool = st.tool;
    let hlType = null;
    if (HL_TOOLS.has(tool)) { hlType = tool; tool = 'highlightbox'; }
    const p = this.pt(e, page);
    this.drag = { kind: 'create', tool, hlType, page, start: p, cur: p, points: [[p.x, p.y]], moved: false };
    if (tool === 'ink') this.makeGhost('ink', page);
    if (['rect', 'ellipse', 'line', 'arrow', 'whiteout', 'redact', 'link', 'highlightbox', 'stamp', 'image', 'sign', 'text', 'note', 'mark'].includes(tool)) this.makeGhost(tool, page);
  }

  makeGhost(tool, page) {
    this.ghost?.remove();
    const d = this.viewer.dom(page);
    const g = h('div', { class: `ghost ghost-${tool}` });
    d.annotLayer.append(g);
    this.ghost = g;
  }

  doCreateMove(e) {
    const d = this.drag;
    const p = this.pt(e, d.page);
    d.cur = p;
    if (Math.hypot(p.x - d.start.x, p.y - d.start.y) > 3) d.moved = true;
    if (d.tool === 'ink') {
      const last = d.points[d.points.length - 1];
      if (Math.hypot(p.x - last[0], p.y - last[1]) > 1.2) d.points.push([p.x, p.y]);
      this.drawInkGhost(d);
      return;
    }
    const g = this.ghost;
    if (!g) return;
    if (d.tool === 'line' || d.tool === 'arrow') {
      const x1 = d.start.x, y1 = d.start.y, x2 = p.x, y2 = p.y;
      const len = Math.hypot(x2 - x1, y2 - y1);
      g.style.cssText = `left:${x1}px;top:${y1}px;width:${len}px;height:0;border-top:2px solid var(--accent);transform-origin:0 0;transform:rotate(${Math.atan2(y2 - y1, x2 - x1)}rad)`;
    } else {
      const x = Math.min(d.start.x, p.x), y = Math.min(d.start.y, p.y), w = Math.abs(p.x - d.start.x), hh = Math.abs(p.y - d.start.y);
      g.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${hh}px`;
    }
  }

  drawInkGhost(d) {
    const pg = this.viewer.dom(d.page);
    if (!this.ghost) return;
    const o = this.state.opts.ink;
    this.ghost.style.cssText = 'left:0;top:0;width:100%;height:100%;border:none;background:none';
    const W = this.state.pages[d.page].w, H = this.state.pages[d.page].h;
    this.ghost.innerHTML = '';
    const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    svg.append(svgEl('path', { d: smoothD(d.points), fill: 'none', stroke: o.stroke, 'stroke-width': o.strokeW, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: o.opacity }));
    this.ghost.append(svg);
    void pg;
  }

  endCreate(e, d) {
    this.ghost?.remove();
    this.ghost = null;
    const st = this.state;
    const tool = d.tool;
    const o = st.opts;
    const s = d.start, c = d.cur;
    const x = Math.min(s.x, c.x), y = Math.min(s.y, c.y), w = Math.abs(c.x - s.x), hh = Math.abs(c.y - s.y);
    const pageW = st.pages[d.page].w;
    let ann = null;
    st.checkpoint();
    switch (tool) {
      case 'text': case 'note': {
        const isNote = tool === 'note';
        const base = o.text;
        const width = d.moved && w > 30 ? w : isNote ? 200 : Math.min(260, pageW - s.x - 10);
        ann = st.addAnnot({
          type: 'text', page: d.page, x: d.moved ? x : s.x, y: d.moved ? y : s.y - base.size * 0.6, w: Math.max(40, width), h: base.size * 1.25, text: '',
          ...base, ...(isNote ? { bg: '#fff3a3', bgOpacity: 1, size: Math.min(base.size, 14), color: '#222222' } : {}),
        });
        st.setTool('select');
        st.setSelection([ann.id]);
        this.startEdit(ann.id, true, true);
        return;
      }
      case 'rect': case 'ellipse':
        ann = st.addAnnot({ type: tool, page: d.page, ...(d.moved && w > 3 && hh > 3 ? { x, y, w, h: hh } : { x: s.x - 60, y: s.y - 40, w: 120, h: 80 }), ...o.shape });
        break;
      case 'line': case 'arrow':
        if (!d.moved) { st.undoStack.pop(); return; }
        {
          let { x: x2, y: y2 } = c;
          if (e.shiftKey) { const ang = Math.round(Math.atan2(y2 - s.y, x2 - s.x) / (Math.PI / 4)) * (Math.PI / 4); const len = Math.hypot(x2 - s.x, y2 - s.y); x2 = s.x + len * Math.cos(ang); y2 = s.y + len * Math.sin(ang); }
          ann = st.addAnnot({ type: tool, page: d.page, x1: s.x, y1: s.y, x2, y2, ...o.line });
        }
        break;
      case 'ink':
        if (d.points.length < 2 && !d.moved) { d.points.push([s.x + 0.1, s.y]); }
        ann = st.addAnnot({ type: 'ink', page: d.page, points: d.points, ...o.ink }, { select: false });
        break;
      case 'whiteout':
        ann = st.addAnnot({ type: 'whiteout', page: d.page, ...(d.moved && w > 3 ? { x, y, w, h: hh } : { x: s.x - 50, y: s.y - 10, w: 100, h: 20 }), color: o.whiteout.color });
        break;
      case 'redact':
        ann = st.addAnnot({ type: 'redact', page: d.page, ...(d.moved && w > 3 ? { x, y, w, h: hh } : { x: s.x - 50, y: s.y - 10, w: 100, h: 20 }) });
        break;
      case 'link':
        ann = st.addAnnot({ type: 'link', page: d.page, ...(d.moved && w > 3 ? { x, y, w, h: hh } : { x: s.x - 60, y: s.y - 12, w: 120, h: 24 }), url: o.link.url });
        break;
      case 'highlightbox':
        ann = st.addAnnot({ type: d.hlType || 'highlight', page: d.page, rects: [d.moved ? { x, y, w, h: hh } : { x: s.x - 40, y: s.y - 7, w: 80, h: 14 }], ...o[d.hlType || 'highlight'] });
        break;
      case 'stamp': {
        const sw = d.moved && w > 20 ? w : 190, sh = d.moved && hh > 12 ? hh : 56;
        ann = st.addAnnot({ type: 'stamp', page: d.page, x: d.moved ? x : s.x - sw / 2, y: d.moved ? y : s.y - sh / 2, w: sw, h: sh, rot: d.moved ? 0 : -8, ...o.stamp });
        break;
      }
      case 'mark': {
        const sz = d.moved && Math.max(w, hh) > 12 ? Math.max(w, hh) : 26;
        ann = st.addAnnot({ type: 'mark', page: d.page, x: d.moved ? x : s.x - sz / 2, y: d.moved ? y : s.y - sz / 2, w: sz, h: sz, ...o.mark });
        break;
      }
      case 'image': case 'sign': {
        const pl = this.state.placing;
        if (!pl) { st.undoStack.pop(); return; }
        const aspect = pl.w / pl.h;
        let bw, bh;
        if (d.moved && w > 12) { bw = w; bh = bw / aspect; } else { bw = Math.min(pl.defaultW || 200, pageW * 0.6); bh = bw / aspect; }
        const px = d.moved ? x : s.x - bw / 2, py = d.moved ? y : s.y - bh / 2;
        ann = st.addAnnot({ type: 'image', page: d.page, x: px, y: py, w: bw, h: bh, assetId: pl.assetId, sig: tool === 'sign' });
        st.placing = null;
        break;
      }
      default: break;
    }
    if (!ann) { st.undoStack.pop(); return; }
    const keep = ['ink', 'whiteout', 'redact', 'highlightbox'].includes(tool);
    if (!keep) st.setTool('select');
    if (ann && !keep) st.setSelection([ann.id]);
  }

  /* ---------- édition de texte en place ---------- */
  onDblClick(e) {
    const an = e.target.closest('.an-text');
    if (an && this.state.tool === 'select') {
      this.state.setSelection([an.dataset.id]);
      this.startEdit(an.dataset.id);
    }
  }

  startEdit(id, selectAll = false, isNew = false) {
    const st = this.state;
    const a = st.getAnnot(id);
    if (!a || a.type !== 'text') return;
    const els = this.els.get(id);
    const el = els?.find((e) => e.classList.contains('an-text'));
    if (!el) return;
    if (this.editing) this.endEdit();
    this.editing = { id, el, before: a.text, checkpointed: isNew, isNew };
    el.classList.add('editing');
    el.contentEditable = 'plaintext-only';
    if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
    el.textContent = a.text;
    el.focus({ preventScroll: true });
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    if (!selectAll) range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    el.oninput = () => {
      if (!this.editing.checkpointed) { st.checkpoint(); this.editing.checkpointed = true; }
      a.text = el.innerText.replace(/\n$/, '');
      this.editing.typed = true;
      this.measure(a, el);
      st.dirty = true;
      this.updateFrame();
      st.emit('textinput', a);
    };
    el.onpaste = (ev) => {
      ev.preventDefault();
      const txt = (ev.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, txt);
    };
    el.onkeydown = (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); this.endEdit(); }
      ev.stopPropagation();
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'enter') { ev.preventDefault(); this.endEdit(); }
    };
    el.onblur = () => setTimeout(() => { if (this.editing?.el === el) this.endEdit(); }, 0);
    st.emit('editstart', a);
  }

  endEdit() {
    const e = this.editing;
    if (!e) return;
    this.editing = null;
    const st = this.state;
    const a = st.getAnnot(e.id);
    e.el.contentEditable = 'false';
    e.el.classList.remove('editing');
    e.el.oninput = e.el.onblur = e.el.onkeydown = e.el.onpaste = null;
    window.getSelection()?.removeAllRanges();
    if (a) {
      a.text = e.el.innerText.replace(/\n$/, '');
      if (!a.text.trim() && !(a.covers && a.covers.length)) { if (e.isNew && !e.typed) st.undoStack.pop(); st.removeAnnots([a.id]); st.emit('history'); }
      else { this.refresh(a); this.measure(a, this.els.get(a.id).find((x) => x.classList.contains('an-text'))); st.emit('annots', { pages: [a.page], ids: [a.id] }); }
    }
    st.emit('editend');
  }
}

// outils qui utilisent le calque de capture (création par clic / glisser)
export const HL_TOOLS = new Set(['highlight', 'underline', 'strike']);
export const CREATE_TOOLS = new Set(['text', 'note', 'rect', 'ellipse', 'line', 'arrow', 'ink', 'whiteout', 'redact', 'link', 'stamp', 'mark', 'image', 'sign', 'highlightbox']);
