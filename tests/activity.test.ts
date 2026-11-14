import { describe, test, expect, spyOn } from 'bun:test';
import { collectToolActivity, readOmpSubagents } from '../activity.ts';
import { interpretTools, joinToolAgents, parseCpuTime, parseLsofCwd, parseOmpSubagents, taskSummary, parsePs, projectFromKnownPaths, projectFromSession, runsTool, newestEntry, humanAge, toolForAgent, WORKING_WINDOW_MS, type PsRow, type StoreMap, type ToolActivity, type ToolDef } from '../activity.ts';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentStatuses } from '../public/studio-data.js';

const def = (over: Partial<ToolDef> = {}): ToolDef => ({ id: 'demo', name: 'Demo', kind: 'cli', bins: ['demo'], stores: [], ...over });
const row = (pid: number, cpu: number, command: string): PsRow => ({ pid, cpu, command });
const store = (mtime: number, path = '/home/me/.demo/session.jsonl'): StoreMap => ({ 'demo/store': { path, mtime } });
const at = (msAgo: number, now: number) => now - msAgo;

describe('process parsing', () => {
  test('cpu time accepts seconds, minutes and days', () => {
    expect(parseCpuTime('00:00')).toBe(0);
    expect(parseCpuTime('01:30')).toBe(90);
    expect(parseCpuTime('02:03:04')).toBe(7384);
    expect(parseCpuTime('1-02:03:04')).toBe(86_400 + 7384);
    expect(parseCpuTime('junk')).toBe(0);
  });

  test('ps rows keep pid, cpu and the full command', () => {
    const rows = parsePs('  123 00:04:21 /usr/local/bin/demo --flag value\n  456 00:00 node /x/claude -p hi\nnoise\n');
    expect(rows).toEqual([
      { pid: 123, cpu: 261, command: '/usr/local/bin/demo --flag value' },
      { pid: 456, cpu: 0, command: 'node /x/claude -p hi' },
    ]);
  });

  test('a tool runs when any argv token is its executable', () => {
    expect(runsTool('/usr/local/bin/claude -p hi', ['claude'])).toBe(true);
    expect(runsTool('node /Users/me/.local/bin/claude-code/cli.js', ['claude'])).toBe(false);
    expect(runsTool('node /Users/me/.local/bin/claude --resume', ['claude'])).toBe(true);
    expect(runsTool('/opt/homebrew/bin/omp __omp_worker_daemon', ['omp'])).toBe(true);
    expect(runsTool('/usr/bin/vim notes.md', ['claude'])).toBe(false);
    // A prompt that names the tool is not the tool: match only the executable position.
    expect(runsTool('/usr/local/bin/claude -p "study Cursor and Codex"', ['Cursor', 'codex'])).toBe(false);
    expect(runsTool('/Applications/Cursor.app/Contents/MacOS/Cursor --type=renderer', ['Cursor'])).toBe(true);
  });
});

describe('evidence ages', () => {
  test('seconds, minutes, hours and days', () => {
    expect(humanAge(12_000)).toBe('12s');
    expect(humanAge(4 * 60_000)).toBe('4m');
    expect(humanAge(3 * 3_600_000)).toBe('3h');
    expect(humanAge(9 * 86_400_000)).toBe('9d');
  });
});

