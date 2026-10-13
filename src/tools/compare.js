// Comparaison de deux PDF : différences visuelles page à page + différences de texte (mots ajoutés / supprimés).
import { PDFDocument } from 'pdf-lib';
import { h, formatBytes, downloadBlob, baseName, canvasToBlob } from '../lib/utils.js';
import { icon } from '../ui/icons.js';
import { t } from '../i18n.js';
import { makeDropzone, loadPdfFile, firstPageThumb } from '../lib/ingest.js';
import { openPdf, renderPageToCanvas } from '../lib/pdfjs.js';
import { groupLines } from '../lib/convert.js';
import { wordDiff } from '../lib/diff.js';
import { progressModal } from '../ui/modal.js';
import { toastError } from '../ui/toast.js';

const SCALE = 1.3;

async function pageText(page) {
  const tc = await page.getTextContent();
  return groupLines(tc.items).map((l) => l.text).join(' ').split(/\s+/).filter(Boolean);
}

export const compare = {
  mount(host) {
    const docs = { a: null, b: null };
    let pdfs = null;
    let results = []; // par page : {ratio, wordsAdded, wordsRemoved, diff}
    let cur = 0;
    let mode = 'diff';

    function slot(key, label) {
      const box = h('div', { class: 'panel cmp-slot' });
      const draw = () => {
        box.replaceChildren(h('h3', {}, label));
        const d = docs[key];
        if (!d) {
          box.append(makeDropzone({ accept: 'pdf', multiple: false, title: t('Glissez le PDF ici'), icon: h('div', { class: 'big-ic' }, icon('upload', 24)), onFiles: async (f) => { const x = await loadPdfFile(f[0]); if (x) { docs[key] = x; render(); } } }));
          return;
        }
        const th = h('div', { class: 'file-thumb', style: { width: '90px' } });
        firstPageThumb(d.bytes, 90).then((c) => c && th.replaceChildren(c));
        box.append(h('div', { style: { display: 'flex', gap: '.8rem', alignItems: 'center' } }, th, h('div', {}, h('b', {}, d.name), h('div', { class: 'muted' }, `${d.pages} p. · ${formatBytes(d.size)}`), h('button', { class: 'btn btn-sm btn-ghost', style: { marginTop: '.5rem' }, onclick: () => { docs[key] = null; results = []; render(); } }, icon('x', 14), t('Changer')))));
      };
      draw();
      return box;
    }

    async function run() {
      const pm = progressModal(t('Comparaison…'));
      try {
        pdfs = [await openPdf(docs.a.bytes), await openPdf(docs.b.bytes)];
        const n = Math.max(pdfs[0].numPages, pdfs[1].numPages);
        results = [];
        for (let i = 1; i <= n; i++) {
          pm.set(i / n, `${t('Page')} ${i} / ${n}`);
          const pa = i <= pdfs[0].numPages ? await pdfs[0].getPage(i) : null;
          const pb = i <= pdfs[1].numPages ? await pdfs[1].getPage(i) : null;
          const r = { page: i, onlyA: !pb, onlyB: !pa };
          if (pa && pb) {
            const ca = await renderPageToCanvas(pa, SCALE);
            const cb = document.createElement('canvas');
            cb.width = ca.width; cb.height = ca.height;
            const bctx = cb.getContext('2d', { alpha: false });
            bctx.fillStyle = '#fff'; bctx.fillRect(0, 0, cb.width, cb.height);
            const vpb = pb.getViewport({ scale: SCALE });
            const tmp = await renderPageToCanvas(pb, SCALE);
            bctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, 0, 0, Math.min(cb.width, vpb.width), Math.min(cb.height, vpb.height));
            const da = ca.getContext('2d').getImageData(0, 0, ca.width, ca.height).data;
            const db = bctx.getImageData(0, 0, cb.width, cb.height).data;
            const out = document.createElement('canvas');
            out.width = ca.width; out.height = ca.height;
            const octx = out.getContext('2d');
            const od = octx.createImageData(out.width, out.height);
            let changed = 0;
            for (let p = 0; p < da.length; p += 4) {
              const d = Math.abs(da[p] - db[p]) + Math.abs(da[p + 1] - db[p + 1]) + Math.abs(da[p + 2] - db[p + 2]);
              if (d > 90) { changed++; od.data[p] = 229; od.data[p + 1] = 56; od.data[p + 2] = 79; od.data[p + 3] = 255; }
              else { const g = 255 - (255 - (0.299 * db[p] + 0.587 * db[p + 1] + 0.114 * db[p + 2])) * 0.35; od.data[p] = od.data[p + 1] = od.data[p + 2] = g; od.data[p + 3] = 255; }
            }
            octx.putImageData(od, 0, 0);
            Object.assign(r, { ca, cb, diffCanvas: out, ratio: changed / (da.length / 4) });
            const [wa, wb] = [await pageText(pa), await pageText(pb)];
            r.words = wordDiff(wa, wb);
            r.added = r.words ? r.words.filter((x) => x[0] === '+').length : null;
            r.removed = r.words ? r.words.filter((x) => x[0] === '-').length : null;
            r.same = r.ratio < 0.0002 && !r.added && !r.removed;
          }
          pa?.cleanup(); pb?.cleanup();
          results.push(r);
        }
        cur = Math.max(0, results.findIndex((r) => !r.same));
      } catch (e) { console.error(e); toastError(e.message || String(e)); } finally { pm.close(); }
      render();
    }

    async function exportReport() {
      const doc = await PDFDocument.create();
      for (const r of results) {
        if (!r.diffCanvas) continue;
        const blob = await canvasToBlob(r.diffCanvas, 'image/jpeg', 0.85);
        const img = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
        const w = 595, hgt = (r.diffCanvas.height / r.diffCanvas.width) * 595;
        doc.addPage([w, hgt]).drawImage(img, { x: 0, y: 0, width: w, height: hgt });
      }
      downloadBlob(new Blob([await doc.save()], { type: 'application/pdf' }), `${baseName(docs.a.name)}-vs-${baseName(docs.b.name)}.pdf`);
    }

    function viewer() {
      const r = results[cur];
      const box = h('div', { class: 'panel cmp-view' });
      if (!r) return box;
      const modes = h('div', { class: 'seg' }, [['diff', t('Différences')], ['side', t('Côte à côte')], ['fade', t('Fondu')]].map(([k, l]) => h('button', { class: k === mode ? 'on' : '', onclick: () => { mode = k; render(); } }, l)));
      box.append(h('div', { style: { display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '.8rem' } }, h('h3', { style: { margin: 0 } }, `${t('Page')} ${r.page}`), modes, h('span', { class: 'spacer' }), r.onlyA || r.onlyB ? h('span', { class: 'muted' }, r.onlyA ? t('Page absente du second document') : t('Page absente du premier document')) : h('span', { class: 'muted' }, `${(r.ratio * 100).toFixed(2)} % ${t('de pixels différents')} · +${r.added ?? '?'} / −${r.removed ?? '?'} ${t('mots')}`)));
      if (r.diffCanvas) {
        const wrap = h('div', { class: 'cmp-canvas' });
        const show = (c) => { const k = document.createElement('canvas'); k.width = c.width; k.height = c.height; k.getContext('2d').drawImage(c, 0, 0); k.style.maxWidth = '100%'; return k; };
        if (mode === 'diff') wrap.append(show(r.diffCanvas));
        else if (mode === 'side') wrap.append(h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } }, h('div', {}, h('div', { class: 'muted' }, 'A'), show(r.ca)), h('div', {}, h('div', { class: 'muted' }, 'B'), show(r.cb))));
        else {
          const stack = h('div', { style: { position: 'relative', display: 'inline-block', lineHeight: 0 } }, show(r.ca));
          const top = show(r.cb); top.style.cssText = 'position:absolute;left:0;top:0;width:100%;opacity:.5';
          stack.append(top);
          const slider = h('input', { type: 'range', min: 0, max: 100, value: 50, style: { marginTop: '.6rem' } });
          slider.addEventListener('input', () => { top.style.opacity = slider.value / 100; });
          wrap.append(stack, h('div', { class: 'muted', style: { display: 'flex', justifyContent: 'space-between' } }, h('span', {}, 'A'), h('span', {}, 'B')), slider);
        }
        box.append(wrap);
      }
      if (r.words) {
        const changes = r.words.filter((x) => x[0] !== '=');
        if (changes.length) {
          const txt = h('div', { class: 'cmp-words' });
          // contexte : on n'affiche que les zones modifiées avec quelques mots autour
          const keep = new Array(r.words.length).fill(false);
          r.words.forEach((x, i) => { if (x[0] !== '=') for (let k = Math.max(0, i - 4); k <= Math.min(r.words.length - 1, i + 4); k++) keep[k] = true; });
          let gap = false;
          r.words.forEach((x, i) => {
            if (!keep[i]) { if (!gap) { txt.append(h('span', { class: 'muted' }, ' … ')); gap = true; } return; }
            gap = false;
            txt.append(x[0] === '=' ? `${x[1]} ` : h('span', { class: x[0] === '+' ? 'ins' : 'del' }, `${x[1]} `));
          });
          box.append(h('h4', { style: { margin: '1rem 0 .4rem' } }, t('Différences de texte')), txt);
        }
      }
      return box;
    }

    function render() {
      host.replaceChildren();
      const slots = h('div', { class: 'cmp-slots' }, slot('a', t('Document A (original)')), slot('b', t('Document B (modifié)')));
      host.append(slots);
      if (!docs.a || !docs.b) return;
      if (!results.length) {
        host.append(h('div', { style: { textAlign: 'center', marginTop: '1.2rem' } }, h('button', { class: 'btn btn-primary btn-lg', onclick: run }, icon('compare', 18), t('Comparer les documents'))));
        return;
      }
      const changed = results.filter((r) => !r.same).length;
      const list = h('div', { class: 'cmp-pages' }, results.map((r, i) => h('button', { class: `cmp-page ${i === cur ? 'on' : ''} ${r.same ? 'same' : 'diff'}`, onclick: () => { cur = i; render(); } }, `${r.page}`, h('i', {}, r.same ? '✓' : r.onlyA || r.onlyB ? '∅' : `${Math.max(1, Math.round(r.ratio * 1000) / 10)}%`))));
      host.append(
        h('div', { class: 'panel', style: { marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' } },
          h('div', {}, h('b', {}, changed ? t('{n} page(s) différente(s) sur {total}', { n: changed, total: results.length }) : t('Les documents sont identiques.')), h('div', { class: 'muted' }, t('Cliquez sur une page pour voir le détail.'))),
          h('span', { class: 'spacer' }), h('button', { class: 'btn', onclick: exportReport }, icon('download', 16), t('Rapport PDF'))),
        list, viewer());
    }

    render();
    return () => pdfs?.forEach((p) => p.destroy());
  },
};
