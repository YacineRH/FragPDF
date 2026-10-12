// Catalogue de polices : 3 polices PDF standard + polices Unicode embarquées (fontsource).
// Les fichiers .woff sont importés par Vite (URL) et chargés à la demande.

import inter_400 from '@fontsource/inter/files/inter-latin-400-normal.woff?url';
import inter_400i from '@fontsource/inter/files/inter-latin-400-italic.woff?url';
import inter_700 from '@fontsource/inter/files/inter-latin-700-normal.woff?url';
import inter_700i from '@fontsource/inter/files/inter-latin-700-italic.woff?url';
import roboto_400 from '@fontsource/roboto/files/roboto-latin-400-normal.woff?url';
import roboto_400i from '@fontsource/roboto/files/roboto-latin-400-italic.woff?url';
import roboto_700 from '@fontsource/roboto/files/roboto-latin-700-normal.woff?url';
import roboto_700i from '@fontsource/roboto/files/roboto-latin-700-italic.woff?url';
import montserrat_400 from '@fontsource/montserrat/files/montserrat-latin-400-normal.woff?url';
import montserrat_400i from '@fontsource/montserrat/files/montserrat-latin-400-italic.woff?url';
import montserrat_700 from '@fontsource/montserrat/files/montserrat-latin-700-normal.woff?url';
import montserrat_700i from '@fontsource/montserrat/files/montserrat-latin-700-italic.woff?url';
import lora_400 from '@fontsource/lora/files/lora-latin-400-normal.woff?url';
import lora_400i from '@fontsource/lora/files/lora-latin-400-italic.woff?url';
import lora_700 from '@fontsource/lora/files/lora-latin-700-normal.woff?url';
import lora_700i from '@fontsource/lora/files/lora-latin-700-italic.woff?url';
import playfair_display_400 from '@fontsource/playfair-display/files/playfair-display-latin-400-normal.woff?url';
import playfair_display_400i from '@fontsource/playfair-display/files/playfair-display-latin-400-italic.woff?url';
import playfair_display_700 from '@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff?url';
import playfair_display_700i from '@fontsource/playfair-display/files/playfair-display-latin-700-italic.woff?url';
import roboto_mono_400 from '@fontsource/roboto-mono/files/roboto-mono-latin-400-normal.woff?url';
import roboto_mono_400i from '@fontsource/roboto-mono/files/roboto-mono-latin-400-italic.woff?url';
import roboto_mono_700 from '@fontsource/roboto-mono/files/roboto-mono-latin-700-normal.woff?url';
import roboto_mono_700i from '@fontsource/roboto-mono/files/roboto-mono-latin-700-italic.woff?url';
import caveat_400 from '@fontsource/caveat/files/caveat-latin-400-normal.woff?url';
import caveat_700 from '@fontsource/caveat/files/caveat-latin-700-normal.woff?url';
import dancing_script_400 from '@fontsource/dancing-script/files/dancing-script-latin-400-normal.woff?url';
import dancing_script_700 from '@fontsource/dancing-script/files/dancing-script-latin-700-normal.woff?url';
import pacifico_400 from '@fontsource/pacifico/files/pacifico-latin-400-normal.woff?url';

const CUSTOM = [
  { id: 'inter', label: 'Inter', cat: 'sans', css: "'Inter', sans-serif", files: { '400': inter_400, '400i': inter_400i, '700': inter_700, '700i': inter_700i } },
  { id: 'roboto', label: 'Roboto', cat: 'sans', css: "'Roboto', sans-serif", files: { '400': roboto_400, '400i': roboto_400i, '700': roboto_700, '700i': roboto_700i } },
  { id: 'montserrat', label: 'Montserrat', cat: 'sans', css: "'Montserrat', sans-serif", files: { '400': montserrat_400, '400i': montserrat_400i, '700': montserrat_700, '700i': montserrat_700i } },
  { id: 'lora', label: 'Lora', cat: 'serif', css: "'Lora', serif", files: { '400': lora_400, '400i': lora_400i, '700': lora_700, '700i': lora_700i } },
  { id: 'playfair-display', label: 'Playfair Display', cat: 'serif', css: "'Playfair Display', serif", files: { '400': playfair_display_400, '400i': playfair_display_400i, '700': playfair_display_700, '700i': playfair_display_700i } },
  { id: 'roboto-mono', label: 'Roboto Mono', cat: 'mono', css: "'Roboto Mono', monospace", files: { '400': roboto_mono_400, '400i': roboto_mono_400i, '700': roboto_mono_700, '700i': roboto_mono_700i } },
  { id: 'caveat', label: 'Caveat', cat: 'script', css: "'Caveat', cursive", files: { '400': caveat_400, '700': caveat_700 } },
  { id: 'dancing-script', label: 'Dancing Script', cat: 'script', css: "'Dancing Script', cursive", files: { '400': dancing_script_400, '700': dancing_script_700 } },
  { id: 'pacifico', label: 'Pacifico', cat: 'script', css: "'Pacifico', cursive", files: { '400': pacifico_400 } },
];

