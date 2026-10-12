import { h } from '../lib/utils.js';
import { icon } from '../ui/icons.js';
import { topbar } from '../ui/chrome.js';
import { t } from '../i18n.js';
import { TOOL_MAP, catOf } from './registry.js';

export async function mount(root, { id }) {
  const meta = TOOL_MAP[id];
  if (!meta || !meta.load) {
    root.append(topbar(), h('div', { class: 'tool-page' }, h('h2', {}, t('Outil introuvable')), h('a', { class: 'btn', href: '#/' }, t('Accueil'))));
    return;
  }
  const color = catOf(meta.cat).color;
  const host = h('div', {});
  root.append(
    topbar(),
    h('main', { class: 'tool-page', style: { '--tc': color } },
      h('nav', { class: 'crumbs' }, h('a', { href: '#/' }, t('Accueil')), icon('chevR', 14), h('span', {}, t(catOf(meta.cat).label))),
      h('div', { class: 'tool-head' }, h('div', { class: 'tool-ic' }, icon(meta.icon, 30)), h('div', {}, h('h1', {}, t(meta.title)), h('p', {}, t(meta.desc)))),
      host));
  document.title = `${t(meta.title)} — FragPDF`;
  const def = await meta.load();
  const cleanup = def.mount(host, meta);
  return () => { document.title = 'FragPDF'; cleanup?.(); };
}
