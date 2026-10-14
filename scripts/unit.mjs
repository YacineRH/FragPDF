// Tests unitaires des fonctions pures (sans navigateur) : node --test scripts/unit.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { parsePageRanges, parseRangeGroups, formatBytes, hexToRgb01, clamp } from '../src/lib/utils.js';
import { pageGeometry, unmapPoint, gridPosition } from '../src/lib/geometry.js';
import { wrapText } from '../src/lib/draw.js';
import { wordDiff } from '../src/lib/diff.js';
import { KINDS } from '../src/editor/autoredact.js';
import { rotateAnnot } from '../src/editor/pageops.js';

test('parsePageRanges', () => {
  assert.deepEqual(parsePageRanges('1-3, 5', 10), [0, 1, 2, 4]);
  assert.deepEqual(parsePageRanges('8-', 10), [7, 8, 9]);
  assert.deepEqual(parsePageRanges('-2', 10), [0, 1]);
  assert.deepEqual(parsePageRanges('3-1', 5), [2, 1, 0]);
  assert.deepEqual(parsePageRanges('2 4;6', 6), [1, 3, 5]);
  assert.deepEqual(parsePageRanges('0, 11, 4', 10), [3]); // hors plage ignoré
  assert.deepEqual(parsePageRanges('3 - 5', 10), [2, 3, 4]); // espaces autour du tiret
  assert.throws(() => parsePageRanges('a-b', 10), /invalide/);
});

test('parseRangeGroups', () => {
  assert.deepEqual(parseRangeGroups('1-2, 4, 6-', 7), [[0, 1], [3], [5, 6]]);
  assert.deepEqual(parseRangeGroups('', 7), []);
});

test('utilitaires', () => {
  assert.equal(formatBytes(0), '0 o');
  assert.equal(formatBytes(1536), '1.5 Ko');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 Mo');
  assert.deepEqual(hexToRgb01('#ff0000'), { r: 1, g: 0, b: 0 });
  assert.deepEqual(hexToRgb01('#0f0'), { r: 0, g: 1, b: 0 });
  assert.equal(clamp(5, 0, 3), 3);
});

async function fakePage(w, h, rot, box) {
  const doc = await PDFDocument.create();
  const p = doc.addPage([w, h]);
  if (box) { p.setMediaBox(...box); p.setCropBox(...box); }
  p.setRotation({ type: 'degrees', angle: rot });
  return p;
}

test('géométrie : map / unmap sont inverses (rotations, CropBox décalée)', async () => {
  for (const rot of [0, 90, 180, 270]) {
    for (const box of [null, [30, 20, 400, 600]]) {
      const geo = pageGeometry(await fakePage(500, 700, rot, box));
      for (const [x, y] of [[0, 0], [10, 20], [geo.w, geo.h], [geo.w / 3, geo.h / 2]]) {
        const u = geo.map(x, y);
        const v = unmapPoint(geo, u.x, u.y);
        assert.ok(Math.abs(v.x - x) < 1e-6 && Math.abs(v.y - y) < 1e-6, `rot ${rot} box ${box}: (${x},${y}) -> (${v.x},${v.y})`);
      }
    }
  }
});

test('géométrie : dimensions visuelles', async () => {
  const g90 = pageGeometry(await fakePage(400, 600, 90));
  assert.equal(g90.w, 600); assert.equal(g90.h, 400);
  const g0 = pageGeometry(await fakePage(400, 600, 0));
  assert.deepEqual([g0.w, g0.h], [400, 600]);
  // coin haut-gauche visuel d'une page non tournée = (0, hauteur) en espace utilisateur
  assert.deepEqual(g0.map(0, 0), { x: 0, y: 600 });
});

test('géométrie : rect() renvoie un rectangle positif', async () => {
  const g = pageGeometry(await fakePage(400, 600, 270));
  const r = g.rect(10, 20, 100, 50);
  assert.ok(r.width > 0 && r.height > 0);
  assert.equal(Math.round(r.width * r.height), 5000);
});

test('gridPosition', () => {
  assert.deepEqual(gridPosition('top-left', 600, 800, 100, 20, 24), { x: 24, y: 24 });
  assert.deepEqual(gridPosition('bottom-right', 600, 800, 100, 20, 24), { x: 476, y: 756 });
  assert.deepEqual(gridPosition('middle-center', 600, 800, 100, 20, 24), { x: 250, y: 390 });
});