const STD = [
  { id: 'helvetica', label: 'Helvetica', cat: 'sans', css: 'Helvetica, Arial, sans-serif', std: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'] },
  { id: 'times', label: 'Times', cat: 'serif', css: "'Times New Roman', Times, serif", std: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'] },
  { id: 'courier', label: 'Courier', cat: 'mono', css: "'Courier New', Courier, monospace", std: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'] },
];

export const FONTS = [...STD, ...CUSTOM];
export const FONT_MAP = Object.fromEntries(FONTS.map((f) => [f.id, f]));
export const SIGNATURE_FONTS = ['caveat', 'dancing-script', 'pacifico'];

export function cssFont(fontId, bold, italic, sizePx) {
  const f = FONT_MAP[fontId] || FONT_MAP.helvetica;
  return `${italic ? 'italic ' : ''}${bold ? '700 ' : '400 '}${sizePx}px ${f.css}`;
}

function variantKey(f, bold, italic) {
  const want = `${bold ? 700 : 400}${italic ? 'i' : ''}`;
  if (f.files[want]) return want;
  const noItalic = `${bold ? 700 : 400}`;
  if (f.files[noItalic]) return noItalic;
  return Object.keys(f.files)[0];
}

const loaded = new Map();
/** Charge les variantes d'une police pour l'aperçu à l'écran (FontFace API). */
export async function ensureFontLoaded(fontId) {
  const f = FONT_MAP[fontId];
  if (!f || f.std) return;
  if (loaded.has(fontId)) return loaded.get(fontId);
  const p = Promise.all(Object.entries(f.files).map(async ([k, url]) => {
    const bold = k.startsWith('700');
    const italic = k.endsWith('i');
    const ff = new FontFace(f.label, `url(${url})`, { weight: bold ? '700' : '400', style: italic ? 'italic' : 'normal' });
    try { document.fonts.add(await ff.load()); } catch { /* ignoré */ }
  }));
  loaded.set(fontId, p);
  return p;
}

export function loadAllPreviewFonts() { return Promise.all(CUSTOM.map((f) => ensureFontLoaded(f.id))); }

const bytesCache = new Map();
async function fontBytes(url) {
  if (!bytesCache.has(url)) bytesCache.set(url, fetch(url).then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)));
  return bytesCache.get(url);
}

/**
 * Fabrique un gestionnaire de polices lié à un PDFDocument pdf-lib :
 * embed(fontId, bold, italic) -> PDFFont (avec repli sur Inter si des caractères ne sont pas encodables).
 */
export function createFontEmbedder(pdfDoc, PDFLib, fontkit) {
  pdfDoc.registerFontkit(fontkit);
  const cache = new Map();
  async function embedRaw(fontId, bold, italic) {
    const f = FONT_MAP[fontId] || FONT_MAP.helvetica;
    const key = f.std ? `${f.id}|${bold}|${italic}` : `${f.id}|${variantKey(f, bold, italic)}`;
    if (cache.has(key)) return cache.get(key);
    let font;
    if (f.std) {
      const idx = (bold ? 1 : 0) + (italic ? 2 : 0);
      // ordre dans STD : normal, gras, oblique, gras+oblique
      font = await pdfDoc.embedFont(PDFLib.StandardFonts[f.std[idx]]);
    } else {
      font = await pdfDoc.embedFont(await fontBytes(f.files[variantKey(f, bold, italic)]), { subset: true });
    }
    cache.set(key, font);
    return font;
  }
  return {
    /** Renvoie la police ; si le texte contient des caractères non supportés, bascule sur Inter. */
    async embed(fontId, bold, italic, text = '') {
      let font = await embedRaw(fontId, bold, italic);
      if (text) {
        try { font.encodeText(text.replace(/\n/g, ' ')); } catch {
          font = await embedRaw('inter', bold, italic);
        }
      }
      return font;
    },
    /** Retire les caractères que la police ne sait pas encoder (dernier recours). */
    sanitize(font, text) {
      let out = '';
      for (const ch of text) {
        try { font.encodeText(ch); out += ch; } catch { out += '?'; }
      }
      return out;
    },
  };
}
