import './styles/base.css';
import './styles/home.css';
import './styles/tool.css';
import './styles/editor.css';
import { initLang, t } from './i18n.js';
import { h } from './lib/utils.js';

initLang();

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
  } catch (e) {
    console.error(e);
    app.replaceChildren(h('div', { class: 'home' }, h('h2', {}, t('Oups, une erreur est survenue')), h('pre', {}, String(e?.stack || e)), h('a', { class: 'btn', href: '#/' }, t('Accueil'))));
  }
}

window.addEventListener('hashchange', route);
route();

// Service worker : usage hors ligne (en production uniquement)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
