// Agent Studio — a live studio floor for multi-agent work.
//
// Sources (all read-only):
//   • CCGS roster            → studio rooms + roles          (roster.json, generated from .claude/agents)
//   • Paseo                  → live agents                   (`paseo ls --json`)
//   • Orca                   → supervised workers            (`orca orchestration worker-list|terminal list|worktree list`)
//   • Orca task specs        → role matching per worker      (`orca orchestration task-list --from $ORCA_COORDINATOR`)
//   • hermes kanban          → persistent task board         (`hermes kanban list`)
//   • CCGS subagent audit    → real role activity            (`$CCGS_ROOT/production/session-logs/agent-audit.log`)
//
// Run: bun run server.ts      (env: PORT, ORCA_COORDINATOR, CCGS_ROOT, AGENT_STUDIO_AUDIT)
//
// Every /state read spawns 6 CLI processes (~1 s each; hermes is a Python start-up) and performs
// one local HTTP quota fetch. Several browser tabs polling every 2 s therefore previously queued
// behind each other, leaving pages on "Connecting…". Collects are shared across clients: one per TTL;
// concurrent callers join the in-flight promise.
//
// Boundary contract: every CLI/JSON shape below mirrors what the producer emits today.
// Fields are optional because a producer may add or omit keys between versions; mapping
// coerces each one to `| null`.
//
interface PaseoAgentRow {
  id?: string;
  shortId?: string;
  name?: string;
  provider?: string;
  thinking?: string;
  status?: string;
  cwd?: string;
  created?: string;
}

interface PaseoAgentView {
  id: string | null;
  shortId: string | null;
  name: string | null;
  provider: string | null;
  thinking: string | null;
  status: string | null;
  cwd: string | null;
  created: string | null;
}
interface MagpieQuotaWindowRow { name?: string; used?: number; remaining?: number; resetsAt?: string }
interface MagpieQuotaRow { provider?: string; name?: string; kind?: string; user?: string; windows?: MagpieQuotaWindowRow[] }
interface QuotaView {
  provider: string | null;
  name: string | null;
  kind: string | null;
  user: string | null;
  windows: { name: string | null; used: number | null; remaining: number | null; resetsAt: string | null }[];
}


