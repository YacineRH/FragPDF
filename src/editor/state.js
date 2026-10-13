// État de l'éditeur : document, annotations, sélection, outil actif, historique (annuler/rétablir).
import { uid } from '../lib/utils.js';
import { openPdf } from '../lib/pdfjs.js';
import { t } from '../i18n.js';

export const DEFAULT_OPTS = {
  text: { fontId: 'helvetica', size: 18, color: '#111111', bold: false, italic: false, underline: false, align: 'left', bg: null, opacity: 1 },
  shape: { stroke: '#e5384f', strokeW: 2, fill: null, fillOpacity: 0.25, opacity: 1 },
  line: { stroke: '#e5384f', strokeW: 3, opacity: 1 },
  ink: { stroke: '#2563eb', strokeW: 3, opacity: 1 },
  hlMode: 'text',
  highlight: { color: '#ffe14d', opacity: 1 },
  underline: { color: '#e5384f', opacity: 1 },
  strike: { color: '#e5384f', opacity: 1 },
  whiteout: { color: '#ffffff' },
  redact: {},
  mark: { kind: 'check', color: '#16a34a' },
  stamp: { label: 'APPROUVÉ', color: '#16a34a' },
  link: { url: 'https://' },
};

export class EditorState {
  constructor() {
    this.name = 'document.pdf';
    this.bytes = null;
    this.pdf = null;
    this.pages = []; // [{w, h, rotation}] tailles visuelles en points
    this.annots = [];
    this.assets = new Map(); // id -> {url, bytes, mime, w, h}
    this.formValues = new Map(); // nom de champ -> valeur
    this.sel = new Set();
    this.tool = 'select';
    this.opts = structuredClone(DEFAULT_OPTS);
    this.opts.stamp.label = t('APPROUVÉ');
    this.zoom = 1;
    this.currentPage = 0;
    this.dirty = false;
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Map();
    this.clipboard = [];
    this.placing = null; // image en attente de placement {assetId, w, h, defaultW}
    this.version = 0; // incrémenté à chaque changement des octets (invalide les caches)
  }

  on(evt, fn) {
    if (!this.listeners.has(evt)) this.listeners.set(evt, new Set());
    this.listeners.get(evt).add(fn);
    return () => this.listeners.get(evt).delete(fn);
  }
  emit(evt, data) { this.listeners.get(evt)?.forEach((fn) => fn(data)); }

  /** (Re)charge les octets du document courant. */
  async setBytes(bytes, { name } = {}) {
    const pdf = await openPdf(bytes);
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const p = await pdf.getPage(i);
      const vp = p.getViewport({ scale: 1 });
      pages.push({ w: vp.width, h: vp.height, rotation: p.rotate });
      p.cleanup();
    }
    const old = this.pdf;
    this.bytes = bytes;
    this.pdf = pdf;
    this.pages = pages;
    this.version++;
    if (name) this.name = name;
    old?.destroy();
    this.emit('doc');
  }

  /* ---------- annotations ---------- */
  getAnnot(id) { return this.annots.find((a) => a.id === id); }
  annotsOnPage(i) { return this.annots.filter((a) => a.page === i); }
  selected() { return this.annots.filter((a) => this.sel.has(a.id)); }

  addAnnot(a, { select = true, silent = false } = {}) {
    const ann = { id: uid(), rot: 0, ...a };
    this.annots.push(ann);
    if (select) this.setSelection([ann.id], true);
    if (!silent) { this.dirty = true; this.emit('annots', { pages: [ann.page] }); }
    return ann;
  }

  updateAnnot(id, patch, { silent = false } = {}) {
    const a = this.getAnnot(id);
    if (!a) return;
    Object.assign(a, patch);
    if (!silent) { this.dirty = true; this.emit('annots', { pages: [a.page], ids: [id] }); }
  }

  removeAnnots(ids) {
    const set = new Set(ids);
    const pages = new Set(this.annots.filter((a) => set.has(a.id)).map((a) => a.page));
    this.annots = this.annots.filter((a) => !set.has(a.id));
    ids.forEach((id) => this.sel.delete(id));
    this.dirty = true;
    this.emit('annots', { pages: [...pages] });
    this.emit('selection');
  }

  setSelection(ids, silent = false) {
    this.sel = new Set(ids);
    if (!silent) this.emit('selection');
    else queueMicrotask(() => this.emit('selection'));
  }

  setTool(tool) {
    if (this.tool === tool) return;
    this.tool = tool;
    if (tool !== 'select') this.sel = new Set();
    this.emit('tool', tool);
    this.emit('selection');
  }

  /* ---------- historique ---------- */
  snapshot() {
    return {
      bytes: this.bytes,
      annots: structuredClone(this.annots),
      formValues: new Map(this.formValues),
    };
  }

  /** À appeler AVANT une modification pour pouvoir l'annuler. */
  checkpoint() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    this.emit('history');
  }

  async restore(snap) {
    const bytesChanged = snap.bytes !== this.bytes;
    if (bytesChanged) await this.setBytes(snap.bytes);
    this.annots = structuredClone(snap.annots);
    this.formValues = new Map(snap.formValues);
    this.sel = new Set([...this.sel].filter((id) => this.annots.some((a) => a.id === id)));
    this.dirty = true;
    this.emit('annots', { all: true });
    this.emit('selection');
    this.emit('history');
  }

  /** Sérialise undo / redo : un restore asynchrone doit être terminé avant le suivant. */
  serial(fn) { this._q = (this._q || Promise.resolve()).then(fn, fn); return this._q; }

  undo() {
    return this.serial(async () => {
      if (!this.undoStack.length) return;
      this.redoStack.push(this.snapshot());
      await this.restore(this.undoStack.pop());
    });
  }

  redo() {
    return this.serial(async () => {
      if (!this.redoStack.length) return;
      this.undoStack.push(this.snapshot());
      await this.restore(this.redoStack.pop());
    });
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  /* ---------- assets (images) ---------- */
  addAsset({ bytes, mime, url, w, h }) {
    const id = uid();
    this.assets.set(id, { id, bytes, mime, url, w, h });
    return id;
  }
}
