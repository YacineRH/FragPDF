// Vue « Éditeur » : assemble visionneuse, outils, panneau de propriétés, barre latérale…
import { h, formatBytes, downloadBlob, baseName, readFileBytes, clamp } from '../lib/utils.js';
import { icon } from '../ui/icons.js';
import { brand, themeToggle, langToggle, navigate } from '../ui/chrome.js';
import { t, pagesLabel } from '../i18n.js';
import { toast, toastError } from '../ui/toast.js';
import { openModal, progressModal, confirmDialog } from '../ui/modal.js';
import { loadPdfFile, isPdf, isImage } from '../lib/ingest.js';
import { takePending, setPending, prefs } from '../lib/session.js';
import { EditorState } from './state.js';
import { Viewer } from './viewer.js';
import { AnnotManager, HL_TOOLS, bboxOf, translatePatch } from './annots.js';
import { PropsPanel, TITLES } from './props.js';
import { Sidebar } from './sidebar.js';
import { FindBar } from './find.js';
import { FormLayer } from './forms.js';
import { TextEditTool } from './textedit.js';
import { exportPdf } from './export.js';
import { imageFromBlob, imageFromDataURL } from './images.js';
import { pickSignature } from './signature.js';
import { blankDocument, insertPdf } from './pageops.js';
import { loadAllPreviewFonts } from '../lib/fonts.js';
import { uid, debounce } from '../lib/utils.js';
import { saveSession, loadSession, clearSession } from '../lib/autosave.js';
import { scanDocument } from './autoredact.js';

const RAIL = [
  [['select', 'cursor', 'V'], ['edittext', 'type', 'E']],
  [['text', 'text', 'T'], ['image', 'image', 'I'], ['sign', 'sign', 'S'], ['stamp', 'stamp', 'M']],
  [['highlight', 'highlight', 'H'], ['underline', 'underline', 'U'], ['strike', 'strike', 'K'], ['ink', 'pencil', 'D']],
  [['rect', 'square', 'R'], ['ellipse', 'circle', 'O'], ['line', 'line', 'L'], ['arrow', 'arrow', 'A']],
  [['whiteout', 'eraser', 'W'], ['redact', 'redact', 'B'], ['mark', 'check', 'C'], ['note', 'note', 'N'], ['link', 'link', 'J'], ['forms', 'form', 'F']],
];
const SHORTCUTS = {};
RAIL.flat().forEach(([id, , key]) => { if (!SHORTCUTS[key.toLowerCase()]) SHORTCUTS[key.toLowerCase()] = id; });

