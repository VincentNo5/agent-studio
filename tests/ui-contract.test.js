import { test, expect } from 'bun:test';

test('desktop controller exposes demo, phase, market and mobile drawer contracts', async () => {
  const [studio, css] = await Promise.all([
    Bun.file(new URL('../public/studio.js', import.meta.url)).text(),
    Bun.file(new URL('../public/studio.css', import.meta.url)).text(),
  ]);
  expect(studio).toContain('DEMO MODE · SIMULATED DATA');
  expect(studio).toContain('id="phase-select"');
  expect(studio).toContain('id="drawer-handle"');
  expect(studio).toContain('aria-controls="agent-detail live-work"');
  expect(studio).toContain("panel.toggleAttribute('inert'");
  expect(studio).toContain("drawerHandle.focus()");
  expect(studio).toContain("getJSON('/market')");
  expect(studio).toContain('if (demoMode)');
  expect(studio).toContain('3D assets are missing. Run `bun install` in the repository root, then reload.');
  expect(css).toContain('@media(max-width:820px)');
  expect(css).toContain('.right-column[data-open=true]');
});

test('standalone mobile view supports simulated data without worker reads', async () => {
  const mobile = await Bun.file(new URL('../mobile.html', import.meta.url)).text();
  expect(mobile).toContain('DEMO MODE · SIMULATED DATA');
  expect(mobile).toContain("import('/assets/demo-state.js')");
  expect(mobile).toContain('Demo mode');
});