describe('state derivation', () => {
  const now = Date.parse('2026-11-11T20:00:00Z');
  const derive = (procs: PsRow[], stores: Record<string, StoreMap>, installed: boolean, prev = new Map<number, number>()) =>
    interpretTools([def()], procs, stores, { demo: installed }, prev, now)[0];

  test('nothing installed and no store reads offline', () => {
    const tool = derive([], { demo: {} }, false);
    expect(tool.state).toBe('offline');
    expect(tool.installed).toBe(false);
  });

  test('installed but quiet reads available, with the last output age', () => {
    const tool = derive([], { demo: store(at(10 * 60_000, now)) }, true);
    expect(tool.state).toBe('available');
    expect(tool.lastSession).toEndWith('session.jsonl');
    expect(tool.evidence).toBe('last output 10m ago');
  });

  test('recent store output is working even without a recognised process', () => {
    const tool = derive([], { demo: store(at(5_000, now)) }, true);
    expect(tool.state).toBe('working');
    expect(tool.evidence).toContain('5s ago');
  });

  test.each([undefined, 42])('a sole live session inherits fresh store activity with previous CPU %s', previousCpu => {
    const prev = previousCpu === undefined ? new Map<number, number>() : new Map([[10, previousCpu]]);
    const tool = derive([row(10, 42, '/bin/demo run')], { demo: store(at(5_000, now)) }, true, prev);
    expect(tool.state).toBe('working');
    expect(tool.cpuActive).toBe(false);
    expect(tool.sessions).toEqual([
      expect.objectContaining({ pid: 10, state: 'working', cpuActive: false }),
    ]);
    const expired = derive([row(10, 42, '/bin/demo run')],
      { demo: store(at(WORKING_WINDOW_MS + 1, now)) }, true, prev);
    expect(expired.sessions[0].state).toBe('idle');
  });

  test('the freshness window is the boundary, not a heuristic', () => {
    expect(derive([], { demo: store(at(WORKING_WINDOW_MS - 1, now)) }, true).state).toBe('working');
    expect(derive([], { demo: store(at(WORKING_WINDOW_MS + 1, now)) }, true).state).toBe('available');
  });

  test('a quiet process is idle, not working', () => {
    const tool = derive([row(10, 42, '/bin/demo run')], { demo: store(at(600_000, now)) }, true);
    expect(tool.state).toBe('idle');
    expect(tool.processes).toBe(1);
    expect(tool.evidence).toContain('1 process');
  });

  test('advancing cumulative CPU counts as working', () => {
    const tool = derive([row(10, 42.4, '/bin/demo run')], { demo: {} }, true, new Map([[10, 42]]));
    expect(tool.state).toBe('working');
    expect(tool.cpuActive).toBe(true);
    expect(tool.sessions[0]).toMatchObject({ pid: 10, state: 'working', cpuActive: true });
    expect(tool.evidence).toContain('pid 10');
  });

  test('a first sample cannot claim cpu activity', () => {
    expect(derive([row(10, 42.4, '/bin/demo run')], { demo: {} }, true).cpuActive).toBe(false);
  });

  test('two sessions use their own CPU deltas when fresh store output cannot be attributed', () => {
    const tool = derive([row(10, 42.4, '/bin/demo'), row(20, 10, '/bin/demo')],
      { demo: store(now) }, true, new Map([[10, 42], [20, 10]]));
    expect(tool.sessions).toEqual([
      expect.objectContaining({ pid: 20, state: 'idle', cpuActive: false }),
      expect.objectContaining({ pid: 10, state: 'working', cpuActive: true }),
    ]);
    expect(tool.sessions.filter(session => session.state === 'working').map(session => session.pid)).toEqual([10]);
  });

  test('another tool\'s process is not counted', () => {
    const tool = derive([row(11, 1, '/bin/other run')], { demo: store(at(600_000, now)) }, true);
    expect(tool.processes).toBe(0);
    expect(tool.state).toBe('available');
  });
});

describe('store walk', () => {
  test('skips churn files and finds the newest real output', () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-store-'));
    mkdirSync(join(root, 'nested'));
    const old = join(root, 'old.jsonl');
    const fresh = join(root, 'nested', 'fresh.jsonl');
    const churn = join(root, 'session.db-shm');
    for (const file of [old, fresh, churn]) writeFileSync(file, '{}');
    utimesSync(old, new Date(1_000_000), new Date(1_000_000));
    utimesSync(fresh, new Date(2_000_000), new Date(2_000_000));
    utimesSync(churn, new Date(3_000_000), new Date(3_000_000));
    const newest = newestEntry(root);
    expect(newest?.path).toBe(fresh);
  });

  test('a missing store is null, a file store is itself', () => {
    expect(newestEntry('/nonexistent/studio-store')).toBeNull();
    const file = join(mkdtempSync(join(tmpdir(), 'studio-file-')), 'one.jsonl');
    writeFileSync(file, '{}');
    expect(newestEntry(file)?.path).toBe(file);
  });
});

const base = (id: string): ToolActivity => ({
  id, name: id, kind: 'cli', installed: true, state: 'available', processes: 0,
  cpuActive: false, pids: [], cwd: null, model: null, provider: null, current: null, remaining: null, sessions: [], lastSession: null, lastActivity: null, evidence: 'installed',
});

test('collection preserves each live pid, cwd, and argv model', async () => {
  const commands = ['/bin/codex --model alpha', '/bin/codex --model beta'];
  let ps = `900001 00:01 ${commands[0]}\n900002 00:02 ${commands[1]}\n900003 00:00 /bin/other`;
  const spawn = spyOn(Bun, 'spawn').mockImplementation(((args: string[]) => {
    const output = args[0] === 'ps' ? ps : args[0] === 'lsof'
      ? `p${args[3]}\nfcwd\nn/projects/${args[3] === '900001' ? 'one' : 'two'}\n` : '';
    return { stdout: new Response(output).body, exited: Promise.resolve(0), kill() {} };
  }) as typeof Bun.spawn);
  try {
    const tool = (await collectToolActivity()).find(tool => tool.id === 'codex')!;
    expect(tool.sessions).toEqual([
      expect.objectContaining({ pid: 900002, cwd: '/projects/two', model: 'beta', provider: 'codex', command: commands[1], state: 'idle', cpuActive: false }),
      expect.objectContaining({ pid: 900001, cwd: '/projects/one', model: 'alpha', provider: 'codex', command: commands[0], state: 'idle', cpuActive: false }),
    ]);
    expect(tool.processes).toBe(2);
    expect(tool.pids).toEqual([900001, 900002]);
    expect(tool.cwd).toBe('/projects/two');
    expect(tool.model).toBe('beta');
    ps = '';
    expect((await collectToolActivity()).find(tool => tool.id === 'codex')!.sessions).toEqual([]);
  } finally { spawn.mockRestore(); }
});

