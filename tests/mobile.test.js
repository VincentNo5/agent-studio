import { test, expect } from 'bun:test';
import { isPresent, workerStatus } from '../public/studio-data.js';

// Run the page's real renderer with DOM output sinks; polling and timers stay offline.
const html = await Bun.file(new URL('../mobile.html', import.meta.url)).text();
const script = html.match(/<script(?: type="module")?>([\s\S]*?)<\/script>/)[1]
  .replace(/^\s*import .*? from ['"].*?['"];?\s*$/gm, '');
function renderWorker(worker) {
  const elements = new Map();
  const document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, { textContent: '', innerHTML: '', addEventListener() {} });
    return elements.get(id);
  } };
  const renderAgents = new Function('document', 'location', 'performance', 'fetch', 'setInterval', 'isPresent', 'workerStatus',
    `${script}\nreturn renderAgents;`)(document, { search: '' }, { now: () => 0 }, () => new Promise(() => {}), () => 0, isPresent, workerStatus);
  renderAgents({ workers: [{ dispatchId: 'ctx_1', taskTitle: 'qa-tester', ...worker }] });
  return {
    present: Number(elements.get('present-count').textContent),
    working: Number(elements.get('working-count').textContent),
    pending: Number(elements.get('pending-count').textContent),
    agents: elements.get('agents').innerHTML,
  };
}

test.each([
  ['running without liveness', { workerState: 'running' }, 1, 1, 0, 'working'],
  ['pending dispatch with liveness', { dispatchStatus: 'pending', liveness: 'live' }, 1, 0, 1, 'pending'],
  ['pending worker', { workerState: 'pending' }, 1, 0, 1, 'pending'],
  ['queued worker with liveness', { workerState: 'queued', liveness: 'live' }, 1, 0, 1, 'pending'],
  ['failed worker with pending dispatch', { workerState: 'failed', dispatchStatus: 'pending' }, 1, 0, 0, 'failed'],
  ['dispatched without worker state', { dispatchStatus: 'dispatched' }, 0, 0, 0, null],
])('mobile counts and row status: %s', (_, worker, present, working, pending, status) => {
  const rendered = renderWorker(worker);
  expect({ present: rendered.present, working: rendered.working, pending: rendered.pending }).toEqual({ present, working, pending });
  if (status) expect(rendered.agents).toContain(`class="dot ${status}"`);
  else expect(rendered.agents).toContain('NO ACTIVE AGENTS');
});
