import { h } from '../lib/utils.js';
import { icon } from './icons.js';
import { t, getLang, setLang } from '../i18n.js';
import { prefs } from '../lib/session.js';

export function navigate(path) { location.hash = '#' + path; }

export function themeToggle() {
  const btn = h('button', { class: 'icon-btn', title: t('Changer de thème'), 'aria-label': t('Changer de thème') });
  const render = () => btn.replaceChildren(icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon', 19));
  btn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    prefs.set('theme', next);
    render();
    document.dispatchEvent(new CustomEvent('themechange'));
  });
  render();
  return btn;
}

export function langToggle() {
  const btn = h('button', { class: 'btn btn-sm btn-ghost', title: 'Langue / Language' }, getLang().toUpperCase());
  btn.addEventListener('click', () => { setLang(getLang() === 'fr' ? 'en' : 'fr'); location.reload(); });
  return btn;
}

export function brand() {
  return h('a', { class: 'brand', href: '#/' }, h('span', { class: 'brand-mark' }, icon('frag', 20)), h('span', {}, 'Frag', h('em', {}, 'PDF')));
}

export function topbar(...extra) {
  return h('header', { class: 'topbar' }, brand(), h('span', { class: 'spacer' }), ...extra, langToggle(), themeToggle());
}