test('omp helpers do not become sessions, count as activity, or supply the aggregate cwd', async () => {
  const ps = ['910001 00:01 /bin/omp',
    '910002 00:40 /bin/omp __omp_worker_daemon_broker',
    '910003 00:50 bun /bin/omp __omp_worker_js_eval_process',
    '910004 00:60 /bin/omp __omp_worker_text_predict'].join('\n');
  const lookedUp: string[] = [];
  const spawn = spyOn(Bun, 'spawn').mockImplementation(((args: string[]) => {
    if (args[0] === 'lsof') lookedUp.push(args[3]);
    const output = args[0] === 'ps' ? ps : `p${args[3]}\nfcwd\nn/${args[3] === '910001' ? 'project' : 'helper'}\n`;
    return { stdout: new Response(output).body, exited: Promise.resolve(0), kill() {} };
  }) as typeof Bun.spawn);
  try {
    const tool = (await collectToolActivity()).find(tool => tool.id === 'omp')!;
    expect(tool.pids).toEqual([910001]);
    expect(tool.processes).toBe(1);
    expect(tool.sessions).toHaveLength(1);
    expect(tool.cwd).toBe('/project');
    expect(lookedUp).toEqual(['910001']);
  } finally { spawn.mockRestore(); }
});

const asyncResult = (id: string, status = 'completed') => JSON.stringify({
  type: 'custom_message', customType: 'async-result',
  content: `<system-notice>\n<task-result id="${id}" agent="coder" status="${status}" duration="3.2s">\n<output>done</output>\n</task-result>\n</system-notice>`,
  display: true, details: { jobs: [{ jobId: id, type: 'task', status, agentId: id }] },
});

