// Outils basés sur une grille de vignettes : organiser, extraire, supprimer, pivoter.
import { h, uid, formatBytes, downloadBlob, parsePageRanges, baseName } from '../lib/utils.js';
import { icon } from '../ui/icons.js';
import { t, pagesLabel } from '../i18n.js';
import { makeDropzone, loadPdfFile } from '../lib/ingest.js';
import { openPdf } from '../lib/pdfjs.js';
import { renderThumb, lazy } from '../lib/thumbs.js';
import { applyPageLayout, extractPages, deletePages, rotatePages, splitGroups } from '../lib/pdf-ops.js';
import { progressModal } from '../ui/modal.js';
import { toastError, toast } from '../ui/toast.js';
import { setPending, takePending } from '../lib/session.js';
import { navigate } from '../ui/chrome.js';
import { ui } from './framework.js';

function gridTool(cfg) {
  return {
    mount(host) {
      let doc = null, pdf = null, pages = [];
      let lastClick = -1;
      const thumbCache = new Map();
      const cloneCanvas = (c) => {
        const n = document.createElement('canvas');
        n.width = c.width; n.height = c.height;
        n.style.width = c.style.width; n.style.height = c.style.height;
        n.getContext('2d').drawImage(c, 0, 0);
        return n;
      };

      async function load(files) {
        const d = await loadPdfFile(files[0]);
        if (!d) return;
        doc = d;
        pdf?.destroy();
        thumbCache.clear();
        pdf = await openPdf(d.bytes);
        pages = Array.from({ length: d.pages }, (_, i) => ({ id: uid(), src: i, rotate: 0, selected: cfg.selectAll ?? false, removed: false }));
        render();
      }

      function newBlank(after) {
        const ref = pages[Math.max(0, Math.min(after, pages.length - 1))];
        pages.splice(after + 1, 0, { id: uid(), blank: true, src: ref?.src ?? 0, rotate: 0, selected: false });
      }

      function pageCard(p, idx) {
        const thumb = h('div', { class: 'pg-thumb' });
        if (p.blank) thumb.append(h('span', {}, t('Page blanche')));
        else {
          lazy(thumb, async () => {
            try {
              if (!thumbCache.has(p.src)) thumbCache.set(p.src, renderThumb(pdf, p.src + 1, 150));
              const c = cloneCanvas(await thumbCache.get(p.src));
              thumb.replaceChildren(c);
              applyRot(thumb, p);
            } catch { /* ignoré */ }
          });
        }
        const tools = h('div', { class: 'pg-tools' },
          h('span', {}, cfg.rotate ? h('button', { title: t('Pivoter à gauche'), onclick: (e) => { e.stopPropagation(); p.rotate = (p.rotate + 270) % 360; render(true); } }, icon('rotateL', 14)) : null),
          h('span', { style: { display: 'flex', gap: '4px' } },
            cfg.rotate ? h('button', { title: t('Pivoter à droite'), onclick: (e) => { e.stopPropagation(); p.rotate = (p.rotate + 90) % 360; render(true); } }, icon('rotate', 14)) : null,
            cfg.duplicate ? h('button', { title: t('Dupliquer'), onclick: (e) => { e.stopPropagation(); pages.splice(idx + 1, 0, { ...p, id: uid(), selected: false }); render(true); } }, icon('copy', 14)) : null,
            cfg.blank ? h('button', { title: t('Insérer une page blanche après'), onclick: (e) => { e.stopPropagation(); newBlank(idx); render(true); } }, icon('plus', 14)) : null,
            cfg.remove ? h('button', { title: t('Supprimer'), onclick: (e) => { e.stopPropagation(); pages.splice(idx, 1); render(true); } }, icon('trash', 14)) : null));
        const card = h('div', { class: `pg ${p.selected ? 'sel' : ''} ${p.blank ? 'blank' : ''}`, draggable: !!cfg.reorder, dataset: { id: p.id } },
          thumb, tools, h('div', { class: 'check-mark' }, icon('check', 14)),
          h('div', { class: 'pg-num' }, p.blank ? '＋' : `${p.src + 1}`));
        card.addEventListener('click', (e) => {
          if (!cfg.select) return;
          if (e.shiftKey && lastClick >= 0) {
            const [a, b] = [Math.min(lastClick, idx), Math.max(lastClick, idx)];
            for (let i = a; i <= b; i++) pages[i].selected = true;
          } else p.selected = !p.selected;
          lastClick = idx;
          render(true);
        });
        if (cfg.reorder) {
          card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', p.id); card.classList.add('dragging'); });
          card.addEventListener('dragend', () => card.classList.remove('dragging'));
          card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drop-before'); });
          card.addEventListener('dragleave', () => card.classList.remove('drop-before'));
          card.addEventListener('drop', (e) => {
            e.preventDefault(); card.classList.remove('drop-before');
            const from = e.dataTransfer.getData('text/plain');
            const a = pages.findIndex((x) => x.id === from), b = pages.findIndex((x) => x.id === p.id);
            if (a < 0 || a === b) return;
            const [m] = pages.splice(a, 1);
            pages.splice(b, 0, m);
            render(true);
          });
        }
        return card;
      }

      function applyRot(thumb, p) {
        const c = thumb.firstChild;
        if (c?.tagName !== 'CANVAS') return;
        const odd = p.rotate % 180 !== 0;
        const k = odd ? Math.min(1, parseFloat(c.style.width) / parseFloat(c.style.height)) : 1;
        c.style.transform = `rotate(${p.rotate}deg) scale(${k})`;
      }

      const selected = () => pages.filter((p) => p.selected);

      async function save() {
        const pm = progressModal(t('Création du PDF…'));
        try {
          const out = await cfg.save({ doc, pages, selected: selected(), pm, extra: extraState() });
          pm.close();
          done(out);
        } catch (e) { pm.close(); console.error(e); toastError(e.message || String(e)); }
      }

      let extraCtl = null;
      const extraState = () => extraCtl?.get?.() ?? {};

      function done(out) {
        host.replaceChildren();
        const acts = h('div', { class: 'actions' });
        if (out.outputs.length === 1) {
          acts.append(h('button', { class: 'btn btn-primary btn-lg', onclick: () => downloadBlob(new Blob([out.outputs[0].data], { type: 'application/pdf' }), out.outputs[0].name) }, icon('download', 20), t('Télécharger')));
          acts.append(h('button', { class: 'btn btn-lg', onclick: () => { setPending({ name: out.outputs[0].name, bytes: out.outputs[0].data, pages: 0, size: out.outputs[0].data.length }); navigate('/editor'); } }, icon('pen', 18), t('Ouvrir dans l’éditeur')));
        } else {
          acts.append(h('button', {
            class: 'btn btn-primary btn-lg', onclick: async () => {
              const { default: JSZip } = await import('jszip');
              const z = new JSZip();
              out.outputs.forEach((o) => z.file(o.name, o.data));
              downloadBlob(await z.generateAsync({ type: 'blob' }), `${baseName(doc.name)}-pages.zip`);
            },
          }, icon('download', 20), t('Tout télécharger (ZIP)')));
        }
        acts.append(h('button', { class: 'btn btn-lg btn-ghost', onclick: () => { doc = null; render(); } }, icon('plus', 18), t('Nouvelle opération')));
        host.append(h('div', { class: 'panel result' }, h('div', { class: 'ok-ic' }, icon('check', 36)), h('h2', {}, out.title), h('div', { class: 'stats' }, out.stats.map((s) => h('div', { class: 'stat' }, h('b', {}, s.value), h('span', {}, s.label)))), acts));
      }

      function render(keepScroll) {
        const y = window.scrollY;
        host.replaceChildren();
        if (!doc) {
          host.append(makeDropzone({ accept: 'pdf', multiple: false, onFiles: load, title: t('Glissez votre PDF ici'), icon: h('div', { class: 'big-ic' }, icon('upload', 28)) }));
          return;
        }
        const sel = selected().length;
        const bar = h('div', { class: 'page-sel-bar' });
        if (cfg.select) {
          bar.append(
            h('button', { class: 'btn btn-sm', onclick: () => { pages.forEach((p) => { p.selected = true; }); render(true); } }, t('Tout sélectionner')),
            h('button', { class: 'btn btn-sm', onclick: () => { pages.forEach((p) => { p.selected = false; }); render(true); } }, t('Tout désélectionner')),
            h('button', { class: 'btn btn-sm', onclick: () => { pages.forEach((p) => { p.selected = !p.selected; }); render(true); } }, t('Inverser')));
          const rangeIn = h('input', { class: 'input sm', placeholder: t('ex. 1-3, 5'), style: { width: '120px' } });
          rangeIn.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            try {
              const idx = new Set(parsePageRanges(rangeIn.value, doc.pages));
              pages.forEach((p) => { if (!p.blank) p.selected = idx.has(p.src); });
              render(true);
            } catch (err) { toastError(err.message); }
          });
          bar.append(rangeIn);
        }
        if (cfg.rotate) {
          const rot = (d) => { const target = sel ? selected() : pages; target.forEach((p) => { p.rotate = (p.rotate + d + 360) % 360; }); render(true); };
          bar.append(
            h('button', { class: 'btn btn-sm', onclick: () => rot(270) }, icon('rotateL', 15), t('Gauche')),
            h('button', { class: 'btn btn-sm', onclick: () => rot(90) }, icon('rotate', 15), t('Droite')),
            h('button', { class: 'btn btn-sm', onclick: () => rot(180) }, '180°'));
        }
        if (cfg.remove && cfg.select) bar.append(h('button', { class: 'btn btn-sm btn-danger', disabled: !sel, onclick: () => { pages = pages.filter((p) => !p.selected); render(true); } }, icon('trash', 15), t('Supprimer la sélection')));
        if (cfg.blank) bar.append(h('button', { class: 'btn btn-sm', onclick: () => { newBlank(pages.length - 1); render(true); } }, icon('plus', 15), t('Page blanche à la fin')));
        bar.append(h('span', { class: 'spacer' }), h('span', { class: 'muted' }, `${pagesLabel(pages.length)} · ${sel} ${t('sélectionnée(s)')}`));
        extraCtl = cfg.extra?.({ doc, pages, selected }) || null;
        const grid = h('div', { class: 'page-grid' }, pages.map(pageCard));
        const side = h('div', {},
          h('div', { class: 'panel' }, h('h3', {}, doc.name), h('p', { class: 'muted' }, `${pagesLabel(doc.pages)} · ${formatBytes(doc.size)}`),
            cfg.hint ? ui.note(t(cfg.hint)) : null, extraCtl ? extraCtl.el : null,
            h('button', { class: 'btn btn-primary btn-lg run-btn', onclick: save }, icon(cfg.icon || 'save', 18), t(cfg.saveLabel))),
          h('div', { style: { height: '10px' } }),
          h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { doc = null; pdf?.destroy(); render(); } }, icon('x', 15), t('Changer de fichier')));
        host.append(h('div', { class: 'tool-layout' }, h('div', {}, bar, grid), side));
        if (keepScroll) window.scrollTo(0, y);
      }

      render();
      const pend = takePending();
      if (pend) {
        doc = { ...pend, pages: 0 };
        openPdf(pend.bytes).then((p) => { pdf = p; doc.pages = p.numPages; pages = Array.from({ length: p.numPages }, (_, i) => ({ id: uid(), src: i, rotate: 0, selected: cfg.selectAll ?? false, removed: false })); render(); });
      }
      return () => pdf?.destroy();
    },
  };
}

