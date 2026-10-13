// Outils d'application sur toutes les pages : numérotation, en-tête/pied, filigrane, rognage.
import { h, parsePageRanges, readFileBytes } from '../lib/utils.js';
import { icon } from '../ui/icons.js';
import { t } from '../i18n.js';
import { fileTool, ui, outName } from './framework.js';
import { FONTS, cssFont, ensureFontLoaded } from '../lib/fonts.js';
import { stampText, stampImage, cropPages } from '../lib/pdf-ops.js';
import { gridPosition } from '../lib/geometry.js';
import { openPdf, renderPageToCanvas } from '../lib/pdfjs.js';
import { rasterizeImage } from '../lib/utils.js';

const POSITIONS = ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'];

function positionPicker(value, onChange) {
  let cur = value;
  const wrap = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px', width: '120px' } });
  const draw = () => wrap.replaceChildren(...POSITIONS.map((p) => h('button', {
    type: 'button', title: p, class: 'btn btn-sm', style: { height: '30px', padding: 0, background: p === cur ? 'var(--accent)' : '', borderColor: p === cur ? 'var(--accent)' : '' },
    onclick: () => { cur = p; draw(); onChange?.(); },
  }, h('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: p === cur ? '#fff' : 'var(--muted)', display: 'block' } }))));
  draw();
  return { el: wrap, get: () => cur };
}

/** Panneau d'aperçu de la 1re page + superposition en direct. */
function previewPane(file, drawOverlay) {
  const box = h('div', { class: 'panel', style: { marginTop: '14px', textAlign: 'center' } }, h('h3', {}, t('Aperçu')));
  const stage = h('div', { style: { position: 'relative', display: 'inline-block', lineHeight: 0, boxShadow: 'var(--shadow)', maxWidth: '100%', overflow: 'hidden' } });
  box.append(stage);
  (async () => {
    const pdf = await openPdf(file.bytes);
    const page = await pdf.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const scale = 420 / vp.width;
    const c = await renderPageToCanvas(page, scale * Math.min(window.devicePixelRatio || 1, 2));
    c.style.width = '420px'; c.style.height = `${vp.height * scale}px`; c.style.maxWidth = '100%';
    const overlay = h('div', { style: { position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', lineHeight: 1.2 } });
    stage.append(c, overlay);
    pdf.destroy();
    box.__update = () => drawOverlay(overlay, { scale, w: vp.width, h: vp.height });
    box.__update();
  })();
  return box;
}

function textControls(prefix, d = {}) {
  const font = ui.select(FONTS.map((f) => [f.id, f.label]), d.fontId || 'helvetica');
  const size = h('input', { class: 'input', type: 'number', min: 4, max: 400, value: d.size ?? 12 });
  const color = h('input', { type: 'color', value: d.color || '#222222' });
  const bold = ui.check(t('Gras'), !!d.bold);
  const italic = ui.check(t('Italique'), false);
  const opacity = ui.range(5, 100, Math.round((d.opacity ?? 1) * 100), 5, (v) => `${v}%`);
  FONTS.forEach((f) => ensureFontLoaded(f.id));
  return {
    font, size, color, bold, italic, opacity,
    get: () => ({ fontId: font.value, size: +size.value || 12, color: color.value, bold: bold.input.checked, italic: italic.input.checked, opacity: +opacity.input.value / 100 }),
    els: [
      ui.field(t('Police'), font),
      h('div', { class: 'field-row' }, ui.field(t('Taille'), size), ui.field(t('Couleur'), color)),
      h('div', { class: 'field-row' }, bold.el, italic.el),
      ui.field(t('Opacité'), opacity.el),
    ],
  };
}

function pagesField(total) {
  const inp = h('input', { class: 'input', placeholder: t('Toutes (ex. 2-5, 8)') });
  return {
    el: ui.field(t('Pages concernées'), inp),
    get: () => (inp.value.trim() ? parsePageRanges(inp.value, total) : null),
  };
}

function textStampTool({ kind }) {
  return fileTool({
    accept: 'pdf', multiple: false,
    runLabel: kind === 'numbers' ? 'Numéroter' : kind === 'watermark' ? 'Ajouter le filigrane' : 'Appliquer', runIcon: kind === 'numbers' ? 'hash' : 'drop',
    leftExtra: (ctx) => ctx.__preview,
    options: (ctx) => {
      const f = ctx.files[0];
      const tc = textControls(kind, kind === 'watermark' ? { size: 72, color: '#d11a2a', opacity: 0.25, bold: true } : { size: 11 });
      const pages = pagesField(f.pages);
      let pos, text, formatSel, margin, startAt, skipFirst, rotation, tile, bgColor, mode, imgInput, imgScale;
      const els = [];
      const refresh = () => ctx.__preview?.__update?.();

      if (kind === 'numbers') {
        const fmts = ['{n}', t('Page {n}'), t('Page {n} sur {total}'), '{n} / {total}', '- {n} -'];
        const sample = (f) => f.replace('{n}', '1').replace('{total}', '10');
        formatSel = ui.select([[fmts[0], '1, 2, 3'], ...fmts.slice(1).map((f) => [f, sample(f)]), ['custom', t('Personnalisé…')]], fmts[2]);
        text = h('input', { class: 'input', value: '{n}/{total}', hidden: true });
        formatSel.addEventListener('change', () => { text.hidden = formatSel.value !== 'custom'; refresh(); });
        text.addEventListener('input', refresh);
        startAt = h('input', { class: 'input', type: 'number', value: 1, min: 0 });
        skipFirst = ui.check(t('Ne pas numéroter la première page'), false);
        els.push(ui.field(t('Format'), formatSel), text, h('div', { class: 'field-row' }, ui.field(t('Commencer à'), startAt), ui.field(t('Marge (pt)'), margin = h('input', { class: 'input', type: 'number', value: 28 }))), skipFirst.el);
        pos = positionPicker('bottom-center', refresh);
      } else if (kind === 'headerfooter') {
        text = h('input', { class: 'input', value: '{title} — {date}' });
        text.addEventListener('input', refresh);
        els.push(ui.field(t('Texte'), text, t('Variables : {n} page, {total} total, {date}, {title}, {file}')), ui.field(t('Marge (pt)'), margin = h('input', { class: 'input', type: 'number', value: 28 })));
        pos = positionPicker('top-center', refresh);
      } else {
        mode = ui.seg([['text', t('Texte')], ['image', t('Image')]], 'text', () => { drawMode(); refresh(); });
        text = h('input', { class: 'input', value: t('CONFIDENTIEL') });
        text.addEventListener('input', refresh);
        rotation = ui.range(-90, 90, 45, 5, (v) => `${v}°`);
        rotation.input.addEventListener('input', refresh);
        tile = ui.check(t('Répéter en mosaïque'), false);
        tile.input.addEventListener('change', refresh);
        imgInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'input' });
        imgScale = ui.range(10, 100, 50, 5, (v) => `${v}%`);
        imgScale.input.addEventListener('input', refresh);
        margin = h('input', { type: 'hidden', value: 24 });
        pos = positionPicker('middle-center', refresh);
        imgInput.addEventListener('change', async () => {
          const file = imgInput.files[0];
          if (file) ctx.__img = { url: URL.createObjectURL(file), file };
          refresh();
        });
      }
      const modeBox = h('div', {});
      const drawMode = () => {
        if (kind !== 'watermark') return;
        modeBox.replaceChildren();
        if (mode.get() === 'text') modeBox.append(ui.field(t('Texte du filigrane'), text), ...tc.els, ui.field(t('Rotation'), rotation.el), tile.el);
        else modeBox.append(ui.field(t('Image (PNG / JPG)'), imgInput), ui.field(t('Taille'), imgScale.el), ui.field(t('Opacité'), tc.opacity.el), ui.field(t('Rotation'), rotation.el));
      };
      drawMode();
      [tc.font, tc.size, tc.color].forEach((x) => x.addEventListener('input', refresh));
      [tc.bold.input, tc.italic.input].forEach((x) => x.addEventListener('change', refresh));
      tc.opacity.input.addEventListener('input', refresh);

      ctx.__preview = previewPane(f, (overlay, { scale, w, h: ph }) => {
        overlay.replaceChildren();
        const o = tc.get();
        if (kind === 'watermark' && mode.get() === 'image') {
          if (!ctx.__img) return;
          const im = h('img', { src: ctx.__img.url, style: { position: 'absolute', opacity: o.opacity, width: `${w * scale * imgScale.input.value / 100}px`, left: '50%', top: '50%', transform: `translate(-50%,-50%) rotate(${-rotation.input.value}deg)` } });
          overlay.append(im);
          return;
        }
        let str = kind === 'numbers' ? (formatSel.value === 'custom' ? text.value : formatSel.value) : text.value;
        str = str.replace(/\{n\}/g, String(+(startAt?.value ?? 1))).replace(/\{total\}/g, String(f.pages)).replace(/\{date\}/g, new Date().toLocaleDateString('fr-FR')).replace(/\{title\}/g, '…').replace(/\{file\}/g, f.name);
        const px = o.size * scale;
        const span = h('span', { style: { position: 'absolute', whiteSpace: 'pre', font: cssFont(o.fontId, o.bold, o.italic, px), color: o.color, opacity: o.opacity, textAlign: 'center', lineHeight: 1.25 } }, str);
        overlay.append(span);
        requestAnimationFrame(() => {
          const bw = span.offsetWidth / scale, bh = span.offsetHeight / scale;
          const p = gridPosition(pos.get(), w, ph, bw, bh, +margin.value || 0);
          span.style.left = `${p.x * scale}px`; span.style.top = `${p.y * scale}px`;
          if (kind === 'watermark') span.style.transform = `rotate(${-rotation.input.value}deg)`;
        });
        if (kind === 'watermark' && tile.input.checked) { span.style.opacity = o.opacity; }
      });

      const wrap = h('div', {},
        kind === 'watermark' ? mode.el : null,
        kind !== 'watermark' ? h('div', {}, ...els, ...tc.els) : modeBox,
        h('div', { class: 'field', style: { marginTop: '.4rem' } }, h('span', {}, t('Position')), pos.el),
        pages.el);
      return {
        el: wrap,
        get: () => {
          const o = tc.get();
          const base = { ...o, indices: pages.get(), position: pos.get(), margin: +(margin?.value || 24), fileName: f.name };
          if (kind === 'numbers') {
            const idx = base.indices ?? Array.from({ length: f.pages }, (_, i) => i);
            const list = skipFirst.input.checked ? idx.filter((i) => i !== 0) : idx;
            return { ...base, text: formatSel.value === 'custom' ? text.value : formatSel.value, indices: list, startAt: Number.isFinite(+startAt.value) && startAt.value !== '' ? +startAt.value : 1 };
          }
          if (kind === 'headerfooter') return { ...base, text: text.value, absolute: true };
          if (mode.get() === 'image') return { ...base, image: true, rotation: +rotation.input.value, scale: +imgScale.input.value / 100, imgFile: imgInput.files[0] };
          return { ...base, text: text.value, rotation: +rotation.input.value, tile: tile.input.checked };
        },
      };
    },
    async run({ files, opts, progress }) {
      const f = files[0];
      progress(0.3, t('Application…'));
      let bytes;
      if (opts.image) {
        if (!opts.imgFile) throw new Error(t('Choisissez une image.'));
        const isPng = opts.imgFile.type === 'image/png', isJpg = opts.imgFile.type === 'image/jpeg';
        const data = isPng || isJpg ? await readFileBytes(opts.imgFile) : await rasterizeImage(opts.imgFile, 'image/png');
        bytes = await stampImage(f.bytes, data, isJpg ? 'image/jpeg' : 'image/png', { ...opts, position: opts.position === 'middle-center' ? 'center' : opts.position });
      } else {
        if (!opts.text?.trim()) throw new Error(t('Le texte est vide.'));
        bytes = await stampText(f.bytes, opts);
      }
      return { title: t('C’est fait !'), outputs: [{ name: outName(f, kind === 'numbers' ? 'numéroté' : kind === 'watermark' ? 'filigrane' : 'annoté'), data: bytes }] };
    },
  });
}

export const pageNumbers = textStampTool({ kind: 'numbers' });
export const headerFooter = textStampTool({ kind: 'headerfooter' });
export const watermark = textStampTool({ kind: 'watermark' });

/* ---------- Rognage visuel ---------- */
export const crop = fileTool({
  accept: 'pdf', multiple: false, runLabel: 'Rogner', runIcon: 'crop',
  leftExtra: (ctx) => ctx.__cropView,
  options: (ctx) => {
    const f = ctx.files[0];
    const m = { top: 0, right: 0, bottom: 0, left: 0 }; // en points
    const inputs = {};
    let dims = { w: 595, h: 842 }, scale = 1;
    const stage = h('div', { style: { position: 'relative', display: 'inline-block', lineHeight: 0, userSelect: 'none', touchAction: 'none' } });
    const cropEl = h('div', { style: { position: 'absolute', border: '2px solid var(--accent)', boxShadow: '0 0 0 9999px rgba(10,8,30,.55)', cursor: 'move' } });
    const syncEl = () => {
      cropEl.style.left = `${m.left * scale}px`; cropEl.style.top = `${m.top * scale}px`;
      cropEl.style.right = `${m.right * scale}px`; cropEl.style.bottom = `${m.bottom * scale}px`;
      for (const k of Object.keys(m)) if (inputs[k] && document.activeElement !== inputs[k]) inputs[k].value = Math.round(m[k]);
    };
    const handles = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((d) => {
      const el = h('div', { dataset: { d }, style: { position: 'absolute', width: '14px', height: '14px', background: 'var(--accent)', border: '2px solid #fff', borderRadius: '50%', cursor: `${d}-resize`, transform: 'translate(-50%,-50%)', left: d.includes('w') ? '0' : d.includes('e') ? '100%' : '50%', top: d.includes('n') ? '0' : d.includes('s') ? '100%' : '50%' } });
      return el;
    });
    cropEl.append(...handles);
    let drag = null;
    stage.addEventListener('pointerdown', (e) => {
      const d = e.target.dataset?.d || (e.target === cropEl ? 'move' : null);
      if (!d) return;
      stage.setPointerCapture(e.pointerId);
      drag = { d, x: e.clientX, y: e.clientY, m: { ...m } };
    });
    stage.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = (e.clientX - drag.x) / scale, dy = (e.clientY - drag.y) / scale;
      const { d } = drag;
      const lim = (v, max) => Math.max(0, Math.min(max, v));
      if (d === 'move') {
        m.left = lim(drag.m.left + dx, dims.w - drag.m.right - 20); m.right = drag.m.right - (m.left - drag.m.left);
        m.top = lim(drag.m.top + dy, dims.h - drag.m.bottom - 20); m.bottom = drag.m.bottom - (m.top - drag.m.top);
        if (m.right < 0 || m.bottom < 0) { m.left = drag.m.left; m.top = drag.m.top; m.right = drag.m.right; m.bottom = drag.m.bottom; }
      } else {
        if (d.includes('w')) m.left = lim(drag.m.left + dx, dims.w - m.right - 20);
        if (d.includes('e')) m.right = lim(drag.m.right - dx, dims.w - m.left - 20);
        if (d.includes('n')) m.top = lim(drag.m.top + dy, dims.h - m.bottom - 20);
        if (d.includes('s')) m.bottom = lim(drag.m.bottom - dy, dims.h - m.top - 20);
      }
      syncEl();
    });
    stage.addEventListener('pointerup', () => { drag = null; });
    (async () => {
      const pdf = await openPdf(f.bytes);
      const page = await pdf.getPage(1);
      const vp = page.getViewport({ scale: 1 });
      dims = { w: vp.width, h: vp.height };
      scale = Math.min(560, vp.width * 1.2) / vp.width;
      const c = await renderPageToCanvas(page, scale * Math.min(window.devicePixelRatio || 1, 2));
      c.style.width = `${vp.width * scale}px`; c.style.height = `${vp.height * scale}px`;
      stage.prepend(c);
      stage.append(cropEl);
      syncEl();
      pdf.destroy();
    })();
    ctx.__cropView = h('div', { class: 'panel', style: { textAlign: 'center', overflow: 'auto' } }, stage);
    const mk = (k, label) => {
      const i = h('input', { class: 'input', type: 'number', min: 0, value: 0 });
      i.addEventListener('input', () => { m[k] = Math.max(0, +i.value || 0); syncEl(); });
      inputs[k] = i;
      return ui.field(label, i);
    };
    const pages = pagesField(f.pages);
    return {
      el: h('div', {}, ui.note(t('Déplacez les poignées sur l’aperçu ou saisissez les marges (en points, 72 pt = 1 pouce) à retirer.')), h('div', { style: { height: '.8rem' } }),
        h('div', { class: 'field-row' }, mk('top', t('Haut')), mk('bottom', t('Bas'))), h('div', { class: 'field-row' }, mk('left', t('Gauche')), mk('right', t('Droite'))), pages.el),
      get: () => ({ margins: { ...m }, indices: pages.get() }),
    };
  },
  async run({ files, opts }) {
    const f = files[0];
    const bytes = await cropPages(f.bytes, opts.margins, opts.indices);
    return { title: t('Pages rognées !'), outputs: [{ name: outName(f, 'rogné'), data: bytes }] };
  },
});
