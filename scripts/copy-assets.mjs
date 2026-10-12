// Copie les ressources statiques de pdf.js (cmaps, polices standard, wasm, icc) vers public/pdfjs.
import { cpSync, mkdirSync, existsSync } from 'node:fs';
const src = 'node_modules/pdfjs-dist';
const dst = 'public/pdfjs';
mkdirSync(dst, { recursive: true });
for (const d of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  if (existsSync(`${src}/${d}`)) cpSync(`${src}/${d}`, `${dst}/${d}`, { recursive: true });
}
// qpdf wasm (chiffrement / déchiffrement)
mkdirSync('public/qpdf', { recursive: true });
cpSync('node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm', 'public/qpdf/qpdf.wasm');
console.log('Ressources pdf.js / qpdf copiées.');
