// Panneau de propriétés : options de l'outil actif ou de l'objet sélectionné.
import { h } from '../lib/utils.js';
import { icon } from '../ui/icons.js';
import { t, pagesLabel } from '../i18n.js';
import { FONTS, ensureFontLoaded } from '../lib/fonts.js';
import { colorControl, numberControl, sliderControl, toggleButtons, segControl, row } from '../ui/controls.js';
import { formatBytes } from '../lib/utils.js';

const GROUP_OF_TYPE = { text: 'text', rect: 'shape', ellipse: 'shape', line: 'line', arrow: 'line', ink: 'ink', highlight: 'highlight', underline: 'underline', strike: 'strike', whiteout: 'whiteout', redact: 'redact', mark: 'mark', stamp: 'stamp', link: 'link', image: 'image' };
const GROUP_OF_TOOL = { text: 'text', note: 'text', rect: 'shape', ellipse: 'shape', line: 'line', arrow: 'line', ink: 'ink', highlight: 'highlight', underline: 'underline', strike: 'strike', whiteout: 'whiteout', redact: 'redact', mark: 'mark', stamp: 'stamp', link: 'link' };

export const TITLES = {
  select: 'Sélection', edittext: 'Modifier le texte', text: 'Texte', note: 'Note', image: 'Image', sign: 'Signature', highlight: 'Surligneur', underline: 'Soulignement', strike: 'Barré', ink: 'Dessin libre',
  rect: 'Rectangle', ellipse: 'Ellipse', line: 'Ligne', arrow: 'Flèche', whiteout: 'Effaceur (aplat)', redact: 'Caviardage', stamp: 'Tampon', mark: 'Coche / croix', link: 'Lien', forms: 'Formulaire',
  highlightbox: 'Surligneur',
};

const STAMPS = ['APPROUVÉ', 'REFUSÉ', 'BROUILLON', 'CONFIDENTIEL', 'URGENT', 'COPIE', 'PAYÉ', 'ORIGINAL', 'À REVOIR', 'SIGNÉ'].map((s) => t(s));
const STAMP_COLORS = ['#16a34a', '#e5384f', '#2563eb', '#f97316', '#7c3aed', '#111111'];

export class PropsPanel {
  constructor(state, host, actions) {
    this.state = state;
    this.host = host;
    this.actions = actions;
    this.lastCP = 0;
    state.on('selection', () => this.render());
    state.on('tool', () => this.render());
    state.on('doc', () => this.render());
    this.render();
  }

  context() {
    const st = this.state;
    const sel = st.selected();
    if (sel.length) {
      const group = GROUP_OF_TYPE[sel[0].type];
      const same = sel.every((a) => GROUP_OF_TYPE[a.type] === group);
      return { kind: 'selection', sel, group: same ? group : null, first: sel[0] };
    }
    const g = GROUP_OF_TOOL[st.tool];
    if (g) return { kind: 'tool', group: g };
    return { kind: 'none' };
  }

  /** Valeur courante d'une propriété (objet sélectionné ou valeurs par défaut de l'outil). */
  get(ctx, prop) {
    if (ctx.kind === 'selection') return ctx.first[prop];
    return this.state.opts[ctx.group]?.[prop];
  }

  set(ctx, patch) {
    const st = this.state;
    const now = Date.now();
    if (ctx.kind === 'selection') {
      if (now - this.lastCP > 700) st.checkpoint();
      this.lastCP = now;
      for (const a of ctx.sel) st.updateAnnot(a.id, patch);
      const g = ctx.group;
      if (g && st.opts[g]) Object.assign(st.opts[g], Object.fromEntries(Object.entries(patch).filter(([k]) => k in st.opts[g])));
    } else if (ctx.group) Object.assign(st.opts[ctx.group], patch);
    st.emit('optschange');
  }

