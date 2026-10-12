// Registre des outils : métadonnées (affichage accueil) + chargement paresseux du module.
import { t } from '../i18n.js';

export const CATEGORIES = [
  { id: 'edit', label: 'Éditer & annoter', color: '#7c5cff' },
  { id: 'organize', label: 'Organiser', color: '#2f80ed' },
  { id: 'optimize', label: 'Optimiser', color: '#1fa971' },
  { id: 'convert', label: 'Convertir', color: '#f59e0b' },
  { id: 'security', label: 'Sécurité & confidentialité', color: '#ec4899' },
];

// kind 'editor' : ouvre l'éditeur avec l'outil présélectionné ; 'task' : page d'outil dédiée.
export const TOOLS = [
  // Éditer
  { id: 'editor', cat: 'edit', kind: 'editor', preset: 'select', icon: 'pen', title: 'Éditeur PDF complet', desc: 'Texte, images, formes, dessin, surlignage, signature, formulaires… tout en un.', badge: 'Phare' },
  { id: 'edit-text', cat: 'edit', kind: 'editor', preset: 'edittext', icon: 'type', title: 'Modifier le texte', desc: 'Cliquez sur un texte existant pour le réécrire ou l’effacer.' },
  { id: 'add-text', cat: 'edit', kind: 'editor', preset: 'text', icon: 'text', title: 'Ajouter du texte', desc: 'Polices, tailles, couleurs, alignement, rotation.' },
  { id: 'add-image', cat: 'edit', kind: 'editor', preset: 'image', icon: 'image', title: 'Insérer une image', desc: 'Logos, photos, tampons : déplacez, redimensionnez, pivotez.' },
  { id: 'sign', cat: 'edit', kind: 'editor', preset: 'sign', icon: 'sign', title: 'Signer un PDF', desc: 'Dessinez, tapez ou importez votre signature et placez-la.' },
  { id: 'annotate', cat: 'edit', kind: 'editor', preset: 'highlight', icon: 'highlight', title: 'Surligner & annoter', desc: 'Surligneur, soulignement, barré, dessin libre, formes, notes.' },
  { id: 'whiteout', cat: 'edit', kind: 'editor', preset: 'whiteout', icon: 'eraser', title: 'Effacer / blanchir', desc: 'Masquez du contenu avec une zone de couleur unie.' },
  { id: 'forms', cat: 'edit', kind: 'editor', preset: 'forms', icon: 'form', title: 'Remplir un formulaire', desc: 'Remplit les champs interactifs et aplatit le résultat.' },
  // Organiser
  { id: 'merge', cat: 'organize', icon: 'merge', title: 'Fusionner des PDF', desc: 'Combinez plusieurs PDF dans l’ordre de votre choix.', load: () => import('./organize.js').then((m) => m.merge) },
  { id: 'split', cat: 'organize', icon: 'split', title: 'Diviser un PDF', desc: 'Par plages, toutes les N pages ou page par page (ZIP).', load: () => import('./organize.js').then((m) => m.split) },
  { id: 'organize', cat: 'organize', icon: 'grid', title: 'Organiser les pages', desc: 'Réordonnez, pivotez, dupliquez, supprimez, insérez des pages blanches.', load: () => import('./pagegrid.js').then((m) => m.organize) },
  { id: 'extract', cat: 'organize', icon: 'files', title: 'Extraire des pages', desc: 'Créez un nouveau PDF à partir des pages sélectionnées.', load: () => import('./pagegrid.js').then((m) => m.extract) },
  { id: 'remove', cat: 'organize', icon: 'trash', title: 'Supprimer des pages', desc: 'Retirez les pages inutiles en un clic.', load: () => import('./pagegrid.js').then((m) => m.remove) },
  { id: 'rotate', cat: 'organize', icon: 'rotate', title: 'Pivoter des pages', desc: 'Tournez toutes les pages ou une sélection de 90°, 180°, 270°.', load: () => import('./pagegrid.js').then((m) => m.rotate) },
  { id: 'crop', cat: 'organize', icon: 'crop', title: 'Rogner les pages', desc: 'Supprimez les marges avec un cadre visuel.', load: () => import('./stamp.js').then((m) => m.crop) },
  { id: 'page-numbers', cat: 'organize', icon: 'hash', title: 'Numéroter les pages', desc: 'Formats, positions, polices et plage personnalisés.', load: () => import('./stamp.js').then((m) => m.pageNumbers) },
  { id: 'watermark', cat: 'organize', icon: 'drop', title: 'Filigrane', desc: 'Ajoutez un texte ou un logo en transparence, en diagonale ou en mosaïque.', load: () => import('./stamp.js').then((m) => m.watermark) },
  { id: 'header-footer', cat: 'organize', icon: 'layout', title: 'En-tête & pied de page', desc: 'Texte avec variables : {n}, {total}, {date}, {title}.', load: () => import('./stamp.js').then((m) => m.headerFooter) },
  // Optimiser
  { id: 'compress', cat: 'optimize', icon: 'compress', title: 'Compresser un PDF', desc: 'Réduisez le poids en recompressant les images, en gardant le texte net.', badge: 'Top', load: () => import('./optimize.js').then((m) => m.compress) },
  { id: 'repair', cat: 'optimize', icon: 'repair', title: 'Réparer un PDF', desc: 'Tente de récupérer un fichier corrompu ou mal formé.', load: () => import('./optimize.js').then((m) => m.repair) },
  { id: 'ocr', cat: 'optimize', icon: 'ocr', title: 'OCR — texte des scans', desc: 'Reconnaît le texte d’un PDF scanné et le rend sélectionnable.', badge: 'Nouveau', load: () => import('./optimize.js').then((m) => m.ocr) },
  // Convertir
  { id: 'img2pdf', cat: 'convert', icon: 'image', title: 'Images → PDF', desc: 'JPG, PNG, WebP… en un PDF, format et marges au choix.', load: () => import('./convert.js').then((m) => m.imgToPdf) },
  { id: 'pdf2img', cat: 'convert', icon: 'file', title: 'PDF → Images', desc: 'Exportez chaque page en PNG, JPG ou WebP (archive ZIP).', load: () => import('./convert.js').then((m) => m.pdfToImg) },
  { id: 'pdf2word', cat: 'convert', icon: 'book', title: 'PDF → Word', desc: 'Extrait le texte et les titres vers un document .docx.', load: () => import('./convert.js').then((m) => m.pdfToWord) },
  { id: 'pdf2text', cat: 'convert', icon: 'list', title: 'PDF → Texte', desc: 'Extrait tout le texte dans un fichier .txt.', load: () => import('./convert.js').then((m) => m.pdfToTxt) },
  { id: 'txt2pdf', cat: 'convert', icon: 'text', title: 'Texte → PDF', desc: 'Transforme un texte ou fichier .txt en PDF paginé.', load: () => import('./convert.js').then((m) => m.txtToPdf) },
  // Sécurité
  { id: 'protect', cat: 'security', icon: 'lock', title: 'Protéger par mot de passe', desc: 'Chiffrement AES-256 et permissions (impression, copie…).', load: () => import('./secure.js').then((m) => m.protect) },
  { id: 'unlock', cat: 'security', icon: 'unlock', title: 'Déverrouiller un PDF', desc: 'Retire le mot de passe d’un PDF dont vous connaissez la clé.', load: () => import('./secure.js').then((m) => m.unlock) },
  { id: 'redact', cat: 'security', kind: 'editor', preset: 'redact', icon: 'redact', title: 'Caviarder (définitif)', desc: 'Noircit et supprime réellement le contenu sous la zone.' },
  { id: 'metadata', cat: 'security', icon: 'tag', title: 'Métadonnées', desc: 'Titre, auteur, mots-clés : consultez, modifiez ou effacez.', load: () => import('./secure.js').then((m) => m.metadata) },
  { id: 'sanitize', cat: 'security', icon: 'shield', title: 'Nettoyer le document', desc: 'Supprime métadonnées, scripts, pièces jointes et commentaires cachés.', load: () => import('./secure.js').then((m) => m.sanitizeTool) },
  { id: 'flatten', cat: 'security', icon: 'flatten', title: 'Aplatir le PDF', desc: 'Fige les champs de formulaire remplis pour qu’ils ne soient plus modifiables.', load: () => import('./secure.js').then((m) => m.flatten) },
];

export const TOOL_MAP = Object.fromEntries(TOOLS.map((x) => [x.id, x]));
export const catOf = (id) => CATEGORIES.find((c) => c.id === id);
export const toolTitle = (x) => t(x.title);
