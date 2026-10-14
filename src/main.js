import './styles/base.css';
import './styles/home.css';
import './styles/tool.css';
import './styles/editor.css';
import { initLang, t } from './i18n.js';
import { h } from './lib/utils.js';
import { toastError } from './ui/toast.js';
import { trackPage } from './lib/stats.js';

await initLang();

const app = document.getElementById('app');
let cleanup = null;
let token = 0;

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

async function route() {
  const my = ++token;
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  app.replaceChildren();
  const { path, query } = parseHash();
  try {
    let mod;
    if (path === '/editor') mod = await import('./editor/editor.js');
    else if (path.startsWith('/tool/')) mod = await import('./tools/toolpage.js');
    else mod = await import('./home.js');
    if (my !== token) return;
    const params = path.startsWith('/tool/') ? { id: path.slice(6), query } : { query };
    cleanup = (await mod.mount(app, params)) || null;
    trackPage(path === '/' ? '/' : path);
  } catch (e) {
    console.error(e);
    app.replaceChildren(h('div', { class: 'home' }, h('h2', {}, t('Oups, une erreur est survenue')), h('pre', {}, String(e?.stack || e)), h('a', { class: 'btn', href: '#/' }, t('Accueil'))));
  }
}

// filet de sécurité : toute erreur non gérée est signalée à l'utilisateur plutôt que d'échouer en silence
window.addEventListener('unhandledrejection', (e) => {
  const msg = String(e.reason?.message || e.reason || '');
  if (/RenderingCancelled|AbortError|ResizeObserver/.test(msg)) return;
  console.error(e.reason);
  toastError(msg.length < 160 ? msg : 'Une erreur est survenue.');
});

window.addEventListener('hashchange', route);
route();

// PWA installée : un double-clic sur un PDF l'ouvre directement dans l'éditeur (File Handling API)
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    const handle = params.files?.[0];
    if (!handle) return;
    const { loadPdfFile } = await import('./lib/ingest.js');
    const { setPending } = await import('./lib/session.js');
    const doc = await loadPdfFile(await handle.getFile());
    if (doc) { setPending(doc); location.hash = '#/editor'; }
  });
}

// Service worker : usage hors ligne (en production uniquement)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
