// Barre latérale : miniatures des pages avec actions (pivoter, dupliquer, supprimer, déplacer, insérer).
import { h } from '../lib/utils.js';
import { icon } from '../ui/icons.js';
import { t } from '../i18n.js';
import { renderThumb, lazy } from '../lib/thumbs.js';
import * as ops from './pageops.js';
import { toastError } from '../ui/toast.js';
import { confirmDialog } from '../ui/modal.js';

export class Sidebar {
  constructor(state, host, viewer) {
    this.state = state;
    this.host = host;
    this.viewer = viewer;
    this.list = h('div', { class: 'thumbs' });
    this.thumbs = [];
    host.append(this.list);
    state.on('doc', () => this.rebuild());
    state.on('page', (i) => this.highlight(i));
  }

  async run(fn) {
    if (this.busy) return;
    this.busy = true;
    this.host.classList.add('busy');
    try { await fn(); } catch (e) { console.error(e); toastError(e.message || String(e)); } finally { this.busy = false; this.host.classList.remove('busy'); }
  }

  rebuild() {
    const st = this.state;
    this.list.replaceChildren();
    this.thumbs = [];
    const pdf = st.pdf;
    const ver = st.version;
    st.pages.forEach((p, i) => {
      const box = h('div', { class: 'thumb-img' }, h('div', { class: 'thumb-ph', style: { aspectRatio: `${p.w}/${p.h}` } }));
      lazy(box, async () => {
        try {
          const c = await renderThumb(pdf, i + 1, 124);
          if (this.state.version !== ver) return;
          box.replaceChildren(c);
        } catch { /* document remplacé */ }
      }, this.host);
      const btn = (ic, title, fn, cls = '') => h('button', { class: `tb ${cls}`, title, onclick: (e) => { e.stopPropagation(); this.run(fn); } }, icon(ic, 13));
      const item = h('div', { class: `thumb ${i === st.currentPage ? 'cur' : ''}`, draggable: 'true', dataset: { i } },
        box,
        h('div', { class: 'thumb-num' }, String(i + 1)),
        h('div', { class: 'thumb-actions' },
          btn('rotateL', t('Pivoter à gauche'), () => ops.rotatePage(st, i, 270)),
          btn('rotate', t('Pivoter à droite'), () => ops.rotatePage(st, i, 90)),
          btn('copy', t('Dupliquer'), () => ops.duplicatePage(st, i)),
          btn('plus', t('Insérer une page blanche après'), () => ops.insertBlank(st, i + 1)),
          btn('trash', t('Supprimer'), async () => {
            if (st.pages.length < 2) throw new Error(t('Impossible de supprimer la dernière page.'));
            if (await confirmDialog({ title: t('Supprimer la page {n} ?', { n: i + 1 }), message: t('La page et ses annotations seront retirées (annulable).'), okLabel: t('Supprimer'), danger: true })) await ops.deletePage(st, [i]);
          }, 'danger')));
      item.addEventListener('click', () => this.viewer.scrollToPage(i, true));
      item.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-page', String(i)); item.classList.add('dragging'); });
      item.addEventListener('dragend', () => item.classList.remove('dragging'));
      item.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-page')) { e.preventDefault(); item.classList.add('over'); } });
      item.addEventListener('dragleave', () => item.classList.remove('over'));
      item.addEventListener('drop', (e) => {
        item.classList.remove('over');
        const from = e.dataTransfer.getData('text/x-page');
        if (from === '') return;
        e.preventDefault();
        const f = +from;
        if (f !== i) this.run(() => ops.movePage(st, f, i));
      });
      this.list.append(item);
      this.thumbs.push(item);
    });
  }

  highlight(i) {
    this.thumbs.forEach((el, k) => el.classList.toggle('cur', k === i));
    const cur = this.thumbs[i];
    if (cur) {
      const r = cur.getBoundingClientRect(), hr = this.host.getBoundingClientRect();
      if (r.top < hr.top || r.bottom > hr.bottom) cur.scrollIntoView({ block: 'nearest' });
    }
  }
}
