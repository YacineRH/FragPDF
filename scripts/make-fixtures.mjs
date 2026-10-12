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