test('wrapText : aucune ligne ne dépasse la largeur, le texte est conservé', () => {
  const font = { widthOfTextAtSize: (s, size) => s.length * size * 0.5 };
  const text = 'Un texte assez long pour être coupé en plusieurs lignes\nEt une seconde ligne extraordinairement_longue_sans_espace';
  const lines = wrapText(font, text, 10, 100);
  for (const l of lines) assert.ok(font.widthOfTextAtSize(l, 10) <= 100 + 1e-9, `trop large : « ${l} »`);
  assert.equal(lines.join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
  assert.deepEqual(wrapText(font, 'a\n\nb', 10, 0), ['a', '', 'b']);
  const long = wrapText(font, 'hello https://example.com/a/very/long/url/that/exceeds', 10, 60);
  for (const l of long) assert.ok(font.widthOfTextAtSize(l, 10) <= 60 + 1e-9, `mot long non coupé : « ${l} »`);
});

test('wordDiff', () => {
  const d = wordDiff('le chat dort ici'.split(' '), 'le chien dort ici ce soir'.split(' '));
  assert.deepEqual(d.filter((x) => x[0] !== '='), [['-', 'chat'], ['+', 'chien'], ['+', 'ce'], ['+', 'soir']]);
  assert.deepEqual(wordDiff([], []), []);
});

test('caviardage automatique : motifs', () => {
  const find = (k, s) => { KINDS[k].re.lastIndex = 0; return [...s.matchAll(KINDS[k].re)].map((m) => m[0]).filter((x) => !KINDS[k].validate || KINDS[k].validate(x)); };
  assert.deepEqual(find('email', 'écrire à jean.dupont@example.com ou a@b.fr.'), ['jean.dupont@example.com', 'a@b.fr']);
  assert.deepEqual(find('iban', 'IBAN FR76 3000 6000 0112 3456 7890 189 merci'), ['FR76 3000 6000 0112 3456 7890 189']);
  assert.deepEqual(find('card', 'carte 4111 1111 1111 1111 valide, 4111 1111 1111 1112 non'), ['4111 1111 1111 1111']);
  assert.ok(find('phone', 'Tél : 06 12 34 56 78').length === 1);
  assert.ok(find('phone', 'Tél : +33 6 12 34 56 78').length === 1);
  assert.deepEqual(find('url', 'voir https://example.org/a?b=1 et www.test.fr'), ['https://example.org/a?b=1', 'www.test.fr']);
});

test('rotation d’annotations avec la page (rigide + zones)', () => {
  // page 600×800 tournée de 90° horaire : le coin haut-gauche (0,0) va en haut-droit (800,0)
  const rect = { type: 'whiteout', x: 0, y: 0, w: 100, h: 50 };
  rotateAnnot(rect, 600, 800, 90);
  assert.deepEqual([Math.round(rect.x), Math.round(rect.y), Math.round(rect.w), Math.round(rect.h)], [750, 0, 50, 100]);
  const line = { type: 'line', x1: 0, y1: 0, x2: 600, y2: 0 };
  rotateAnnot(line, 600, 800, 90);
  assert.deepEqual([line.x1, line.y1, line.x2, line.y2], [800, 0, 800, 600]);
  const txt = { type: 'text', x: 100, y: 100, w: 200, h: 40, rot: 0 };
  rotateAnnot(txt, 600, 800, 90);
  assert.equal(txt.rot, 90);
  // quatre rotations de 90° = identité
  const a = { type: 'rect', x: 33, y: 44, w: 70, h: 20, rot: 10 };
  const orig = { ...a };
  let W = 600, H = 800;
  for (let i = 0; i < 4; i++) { rotateAnnot(a, W, H, 90); [W, H] = [H, W]; }
  for (const k of ['x', 'y', 'w', 'h']) assert.ok(Math.abs(a[k] - orig[k]) < 1e-6, k);
  assert.ok(Math.abs(((a.rot - orig.rot + 360) % 360)) < 1e-6);
});

test('statistiques : lecture des compteurs', async () => {
  globalThis.navigator ??= { doNotTrack: null };
  const { parseCount } = await import('../src/lib/stats.js');
  assert.equal(parseCount('1 234'), 1234);
  assert.equal(parseCount('12'), 12);
  assert.equal(parseCount(undefined), 0);
});
