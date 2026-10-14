// Petite carte « Cette opération vous a été utile ? » (étoiles), affichée après une action réussie.
import { h } from '../lib/utils.js';
import { icon } from './icons.js';
import { t } from '../i18n.js';
import { shouldAskRating, markAsked, markDismissed, sendRating, statsEnabled } from '../lib/stats.js';
import { toast } from './toast.js';

let card = null;

export function askRating(delay = 1200) {
  if (card || !shouldAskRating()) return;
  markAsked();
  setTimeout(() => {
    let chosen = 0;
    const stars = [1, 2, 3, 4, 5].map((n) => h('button', { class: 'star', type: 'button', 'aria-label': `${n} / 5`, title: `${n} / 5` }, icon('star', 26)));
    const paint = (upTo) => stars.forEach((s, i) => s.classList.toggle('on', i < upTo));
    stars.forEach((s, i) => {
      s.addEventListener('mouseenter', () => paint(i + 1));
      s.addEventListener('focus', () => paint(i + 1));
      s.addEventListener('click', () => {
        chosen = i + 1;
        sendRating(chosen);
        close();
        toast(chosen >= 4 ? t('Merci ! Votre avis compte beaucoup.') : t('Merci pour votre retour, nous allons nous améliorer.'), 'success');
      });
    });
    const row = h('div', { class: 'stars', onmouseleave: () => paint(chosen) }, stars);
    const close = () => { card?.classList.remove('in'); const c = card; setTimeout(() => c?.remove(), 250); card = null; };
    card = h('div', { class: 'rating-card', role: 'dialog', 'aria-label': t('Donner une note') },
      h('button', { class: 'icon-btn rating-x', 'aria-label': t('Fermer'), onclick: () => { markDismissed(); close(); } }, icon('x', 16)),
      h('b', {}, t('Cette opération vous a été utile ?')),
      row,
      h('small', { class: 'muted' }, statsEnabled() ? t('Note anonyme, aucun fichier n’est envoyé.') : t('Merci de votre retour.')));
    document.body.append(card);
    requestAnimationFrame(() => card.classList.add('in'));
  }, delay);
}
