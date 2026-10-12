// Géométrie de page : passage des coordonnées « visuelles » (origine en haut à gauche, y vers le bas,
// en points PDF, page déjà tournée) vers l'espace utilisateur PDF (origine en bas à gauche).

export function pageGeometry(page) {
  const box = page.getCropBox();
  const rot = (((page.getRotation().angle % 360) + 360) % 360);
  const swap = rot === 90 || rot === 270;
  const w = swap ? box.height : box.width;
  const h = swap ? box.width : box.height;

  /** (vx, vy) visuel -> {x, y} espace utilisateur */
  function map(vx, vy) {
    switch (rot) {
      case 90: return { x: box.x + vy, y: box.y + vx };
      case 180: return { x: box.x + box.width - vx, y: box.y + vy };
      case 270: return { x: box.x + box.width - vy, y: box.y + box.height - vx };
      default: return { x: box.x + vx, y: box.y + box.height - vy };
    }
  }

  /**
   * Boîte (x,y,w,h) visuelle éventuellement tournée de `deg` degrés (sens horaire, autour du centre)
   * -> origine (coin bas-gauche de l'objet) et angle (anti-horaire) en espace utilisateur,
   * à fournir à pdf-lib (drawText/drawImage/drawRectangle avec rotate).
   */
  function placeBox(x, y, bw, bh, deg = 0) {
    const r = (deg * Math.PI) / 180;
    const cx = x + bw / 2, cy = y + bh / 2;
    const dx = -bw / 2, dy = bh / 2; // coin bas-gauche local (y vers le bas)
    const vx = cx + dx * Math.cos(r) - dy * Math.sin(r);
    const vy = cy + dx * Math.sin(r) + dy * Math.cos(r);
    const o = map(vx, vy);
    return { x: o.x, y: o.y, angle: rot - deg };
  }

  /** Rectangle visuel axis-aligné -> rectangle utilisateur {x,y,width,height} */
  function rect(x, y, rw, rh) {
    const a = map(x, y), b = map(x + rw, y + rh);
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
  }

  return { w, h, rot, box, map, placeBox, rect };
}

/** Position d'un bloc (largeur bw × hauteur bh) dans la page selon une grille 3×3. */
export function gridPosition(pos, pw, ph, bw, bh, margin = 24) {
  const [v, hz] = pos.split('-'); // top|middle|bottom - left|center|right
  const x = hz === 'left' ? margin : hz === 'right' ? pw - bw - margin : (pw - bw) / 2;
  const y = v === 'top' ? margin : v === 'bottom' ? ph - bh - margin : (ph - bh) / 2;
  return { x, y };
}

/** Inverse de geo.map : coordonnées utilisateur -> coordonnées visuelles. */
export function unmapPoint(geo, ux, uy) {
  const { box, rot } = geo;
  switch (rot) {
    case 90: return { x: uy - box.y, y: ux - box.x };
    case 180: return { x: box.x + box.width - ux, y: uy - box.y };
    case 270: return { x: box.y + box.height - uy, y: box.x + box.width - ux };
    default: return { x: ux - box.x, y: box.y + box.height - uy };
  }
}

export function userRectToVisual(geo, r) {
  const a = unmapPoint(geo, r.x, r.y), b = unmapPoint(geo, r.x + r.width, r.y + r.height);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}
