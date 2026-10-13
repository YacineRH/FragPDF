import { h } from './lib/utils.js';
import { icon } from './ui/icons.js';
import { topbar, navigate } from './ui/chrome.js';
import { t } from './i18n.js';
import { CATEGORIES, TOOLS } from './tools/registry.js';
import { loadPdfFile, isPdf } from './lib/ingest.js';
import { setPending } from './lib/session.js';
import { toastError } from './ui/toast.js';

export function toolHref(tool) {
  return tool.kind === 'editor' ? `#/editor?tool=${tool.preset}` : `#/tool/${tool.id}`;
}

function toolCard(tool, color) {
  return h('a', { class: 'tool-card', href: toolHref(tool), style: { '--tc': color } },
    h('span', { class: 'tool-ic' }, icon(tool.icon, 24)),
    h('div', {}, h('h4', {}, t(tool.title), tool.badge ? h('span', { class: 'badge' }, tool.badge) : null), h('p', {}, t(tool.desc))));
}

export function mount(root) {
  const input = h('input', { type: 'file', accept: '.pdf,application/pdf', hidden: true });
  const drop = h('div', { class: 'drop-hero', tabindex: 0, role: 'button' },
    h('div', { class: 'big-ic' }, icon('upload', 30)),
    h('h3', {}, t('Glissez un PDF ici pour l’éditer')),
    h('p', { class: 'muted' }, t('ou cliquez pour parcourir vos fichiers')),
    h('button', { class: 'btn btn-primary btn-lg', style: { marginTop: '.8rem' }, onclick: (e) => { e.stopPropagation(); input.click(); } }, icon('pen', 18), t('Ouvrir un PDF')),
    input);

  async function openFile(file) {
    if (!file || !isPdf(file)) { toastError(t('Veuillez choisir un fichier PDF.')); return; }
    const doc = await loadPdfFile(file);
    if (!doc) return;
    setPending(doc);
    navigate('/editor');
  }
  drop.addEventListener('click', () => input.click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.click(); });
  input.addEventListener('change', () => { openFile(input.files[0]); input.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); openFile(e.dataTransfer.files[0]); });

  const search = h('input', { class: 'input', type: 'search', placeholder: t('Rechercher un outil…'), 'aria-label': t('Rechercher un outil…') });
  const catsHost = h('div', {});

  function renderCats() {
    const q = search.value.trim().toLowerCase();
    catsHost.replaceChildren();
    for (const c of CATEGORIES) {
      const tools = TOOLS.filter((x) => x.cat === c.id && (!q || (t(x.title) + ' ' + t(x.desc)).toLowerCase().includes(q)));
      if (!tools.length) continue;
      catsHost.append(h('section', { class: 'cat' },
        h('h2', {}, h('span', { class: 'dot', style: { background: c.color } }), t(c.label)),
        h('div', { class: 'grid-tools' }, tools.map((x) => toolCard(x, c.color)))));
    }
    if (!catsHost.children.length) catsHost.append(h('p', { class: 'muted', style: { textAlign: 'center', marginTop: '2rem' } }, t('Aucun outil ne correspond à votre recherche.')));
  }
  search.addEventListener('input', renderCats);
  renderCats();

  // dépôt d'un PDF n'importe où sur la page
  const onDragOver = (e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); drop.classList.add('over'); } };
  const onDrop = (e) => { if (e.dataTransfer?.files.length && !drop.contains(e.target)) { e.preventDefault(); drop.classList.remove('over'); openFile(e.dataTransfer.files[0]); } };
  document.addEventListener('dragover', onDragOver);
  document.addEventListener('drop', onDrop);

  const page = h('div', {},
    topbar(h('a', { class: 'btn btn-sm btn-ghost', href: '#/editor' }, icon('pen', 16), t('Éditeur'))),
    h('main', { class: 'home' },
      h('section', { class: 'hero' },
        heroArt(),
        h('span', { class: 'pill' }, icon('shield', 15), t('100 % local · aucun envoi de fichier')),
        h('h1', {}, t('Le PDF, '), h('span', { class: 'grad' }, t('sans limites.'))),
        h('p', { class: 'lead' }, t('Modifiez, signez, fusionnez, compressez, convertissez et protégez vos documents. Tout se passe dans votre navigateur : vos fichiers ne quittent jamais votre appareil.')),
        drop,
        h('div', { class: 'privacy' },
          h('span', {}, icon('check', 16), t('Gratuit, sans compte')),
          h('span', {}, icon('check', 16), t('Pas de limite de taille')),
          h('span', {}, icon('check', 16), t('Fonctionne hors ligne'))),
        h('div', { class: 'search-wrap' }, icon('search', 18), search)),
      catsHost,
      h('section', { class: 'features' },
        feat('lock', t('Confidentialité totale'), t('Le traitement a lieu localement. Rien n’est envoyé sur un serveur.')),
        feat('zap', t('Rapide'), t('Moteur WebAssembly et pdf.js : même les gros fichiers restent fluides.')),
        feat('pen', t('Éditeur complet'), t('Texte, images, formes, signatures, surlignage, caviardage, formulaires.')),
        feat('wand', t('Annuler / rétablir'), t('Historique illimité et raccourcis clavier pour travailler vite.'))),
      h('p', { class: 'footer' }, 'FragPDF — ', t('fait avec soin.'))));
  root.append(page);
  return () => { document.removeEventListener('dragover', onDragOver); document.removeEventListener('drop', onDrop); };
}

/** Fragments de pages flottants (décor de l'en-tête) : un clin d'œil au nom « Frag »PDF. */
function heroArt() {
  const lines = (...w) => w.map((x) => h('i', { class: 'l', style: { width: `${x}%` } }));
  const mk = (cls, ...kids) => h('div', { class: `frag ${cls}`, 'aria-hidden': 'true' }, ...kids);
  const sig = () => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 80 24'); s.innerHTML = '<path d="M2 18c8-14 12-14 14-4s6 6 10-2 6-8 10 0 8 4 14-4c4-4 8 2 12 0" fill="none" stroke="#6d4aff" stroke-width="2.2" stroke-linecap="round"/>'; return s; };
  return h('div', { class: 'hero-art' },
    mk('f1', h('b', { class: 'bar' }), ...lines(80, 62, 90, 55), h('i', { class: 'l hl', style: { width: '70%' } }), ...lines(85, 40)),
    mk('f2', ...lines(70, 90, 50), h('span', { class: 'stamp' }, 'PAYÉ'), ...lines(88, 66)),
    mk('f3', ...lines(60, 85), sig(), ...lines(45, 80, 70)),
    mk('f4', h('b', { class: 'bar b2' }), ...lines(90, 50, 76), h('i', { class: 'l redact', style: { width: '64%' } }), ...lines(82, 58)));
}

function feat(ic, title, text) {
  return h('div', { class: 'feat' }, icon(ic, 26), h('h4', {}, title), h('p', {}, text));
}
