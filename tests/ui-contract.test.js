import { test, expect } from 'bun:test';
import { workLines } from '../public/studio-data.js';
import { visitorTag } from '../public/hq3d.js';

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
  expect(studio).toContain('id="tool-list"');
  expect(studio).toContain('renderTools();');
  expect(studio).toContain('Detail ↗');
  expect(studio).toContain("currentPanel === 'tools'");
  expect(studio).toContain("from './tool-icons.js'");
  expect(studio).toContain('Tools working');
  expect(studio).toContain('function withToolWorkers');
  expect(studio).toContain("startsWith('omp-child:')");
  expect(studio).toContain('__studio');
  expect(css).toContain('.tool-row[data-state=working]');
  expect(studio).toContain('working-now');
  expect(studio).toContain('data-work-id');
  expect(studio).toContain('workLines(');
  expect(studio).toContain('omp-child-detail');
  expect(css).toContain('.working-now');
  expect(css).toContain('.work-card');
  expect(css).toContain('.work-meta');
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

test('a work card renders provider, model and the reported remaining task list', () => {
  const w = { dispatchId: 'd', taskTitle: 'Ship', agent: 'codex', provider: 'openai', model: 'gpt-6', remainingTasks: ['QA pass', 'Docs'] };
  expect(workLines(w, true)).toMatchObject({ who: 'codex · openai · gpt-6', left: 'remaining: 2 · next: QA pass', count: '2' });
});

test('visitor tags always name their state and who they are', () => {
  expect(visitorTag({ dispatchId: 'omp-child:s:c', agent: 'coder', toolName: 'omp' }, 'WORKING')).toBe('WORKING · coder · omp');
  expect(visitorTag({ dispatchId: 'tool:codex:7', toolName: 'Codex' }, undefined)).toBe('IDLE · Codex session');
  expect(visitorTag({ dispatchId: 'omp-child:s:c', agent: 'coder', toolName: 'omp', stale: true }, 'WORKING')).toBe('STALE · coder · omp');
  expect(visitorTag({ dispatchId: 'd-1', agent: 'claude' }, 'DONE')).toBe('DONE · claude');
});
