// Utilitaire de débogage : ouvre l'app dans Chromium, exécute un scénario, prend des captures.
import { chromium } from 'playwright-core';
const SCR = process.env.SCR || '/tmp/claude-0/-home-user-FragPDF/c00dd6e3-4e0d-5d6b-992d-80b8c6fbbcde/scratchpad';
export async function launch(opts = {}) {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: +(process.env.VH || 900) }, acceptDownloads: true, locale: 'fr-FR', ...opts });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
  return { browser, ctx, page, logs, SCR };
}
