// Conversions PDF → images / texte / Word, via pdf.js.
import JSZip from 'jszip';
import { openPdf, renderPageToCanvas } from './pdfjs.js';
import { canvasToBlob, baseName } from './utils.js';

export async function pdfToImages(bytes, { format = 'png', scale = 2, indices, onProgress, password } = {}) {
  const pdf = await openPdf(bytes, password);
  const idx = indices ?? Array.from({ length: pdf.numPages }, (_, i) => i);
  const type = format === 'jpg' || format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
  const out = [];
  let k = 0;
  for (const i of idx) {
    const page = await pdf.getPage(i + 1);
    const c = await renderPageToCanvas(page, scale);
    const blob = await canvasToBlob(c, type, 0.92);
    out.push({ index: i, blob, width: c.width, height: c.height });
    c.width = c.height = 0;
    page.cleanup();
    onProgress?.(++k / idx.length);
  }
  pdf.destroy();
  return out;
}

export async function imagesToZip(images, name, ext) {
  const zip = new JSZip();
  const pad = String(images.length).length;
  images.forEach((im) => zip.file(`${baseName(name)}-page-${String(im.index + 1).padStart(pad, '0')}.${ext}`, im.blob));
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

/** Extrait les lignes de texte d'une page (regroupées par ordonnée). */
export function groupLines(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str && !it.hasEOL) continue;
    const y = it.transform[5];
    let row = rows.find((r) => Math.abs(r.y - y) < Math.max(2, (it.height || 8) * 0.4));
    if (!row) { row = { y, items: [], size: it.height || 10 }; rows.push(row); }
    row.items.push(it);
    row.size = Math.max(row.size, it.height || 0);
  }
  rows.sort((a, b) => b.y - a.y);
  for (const r of rows) r.items.sort((a, b) => a.transform[4] - b.transform[4]);
  return rows.map((r) => {
    let text = '';
    let last = null;
    for (const it of r.items) {
      if (last) {
        const gap = it.transform[4] - (last.transform[4] + (last.width || 0));
        if (gap > (it.height || 8) * 0.25 && !text.endsWith(' ') && !it.str.startsWith(' ')) text += ' ';
      }
      text += it.str;
      last = it;
    }
    return { y: r.y, size: r.size, text: text.replace(/\s+$/g, '') };
  });
}

export async function pdfToPages(bytes, password) {
  const pdf = await openPdf(bytes, password);
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    pages.push(groupLines(tc.items));
    page.cleanup();
  }
  pdf.destroy();
  return pages;
}

export async function pdfToText(bytes, password) {
  const pages = await pdfToPages(bytes, password);
  return pages.map((lines, i) => `${lines.map((l) => l.text).join('\n')}`).join('\n\n\f\n');
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** PDF → DOCX (texte et titres détectés par la taille de police ; la mise en page n'est pas conservée). */
export async function pdfToDocx(bytes, password) {
  const pages = await pdfToPages(bytes, password);
  const sizes = pages.flat().map((l) => l.size).filter(Boolean).sort((a, b) => a - b);
  const body = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 10;
  let xml = '';
  pages.forEach((lines, pi) => {
    // regroupe en paragraphes : une interligne plus grande que 1.6× la taille coupe le paragraphe
    let para = [];
    let prev = null;
    const flush = () => {
      if (!para.length) return;
      const size = Math.max(...para.map((l) => l.size));
      const heading = size > body * 1.35;
      const half = Math.round((heading ? Math.min(size, body * 2.2) : body) * 2);
      const text = para.map((l) => l.text).join(' ').trim();
      if (text) xml += `<w:p>${heading ? '<w:pPr><w:keepNext/></w:pPr>' : ''}<w:r><w:rPr>${heading ? '<w:b/>' : ''}<w:sz w:val="${half}"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
      para = [];
    };
    for (const l of lines) {
      if (!l.text.trim()) { flush(); prev = null; continue; }
      if (prev && (prev.y - l.y > Math.max(prev.size, l.size) * 1.7 || Math.abs(prev.size - l.size) > 1.5)) flush();
      para.push(l);
      prev = l;
    }
    flush();
    if (pi < pages.length - 1) xml += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  });
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${xml}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

/* ---------- PDF → tableaux (Excel / CSV) ---------- */

/** Détecte les colonnes d'une page par regroupement des abscisses de début des éléments de texte. */
export async function pdfToTables(bytes, password) {
  const pdf = await openPdf(bytes, password);
  const sheets = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items.filter((it) => it.str.trim()).map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height || 10 }));
    // lignes (même ordonnée)
    const lines = [];
    for (const it of items.sort((a, b) => b.y - a.y || a.x - b.x)) {
      const l = lines.find((q) => Math.abs(q.y - it.y) < Math.max(2, it.h * 0.4));
      if (l) l.items.push(it); else lines.push({ y: it.y, items: [it] });
    }
    lines.forEach((l) => l.items.sort((a, b) => a.x - b.x));
    // fusionne les fragments contigus d'une même cellule (écart faible)
    const cells = lines.map((l) => {
      const out = [];
      for (const it of l.items) {
        const last = out[out.length - 1];
        if (last && it.x - (last.x + last.w) < Math.max(it.h * 0.9, 4)) { last.str += (it.x - (last.x + last.w) > it.h * 0.15 ? ' ' : '') + it.str; last.w = it.x + it.w - last.x; }
        else out.push({ ...it });
      }
      return out;
    });
    // ancres de colonnes : abscisses de début les plus fréquentes
    const starts = cells.flat().map((c) => c.x).sort((a, b) => a - b);
    const anchors = [];
    for (const x of starts) {
      const a = anchors[anchors.length - 1];
      if (a && x - a.last < 6) { a.xs.push(x); a.last = x; } else anchors.push({ xs: [x], last: x });
    }
    const cols = anchors.filter((a) => a.xs.length >= Math.max(2, Math.min(4, cells.length * 0.15))).map((a) => a.xs.reduce((s, v) => s + v, 0) / a.xs.length);
    if (!cols.length) cols.push(0);
    const rows = cells.map((row) => {
      const r = new Array(cols.length).fill('');
      for (const c of row) {
        let k = 0;
        for (let i = 0; i < cols.length; i++) if (c.x >= cols[i] - 6) k = i;
        r[k] = r[k] ? `${r[k]} ${c.str}` : c.str;
      }
      return r;
    }).filter((r) => r.some(Boolean));
    sheets.push(rows);
    page.cleanup();
  }
  pdf.destroy();
  return sheets;
}

export function tablesToCsv(sheets) {
  const q = (s) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return '﻿' + sheets.map((rows) => rows.map((r) => r.map(q).join(';')).join('\r\n')).join('\r\n\r\n');
}

const colName = (i) => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

/** Classeur .xlsx minimal (une feuille par page), nombres reconnus. */
export async function tablesToXlsx(sheets) {
  const zip = new JSZip();
  const num = (s) => { const n = s.replace(/\s/g, '').replace(',', '.').replace(/[€$%]$/, ''); return /^-?\d+(\.\d+)?$/.test(n) && n.length < 16 ? n : null; };
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((_, i) => `<sheet name="Page ${i + 1}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`);
  sheets.forEach((rows, i) => {
    const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => { if (!c) return ''; const ref = `${colName(ci)}${ri + 1}`; const n = num(c); return n !== null ? `<c r="${ref}"><v>${n}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(c)}</t></is></c>`; }).join('')}</row>`).join('');
    zip.file(`xl/worksheets/sheet${i + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`);
  });
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
