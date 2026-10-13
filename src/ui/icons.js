// Jeu d'icônes (style trait 24×24, inspiré de Lucide) — chemins SVG embarqués.
const P = {
  logo: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/><path d="M9 13l2 2 4-4" />',
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  upload: '<path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 20h16"/>',
  download: '<path d="M12 4v12"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/>',
  file: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>',
  files: '<path d="M8 7h8l4 4v10H8z"/><path d="M16 7V3H8L4 7v10h4"/>',
  merge: '<path d="M6 4v6a6 6 0 006 6h0a6 6 0 006-6V4"/><path d="M12 16v5"/><path d="M9 18l3 3 3-3"/>',
  split: '<path d="M12 3v7"/><path d="M12 10l-6 5v6"/><path d="M12 10l6 5v6"/><path d="M9 6l3-3 3 3"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9"/><path d="M14.5 14.5L20 20"/><path d="M8.1 8.1L12 12"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
  rotate: '<path d="M21 12a9 9 0 11-3-6.7"/><path d="M21 4v5h-5"/>',
  rotateL: '<path d="M3 12a9 9 0 103-6.7"/><path d="M3 4v5h5"/>',
  compress: '<path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>',
  text: '<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>',
  type: '<path d="M4 7V5h16v2"/><path d="M9 19h6"/><path d="M12 5v14"/>',
  textedit: '<path d="M4 6V4h12v2"/><path d="M10 4v9"/><path d="M7.5 13h5"/><path d="M14 20l1-3.2 5.2-5.2a1.5 1.5 0 012.1 2.1L17.1 19z"/>',
  pen: '<path d="M4 20l1-4L17 4a2.1 2.1 0 013 3L8 19z"/><path d="M14 7l3 3"/>',
  pencil: '<path d="M3 21l4-1L20 7a2.8 2.8 0 00-4-4L3 16z"/><path d="M14 5l4 4"/>',
  sign: '<path d="M3 17c3-6 5-9 6-9s0 6 2 6 3-4 4-4 1 3 3 3 2-1 3-2"/><path d="M3 21h18"/>',
  highlight: '<path d="M9 11l5 5"/><path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M13 20h8"/>',
  underline: '<path d="M7 4v7a5 5 0 0010 0V4"/><path d="M5 20h14"/>',
  strike: '<path d="M16 6a4 4 0 00-4-2c-3 0-4 2-4 3.5S9 10 12 11"/><path d="M4 12h16"/><path d="M8 17.5A4 4 0 0012 20c3 0 4-1.5 4-3.5 0-1-.4-1.8-1-2.5"/>',
  eraser: '<path d="M20 20H9L4 15a2 2 0 010-3l8-8a2 2 0 013 0l5 5a2 2 0 010 3l-8 8"/><path d="M8 11l6 6"/>',
  whiteout: '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M8 12h8" stroke-dasharray="2 2"/>',
  redact: '<rect x="3" y="9" width="18" height="6" rx="1" fill="currentColor"/><path d="M5 5h6M13 5h6M5 19h4M12 19h7"/>',
  square: '<rect x="4" y="5" width="16" height="14" rx="2"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  line: '<path d="M5 19L19 5"/>',
  arrow: '<path d="M5 19L19 5"/><path d="M9 5h10v10"/>',
  stamp: '<path d="M8 14h8l-1-5a3 3 0 10-6 0z"/><path d="M5 18h14v3H5z"/><path d="M5 14h14v4"/>',
  note: '<path d="M4 4h16v12h-6l-4 4v-4H4z"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 017.5-2"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  drop: '<path d="M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z"/>',
  hash: '<path d="M5 9h14M5 15h14M10 4L8 20M16 4l-2 16"/>',
  crop: '<path d="M6 2v14a2 2 0 002 2h14"/><path d="M2 6h14a2 2 0 012 2v14"/>',
  layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M11 8v6M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M8 11h6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 019.5 4 8.5 8.5 0 1020 14.5z"/>',
  chevL: '<path d="M15 5l-7 7 7 7"/>',
  chevR: '<path d="M9 5l7 7-7 7"/>',
  chevU: '<path d="M5 15l7-7 7 7"/>',
  chevD: '<path d="M5 9l7 7 7-7"/>',
  cursor: '<path d="M5 3l14 7-6 2-2 6z"/>',
  hand: '<path d="M8 13V5a1.5 1.5 0 013 0v6M11 11V3.5a1.5 1.5 0 013 0V11M14 11V5.5a1.5 1.5 0 013 0V14c0 4-2 7-6 7-3 0-5-2-6.5-5L3 12.5a1.5 1.5 0 012.6-1.4L8 14"/>',
  save: '<path d="M5 3h12l4 4v14H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>',
  move: '<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  front: '<rect x="3" y="3" width="12" height="12" rx="1"/><path d="M9 21h12V9"/>',
  back: '<rect x="9" y="9" width="12" height="12" rx="1"/><path d="M3 15V3h12"/>',
  alignL: '<path d="M4 6h16M4 12h10M4 18h14"/>',
  alignC: '<path d="M4 6h16M7 12h10M5 18h14"/>',
  alignR: '<path d="M4 6h16M10 12h10M6 18h14"/>',
  bold: '<path d="M7 4h6a4 4 0 010 8H7zM7 12h7a4 4 0 010 8H7z"/>',
  italic: '<path d="M10 4h8M6 20h8M14 4l-4 16"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  form: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h4"/>',
  ocr: '<path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3"/><path d="M8 9h8M8 12h8M8 15h5"/>',
  wand: '<path d="M4 20L16 8"/><path d="M15 5l4 4"/><path d="M18 2v3M16.5 3.5h3M6 3v2M5 4h2M20 14v2M19 15h2"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
  flatten: '<path d="M3 8l9-5 9 5-9 5z"/><path d="M3 13l9 5 9-5"/>',
  repair: '<path d="M14.7 6.3a4 4 0 005 5L21 12.5 12.5 21 3 11.5l8.5-8.5z" /><path d="M14 8l2 2"/>',
  compare: '<rect x="3" y="4" width="8" height="16" rx="1"/><rect x="13" y="4" width="8" height="16" rx="1"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  book: '<path d="M4 4h6a3 3 0 013 3v13a2 2 0 00-2-2H4zM20 4h-6a3 3 0 00-3 3v13a2 2 0 012-2h7z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  zap: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  cloudOff: '<path d="M3 3l18 18M7 7a5 5 0 00-1 9.9h11M18 18a4 4 0 00-1-7.9 6 6 0 00-6-5"/>',
  frag: '<path d="M4 4h9l-3 6H4z"/><path d="M15 4h5v6h-8z" opacity=".6"/><path d="M4 12h6l-2 8H4z" opacity=".6"/><path d="M12 12h8v8h-9z"/>',
};

export function icon(name, size = 20, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  if (cls) s.setAttribute('class', cls);
  s.innerHTML = P[name] || P.file;
  return s;
}

export function iconHTML(name, size = 20) {
  return icon(name, size).outerHTML;
}
