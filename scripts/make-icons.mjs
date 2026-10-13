// Génère les icônes PNG de l'application à partir de public/favicon.svg (via Chromium).
import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('public/icons', { recursive: true });
const svg = readFileSync('public/favicon.svg', 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage();
async function shot(size, file, pad = 0) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;background:${pad ? '#6d4aff' : 'transparent'}"><div style="width:${size}px;height:${size}px;display:grid;place-items:center"><div style="width:${size - pad * 2}px;height:${size - pad * 2}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></div></body>`);
  writeFileSync(`public/icons/${file}`, await page.screenshot({ omitBackground: !pad }));
}
await shot(192, 'icon-192.png');
await shot(512, 'icon-512.png');
await shot(512, 'icon-maskable-512.png', 64);
await shot(180, 'apple-touch-icon.png');
await browser.close();
console.log('Icônes générées.');
