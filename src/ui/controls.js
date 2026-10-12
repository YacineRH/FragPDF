// Contrôles de formulaire réutilisables pour les panneaux de propriétés.
import { h } from '../lib/utils.js';
import { icon } from './icons.js';
import { t } from '../i18n.js';

export const PALETTE = ['#111111', '#6b7280', '#ffffff', '#e5384f', '#f97316', '#facc15', '#16a34a', '#0ea5e9', '#2563eb', '#7c3aed', '#ec4899'];

/** Sélecteur de couleur : pastilles + couleur libre (+ pipette si disponible). allowNone ajoute « aucune ». */
export function colorControl({ value, onChange, allowNone = false, palette = PALETTE, eyedropper = false }) {
  const wrap = h('div', { class: 'color-ctl' });
  let cur = value;
  const custom = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#000000', 'aria-label': t('Couleur personnalisée') });
  const draw = () => {
    wrap.replaceChildren();
    if (allowNone) wrap.append(h('button', { type: 'button', class: `swatch none ${!cur ? 'on' : ''}`, title: t('Aucune'), onclick: () => set(null, true) }));
    palette.forEach((c) => wrap.append(h('button', { type: 'button', class: `swatch ${cur && cur.toLowerCase() === c ? 'on' : ''}`, style: { background: c }, title: c, onclick: () => set(c, true) })));
    const isCustom = cur && !palette.includes(cur.toLowerCase());
    custom.value = /^#[0-9a-f]{6}$/i.test(cur || '') ? cur : '#000000';
    const label = h('label', { class: `swatch custom ${isCustom ? 'on' : ''}`, title: t('Couleur personnalisée') }, custom);
    if (isCustom) label.style.background = cur;
    wrap.append(label);
    if (eyedropper && 'EyeDropper' in window) {
      wrap.append(h('button', { type: 'button', class: 'swatch pipette', title: t('Pipette (prélever une couleur à l’écran)'), onclick: async () => {
        try { const r = await new window.EyeDropper().open(); set(r.sRGBHex, true); } catch { /* annulé */ }
      } }, icon('drop', 13)));
    }
  };
  const set = (v, emit) => { cur = v; draw(); if (emit) onChange(v); };
  custom.addEventListener('input', () => { cur = custom.value; onChange(cur); wrap.querySelectorAll('.swatch').forEach((s) => s.classList.remove('on')); wrap.querySelector('.custom')?.classList.add('on'); wrap.querySelector('.custom').style.background = cur; });
  draw();
  return { el: wrap, set: (v) => set(v, false) };
}

export function numberControl({ value, min, max, step = 1, onChange, unit }) {
  const input = h('input', { class: 'input sm', type: 'number', value, min, max, step });
  input.addEventListener('input', () => { const v = parseFloat(input.value); if (!Number.isNaN(v)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v))); });
  return { el: unit ? h('div', { class: 'num-unit' }, input, h('span', {}, unit)) : input, input };
}

export function sliderControl({ value, min, max, step = 1, onChange, format = (v) => v }) {
  const r = h('input', { type: 'range', min, max, step, value });
  const o = h('output', {}, format(value));
  r.addEventListener('input', () => { o.textContent = format(r.value); onChange(parseFloat(r.value)); });
  return { el: h('div', { class: 'range-row' }, r, o), input: r };
}

export function toggleButtons(items, onChange) {
  // items: [{key, icon, title, on}]
  const wrap = h('div', { class: 'tgl-group' });
  const btns = items.map((it) => {
    const b = h('button', { type: 'button', class: `tgl ${it.on ? 'on' : ''}`, title: it.title, onclick: () => { it.on = !it.on; b.classList.toggle('on', it.on); onChange(it.key, it.on); } }, it.label ? it.label : icon(it.icon, 16));
    return b;
  });
  wrap.append(...btns);
  return wrap;
}

export function segControl(options, value, onChange) {
  const wrap = h('div', { class: 'seg' });
  const draw = (cur) => wrap.replaceChildren(...options.map(([v, l, ic]) => h('button', { type: 'button', class: v === cur ? 'on' : '', title: typeof l === 'string' ? l : '', onclick: () => { draw(v); onChange(v); } }, ic ? icon(ic, 16) : l)));
  draw(value);
  return { el: wrap, set: draw };
}

export function row(label, control, cls = '') {
  return h('div', { class: `prop-row ${cls}` }, label ? h('span', { class: 'prop-label' }, label) : null, control);
}
