// Utilitaire de débogage : ouvre l'app dans Chromium, exécute un scénario, prend des captures.
import { chromium } from 'playwright-core';
import { tmpdir } from 'node:os';
const SCR = process.env.SCR || tmpdir();
export const CHROME_PATH = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
export async function launch(opts = {}) {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: +(process.env.VH || 900) }, acceptDownloads: true, locale: 'fr-FR', ...opts });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
  return { browser, ctx, page, logs, SCR };
}
