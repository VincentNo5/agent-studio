import { beforeAll, test, expect, spyOn } from 'bun:test';
let handler: (request: Request, server: unknown) => Promise<Response>;
let createMarketService: typeof import('../server.ts').createMarketService;
let readDispatchAgent: typeof import('../server.ts').readDispatchAgent;
const local = { requestIP: () => ({ address: '127.0.0.1' }) };
beforeAll(async () => {
  // Capture the real server handler without opening a listening socket.
  const serve = Bun.serve;
  try {
    Bun.serve = ((options: any) => { handler = options.fetch; return {}; }) as typeof Bun.serve;
    const serverModule = await import('../server.ts');
    createMarketService = serverModule.createMarketService;
    readDispatchAgent = serverModule.readDispatchAgent;
  } finally { Bun.serve = serve; }
});
const request = (path: string) => handler(new Request(`http://127.0.0.1:8788${path}`), local);
test('desktop entry points and every recursively imported module resolve locally', async () => {
  for (const path of ['/', '/floor', '/mobile', '/anatomy', '/roster.json', '/assets/studio.css', '/assets/anatomy.css', '/assets/studio-kit.glb', '/assets/game-kit.glb']) {
    const res = await request(path); expect(res.status).toBe(200); expect((await res.text()).length).toBeGreaterThan(0);
  }
  const visited = new Set<string>();
  const queue = ['/assets/studio.js', '/assets/hq3d.js', '/assets/anatomy.js'];
  while (queue.length) {
    const path = queue.pop()!; if (visited.has(path)) continue; visited.add(path);
    const res = await request(path); expect(res.status).toBe(200); expect(res.headers.get('content-type')).toContain('javascript');
    const source = (await res.text()).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // All modules used here have literal import specifiers.
    const imports = [...source.matchAll(/^\s*(?:import|export)[^;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]/gm)].map(match => match[1] ?? match[2]);
    for (const specifier of imports) {
      if (specifier === 'three') queue.push('/vendor/three/build/three.module.js');
      else if (specifier.startsWith('three/addons/')) queue.push(specifier.replace('three/addons/', '/vendor/three/examples/jsm/'));
      else if (specifier.startsWith('.')) queue.push(new URL(specifier, `http://localhost${path}`).pathname);
      else throw new Error(`Nonlocal dependency: ${specifier}`);
    }
  }
  expect(visited.size).toBeGreaterThan(15);
});
test('asset traversal, malformed paths, missing files and off-network callers are rejected', async () => {
  for (const path of ['/assets/%2e%2e%2fserver.ts', '/vendor/three/%2e%2e%2f%2e%2e%2fserver.ts', '/assets/%5c..%5cserver.ts', '/assets/%00secret']) expect((await request(path)).status).toBe(403);
  expect((await request('/assets/%zz')).status).toBe(400);
  expect((await request('/assets/missing-file.js')).status).toBe(404);
  expect((await handler(new Request('http://localhost/'), { requestIP: () => ({ address: '192.0.2.1' }) })).status).toBe(403);
  expect((await handler(new Request('http://attacker.example/'), local)).status).toBe(403);
});

test('read-only routes reject methods and oversized request bodies before dispatch', async () => {
  expect((await handler(new Request('http://127.0.0.1:8788/market', { method: 'POST', body: 'x' }), local)).status).toBe(405);
  expect((await handler(new Request('http://127.0.0.1:8788/market', { method: 'POST', headers: { 'content-length': '70000' } }), local)).status).toBe(413);
});

test('activity route answers the normalized tool rows', async () => {
  const res = await request('/activity');
  expect(res.status).toBe(200);
  const body = await res.json() as { ts: number; tools: { id: string; name: string; state: string; installed: boolean; agents: unknown[] }[] };
  expect(Number.isFinite(body.ts)).toBe(true);
  expect(body.tools.length).toBeGreaterThan(5);
  for (const tool of body.tools) {
    expect(typeof tool.id).toBe('string');
    expect(typeof tool.name).toBe('string');
    expect(['working', 'idle', 'available', 'offline']).toContain(tool.state);
    expect(typeof tool.installed).toBe('boolean');
    expect(Array.isArray(tool.agents)).toBe(true);
    expect(Array.isArray(tool.sessions)).toBe(true);
    expect(typeof tool.processes).toBe('number');
    expect(Array.isArray(tool.pids)).toBe(true);
  }
});

