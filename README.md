<div align="center">

# FragPDF

**La boîte à outils PDF complète — 100 % dans votre navigateur.**
Éditez, signez, fusionnez, divisez, compressez, convertissez et protégez vos PDF.
Aucun envoi de fichier, aucun compte, fonctionne hors ligne.

</div>

---

## Pourquoi FragPDF ?

Les services en ligne (iLovePDF, Smallpdf…) envoient vos documents sur leurs serveurs. **FragPDF traite tout localement** :
pdf.js pour l'affichage, pdf-lib pour l'écriture, QPDF (WebAssembly) pour le chiffrement, Tesseract pour l'OCR.
Vos contrats, factures et pièces d'identité ne quittent jamais votre appareil.

## Fonctionnalités

### Éditeur PDF complet
| | |
|---|---|
| **Modifier le texte existant** | cliquez sur une ligne du PDF : elle est recouverte par un aplat de la couleur du fond et remplacée par un texte éditable (police, taille, couleur détectées) |
| **Texte libre** | 12 polices (dont Inter, Roboto, Lora, Playfair, Caveat…), taille, gras/italique/souligné, alignement, interligne, fond, opacité, rotation |
| **Images** | import (PNG, JPG, WebP…), glisser-déposer, collage, redimensionnement, rotation, opacité |
| **Signature** | dessinée (stylet / souris / doigt), tapée (3 écritures manuscrites) ou importée (détourage automatique du fond), signatures mémorisées |
| **Annotations** | surligneur, soulignement, barré (sur le texte ou en zone libre), dessin libre, rectangle, ellipse, ligne, flèche, notes, tampons (APPROUVÉ, CONFIDENTIEL…), coches ✓ ✗ ○ ● |
| **Effacer** | aplat de couleur (avec pipette) ou **caviardage définitif** : les pages concernées sont rasterisées, le texte dessous est réellement détruit, le reste de la page demeure cherchable |
| **Caviardage automatique** | détecte e-mails, téléphones, IBAN, cartes bancaires (Luhn), n° de sécu, adresses web ou un mot précis dans tout le document |
| **Formulaires** | remplissage des champs AcroForm (texte, cases, listes, boutons radio) + aplatissement |
| **Liens** | zones cliquables vers une URL ou une page |
| **Pages** | miniatures, rotation, duplication, suppression, déplacement par glisser-déposer, insertion de pages blanches ou d'un autre PDF |
| **Confort** | annuler/rétablir illimité, copier/coller, duplication, plans avant/arrière, aimantation d'angle (Maj), recherche de texte, zoom (Ctrl + molette), mode sombre, raccourcis clavier, sauvegarde automatique avec reprise |

### Outils (comme iLovePDF, en local)
- **Organiser** : fusionner, diviser (plages, toutes les N pages, page par page), organiser les pages, extraire, supprimer, pivoter, rogner (cadre visuel), numéroter, filigrane (texte ou image, diagonale/mosaïque), en-tête/pied de page, supprimer les pages blanches, plusieurs pages par feuille, changer le format (A4, Letter…), **comparer deux PDF** (différences visuelles + mots ajoutés/supprimés)
- **Optimiser** : compression (recompression des images embarquées en conservant le texte vectoriel — 4 niveaux), niveaux de gris / noir & blanc, réparation, **OCR** (Tesseract.js)
- **Convertir** : images → PDF, PDF → images (PNG/JPG/WebP, ZIP), PDF → Word (.docx), PDF → texte, texte → PDF, extraction des images, **scanner** (caméra → PDF avec amélioration)
- **Sécurité** : protection par mot de passe **AES-256** avec permissions, déverrouillage, métadonnées, nettoyage (scripts, pièces jointes, métadonnées), aplatissement des formulaires

## Démarrage

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production → dist/
npm run preview    # sert dist/ (service worker actif → mode hors ligne)
npm run test:e2e   # tests de bout en bout (Playwright + Chromium)
```

Le site généré est **100 % statique** (chemins relatifs) : déployez `dist/` n'importe où (GitHub Pages, Netlify, Nginx, clé USB…).
Un workflow GitHub Actions (`.github/workflows/pages.yml`) publie automatiquement sur GitHub Pages.

## Architecture

```
src/
├── main.js              routeur (hash) + service worker
├── home.js              page d'accueil (catalogue d'outils)
├── lib/                 moteur, sans dépendance à l'interface
│   ├── pdfjs.js         ouverture / rendu (pdf.js « legacy » : compatible anciens navigateurs)
│   ├── pdf-ops.js       fusion, découpe, rotation, rognage, tampons, métadonnées, images → PDF…
│   ├── compress.js      recompression d'images (JPEG/Flate), mode « extrême » par rasterisation
│   ├── convert.js       PDF → images / texte / docx
│   ├── security.js      chiffrement/déchiffrement/réparation via QPDF (WASM)
│   ├── ocr.js           OCR + calque de texte invisible
│   ├── geometry.js      coordonnées visuelles ↔ espace PDF (pages tournées, CropBox)
│   ├── draw.js          texte multi-lignes, retour à la ligne identique à l'écran
│   └── fonts.js         polices standard + polices Unicode embarquées
├── editor/              l'éditeur (état, visionneuse, annotations, export, signature…)
├── tools/               pages d'outils (cadre générique + un module par famille)
└── ui/                  icônes, modales, toasts, contrôles
```

**Principe de l'éditeur.** Les modifications sont des *annotations* (objets en points PDF, origine en haut à gauche) superposées aux pages
dans un calque DOM. À l'export, `editor/export.js` les « cuit » dans le PDF avec pdf-lib : texte (polices intégrées, retours à la ligne
identiques à l'écran), images, tracés vectoriels, surlignage en mode *Multiply*, liens, valeurs de formulaire. Les pages tournées et les
`CropBox` sont gérées par `lib/geometry.js`. Le caviardage rasterise la page concernée avant d'appliquer les autres objets.

## Limites connues

- La **modification du texte existant** recouvre l'ancien texte et en écrit un nouveau : ce n'est pas une réécriture du flux de contenu
  du PDF (le texte d'origine reste présent sous l'aplat — utilisez le *caviardage* pour une suppression définitive).
- Les polices intégrées couvrent l'alphabet latin (français, anglais, espagnol, allemand… ). Les alphabets non latins ne sont pas pris en charge à l'écriture.
- *PDF → Word* extrait le texte et les titres, pas la mise en page.
- L'OCR télécharge une fois les données de langue (Tesseract) depuis Internet ; les pages, elles, restent locales.

## Licences

FragPDF est publié sous licence MIT. Il s'appuie sur [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0),
[pdf-lib](https://github.com/Hopding/pdf-lib) (MIT), [QPDF](https://github.com/qpdf/qpdf) via `@neslinesli93/qpdf-wasm` (Apache-2.0),
[Tesseract.js](https://github.com/naptha/tesseract.js) (Apache-2.0), [JSZip](https://github.com/Stuk/jszip) (MIT/GPL) et les polices
[Fontsource](https://fontsource.org) (SIL OFL).
