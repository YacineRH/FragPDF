// Recherche de texte dans le document avec surlignage des occurrences.
import { h } from '../lib/utils.js';
import { icon } from '../ui/icons.js';
import { t } from '../i18n.js';
import { pdfjs } from '../lib/pdfjs.js';

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export class FindBar {
  constructor(state, viewer, host) {
    this.state = state;
    this.viewer = viewer;
    this.texts = new Map(); // page -> {version, items}
    this.matches = [];
    this.cur = -1;
    this.input = h('input', { class: 'input sm', type: 'search', placeholder: t('Rechercher dans le document…'), 'aria-label': t('Rechercher') });
    this.count = h('span', { class: 'find-count muted' }, '');
    this.el = h('div', { class: 'findbar', hidden: true },
      icon('search', 16), this.input, this.count,
      h('button', { class: 'icon-btn', title: t('Précédent'), onclick: () => this.step(-1) }, icon('chevU', 16)),
      h('button', { class: 'icon-btn', title: t('Suivant'), onclick: () => this.step(1) }, icon('chevD', 16)),
      h('button', { class: 'icon-btn', title: t('Fermer'), onclick: () => this.close() }, icon('x', 16)));
    host.append(this.el);
    let timer;
    this.input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => this.search(), 180); });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.step(e.shiftKey ? -1 : 1); }
      if (e.key === 'Escape') { e.stopPropagation(); this.close(); }
    });
    state.on('doc', () => { this.texts.clear(); this.matches = []; this.clear(); if (!this.el.hidden && this.input.value) this.search(); });
    state.on('pageRendered', () => this.paint());
  }

  open() {
    this.el.hidden = false;
    this.input.focus();
    this.input.select();
  }

  close() {
    this.el.hidden = true;
    this.clear();
    this.matches = [];
  }

  clear() { this.viewer.wraps.forEach((d) => d.findLayer.replaceChildren()); }

  async pageItems(i) {
    const c = this.texts.get(i);
    if (c && c.version === this.state.version) return c.items;
    const page = await this.state.pdf.getPage(i + 1);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = tc.items.filter((it) => it.str).map((it) => {
      const tr = pdfjs.Util.transform(vp.transform, it.transform);
      const fs = Math.hypot(tr[2], tr[3]);
      return { str: it.str, x: tr[4], y: tr[5] - fs * 0.9, w: it.width, h: fs * 1.15 };
    });
    page.cleanup();
    this.texts.set(i, { version: this.state.version, items });
    return items;
  }

  async search() {
    const q = norm(this.input.value.trim());
    this.matches = [];
    this.cur = -1;
    if (!q) { this.clear(); this.count.textContent = ''; return; }
    const n = this.state.pages.length;
    for (let i = 0; i < n; i++) {
      const items = await this.pageItems(i);
      for (const it of items) {
        const s = norm(it.str);
        let from = 0;
        for (;;) {
          const k = s.indexOf(q, from);
          if (k < 0) break;
          const len = Math.max(1, it.str.length);
          this.matches.push({ page: i, x: it.x + (it.w * k) / len, y: it.y, w: Math.max((it.w * q.length) / len, 4), h: it.h });
          from = k + q.length;
        }
      }
    }
    this.count.textContent = this.matches.length ? `0 / ${this.matches.length}` : t('Aucun résultat');
    this.paint();
    if (this.matches.length) this.step(1);
  }

  paint() {
    this.viewer.wraps.forEach((d, i) => {
      d.findLayer.replaceChildren(...this.matches.map((m, k) => (m.page === i ? h('div', { class: `find-hit ${k === this.cur ? 'cur' : ''}`, style: { left: `${m.x}px`, top: `${m.y}px`, width: `${m.w}px`, height: `${m.h}px` } }) : null)).filter(Boolean));
    });
  }

  step(dir) {
    if (!this.matches.length) return;
    this.cur = (this.cur + dir + this.matches.length) % this.matches.length;
    this.count.textContent = `${this.cur + 1} / ${this.matches.length}`;
    this.paint();
    const m = this.matches[this.cur];
    const d = this.viewer.dom(m.page);
    const z = this.state.zoom;
    const top = d.wrap.offsetTop + m.y * z - this.viewer.scroller.clientHeight / 3;
    this.viewer.scroller.scrollTo({ top, behavior: 'smooth' });
  }
}
