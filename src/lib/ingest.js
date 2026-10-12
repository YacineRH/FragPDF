// Lecture d'un fichier PDF : détection du chiffrement, demande du mot de passe, miniatures.
import { readFileBytes, h } from './utils.js';
import { probePdf, openPdf, renderPageToCanvas } from './pdfjs.js';
import { decryptPdf, repairPdf } from './security.js';
import { prompt } from '../ui/modal.js';
import { toastError } from '../ui/toast.js';
import { t } from '../i18n.js';

export function isPdf(file) { return file.type === 'application/pdf' || /\.pdf$/i.test(file.name); }
export function isImage(file) { return /^image\//.test(file.type) || /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(file.name); }

/**
 * Charge un fichier PDF. Si besoin demande le mot de passe et renvoie une version déchiffrée.
 * @returns {Promise<{name:string, bytes:Uint8Array, pages:number, size:number, decrypted?:boolean}|null>}
 */
export async function loadPdfFile(file, { allowRepair = true } = {}) {
  let bytes = await readFileBytes(file);
  if (!/%PDF-/.test(String.fromCharCode(...bytes.slice(0, 1024)))) {
    toastError(t('« {name} » n’est pas un PDF valide.', { name: file.name }));
    return null;
  }
  let probe = await probePdf(bytes);
  let decrypted = false;
  let tries = 0;
  while (!probe.ok && probe.needsPassword && tries < 5) {
    const pw = await prompt({
      title: t('Document protégé'),
      label: probe.wrong || tries ? t('Mot de passe incorrect — réessayez') : t('Saisissez le mot de passe de « {name} »', { name: file.name }),
      type: 'password', okLabel: t('Déverrouiller'),
    });
    if (pw === null) return null;
    try {
      bytes = await decryptPdf(bytes, pw);
      probe = await probePdf(bytes);
      decrypted = true;
    } catch { /* mot de passe invalide */ }
    tries++;
  }
  if (!probe.ok && allowRepair) {
    try { bytes = await repairPdf(bytes); probe = await probePdf(bytes); } catch { /* ignoré */ }
  }
  if (!probe.ok) {
    toastError(t('Impossible d’ouvrir « {name} ». Le fichier est peut-être corrompu.', { name: file.name }));
    return null;
  }
  return { name: file.name, bytes, pages: probe.pages, size: file.size, decrypted };
}

const thumbCache = new WeakMap();
/** Miniature de la première page (canvas) */
export async function firstPageThumb(bytes, width = 180) {
  if (thumbCache.has(bytes)) return thumbCache.get(bytes).cloneNode ? cloneCanvas(thumbCache.get(bytes)) : null;
  const pdf = await openPdf(bytes);
  const page = await pdf.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const c = await renderPageToCanvas(page, (width / vp.width) * (window.devicePixelRatio > 1 ? 1.5 : 1));
  pdf.destroy();
  thumbCache.set(bytes, c);
  return cloneCanvas(c);
}
function cloneCanvas(c) {
  const n = document.createElement('canvas');
  n.width = c.width; n.height = c.height;
  n.getContext('2d').drawImage(c, 0, 0);
  return n;
}

/** Zone de dépôt réutilisable : renvoie l'élément ; accept = 'pdf' | 'image' | 'any' */
export function makeDropzone({ accept = 'pdf', multiple = true, onFiles, title, subtitle, icon: ic }) {
  const exts = accept === 'pdf' ? '.pdf,application/pdf' : accept === 'image' ? 'image/*' : accept === 'text' ? '.txt,.md,text/plain' : '*/*';
  const input = h('input', { type: 'file', accept: exts, multiple, hidden: true });
  const el = h('div', { class: 'dropzone', tabindex: 0, role: 'button' }, ic, h('h3', {}, title), h('p', { class: 'muted' }, subtitle || t('ou cliquez pour parcourir')), input);
  const filt = (files) => [...files].filter((f) => (accept === 'pdf' ? isPdf(f) : accept === 'image' ? isImage(f) : true));
  el.addEventListener('click', () => input.click());
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => { const f = filt(input.files); input.value = ''; if (f.length) onFiles(multiple ? f : f.slice(0, 1)); });
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', (e) => {
    e.preventDefault(); el.classList.remove('over');
    const f = filt(e.dataTransfer.files);
    if (f.length) onFiles(multiple ? f : f.slice(0, 1));
    else toastError(t('Type de fichier non pris en charge ici.'));
  });
  return el;
}
