import { h } from '../lib/utils.js';
import { icon } from './icons.js';

let host;
export function toast(message, kind = 'info', ms = 3600) {
  if (!host) { host = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(host); }
  const el = h('div', { class: `toast toast-${kind}` }, icon(kind === 'error' ? 'x' : kind === 'success' ? 'check' : 'info', 18), h('span', {}, message));
  host.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); }, ms);
}
export const toastError = (m) => toast(m, 'error', 6000);
