// Fenêtre de création de signature : dessiner, taper ou importer. Les signatures sont mémorisées localement.
import { h } from '../lib/utils.js';
import { t } from '../i18n.js';
import { openModal } from '../ui/modal.js';
import { icon } from '../ui/icons.js';
import { SIGNATURE_FONTS, FONT_MAP, ensureFontLoaded } from '../lib/fonts.js';
import { prefs } from '../lib/session.js';
import { trimCanvas, cleanSignatureImage } from './images.js';

const COLORS = ['#111111', '#1d4ed8', '#b91c1c', '#047857'];

export function getSavedSignatures() { return prefs.get('signatures', []); }
function saveSignature(dataUrl) {
  const list = [dataUrl, ...getSavedSignatures().filter((d) => d !== dataUrl)].slice(0, 6);
  prefs.set('signatures', list);
}
function deleteSignature(dataUrl) { prefs.set('signatures', getSavedSignatures().filter((d) => d !== dataUrl)); }

/** Ouvre le sélecteur de signature. Résout avec {dataUrl, w, h} ou null. kind: 'signature' | 'initials' */
export function pickSignature({ kind = 'signature' } = {}) {
  return new Promise((resolve) => {
    let mode = 'draw';
    let color = COLORS[0];
    let result = null;
    const body = h('div', { class: 'sig-modal' });
    const tabs = h('div', { class: 'seg', style: { marginBottom: '.8rem' } });
    const stage = h('div', {});
    const saved = h('div', { class: 'sig-saved' });
    const colorRow = h('div', { class: 'sig-colors' });

    // --- dessin
    const W = 560, H = 190;
    const canvas = h('canvas', { width: W * 2, height: H * 2, class: 'sig-canvas', style: { width: '100%', aspectRatio: `${W}/${H}` } });
    const ctx = canvas.getContext('2d');
    let strokes = [];
    let cur = null;
    const redraw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineCap = ctx.lineJoin = 'round';
      ctx.strokeStyle = color;
      for (const s of strokes) {
        ctx.beginPath();
        s.forEach(([x, y, p], i) => { ctx.lineWidth = 2 + p * 3.2; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        if (s.length === 1) { ctx.lineWidth = 4; ctx.lineTo(s[0][0] + 0.1, s[0][1]); }
        ctx.stroke();
      }
    };
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * canvas.width, ((e.clientY - r.top) / r.height) * canvas.height, e.pressure && e.pressure !== 0.5 ? e.pressure : 0.6]; };
    canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); cur = [pos(e)]; strokes.push(cur); redraw(); });
    canvas.addEventListener('pointermove', (e) => { if (!cur) return; cur.push(pos(e)); redraw(); });
    canvas.addEventListener('pointerup', () => { cur = null; });
    const drawPane = h('div', {},
      h('div', { class: 'sig-pad' }, canvas, h('span', { class: 'sig-line' }), h('span', { class: 'sig-hint' }, kind === 'initials' ? t('Dessinez vos initiales ici') : t('Dessinez votre signature ici'))),
      h('div', { style: { display: 'flex', gap: '.5rem', marginTop: '.5rem' } }, h('button', { class: 'btn btn-sm', onclick: () => { strokes = []; redraw(); } }, icon('eraser', 15), t('Effacer')), h('button', { class: 'btn btn-sm', onclick: () => { strokes.pop(); redraw(); } }, icon('undo', 15), t('Annuler le dernier trait'))));

    // --- saisie
    SIGNATURE_FONTS.forEach(ensureFontLoaded);
    let fontId = SIGNATURE_FONTS[0];
    const nameInput = h('input', { class: 'input', placeholder: t('Votre nom'), style: { fontSize: '1.1rem' } });
    const fontList = h('div', { class: 'sig-fonts' });
    const drawFonts = () => fontList.replaceChildren(...SIGNATURE_FONTS.map((f) => h('button', { type: 'button', class: `sig-font ${f === fontId ? 'on' : ''}`, style: { fontFamily: `'${FONT_MAP[f].label}', cursive`, color }, onclick: () => { fontId = f; drawFonts(); } }, nameInput.value || (kind === 'initials' ? 'AB' : 'Signature'))));
    nameInput.addEventListener('input', drawFonts);
    const typePane = h('div', { hidden: true }, h('label', { class: 'field' }, h('span', {}, kind === 'initials' ? t('Initiales') : t('Nom à signer')), nameInput), fontList);

    // --- import
    let importCanvas = null;
    const preview = h('div', { class: 'sig-preview muted' }, t('Aucune image choisie'));
    const fileIn = h('input', { type: 'file', accept: 'image/*', class: 'input' });
    const bgCheck = h('input', { type: 'checkbox', checked: true });
    let importBlob = null;
    const refreshImport = async () => {
      if (!importBlob) return;
      importCanvas = await cleanSignatureImage(importBlob, { removeBg: bgCheck.checked });
      preview.replaceChildren(importCanvas);
      importCanvas.style.cssText = 'max-width:100%;max-height:150px;background:repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/14px 14px';
    };
    fileIn.addEventListener('change', () => { importBlob = fileIn.files[0]; refreshImport(); });
    bgCheck.addEventListener('change', refreshImport);
    const importPane = h('div', { hidden: true }, h('label', { class: 'field' }, h('span', {}, t('Image de signature (photo ou scan)')), fileIn), h('label', { class: 'check' }, bgCheck, t('Rendre le fond transparent')), preview);

    const remember = h('input', { type: 'checkbox', checked: true });

    const drawColors = () => colorRow.replaceChildren(...COLORS.map((c) => h('button', { type: 'button', class: `swatch ${c === color ? 'on' : ''}`, style: { background: c }, 'aria-label': c, onclick: () => { color = c; drawColors(); redraw(); drawFonts(); } })));
    const drawTabs = () => {
      tabs.replaceChildren(...[['draw', t('Dessiner')], ['type', t('Taper')], ['import', t('Importer')]].map(([k, l]) => h('button', { type: 'button', class: k === mode ? 'on' : '', onclick: () => { mode = k; drawPanes(); } }, l)));
    };
    const drawPanes = () => {
      drawTabs();
      drawPane.hidden = mode !== 'draw'; typePane.hidden = mode !== 'type'; importPane.hidden = mode !== 'import';
      colorRow.hidden = mode === 'import';
    };
    const drawSaved = () => {
      const list = getSavedSignatures();
      saved.replaceChildren();
      if (!list.length) return;
      saved.append(h('div', { class: 'field-label', style: { margin: '1rem 0 .4rem' } }, t('Signatures enregistrées')));
      saved.append(h('div', { class: 'sig-saved-list' }, list.map((d) => h('div', { class: 'sig-saved-item' },
        h('button', { type: 'button', class: 'sig-use', title: t('Utiliser'), onclick: () => { result = { dataUrl: d }; m.close('ok'); } }, h('img', { src: d, alt: '' })),
        h('button', { type: 'button', class: 'icon-btn', title: t('Supprimer'), onclick: () => { deleteSignature(d); drawSaved(); } }, icon('x', 14))))));
    };

    body.append(tabs, drawPane, typePane, importPane, colorRow, h('label', { class: 'check', style: { marginTop: '.8rem' } }, remember, t('Mémoriser pour la prochaine fois')), saved);
    drawColors(); drawPanes(); drawSaved(); redraw(); drawFonts();

    const finish = async () => {
      let c = null;
      if (mode === 'draw') {
        if (!strokes.length) return false;
        c = trimCanvas(canvas);
      } else if (mode === 'type') {
        const text = nameInput.value.trim();
        if (!text) return false;
        await ensureFontLoaded(fontId);
        const cv = document.createElement('canvas');
        const px = 140;
        const cx = cv.getContext('2d');
        cx.font = `${px}px '${FONT_MAP[fontId].label}', cursive`;
        const wText = Math.ceil(cx.measureText(text).width) + 40;
        cv.width = wText; cv.height = px * 1.6;
        const c2 = cv.getContext('2d');
        c2.font = `${px}px '${FONT_MAP[fontId].label}', cursive`;
        c2.fillStyle = color; c2.textBaseline = 'alphabetic';
        c2.fillText(text, 20, px * 1.15);
        c = trimCanvas(cv);
      } else {
        if (!importCanvas) return false;
        c = importCanvas;
        if (color !== COLORS[0]) { /* couleur d'origine conservée pour les images importées */ }
      }
      const dataUrl = c.toDataURL('image/png');
      if (remember.checked) saveSignature(dataUrl);
      result = { dataUrl };
      return true;
    };

    const m = openModal({
      title: kind === 'initials' ? t('Vos initiales') : t('Votre signature'),
      width: 620,
      content: body,
      actions: [
        { label: t('Annuler'), value: null },
        { label: t('Utiliser'), primary: true, onClick: async () => { const ok = await finish(); if (!ok) return false; }, value: 'ok' },
      ],
      onClose: (r) => resolve(r === 'ok' ? result : null),
    });
  });
}
