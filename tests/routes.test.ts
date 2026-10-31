import { beforeAll, test, expect } from 'bun:test';
let handler: (request: Request, server: unknown) => Promise<Response>;
let createMarketService: typeof import('../server.ts').createMarketService;
const local = { requestIP: () => ({ address: '127.0.0.1' }) };
beforeAll(async () => {
  // Capture the real server handler without opening a listening socket.
  const serve = Bun.serve;
  try {
    Bun.serve = ((options: any) => { handler = options.fetch; return {}; }) as typeof Bun.serve;
    const serverModule = await import('../server.ts');
    createMarketService = serverModule.createMarketService;
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
