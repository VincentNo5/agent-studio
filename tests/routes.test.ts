import { beforeAll, test, expect } from 'bun:test';
let handler: (request: Request, server: unknown) => Promise<Response>;
const local = { requestIP: () => ({ address: '127.0.0.1' }) };
beforeAll(async () => {
  // Capture the real server handler without opening a listening socket.
  const serve = Bun.serve;
  try {
    Bun.serve = ((options: any) => { handler = options.fetch; return {}; }) as typeof Bun.serve;
    await import('../server.ts');
  } finally { Bun.serve = serve; }
});
const request = (path: string) => handler(new Request(`http://127.0.0.1:8788${path}`), local);
test('desktop entry points and every recursively imported module resolve locally', async () => {
  for (const path of ['/', '/floor', '/mobile', '/anatomy', '/roster.json', '/assets/studio.css', '/assets/anatomy.css']) {
    const res = await request(path); expect(res.status).toBe(200); expect((await res.text()).length).toBeGreaterThan(0);
  }
  const visited = new Set<string>();
  const queue = ['/assets/studio.js', '/assets/hq3d.js', '/assets/anatomy.js'];
  while (queue.length) {
    const path = queue.pop()!; if (visited.has(path)) continue; visited.add(path);
    const res = await request(path); expect(res.status).toBe(200); expect(res.headers.get('content-type')).toContain('javascript');
    const source = await res.text();
    // All modules used here have literal import specifiers.
    const imports = [...source.matchAll(/(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g)].map(match => match[1]);
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
});
