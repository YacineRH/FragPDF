import { h, parseRangeGroups, parsePageRanges, baseName } from '../lib/utils.js';
import { t } from '../i18n.js';
import { fileTool, ui, outName } from './framework.js';
import { mergePdfs, splitGroups, everyN, extractPages } from '../lib/pdf-ops.js';

export const merge = fileTool({
  accept: 'pdf', multiple: true, minFiles: 2, reorder: true,
  dropTitle: 'Glissez les PDF à fusionner',
  runLabel: 'Fusionner les PDF', runIcon: 'merge',
  options: (ctx) => {
    const name = h('input', { class: 'input', value: t('fusion') });
    return {
      el: h('div', {},
        ui.note(t('Glissez les vignettes pour changer l’ordre. Les documents seront assemblés de gauche à droite.')),
        h('div', { style: { height: '.8rem' } }),
        ui.field(t('Nom du fichier'), name)),
      get: () => ({ name: (name.value || t('fusion')).replace(/\.pdf$/i, '') }),
    };
  },
  async run({ files, opts, progress }) {
    progress(0.1, t('Assemblage…'));
    const bytes = await mergePdfs(files.map((f) => ({ bytes: f.bytes })));
    const pages = files.reduce((s, f) => s + f.pages, 0);
    return { title: t('PDF fusionné !'), outputs: [{ name: `${opts.name}.pdf`, data: bytes }], stats: [{ label: t('Documents'), value: String(files.length) }, { label: t('Pages'), value: String(pages) }] };
  },
});

export const split = fileTool({
  accept: 'pdf', multiple: false,
  runLabel: 'Diviser le PDF', runIcon: 'split',
  options: (ctx) => {
    const f = ctx.files[0];
    const mode = ui.seg([['ranges', t('Plages')], ['every', t('Toutes les N')], ['each', t('Page par page')]], 'ranges', (v) => draw(v));
    const body = h('div', { style: { marginTop: '.9rem' } });
    const ranges = h('input', { class: 'input', placeholder: '1-3, 5, 7-', value: `1-${Math.ceil(f.pages / 2)}, ${Math.ceil(f.pages / 2) + 1}-` });
    const n = h('input', { class: 'input', type: 'number', min: 1, max: f.pages, value: Math.min(2, f.pages) });
    const merged = ui.check(t('Fusionner toutes les plages en un seul PDF'), false);
    function draw(m) {
      body.replaceChildren();
      if (m === 'ranges') body.append(ui.field(t('Plages de pages ({n} pages au total)', { n: f.pages }), ranges, t('Chaque plage séparée par une virgule devient un fichier.')), merged.el);
      if (m === 'every') body.append(ui.field(t('Nombre de pages par fichier'), n));
      if (m === 'each') body.append(ui.note(t('Chaque page deviendra un PDF distinct ({n} fichiers).', { n: f.pages })));
    }
    draw('ranges');
    return {
      el: h('div', {}, mode.el, body),
      get: () => ({ mode: mode.get(), ranges: ranges.value, n: parseInt(n.value, 10) || 1, merged: merged.input.checked }),
    };
  },
  async run({ files, opts, progress }) {
    const f = files[0];
    let groups;
    if (opts.mode === 'ranges') {
      groups = parseRangeGroups(opts.ranges, f.pages);
      if (!groups.length) throw new Error(t('Indiquez au moins une plage valide.'));
      if (opts.merged) {
        const idx = groups.flat();
        const bytes = await extractPages(f.bytes, idx);
        return { title: t('Pages extraites !'), outputs: [{ name: outName(f, 'extrait'), data: bytes }], stats: [{ label: t('Pages'), value: String(idx.length) }] };
      }
    } else if (opts.mode === 'every') groups = everyN(f.pages, Math.max(1, opts.n));
    else groups = everyN(f.pages, 1);
    progress(0.2, t('Découpe…'));
    const parts = await splitGroups(f.bytes, groups);
    const pad = String(parts.length).length;
    const outputs = parts.map((p, i) => {
      const a = p.indices[0] + 1, b = p.indices[p.indices.length - 1] + 1;
      return { name: `${baseName(f.name)}-${String(i + 1).padStart(pad, '0')}-p${a === b ? a : `${a}-${b}`}.pdf`, data: p.bytes };
    });
    return { title: t('PDF divisé !'), outputs, zipName: baseName(f.name) + '-parts', stats: [{ label: t('Fichiers'), value: String(outputs.length) }] };
  },
});

export { parsePageRanges };
