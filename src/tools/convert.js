import { h, baseName, readFileBytes, formatBytes } from '../lib/utils.js';
import { t } from '../i18n.js';
import { fileTool, ui, outName } from './framework.js';
import { imagesToPdf, textToPdf, PAGE_SIZES } from '../lib/pdf-ops.js';
import { pdfToImages, imagesToZip, pdfToText, pdfToDocx, pdfToTables, tablesToCsv, tablesToXlsx } from '../lib/convert.js';
import { FONTS } from '../lib/fonts.js';

export const imgToPdf = fileTool({
  accept: 'image', multiple: true, reorder: true, runLabel: 'Créer le PDF', runIcon: 'file',
  dropTitle: 'Glissez vos images ici',
  options: () => {
    const size = ui.select([['fit', t('Taille de l’image')], ['a4', 'A4'], ['letter', 'Letter'], ['a3', 'A3'], ['a5', 'A5'], ['legal', 'Legal']], 'a4');
    const orient = ui.select([['auto', t('Automatique')], ['portrait', t('Portrait')], ['landscape', t('Paysage')]], 'auto');
    const margin = ui.range(0, 80, 20, 2, (v) => `${v} pt`);
    const name = h('input', { class: 'input', value: t('images') });
    return {
      el: h('div', {}, ui.note(t('Glissez les vignettes pour modifier l’ordre des pages.')), h('div', { style: { height: '.8rem' } }),
        ui.field(t('Format de page'), size), ui.field(t('Orientation'), orient), ui.field(t('Marge'), margin.el), ui.field(t('Nom du fichier'), name)),
      get: () => ({ size: size.value, orientation: orient.value, margin: +margin.input.value, name: (name.value || t('images')).replace(/\.pdf$/i, '') }),
    };
  },
  async run({ files, opts, progress }) {
    progress(0.2, t('Conversion…'));
    const bytes = await imagesToPdf(files.map((f) => f.file), opts);
    return { title: t('PDF créé !'), outputs: [{ name: `${opts.name}.pdf`, data: bytes }], stats: [{ label: t('Pages'), value: String(files.length) }, { label: t('Taille'), value: formatBytes(bytes.length) }] };
  },
});

export const pdfToImg = fileTool({
  accept: 'pdf', multiple: false, runLabel: 'Convertir en images', runIcon: 'image',
  options: () => {
    const fmt = ui.select([['png', t('PNG (sans perte)')], ['jpg', t('JPG (léger)')], ['webp', 'WebP']], 'png');
    const dpi = ui.select([['1', '72 dpi'], ['1.5', '108 dpi'], ['2', '144 dpi'], ['3', '216 dpi'], ['4.17', '300 dpi']], '2');
    return { el: h('div', {}, ui.field(t('Format'), fmt), ui.field(t('Résolution'), dpi)), get: () => ({ format: fmt.value, scale: parseFloat(dpi.value) }) };
  },
  async run({ files, opts, progress }) {
    const f = files[0];
    const imgs = await pdfToImages(f.bytes, { format: opts.format, scale: opts.scale, onProgress: (p) => progress(p, t('Rendu des pages…')) });
    const ext = opts.format === 'jpeg' ? 'jpg' : opts.format;
    if (imgs.length === 1) return { title: t('Image créée !'), outputs: [{ name: `${baseName(f.name)}.${ext}`, data: imgs[0].blob }] };
    const zip = await imagesToZip(imgs, f.name, ext);
    return { title: t('{n} images créées !', { n: imgs.length }), outputs: [{ name: `${baseName(f.name)}-images.zip`, data: zip }], stats: [{ label: t('Images'), value: String(imgs.length) }, { label: t('Archive'), value: formatBytes(zip.size) }] };
  },
});

