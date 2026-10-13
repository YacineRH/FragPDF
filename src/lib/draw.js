import { rgb, degrees } from 'pdf-lib';
import { hexToRgb01 } from './utils.js';

export const ASC = 0.905;
export const DESC = 0.212;

export const color = (hex) => { const c = hexToRgb01(hex || '#000000'); return rgb(c.r, c.g, c.b); };

/** Découpe un texte en lignes selon la largeur max (comportement proche de CSS pre-wrap + break-word). */
export function wrapText(font, text, size, maxW) {
  const lines = [];
  const measure = (s) => { try { return font.widthOfTextAtSize(s, size); } catch { return s.length * size * 0.55; } };
  for (const para of String(text).split('\n')) {
    if (!maxW || maxW <= 0) { lines.push(para); continue; }
    let cur = '';
    // on garde les espaces : tokens = mots + espaces
    const tokens = para.match(/\s+|\S+/g) || [''];
    for (const tok of tokens) {
      if (measure(cur + tok) <= maxW || cur === '') {
        if (measure(tok) > maxW && !/^\s+$/.test(tok)) {
          // mot plus long que la ligne : coupe par caractère
          for (const ch of tok) {
            if (measure(cur + ch) > maxW && cur) { lines.push(cur); cur = ch; } else cur += ch;
          }
        } else cur += tok;
      } else {
        if (/^\s+$/.test(tok)) { lines.push(cur); cur = ''; continue; }
        lines.push(cur.replace(/\s+$/, ''));
        cur = '';
        if (measure(tok) > maxW) {
          for (const ch of tok) { if (measure(cur + ch) > maxW && cur) { lines.push(cur); cur = ch; } else cur += ch; }
        } else cur = tok;
      }
    }
    lines.push(cur);
  }
  return lines;
}

/**
 * Dessine un bloc de texte multi-lignes.
 * (x, y) = coin haut-gauche visuel du bloc, deg = rotation horaire autour du centre du bloc.
 */
export function drawTextBlock(page, geo, font, lines, o) {
  const { x, y, w, size, lineHeight = 1.25, align = 'left', deg = 0, opacity = 1, underline = false, strike = false } = o;
  const lh = size * lineHeight;
  const h = lines.length * lh;
  const col = color(o.color);
  const base = (lh - (ASC + DESC) * size) / 2 + ASC * size;
  const widths = lines.map((l) => { try { return font.widthOfTextAtSize(l, size); } catch { return 0; } });
  lines.forEach((line, i) => {
    if (!line) return;
    const tw = widths[i];
    const dx = align === 'center' ? (w - tw) / 2 : align === 'right' ? w - tw : 0;
    // coin bas-gauche de la boîte de ligne, avec rotation globale du bloc (centre = centre du bloc)
    const r = (deg * Math.PI) / 180;
    const cx = x + w / 2, cy = y + h / 2;
    const lx = x + dx, ly = y + i * lh; // haut-gauche de la ligne (non tourné)
    // point de la ligne de base (non tourné) puis rotation horaire autour du centre du bloc
    const bx = lx, by = ly + base;
    const rx = cx + (bx - cx) * Math.cos(r) - (by - cy) * Math.sin(r);
    const ry = cy + (bx - cx) * Math.sin(r) + (by - cy) * Math.cos(r);
    const p = geo.map(rx, ry);
    const angle = geo.rot - deg;
    page.drawText(line, { x: p.x, y: p.y, size, font, color: col, opacity, rotate: degrees(angle) });
    if (underline || strike) {
      const thick = Math.max(0.5, size / 16);
      const off = underline ? size * 0.12 : -size * 0.28;
      const ux = bx, uy = by + off;
      const ex = bx + tw, ey = uy;
      const rot = (px, py) => geo.map(cx + (px - cx) * Math.cos(r) - (py - cy) * Math.sin(r), cy + (px - cx) * Math.sin(r) + (py - cy) * Math.cos(r));
      page.drawLine({ start: rot(ux, uy), end: rot(ex, ey), thickness: thick, color: col, opacity });
    }
  });
  return { w, h };
}

export function measureLines(font, lines, size) {
  let m = 0;
  for (const l of lines) { try { m = Math.max(m, font.widthOfTextAtSize(l, size)); } catch { /* ignoré */ } }
  return m;
}