  render() {
    const st = this.state;
    const ctx = this.context();
    const host = this.host;
    host.replaceChildren();
    const title = ctx.kind === 'selection' ? this.selTitle(ctx) : t(TITLES[st.tool] || 'Sélection');
    host.append(h('div', { class: 'props-head' }, h('h3', {}, title)));
    const body = h('div', { class: 'props-body' });
    host.append(body);

    if (ctx.kind === 'none' || (ctx.kind === 'selection' && !ctx.group)) {
      if (ctx.kind === 'selection') this.buildActions(body, ctx);
      else this.buildDocInfo(body);
      return;
    }
    const g = ctx.group;
    const R = (label, ctl) => body.append(row(label, ctl));
    const apply = (patch) => this.set(ctx, patch);
    const val = (p) => this.get(ctx, p);
    const hint = (txt) => body.append(h('p', { class: 'prop-hint' }, txt));

    if (ctx.kind === 'tool') hint(this.toolHint(st.tool));

    switch (g) {
      case 'text': {
        const fontSel = h('select', { class: 'input sm' }, FONTS.map((f) => h('option', { value: f.id, selected: f.id === val('fontId') }, f.label)));
        fontSel.addEventListener('change', async () => { await ensureFontLoaded(fontSel.value); apply({ fontId: fontSel.value }); });
        FONTS.forEach((f) => ensureFontLoaded(f.id));
        R(t('Police'), fontSel);
        const size = numberControl({ value: Math.round((val('size') || 18) * 10) / 10, min: 4, max: 400, step: 1, unit: 'pt', onChange: (v) => apply({ size: v }) });
        R(t('Taille'), size.el);
        const tg = toggleButtons([
          { key: 'bold', icon: 'bold', title: t('Gras'), on: !!val('bold') },
          { key: 'italic', icon: 'italic', title: t('Italique'), on: !!val('italic') },
          { key: 'underline', icon: 'underline', title: t('Souligné'), on: !!val('underline') },
        ], (k, v) => apply({ [k]: v }));
        const al = segControl([['left', 'L', 'alignL'], ['center', 'C', 'alignC'], ['right', 'R', 'alignR']], val('align') || 'left', (v) => apply({ align: v }));
        body.append(row(t('Style'), h('div', { class: 'inline' }, tg, al.el)));
        R(t('Couleur'), colorControl({ value: val('color'), onChange: (c) => apply({ color: c }), eyedropper: true }).el);
        R(t('Fond'), colorControl({ value: val('bg'), allowNone: true, onChange: (c) => apply({ bg: c, bgOpacity: 1 }) }).el);
        R(t('Opacité'), sliderControl({ value: Math.round((val('opacity') ?? 1) * 100), min: 10, max: 100, step: 5, format: (v) => `${v}%`, onChange: (v) => apply({ opacity: v / 100 }) }).el);
        if (ctx.kind === 'selection') {
          R(t('Interligne'), sliderControl({ value: val('lineHeight') || 1.25, min: 0.9, max: 2.4, step: 0.05, format: (v) => (+v).toFixed(2), onChange: (v) => apply({ lineHeight: v }) }).el);
          if (ctx.first.covers?.length) body.append(h('p', { class: 'prop-hint' }, t('L’ancien texte est recouvert par un aplat de la couleur du fond. Effacez tout le texte pour simplement supprimer l’original.')));
        }
        break;
      }
      case 'shape': {
        R(t('Contour'), colorControl({ value: val('stroke'), allowNone: false, onChange: (c) => apply({ stroke: c }) }).el);
        R(t('Épaisseur'), sliderControl({ value: val('strokeW') ?? 2, min: 0, max: 24, step: 0.5, format: (v) => `${v} pt`, onChange: (v) => apply({ strokeW: v }) }).el);
        R(t('Remplissage'), colorControl({ value: val('fill'), allowNone: true, onChange: (c) => apply({ fill: c }) }).el);
        R(t('Opacité du fond'), sliderControl({ value: Math.round((val('fillOpacity') ?? 0.25) * 100), min: 5, max: 100, step: 5, format: (v) => `${v}%`, onChange: (v) => apply({ fillOpacity: v / 100 }) }).el);
        R(t('Opacité'), sliderControl({ value: Math.round((val('opacity') ?? 1) * 100), min: 10, max: 100, step: 5, format: (v) => `${v}%`, onChange: (v) => apply({ opacity: v / 100 }) }).el);
        break;
      }
      case 'line': case 'ink': {
        R(t('Couleur'), colorControl({ value: val('stroke'), onChange: (c) => apply({ stroke: c }), eyedropper: true }).el);
        R(t('Épaisseur'), sliderControl({ value: val('strokeW') ?? 3, min: 0.5, max: 30, step: 0.5, format: (v) => `${v} pt`, onChange: (v) => apply({ strokeW: v }) }).el);
        R(t('Opacité'), sliderControl({ value: Math.round((val('opacity') ?? 1) * 100), min: 10, max: 100, step: 5, format: (v) => `${v}%`, onChange: (v) => apply({ opacity: v / 100 }) }).el);
        break;
      }
      case 'highlight': case 'underline': case 'strike': {
        if (ctx.kind === 'tool') {
          const mode = segControl([['text', t('Sur le texte')], ['area', t('Zone libre')]], st.opts.hlMode, (v) => { st.opts.hlMode = v; st.emit('tool', st.tool); this.render(); });
          R(t('Mode'), mode.el);
        }
        const hlColors = g === 'highlight' ? ['#ffe14d', '#7CFC9A', '#7fd4ff', '#ff9ec7', '#ffb347', '#d4a5ff'] : ['#e5384f', '#111111', '#2563eb', '#16a34a', '#f97316'];
        R(t('Couleur'), colorControl({ value: val('color'), palette: hlColors, onChange: (c) => apply({ color: c }) }).el);
        R(t('Opacité'), sliderControl({ value: Math.round((val('opacity') ?? 1) * 100), min: 20, max: 100, step: 5, format: (v) => `${v}%`, onChange: (v) => apply({ opacity: v / 100 }) }).el);
        break;
      }
      case 'whiteout':
        R(t('Couleur de l’aplat'), colorControl({ value: val('color'), onChange: (c) => apply({ color: c }), eyedropper: true }).el);
        body.append(h('p', { class: 'prop-hint warn' }, t('Attention : l’aplat masque le contenu mais ne le supprime pas du fichier. Pour une suppression définitive, utilisez le Caviardage.')));
        break;
      case 'redact':
        body.append(h('p', { class: 'prop-hint warn' }, t('Le caviardage est définitif : à l’export, les pages concernées sont converties en images et le texte sous les zones noires est détruit.')));
        break;
      case 'mark':
        R(t('Symbole'), segControl([['check', '✓'], ['cross', '✗'], ['circle', '○'], ['dot', '●']], val('kind') || 'check', (v) => apply({ kind: v })).el);
        R(t('Couleur'), colorControl({ value: val('color'), onChange: (c) => apply({ color: c }) }).el);
        break;
      case 'stamp': {
        const sel = h('select', { class: 'input sm' }, [...STAMPS, t('Date du jour'), t('Personnalisé…')].map((s) => h('option', { value: s, selected: s === val('label') }, s)));
        const custom = h('input', { class: 'input sm', value: STAMPS.includes(val('label')) ? '' : val('label'), placeholder: t('Texte du tampon') });
        sel.addEventListener('change', () => {
          if (sel.value === t('Date du jour')) apply({ label: new Date().toLocaleDateString('fr-FR') });
          else if (sel.value === t('Personnalisé…')) custom.focus();
          else apply({ label: sel.value });
        });
        custom.addEventListener('input', () => { if (custom.value.trim()) apply({ label: custom.value.toUpperCase() }); });
        R(t('Modèle'), sel);
        R(t('Texte'), custom);
        R(t('Couleur'), colorControl({ value: val('color'), palette: STAMP_COLORS, onChange: (c) => apply({ color: c }) }).el);
        break;
      }
      case 'link': {
        const url = h('input', { class: 'input sm', value: val('url') || 'https://', placeholder: t('https://… ou #page=3') });
        url.addEventListener('input', () => apply({ url: url.value }));
        R(t('Destination'), url);
        hint(t('Saisissez une adresse web, ou #page=3 pour aller à la page 3.'));
        break;
      }
      case 'image': {
        R(t('Opacité'), sliderControl({ value: Math.round((val('opacity') ?? 1) * 100), min: 10, max: 100, step: 5, format: (v) => `${v}%`, onChange: (v) => apply({ opacity: v / 100 }) }).el);
        body.append(h('button', { class: 'btn btn-sm', onclick: () => this.actions.resetAspect() }, icon('image', 15), t('Rétablir les proportions')));
        break;
      }
      default: break;
    }
    if (ctx.kind === 'selection') this.buildActions(body, ctx);
  }

