// Génère des PDF de test (pdf-lib) dans scripts/fixtures/.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('scripts/fixtures', { recursive: true });

async function sample() {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const times = await doc.embedFont(StandardFonts.TimesRoman);
  for (let i = 1; i <= 3; i++) {
    const p = doc.addPage([595.28, 841.89]);
    p.drawRectangle({ x: 0, y: 780, width: 595.28, height: 62, color: rgb(0.18, 0.2, 0.55) });
    p.drawText(`Facture n° 2024-00${i}`, { x: 40, y: 805, size: 24, font: bold, color: rgb(1, 1, 1) });
    p.drawText('Société Exemple SARL', { x: 40, y: 740, size: 14, font: helv });
    p.drawText('12 rue des Lilas, 75011 Paris', { x: 40, y: 722, size: 11, font: helv, color: rgb(0.3, 0.3, 0.3) });
    p.drawText('Montant total : 1 250,00 €', { x: 40, y: 660, size: 16, font: times });
    p.drawText('Merci de votre confiance. Paiement à 30 jours.', { x: 40, y: 630, size: 12, font: times });
    p.drawRectangle({ x: 40, y: 400, width: 515, height: 150, borderColor: rgb(0.6, 0.6, 0.7), borderWidth: 1, color: rgb(0.96, 0.96, 1) });
    p.drawText(`Page ${i} sur 3`, { x: 260, y: 40, size: 10, font: helv });
  }
  writeFileSync('scripts/fixtures/sample.pdf', await doc.save());
}

async function form() {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([595.28, 841.89]);
  p.drawText('Formulaire de contact', { x: 40, y: 780, size: 22, font: helv });
  const f = doc.getForm();
  p.drawText('Nom', { x: 40, y: 735, size: 12, font: helv });
  const name = f.createTextField('nom'); name.addToPage(p, { x: 120, y: 725, width: 250, height: 24 });
  p.drawText('Email', { x: 40, y: 695, size: 12, font: helv });
  const mail = f.createTextField('email'); mail.addToPage(p, { x: 120, y: 685, width: 250, height: 24 });
  const cb = f.createCheckBox('newsletter'); cb.addToPage(p, { x: 120, y: 645, width: 16, height: 16 });
  p.drawText('Newsletter', { x: 145, y: 648, size: 12, font: helv });
  const dd = f.createDropdown('pays'); dd.addOptions(['France', 'Belgique', 'Suisse']); dd.addToPage(p, { x: 120, y: 600, width: 150, height: 24 });
  writeFileSync('scripts/fixtures/form.pdf', await doc.save());
}

async function rotated() {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([400, 600]);
  p.drawText('Page tournée 90°', { x: 40, y: 540, size: 22, font: helv });
  p.drawRectangle({ x: 40, y: 100, width: 120, height: 80, color: rgb(1, 0.8, 0.2) });
  p.setRotation({ type: 'degrees', angle: 90 });
  writeFileSync('scripts/fixtures/rotated.pdf', await doc.save());
}

await sample(); await form(); await rotated();
console.log('Fixtures générées.');

// PDF « lourd » : images JPEG/PNG bruitées + pages blanches pour tester compression, extraction et détection.
async function heavy() {
  const { deflateSync } = await import('node:zlib');
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  // image PNG 900×600 bruitée (non compressible = gros)
  const W = 900, H = 600;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const o = y * (W * 3 + 1) + 1 + x * 3;
      raw[o] = (x * 255 / W + Math.random() * 60) & 255; raw[o + 1] = (y * 255 / H + Math.random() * 60) & 255; raw[o + 2] = (128 + Math.random() * 90) & 255;
    }
  }
  const crc = (buf) => { let c, crcT = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; } let r = 0xffffffff; for (const b of buf) r = crcT[(r ^ b) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  writeFileSync('scripts/fixtures/noise.png', png);
  const img = await doc.embedPng(png);
  for (let i = 0; i < 2; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`Page avec image ${i + 1}`, { x: 40, y: 800, size: 18, font: helv });
    p.drawImage(img, { x: 40, y: 300, width: 515, height: 343 });
  }
  doc.addPage([595, 842]); // page blanche
  const p4 = doc.addPage([595, 842]);
  p4.drawText('Dernière page', { x: 40, y: 800, size: 18, font: helv });
  writeFileSync('scripts/fixtures/heavy.pdf', await doc.save());
}
await heavy();
