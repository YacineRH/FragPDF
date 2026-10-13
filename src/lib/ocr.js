// OCR : tesseract.js + calque de texte invisible superposé à chaque page.
import * as PDFLib from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { openPdf, renderPageToCanvas } from './pdfjs.js';
import { loadDoc, save } from './pdf-ops.js';
import { pageGeometry } from './geometry.js';
import { createFontEmbedder } from './fonts.js';
import { degrees } from 'pdf-lib';

export async function runOcr(bytes, { lang = 'fra', scale = 2 }, onProgress) {
  const { createWorker } = await import('tesseract.js');
  let pageProgress = 0;
  // worker, cœur WASM et langues fra/eng sont servis localement ; les autres langues viennent du CDN officiel de Tesseract
  const base = new URL((import.meta.env.BASE_URL || './') + 'tesseract/', document.baseURI).href.replace(/\/$/, '');
  const hosted = lang.split('+').every((l) => ['fra', 'eng'].includes(l));
  const worker = await createWorker(lang, 1, {
    workerPath: `${base}/worker.min.js`,
    corePath: `${base}/core`,
    ...(hosted ? { langPath: `${base}/lang` } : {}),
    logger: (m) => { if (m.status === 'recognizing text') onProgress?.(pageProgress + m.progress * pageStep, null); },
  });
  const pdf = await openPdf(bytes);
  const n = pdf.numPages;
  const pageStep = 1 / n;
  const doc = await loadDoc(bytes);
  const fonts = createFontEmbedder(doc, PDFLib, fontkit);
  const font = await fonts.embed('inter', false, false);
  const { PDFOperator, PDFNumber } = PDFLib;
  try {
    for (let i = 1; i <= n; i++) {
      pageProgress = (i - 1) / n;
      onProgress?.(pageProgress, `Page ${i} / ${n}`);
      const page = await pdf.getPage(i);
      const canvas = await renderPageToCanvas(page, scale);
      // tesseract.js ≥ 6 : les mots sont dans data.blocks → paragraphes → lignes → mots
      const { data } = await worker.recognize(canvas, {}, { blocks: true });
      const words = [];
      for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) words.push(w);
      const vp1 = page.getViewport({ scale: 1 });
      const k = vp1.width / canvas.width;
      const pPage = doc.getPage(i - 1);
      const geo = pageGeometry(pPage);
      pPage.pushOperators(PDFOperator.of('Tr', [PDFNumber.of(3)]));
      for (const w of words) {
        if (!w.text?.trim() || w.confidence < 25) continue;
        const text = fonts.sanitize(font, w.text);
        const bw = (w.bbox.x1 - w.bbox.x0) * k, bh = (w.bbox.y1 - w.bbox.y0) * k;
        const natural = font.widthOfTextAtSize(text, 1) || 1;
        const size = Math.min(Math.max(bw / natural, 2), bh * 1.6);
        const p = geo.map(w.bbox.x0 * k, w.bbox.y1 * k - bh * 0.2);
        try { pPage.drawText(text, { x: p.x, y: p.y, size, font, rotate: degrees(geo.rot), opacity: 1 }); } catch { /* glyphe non supporté */ }
      }
      pPage.pushOperators(PDFOperator.of('Tr', [PDFNumber.of(0)]));
      canvas.width = canvas.height = 0;
      page.cleanup();
    }
  } finally {
    await worker.terminate();
    pdf.destroy();
  }
  return save(doc);
}