test('omp children use their own transcripts for freshness, expire without evidence, and settle via async results', async () => {
  const home = mkdtempSync(join(tmpdir(), 'studio-omp-'));
  const root = join(home, '.omp/agent/sessions/project');
  mkdirSync(root, { recursive: true });
  const now = Date.parse('2026-11-13T12:00:00Z');
  const progress = (msAgo: number) => JSON.stringify({
    timestamp: new Date(now - msAgo).toISOString(),
    message: { role: 'toolResult', toolName: 'task', details: { progress: [{ id: 'child', agent: 'coder', status: 'pending', task: 'Build it' }] } },
  });
  const writeSession = (id: string, records: string[], msAgo = 1000) => {
    const path = join(root, `file-${id}.jsonl`);
    writeFileSync(path, [JSON.stringify({ type: 'title', title: 'Example' }), JSON.stringify({ type: 'session', id, cwd: `/projects/${id}` }), ...records].join('\n'));
    utimesSync(path, new Date(now - msAgo), new Date(now - msAgo));
  };
  try {
    // The spawn must survive even after more than the former 400 KB tail of parent output.
    writeSession('parent-a', [progress(120_000), JSON.stringify({ message: { role: 'assistant', content: 'x'.repeat(410_000) } })]);
    writeSession('parent-b', [progress(1_200_000)], 1_200_000);
    const childDir = join(root, 'file-parent-b');
    mkdirSync(childDir);
    const childFile = join(childDir, 'child.jsonl');
    writeFileSync(childFile, '{}\n');
    utimesSync(childFile, new Date(now - 1000), new Date(now - 1000));
    writeSession('parent-c', [progress(120_000), asyncResult('child')]);
    writeSession('parent-d', [progress(90_000)], 70_000);
    writeSession('parent-e', [progress(1_200_000)]); // Parent output must not keep an orphan alive.
    const children = await readOmpSubagents(now, home);
    expect(children.map(child => child.id).sort()).toEqual(['parent-a:child', 'parent-b:child', 'parent-d:child']);
    expect(children.find(child => child.id === 'parent-a:child')).toMatchObject({ stale: true, task: 'Build it' });
    expect(children.find(child => child.id === 'parent-b:child')).toMatchObject({ stale: false, cwd: '/projects/parent-b' });
    expect(children.find(child => child.id === 'parent-d:child')).toMatchObject({ stale: true });
    appendFileSync(join(root, 'file-parent-b.jsonl'), '\n' + asyncResult('child'));
    expect((await readOmpSubagents(now, home)).map(child => child.id)).not.toContain('parent-b:child');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('unchanged omp sessions are not reread; size or mtime changes refresh cached parses', async () => {
  const home = mkdtempSync(join(tmpdir(), 'studio-omp-cache-'));
  const root = join(home, '.omp/agent/sessions/project');
  mkdirSync(root, { recursive: true });
  const path = join(root, 'parent.jsonl');
  const now = Date.now();
  const contents = [JSON.stringify({ type: 'session', id: 'cached', cwd: '/project' }), JSON.stringify({
    timestamp: new Date(now).toISOString(), message: { role: 'toolResult', toolName: 'task',
      details: { progress: [{ id: 'A', agent: 'coder', status: 'pending' }] } },
  })].join('\n');
  writeFileSync(path, contents);
  utimesSync(path, new Date(now), new Date(now));
  const originalFile = Bun.file;
  let reads = 0;
  let bytesRead = 0;
  const file = spyOn(Bun, 'file').mockImplementation(((...args: Parameters<typeof Bun.file>) => {
    const actual = originalFile(...args);
    if (String(args[0]) !== path) return actual;
    reads++;
    const measured = (blob: Blob) => ({ text: async () => {
      const text = await blob.text(); bytesRead += Buffer.byteLength(text); return text;
    } });
    return { ...measured(actual), slice: (start: number, end?: number) => measured(actual.slice(start, end)) };
  }) as typeof Bun.file);
  try {
    expect(await readOmpSubagents(now, home)).toHaveLength(1);
    expect(await readOmpSubagents(now + 70_000, home)).toEqual([expect.objectContaining({ stale: true })]);
    expect(reads).toBe(1);
    const initialBytes = bytesRead;
    // Changed size must invalidate even if a writer preserves mtime.
    appendFileSync(path, '\n' + asyncResult('A'));
    utimesSync(path, new Date(now), new Date(now));
    expect(await readOmpSubagents(now, home)).toEqual([]);
    expect(reads).toBe(2);
    expect(bytesRead - initialBytes).toBe(Buffer.byteLength('\n' + asyncResult('A')));
    // Same size, changed mtime must also invalidate (settlement for A -> B).
    writeFileSync(path, contents + '\n' + asyncResult('B'));
    utimesSync(path, new Date(now + 1000), new Date(now + 1000));
    expect(await readOmpSubagents(now + 1000, home)).toHaveLength(1);
    expect(reads).toBe(3);
    // A result split across writes must settle on completion, including after a cached read.
    const result = asyncResult('A');
    appendFileSync(path, '\n' + result.slice(0, 50));
    expect(await readOmpSubagents(now + 1000, home)).toHaveLength(1);
    appendFileSync(path, result.slice(50));
    expect(await readOmpSubagents(now + 1000, home)).toEqual([]);
    // A truncated transcript is a new parse, not a continuation of the prior settlement.
    writeFileSync(path, contents);
    expect(await readOmpSubagents(now + 1000, home)).toHaveLength(1);
  } finally { file.mockRestore(); rmSync(home, { recursive: true, force: true }); }
});

describe('agent to tool join', () => {
  test.each(['dispatched', 'queued'])('a %s dispatch without worker state cannot gain working tool evidence', dispatchStatus => {
    const tool = { ...base('claude-code'), state: 'working' as const, cwd: '/Users/me/proj' };
    const workers = [
      { dispatchId: 'named', agent: 'claude', dispatchStatus, taskTitle: 'qa-tester' },
      { dispatchId: 'path', agent: 'mystery', dispatchStatus, taskTitle: 'qa-tester', path: '/Users/me/proj' },
    ];
    const tools = joinToolAgents([tool], workers, ['qa-tester']);
    expect(tools[0].agents).toEqual([]);
    expect(agentStatuses({ workers, tools }, { agents: [{ name: 'qa-tester' }] }).get('qa-tester')?.status).toBe('idle');
  });

  test.each(['claude', 'mystery'])('a pending dispatch with another worker state still joins via %s', agent => {
    const tool = { ...base('claude-code'), state: 'working' as const, cwd: '/Users/me/proj' };
    const tools = joinToolAgents([tool], [{ dispatchId: 'pending', agent, workerState: 'idle', dispatchStatus: 'pending', path: '/Users/me/proj' }], []);
    expect(tools[0].agents.map(agent => agent.dispatchId)).toEqual(['pending']);
  });

  test('Orca agent names map onto the row that owns them', () => {
    expect(toolForAgent('claude')).toBe('claude-code');
    expect(toolForAgent('claude-code')).toBe('claude-code');
    expect(toolForAgent('Claude')).toBe('claude-code');
    expect(toolForAgent('opencode')).toBe('opencode');
    expect(toolForAgent('cursor')).toBe('cursor');
    expect(toolForAgent('cursor-agent')).toBe('cursor');
    expect(toolForAgent('codex')).toBe('codex');
    expect(toolForAgent(null)).toBeNull();
    expect(toolForAgent('mystery')).toBeNull();
  });

  test('a session slug recovers the project only when the path exists', () => {
    // Slugs only round-trip when no path component contains a dash (the separator is lossy).
    const root = '/tmp/studioprojfixed';
    mkdirSync(root, { recursive: true });
    expect(projectFromSession('.claude/projects/-tmp-studioprojfixed/s.jsonl', '')).toBe(root);
    expect(projectFromSession('.claude/projects/-nope-nope-nope/s.jsonl', '/')).toBeNull();
    expect(projectFromSession(null)).toBeNull();
    expect(projectFromSession('.claude/history.jsonl')).toBeNull();
  });

  test('a session slug matches a known worktree even when the path has dashes', () => {
    const paths = ['/Users/me/workspace/agent-studio', '/Users/me/workspace/kiln-template'];
    expect(projectFromKnownPaths('.claude/projects/-Users-me-workspace-agent-studio/s.jsonl', paths)).toBe(paths[0]);
    expect(projectFromKnownPaths('.pi/agent/sessions/--Users-me-workspace-kiln-template--/s.jsonl', paths)).toBe(paths[1]);
    expect(projectFromKnownPaths('.claude/projects/-Users-me-elsewhere/s.jsonl', paths)).toBeNull();
    expect(projectFromKnownPaths(null, paths)).toBeNull();
  });

  test('lsof output names the working directory', () => {
    expect(parseLsofCwd('p123\nfcwd\nn/Users/me/proj\n')).toBe('/Users/me/proj');
    expect(parseLsofCwd('p123\nfcwd\n')).toBeNull();
    expect(parseLsofCwd('')).toBeNull();
  });

  test('an unknown agent name still joins through the working directory', () => {
    const tool = { ...base('claude-code'), state: 'working' as const, cwd: '/Users/me/proj' };
    const joined = joinToolAgents([tool], [{ dispatchId: 'ctx_z', agent: 'mystery', workerState: 'running', path: '/Users/me/proj' }], []);
    expect(joined[0].agents[0]).toMatchObject({ dispatchId: 'ctx_z', state: 'running' });
    const other = joinToolAgents([tool], [{ dispatchId: 'ctx_y', agent: 'mystery', path: '/Users/me/other' }], []);
    expect(other[0].agents).toHaveLength(0);
    // Same project but settled: no evidence it is working there now.
    const settled = joinToolAgents([tool], [{ dispatchId: 'ctx_s', agent: 'mystery', workerState: 'succeeded', path: '/Users/me/proj' }], []);
    expect(settled[0].agents).toHaveLength(0);
  });

  test('a dispatch lands on its tool with the role its task text names', () => {
    const joined = joinToolAgents(
      [base('claude-code'), base('opencode')],
      [
        { dispatchId: 'ctx_a', agent: 'claude', model: 'opus', workerState: 'running', taskTitle: 'qa-tester: harden the replay buffer' },
        { dispatchId: 'ctx_b', agent: 'opencode', dispatchStatus: 'pending', taskTitle: 'engine-programmer: cut draw calls' },
        { dispatchId: 'ctx_c', agent: 'unknown-agent', workerState: 'running', taskTitle: 'qa-tester: ignore me' },
      ],
      ['qa-tester', 'engine-programmer'],
    );
    const claude = joined.find(t => t.id === 'claude-code')!;
    const opencode = joined.find(t => t.id === 'opencode')!;
    expect(claude.agents).toHaveLength(1);
    expect(claude.agents[0]).toMatchObject({ dispatchId: 'ctx_a', role: 'qa-tester', state: 'running', model: 'opus' });
    expect(opencode.agents[0]).toMatchObject({ dispatchId: 'ctx_b', role: 'engine-programmer', state: 'pending' });
    expect(joined.flatMap(t => t.agents).map(a => a.dispatchId)).not.toContain('ctx_c');
    // A settled dispatch with a known agent is history, not current tool work.
    const settledAgain = joinToolAgents([base('claude-code')], [{ dispatchId: 'ctx_d', agent: 'claude', workerState: 'succeeded' }], []);
    expect(settledAgain[0].agents).toHaveLength(0);
  });
});

describe('omp subagents', () => {
  const record = (progress: object[]) => JSON.stringify({
    type: 'message',
    message: { role: 'toolResult', toolName: 'task', details: { progress } },
  });
  test('the Change section is the summary, not the Target placeholder', () => {
    expect(taskSummary('Complete assignment thoroughly:\n\n# Target\nNo files.\n\n# Change\nRun `sleep 120` via bash. Do nothing else.\n\n# Acceptance\nreport done'))
      .toBe('Run `sleep 120` via bash. Do nothing else.');
    expect(taskSummary('just do it')).toBe('just do it');
    expect(taskSummary('')).toBeNull();
  });
  test('pending children read as running and keep a useful task line', () => {
    const child = parseOmpSubagents(record([{ id: 'TmpCount', agent: 'task', status: 'pending', task: 'Complete assignment thoroughly:\n\n# Target\n/tmp on this workstation.' }]));
    expect(child).toHaveLength(1);
    expect(child[0]).toMatchObject({ id: 'TmpCount', agent: 'task', state: 'running', task: '/tmp on this workstation.' });
  });
  test.each(['completed', 'failed', 'cancelled', 'aborted'])('async-result %s removes the child', status => {
    const text = [
      record([{ id: 'A', agent: 'coder', status: 'pending', task: 'first' }]),
      asyncResult('A', status),
      record([{ id: 'B', agent: 'tester', status: 'pending', task: 'second' }]),
    ].join('\n');
    expect(parseOmpSubagents(text).map((c) => c.id)).toEqual(['B']);
  });
  test('lines that are not task results are ignored', () => {
    expect(parseOmpSubagents('{"type":"title","v":1}\nnot json\n')).toEqual([]);
  });
});

// Task 4: exercise identity and work at the parser and collection boundaries.
import * as activity from '../activity.ts';

const todoResult = (tasks: object[]) => JSON.stringify({ type: 'message', message: {
  role: 'toolResult', toolName: 'todo', details: { op: 'update', phases: [{ name: 'Work', tasks }] },
} });

test('argv model flags use flattened ps output and bare models have no namespace', () => {
  for (const command of ['codex exec -m codex/gpt-6-astra', 'omp --model codex/gpt-6-astra',
    'omp --model=codex/gpt-6-astra', 'node /Users/x/.local/bin/codex exec -m codex/gpt-6-astra fix it']) {
    expect(activity.modelFromArgv(command)).toBe('codex/gpt-6-astra');
  }
  for (const command of ['codex exec', 'omp --model', 'omp -m --resume',
    'codex exec -- -m fake/model']) {
    expect(activity.modelFromArgv(command)).toBeNull();
  }
  expect(activity.providerOf('codex/gpt-6-astra')).toBe('codex');
  expect(activity.providerOf('proxy/vendor/model')).toBe('proxy');
  expect(activity.modelFromArgv('/Users/x/.local/bin/claude -p Fix the "quote --model claude-opus-5-5 --tools Bash')).toBe('claude-opus-5-5');
  expect(activity.modelFromArgv('opencode run -m opencode-go/x fix it')).toBe('opencode-go/x');
  expect(activity.providerOf('local-model')).toBeNull();
  expect(activity.providerOf(null)).toBeNull();
  expect(activity.providerOf('')).toBeNull();
});

test('interpreter script extensions retain process identity and model', () => {
  for (const extension of ['js', 'mjs', 'cjs']) {
    const command = `node /Users/x/.local/bin/codex.${extension} exec -m codex/gpt-6-astra fix it`;
    const tool = interpretTools([activity.TOOL_DEFS.find(d => d.id === 'codex')!], [row(1, 0, command)], {}, {}, new Map())[0];
    expect(tool.sessions).toHaveLength(1);
    expect(tool.sessions[0]).toMatchObject({ model: 'codex/gpt-6-astra', provider: 'codex' });
    expect(activity.modelFromArgv(command)).toBe('codex/gpt-6-astra');
  }
});

test('bare models use the explicit tool provider mapping', () => {
  for (const [id, command, provider] of [
    ['claude-code', '/Users/x/bin/claude -p fix it --model claude-opus-5-5 --tools Bash', 'claude'],
    ['codex', 'codex -m gpt-6-astra', 'codex'], ['opencode', 'opencode run -m local-model', 'opencode-go'],
    ['omp', 'omp -m local-model', 'opencode-go'], ['cursor', 'cursor-agent --model local-model', 'cursor'],
  ]) {
    const tool = interpretTools([activity.TOOL_DEFS.find(d => d.id === id)!], [row(1, 0, command)], {}, {}, new Map())[0];
    expect(tool.provider).toBe(provider);
    expect(tool.sessions[0].provider).toBe(provider);
  }
  expect(parseOmpSubagents(JSON.stringify({ message: { role: 'toolResult', toolName: 'task', details: {
    progress: [{ id: 'child', agent: 'coder', status: 'pending', model: 'local-model' }],
  } } }))[0].provider).toBe('opencode-go');
});

test('failed todo results preserve the last successful snapshot', () => {
  const failed = JSON.stringify({ message: { role: 'toolResult', toolName: 'todo', isError: true, details: { phases: [] } } });
  expect(activity.parseOmpTodos(todoResult([{ content: 'Continue', status: 'in_progress' }]) + '\n' + failed))
    .toEqual({ current: 'Continue', remaining: 0 });
});

test('newest todo result prefers the first active task and counts what stays open after it', () => {
  const text = [todoResult([{ content: 'Old', status: 'pending' }]), 'broken JSON', todoResult([
    { content: 'First pending', status: 'pending' }, { content: 'Done', status: 'completed' },
    { content: 'Current', status: 'in_progress' }, { content: 'Second active', status: 'in_progress' },
    { content: 'Cancelled', status: 'cancelled' },
  ]), JSON.stringify({ message: { role: 'assistant', toolName: 'todo', details: { phases: [] } } }), '{"message":'].join('\n');
  expect(activity.parseOmpTodos(text)).toEqual({ current: 'Current', remaining: 2 });
  expect(activity.parseOmpTodos(todoResult([{ content: 'Next', status: 'pending' }]))).toEqual({ current: 'Next', remaining: 0 });
  expect(activity.parseOmpTodos(todoResult([{ content: 'Now', status: 'in_progress' }, { content: 'A', status: 'pending' }, { content: 'B', status: 'pending' }])))
    .toEqual({ current: 'Now', remaining: 2 });
  expect(activity.parseOmpTodos(todoResult([{ content: 'Done', status: 'completed' }]))).toEqual({ current: null, remaining: 0 });
  expect(activity.parseOmpTodos(todoResult([]))).toEqual({ current: null, remaining: 0 });
  expect(activity.parseOmpTodos('not json\n{}')).toEqual({ current: null, remaining: null });
  expect(activity.parseOmpTodos(todoResult([{ content: 'Old', status: 'pending' }]) + '\n' +
    JSON.stringify({ message: { role: 'toolResult', toolName: 'todo', details: {} } })))
    .toEqual({ current: null, remaining: null });
});

test('direct process identities stay per pid and unknown without an argv model', () => {
  const tool = interpretTools([def()], [row(1, 0, 'demo -m codex/gpt-6-astra'), row(2, 0, 'demo')], {}, {}, new Map())[0];
  expect(tool.sessions).toEqual([
    expect.objectContaining({ pid: 2, model: null, provider: null }),
    expect.objectContaining({ pid: 1, model: 'codex/gpt-6-astra', provider: 'codex' }),
  ]);
  expect(tool).toMatchObject({ model: null, provider: null, remaining: null });
});

test('omp collection uses matching session model and todos, argv wins, and child details come from its own transcript', async () => {
  const home = mkdtempSync(join(tmpdir(), 'studio-work-payload-'));
  const root = join(home, '.omp/agent/sessions/project');
  mkdirSync(join(root, 'parent'), { recursive: true });
  const now = Date.now();
  const write = (path: string, records: object[], todos?: string) => {
    writeFileSync(path, records.map(r => JSON.stringify(r)).join('\n') + (todos ? '\n' + todos : '') + '\n');
    utimesSync(path, new Date(now), new Date(now));
  };
  write(join(root, 'parent.jsonl'), [
    { type: 'session', id: 'parent', cwd: '/task4/project' },
    { type: 'model_change', model: 'old/model' }, { type: 'model_change', model: 'store/latest' },
    { timestamp: new Date(now).toISOString(), message: { role: 'toolResult', toolName: 'task', details: {
      progress: [{ id: 'child', agent: 'coder', status: 'pending', task: 'Assignment' }],
    } } },
  ], todoResult([{ content: 'Parent current', status: 'in_progress' }, { content: 'Parent next', status: 'pending' }]));
  write(join(root, 'parent/child.jsonl'), [{ type: 'model_change', model: 'child/model' }],
    todoResult([{ content: 'Child current', status: 'in_progress' }]));
  let command = '/bin/omp';
  const spawn = spyOn(Bun, 'spawn').mockImplementation(((args: string[]) => ({
    stdout: new Response(args[0] === 'ps' ? `940001 00:01 ${command}\n940002 00:01 /bin/omp`
      : `n${args[3] === '940001' ? '/task4/project' : '/task4/unrelated'}\n`).body,
    exited: Promise.resolve(0), kill() {},
  })) as typeof Bun.spawn);
  try {
    const collect = async () => (await activity.collectToolActivity(now, home)).find(t => t.id === 'omp')!;
    let tool = await collect();
    expect(tool.sessions.find(s => s.pid === 940001)).toMatchObject({ model: 'store/latest', provider: 'store', current: 'Parent current', remaining: 1 });
    expect(tool.sessions.find(s => s.pid === 940002)).toMatchObject({ model: null, provider: 'opencode-go', remaining: null });
    expect(tool).toMatchObject({ model: null, provider: 'opencode-go', remaining: null });
    expect(tool.subagents).toEqual([expect.objectContaining({ id: 'parent:child', model: 'child/model', provider: 'child', task: 'Child current', remaining: 0 })]);
    command = '/bin/omp -m argv/model';
    tool = await collect();
    expect(tool.sessions.find(s => s.pid === 940001)).toMatchObject({ model: 'argv/model', provider: 'argv', remaining: 1 });
    appendFileSync(join(root, 'parent.jsonl'), todoResult([]) + '\n');
    expect((await collect()).sessions.find(s => s.pid === 940001)).toMatchObject({ current: null, remaining: 0 });
  } finally { spawn.mockRestore(); rmSync(home, { recursive: true, force: true }); }
});

test('quiet omp sessions retain identity and work, but shared cwd processes cannot borrow them', async () => {
  const home = mkdtempSync(join(tmpdir(), 'studio-quiet-omp-'));
  const root = join(home, '.omp/agent/sessions/project');
  mkdirSync(root, { recursive: true });
  const path = join(root, 'quiet.jsonl');
  const now = Date.now();
  writeFileSync(path, [JSON.stringify({ type: 'session', id: 'quiet', cwd: '/task4/quiet' }),
    JSON.stringify({ type: 'model_change', model: 'store/quiet' }),
    todoResult([{ content: 'Continue', status: 'pending' }])].join('\n'));
  utimesSync(path, new Date(now - 3_600_000), new Date(now - 3_600_000));
  let ps = '960001 00:00 omp';
  const spawn = spyOn(Bun, 'spawn').mockImplementation(((args: string[]) => ({
    stdout: new Response(args[0] === 'ps' ? ps : 'n/task4/quiet\n').body, exited: Promise.resolve(0), kill() {},
  })) as typeof Bun.spawn);
  try {
    const collect = async () => (await activity.collectToolActivity(now, home)).find(t => t.id === 'omp')!;
    expect(await collect()).toMatchObject({ state: 'idle', model: 'store/quiet', provider: 'store', current: 'Continue', remaining: 0 });
    ps += '\n960002 00:00 omp';
    const ambiguous = await collect();
    for (const session of ambiguous.sessions) expect(session).toMatchObject({ model: null, provider: 'opencode-go', current: null, remaining: null });
  } finally { spawn.mockRestore(); rmSync(home, { recursive: true, force: true }); }
});

test('omp joins private cwd aliases and rejects multiple processes at the canonical cwd', async () => {
  const home = mkdtempSync(join(tmpdir(), 'studio-private-omp-'));
  const root = join(home, '.omp/agent/sessions/project');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'parent.jsonl'), [
    JSON.stringify({ type: 'session', id: 'parent', cwd: '/x' }),
    JSON.stringify({ type: 'model_change', model: 'local-model' }),
    todoResult([{ content: 'Continue', status: 'pending' }]),
  ].join('\n'));
  const platform = spyOn(process, 'platform', 'get').mockReturnValue('darwin');
  let ps = '970001 00:00 omp';
  const spawn = spyOn(Bun, 'spawn').mockImplementation(((args: string[]) => ({
    stdout: new Response(args[0] === 'ps' ? ps : args[3] === '970001' ? 'n/private/x\n' : 'n/x\n').body,
    exited: Promise.resolve(0), kill() {},
  })) as typeof Bun.spawn);
  try {
    const collect = async () => (await activity.collectToolActivity(Date.now(), home)).find(t => t.id === 'omp')!;
    expect((await collect()).sessions[0]).toMatchObject({ model: 'local-model', provider: 'opencode-go', current: 'Continue', remaining: 0 });
    ps += '\n970002 00:00 omp';
    for (const session of (await collect()).sessions) expect(session).toMatchObject({ model: null, remaining: null });
  } finally { spawn.mockRestore(); platform.mockRestore(); rmSync(home, { recursive: true, force: true }); }
});

test('store-only codex and claude identities come from transcript records', async () => {
  const home = mkdtempSync(join(tmpdir(), 'studio-store-identity-'));
  const codex = join(home, '.codex/sessions/2026/11/13');
  const claude = join(home, '.claude/projects/project');
  mkdirSync(codex, { recursive: true }); mkdirSync(claude, { recursive: true });
  const rollout = join(codex, 'rollout.jsonl');
  writeFileSync(rollout, JSON.stringify({ type: 'session_meta', payload: {
    cwd: '/store/project', model_provider: 'custom-provider', model: 'gpt-6-astra',
  } }) + '\n');
  writeFileSync(join(claude, 'session.jsonl'), JSON.stringify({ type: 'assistant', cwd: '/claude/project', message: { role: 'assistant', model: 'claude-opus-5-5' } }) + '\n');
  // History may be newer than the rollout, but does not carry session identity.
  writeFileSync(join(home, '.codex/history.jsonl'), '{}\n');
  let ps = '';
  const spawn = spyOn(Bun, 'spawn').mockImplementation(((args: string[]) => ({
    stdout: new Response(args[0] === 'ps' ? ps : 'n/store/project\n').body,
    exited: Promise.resolve(0), kill() {},
  })) as typeof Bun.spawn);
  try {
    const collect = () => activity.collectToolActivity(Date.now(), home);
    let tools = await collect();
    expect(tools.find(t => t.id === 'codex')).toMatchObject({ processes: 0, provider: 'custom-provider', model: 'gpt-6-astra' });
    expect(tools.find(t => t.id === 'claude-code')).toMatchObject({ processes: 0, provider: 'claude', model: 'claude-opus-5-5' });
    ps = '980001 00:00 node /Users/x/bin/codex.js exec -m argv/model';
    expect((await collect()).find(t => t.id === 'codex')!.sessions[0]).toMatchObject({ provider: 'custom-provider', model: 'argv/model' });
    ps = '';
    writeFileSync(rollout, JSON.stringify({ type: 'session_meta', payload: { model_provider: 'custom-provider' } }) + '\n');
    expect((await collect()).find(t => t.id === 'codex')).toMatchObject({ provider: 'custom-provider', model: null });
    writeFileSync(rollout, '{}\n');
    expect((await collect()).find(t => t.id === 'codex')!.model).toBeNull();
  } finally { spawn.mockRestore(); rmSync(home, { recursive: true, force: true }); }
});