  selTitle(ctx) {
    if (ctx.sel.length > 1) return t('{n} objets', { n: ctx.sel.length });
    const a = ctx.first;
    const names = { text: 'Texte', rect: 'Rectangle', ellipse: 'Ellipse', line: 'Ligne', arrow: 'Flèche', ink: 'Dessin', highlight: 'Surlignage', underline: 'Soulignement', strike: 'Barré', whiteout: 'Aplat', redact: 'Caviardage', stamp: 'Tampon', mark: 'Symbole', link: 'Lien', image: a.sig ? 'Signature' : 'Image' };
    return t(names[a.type] || 'Objet');
  }

  toolHint(tool) {
    const m = {
      text: 'Cliquez sur la page pour écrire, ou glissez pour définir la largeur.',
      note: 'Cliquez pour poser une note autocollante.',
      rect: 'Glissez pour dessiner un rectangle.', ellipse: 'Glissez pour dessiner une ellipse.',
      line: 'Glissez pour tracer une ligne (Maj : angle de 45°).', arrow: 'Glissez pour tracer une flèche (Maj : angle de 45°).',
      ink: 'Dessinez à main levée avec la souris, le doigt ou un stylet.',
      highlight: 'Sélectionnez du texte pour le surligner.', underline: 'Sélectionnez du texte pour le souligner.', strike: 'Sélectionnez du texte pour le barrer.',
      whiteout: 'Glissez sur la zone à masquer.', redact: 'Glissez sur la zone à caviarder définitivement.',
      stamp: 'Cliquez pour poser un tampon, ou glissez pour le dimensionner.', mark: 'Cliquez pour poser le symbole (ou glissez pour le dimensionner).',
      link: 'Glissez sur la zone qui doit devenir cliquable.',
    };
    return t(m[tool] || '');
  }

