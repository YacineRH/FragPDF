// Statistiques d'usage anonymes (GoatCounter : sans cookie, sans IP stockée, pays déduit côté serveur) + notation par étoiles.
// Jamais d'envoi de fichier ni de contenu : seulement le nom de la page / de l'outil et la note.
import { GOATCOUNTER_CODE } from '../config.js';
import { prefs } from './session.js';

const code = () => GOATCOUNTER_CODE.trim();
export const statsEnabled = () => !!code();

/** Respect de « Ne pas suivre » et du choix de l'utilisateur. */
export function trackingAllowed() {
  if (!statsEnabled()) return false;
  if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return false;
  return prefs.get('stats-optout', false) !== true;
}

function beacon(params) {
  if (!trackingAllowed()) return;
  const q = new URLSearchParams({ ...params, rnd: Math.random().toString(36).slice(2, 8) });
  try { new Image().src = `https://${code()}.goatcounter.com/count?${q}`; } catch { /* ignoré */ }
}

/** Page vue (route de l'application). */
export function trackPage(path, title) {
  beacon({ p: path, t: title || document.title, r: document.referrer || '', s: `${screen.width},${screen.height},${window.devicePixelRatio || 1}` });
}

/** Événement (utilisation d'un outil, note…). */
export function trackEvent(name, title) {
  beacon({ p: name, e: 'true', t: title || name });
}

/** Une action « utile » a abouti avec cet outil. */
export function trackUse(toolId) {
  trackEvent(`use-${toolId}`, `Utilisation : ${toolId}`);
  trackEvent('uses', 'Utilisations (total)');
  prefs.set('uses', prefs.get('uses', 0) + 1);
}

export function sendRating(stars) {
  trackEvent(`rating-${stars}`, `Note ${stars} étoiles`);
  prefs.set('rated-at', Date.now());
  prefs.set('rating', stars);
}

/** Faut-il proposer la notation ? (jamais déjà notée récemment, après au moins une utilisation, une fois par session) */
let askedThisSession = false;
export function shouldAskRating() {
  if (askedThisSession) return false;
  const last = prefs.get('rated-at', 0);
  if (Date.now() - last < 14 * 24 * 3600 * 1000) return false;
  const dismissed = prefs.get('rating-dismissed-at', 0);
  if (Date.now() - dismissed < 3 * 24 * 3600 * 1000) return false;
  return true;
}
export function markAsked() { askedThisSession = true; }
export function markDismissed() { prefs.set('rating-dismissed-at', Date.now()); }

/** « 1 234 » / « 1 234 » / "12,5k" → nombre */
export function parseCount(v) {
  const n = parseInt(String(v ?? '').replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

async function counter(path) {
  for (const p of [path, `/${path}`]) {
    try {
      const r = await fetch(`https://${code()}.goatcounter.com/counter/${encodeURIComponent(p)}.json`, { mode: 'cors' });
      if (r.ok) return parseCount((await r.json()).count);
    } catch { /* ignoré */ }
  }
  return 0;
}

/** Score public : moyenne des notes, nombre d'avis, nombre total d'utilisations (null si indisponible). */
export async function fetchPublicScore() {
  if (!statsEnabled()) return null;
  const [r1, r2, r3, r4, r5, uses] = await Promise.all([1, 2, 3, 4, 5].map((n) => counter(`rating-${n}`)).concat(counter('uses')));
  const votes = r1 + r2 + r3 + r4 + r5;
  if (!votes && !uses) return null;
  return { average: votes ? (r1 + 2 * r2 + 3 * r3 + 4 * r4 + 5 * r5) / votes : null, votes, uses };
}
