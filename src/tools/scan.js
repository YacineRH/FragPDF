// Scanner de documents : photos prises avec la caméra (ou importées) → PDF, avec amélioration (gris, noir & blanc).
import { PDFDocument } from 'pdf-lib';
import { h, uid, downloadBlob, canvasToBlob, loadImage } from '../lib/utils.js';
import { icon } from '../ui/icons.js';
import { t } from '../i18n.js';
import { PAGE_SIZES, save } from '../lib/pdf-ops.js';
import { toastError } from '../ui/toast.js';
import { progressModal } from '../ui/modal.js';
import { setPending } from '../lib/session.js';
import { navigate } from '../ui/chrome.js';

/** Applique le filtre choisi ('color' | 'gray' | 'doc' | 'bw') à un canvas (copie). */
export function applyFilter(src, filter) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0);
  if (filter === 'color') return c;
  const id = ctx.getImageData(0, 0, c.width, c.height);
  const d = id.data;
  const gray = new Uint8ClampedArray(d.length / 4);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) { const g = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0; gray[p] = g; hist[g]++; }
  const total = gray.length;
  let lo = 0, hi = 255, acc = 0;
  for (; lo < 255; lo++) { acc += hist[lo]; if (acc > total * 0.02) break; }
  acc = 0;
  for (; hi > 0; hi--) { acc += hist[hi]; if (acc > total * 0.02) break; }
  if (hi - lo < 30) { lo = 0; hi = 255; }
  // seuil d'Otsu pour le noir et blanc
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 127;
  for (let i = 0; i < 256; i++) { wB += hist[i]; if (!wB) continue; const wF = total - wB; if (!wF) break; sumB += i * hist[i]; const mB = sumB / wB, mF = (sum - sumB) / wF; const v = wB * wF * (mB - mF) ** 2; if (v > best) { best = v; thr = i; } }
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    let g = gray[p];
    if (filter === 'bw') g = g > thr * 0.92 ? 255 : 0;
    else if (filter === 'doc') g = Math.max(0, Math.min(255, ((g - lo) / (hi - lo)) * 255));
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

