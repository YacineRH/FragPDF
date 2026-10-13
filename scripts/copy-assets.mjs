// Copie les ressources statiques (pdf.js, qpdf, Tesseract) vers public/ — elles sont servies localement : aucun CDN.
import { cpSync, mkdirSync, existsSync, readdirSync } from 'node:fs';

const copyDir = (src, dst) => { if (existsSync(src)) { mkdirSync(dst, { recursive: true }); cpSync(src, dst, { recursive: true }); } };

// pdf.js : cmaps, polices standard, wasm (JPEG2000, JBIG2), profils ICC
for (const d of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) copyDir(`node_modules/pdfjs-dist/${d}`, `public/pdfjs/${d}`);

// QPDF (chiffrement / déchiffrement / réparation)
mkdirSync('public/qpdf', { recursive: true });
cpSync('node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm', 'public/qpdf/qpdf.wasm');

// Tesseract (OCR) : worker, cœur WebAssembly (variantes LSTM) et données de langue françaises + anglaises
mkdirSync('public/tesseract/core', { recursive: true });
mkdirSync('public/tesseract/lang', { recursive: true });
cpSync('node_modules/tesseract.js/dist/worker.min.js', 'public/tesseract/worker.min.js');
for (const f of readdirSync('node_modules/tesseract.js-core')) {
  if (/-lstm\.wasm\.js$/.test(f) || f === 'tesseract-core-lstm.wasm.js') cpSync(`node_modules/tesseract.js-core/${f}`, `public/tesseract/core/${f}`);
}
for (const l of ['fra', 'eng']) {
  const src = `node_modules/@tesseract.js-data/${l}/4.0.0_best_int/${l}.traineddata.gz`;
  if (existsSync(src)) cpSync(src, `public/tesseract/lang/${l}.traineddata.gz`);
}
console.log('Ressources pdf.js / qpdf / tesseract copiées.');
