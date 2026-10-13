import { defineConfig } from 'vite';
import swPlugin from './scripts/sw-plugin.js';

export default defineConfig({
  base: './',
  plugins: [swPlugin()],
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
  worker: { format: 'es' },
  server: { host: true },
  // Pré-bundle toutes les dépendances dès le démarrage (évite les rechargements en cours de route).
  optimizeDeps: {
    include: ['pdf-lib', '@pdf-lib/fontkit', 'jszip', 'pdfjs-dist/legacy/build/pdf.mjs', '@neslinesli93/qpdf-wasm', 'tesseract.js'],
  },
});
