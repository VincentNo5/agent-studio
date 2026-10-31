#!/usr/bin/env node
/**
 * Dream-loop capture pass for Agent Studio.
 *
 * Captures the live surfaces at desktop and phone sizes, writes a compact review
 * sheet, and leaves the three decisions to a vision reviewer (human or model):
 * silhouette, contrast/readability, composition. It never mutates studio state.
 *
 * Run: bun run visual-review
 * Requires the studio on PORT (default 8787) and Playwright installed.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const base = process.env.AGENT_STUDIO_URL || 'http://127.0.0.1:8787';
const out = new URL('../docs/review/', import.meta.url);
await mkdir(out, { recursive: true });
const angle = { darwin: 'metal', win32: 'd3d11' }[process.platform];
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', ...(angle ? [`--use-angle=${angle}`] : []), '--enable-gpu', '--ignore-gpu-blocklist'],
});
const errors = [];
const captures = [];
const desktop = { width: 1440, height: 900 };
const offlineMarket = { ts: 0, btc: null, fearGreed: null, offline: true };
// `wait` is either a delay in ms or a predicate evaluated against the #world dataset.
for (const { name, path, viewport = desktop, wait = 2500, market, reduce = false } of [
  { name: 'day', path: '/demo?phase=day' },
  { name: 'day-no-signal', path: '/demo?phase=day', market: offlineMarket },
  // Demo beat 2 completes a role at ~32 s; start at 29 s and shoot while the burst is airborne.
  { name: 'confetti', path: '/demo?phase=day&t=29', wait: 'confetti' },
  { name: 'night', path: '/demo?phase=night', wait: 6000 },
  { name: 'floor', path: '/floor?demo=1&phase=day' },
  { name: 'mobile', path: '/mobile?demo=1', viewport: { width: 390, height: 844 }, reduce: true },
]) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, reducedMotion: reduce ? 'reduce' : 'no-preference' });
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  page.on('request', request => { if (request.url().includes('/worker/')) errors.push(`${name}: demo requested worker output`); });
  if (market) await page.route('**/market', route => route.fulfill({ json: market }));
  await page.goto(base + path, { waitUntil: 'networkidle', timeout: 30000 });
  if (wait === 'confetti') {
    await page.waitForFunction(() => document.querySelector('#world')?.dataset.confetti === 'active', null, { timeout: 20000 });
    await page.waitForTimeout(350);
  }
  else await page.waitForTimeout(wait);
  const file = new URL(`${name}.png`, out);
  await page.screenshot({ path: fileURLToPath(file), fullPage: false });
  const size = await page.evaluate(() => {
    const world = document.querySelector('#world')?.dataset || {};
    return {
      w: document.documentElement.scrollWidth,
      h: document.documentElement.scrollHeight,
      banner: document.body.textContent.includes('DEMO MODE · SIMULATED DATA'),
      phase: world.phase || null,
      market: world.market || null,
      quota: world.quota || null,
      offDuty: world.offDuty ?? null,
      confettiBursts: world.confettiBursts ?? null,
      drawCalls: world.drawCalls ?? null,
      connection: document.querySelector('#connection-label, #sync')?.textContent || null,
      fps: document.querySelector('#fps')?.textContent || null,
    };
  });
  captures.push({ name, path, viewport, size });
  await page.close();
}
await browser.close();
const stamp = new Date().toISOString();
const md = `# Visual review · ${stamp}\n\n` +
  `Captured from \`${base}\`.\n\n` +
  captures.map(c => `- **${c.name}** — ${c.path} · ${c.viewport.width}×${c.viewport.height} · ${c.size.w}×${c.size.h}\n  - \`${JSON.stringify(c.size)}\``).join('\n') +
  `\n\n## Review gate\n\n` +
  `1. **Silhouette** — do the seven zones, the pods and their aisles read as distinct spaces? Is every role at its desk?\n` +
  `2. **Contrast/readability** — are the meeting display, the reception quota scoreboard, the wayfinding and agent status cues legible?\n` +
  `3. **Composition** — can the full office be understood without the HUD covering its key spaces?\n\n` +
  `Fix the scene or asset, not the live state. Re-run once, then stop.\n\n` +
  `## Runtime errors\n\n${errors.length ? errors.map(e => `- ${e}`).join('\n') : 'None captured.'}\n`;
await writeFile(new URL('../docs/VISUAL-REVIEW.md', import.meta.url), md);
console.log(`Captured ${captures.length} views; ${errors.length} runtime errors.`);
if (errors.length) process.exitCode = 1;
