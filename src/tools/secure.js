import { h, formatBytes } from '../lib/utils.js';
import { icon } from '../ui/icons.js';
import { t } from '../i18n.js';
import { fileTool, ui, outName } from './framework.js';
import { encryptPdf, decryptPdf } from '../lib/security.js';
import { getMetadata, setMetadata, sanitize, flattenForms, loadDoc } from '../lib/pdf-ops.js';

function pwField(label, value = '') {
  const input = h('input', { class: 'input', type: 'password', value, autocomplete: 'new-password' });
  const btn = h('button', { type: 'button', class: 'icon-btn', title: t('Afficher'), onclick: () => { input.type = input.type === 'password' ? 'text' : 'password'; } }, icon('eye', 17));
  return { input, el: h('label', { class: 'field' }, h('span', {}, label), h('div', { class: 'pw-box' }, input, btn)) };
}

export const protect = fileTool({
  accept: 'pdf', multiple: false, runLabel: 'Protéger le PDF', runIcon: 'lock',
  options: () => {
    const pw = pwField(t('Mot de passe d’ouverture'));
    const pw2 = pwField(t('Confirmer le mot de passe'));
    const owner = pwField(t('Mot de passe propriétaire (optionnel)'));
    const print = ui.select([['full', t('Autorisée')], ['low', t('Basse qualité')], ['none', t('Interdite')]], 'full');
    const copy = ui.check(t('Autoriser la copie du contenu'), true);
    const modify = ui.check(t('Autoriser la modification'), true);
    const annotate = ui.check(t('Autoriser les annotations'), true);
    return {
      el: h('div', {}, pw.el, pw2.el, owner.el, h('hr', { style: { border: 0, borderTop: '1px solid var(--border)', margin: '.6rem 0 1rem' } }), ui.field(t('Impression'), print), copy.el, modify.el, annotate.el,
        ui.note(t('Chiffrement AES-256. Attention : en cas d’oubli du mot de passe, le document est irrécupérable.'), 'shield')),
      get: () => {
        if (!pw.input.value) throw new Error(t('Saisissez un mot de passe.'));
        if (pw.input.value !== pw2.input.value) throw new Error(t('Les mots de passe ne correspondent pas.'));
        return { pw: pw.input.value, owner: owner.input.value, perms: { print: print.value, copy: copy.input.checked, modify: modify.input.checked, annotate: annotate.input.checked } };
      },
    };
  },
  async run({ files, opts, progress }) {
    const f = files[0];
    progress(0.3, t('Chiffrement…'));
    const bytes = await encryptPdf(f.bytes, opts.pw, opts.owner, opts.perms);
    return { title: t('PDF protégé !'), message: t('Le mot de passe sera demandé à l’ouverture.'), outputs: [{ name: outName(f, 'protégé'), data: bytes }] };
  },
});

export const unlock = {
  mount(host, meta) {
    // L'ingestion gère déjà la demande de mot de passe : on réutilise le cadre standard.
    return fileTool({
      accept: 'pdf', multiple: false, runLabel: 'Enregistrer sans mot de passe', runIcon: 'unlock',
      options: (ctx) => ({ el: ui.note(ctx.files[0].decrypted ? t('Le mot de passe a été accepté. Enregistrez la copie déverrouillée.') : t('Ce document n’est pas protégé par un mot de passe d’ouverture. Les restrictions éventuelles (copie, impression) seront retirées.'), 'unlock') }),
      async run({ files, progress }) {
        const f = files[0];
        progress(0.4);
        const bytes = await decryptPdf(f.bytes, '');
        return { title: t('PDF déverrouillé !'), outputs: [{ name: outName(f, 'déverrouillé'), data: bytes }] };
      },
    }).mount(host, meta);
  },
};

export const metadata = fileTool({
  accept: 'pdf', multiple: false, runLabel: 'Enregistrer les métadonnées', runIcon: 'tag',
  options: (ctx) => {
    const f = ctx.files[0];
    const fields = {};
    const mk = (k, label) => { fields[k] = h('input', { class: 'input' }); return ui.field(label, fields[k]); };
    const el = h('div', {}, mk('title', t('Titre')), mk('author', t('Auteur')), mk('subject', t('Sujet')), mk('keywords', t('Mots-clés (séparés par des virgules)')), mk('creator', t('Application créatrice')));
    const info = h('p', { class: 'muted', style: { fontSize: '.8rem' } }, t('Lecture…'));
    el.append(info);
    getMetadata(f.bytes).then((m) => {
      Object.keys(fields).forEach((k) => { fields[k].value = m[k] || ''; });
      info.textContent = `${t('Créé')} : ${m.created ? m.created.toLocaleString() : '—'} · ${t('Modifié')} : ${m.modified ? m.modified.toLocaleString() : '—'} · ${t('Producteur')} : ${m.producer || '—'}`;
    });
    const clear = h('button', { class: 'btn btn-sm', type: 'button', onclick: () => Object.values(fields).forEach((i) => { i.value = ''; }) }, icon('eraser', 14), t('Tout effacer'));
    el.append(clear);
    return { el, get: () => Object.fromEntries(Object.entries(fields).map(([k, i]) => [k, i.value])) };
  },
  async run({ files, opts }) {
    const f = files[0];
    const bytes = await setMetadata(f.bytes, { ...opts, producer: '' });
    return { title: t('Métadonnées enregistrées !'), outputs: [{ name: outName(f, 'meta'), data: bytes }] };
  },
});

export const sanitizeTool = fileTool({
  accept: 'pdf', multiple: false, runLabel: 'Nettoyer le document', runIcon: 'shield',
  options: () => {
    const c = {
      metadata: ui.check(t('Métadonnées (auteur, titre, logiciel…)'), true),
      javascript: ui.check(t('JavaScript et actions automatiques'), true),
      attachments: ui.check(t('Pièces jointes intégrées'), true),
      bookmarks: ui.check(t('Signets'), false),
      annotations: ui.check(t('Annotations et commentaires'), false),
      forms: ui.check(t('Aplatir les formulaires'), false),
    };
    return { el: h('div', {}, Object.values(c).map((x) => x.el)), get: () => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.input.checked])) };
  },
  async run({ files, opts }) {
    const f = files[0];
    const bytes = await sanitize(f.bytes, opts);
    return { title: t('Document nettoyé !'), outputs: [{ name: outName(f, 'nettoyé'), data: bytes }] };
  },
});

export const flatten = fileTool({
  accept: 'pdf', multiple: false, runLabel: 'Aplatir', runIcon: 'flatten',
  options: (ctx) => {
    const f = ctx.files[0];
    const info = h('div', {});
    loadDoc(f.bytes).then((d) => {
      const n = d.getForm().getFields().length;
      info.append(ui.note(n ? t('{n} champ(s) de formulaire seront figés.', { n }) : t('Aucun champ de formulaire détecté dans ce document.')));
    });
    return { el: info };
  },
  async run({ files }) {
    const f = files[0];
    const bytes = await flattenForms(f.bytes);
    return { title: t('PDF aplati !'), outputs: [{ name: outName(f, 'aplati'), data: bytes }] };
  },
});
