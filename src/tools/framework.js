// Cadre générique d'un outil « fichier(s) → options → résultat ».
import JSZip from 'jszip';
import { h, formatBytes, downloadBlob, uid, baseName } from '../lib/utils.js';
import { icon } from '../ui/icons.js';
import { t } from '../i18n.js';
import { makeDropzone, loadPdfFile, firstPageThumb } from '../lib/ingest.js';
import { progressModal } from '../ui/modal.js';
import { toastError } from '../ui/toast.js';
import { setPending, takePending } from '../lib/session.js';
import { navigate } from '../ui/chrome.js';

const MIME = { pdf: 'application/pdf', zip: 'application/zip', txt: 'text/plain', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

/**
 * def = {
 *   accept: 'pdf'|'image'|'text', multiple, minFiles, dropTitle, runLabel, runIcon,
 *   reorder: bool, options(ctx) -> {el, get(), onFiles?}, run({files, opts, progress}) -> result
 * }
 * result = { outputs:[{name, data, type?}], stats?:[{label,value}], title?, message?, extra?: Node }
 */
export function fileTool(def) {
  return {
    mount(host, meta) {
      const state = { files: [] };
      let optCtl = null;
      const ctx = { get files() { return state.files; }, meta, rerender: () => render(), toast: toastError };

      async function addFiles(list) {
        const pm = list.length > 1 || def.accept === 'pdf' ? progressModal(t('Lecture des fichiers…')) : null;
        try {
          let i = 0;
          for (const f of list) {
            pm?.set(i++ / list.length, f.name);
            if (def.accept === 'pdf') {
              const d = await loadPdfFile(f);
              if (d) state.files.push({ id: uid(), ...d, kind: 'pdf' });
            } else state.files.push({ id: uid(), name: f.name, file: f, size: f.size, kind: def.accept, url: def.accept === 'image' ? URL.createObjectURL(f) : null });
          }
        } finally { pm?.close(); }
        if (!def.multiple) state.files = state.files.slice(-1);
        render();
      }

      function removeFile(id) {
        const f = state.files.find((x) => x.id === id);
        if (f?.url) URL.revokeObjectURL(f.url);
        state.files = state.files.filter((x) => x.id !== id);
        render();
      }

      function fileCard(f) {
        const thumb = h('div', { class: 'file-thumb' });
        if (f.kind === 'pdf') firstPageThumb(f.bytes).then((c) => c && thumb.replaceChildren(c)).catch(() => thumb.replaceChildren(icon('file', 32)));
        else if (f.kind === 'image') thumb.append(h('img', { src: f.url, alt: f.name }));
        else thumb.append(icon('text', 32));
        const card = h('div', { class: 'file-card', draggable: !!(def.multiple && def.reorder !== false), dataset: { id: f.id } },
          thumb,
          h('div', { class: 'file-meta' },
            h('div', { class: 'file-name', title: f.name }, f.name),
            h('div', { class: 'file-sub' }, [f.pages ? `${f.pages} p.` : null, formatBytes(f.size)].filter(Boolean).join(' · '))),
          h('div', { class: 'file-actions' }, h('button', { class: 'icon-btn', title: t('Retirer'), onclick: () => removeFile(f.id) }, icon('x', 15))));
        if (def.multiple && def.reorder !== false) {
          card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', f.id); card.classList.add('dragging'); });
          card.addEventListener('dragend', () => card.classList.remove('dragging'));
          card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drop-before'); });
          card.addEventListener('dragleave', () => card.classList.remove('drop-before'));
          card.addEventListener('drop', (e) => {
            e.preventDefault(); e.stopPropagation(); card.classList.remove('drop-before');
            const from = e.dataTransfer.getData('text/plain');
            const a = state.files.findIndex((x) => x.id === from), b = state.files.findIndex((x) => x.id === f.id);
            if (a < 0 || a === b) return;
            const [m] = state.files.splice(a, 1);
            state.files.splice(b, 0, m);
            render();
          });
        }
        return card;
      }

      async function run() {
        const min = def.minFiles ?? 1;
        if (state.files.length < min) { toastError(t('Ajoutez au moins {n} fichier(s).', { n: min })); return; }
        let opts;
        try { opts = optCtl?.get?.() ?? {}; } catch (e) { toastError(e.message); return; }
        const pm = progressModal(t('Traitement en cours…'));
        try {
          const result = await def.run({ files: state.files, opts, progress: (p, txt) => pm.set(p, txt) });
          pm.close();
          showResult(result);
        } catch (e) {
          pm.close();
          console.error(e);
          toastError(e?.message || t('Une erreur est survenue.'));
        }
      }

      function showResult(res) {
        host.replaceChildren();
        const outs = res.outputs || [];
        const actions = h('div', { class: 'actions' });
        const total = outs.reduce((s, o) => s + (o.data.size ?? o.data.length ?? 0), 0);
        const mk = (o) => (o.data instanceof Blob ? o.data : new Blob([o.data], { type: o.type || MIME[o.name.split('.').pop()] || 'application/octet-stream' }));
        if (outs.length === 1) {
          actions.append(h('button', { class: 'btn btn-primary btn-lg', onclick: () => downloadBlob(mk(outs[0]), outs[0].name) }, icon('download', 20), t('Télécharger')));
        } else if (outs.length > 1) {
          actions.append(h('button', {
            class: 'btn btn-primary btn-lg', onclick: async () => {
              const zip = new JSZip();
              outs.forEach((o) => zip.file(o.name, mk(o)));
              downloadBlob(await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), `${res.zipName || 'fragpdf'}.zip`);
            },
          }, icon('download', 20), t('Tout télécharger (ZIP)')));
        }
        const pdfOut = outs.length === 1 && /\.pdf$/i.test(outs[0].name) ? outs[0] : null;
        if (pdfOut) {
          actions.append(h('button', {
            class: 'btn btn-lg', onclick: () => {
              setPending({ name: pdfOut.name, bytes: pdfOut.data instanceof Uint8Array ? pdfOut.data : new Uint8Array(), pages: 0, size: pdfOut.data.length });
              navigate('/editor');
            },
          }, icon('pen', 18), t('Ouvrir dans l’éditeur')));
        }
        actions.append(h('button', { class: 'btn btn-lg btn-ghost', onclick: () => { state.files = []; render(); } }, icon('plus', 18), t('Nouvelle opération')));
        const list = outs.length > 1 ? h('div', { class: 'split-list' }, outs.map((o) => h('div', { class: 'split-item' }, h('span', {}, o.name), h('span', { class: 'row', style: { display: 'flex', gap: '.6rem', alignItems: 'center' } }, h('span', { class: 'muted' }, formatBytes(o.data.size ?? o.data.length)), h('button', { class: 'icon-btn', title: t('Télécharger'), onclick: () => downloadBlob(mk(o), o.name) }, icon('download', 16)))))) : null;
        host.append(h('div', { class: 'panel result' },
          h('div', { class: 'ok-ic' }, icon('check', 36)),
          h('h2', {}, res.title || t('Terminé !')),
          res.message ? h('p', { class: 'muted' }, res.message) : null,
          h('div', { class: 'stats' }, (res.stats || [{ label: outs.length > 1 ? t('Fichiers') : t('Taille'), value: outs.length > 1 ? String(outs.length) : formatBytes(total) }]).map((s) => h('div', { class: 'stat' }, h('b', {}, s.value), h('span', {}, s.label)))),
          res.extra || null,
          actions, list));
      }

      function render() {
        host.replaceChildren();
        if (!state.files.length) {
          host.append(makeDropzone({
            accept: def.accept, multiple: !!def.multiple, onFiles: addFiles,
            title: def.dropTitle ? t(def.dropTitle) : (def.multiple ? t('Glissez vos fichiers ici') : t('Glissez votre fichier ici')),
            icon: h('div', { class: 'big-ic' }, icon('upload', 28)),
          }));
          optCtl = null;
          return;
        }
        optCtl = def.options?.(ctx) || null;
        optCtl?.onFiles?.(state.files);
        const adder = def.multiple ? makeAdder() : null;
        const left = h('div', {}, h('div', { class: 'file-list' }, state.files.map(fileCard), adder));
        if (def.leftExtra) left.append(def.leftExtra(ctx));
        const right = h('div', {},
          optCtl ? h('div', { class: 'panel' }, h('h3', {}, t('Options')), optCtl.el) : null,
          h('button', { class: 'btn btn-primary btn-lg run-btn', onclick: run }, icon(def.runIcon || 'zap', 18), def.runLabel ? t(def.runLabel) : t('Lancer')));
        host.append(h('div', { class: 'tool-layout' }, left, right));
      }

      function makeAdder() {
        const input = h('input', { type: 'file', multiple: true, hidden: true, accept: def.accept === 'pdf' ? '.pdf,application/pdf' : def.accept === 'image' ? 'image/*' : '.txt,.md,text/plain' });
        input.addEventListener('change', () => { const fs = [...input.files]; input.value = ''; if (fs.length) addFiles(fs); });
        return h('button', { class: 'add-card', onclick: () => input.click() }, icon('plus', 26), t('Ajouter des fichiers'), input);
      }

      render();
      // document transmis depuis l'éditeur (menu Fichier) : on le charge directement
      const pend = def.accept === 'pdf' ? takePending() : null;
      if (pend) { state.files.push({ id: uid(), ...pend, pages: pend.pages || 1, kind: 'pdf' }); if (!def.multiple) state.files = state.files.slice(-1); render(); }
      return () => state.files.forEach((f) => f.url && URL.revokeObjectURL(f.url));
    },
  };
}