const fileName = (doc, suffix) => `${baseName(doc.name)}-${suffix}.pdf`;

export const organize = gridTool({
  reorder: true, rotate: true, duplicate: true, blank: true, remove: true, select: true,
  saveLabel: 'Enregistrer le nouvel ordre', icon: 'save',
  hint: 'Glissez les pages pour les réordonner. Survolez une page pour pivoter, dupliquer, ajouter une page blanche ou supprimer.',
  async save({ doc, pages, pm }) {
    if (!pages.length) throw new Error(t('Le document doit contenir au moins une page.'));
    pm.set(0.2);
    const layout = pages.map((p) => (p.blank ? { blank: true, like: p.src } : { src: p.src, rotate: p.rotate }));
    const bytes = await applyPageLayout(doc.bytes, layout);
    return { title: t('Document réorganisé !'), outputs: [{ name: fileName(doc, 'organisé'), data: bytes }], stats: [{ label: t('Pages'), value: String(pages.length) }] };
  },
});

export const extract = gridTool({
  select: true, icon: 'files', saveLabel: 'Extraire les pages sélectionnées',
  hint: 'Cliquez sur les pages à extraire (Maj + clic pour une plage, ou saisissez une plage puis Entrée).',
  extra: () => {
    const sep = ui.check(t('Un PDF par page sélectionnée'), false);
    return { el: sep.el, get: () => ({ separate: sep.input.checked }) };
  },
  async save({ doc, selected, pm, extra }) {
    if (!selected.length) throw new Error(t('Sélectionnez au moins une page.'));
    const idx = selected.map((p) => p.src);
    if (extra.separate) {
      const parts = await splitGroups(doc.bytes, idx.map((i) => [i]));
      return { title: t('Pages extraites !'), outputs: parts.map((p) => ({ name: fileName(doc, `page-${p.indices[0] + 1}`), data: p.bytes })), stats: [{ label: t('Fichiers'), value: String(parts.length) }] };
    }
    const bytes = await extractPages(doc.bytes, idx);
    return { title: t('Pages extraites !'), outputs: [{ name: fileName(doc, 'extrait'), data: bytes }], stats: [{ label: t('Pages'), value: String(idx.length) }] };
  },
});

