import { h } from '../lib/utils.js';
import { icon } from './icons.js';
import { t } from '../i18n.js';

/** Ouvre une boîte de dialogue. content: Node. Renvoie {close, el}. */
export function openModal({ title, content, actions = [], width = 520, onClose, className = '' }) {
  const overlay = h('div', { class: 'modal-overlay' });
  const box = h('div', { class: `modal ${className}`, role: 'dialog', 'aria-modal': 'true', style: { maxWidth: `${width}px` } });
  const close = (result) => {
    overlay.classList.remove('in');
    setTimeout(() => overlay.remove(), 180);
    document.removeEventListener('keydown', onKey, true);
    onClose?.(result);
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  const head = h('div', { class: 'modal-head' }, h('h3', {}, title), h('button', { class: 'icon-btn', 'aria-label': t('Fermer'), onclick: () => close() }, icon('x', 18)));
  const foot = actions.length ? h('div', { class: 'modal-foot' }, actions.map((a) => h('button', {
    class: `btn ${a.primary ? 'btn-primary' : a.danger ? 'btn-danger' : 'btn-ghost'}`,
    onclick: async () => { const r = a.onClick ? await a.onClick(close) : undefined; if (a.close !== false && r !== false) close(a.value); },
  }, a.label))) : null;
  box.append(head, h('div', { class: 'modal-body' }, content), foot);
  overlay.append(box);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add('in'));
  return { close, el: box };
}

export function prompt({ title, label, value = '', type = 'text', placeholder = '', okLabel = 'OK' }) {
  return new Promise((resolve) => {
    const input = h('input', { type, value, placeholder, class: 'input', autofocus: true });
    const m = openModal({
      title,
      width: 420,
      content: h('label', { class: 'field' }, h('span', {}, label), input),
      actions: [
        { label: t('Annuler'), value: null },
        { label: okLabel, primary: true, onClick: () => resolve(input.value), value: undefined },
      ],
      onClose: (r) => { if (r === null || r === undefined) resolve(r === null ? null : undefined); },
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { resolve(input.value); m.close(undefined); } });
    setTimeout(() => input.focus(), 50);
  }).then((v) => (v === undefined ? null : v));
}

export function confirmDialog({ title, message, okLabel = 'OK', danger = false }) {
  return new Promise((resolve) => {
    openModal({
      title, width: 440,
      content: h('p', {}, message),
      actions: [
        { label: t('Annuler'), value: false },
        { label: okLabel, primary: !danger, danger, value: true },
      ],
      onClose: (r) => resolve(!!r),
    });
  });
}

/** Barre de progression modale */
export function progressModal(title) {
  const bar = h('div', { class: 'progress-bar' }, h('div', { class: 'progress-fill' }));
  const label = h('p', { class: 'muted' }, '');
  const m = openModal({ title, width: 380, content: h('div', {}, bar, label), onClose: () => {} });
  m.el.querySelector('.icon-btn').style.display = 'none';
  return {
    set(p, text) { bar.firstChild.style.width = `${Math.round(p * 100)}%`; if (text !== undefined) label.textContent = text; },
    close: m.close,
  };
}
