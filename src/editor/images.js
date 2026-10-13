// Import d'images : normalisation en PNG/JPEG, réduction éventuelle, enregistrement comme « asset ».
import { loadImage, canvasToBlob, dataURLToBytes, jpegOrientation } from '../lib/utils.js';

const MAX_DIM = 2600;

export async function imageFromBlob(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const nw = img.naturalWidth || 300, nh = img.naturalHeight || 150;
    const k = Math.min(1, MAX_DIM / Math.max(nw, nh));
    const isJpeg = blob.type === 'image/jpeg';
    // JPEG/PNG de taille raisonnable : on garde les octets d'origine (sauf JPEG avec orientation EXIF : redessiné)
    const raw = isJpeg || blob.type === 'image/png' ? new Uint8Array(await blob.arrayBuffer()) : null;
    if (raw && k === 1 && (!isJpeg || jpegOrientation(raw) <= 1)) {
      const bytes = raw;
      return { bytes, mime: blob.type, url: URL.createObjectURL(new Blob([bytes], { type: blob.type })), w: nw, h: nh };
    }
    const c = document.createElement('canvas');
    c.width = Math.round(nw * k); c.height = Math.round(nh * k);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const out = await canvasToBlob(c, 'image/png');
    const bytes = new Uint8Array(await out.arrayBuffer());
    return { bytes, mime: 'image/png', url: URL.createObjectURL(out), w: c.width, h: c.height };
  } finally { URL.revokeObjectURL(url); }
}

export async function imageFromDataURL(dataUrl) {
  const bytes = dataURLToBytes(dataUrl);
  const mime = dataUrl.slice(5, dataUrl.indexOf(';'));
  const blob = new Blob([bytes], { type: mime });
  return imageFromBlob(blob);
}

/** Rend le fond clair transparent (pour les signatures importées) et recadre sur le contenu. */
export async function cleanSignatureImage(blob, { removeBg = true, threshold = 215 } = {}) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const k = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, c.width, c.height);
    if (removeBg) {
      const id = ctx.getImageData(0, 0, c.width, c.height);
      const d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        if (lum > threshold) d[i + 3] = 0;
        else if (lum > threshold - 40) d[i + 3] = Math.round(d[i + 3] * (threshold - lum) / 40);
      }
      ctx.putImageData(id, 0, 0);
    }
    return trimCanvas(c);
  } finally { URL.revokeObjectURL(url); }
}

/** Recadre un canvas sur ses pixels non transparents (avec une petite marge). */
export function trimCanvas(c, pad = 6) {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const { width: W, height: H } = c;
  const d = ctx.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < x0) return c;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}
