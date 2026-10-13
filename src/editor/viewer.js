// Visionneuse : pages empilées, rendu paresseux (canvas + calque de texte), zoom.
import { h, clamp, debounce } from '../lib/utils.js';
import { pdfjs } from '../lib/pdfjs.js';

const MAX_PIXELS = 24e6;

export class Viewer {
  constructor(state, scroller) {
    this.state = state;
    this.scroller = scroller;
    this.root = h('div', { class: 'pages' });
    scroller.append(this.root);
    this.wraps = [];
    this.rendered = new Map(); // i -> {zoom, version}
    this.renderQueue = Promise.resolve();
    this.jobId = 0;
    this.io = null;
    this.visible = new Set();
    this.listeners = new Set();
    this.rerenderDebounced = debounce(() => this.refreshVisible(true), 140);
    scroller.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.scrollRAF = 0;
    this.fitMode = true;
    this.onResize = debounce(() => { if (this.fitMode && this.state.pages.length) this.fitWidth(); }, 150);
    window.addEventListener('resize', this.onResize);
  }

  onPageDom(fn) { this.listeners.add(fn); }

  rebuild() {
    this.jobId++;
    this.io?.disconnect();
    this.root.replaceChildren();
    this.wraps = [];
    this.rendered.clear();
    this.visible.clear();
    const { pages } = this.state;
    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const i = +e.target.dataset.page;
        if (e.isIntersecting) this.visible.add(i); else this.visible.delete(i);
      }
      this.refreshVisible();
    }, { root: this.scroller, rootMargin: '700px 0px' });
    pages.forEach((p, i) => {
      const canvas = h('canvas', { class: 'pg-canvas' });
      const textLayer = h('div', { class: 'textLayer' });
      const findLayer = h('div', { class: 'find-layer' });
      const annotLayer = h('div', { class: 'annot-layer' });
      const formLayer = h('div', { class: 'form-layer' });
      const capture = h('div', { class: 'capture' });
      const inner = h('div', { class: 'page-inner', style: { width: `${p.w}px`, height: `${p.h}px` } }, canvas, textLayer, findLayer, annotLayer, formLayer, capture);
      const wrap = h('div', { class: 'page-wrap', dataset: { page: i } }, inner, h('div', { class: 'page-label' }, `${i + 1}`));
      this.root.append(wrap);
      this.wraps.push({ wrap, inner, canvas, textLayer, findLayer, annotLayer, formLayer, capture });
      this.io.observe(wrap);
    });
    this.applyZoom();
    this.listeners.forEach((fn) => fn());
  }

  dom(i) { return this.wraps[i]; }

  applyZoom() {
    const z = this.state.zoom;
    this.state.pages.forEach((p, i) => {
      const d = this.wraps[i];
      if (!d) return;
      d.wrap.style.width = `${p.w * z}px`;
      d.wrap.style.height = `${p.h * z}px`;
      d.inner.style.transform = `scale(${z})`;
    });
  }

  setZoom(z, anchor) {
    const old = this.state.zoom;
    z = clamp(z, 0.25, 5);
    this.fitMode = false;
    if (Math.abs(z - old) < 0.001) return;
    const sc = this.scroller;
    const cx = anchor?.x ?? sc.clientWidth / 2, cy = anchor?.y ?? sc.clientHeight / 2;
    const px = (sc.scrollLeft + cx) / old, py = (sc.scrollTop + cy) / old;
    this.state.zoom = z;
    this.applyZoom();
    sc.scrollLeft = px * z - cx;
    sc.scrollTop = py * z - cy;
    this.state.emit('zoom', z);
    this.rerenderDebounced();
  }

  fitWidth() {
    const maxW = Math.max(...this.state.pages.map((p) => p.w));
    const avail = this.scroller.clientWidth - 48;
    this.setZoomAbs(clamp(avail / maxW, 0.3, 3));
    this.fitMode = true;
  }

  fitPage() {
    const p = this.state.pages[this.state.currentPage] || this.state.pages[0];
    const z = Math.min((this.scroller.clientWidth - 48) / p.w, (this.scroller.clientHeight - 32) / p.h);
    this.setZoomAbs(clamp(z, 0.25, 3));
  }

  setZoomAbs(z) {
    const old = this.state.zoom;
    this.state.zoom = z;
    this.applyZoom();
    this.state.emit('zoom', z);
    if (Math.abs(old - z) > 0.001) this.rerenderDebounced();
    else this.refreshVisible();
  }

  scrollToPage(i, smooth = false) {
    const d = this.wraps[i];
    if (!d) return;
    this.scroller.scrollTo({ top: d.wrap.offsetTop - 16, behavior: smooth ? 'smooth' : 'auto' });
  }

  onScroll() {
    if (this.scrollRAF) return;
    this.scrollRAF = requestAnimationFrame(() => {
      this.scrollRAF = 0;
      const mid = this.scroller.scrollTop + this.scroller.clientHeight / 3;
      let cur = 0;
      for (let i = 0; i < this.wraps.length; i++) {
        if (this.wraps[i].wrap.offsetTop <= mid) cur = i; else break;
      }
      if (cur !== this.state.currentPage) {
        this.state.currentPage = cur;
        this.state.emit('page', cur);
      }
    });
  }

  refreshVisible(force = false) {
    const need = [...this.visible].sort((a, b) => a - b);
    for (const i of need) {
      const r = this.rendered.get(i);
      if (force || !r || r.zoom !== this.state.zoom || r.version !== this.state.version) this.queueRender(i);
    }
    // libère les canvas éloignés
    for (const [i] of this.rendered) {
      if (!this.visible.has(i) && (need.length === 0 || Math.min(...need.map((n) => Math.abs(n - i))) > 6)) {
        const d = this.wraps[i];
        if (d) { d.canvas.width = 0; d.canvas.height = 0; d.textLayer.replaceChildren(); }
        this.rendered.delete(i);
      }
    }
  }

  rerenderAll() { this.rendered.clear(); this.refreshVisible(true); }

  queueRender(i) {
    const job = this.jobId;
    const key = { zoom: this.state.zoom, version: this.state.version };
    this.rendered.set(i, key);
    this.renderQueue = this.renderQueue.then(() => (job === this.jobId ? this.renderPage(i, job, key) : null)).catch((e) => { if (e?.name !== 'RenderingCancelledException') console.error('rendu', e); });
  }

  async renderPage(i, job, key) {
    if (job !== this.jobId || !this.visible.has(i) && Math.abs(i - this.state.currentPage) > 2) return;
    const cur = this.rendered.get(i);
    if (!cur || cur !== key) return; // une demande plus récente existe
    const d = this.wraps[i];
    if (!d) return;
    const pdf = this.state.pdf;
    const page = await pdf.getPage(i + 1);
    if (job !== this.jobId) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let scale = this.state.zoom * dpr;
    const base = page.getViewport({ scale: 1 });
    if (base.width * base.height * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (base.width * base.height));
    const viewport = page.getViewport({ scale });
    // rendu hors écran puis copie (évite le scintillement)
    const off = document.createElement('canvas');
    off.width = Math.floor(viewport.width);
    off.height = Math.floor(viewport.height);
    const ctx = off.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, off.width, off.height);
    await page.render({ canvasContext: ctx, canvas: off, viewport }).promise;
    if (job !== this.jobId || this.rendered.get(i) !== key) return;
    d.canvas.width = off.width;
    d.canvas.height = off.height;
    d.canvas.style.width = `${base.width}px`;
    d.canvas.style.height = `${base.height}px`;
    d.canvas.getContext('2d').drawImage(off, 0, 0);
    off.width = off.height = 0;
    d.inner.classList.add('rendered');
    // calque de texte
    d.textLayer.replaceChildren();
    d.textLayer.style.setProperty('--total-scale-factor', '1');
    try {
      const tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: d.textLayer, viewport: page.getViewport({ scale: 1 }) });
      await tl.render();
    } catch (e) { console.warn('textLayer', e); }
    page.cleanup();
    this.state.emit('pageRendered', i);
  }

  /** Coordonnées client -> {page, x, y} en points (ou null) */
  pointToPage(clientX, clientY, forcePage = null) {
    for (let i = 0; i < this.wraps.length; i++) {
      if (forcePage !== null && forcePage !== i) continue;
      const r = this.wraps[i].inner.getBoundingClientRect();
      const z = this.state.zoom;
      if (forcePage !== null || (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom)) {
        return { page: i, x: (clientX - r.left) / z, y: (clientY - r.top) / z };
      }
    }
    return null;
  }

  destroy() { this.io?.disconnect(); this.jobId++; window.removeEventListener('resize', this.onResize); }
}
