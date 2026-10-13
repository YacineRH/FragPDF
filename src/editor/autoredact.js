// Détection automatique de données sensibles (e-mails, téléphones, IBAN, cartes…) pour le caviardage.

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const luhn = (digits) => {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = +digits[i];
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
};

export const KINDS = {
  email: { label: 'E-mails', re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  phone: { label: 'Téléphones', re: /(?:\+|00)\d{1,3}[\s.-]?\(?\d\)?(?:[\s.-]?\d{2,3}){3,4}|\b0[1-9](?:[\s.-]?\d{2}){4}\b/g },
  iban: { label: 'IBAN', re: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g },
  card: { label: 'Cartes bancaires', re: /\b(?:\d[ -]?){13,19}\b/g, validate: (m) => { const d = m.replace(/\D/g, ''); return d.length >= 13 && d.length <= 19 && luhn(d); } },
  ssn: { label: 'N° de sécurité sociale', re: /\b[12]\s?\d{2}\s?(?:0[1-9]|1[0-2])\s?\d{2}\s?\d{3}\s?\d{3}(?:\s?\d{2})?\b/g },
  url: { label: 'Adresses web', re: /\bhttps?:\/\/[^\s]+|\bwww\.[^\s]+/gi },
};

/** Regroupe les éléments de texte d'une page en lignes avec la position horizontale de chaque caractère. */
function buildLines(items) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const line = lines.find((l) => Math.abs(l.y - it.y) < it.h * 0.45);
    if (line) line.items.push(it); else lines.push({ y: it.y, items: [it] });
  }
  return lines.map((l) => {
    l.items.sort((a, b) => a.x - b.x);
    let s = '';
    const pos = []; // pour chaque caractère : [x début, x fin]
    let prev = null;
    for (const it of l.items) {
      if (prev && it.x - (prev.x + prev.w) > it.h * 0.15 && !s.endsWith(' ')) { s += ' '; pos.push([prev.x + prev.w, it.x]); }
      const len = Math.max(1, it.str.length);
      for (let k = 0; k < it.str.length; k++) pos.push([it.x + (it.w * k) / len, it.x + (it.w * (k + 1)) / len]);
      s += it.str;
      prev = it;
    }
    return { s, pos, y: Math.min(...l.items.map((i) => i.y)), h: Math.max(...l.items.map((i) => i.h)) };
  });
}

/**
 * Parcourt le document et renvoie les rectangles à caviarder.
 * spec = { literal?: string, kinds?: string[] }
 */
export async function scanDocument(state, finder, spec, onProgress) {
  const out = [];
  const matchers = [];
  if (spec.literal?.trim()) matchers.push({ literal: norm(spec.literal.trim()) });
  for (const k of spec.kinds || []) if (KINDS[k]) matchers.push({ ...KINDS[k] });
  for (let i = 0; i < state.pages.length; i++) {
    onProgress?.(i / state.pages.length);
    const lines = buildLines(await finder.pageItems(i));
    for (const line of lines) {
      for (const m of matchers) {
        const ranges = [];
        if (m.literal) {
          const hay = norm(line.s);
          let from = 0;
          for (;;) { const k = hay.indexOf(m.literal, from); if (k < 0) break; ranges.push([k, k + m.literal.length]); from = k + m.literal.length; }
        } else {
          m.re.lastIndex = 0;
          let r;
          while ((r = m.re.exec(line.s))) {
            if (!m.validate || m.validate(r[0])) ranges.push([r.index, r.index + r[0].length]);
            if (r[0].length === 0) m.re.lastIndex++;
          }
        }
        for (const [a, b] of ranges) {
          const x0 = line.pos[a]?.[0], x1 = line.pos[b - 1]?.[1];
          if (x0 === undefined || x1 === undefined) continue;
          out.push({ page: i, x: x0 - 1.5, y: line.y - 1, w: x1 - x0 + 3, h: line.h + 2 });
        }
      }
    }
  }
  return out;
}