export const remove = gridTool({
  select: true, remove: false, icon: 'trash', saveLabel: 'Supprimer les pages sélectionnées',
  hint: 'Cliquez sur les pages à supprimer du document.',
  async save({ doc, selected }) {
    if (!selected.length) throw new Error(t('Sélectionnez au moins une page à supprimer.'));
    const bytes = await deletePages(doc.bytes, selected.map((p) => p.src));
    return { title: t('Pages supprimées !'), outputs: [{ name: fileName(doc, 'allégé'), data: bytes }], stats: [{ label: t('Pages restantes'), value: String(doc.pages - selected.length) }] };
  },
});

export const rotate = gridTool({
  select: true, rotate: true, icon: 'rotate', saveLabel: 'Enregistrer les rotations',
  hint: 'Sans sélection, les boutons agissent sur toutes les pages. Sinon uniquement sur les pages sélectionnées.',
  async save({ doc, pages }) {
    const layout = pages.map((p) => ({ src: p.src, rotate: p.rotate }));
    const bytes = await applyPageLayout(doc.bytes, layout);
    return { title: t('Pages pivotées !'), outputs: [{ name: fileName(doc, 'pivoté'), data: bytes }], stats: [{ label: t('Pages modifiées'), value: String(pages.filter((p) => p.rotate).length) }] };
  },
});
