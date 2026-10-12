// i18n minimaliste : la clé est le texte français ; EN fournit la traduction si elle existe.
const EN = {
  'Accueil': 'Home', 'Éditeur': 'Editor', 'Outils': 'Tools', 'Fusionner': 'Merge', 'Diviser': 'Split',
  'Compresser': 'Compress', 'Protéger': 'Protect', 'Déverrouiller': 'Unlock', 'Signer': 'Sign',
  'Télécharger': 'Download', 'Annuler': 'Cancel', 'Fermer': 'Close', 'Appliquer': 'Apply', 'Ouvrir un PDF': 'Open a PDF',
  'Rechercher un outil…': 'Search a tool…', 'Éditer': 'Edit', 'Organiser': 'Organize', 'Optimiser': 'Optimize',
  'Convertir': 'Convert', 'Sécurité': 'Security', 'Tous les outils': 'All tools',
  'Glissez vos fichiers ici': 'Drop your files here', 'ou cliquez pour parcourir': 'or click to browse',
  'Vos fichiers ne quittent jamais votre appareil': 'Your files never leave your device',
  'Annuler (Ctrl+Z)': 'Undo (Ctrl+Z)', 'Rétablir (Ctrl+Y)': 'Redo (Ctrl+Y)', 'Enregistrer': 'Save',
  'Page': 'Page', 'Pages': 'Pages', 'Mode sombre': 'Dark mode', 'Mode clair': 'Light mode',
};
let lang = 'fr';
export function getLang() { return lang; }
export function setLang(l) {
  lang = l === 'en' ? 'en' : 'fr';
  try { localStorage.setItem('fragpdf.lang', lang); } catch { /* ignoré */ }
  document.documentElement.lang = lang;
}
export function initLang() {
  let l = 'fr';
  try { l = localStorage.getItem('fragpdf.lang') || (navigator.language?.startsWith('en') ? 'en' : 'fr'); } catch { /* ignoré */ }
  setLang(l);
}
export function t(s, vars) {
  let out = lang === 'en' ? (EN[s] ?? s) : s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  return out;
}
