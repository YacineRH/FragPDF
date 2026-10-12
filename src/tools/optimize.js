import { h, formatBytes, baseName } from '../lib/utils.js';
import { icon } from '../ui/icons.js';
import { t } from '../i18n.js';
import { fileTool, ui, outName } from './framework.js';
import { compressPdf, LEVELS } from '../lib/compress.js';
import { repairPdf, linearizePdf } from '../lib/security.js';
import { loadDoc, save } from '../lib/pdf-ops.js';

export const compress = fileTool({
  accept: 'pdf', multiple: true, reorder: false, runLabel: 'Compresser', runIcon: 'compress',
  dropTitle: 'Glissez les PDF à compresser',
  options: () => {
    let level = 'medium';
    const info = {
      low: ['Légère', 'Qualité quasi identique, gain modeste.'],
      medium: ['Recommandée', 'Excellent compromis qualité / poids.'],
      high: ['Forte', 'Images réduites, poids minimal lisible.'],
      extreme: ['Extrême', 'Pages converties en images : texte non sélectionnable.'],
    };
    const box = h('div', {});
    const draw = () => box.replaceChildren(...Object.keys(info).map((k) => h('div', { class: `level-opt ${k === level ? 'on' : ''}`, onclick: () => { level = k; draw(); } },
      h('input', { type: 'radio', name: 'lvl', checked: k === level }), h('div', {}, h('b', {}, t(info[k][0])), h('small', {}, t(info[k][1]))))));
    draw();
    return { el: box, get: () => ({ level }) };
  },
  async run({ files, opts, progress }) {
    const outputs = [];
    let before = 0, after = 0;
    const notes = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const r = await compressPdf(f.bytes, opts.level, (p) => progress((i + p) / files.length, `${f.name}`));
      before += r.before; after += r.after;
      outputs.push({ name: outName(f, 'compressé'), data: r.bytes });
      notes.push(`${f.name} : ${r.method}`);
    }
    const saved = before ? Math.max(0, 1 - after / before) : 0;
    return {
      title: saved > 0.01 ? t('PDF allégé de {p} % !', { p: Math.round(saved * 100) }) : t('Déjà bien optimisé'),
      message: saved > 0.01 ? null : t('Ce document ne contient presque rien à compresser. Essayez un niveau plus fort.'),
      outputs, zipName: 'compressés',
      stats: [{ label: t('Avant'), value: formatBytes(before) }, { label: t('Après'), value: formatBytes(after) }, { label: t('Gain'), value: `−${Math.round(saved * 100)} %` }],
      extra: h('p', { class: 'muted' }, notes.join(' · ')),
    };
  },
});

export const repair = fileTool({
  accept: 'pdf', multiple: false, runLabel: 'Réparer', runIcon: 'repair',
  options: () => {
    const lin = ui.check(t('Optimiser pour l’affichage web (linéarisation)'), false);
    return { el: h('div', {}, ui.note(t('FragPDF reconstruit la table des objets et réécrit le fichier proprement.')), h('div', { style: { height: '.8rem' } }), lin.el), get: () => ({ lin: lin.input.checked }) };
  },
  async run({ files, opts, progress }) {
    const f = files[0];
    progress(0.3, t('Reconstruction…'));
    let bytes;
    try { bytes = await repairPdf(f.bytes); } catch { bytes = f.bytes; }
    const doc = await loadDoc(bytes);
    bytes = await save(doc);
    if (opts.lin) { progress(0.8); try { bytes = await linearizePdf(bytes); } catch { /* ignoré */ } }
    return { title: t('Document réparé !'), outputs: [{ name: outName(f, 'réparé'), data: bytes }], stats: [{ label: t('Pages'), value: String(doc.getPageCount()) }, { label: t('Taille'), value: formatBytes(bytes.length) }] };
  },
});

const LANGS = [['fra', 'Français'], ['eng', 'English'], ['spa', 'Español'], ['deu', 'Deutsch'], ['ita', 'Italiano'], ['por', 'Português'], ['nld', 'Nederlands'], ['ara', 'العربية'], ['rus', 'Русский']];

export const ocr = fileTool({
  accept: 'pdf', multiple: false, runLabel: 'Lancer la reconnaissance', runIcon: 'ocr',
  options: () => {
    const lang = ui.select(LANGS, 'fra');
    const scale = ui.select([['1.5', t('Rapide')], ['2', t('Équilibré')], ['3', t('Précis (lent)')]], '2');
    return {
      el: h('div', {}, ui.field(t('Langue du document'), lang), ui.field(t('Qualité'), scale),
        ui.note(t('Le texte reconnu est ajouté de façon invisible sous l’image : le document garde son apparence mais devient cherchable et copiable. Les données de langue sont téléchargées une fois depuis Internet ; vos pages restent sur votre appareil.'))),
      get: () => ({ lang: lang.value, scale: parseFloat(scale.value) }),
    };
  },
  async run({ files, opts, progress }) {
    const f = files[0];
    const { runOcr } = await import('../lib/ocr.js');
    const bytes = await runOcr(f.bytes, opts, (p, txt) => progress(p, txt));
    return { title: t('Texte reconnu !'), message: t('Essayez de rechercher ou sélectionner du texte dans le nouveau PDF.'), outputs: [{ name: outName(f, 'ocr'), data: bytes }], stats: [{ label: t('Pages'), value: String(f.pages) }] };
  },
});
