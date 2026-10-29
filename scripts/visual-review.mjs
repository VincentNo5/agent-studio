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

const base = process.env.AGENT_STUDIO_URL || 'http://127.0.0.1:8787';
const out = new URL('../docs/review/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const errors = [];
const captures = [];
for (const [name, path, viewport] of [
  ['overview', '/', { width: 1440, height: 1000 }],
  ['floor', '/floor', { width: 1440, height: 1000 }],
  ['anatomy', '/anatomy', { width: 1440, height: 1000 }],
  ['mobile', '/mobile', { width: 390, height: 844 }],
]) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  await page.goto(base + path, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1800);
  const file = new URL(`${name}.png`, out);
  await page.screenshot({ path: file.pathname, fullPage: false });
  const size = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
  captures.push({ name, path, viewport, size });
  await page.close();
}
await browser.close();
const stamp = new Date().toISOString();
const md = `# Visual review · ${stamp}\n\n` +
  `Captured from \`${base}\`.\n\n` +
  captures.map(c => `- **${c.name}** — ${c.path} · ${c.viewport.width}×${c.viewport.height} · ${c.size.w}×${c.size.h}`).join('\n') +
  `\n\n## Review gate\n\n` +
  `1. **Silhouette** — do the Blender desks/chairs read as furniture at 1F/2F/3F, or merge into one dark mass?\n` +
  `2. **Contrast/readability** — are status halos, badges, desk strips and labels legible over the kit and glass?\n` +
  `3. **Composition** — does the kit sit in the floor plan without covering agents, signs or the Orca hub?\n\n` +
  `Fix the scene or asset, not the live state. Re-run once, then stop.\n\n` +
  `## Runtime errors\n\n${errors.length ? errors.map(e => `- ${e}`).join('\n') : 'None captured.'}\n`;
await writeFile(new URL('../docs/VISUAL-REVIEW.md', import.meta.url), md);
console.log(`Captured ${captures.length} views; ${errors.length} runtime errors.`);
if (errors.length) process.exitCode = 1;
