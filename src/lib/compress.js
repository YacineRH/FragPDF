// Compression de PDF : recompression des images intégrées (conserve le texte vectoriel)
// + mode « extrême » qui rasterise les pages en JPEG.
import { PDFDocument, PDFName, PDFRawStream, PDFDict, PDFArray, PDFNumber, PDFBool } from 'pdf-lib';
import { loadDoc, save } from './pdf-ops.js';
import { openPdf, renderPageToCanvas } from './pdfjs.js';
import { canvasToBlob } from './utils.js';

export const LEVELS = {
  low: { maxDim: 3200, quality: 0.86, label: 'Légère' },
  medium: { maxDim: 2000, quality: 0.72, label: 'Recommandée' },
  high: { maxDim: 1400, quality: 0.55, label: 'Forte' },
  extreme: { maxDim: 1000, quality: 0.5, label: 'Extrême', rasterize: true, dpi: 110 },
};

const N = (s) => PDFName.of(s);

function filtersOf(dict) {
  const f = dict.get(N('Filter'));
  if (!f) return [];
  if (f instanceof PDFName) return [f.decodeText()];
  if (f instanceof PDFArray) return f.asArray().map((x) => (x instanceof PDFName ? x.decodeText() : String(x)));
  return [];
}

function colorComponents(dict, ctx) {
  let cs = dict.get(N('ColorSpace'));
  if (!cs) return 0;
  if (cs.constructor.name === 'PDFRef') cs = ctx.lookup(cs);
  if (cs instanceof PDFName) {
    const n = cs.decodeText();
    return n === 'DeviceRGB' ? 3 : n === 'DeviceGray' ? 1 : 0;
  }
  if (cs instanceof PDFArray && cs.size() === 2 && String(cs.get(0)) === '/ICCBased') {
    const prof = ctx.lookup(cs.get(1));
    const n = prof?.dict?.get(N('N'));
    return n instanceof PDFNumber ? n.asNumber() : 0;
  }
  return 0;
}

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function unpredictPng(data, width, comps) {
  const bpp = comps;
  const rowLen = width * comps;
  const rows = data.length / (rowLen + 1);
  const out = new Uint8Array(rows * rowLen);
  for (let r = 0; r < rows; r++) {
    const ft = data[r * (rowLen + 1)];
    const inOff = r * (rowLen + 1) + 1;
    const o = r * rowLen;
    for (let i = 0; i < rowLen; i++) {
      const x = data[inOff + i];
      const a = i >= bpp ? out[o + i - bpp] : 0;
      const b = r > 0 ? out[o - rowLen + i] : 0;
      const c = i >= bpp && r > 0 ? out[o - rowLen + i - bpp] : 0;
      let v;
      switch (ft) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: v = x;
      }
      out[o + i] = v & 255;
    }
  }
  return out;
}

async function encodeJpeg(source, w, h, maxDim, quality) {
  const s = Math.min(1, maxDim / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * s)), th = Math.max(1, Math.round(h * s));
  const c = new OffscreenCanvas(tw, th);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, tw, th);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, tw, th);
  const blob = await c.convertToBlob({ type: 'image/jpeg', quality });
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w: tw, h: th };
}

async function recompressImages(bytes, level, onProgress) {
  const doc = await loadDoc(bytes);
  const ctx = doc.context;
  const entries = ctx.enumerateIndirectObjects();
  let done = 0, replaced = 0;
  for (const [ref, obj] of entries) {
    done++;
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    if (String(dict.get(N('Subtype'))) !== '/Image') continue;
    if (dict.has(N('Mask')) || dict.has(N('Decode'))) continue;
    const im = dict.get(N('ImageMask'));
    if (im instanceof PDFBool && im.asBoolean()) continue;
    const w = dict.get(N('Width'))?.asNumber?.(), h = dict.get(N('Height'))?.asNumber?.();
    if (!w || !h || w * h < 40000) continue; // ignore les petites images
    const comps = colorComponents(dict, ctx);
    if (!comps) continue;
    const filters = filtersOf(dict);
    let source = null;
    try {
      if (filters.length === 1 && filters[0] === 'DCTDecode') {
        source = await createImageBitmap(new Blob([obj.contents], { type: 'image/jpeg' }));
      } else if (filters.length === 1 && filters[0] === 'FlateDecode' && dict.get(N('BitsPerComponent'))?.asNumber?.() === 8) {
        let raw = await inflate(obj.contents);
        const parms = dict.get(N('DecodeParms'));
        const pd = parms instanceof PDFDict ? parms : null;
        const pred = pd?.get(N('Predictor'))?.asNumber?.() ?? 1;
        if (pred >= 10) raw = unpredictPng(raw, w, comps);
        else if (pred !== 1) continue;
        if (raw.length < w * h * comps) continue;
        const rgba = new Uint8ClampedArray(w * h * 4);
        for (let i = 0, p = 0, q = 0; i < w * h; i++, q += 4) {
          if (comps === 3) { rgba[q] = raw[p++]; rgba[q + 1] = raw[p++]; rgba[q + 2] = raw[p++]; }
          else { const g = raw[p++]; rgba[q] = rgba[q + 1] = rgba[q + 2] = g; }
          rgba[q + 3] = 255;
        }
        source = await createImageBitmap(new ImageData(rgba, w, h));
      } else continue;
      const enc = await encodeJpeg(source, w, h, level.maxDim, level.quality);
      if (enc.bytes.length < obj.contents.length * 0.92) {
        const nd = ctx.obj({
          Type: 'XObject', Subtype: 'Image', Width: enc.w, Height: enc.h,
          ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode',
        });
        const sm = dict.get(N('SMask'));
        if (sm) nd.set(N('SMask'), sm);
        ctx.assign(ref, PDFRawStream.of(nd, enc.bytes));
        replaced++;
      }
    } catch { /* image non supportée : on la laisse telle quelle */ } finally { source?.close?.(); }
    onProgress?.(done / entries.length);
  }
  return { bytes: await save(doc), replaced };
}

async function rasterizeAll(bytes, level, onProgress) {
  const pdf = await openPdf(bytes);
  const out = await PDFDocument.create();
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp1 = page.getViewport({ scale: 1 });
    const c = await renderPageToCanvas(page, level.dpi / 72);
    const blob = await canvasToBlob(c, 'image/jpeg', level.quality);
    const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const p = out.addPage([vp1.width, vp1.height]);
    p.drawImage(img, { x: 0, y: 0, width: vp1.width, height: vp1.height });
    c.width = c.height = 0;
    page.cleanup();
    onProgress?.(i / pdf.numPages);
  }
  pdf.destroy();
  return save(out);
}

/** Renvoie { bytes, before, after, ratio, method }. Ne renvoie jamais un fichier plus gros. */
export async function compressPdf(bytes, levelId = 'medium', onProgress) {
  const level = LEVELS[levelId] || LEVELS.medium;
  const before = bytes.length;
  let best = bytes, method = 'inchangé';
  if (level.rasterize) {
    best = await rasterizeAll(bytes, level, onProgress);
    method = 'pages rasterisées';
  } else {
    const r = await recompressImages(bytes, level, onProgress);
    best = r.bytes;
    method = r.replaced ? `${r.replaced} image(s) recompressée(s)` : 'structure optimisée';
  }
  if (best.length >= before) { best = bytes; method = 'déjà optimisé'; }
  return { bytes: best, before, after: best.length, ratio: 1 - best.length / before, method };
}
