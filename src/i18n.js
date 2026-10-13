// i18n minimaliste : la clé est le texte français ; l'anglais est chargé à la demande depuis i18n-en.js.
let EN = {};
let lang = 'fr';
export function getLang() { return lang; }
export function setLang(l) {
  lang = l === 'en' ? 'en' : 'fr';
  try { localStorage.setItem('fragpdf.lang', lang); } catch { /* ignoré */ }
  document.documentElement.lang = lang;
}
export async function initLang() {
  let l = 'fr';
  try { l = localStorage.getItem('fragpdf.lang') || (navigator.language?.startsWith('en') ? 'en' : 'fr'); } catch { /* ignoré */ }
  if (l === 'en') EN = (await import('./i18n-en.js')).default;
  lang = l;
  document.documentElement.lang = lang;
}
export function t(s, vars) {
  let out = lang === 'en' ? (EN[s] ?? s) : s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  return out;
}
