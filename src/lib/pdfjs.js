import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const BASE = import.meta.env.BASE_URL || './';
const abs = (p) => new URL(BASE + p, document.baseURI).href;

export { pdfjs };

/**
 * Ouvre un PDF avec pdf.js. Les octets sont copiés : pdf.js transfère le buffer au worker.
 * @returns {Promise<import('pdfjs-dist').PDFDocumentProxy>}
 */
export function openPdf(bytes, password) {
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    password,
    cMapUrl: abs('pdfjs/cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: abs('pdfjs/standard_fonts/'),
    wasmUrl: abs('pdfjs/wasm/'),
    iccUrl: abs('pdfjs/iccs/'),
    isEvalSupported: false,
  });
  return task.promise;
}

/** Détecte si un PDF est chiffré avec mot de passe utilisateur. */
export async function probePdf(bytes) {
  try {
    const doc = await openPdf(bytes);
    const n = doc.numPages;
    doc.destroy();
    return { ok: true, pages: n };
  } catch (e) {
    if (e?.name === 'PasswordException') return { ok: false, needsPassword: true, wrong: e.code === 2 };
    return { ok: false, error: e };
  }
}

/** Rend une page sur un canvas (renvoie le canvas). */
export async function renderPageToCanvas(page, scale, { canvas, rotation, background = '#ffffff' } = {}) {
  const viewport = page.getViewport({ scale, rotation: rotation ?? page.rotate });
  const c = canvas || document.createElement('canvas');
  c.width = Math.max(1, Math.floor(viewport.width));
  c.height = Math.max(1, Math.floor(viewport.height));
  const ctx = c.getContext('2d', { alpha: false });
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, canvas: c, viewport }).promise;
  return c;
}