export const pdfToTxt = fileTool({
  accept: 'pdf', multiple: false, runLabel: 'Extraire le texte', runIcon: 'list',
  options: () => ({ el: ui.note(t('Pour un PDF scanné, utilisez d’abord l’outil OCR.')) }),
  async run({ files, progress }) {
    const f = files[0];
    progress(0.3, t('Extraction…'));
    const text = await pdfToText(f.bytes);
    if (!text.replace(/\s/g, '')) throw new Error(t('Aucun texte trouvé : ce PDF est probablement un scan. Essayez l’outil OCR.'));
    return { title: t('Texte extrait !'), outputs: [{ name: `${baseName(f.name)}.txt`, data: new Blob([text], { type: 'text/plain;charset=utf-8' }) }], stats: [{ label: t('Caractères'), value: String(text.length) }] };
  },
});

export const pdfToWord = fileTool({
  accept: 'pdf', multiple: false, runLabel: 'Convertir en Word', runIcon: 'book',
  options: () => ({ el: ui.note(t('Le texte et les titres sont récupérés. Les images et la mise en page complexe ne sont pas reproduites.')) }),
  async run({ files, progress }) {
    const f = files[0];
    progress(0.3, t('Analyse…'));
    const blob = await pdfToDocx(f.bytes);
    return { title: t('Document Word créé !'), outputs: [{ name: `${baseName(f.name)}.docx`, data: blob }], stats: [{ label: t('Taille'), value: formatBytes(blob.size) }] };
  },
});

export const txtToPdf = fileTool({
  accept: 'text', multiple: false, runLabel: 'Créer le PDF', runIcon: 'file',
  dropTitle: 'Glissez un fichier .txt ici',
  options: () => {
    const size = ui.select([['a4', 'A4'], ['letter', 'Letter'], ['a5', 'A5']], 'a4');
    const font = ui.select(FONTS.filter((f) => ['helvetica', 'times', 'courier', 'inter', 'lora', 'roboto-mono'].includes(f.id)).map((f) => [f.id, f.label]), 'inter');
    const fs = h('input', { class: 'input', type: 'number', min: 6, max: 40, value: 11 });
    return { el: h('div', {}, ui.field(t('Format'), size), ui.field(t('Police'), font), ui.field(t('Taille de police'), fs)), get: () => ({ pageSize: size.value, fontId: font.value, size: +fs.value || 11 }) };
  },
  async run({ files, opts }) {
    const f = files[0];
    const text = await f.file.text();
    const bytes = await textToPdf(text, opts);
    return { title: t('PDF créé !'), outputs: [{ name: `${baseName(f.name)}.pdf`, data: bytes }] };
  },
});

export const pdfToExcel = fileTool({
  accept: 'pdf', multiple: false, runLabel: 'Convertir en Excel', runIcon: 'grid',
  options: () => {
    const fmt = ui.select([['xlsx', 'Excel (.xlsx)'], ['csv', 'CSV (;)']], 'xlsx');
    return { el: h('div', {}, ui.field(t('Format'), fmt), ui.note(t('Les colonnes sont détectées d’après l’alignement du texte : idéal pour les relevés et tableaux simples. Un PDF scanné nécessite d’abord l’OCR.'))), get: () => ({ fmt: fmt.value }) };
  },
  async run({ files, opts, progress }) {
    const f = files[0];
    progress(0.3, t('Analyse des tableaux…'));
    const sheets = await pdfToTables(f.bytes);
    const cells = sheets.flat().reduce((s, r) => s + r.filter(Boolean).length, 0);
    if (!cells) throw new Error(t('Aucun texte trouvé : ce PDF est probablement un scan. Essayez l’outil OCR.'));
    const stats = [{ label: t('Lignes'), value: String(sheets.reduce((s, r) => s + r.length, 0)) }, { label: t('Cellules'), value: String(cells) }];
    if (opts.fmt === 'csv') return { title: t('CSV créé !'), outputs: [{ name: `${baseName(f.name)}.csv`, data: new Blob([tablesToCsv(sheets)], { type: 'text/csv;charset=utf-8' }) }], stats };
    return { title: t('Classeur Excel créé !'), outputs: [{ name: `${baseName(f.name)}.xlsx`, data: await tablesToXlsx(sheets) }], stats };
  },
});