export const scan = {
  mount(host) {
    const pages = []; // {id, canvas}
    let filter = 'doc';
    let stream = null;
    const video = h('video', { autoplay: true, playsinline: true, muted: true, class: 'scan-video' });
    const status = h('p', { class: 'muted' }, '');
    const list = h('div', { class: 'file-list', style: { marginTop: '1rem' } });
    const fileIn = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });

    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } }, audio: false });
        video.srcObject = stream;
        status.textContent = '';
        shutter.disabled = false;
      } catch (e) {
        status.textContent = t('Caméra indisponible. Autorisez l’accès ou importez des photos.');
        shutter.disabled = true;
      }
    }
    function stopCamera() { stream?.getTracks().forEach((tr) => tr.stop()); stream = null; }

    function addCanvas(c) { pages.push({ id: uid(), canvas: c }); renderList(); }

    function capture() {
      if (!video.videoWidth) return;
      const c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      addCanvas(c);
      video.classList.add('flash');
      setTimeout(() => video.classList.remove('flash'), 150);
    }

    async function importFiles(files) {
      for (const f of files) {
        const url = URL.createObjectURL(f);
        try {
          const img = await loadImage(url);
          const k = Math.min(1, 2800 / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement('canvas');
          c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          addCanvas(c);
        } catch { toastError(t('Image illisible')); } finally { URL.revokeObjectURL(url); }
      }
    }

    async function create(openEditor) {
      if (!pages.length) { toastError(t('Prenez au moins une photo.')); return; }
      const pm = progressModal(t('Création du PDF…'));
      try {
        const doc = await PDFDocument.create();
        const [pw, ph] = PAGE_SIZES.a4;
        for (let i = 0; i < pages.length; i++) {
          pm.set(i / pages.length);
          const c = applyFilter(pages[i].canvas, filter);
          const blob = await canvasToBlob(c, 'image/jpeg', filter === 'bw' ? 0.8 : 0.86);
          const img = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
          const landscape = c.width > c.height;
          const [W, H] = landscape ? [ph, pw] : [pw, ph];
          const s = Math.min(W / img.width, H / img.height);
          doc.addPage([W, H]).drawImage(img, { x: (W - img.width * s) / 2, y: (H - img.height * s) / 2, width: img.width * s, height: img.height * s });
        }
        const bytes = await save(doc);
        if (openEditor) { setPending({ name: 'scan.pdf', bytes, pages: pages.length, size: bytes.length }); navigate('/editor'); }
        else downloadBlob(new Blob([bytes], { type: 'application/pdf' }), 'scan.pdf');
      } catch (e) { toastError(e.message || String(e)); } finally { pm.close(); }
    }

    function renderList() {
      list.replaceChildren(...pages.map((p, i) => {
        const prev = applyFilter(p.canvas, filter);
        prev.style.cssText = 'max-width:100%;max-height:100%;box-shadow:0 2px 8px rgba(0,0,0,.2);background:#fff';
        const card = h('div', { class: 'file-card', draggable: 'true' },
          h('div', { class: 'file-thumb' }, prev),
          h('div', { class: 'file-meta' }, h('div', { class: 'file-name' }, `${t('Page')} ${i + 1}`)),
          h('div', { class: 'file-actions' },
            i > 0 ? h('button', { class: 'icon-btn', title: t('Avant'), onclick: () => { [pages[i - 1], pages[i]] = [pages[i], pages[i - 1]]; renderList(); } }, icon('chevL', 14)) : null,
            h('button', { class: 'icon-btn', title: t('Pivoter à droite'), onclick: () => { const c = document.createElement('canvas'); c.width = p.canvas.height; c.height = p.canvas.width; const x = c.getContext('2d'); x.translate(c.width, 0); x.rotate(Math.PI / 2); x.drawImage(p.canvas, 0, 0); p.canvas = c; renderList(); } }, icon('rotate', 14)),
            h('button', { class: 'icon-btn', title: t('Retirer'), onclick: () => { pages.splice(i, 1); renderList(); } }, icon('x', 14))));
        return card;
      }));
      count.textContent = pages.length ? `${pages.length} ${pages.length > 1 ? t('pages') : t('page')}` : '';
      createBtn.disabled = openBtn.disabled = !pages.length;
    }

    const shutter = h('button', { class: 'btn btn-primary btn-lg', disabled: true, onclick: capture }, icon('image', 18), t('Capturer'));
    const count = h('span', { class: 'muted' }, '');
    const createBtn = h('button', { class: 'btn btn-lg', disabled: true, onclick: () => create(false) }, icon('download', 18), t('Télécharger le PDF'));
    const openBtn = h('button', { class: 'btn btn-lg', disabled: true, onclick: () => create(true) }, icon('pen', 18), t('Ouvrir dans l’éditeur'));
    const filters = h('div', { class: 'seg' });
    const drawFilters = () => filters.replaceChildren(...[['doc', t('Document')], ['gray', t('Gris')], ['bw', t('Noir & blanc')], ['color', t('Couleur')]].map(([k, l]) => h('button', { class: k === filter ? 'on' : '', onclick: () => { filter = k; drawFilters(); renderList(); } }, l)));
    drawFilters();
    fileIn.addEventListener('change', () => { importFiles([...fileIn.files]); fileIn.value = ''; });

    host.append(h('div', { class: 'tool-layout' },
      h('div', {}, h('div', { class: 'panel scan-stage' }, video, status),
        h('div', { style: { display: 'flex', gap: '.7rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '1rem' } }, shutter, h('button', { class: 'btn btn-lg', onclick: () => fileIn.click() }, icon('upload', 18), t('Importer des photos')), count, fileIn), list),
      h('div', {}, h('div', { class: 'panel' }, h('h3', {}, t('Amélioration')), filters,
        h('div', { class: 'note' }, icon('info', 16), h('span', {}, t('Posez le document sur une surface plane, bien éclairé. « Document » éclaircit le fond et renforce le texte.')))),
      h('div', { style: { height: '12px' } }), createBtn, h('div', { style: { height: '8px' } }), openBtn)));
    startCamera();
    return stopCamera;
  },
};
