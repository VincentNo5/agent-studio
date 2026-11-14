import { describe, test, expect, spyOn } from 'bun:test';
import { collectToolActivity, readOmpSubagents } from '../activity.ts';
import { interpretTools, joinToolAgents, parseCpuTime, parseLsofCwd, parseOmpSubagents, taskSummary, parsePs, projectFromKnownPaths, projectFromSession, runsTool, newestEntry, humanAge, toolForAgent, WORKING_WINDOW_MS, type PsRow, type StoreMap, type ToolActivity, type ToolDef } from '../activity.ts';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
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
    expect(tool.evidence).toContain('pid 10');
  });

  test('a first sample cannot claim cpu activity', () => {
    expect(derive([row(10, 42.4, '/bin/demo run')], { demo: {} }, true).cpuActive).toBe(false);
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
  cpuActive: false, pids: [], cwd: null, model: null, sessions: [], lastSession: null, lastActivity: null, evidence: 'installed',
});

test('collection preserves each live pid and its own cwd, with nullable models until Task 4', async () => {
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
      { pid: 900002, cwd: '/projects/two', model: null, command: commands[1] },
      { pid: 900001, cwd: '/projects/one', model: null, command: commands[0] },
    ]);
    expect(tool.processes).toBe(2);
    expect(tool.pids).toEqual([900001, 900002]);
    expect(tool.cwd).toBe('/projects/two');
    expect(tool.model).toBeNull();
    ps = '';
    expect((await collectToolActivity()).find(tool => tool.id === 'codex')!.sessions).toEqual([]);
  } finally { spawn.mockRestore(); }
});

test('omp children keep session identity and survive old spawn records with recent parent output', async () => {
  const home = mkdtempSync(join(tmpdir(), 'studio-omp-'));
  const root = join(home, '.omp/agent/sessions/project');
  mkdirSync(root, { recursive: true });
  const now = Date.parse('2026-11-13T12:00:00Z');
  const progress = (status: string, msAgo: number) => JSON.stringify({
    timestamp: new Date(now - msAgo).toISOString(),
    message: { role: 'toolResult', toolName: 'task', details: { progress: [{ id: 'child', agent: 'coder', status, task: 'Build it' }] } },
  });
  const writeSession = (id: string, records: string[], msAgo = 1000) => {
    const path = join(root, `file-${id}.jsonl`);
    writeFileSync(path, [JSON.stringify({ type: 'session', id }), ...records].join('\n'));
    utimesSync(path, new Date(now - msAgo), new Date(now - msAgo));
  };
  try {
    // The spawn must survive even after more than the former 400 KB tail of parent output.
    writeSession('parent-a', [progress('pending', 120_000), JSON.stringify({ message: { role: 'assistant', content: 'x'.repeat(410_000) } })]);
    writeSession('parent-b', [progress('pending', 120_000), progress('running', 1000)]);
    writeSession('parent-c', [progress('pending', 120_000), progress('completed', 1000)]);
    writeSession('parent-d', [progress('pending', 90_000)], 70_000);
    const children = await readOmpSubagents(now, home);
    expect(children.map(child => child.id).sort()).toEqual(['parent-a:child', 'parent-b:child', 'parent-d:child']);
    expect(children.find(child => child.id === 'parent-a:child')).toMatchObject({ stale: true, task: 'Build it' });
    expect(children.find(child => child.id === 'parent-b:child')).toMatchObject({ stale: false });
    expect(children.find(child => child.id === 'parent-d:child')).toMatchObject({ stale: true });
  } finally { rmSync(home, { recursive: true, force: true }); }
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
  test('settled children are dropped, and the newest record wins', () => {
    const text = [
      record([{ id: 'A', agent: 'coder', status: 'pending', task: 'first' }]),
      record([{ id: 'A', agent: 'coder', status: 'completed', task: 'first' }]),
      record([{ id: 'B', agent: 'tester', status: 'pending', task: 'second' }]),
    ].join('\n');
    expect(parseOmpSubagents(text).map((c) => c.id)).toEqual(['B']);
  });
  test('lines that are not task results are ignored', () => {
    expect(parseOmpSubagents('{"type":"title","v":1}\nnot json\n')).toEqual([]);
  });
});