test.each(['', 'not json', '{"ok":false,"error":"temporarily unavailable"}', '{"ok":true,"result":{}}'])(
  'state retries failed worker-show metadata (%s) on the next collect and caches success', async failure => {
    const id = `retry-${failure}`;
    let lookups = 0;
    let now = Date.now() + 60_000;
    const time = spyOn(Date, 'now').mockImplementation(() => now);
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({}));
    const spawn = spyOn(Bun, 'spawn').mockImplementation(((args: string[]) => {
      let output = '';
      if (args.includes('worker-list')) output = JSON.stringify({ ok: true, result: { workers: [{ dispatchId: id, state: 'running', liveness: 'live' }] } });
      if (args.includes('worker-show')) {
        expect(args).toEqual(['orca', 'orchestration', 'worker-show', '--dispatch', id, '--json', '--full']);
        output = ++lookups === 1 ? failure : JSON.stringify({ ok: true, result: { worker: { startOptions: { launch: { effective: { agent: 'codex', model: 'alpha' } } } } } });
      }
      return { stdout: new Response(output).body, exited: Promise.resolve(0), kill() {} };
    }) as typeof Bun.spawn);
    try {
      const first = await (await request('/state')).json();
      expect(first.workers.find((worker: any) => worker.dispatchId === id)).toMatchObject({ agent: null, model: null });
      expect(lookups).toBe(1);
      now += 60_000;
      const second = await (await request('/state')).json();
      expect(second.workers.find((worker: any) => worker.dispatchId === id)).toMatchObject({ agent: 'codex', model: 'alpha' });
      expect(lookups).toBe(2);
      expect(second.tools.find((tool: any) => tool.id === 'codex').agents).toContainEqual(expect.objectContaining({ dispatchId: id, model: 'alpha' }));
      for (const key of ['runs', 'terminals', 'worktrees', 'paseo', 'quotas', 'kanban', 'orcaTasks', 'tools']) expect(Array.isArray(second[key])).toBe(true);
      now += 60_000;
      const third = await (await request('/state')).json();
      expect(third.workers.find((worker: any) => worker.dispatchId === id)).toMatchObject({ agent: 'codex', model: 'alpha' });
      expect(lookups).toBe(2);
    } finally { spawn.mockRestore(); fetchSpy.mockRestore(); time.mockRestore(); }
  },
);

// Execute the actual page adapter without starting its DOM, WebGL or polling loop.
const studioSource = await Bun.file(new URL('../public/studio.js', import.meta.url)).text();
const withToolWorkers = new Function(`${studioSource.slice(studioSource.indexOf('function withToolWorkers('), studioSource.indexOf('function renderWorkers('))}\nreturn withToolWorkers;`)();

test('the floor retains each direct session beside dispatches and session-qualified omp children', () => {
  const dispatched = { dispatchId: 'orca-1', agent: 'codex', workerState: 'running' };
  const next = { workers: [dispatched], tools: [
    { id: 'codex', name: 'Codex CLI', state: 'working', agents: [{ dispatchId: 'orca-1' }], sessions: [
      { pid: 10, cwd: '/one', model: 'alpha', command: 'codex --model alpha' },
      { pid: 20, cwd: '/two', model: 'beta', command: 'codex --model beta' },
    ] },
    { id: 'omp', name: 'omp', state: 'working', sessions: [{ pid: 30, cwd: '/three', model: null, command: 'omp' }], subagents: [
      { id: 'parent-a:child', agent: 'coder', state: 'running', task: 'First', stale: true },
      { id: 'parent-b:child', agent: 'coder', state: 'running', task: 'Second', stale: false },
    ] },
  ] };
  const result = withToolWorkers(next);
  expect(result.workers.map((worker: any) => worker.dispatchId).sort()).toEqual([
    'omp-child:parent-a:child', 'omp-child:parent-b:child', 'orca-1', 'tool:codex:10', 'tool:codex:20', 'tool:omp:30',
  ]);
  expect(result.workers.find((worker: any) => worker.dispatchId === 'tool:codex:20')).toMatchObject({ cwd: '/two', model: 'beta', processes: 1 });
  expect(result.workers.find((worker: any) => worker.dispatchId === 'omp-child:parent-a:child')).toMatchObject({ taskTitle: 'First', stale: true, workerState: 'idle', liveness: 'unknown' });
  expect(withToolWorkers(result).workers).toHaveLength(6);
  expect(next.workers).toEqual([dispatched]);
});

