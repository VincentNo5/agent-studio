#!/usr/bin/env node
/**
 * Regression audit for HUD overlap, collapsed headings and status-list space.
 * Run with the existing server: node tests/layout.audit.mjs
 * Uses real homepage markup/CSS, a fixed clock and browser-only fixture responses;
 * never reads live telemetry or starts/stops the server.
 * --base-css restores the pre-fix CSS geometry AND Operations' original parent.
 * It must report Operations × navigator at 1280×720 and exit 1 (2 if missing).
 * Requires Playwright Chromium; launch failures are errors, never skipped passes.
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { createDemoFeed, DEMO_START } from '../public/demo-state.js';

const base = process.env.AGENT_STUDIO_URL || 'http://127.0.0.1:8787';
const baseCSS = process.argv.includes('--base-css')
  ? await readFile(new URL('./fixtures/layout.base.css', import.meta.url), 'utf8') : null;
let baseOverlapReported = false;
const roster = JSON.parse(await readFile(new URL('../roster.json', import.meta.url), 'utf8'));
const now = DEMO_START + 41_000;
const state = createDemoFeed(roster).tick(now);
const viewports = [
  { width: 1280, height: 720 },
  { width: 1365, height: 768 },
  { width: 1440, height: 900 },
];

// Match scripts/visual-review.mjs so the real 3D page can initialize on each OS.
const angle = { darwin: 'metal', win32: 'd3d11' }[process.platform];
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', ...(angle ? [`--use-angle=${angle}`] : []), '--enable-gpu', '--ignore-gpu-blocklist'],
}).catch(error => {
  console.error(`AUDIT UNAVAILABLE: Chromium could not launch. ${error.message}`);
  // Distinguish infrastructure failure from the fixture's verified red exit 1.
  process.exit(2);
});

try {
  for (const viewport of viewports) {
    const name = `${viewport.width}×${viewport.height}`;
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC' });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.clock.setFixedTime(now);
      await page.route('**/state', route => route.fulfill({ json: state }));
      await page.route('**/roster.json', route => route.fulfill({ json: roster }));
      await page.route('**/market', route => route.fulfill({ json: { ts: now, btc: null, fearGreed: null, offline: true } }));
      await page.goto(base + '/', { waitUntil: 'networkidle', timeout: 30_000 });
      await page.waitForFunction(() => document.querySelector('#connection-label')?.textContent === 'State connected'
        && document.querySelector('#status-groups .status-row')
        && document.querySelector('#lanes .lane')
        && document.querySelector('#tool-list .tool-row'), null, { timeout: 15_000 });
      await page.evaluate(() => document.fonts.ready);
      if (baseCSS !== null) {
        await page.addStyleTag({ content: baseCSS });
        await page.evaluate(() => document.querySelector('.left-column').append(document.querySelector('.operations')));
      }

      const result = await page.evaluate(() => {
        const label = el => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}${el.id ? '#' + el.id : ''}`;
        // Compare painted portions only: scrolled-off panels cannot overlap a rail.
        function visibleRect(el) {
          if (!el || !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return null;
          const rect = el.getBoundingClientRect();
          let { left, top, right, bottom } = rect;
          left = Math.max(left, 0); top = Math.max(top, 0);
          right = Math.min(right, innerWidth); bottom = Math.min(bottom, innerHeight);
          for (let parent = el.parentElement; parent; parent = parent.parentElement) {
            // The viewport is the root clip; BODY can have zero height with absolute children.
            if (parent === document.body || parent === document.documentElement) continue;
            const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
            if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
              left = Math.max(left, bounds.left + parent.clientLeft);
              right = Math.min(right, bounds.left + parent.clientLeft + parent.clientWidth);
            }
            if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
              top = Math.max(top, bounds.top + parent.clientTop);
              bottom = Math.min(bottom, bounds.top + parent.clientTop + parent.clientHeight);
            }
          }
          return right > left && bottom > top ? { left, top, right, bottom, width: right - left, height: bottom - top } : null;
        }
        // Keep operations covered even if it moves outside the left column.
        const nodes = [...document.querySelectorAll('.left-column > *, .right-column > *, .events, .navigator, .preferences, .operations')];
        const panels = nodes.map(el => ({ name: label(el), rect: visibleRect(el) })).filter(panel => panel.rect);
        const overlaps = [];
        for (let i = 0; i < panels.length; i++) {
          for (let j = i + 1; j < panels.length; j++) {
            const a = panels[i], b = panels[j];
            const width = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
            const height = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
            // A 2px tolerance in each dimension, not a square-pixel area threshold.
            if (width > 2 && height > 2) overlaps.push({ a: a.name, b: b.name, width, height });
          }
        }
        const headings = [...document.querySelectorAll('.panel-head h2')];
        const collapsedHeadings = headings.filter(el => !visibleRect(el)).map(el => el.textContent.trim());
        const required = ['.agent-status', '.task-board', '.tool-activity', '.operations', '.detail', '.live-work', '.events', '.navigator', '.preferences']
          .map(selector => ({ selector, height: visibleRect(document.querySelector(selector))?.height ?? 0 }));
        const toolHead = document.querySelector('.tool-activity .panel-head');
        const toolRow = document.querySelector('#tool-list .tool-row');
        const fullyPainted = el => {
          const painted = visibleRect(el), bounds = el?.getBoundingClientRect();
          return !!painted && painted.height >= bounds.height && painted.width >= bounds.width;
        };
        return { panelCount: panels.length, headingCount: headings.length, overlaps, collapsedHeadings, required,
          statusHeight: visibleRect(document.querySelector('#status-groups'))?.height ?? 0,
          toolHeadVisible: fullyPainted(toolHead), toolRowVisible: fullyPainted(toolRow),
          toolRowHeight: visibleRect(toolRow)?.height ?? 0,
          operationsInColumn: !!document.querySelector('.left-column .operations') };
      });

      const statusFloor = 96;
      console.log(`${name}: ${result.panelCount} painted panels; ${result.headingCount} headings; #status-groups painted height=${result.statusHeight.toFixed(2)}px; first tool row=${result.toolRowHeight.toFixed(2)}px`);
      console.log(`  Painted panel heights: ${result.required.map(p => `${p.selector}=${p.height.toFixed(2)}px`).join(', ')}`);
      const failures = [
        ...result.overlaps.map(o => `${o.a} × ${o.b}: ${o.width.toFixed(2)}×${o.height.toFixed(2)}px overlap (>2px in both dimensions)`),
        ...result.collapsedHeadings.map(h => `collapsed .panel-head h2: ${h}`),
        ...result.required.filter(p => p.height < 40).map(p => `${p.selector} painted height ${p.height.toFixed(2)}px < 40px`),
        ...(result.headingCount === 0 ? ['no panel headings found'] : []),
        ...(result.statusHeight < statusFloor ? [`#status-groups painted height ${result.statusHeight.toFixed(2)}px < ${statusFloor}px`] : []),
        ...(!result.toolHeadVisible ? ['Agent tools header is not fully painted without scrolling'] : []),
        ...(!result.toolRowVisible ? ['first Agent tools row is not fully painted without scrolling'] : []),
        ...(baseCSS === null && result.operationsInColumn ? ['Operations must be outside .left-column'] : []),
        ...errors.sort().map(error => `page error: ${error}`),
      ];
      if (baseCSS !== null && viewport.width === 1280 && viewport.height === 720) {
        baseOverlapReported = result.overlaps.some(o =>
          (o.a.includes('.operations') && o.b.includes('.navigator'))
          || (o.a.includes('.navigator') && o.b.includes('.operations')));
      }
      for (const failure of failures) console.log(`  FAIL: ${failure}`);
      if (failures.length) process.exitCode = 1;
      else console.log(`  PASS: panels >=40px; status >=${statusFloor}px; no overlap >2px; tool header and first row fully painted`);
    } catch (error) {
      console.log(`${name}: FAIL: ${error.stack || error}`);
      process.exitCode = 1;
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
if (baseCSS !== null) {
  if (!baseOverlapReported) {
    console.error('FAIL: base fixture did not report Operations × navigator at 1280×720');
    process.exitCode = 2;
  } else {
    console.log('BASE DEFECT REPRODUCED: Operations × navigator at 1280×720 (intentional red run)');
    process.exitCode = 1;
  }
}