export async function mount(root, { query }) {
  document.title = 'Éditeur — FragPDF';
  loadAllPreviewFonts();
  const state = new EditorState();
  const cleanups = [];
  let firstLoad = true;

  /* ---------- squelette ---------- */
  const nameInput = h('input', { class: 'ed-name', value: state.name, 'aria-label': t('Nom du fichier'), spellcheck: 'false' });
  nameInput.addEventListener('change', () => { state.name = nameInput.value.trim() || 'document.pdf'; });
  const undoBtn = h('button', { class: 'icon-btn', title: t('Annuler (Ctrl+Z)'), onclick: () => state.undo() }, icon('undo', 19));
  const redoBtn = h('button', { class: 'icon-btn', title: t('Rétablir (Ctrl+Y)'), onclick: () => state.redo() }, icon('redo', 19));
  const pageInput = h('input', { class: 'page-input', type: 'number', min: 1, value: 1, 'aria-label': t('Page') });
  const pageTotal = h('span', { class: 'muted' }, '/ 1');
  const zoomLabel = h('button', { class: 'zoom-label', title: t('Ajuster à la largeur') }, '100 %');
  const sidebarBtn = h('button', { class: 'icon-btn active', title: t('Afficher/masquer les pages'), onclick: () => { ed.classList.toggle('no-sidebar'); sidebarBtn.classList.toggle('active'); setTimeout(() => viewer.fitWidth?.(), 0); } }, icon('layout', 19));
  const propsBtn = h('button', { class: 'icon-btn active', title: t('Afficher/masquer les propriétés'), onclick: () => { ed.classList.toggle('no-props'); propsBtn.classList.toggle('active'); } }, icon('settings', 19));
  const findBtn = h('button', { class: 'icon-btn', title: t('Rechercher (Ctrl+F)'), onclick: () => find.open() }, icon('search', 19));
  const menuBtn = h('button', { class: 'btn btn-sm', onclick: (e) => { e.stopPropagation(); openFileMenu(menuBtn); } }, icon('file', 16), t('Fichier'), icon('chevD', 14));
  const dlBtn = h('button', { class: 'btn btn-primary btn-sm', onclick: () => openExportDialog() }, icon('download', 16), t('Télécharger'));

  const top = h('header', { class: 'ed-top' },
    h('a', { class: 'brand brand-sm', href: '#/', title: t('Accueil') }, h('span', { class: 'brand-mark' }, icon('frag', 18))),
    menuBtn,
    h('div', { class: 'sep' }), undoBtn, redoBtn, h('div', { class: 'sep' }),
    nameInput,
    h('span', { class: 'spacer' }),
    h('div', { class: 'pager' }, pageInput, pageTotal),
    h('div', { class: 'zoomer' },
      h('button', { class: 'icon-btn', title: t('Zoom arrière (-)'), onclick: () => viewer.setZoom(state.zoom / 1.2) }, icon('zoomOut', 19)),
      zoomLabel,
      h('button', { class: 'icon-btn', title: t('Zoom avant (+)'), onclick: () => viewer.setZoom(state.zoom * 1.2) }, icon('zoomIn', 19))),
    findBtn, sidebarBtn, propsBtn, h('div', { class: 'sep' }), langToggle(), themeToggle(), dlBtn);

  const rail = h('nav', { class: 'rail', 'aria-label': t('Outils') });
  const railBtns = new Map();
  RAIL.forEach((group, gi) => {
    if (gi) rail.append(h('div', { class: 'rail-sep' }));
    group.forEach(([id, ic, key]) => {
      const b = h('button', { class: 'rail-btn', title: `${t(TITLES[id] || id)} (${key})`, dataset: { tool: id }, onclick: () => selectTool(id) }, icon(ic, 21), h('span', {}, t(TITLES[id] || id).split(' ')[0]));
      railBtns.set(id, b);
      rail.append(b);
    });
  });

  const sidebarEl = h('aside', { class: 'sidebar' });
  const sidebarHead = h('div', { class: 'sidebar-head' }, h('span', {}, t('Pages')),
    h('button', { class: 'icon-btn', title: t('Insérer une page blanche à la fin'), onclick: () => run(async () => { const { insertBlank } = await import('./pageops.js'); await insertBlank(state, state.pages.length); }) }, icon('plus', 16)),
    h('button', { class: 'icon-btn', title: t('Insérer un PDF…'), onclick: () => insertPdfDialog() }, icon('files', 16)));
  sidebarEl.append(sidebarHead);
  const thumbHost = h('div', { class: 'sidebar-scroll' });
  sidebarEl.append(thumbHost);

  const scroller = h('main', { class: 'scroller', tabindex: '-1' });
  const propsEl = h('aside', { class: 'props' });
  const stage = h('div', { class: 'stage' }, scroller);
  const ed = h('div', { class: 'ed no-doc' }, top, h('div', { class: 'ed-body' }, rail, sidebarEl, stage, propsEl));
  root.append(ed);

  const viewer = new Viewer(state, scroller);
  const annots = new AnnotManager(state, viewer);
  const sidebar = new Sidebar(state, thumbHost, viewer);
  const find = new FindBar(state, viewer, stage);
  const forms = new FormLayer(state, viewer);
  const textedit = new TextEditTool(state, viewer, annots);

  /* ---------- actions sur les annotations ---------- */
  const run = async (fn) => { try { await fn(); } catch (e) { console.error(e); toastError(e.message || String(e)); } };
  const actions = {
    duplicate() { duplicateSelection(); },
    remove() { removeSelection(); },
    front() { reorderZ(true); },
    back() { reorderZ(false); },
    center() {
      const sel = state.selected();
      if (!sel.length) return;
      state.checkpoint();
      sel.forEach((a) => { const b = bboxOf(a); const p = state.pages[a.page]; state.updateAnnot(a.id, { x: (p.w - b.w) / 2, y: (p.h - b.h) / 2 }); });
    },
    async autoRedact(spec) {
      const pm = progressModal(t('Recherche dans le document…'));
      try {
        const rects = await scanDocument(state, find, spec, (p) => pm.set(p));
        if (!rects.length) { toast(t('Aucune occurrence trouvée.')); return; }
        state.checkpoint();
        rects.forEach((r) => state.addAnnot({ type: 'redact', ...r }, { select: false }));
        toast(t('{n} zone(s) à caviarder ajoutée(s). Vérifiez-les avant de télécharger.', { n: rects.length }), 'success', 5200);
      } finally { pm.close(); }
    },
    resetAspect() {
      const a = state.selected()[0];
      const as = a && state.assets.get(a.assetId);
      if (!as) return;
      state.checkpoint();
      state.updateAnnot(a.id, { h: a.w * (as.h / as.w) });
      annots.updateFrame();
    },
  };
  const props = new PropsPanel(state, propsEl, actions);
  void props;

  function removeSelection() {
    const ids = [...state.sel];
    if (!ids.length) return;
    state.checkpoint();
    state.removeAnnots(ids);
  }
  function duplicateSelection() {
    const sel = state.selected();
    if (!sel.length) return;
    state.checkpoint();
    const ids = [];
    for (const a of sel) {
      const c = structuredClone(a);
      c.id = uid();
      const off = 14;
      if (c.type === 'line' || c.type === 'arrow') { c.x1 += off; c.y1 += off; c.x2 += off; c.y2 += off; }
      else if (c.type === 'ink') c.points = c.points.map(([x, y]) => [x + off, y + off]);
      else if (c.rects) c.rects = c.rects.map((r) => ({ ...r, x: r.x + off, y: r.y + off }));
      else { c.x += off; c.y += off; delete c.covers; }
      state.annots.push(c);
      ids.push(c.id);
    }
    state.emit('annots', { pages: [...new Set(sel.map((a) => a.page))] });
    state.setSelection(ids);
    state.dirty = true;
  }
  function reorderZ(front) {
    const sel = state.selected();
    if (!sel.length) return;
    state.checkpoint();
    const ids = new Set(sel.map((a) => a.id));
    const rest = state.annots.filter((a) => !ids.has(a.id));
    state.annots = front ? [...rest, ...sel] : [...sel, ...rest];
    state.emit('annots', { pages: [...new Set(sel.map((a) => a.page))] });
  }

  /* ---------- outils ---------- */
  async function selectTool(id) {
    if (!state.pdf) { toast(t('Ouvrez d’abord un PDF.'), 'info'); return; }
    if (annots.editing) annots.endEdit();
    if (id === 'image') {
      const file = await pickFile('image/*');
      if (!file) return;
      await prepareImage(file);
      state.setTool('image');
      return;
    }
    if (id === 'sign') {
      const r = await pickSignature();
      if (!r) return;
      const info = await imageFromDataURL(r.dataUrl);
      const assetId = state.addAsset(info);
      state.placing = { assetId, w: info.w, h: info.h, defaultW: 170 };
      state.setTool('sign');
      toast(t('Cliquez sur la page pour placer votre signature.'));
      return;
    }
    if (id === 'forms' && !forms.count) toast(t('Ce document ne contient pas de champs de formulaire.'));
    if (id === 'note') {
      state.setTool('note');
      return;
    }
    state.setTool(id);
    if (id === 'edittext') toast(t('Cliquez sur un texte du document pour le modifier (ou tracez un cadre pour en sélectionner plusieurs lignes).'), 'info', 4800);
  }

  async function prepareImage(file) {
    const info = await imageFromBlob(file);
    const assetId = state.addAsset(info);
    state.placing = { assetId, w: info.w, h: info.h, defaultW: Math.min(260, info.w) };
    toast(t('Cliquez sur la page pour placer l’image (ou glissez pour la dimensionner).'));
    return assetId;
  }

  function pickFile(accept) {
    return new Promise((resolve) => {
      const input = h('input', { type: 'file', accept, hidden: true });
      document.body.append(input);
      input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
      input.addEventListener('cancel', () => { resolve(null); input.remove(); });
      input.click();
    });
  }

  async function placeImageAt(file, clientX, clientY) {
    const info = await imageFromBlob(file);
    const assetId = state.addAsset(info);
    let p = clientX != null ? viewer.pointToPage(clientX, clientY) : null;
    if (!p) {
      const r = scroller.getBoundingClientRect();
      p = viewer.pointToPage(r.left + r.width / 2, r.top + r.height / 2) || { page: state.currentPage, x: state.pages[state.currentPage].w / 2, y: state.pages[state.currentPage].h / 2 };
    }
    const w = Math.min(260, info.w, state.pages[p.page].w * 0.6), hh = w * (info.h / info.w);
    state.checkpoint();
    state.addAnnot({ type: 'image', page: p.page, x: p.x - w / 2, y: p.y - hh / 2, w, h: hh, assetId });
    state.setTool('select');
  }

  /* ---------- chargement du document ---------- */
  async function openDocument(doc) {
    const pm = progressModal(t('Ouverture…'));
    try {
      pm.set(0.3);
      state.annots = []; state.sel = new Set(); state.formValues = new Map(); state.undoStack = []; state.redoStack = []; state.dirty = false;
      state.assets.clear();
      state.currentPage = 0;
      firstLoad = true;
      await state.setBytes(doc.bytes, { name: doc.name });
      nameInput.value = doc.name;
      ed.classList.remove('no-doc');
      emptyEl.hidden = true;
      state.setTool('select');
      state.emit('history');
    } catch (e) {
      console.error(e);
      toastError(t('Impossible d’ouvrir ce document.'));
    } finally { pm.close(); }
  }

  state.on('doc', () => {
    const sc = scroller.scrollTop;
    viewer.rebuild();
    pageTotal.textContent = `/ ${state.pages.length}`;
    pageInput.max = state.pages.length;
    if (state.currentPage >= state.pages.length) state.currentPage = state.pages.length - 1;
    if (firstLoad) { firstLoad = false; viewer.fitWidth(); scroller.scrollTop = 0; }
    else scroller.scrollTop = sc;
    nameInput.value = state.name;
  });
  state.on('page', (i) => { pageInput.value = i + 1; });
  state.on('zoom', (z) => { zoomLabel.textContent = `${Math.round(z * 100)} %`; });
  state.on('history', () => { undoBtn.disabled = !state.canUndo; redoBtn.disabled = !state.canRedo; });
  state.on('tool', (tool) => {
    railBtns.forEach((b, id) => b.classList.toggle('active', id === tool || (tool === 'highlightbox' && id === 'highlight')));
    scroller.dataset.tool = tool;
  });
  undoBtn.disabled = redoBtn.disabled = true;
  railBtns.get('select').classList.add('active');
  pageInput.addEventListener('change', () => { const n = clamp(parseInt(pageInput.value, 10) || 1, 1, state.pages.length); viewer.scrollToPage(n - 1); });
  zoomLabel.addEventListener('click', () => viewer.fitWidth());

  /* ---------- surligner / souligner / barrer à partir d'une sélection de texte ---------- */
  const onSelectionEnd = () => {
    if (!HL_TOOLS.has(state.tool) || state.opts.hlMode !== 'text') return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 3 && r.height < 80);
    if (!rects.length) return;
    const byPage = new Map();
    for (const r of rects) {
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const p = viewer.pointToPage(cx, cy);
      if (!p) continue;
      const ir = viewer.dom(p.page).inner.getBoundingClientRect();
      const z = state.zoom;
      const list = byPage.get(p.page) || [];
      list.push({ x: (r.left - ir.left) / z, y: (r.top - ir.top) / z, w: r.width / z, h: r.height / z });
      byPage.set(p.page, list);
    }
    if (!byPage.size) return;
    state.checkpoint();
    for (const [page, list] of byPage) {
      // fusionne les rectangles d'une même ligne
      list.sort((a, b) => a.y - b.y || a.x - b.x);
      const merged = [];
      for (const r of list) {
        const m = merged.find((q) => Math.abs(q.y - r.y) < 2.5 && Math.abs(q.h - r.h) < 4 && r.x <= q.x + q.w + 3 && r.x + r.w >= q.x - 3);
        if (m) { const x2 = Math.max(m.x + m.w, r.x + r.w); m.x = Math.min(m.x, r.x); m.w = x2 - m.x; m.y = Math.min(m.y, r.y); m.h = Math.max(m.h, r.h); } else merged.push({ ...r });
      }
      const type = state.tool;
      state.addAnnot({ type, page, rects: merged, ...state.opts[type] }, { select: false });
    }
    sel.removeAllRanges();
  };
  viewer.root.addEventListener('pointerup', () => setTimeout(onSelectionEnd, 0));

  /* ---------- clavier ---------- */
  const typing = (e) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable;
  const onKey = (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 's') { e.preventDefault(); if (state.pdf) openExportDialog(); return; }
    if (mod && key === 'f') { e.preventDefault(); if (state.pdf) find.open(); return; }
    if (mod && key === 'o') { e.preventDefault(); openFilePicker(); return; }
    if (typing(e)) return;
    if (mod && key === 'z') { e.preventDefault(); e.shiftKey ? state.redo() : state.undo(); return; }
    if (mod && key === 'y') { e.preventDefault(); state.redo(); return; }
    if (mod && key === 'd') { e.preventDefault(); duplicateSelection(); return; }
    if (mod && key === 'a') { e.preventDefault(); state.setSelection(state.annotsOnPage(state.currentPage).map((a) => a.id)); return; }
    if (mod && (key === 'c' || key === 'x') && state.sel.size) {
      state.clipboard = structuredClone(state.selected());
      if (key === 'x') removeSelection();
      return;
    }
    if (mod && key === 'v' && state.clipboard.length && !e.__imagePaste) { pasteClipboard(); return; }
    if (mod) return;
    if (key === 'escape') { if (state.tool !== 'select') state.setTool('select'); else state.setSelection([]); return; }
    if ((key === 'delete' || key === 'backspace') && state.sel.size) { e.preventDefault(); removeSelection(); return; }
    if (key.startsWith('arrow') && state.sel.size) {
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      const dx = key === 'arrowleft' ? -d : key === 'arrowright' ? d : 0, dy = key === 'arrowup' ? -d : key === 'arrowdown' ? d : 0;
      nudge(dx, dy);
      return;
    }
    if (key === '+' || key === '=') { viewer.setZoom(state.zoom * 1.15); return; }
    if (key === '-') { viewer.setZoom(state.zoom / 1.15); return; }
    if (key === '0') { viewer.fitWidth(); return; }
    if (key === 'pagedown') { viewer.scrollToPage(Math.min(state.pages.length - 1, state.currentPage + 1), true); return; }
    if (key === 'pageup') { viewer.scrollToPage(Math.max(0, state.currentPage - 1), true); return; }
    if (SHORTCUTS[key] && state.pdf && !e.altKey) { selectTool(SHORTCUTS[key]); }
  };
  let nudgeT = 0;
  function nudge(dx, dy) {
    if (Date.now() - nudgeT > 600) state.checkpoint();
    nudgeT = Date.now();
    state.selected().forEach((a) => state.updateAnnot(a.id, translatePatch(a, dx, dy)));
  }
  function pasteClipboard() {
    state.checkpoint();
    const ids = [];
    for (const a of state.clipboard) {
      const c = structuredClone(a);
      c.id = uid();
      c.page = state.currentPage;
      const off = 18;
      if (c.type === 'line' || c.type === 'arrow') { c.x1 += off; c.y1 += off; c.x2 += off; c.y2 += off; }
      else if (c.type === 'ink') c.points = c.points.map(([x, y]) => [x + off, y + off]);
      else if (c.rects) c.rects = c.rects.map((r) => ({ ...r, x: r.x + off, y: r.y + off }));
      else { c.x += off; c.y += off; delete c.covers; }
      state.annots.push(c);
      ids.push(c.id);
    }
    state.emit('annots', { all: true });
    state.setSelection(ids);
  }
  window.addEventListener('keydown', onKey);
  cleanups.push(() => window.removeEventListener('keydown', onKey));

  // collage d'image
  const onPaste = (e) => {
    if (typing(e) || !state.pdf) return;
    const f = [...(e.clipboardData?.files || [])].find((x) => isImage(x));
    if (f) { e.preventDefault(); run(() => placeImageAt(f)); }
  };
  document.addEventListener('paste', onPaste);
  cleanups.push(() => document.removeEventListener('paste', onPaste));

  // zoom molette (Ctrl) / pincement
  scroller.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const r = scroller.getBoundingClientRect();
    viewer.setZoom(state.zoom * Math.exp(-e.deltaY * 0.0022), { x: e.clientX - r.left, y: e.clientY - r.top });
  }, { passive: false });

  // glisser-déposer
  stage.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); stage.classList.add('drop'); } });
  stage.addEventListener('dragleave', (e) => { if (e.target === stage || !stage.contains(e.relatedTarget)) stage.classList.remove('drop'); });
  stage.addEventListener('drop', async (e) => {
    stage.classList.remove('drop');
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    e.preventDefault();
    const pdf = files.find(isPdf), img = files.find(isImage);
    if (pdf) {
      if (state.pdf && state.dirty && !(await confirmDialog({ title: t('Ouvrir un autre document ?'), message: t('Les modifications non enregistrées seront perdues.'), okLabel: t('Ouvrir') }))) return;
      const doc = await loadPdfFile(pdf);
      if (doc) await openDocument(doc);
    } else if (img && state.pdf) run(() => placeImageAt(img, e.clientX, e.clientY));
  });

  window.addEventListener('beforeunload', beforeUnload);
  function beforeUnload(e) { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } }
  cleanups.push(() => window.removeEventListener('beforeunload', beforeUnload));

  /* ---------- menu Fichier ---------- */
  async function openFilePicker() {
    const f = await pickFile('.pdf,application/pdf');
    if (!f) return;
    if (state.pdf && state.dirty && !(await confirmDialog({ title: t('Ouvrir un autre document ?'), message: t('Les modifications non enregistrées seront perdues.'), okLabel: t('Ouvrir') }))) return;
    const doc = await loadPdfFile(f);
    if (doc) await openDocument(doc);
  }

  async function insertPdfDialog() {
    if (!state.pdf) return;
    const f = await pickFile('.pdf,application/pdf');
    if (!f) return;
    const doc = await loadPdfFile(f);
    if (!doc) return;
    const n = await insertPdf(state, doc.bytes, state.currentPage + 1);
    toast(t('{n} page(s) insérée(s) après la page {p}.', { n, p: state.currentPage + 1 }), 'success');
  }

  function openFileMenu(anchor) {
    document.querySelector('.menu')?.remove();
    const mk = (ic, label, fn, kbd) => h('button', { class: 'menu-item', onclick: () => { menu.remove(); run(fn); } }, icon(ic, 16), h('span', {}, label), kbd ? h('span', { class: 'kbd' }, kbd) : null);
    const have = !!state.pdf;
    const menu = h('div', { class: 'menu' },
      mk('upload', t('Ouvrir un PDF…'), openFilePicker, 'Ctrl+O'),
      mk('plus', t('Nouveau document vierge'), async () => { await openDocument({ name: 'nouveau.pdf', bytes: await blankDocument() }); }),
      h('div', { class: 'menu-sep' }),
      have ? mk('files', t('Insérer un PDF après la page courante…'), insertPdfDialog) : null,
      have ? mk('check', t('Appliquer les modifications au document'), bakeChanges) : null,
      have ? mk('flatten', t('Aplatir les champs de formulaire'), async () => { const { flattenForms } = await import('../lib/pdf-ops.js'); const bytes = await flattenForms(state.bytes); state.checkpoint(); state.formValues.clear(); await state.setBytes(bytes); toast(t('Formulaires aplatis.'), 'success'); }) : null,
      have ? mk('eye', t('Imprimer…'), printDoc, 'Ctrl+P') : null,
      have ? h('div', { class: 'menu-sep' }) : null,
      have ? h('div', { class: 'menu-label' }, t('Utiliser un outil sur ce document')) : null,
      ...(have ? [['compress', 'compress', 'Compresser un PDF'], ['lock', 'protect', 'Protéger par mot de passe'], ['drop', 'watermark', 'Filigrane'], ['hash', 'page-numbers', 'Numéroter les pages'], ['split', 'split', 'Diviser un PDF'], ['image', 'pdf2img', 'PDF → Images'], ['ocr', 'ocr', 'OCR — texte des scans']].map(([ic, id, label]) => mk(ic, t(label), () => sendToTool(id))) : []),
      h('div', { class: 'menu-sep' }),
      have ? mk('download', t('Télécharger…'), openExportDialog, 'Ctrl+S') : null,
      h('div', { class: 'menu-sep' }),
      mk('home', t('Retour à l’accueil'), () => navigate('/')));
    const r = anchor.getBoundingClientRect();
    menu.style.left = `${r.left}px`; menu.style.top = `${r.bottom + 6}px`;
    document.body.append(menu);
    const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', close, true); } };
    setTimeout(() => document.addEventListener('mousedown', close, true), 0);
  }

  /** Exporte le document (annotations incluses) et l'ouvre dans une page d'outil. */
  async function sendToTool(id) {
    const pm = progressModal(t('Préparation…'));
    try {
      const bytes = await exportPdf(state, { onProgress: (p) => pm.set(p) });
      saveSession(state);
      setPending({ name: state.name, bytes, pages: state.pages.length, size: bytes.length });
      navigate(`/tool/${id}`);
    } finally { pm.close(); }
  }

  async function bakeChanges() {
    const pm = progressModal(t('Application des modifications…'));
    try {
      const bytes = await exportPdf(state, { onProgress: (p, txt) => pm.set(p, txt) });
      state.checkpoint();
      state.annots = []; state.sel = new Set(); state.formValues = new Map();
      await state.setBytes(bytes);
      state.emit('annots', { all: true });
      toast(t('Modifications appliquées au document.'), 'success');
    } finally { pm.close(); }
  }

  async function printDoc() {
    const pm = progressModal(t('Préparation de l’impression…'));
    try {
      const bytes = await exportPdf(state, { onProgress: (p) => pm.set(p) });
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const f = h('iframe', { src: url, style: { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' } });
      document.body.append(f);
      f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch { window.open(url); } setTimeout(() => { f.remove(); URL.revokeObjectURL(url); }, 60000); };
    } finally { pm.close(); }
  }

  function openExportDialog() {
    if (!state.pdf) return;
    const name = h('input', { class: 'input', value: `${baseName(state.name)}${state.annots.length || state.formValues.size ? '-modifié' : ''}.pdf` });
    const flat = h('input', { type: 'checkbox', checked: false });
    const hasForm = forms.count > 0;
    const redacts = state.annots.some((a) => a.type === 'redact');
    const m = openModal({
      title: t('Télécharger le PDF'),
      width: 460,
      content: h('div', {},
        h('label', { class: 'field' }, h('span', {}, t('Nom du fichier')), name),
        hasForm ? h('label', { class: 'check' }, flat, t('Aplatir les champs de formulaire (non modifiables ensuite)')) : null,
        redacts ? h('div', { class: 'note' }, icon('shield', 16), h('span', {}, t('Les pages caviardées seront converties en images : le texte masqué est définitivement supprimé.'))) : null,
        h('p', { class: 'muted', style: { fontSize: '.85rem' } }, `${pagesLabel(state.pages.length)} · ${state.annots.length} ${t('objet(s) ajouté(s)')}`)),
      actions: [
        { label: t('Annuler'), value: null },
        {
          label: t('Télécharger'), primary: true, close: false,
          onClick: async (close) => {
            const pm = progressModal(t('Création du PDF…'));
            try {
              const bytes = await exportPdf(state, { flattenForms: flat.checked, onProgress: (p, txt) => pm.set(p, txt) });
              let fn = name.value.trim() || 'document.pdf';
              if (!/\.pdf$/i.test(fn)) fn += '.pdf';
              downloadBlob(new Blob([bytes], { type: 'application/pdf' }), fn);
              state.dirty = false;
              pm.close();
              close();
              toast(t('PDF enregistré ({size}).', { size: formatBytes(bytes.length) }), 'success');
            } catch (e) { pm.close(); console.error(e); toastError(e.message || String(e)); }
            return false;
          },
        },
      ],
    });
    void m;
  }

  /* ---------- sauvegarde automatique ---------- */
  const autosave = debounce(() => { if (state.pdf && state.dirty) saveSession(state); }, 1500);
  ['annots', 'history', 'doc'].forEach((evt) => state.on(evt, autosave));
  async function restoreSession(data) {
    await openDocument({ name: data.name, bytes: data.bytes });
    for (const a of data.assets) {
      state.assets.set(a.id, { ...a, url: URL.createObjectURL(new Blob([a.bytes], { type: a.mime })) });
    }
    state.annots = data.annots;
    state.formValues = new Map(data.formValues);
    state.emit('annots', { all: true });
    state.dirty = true;
    toast(t('Travail restauré.'), 'success');
  }

  /* ---------- état vide ---------- */
  const fileIn = h('input', { type: 'file', accept: '.pdf,application/pdf', hidden: true });
  fileIn.addEventListener('change', async () => { const f = fileIn.files[0]; fileIn.value = ''; if (!f) return; const doc = await loadPdfFile(f); if (doc) openDocument(doc); });
  const emptyEl = h('div', { class: 'ed-empty' },
    h('div', { class: 'ed-empty-card' },
      h('div', { class: 'big-ic' }, icon('upload', 30)),
      h('h2', {}, t('Ouvrez un PDF pour commencer')),
      h('p', { class: 'muted' }, t('Glissez-déposez un fichier ici, ou choisissez-le sur votre appareil. Rien n’est envoyé sur Internet.')),
      h('div', { class: 'ed-empty-actions' },
        h('button', { class: 'btn btn-primary btn-lg', onclick: () => fileIn.click() }, icon('upload', 18), t('Choisir un PDF')),
        h('button', { class: 'btn btn-lg', onclick: async () => openDocument({ name: 'nouveau.pdf', bytes: await blankDocument() }) }, icon('plus', 18), t('Page vierge')),
        h('a', { class: 'btn btn-lg btn-ghost', href: '#/tool/img2pdf' }, icon('image', 18), t('Depuis des images'))),
      fileIn));
  stage.append(emptyEl);
  loadSession().then((data) => {
    if (!data || state.pdf || !data.annots?.length) return;
    const ago = Math.max(1, Math.round((Date.now() - data.savedAt) / 60000));
    const card = h('div', { class: 'restore' },
      icon('save', 20),
      h('div', {}, h('b', {}, t('Reprendre « {name} » ?', { name: data.name })), h('div', { class: 'muted' }, t('{n} modification(s) · enregistré il y a {m} min', { n: data.annots.length, m: ago }))),
      h('button', { class: 'btn btn-primary btn-sm', onclick: () => { card.remove(); restoreSession(data); } }, t('Reprendre')),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { card.remove(); clearSession(); } }, t('Ignorer')));
    emptyEl.querySelector('.ed-empty-card').append(card);
  });

  // outil présélectionné via l'URL, document en attente (depuis l'accueil / un outil)
  if (window.innerWidth < 1180) { ed.classList.add('no-sidebar'); sidebarBtn.classList.remove('active'); }
  if (window.innerWidth < 900) { ed.classList.add('no-props'); propsBtn.classList.remove('active'); }
  const pending = takePending();
  if (pending) {
    await openDocument(pending);
    if (query.tool && query.tool !== 'select') selectTool(query.tool);
  } else if (query.tool) {
    emptyEl.querySelector('p').textContent = t('Ouvrez d’abord un PDF, puis l’outil « {tool} » sera activé.', { tool: t(TITLES[query.tool] || query.tool) });
    const stop = state.on('doc', () => { stop(); setTimeout(() => selectTool(query.tool), 300); });
  }
  prefs.set('lastTool', query.tool || 'select');

  // pour les tests / le débogage
  window.__fragpdf = { state, viewer, annots, exportPdf, openDocument };

  return () => {
    cleanups.forEach((c) => c());
    annots.destroy();
    viewer.destroy();
    state.pdf?.destroy();
    delete window.__fragpdf;
  };
}