  buildActions(body, ctx) {
    const a = this.actions;
    const mk = (ic, label, fn, cls = '') => h('button', { class: `btn btn-sm ${cls}`, onclick: fn }, icon(ic, 15), label);
    body.append(h('div', { class: 'prop-actions' },
      mk('copy', t('Dupliquer'), a.duplicate),
      mk('front', t('Premier plan'), a.front),
      mk('back', t('Arrière-plan'), a.back),
      ctx.sel.length === 1 && ['text', 'image', 'rect', 'ellipse', 'stamp', 'whiteout', 'redact', 'mark', 'link'].includes(ctx.first.type) ? mk('move', t('Centrer'), a.center) : null,
      mk('trash', t('Supprimer'), a.remove, 'btn-danger')));
  }

  buildDocInfo(body) {
    const st = this.state;
    body.append(
      h('div', { class: 'doc-card' }, icon('file', 28), h('div', {}, h('b', {}, st.name), h('div', { class: 'muted' }, `${pagesLabel(st.pages.length)} · ${formatBytes(st.bytes?.length || 0)}`))),
      h('p', { class: 'prop-hint' }, t('Choisissez un outil à gauche, ou cliquez sur un objet pour modifier ses propriétés.')),
      h('div', { class: 'shortcuts' },
        h('h4', {}, t('Raccourcis')),
        ...[['V', t('Sélection')], ['E', t('Modifier le texte')], ['T', t('Texte')], ['I', t('Image')], ['H', t('Surligner')], ['D', t('Dessiner')], ['Ctrl+Z / Y', t('Annuler / Rétablir')], ['Ctrl+S', t('Télécharger')], ['Ctrl+F', t('Rechercher')], ['Suppr', t('Supprimer')], ['Maj+clic / Maj+glisser', t('Sélection multiple')]].map(([k, v]) => h('div', { class: 'sc' }, h('span', { class: 'kbd' }, k), h('span', {}, v)))));
  }
}