test('idle live sessions remain visible and an explicitly empty sessions list invents no worker', () => {
  const result = withToolWorkers({ workers: [], tools: [
    { id: 'codex', name: 'Codex CLI', state: 'idle', sessions: [{ pid: 10, cwd: '/one', model: null, command: 'codex' }] },
    { id: 'omp', name: 'omp', state: 'working', sessions: [] },
  ] });
  expect(result.workers).toHaveLength(1);
  expect(result.workers[0]).toMatchObject({ dispatchId: 'tool:codex:10', workerState: 'idle', liveness: 'unknown' });
});

test('older state payloads without sessions retain their direct tool fallback', () => {
  const result = withToolWorkers({ workers: [], tools: [{ id: 'codex', name: 'Codex CLI', state: 'working', cwd: '/one', processes: 1 }] });
  expect(result.workers).toHaveLength(1);
  expect(result.workers[0]).toMatchObject({ dispatchId: 'tool:codex', cwd: '/one' });
});

test('worker-show parsing reads the agent from either payload shape', () => {
  const full = JSON.stringify({ ok: true, result: { worker: { startOptions: { launch: { requested: { agent: 'claude', model: 'sonnet' }, effective: { agent: 'claude', model: 'opus' } } } } } });
  expect(readDispatchAgent(full)).toEqual({ agent: 'claude', model: 'opus', exitCause: null });
  const concise = JSON.stringify({ ok: true, result: { dispatchId: 'ctx_1', state: 'succeeded' } });
  expect(readDispatchAgent(concise)).toEqual({ agent: null, model: null, exitCause: null });
  expect(readDispatchAgent('not json')).toEqual({ agent: null, model: null, exitCause: null });
});

test('demo route serves the studio shell', async () => {
  const res = await request('/demo');
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/html');
  expect(await res.text()).toContain('id="world"');
});

test('market service returns the public response shape and shares its 60 second cache', async () => {
  let calls = 0;
  const fetchImpl = async (input: string | URL | Request) => {
    calls++;
    const url = String(input);
    if (url.includes('coinbase')) return Response.json({ open: '65000', last: '66300' });
    return Response.json({ data: [{ value: '71', value_classification: 'Greed' }] });
  };
  let now = 1_000;
  const service = createMarketService({ fetchImpl: fetchImpl as typeof fetch, now: () => now });
  const first = await service.get();
  const second = await service.get();
  expect(first).toEqual({
    ts: 1_000,
    btc: { usd: 66300, change24h: 2 },
    fearGreed: { value: 71, label: 'Greed' },
    offline: false,
  });
  expect(second).toBe(first);
  expect(calls).toBe(2);
  now += 60_001;
  await service.get();
  expect(calls).toBe(4);
});

test('market service never throws when both public sources are offline', async () => {
  const service = createMarketService({
    fetchImpl: (() => Promise.reject(new Error('network unavailable'))) as typeof fetch,
    now: () => 42,
  });
  await expect(service.get()).resolves.toEqual({ ts: 42, btc: null, fearGreed: null, offline: true });
});

test('market service keeps untrusted upstream fields inside the public response shape', async () => {
  const fetchImpl = async (input: string | URL | Request) => String(input).includes('coinbase')
    ? Response.json({ open: '65000', last: '66300' })
    : Response.json({ data: [{ value: '71', value_classification: { html: '<img src=x onerror=alert(1)>' } }] });
  const service = createMarketService({ fetchImpl: fetchImpl as typeof fetch, now: () => 7 });
  expect(await service.get()).toEqual({
    ts: 7,
    btc: { usd: 66300, change24h: 2 },
    fearGreed: { value: 71, label: 'Unknown' },
    offline: false,
  });
});

test('market service rejects oversized upstream JSON without losing the other source', async () => {
  const huge = JSON.stringify({ data: [{ value: '71', value_classification: 'x'.repeat(70_000) }] });
  const fetchImpl = async (input: string | URL | Request) => String(input).includes('coinbase')
    ? Response.json({ open: '65000', last: '66300' })
    : new Response(huge, { headers: { 'content-type': 'application/json', 'content-length': String(huge.length) } });
  const service = createMarketService({ fetchImpl: fetchImpl as typeof fetch, now: () => 8 });
  expect(await service.get()).toEqual({
    ts: 8,
    btc: { usd: 66300, change24h: 2 },
    fearGreed: null,
    offline: false,
  });
});
