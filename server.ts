// Agent Studio — a live studio floor for multi-agent work.
//
// Sources (all read-only):
//   • CCGS roster            → studio rooms + roles          (roster.json, generated from .claude/agents)
//   • Orca                   → supervised workers            (`orca orchestration worker-list|terminal list|worktree list`)
//   • Orca task specs        → role matching per worker      (`orca orchestration task-list --from $ORCA_COORDINATOR`)
//   • hermes kanban          → persistent task board         (`hermes kanban list|stats`)
//   • CCGS subagent audit    → real role activity            (`$CCGS_ROOT/production/session-logs/agent-audit.log`)
//
// Run: bun run server.ts      (env: PORT, ORCA_COORDINATOR, CCGS_ROOT, AGENT_STUDIO_AUDIT)
//
// Boundary contract: every CLI/JSON shape below mirrors what the producer emits today.
// Fields are optional because a producer may add or omit keys between versions; mapping
// coerces each one to `| null`.
const DIR = import.meta.dir;
const PORT = Number(process.env.PORT ?? 8787);

interface OrcaWorkerRow {
  dispatchId?: string;
  taskId?: string;
  runId?: string;
  workerState?: string;
  dispatchStatus?: string;
  terminalState?: string;
  agentTerminalHandle?: string;
  resource?: { worktreeId?: string };
  projection?: {
    agent?: string;
    liveness?: { verdict?: string; reason?: string };
    nextAction?: { kind?: string };
    host?: { id?: string };
  };
}

interface OrcaTerminalRow { handle?: string; title?: string; status?: string }
interface OrcaWorktreeRow { displayName?: string; branch?: string; path?: string }
interface OrcaTaskRow { id?: string; title?: string; spec?: string; status?: string; assignee?: string }

interface WorkerView {
  dispatchId: string | null;
  taskId: string | null;
  runId: string | null;
  workerState: string | null;
  dispatchStatus: string | null;
  terminalState: string | null;
  terminalHandle: string | null;
  worktreeId: string | null;
  /** Human label: the worker terminal's own title (it carries the task title). */
  label: string | null;
  worktreeName: string | null;
  /** Task title/spec from `orca orchestration task-list`, when a coordinator handle is configured. */
  taskTitle: string | null;
  taskSpec: string | null;
  liveness: string | null;
  livenessReason: string | null;
  nextAction: string | null;
  agent: string | null;
  host: string | null;
}

interface TerminalView { handle: string | null; title: string | null; status: string | null }
interface WorktreeView { name: string | null; branch: string | null; path: string | null }

interface AuditEvent { ts: string; session: string; kind: "invoked" | "completed"; agent: string }
interface AgentActivity { agent: string; invoked: number; completed: number; active: number; lastTs: string }

interface StudioState {
  ts: number;
  workers: WorkerView[];
  terminals: TerminalView[];
  worktrees: WorktreeView[];
  kanban: Record<string, unknown>[];
  kanbanStats: Record<string, unknown>;
  audit: { source: string | null; events: AuditEvent[]; agents: AgentActivity[] };
}

/** JSON.parse that yields `unknown` instead of throwing (every CLI read shares it). */
function readJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function run(cmd: string[], timeoutMs = 8000): Promise<string> {
  try {
    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
    const timer = setTimeout(() => { try { proc.kill(); } catch { /* already gone */ } }, timeoutMs);
    const out = await new Response(proc.stdout).text();
    clearTimeout(timer);
    try { await proc.exited; } catch { /* killed */ }
    return out;
  } catch {
    return "";
  }
}

/** Orca worktree ids are `<repoId>::<path>`; the studio only shows the leaf. */
function worktreeLeaf(id: string | null): string | null {
  if (!id) return null;
  const tail = id.includes("::") ? id.slice(id.indexOf("::") + 2) : id;
  const parts = tail.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : tail;
}

/** `TS | session | Agent invoked: <agent_type>` — the shape log-agent.sh / log-agent-stop.sh write. */
function parseAuditLog(text: string): AuditEvent[] {
  const events: AuditEvent[] = [];
  for (const line of text.split("\n")) {
    const parts = line.split(" | ");
    if (parts.length < 3) continue;
    const [ts, session, rest] = parts;
    const invoked = rest.startsWith("Agent invoked: ");
    const completed = rest.startsWith("Agent completed: ");
    if (!invoked && !completed) continue;
    events.push({
      ts,
      session,
      kind: invoked ? "invoked" : "completed",
      agent: (invoked ? rest.slice("Agent invoked: ".length) : rest.slice("Agent completed: ".length)).trim(),
    });
  }
  return events;
}

/** Per-role tally: `active` is invoked minus completed, floored at zero. */
function summarizeAudit(events: AuditEvent[]): AgentActivity[] {
  const byAgent: Record<string, AgentActivity> = {};
  for (const e of events) {
    const row = (byAgent[e.agent] ??= { agent: e.agent, invoked: 0, completed: 0, active: 0, lastTs: e.ts });
    if (e.kind === "invoked") row.invoked += 1;
    else row.completed += 1;
    if (e.ts > row.lastTs) row.lastTs = e.ts;
  }
  return Object.values(byAgent).map((row) => ({ ...row, active: Math.max(0, row.invoked - row.completed) }));
}