const DIR = import.meta.dir;
const PORT = Number(process.env.PORT ?? 8787);
const TTL_MS = Number(process.env.AGENT_STUDIO_TTL_MS ?? 1500);

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
  paseo: PaseoAgentView[];
  quotas: QuotaView[];
  kanban: Record<string, unknown>[];
  kanbanStats: Record<string, number>;
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
  // `hermes kanban stats` is deliberately not spawned: lane counts are derived from `list`.
  // Magpie quotas use local HTTP and do not add a CLI spawn.
  const [workersRaw, terminalsRaw, worktreesRaw, kanbanRaw, tasksRaw, paseoRaw, quotasRaw] = await Promise.all([
    run(["orca", "orchestration", "worker-list", "--include-remote", "--json"]),
    run(["orca", "terminal", "list", "--json"]),
    run(["orca", "worktree", "list", "--json"]),
    run(["hermes", "kanban", "list", "--json"]),
    coordinator ? run(["orca", "orchestration", "task-list", "--from", coordinator, "--json"]) : Promise.resolve(""),
    run(["paseo", "ls", "--json"]),
    fetch("http://127.0.0.1:3425/v1/magpie/quotas", { signal: AbortSignal.timeout(3000) })
      .then((response) => response.ok ? response.text() : "")
      .catch(() => ""),
  ]);


  const workerRows = (readJson(workersRaw) as { result?: { workers?: OrcaWorkerRow[] } } | null)?.result?.workers ?? [];
  const terminalRows = (readJson(terminalsRaw) as { result?: { terminals?: OrcaTerminalRow[] } } | null)?.result?.terminals ?? [];
  const worktreeRows = (readJson(worktreesRaw) as { result?: { worktrees?: OrcaWorktreeRow[] } } | null)?.result?.worktrees ?? [];
  const taskRows = (readJson(tasksRaw) as { result?: { tasks?: OrcaTaskRow[] } } | null)?.result?.tasks ?? [];
  const paseoParsed = readJson(paseoRaw);
  const paseoRows = Array.isArray(paseoParsed) ? paseoParsed as PaseoAgentRow[] : [];
  const quotasParsed = readJson(quotasRaw) as { data?: MagpieQuotaRow[] } | null;
  const quotas: QuotaView[] = Array.isArray(quotasParsed?.data) ? quotasParsed.data.map((quota) => ({
    provider: quota.provider ?? null,
    name: quota.name ?? null,
    kind: quota.kind ?? null,
    user: quota.user ?? null,
    windows: (quota.windows ?? []).map((window) => ({
      name: window.name ?? null,
      // Some providers report fractional percentages (cursor: 95.24888888888889);
      // round at the boundary so every consumer renders an integer.
      used: window.used == null ? null : Math.round(window.used),
      remaining: window.remaining == null ? null : Math.round(window.remaining),
      resetsAt: window.resetsAt ?? null,
    })),
  })) : [];

  const kanbanParsed = readJson(kanbanRaw) as Record<string, unknown>[] | { tasks?: Record<string, unknown>[] } | null;
  const kanban = Array.isArray(kanbanParsed) ? kanbanParsed : (kanbanParsed?.tasks ?? []);

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
  const paseo: PaseoAgentView[] = paseoRows.map((agent) => ({
    id: agent.id ?? null,
    shortId: agent.shortId ?? null,
    name: agent.name ?? null,
    provider: agent.provider ?? null,
    thinking: agent.thinking ?? null,
    status: agent.status ?? null,
    cwd: agent.cwd ?? null,
    created: agent.created ?? null,
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

  const kanbanStats: Record<string, number> = {};
  for (const t of kanban) {
    const status = typeof t.status === "string" ? t.status : "todo";
    kanbanStats[status] = (kanbanStats[status] ?? 0) + 1;
  }

  const auditPath = auditLogPath();
  let audit: StudioState["audit"] = { source: auditPath, events: [], agents: [] };
  if (auditPath && (await Bun.file(auditPath).exists())) {
    const text = await Bun.file(auditPath).text();
    const events = parseAuditLog(text).slice(-500);
    audit = { source: auditPath, events: events.slice(-40), agents: summarizeAudit(events) };
  }

  return { ts: Date.now(), workers, terminals, worktrees, paseo, quotas, kanban, kanbanStats, audit };
}

// One collect (six CLI spawns plus local HTTP) per TTL, shared by every client; concurrent callers join the in-flight promise.
let cached: { at: number; data: StudioState } | null = null;
let inflight: Promise<StudioState> | null = null;

function stateForClients(): Promise<StudioState> {
  if (cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.data);
  if (inflight) return inflight;
  inflight = collect()
    .then((data) => { cached = { at: Date.now(), data }; return data; })
    .finally(() => { inflight = null; });
  return inflight;
}

// Access control: the studio has no login, so it is restricted by source address instead.
// Default is loopback plus the Tailscale ranges (100.64.0.0/10 IPv4, fd7a:115c:a1e0::/48 IPv6),
// which keeps it readable from this machine and from the tailnet while hiding it from whatever
// LAN the machine is plugged into — the point being that this laptop moves between home and an
// office network. Override with AGENT_STUDIO_ALLOW="cidr,cidr,...".
const ALLOW = (process.env.AGENT_STUDIO_ALLOW ?? "127.0.0.0/8,::1/128,100.64.0.0/10,fd7a:115c:a1e0::/48")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

interface Cidr { bytes: number[]; bits: number }

/** 4 bytes for IPv4 (including IPv4-mapped IPv6), 16 for IPv6; null when unparseable. */
function ipToBytes(address: string): number[] | null {
  const bare = address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
  if (bare.includes(".")) {
    const parts = bare.split(".");
    if (parts.length !== 4) return null;
    const bytes = parts.map(Number);
    return bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255) ? bytes : null;
  }
  const [head, tail] = address.includes("::") ? address.split("::") : [address, undefined];
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail === undefined ? [] : tail ? tail.split(":") : [];
  if (tail !== undefined && headGroups.length + tailGroups.length > 8) return null;
  const groups = [...headGroups, ...Array(8 - headGroups.length - tailGroups.length).fill("0"), ...tailGroups];
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const group of groups) {
    const value = parseInt(group || "0", 16);
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) return null;
    bytes.push(value >> 8, value & 0xff);
  }
  return bytes;
}

function parseCidr(spec: string): Cidr | null {
  const [address, lengthText] = spec.split("/");
  const bytes = ipToBytes(address);
  if (!bytes) return null;
  const bits = lengthText === undefined ? bytes.length * 8 : Number(lengthText);
  if (!Number.isInteger(bits) || bits < 0 || bits > bytes.length * 8) return null;
  return { bytes, bits };
}

const ALLOWED = ALLOW.map(parseCidr).filter((entry): entry is Cidr => entry !== null);

function isAllowed(address: string | null | undefined): boolean {
  if (!address) return false;
  const client = ipToBytes(address);
  if (!client) return false;
  return ALLOWED.some((net) => {
    if (net.bytes.length !== client.length) return false;
    for (let bit = 0; bit < net.bits; bit++) {
      const mask = 1 << (7 - (bit % 8));
      if ((client[bit >> 3] & mask) !== (net.bytes[bit >> 3] & mask)) return false;
    }
    return true;
  });
}

Bun.serve({
  port: PORT,
  idleTimeout: 60,
  async fetch(req, server) {
    if (!isAllowed(server.requestIP(req)?.address)) {
      return new Response("Forbidden: source address is not on the allowlist.\n", {
        status: 403,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    const path = new URL(req.url).pathname;
    if (path === "/state") {
      return Response.json(await stateForClients(), { headers: { "cache-control": "no-store" } });
    }
    if (path === "/roster.json") {
      return new Response(Bun.file(`${DIR}/roster.json`), { headers: { "content-type": "application/json" } });
    }
    if (path === "/floor") {
      return new Response(Bun.file(`${DIR}/floor.html`), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (path === "/mobile") {
      return new Response(Bun.file(`${DIR}/mobile.html`), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    return new Response(Bun.file(`${DIR}/index.html`), { headers: { "content-type": "text/html; charset=utf-8" } });
  },
});

console.log(`Agent Studio on http://127.0.0.1:${PORT} (state TTL ${TTL_MS}ms) — allow ${ALLOW.join(" ")}`);
