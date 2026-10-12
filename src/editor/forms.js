// Formulaires AcroForm : superpose des champs HTML aux widgets du PDF ; les valeurs sont écrites à l'export.
import { h } from '../lib/utils.js';
import { loadDoc } from '../lib/pdf-ops.js';
import { pageGeometry, userRectToVisual } from '../lib/geometry.js';
import { PDFName, PDFArray } from 'pdf-lib';

export class FormLayer {
  constructor(state, viewer) {
    this.state = state;
    this.viewer = viewer;
    this.fields = []; // {name, type, page, rect, options, value, onValue}
    this.version = -1;
    state.on('doc', () => this.load());
    state.on('annots', (e) => { if (e?.all) this.render(); });
    viewer.onPageDom(() => this.render());
    state.on('tool', () => this.viewer.root.classList.toggle('mode-forms', state.tool === 'forms'));
  }

  get count() { return this.fields.length; }

  async load() {
    const st = this.state;
    const ver = st.version;
    this.fields = [];
    try {
      const doc = await loadDoc(st.bytes);
      const form = doc.getForm();
      const pages = doc.getPages();
      const pageAnnots = pages.map((p) => (p.node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.asArray() || []).map((r) => r.toString()));
      for (const f of form.getFields()) {
        const type = f.constructor.name;
        if (!['PDFTextField', 'PDFCheckBox', 'PDFRadioGroup', 'PDFDropdown', 'PDFOptionList'].includes(type)) continue;
        const name = f.getName();
        let value = null, options = null;
        try {
          if (type === 'PDFTextField') value = f.getText() ?? '';
          else if (type === 'PDFCheckBox') value = f.isChecked();
          else if (type === 'PDFRadioGroup') { value = f.getSelected() ?? null; options = f.getOptions(); }
          else { value = f.getSelected()?.[0] ?? ''; options = f.getOptions(); }
        } catch { /* ignoré */ }
        const widgets = f.acroField.getWidgets();
        widgets.forEach((w, wi) => {
          const ref = doc.context.getObjectRef(w.dict)?.toString();
          const pi = ref ? pageAnnots.findIndex((l) => l.includes(ref)) : -1;
          if (pi < 0) return;
          const geo = pageGeometry(pages[pi]);
          const rect = userRectToVisual(geo, w.getRectangle());
          let onValue = null;
          if (type === 'PDFRadioGroup') { try { onValue = options[wi] ?? w.getOnValue()?.decodeText(); } catch { onValue = options?.[wi]; } }
          this.fields.push({ name, type, page: pi, rect, options, value, onValue, multiline: type === 'PDFTextField' && f.isMultiline?.(), maxLen: type === 'PDFTextField' ? f.getMaxLength?.() : undefined });
        });
      }
    } catch (e) { console.warn('formulaire', e); }
    if (ver === st.version) { this.render(); st.emit('forms', this.fields.length); }
  }

  render() {
    const st = this.state;
    this.viewer.wraps.forEach((d) => d.formLayer.replaceChildren());
    for (const f of this.fields) {
      const d = this.viewer.dom(f.page);
      if (!d) continue;
      const cur = st.formValues.has(f.name) ? st.formValues.get(f.name) : f.value;
      let el;
      const set = (v) => { if (!st.formValues.has(f.name)) st.checkpoint(); st.formValues.set(f.name, v); st.dirty = true; };
      const fs = Math.max(7, Math.min(f.rect.h * 0.7, 16));
      if (f.type === 'PDFTextField') {
        el = f.multiline ? h('textarea', { class: 'form-field', style: { fontSize: `${fs * 0.85}px` } }) : h('input', { class: 'form-field', type: 'text', style: { fontSize: `${fs}px` } });
        el.value = cur ?? '';
        if (f.maxLen) el.maxLength = f.maxLen;
        el.addEventListener('input', () => set(el.value));
      } else if (f.type === 'PDFCheckBox') {
        el = h('input', { class: 'form-field chk', type: 'checkbox' });
        el.checked = !!cur;
        el.addEventListener('change', () => set(el.checked));
      } else if (f.type === 'PDFRadioGroup') {
        el = h('input', { class: 'form-field chk', type: 'radio', name: `${f.name}-${f.page}` });
        el.checked = cur === f.onValue;
        el.addEventListener('change', () => { if (el.checked) { set(f.onValue); this.render(); } });
      } else {
        el = h('select', { class: 'form-field', style: { fontSize: `${fs * 0.9}px` } }, h('option', { value: '' }, ''), (f.options || []).map((o) => h('option', { value: o, selected: o === cur }, o)));
        el.addEventListener('change', () => set(el.value));
      }
      el.title = f.name;
      Object.assign(el.style, { left: `${f.rect.x}px`, top: `${f.rect.y}px`, width: `${f.rect.w}px`, height: `${f.rect.h}px` });
      d.formLayer.append(el);
    }
  }
}