/** Audit log location: explicit file, else `<CCGS_ROOT>/production/session-logs/agent-audit.log`. */
function auditLogPath(): string | null {
  if (process.env.AGENT_STUDIO_AUDIT) return process.env.AGENT_STUDIO_AUDIT;
  const root = process.env.CCGS_ROOT ?? (Bun.file("/tmp/ccgs/project.yaml").size > 0 ? "/tmp/ccgs" : null);
  return root ? `${root}/production/session-logs/agent-audit.log` : null;
}

async function collect(): Promise<StudioState> {
  const coordinator = process.env.ORCA_COORDINATOR;
  const [workersRaw, terminalsRaw, worktreesRaw, kanbanRaw, kanbanStatsRaw, tasksRaw] = await Promise.all([
    run(["orca", "orchestration", "worker-list", "--include-remote", "--json"]),
    run(["orca", "terminal", "list", "--json"]),
    run(["orca", "worktree", "list", "--json"]),
    run(["hermes", "kanban", "list", "--json"]),
    run(["hermes", "kanban", "stats", "--json"]),
    coordinator ? run(["orca", "orchestration", "task-list", "--from", coordinator, "--json"]) : Promise.resolve(""),
  ]);

  const workerRows = (readJson(workersRaw) as { result?: { workers?: OrcaWorkerRow[] } } | null)?.result?.workers ?? [];
  const terminalRows = (readJson(terminalsRaw) as { result?: { terminals?: OrcaTerminalRow[] } } | null)?.result?.terminals ?? [];
  const worktreeRows = (readJson(worktreesRaw) as { result?: { worktrees?: OrcaWorktreeRow[] } } | null)?.result?.worktrees ?? [];
  const taskRows = (readJson(tasksRaw) as { result?: { tasks?: OrcaTaskRow[] } } | null)?.result?.tasks ?? [];
  const kanbanParsed = readJson(kanbanRaw) as Record<string, unknown>[] | { tasks?: Record<string, unknown>[] } | null;
  const stats = (readJson(kanbanStatsRaw) as { by_status?: Record<string, unknown> } | null)?.by_status ?? {};

  const terminals: TerminalView[] = terminalRows.map((t) => ({
    handle: t.handle ?? null,
    title: t.title ?? null,
    status: t.status ?? null,
  }));
  const worktrees: WorktreeView[] = worktreeRows.map((w) => ({
    name: w.displayName ?? null,
    branch: w.branch ?? null,
    path: w.path ?? null,
  }));

  // Runtime-built, string-keyed joins. Plain records: keys are strings, only get/set is used.
  const titleByHandle: Record<string, string> = {};
  for (const t of terminals) if (t.handle && t.title) titleByHandle[t.handle] = t.title;
  const nameByPath: Record<string, string> = {};
  for (const w of worktrees) if (w.path && w.name) nameByPath[w.path] = w.name;
  const taskById: Record<string, OrcaTaskRow> = {};
  for (const t of taskRows) if (t.id) taskById[t.id] = t;

  const workers: WorkerView[] = workerRows.map((row) => {
    const worktreeId = row.resource?.worktreeId ?? null;
    const path = worktreeId?.includes("::") ? worktreeId.slice(worktreeId.indexOf("::") + 2) : worktreeId;
    const handle = row.agentTerminalHandle ?? null;
    const task = row.taskId ? taskById[row.taskId] : undefined;
    return {
      dispatchId: row.dispatchId ?? null,
      taskId: row.taskId ?? null,
      runId: row.runId ?? null,
      workerState: row.workerState ?? null,
      dispatchStatus: row.dispatchStatus ?? null,
      terminalState: row.terminalState ?? null,
      terminalHandle: handle,
      worktreeId,
      label: (handle ? titleByHandle[handle] : undefined) ?? null,
      worktreeName: (path ? nameByPath[path] : undefined) ?? worktreeLeaf(worktreeId),
      taskTitle: task?.title ?? null,
      taskSpec: task?.spec ?? null,
      liveness: row.projection?.liveness?.verdict ?? null,
      livenessReason: row.projection?.liveness?.reason ?? null,
      nextAction: row.projection?.nextAction?.kind ?? null,
      agent: row.projection?.agent ?? null,
      host: row.projection?.host?.id ?? null,
    };
  });

  const auditPath = auditLogPath();
  let audit: StudioState["audit"] = { source: auditPath, events: [], agents: [] };
  if (auditPath && (await Bun.file(auditPath).exists())) {
    const text = await Bun.file(auditPath).text();
    const events = parseAuditLog(text).slice(-500);
    audit = { source: auditPath, events: events.slice(-40), agents: summarizeAudit(events) };
  }

  return {
    ts: Date.now(),
    workers,
    terminals,
    worktrees,
    kanban: Array.isArray(kanbanParsed) ? kanbanParsed : (kanbanParsed?.tasks ?? []),
    kanbanStats: stats,
    audit,
  };
}

Bun.serve({
  port: PORT,
  idleTimeout: 60,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/state") {
      return Response.json(await collect(), { headers: { "cache-control": "no-store" } });
    }
    if (path === "/roster.json") {
      return new Response(Bun.file(`${DIR}/roster.json`), { headers: { "content-type": "application/json" } });
    }
    if (path === "/floor") {
      return new Response(Bun.file(`${DIR}/floor.html`), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    return new Response(Bun.file(`${DIR}/index.html`), { headers: { "content-type": "text/html; charset=utf-8" } });
  },
});

console.log(`Agent Studio on http://127.0.0.1:${PORT}`);
