// Plugin Vite : génère dist/sw.js (service worker) listant les fichiers à pré-mettre en cache pour l'usage hors ligne.
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

export default function swPlugin() {
  let outDir = 'dist';
  return {
    name: 'fragpdf-sw',
    apply: 'build',
    configResolved(cfg) { outDir = cfg.build.outDir; },
    closeBundle() {
      const files = walk(outDir)
        .map((p) => relative(outDir, p).split(sep).join('/'))
        .filter((p) => p !== 'sw.js' && !p.endsWith('.map') && !p.startsWith('pdfjs/cmaps/') && !p.startsWith('pdfjs/wasm/'));
      const version = Date.now().toString(36);
      const src = `// Généré au build — ne pas modifier.
const CACHE = 'fragpdf-${version}';
const PRECACHE = ${JSON.stringify(['./', ...files], null, 1)};

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k.startsWith('fragpdf-')).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // CDN (données OCR…) : réseau uniquement
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && (url.pathname.includes('/pdfjs/') || url.pathname.includes('/assets/'))) cache.put(req, res.clone());
      return res;
    } catch (err) {
      if (req.mode === 'navigate') { const idx = await cache.match('./'); if (idx) return idx; }
      throw err;
    }
  })());
});
`;
      writeFileSync(join(outDir, 'sw.js'), src);
    },
  };
}