export const outName = (file, suffix, ext = 'pdf') => `${baseName(file.name)}${suffix ? '-' + suffix : ''}.${ext}`;

/** Petits constructeurs de formulaires */
export const ui = {
  field(label, control, hint) {
    return h('label', { class: 'field' }, h('span', {}, label), control, hint ? h('small', { class: 'muted' }, hint) : null);
  },
  select(options, value) {
    const s = h('select', { class: 'input' }, options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
    return s;
  },
  check(label, checked = false) {
    const c = h('input', { type: 'checkbox', checked });
    return { el: h('label', { class: 'check' }, c, label), input: c };
  },
  range(min, max, value, step = 1, fmt = (v) => v) {
    const r = h('input', { type: 'range', min, max, step, value });
    const o = h('output', {}, fmt(value));
    r.addEventListener('input', () => { o.textContent = fmt(r.value); });
    return { el: h('div', { class: 'range-row' }, r, o), input: r };
  },
  note(text, ic = 'info') {
    return h('div', { class: 'note' }, icon(ic, 16), h('span', {}, text));
  },
  seg(options, value, onChange) {
    const wrap = h('div', { class: 'seg' });
    let cur = value;
    const draw = () => wrap.replaceChildren(...options.map(([v, l]) => h('button', { type: 'button', class: v === cur ? 'on' : '', onclick: () => { cur = v; draw(); onChange?.(v); } }, l)));
    draw();
    return { el: wrap, get: () => cur };
  },
};
