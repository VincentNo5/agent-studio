// Agent tool activity — one normalized record per installed agent surface.
//
// Two generic signals, no per-tool SDKs and no writes:
//   1. process table  — `ps -axo pid=,time=,command=` matched against known
//      executable names; the cumulative CPU column gives a working/idle delta.
//   2. session stores — the newest file mtime under each tool's own state dir
//      (Claude Code JSONL, Codex rollouts, opencode/omp SQLite WAL, …).
//
// Boundary: every field below is derived, never reported; a tool that adds or
// moves a store simply reads `available`/`offline` until its row is updated.
import { existsSync, readdirSync, statSync } from "node:fs";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { basename } from "node:path";
import { isPresent } from "./public/studio-data.js";

export type ToolState = "working" | "idle" | "available" | "offline";

/** One Orca dispatch using a surface: the join that says who works in which tool. */
export interface ToolDispatch {
  dispatchId: string | null;
  agent: string | null;
  model: string | null;
  state: string | null;
  role: string | null;
  task: string | null;
  worktree: string | null;
}

/** The subset of a worker row the join reads; `WorkerView` satisfies it structurally. */
export interface WorkerLite {
  dispatchId?: string | null;
  agent?: string | null;
  model?: string | null;
  workerState?: string | null;
  dispatchStatus?: string | null;
  liveness?: string | null;
  taskTitle?: string | null;
  taskSpec?: string | null;
  label?: string | null;
  worktreeName?: string | null;
  /** Worktree path, used when the agent name is unknown. */
  path?: string | null;
}

/** Child evidence older than this is uncertain, not proof the child has stopped. */
const SUBAGENT_LIVE_MS = 60_000;
const SUBAGENT_SESSION_WINDOW_MS = 10 * 60_000;

export interface OmpSubagent { id: string; agent: string; state: string; task: string | null; stale?: boolean }

export interface ToolSession { pid: number; cwd: string | null; model: string | null; command: string }

export interface ToolActivity {
  /** Stable slug, unique across the table. */
  id: string;
  name: string;
  kind: "cli" | "ide" | "gateway";
  installed: boolean;
  state: ToolState;
  /** Matching live processes right now. */
  processes: number;
  /** Matching pids, newest sample only. */
  pids: number[];
  /** One entry per live pid, newest first (descending pid in the process sample). */
  sessions: ToolSession[];
  /** Working directory of the newest live session (lsof, cached per pid). */
  cwd: string | null;
  /** Model of the newest live session; populated starting in Task 4. */
  model: string | null;
  /** Cumulative CPU time advanced since the previous sample. */
  cpuActive: boolean;
  /** Newest store file, relative to the home directory. */
  lastSession: string | null;
  /** ISO time of that file's mtime, or null when the store is absent. */
  lastActivity: string | null;
  /** Short human-readable reason for the state. */
  evidence: string;
  /** Unsettled omp task-tool children across recently touched sessions. */
  subagents?: OmpSubagent[];
}

export interface ToolDef {
  id: string;
  name: string;
  kind: "cli" | "ide" | "gateway";
  /** Executable basenames that mean "this tool is running". */
  bins: string[];
  /** State directories scanned for the newest file. */
  stores: string[];
  /** Agent names Orca reports for this tool (`worker-show .agent`). */
  agents: string[];
  /** Files a store scan must skip (lock files, caches, logs that idle-churn). */
  skip?: RegExp;
}

export interface PsRow { pid: number; cpu: number; command: string }

const HOME = homedir();

/** Logs/DBs that idle-churn on their own; excluded so a background timer does not read as work. */
const CHURN = /(\.lock$|\.tmp$|statsig|telemetry|\.log(\.\d+)?$|cache\/|\.DS_Store$|-shm$)/;

export const TOOL_DEFS: ToolDef[] = [
  { id: "claude-code", name: "Claude Code", kind: "cli", bins: ["claude"], agents: ["claude", "claude-code"], stores: [".claude/projects"] },
  { id: "codex", name: "Codex CLI", kind: "cli", bins: ["codex"], agents: ["codex"], stores: [".codex/sessions", ".codex/history.jsonl"] },
  { id: "opencode", name: "OpenCode", kind: "cli", bins: ["opencode"], agents: ["opencode", "opencode-go"], stores: [".local/share/opencode"] },
  { id: "omp", name: "omp", kind: "cli", bins: ["omp"], agents: ["omp", "opencode-go"], stores: [".omp/agent/sessions", ".omp/agent/agent.db-wal"] },
  { id: "cursor", name: "Cursor", kind: "ide", bins: ["cursor-agent", "Cursor"], agents: ["cursor", "cursor-agent"], stores: [".cursor/chats", ".cursor/ai-tracking"] },
  { id: "vscode", name: "VS Code agents", kind: "ide", bins: ["code"], agents: ["copilot"], stores: ["Library/Application Support/Code/User/globalStorage/agent-host.db-wal", "Library/Application Support/Code/User/globalStorage/agent-host.db"] },
  { id: "windsurf", name: "Windsurf", kind: "ide", bins: ["Windsurf"], agents: ["windsurf", "cascade"], stores: [".codeium/windsurf/cascade", ".codeium/windsurf/database"] },
  { id: "pi", name: "Pi", kind: "cli", bins: ["pi"], agents: ["pi"], stores: [".pi/agent/sessions"] },
  { id: "hermes", name: "Hermes", kind: "gateway", bins: ["hermes"], agents: ["hermes"], stores: [".hermes/sessions"] },
  { id: "openclaw", name: "OpenClaw", kind: "gateway", bins: ["openclaw", "openclaw-gateway"], agents: ["openclaw"], stores: [".openclaw/agents", ".openclaw/identity"] },
  { id: "t3", name: "T3 Code", kind: "ide", bins: ["t3", "t3-code"], agents: ["t3"], stores: [".t3/userdata/statev2.sqlite-wal"] },
  { id: "amp", name: "Amp", kind: "cli", bins: ["amp"], agents: ["amp"], stores: [".local/share/amp/threads"] },
  { id: "gemini-cli", name: "Gemini CLI", kind: "cli", bins: ["gemini"], agents: ["gemini"], stores: [".gemini/tmp"] },
  { id: "aider", name: "Aider", kind: "cli", bins: ["aider"], agents: ["aider"], stores: [".aider"] },
];

/** Orca's `agent` string → the tool row that owns it. */
export function toolForAgent(agent: string | null | undefined, defs: ToolDef[] = TOOL_DEFS): string | null {
  const needle = (agent ?? "").trim().toLowerCase();
  if (!needle) return null;
  return defs.find((def) => def.agents.some((name) => needle === name || needle.startsWith(`${name}-`)))?.id ?? null;
}

/** `ps -axo time=` → seconds. Accepts SS, MM:SS, HH:MM:SS and D-HH:MM:SS. */
export function parseCpuTime(text: string): number {
  const parts = text.trim().split("-");
  const days = parts.length > 1 ? Number(parts[0]) : 0;
  const clock = (parts.length > 1 ? parts[1] : parts[0]).split(":").map(Number);
  if (clock.some((n) => !Number.isFinite(n))) return 0;
  const [h, m, s] = clock.length >= 3 ? clock.slice(-3) : [0, ...clock.slice(-2)];
  return days * 86_400 + h * 3600 + m * 60 + s;
}

/** One `ps` line per process: pid, cumulative CPU, full command. */
export function parsePs(text: string): PsRow[] {
  const rows: PsRow[] = [];
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\S+)\s+(.*)$/);
    if (!match) continue;
    rows.push({ pid: Number(match[1]), cpu: parseCpuTime(match[2]), command: match[3] });
  }
  return rows;
}

/** Interpreters that carry the real executable in their first script argument. */
const INTERPRETERS = new Set(["node", "bun", "deno", "python", "python3", "npx", "tsx"]);

/**
 * True when the command *is* one of the tool's executables. Only the executable
 * position counts — argv such as a prompt that mentions "Cursor" must not match.
 */
export function runsTool(command: string, bins: string[]): boolean {
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  const exe = basename((tokens[0] ?? "").replace(/[),;]+$/, ""));
  if (bins.includes(exe)) return true;
  if (!INTERPRETERS.has(exe)) return false;
  const script = tokens.slice(1).find((token) => !token.startsWith("-"));
  return script !== undefined && bins.includes(basename(script.replace(/[),;]+$/, "")));
}

/** Newest non-churn entry under a directory tree; bounded so a huge store stays cheap. */
export function newestEntry(root: string, budget = 3000, depth = 4): { path: string; mtime: number } | null {
  let best: { path: string; mtime: number } | null = null;
  let left = budget;
  const walk = (dir: string, level: number): void => {
    if (left <= 0) return;
    let entries: Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (left-- <= 0) return;
      const full = join(dir, entry.name);
      if (CHURN.test(entry.name)) continue;
      if (entry.isDirectory()) {
        if (level < depth && entry.name !== "node_modules" && entry.name !== ".git") walk(full, level + 1);
        continue;
      }
      try {
        const mtime = statSync(full).mtimeMs;
        if (!best || mtime > best.mtime) best = { path: full, mtime };
      } catch { /* raced with a writer */ }
    }
  };
  try {
    if (statSync(root).isFile()) return { path: root, mtime: statSync(root).mtimeMs };
  } catch { return null; }
  walk(root, 0);
  return best;
}

/**
 * Claude Code and pi name a session directory after the working directory, with every
 * non-alphanumeric replaced by `-`; recover the project when the real path still exists.
 */
export function projectFromSession(relPath: string | null, home = HOME): string | null {
  if (!relPath) return null;
  const match = relPath.match(/^(?:\.claude\/projects|\.pi\/agent\/sessions)\/([^/]+)\//);
  if (!match) return null;
  let slug = match[1];
  slug = slug.startsWith("--") ? slug.slice(2, -2) : slug.replace(/^-/, "");
  if (!slug) return null;
  const candidate = `${home}/${slug.split("-").join("/")}`;
  return existsSync(candidate) ? candidate : null;
}

/** Claude Code and pi replace every non-alphanumeric run with a single dash. */
export function slugifyPath(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, "-");
}

/** The project segment of a Claude Code / pi session path, e.g. `-Users-me-proj`. */
export function sessionSlug(relPath: string | null): string | null {
  return relPath?.match(/^(?:\.claude\/projects|\.pi\/agent\/sessions)\/([^/]+)\//)?.[1] ?? null;
}

/**
 * Resolve a session slug against paths the orchestrator already knows (worktrees).
 * Slugging is lossy, so the match is exact after normalising both sides.
 */
export function projectFromKnownPaths(relPath: string | null, paths: string[]): string | null {
  const slug = sessionSlug(relPath);
  if (!slug) return null;
  const wanted = slug.replace(/^-+|-+$/g, "");
  for (const path of paths) {
    if (slugifyPath(path).replace(/^-+|-+$/g, "") === wanted) return path;
  }
  return null;
}

/** The `# Change` line of an omp assignment, else the first line that is not a heading. */
export function taskSummary(task: string): string | null {
  const lines = task.split("\n").map((line) => line.trim())
    .filter((line) => line && line !== "Complete assignment thoroughly:");
  const change = lines.findIndex((line) => /^#\s*change/i.test(line));
  const ordered = change >= 0 ? [...lines.slice(change + 1), ...lines] : lines;
  return ordered.find((line) => !line.startsWith("#")) ?? null;
}

/**
 * omp records each `task` call's children in the tool result (`details.progress[]`) with the
 * agent name and status. The newest record per child wins; settled children are dropped.
 */
export function parseOmpSubagents(text: string): Array<OmpSubagent & { at: number }> {
  const latest = new Map<string, OmpSubagent & { at: number }>();
  for (const line of text.split("\n")) {
    if (!line.includes('"toolName":"task"') || !line.includes('"progress"')) continue;
    let record: unknown;
    try { record = JSON.parse(line); } catch { continue; }
    const at = Date.parse(String((record as { timestamp?: string })?.timestamp ?? "")) || 0;
    const message = (record as { message?: { role?: string; details?: { progress?: unknown[] } } })?.message;
    if (message?.role !== "toolResult") continue;
    const progress = message.details?.progress;
    if (!Array.isArray(progress)) continue;
    for (const item of progress) {
      const entry = item as { id?: string; agent?: string; status?: string; task?: string };
      if (!entry.id || !entry.agent) continue;
      // `pending` is the spawn record: the child is already running, its result has not landed.
      const state = entry.status === "pending" ? "running" : entry.status ?? "running";
      latest.set(entry.id, {
        id: entry.id,
        agent: entry.agent,
        state,
        task: taskSummary(entry.task ?? ""),
        at,
      });
    }
  }
  const settled = new Set(["completed", "complete", "succeeded", "failed", "cancelled", "aborted", "error"]);
  return [...latest.values()].filter((child) => !settled.has(child.state));
}

/** Children from the eight newest sessions touched in the last ten minutes. */
export async function readOmpSubagents(now = Date.now(), home = HOME): Promise<OmpSubagent[]> {
  const roots = join(home, ".omp/agent/sessions");
  const files: { path: string; mtime: number }[] = [];
  let dirs: Dirent[] = [];
  try { dirs = readdirSync(roots, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return []; }
  for (const dir of dirs) {
    let entries: Dirent[];
    try { entries = readdirSync(join(roots, dir.name), { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const path = join(roots, dir.name, entry.name);
      try {
        const mtime = statSync(path).mtimeMs;
        if (now - mtime <= SUBAGENT_SESSION_WINDOW_MS) files.push({ path, mtime });
      } catch { /* raced with a writer */ }
    }
  }
  // Child ids are local to a parent session, so qualify before merging.
  const merged = new Map<string, OmpSubagent>();
  for (const file of files.sort((a, b) => a.mtime - b.mtime).slice(-8)) {
    try {
      const text = await Bun.file(file.path).text();
      let sessionId = file.path.slice(roots.length + 1);
      try {
        const header = JSON.parse(text.split("\n", 1)[0]);
        if (header.type === "session" && typeof header.id === "string" && header.id) sessionId = header.id;
      } catch { /* A missing header still has a stable, project-qualified file identity. */ }
      // Keep early spawn records even when later parent output exceeds the former tail limit.
      for (const { at, ...child } of parseOmpSubagents(text)) {
        const id = `${sessionId}:${child.id}`;
        merged.set(id, { ...child, id, stale: now - at > SUBAGENT_LIVE_MS });
      }
    } catch { /* unreadable session: skip it */ }
  }
  return [...merged.values()];
}

/** Compact age for evidence text: 12s, 4m, 3h, 9d. */
export function humanAge(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 120) return `${seconds}s`;
  if (seconds < 5_400) return `${Math.round(seconds / 60)}m`;
  if (seconds < 129_600) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86_400)}d`;
}

export interface StoreStamp { path: string; mtime: number }
export type StoreMap = Record<string, StoreStamp | null>;

export function scanStores(def: ToolDef): StoreMap {
  const map: StoreMap = {};
  for (const relative of def.stores) {
    const full = join(HOME, relative);
    map[relative] = newestEntry(full);
  }
  return map;
}

/** A store this recent means the tool produced work in the last two minutes. */
export const WORKING_WINDOW_MS = 120_000;

/**
 * Pure state derivation. `prevCpu` maps pid → cumulative CPU seconds from the
 * previous sample; a process that burned ≥0.15 s since then is working.
 */
export function interpretTools(
  defs: ToolDef[],
  procs: PsRow[],
  stores: Record<string, StoreMap>,
  installed: Record<string, boolean>,
  prevCpu: Map<number, number>,
  now = Date.now(),
): ToolActivity[] {
  return defs.map((def) => {
    const mine = procs.filter((row) => runsTool(row.command, def.bins));
    const cpuActive = mine.some((row) => {
      const before = prevCpu.get(row.pid);
      return before !== undefined && row.cpu - before >= 0.15;
    });

    const stamps = Object.values(stores[def.id] ?? {}).filter((stamp): stamp is StoreStamp => stamp !== null);
    const newest = stamps.sort((a, b) => b.mtime - a.mtime)[0] ?? null;
    const fresh = newest !== null && now - newest.mtime <= WORKING_WINDOW_MS;
    const isInstalled = installed[def.id] === true;

    let state: ToolState;
    let evidence: string;
    if (!isInstalled && mine.length === 0 && stamps.length === 0) {
      state = "offline";
      evidence = "not installed";
    } else if (fresh) {
      state = "working";
      evidence = `${newest!.path.startsWith(HOME) ? newest!.path.slice(HOME.length + 1) : newest!.path} · ${humanAge(now - newest!.mtime)} ago`;
    } else if (cpuActive) {
      state = "working";
      evidence = `pid ${mine.find((row) => (prevCpu.get(row.pid) ?? row.cpu) < row.cpu - 0.15)!.pid} · cpu advancing`;
    } else if (mine.length > 0) {
      state = "idle";
      evidence = `${mine.length} process${mine.length === 1 ? "" : "es"} · no output for ${newest ? humanAge(now - newest.mtime) : "the session"}`;
    } else {
      state = "available";
      evidence = newest ? `last output ${humanAge(now - newest.mtime)} ago` : "installed · no session yet";
    }

    return {
      id: def.id,
      name: def.name,
      kind: def.kind,
      installed: isInstalled,
      state,
      processes: mine.length,
      pids: mine.map((row) => row.pid),
      sessions: [...mine].sort((a, b) => b.pid - a.pid)
        .map(({ pid, command }) => ({ pid, command, cwd: null, model: null })),
      cwd: null,
      model: null,
      cpuActive,
      lastSession: newest ? (newest.path.startsWith(HOME) ? newest.path.slice(HOME.length + 1) : newest.path) : null,
      lastActivity: newest ? new Date(newest.mtime).toISOString() : null,
      evidence,
    };
  });
}

const prevCpu = new Map<number, number>();
const cwdByPid = new Map<number, string | null>();

/** `lsof -a -p <pid> -d cwd -Fn` → the process working directory. */
export function parseLsofCwd(text: string): string | null {
  for (const line of text.split("\n")) {
    if (line.startsWith("n")) return line.slice(1).trim() || null;
  }
  return null;
}

async function cwdFor(pid: number): Promise<string | null> {
  if (cwdByPid.has(pid)) return cwdByPid.get(pid) ?? null;
  let cwd: string | null = null;
  try {
    const proc = Bun.spawn(["lsof", "-a", "-p", String(pid), "-d", "cwd", "-Fn"], { stdout: "pipe", stderr: "ignore" });
    const text = await new Response(proc.stdout).text();
    const timer = setTimeout(() => proc.kill(), 1500);
    await proc.exited;
    clearTimeout(timer);
    cwd = parseLsofCwd(text);
  } catch { /* no lsof: the store path still names the project */ }
  cwdByPid.set(pid, cwd);
  if (cwdByPid.size > 500) cwdByPid.clear();
  return cwd;
}

/** Same project, and only while both sides are live: a settled run is not working there now. */
function matchByPath(views: Array<ToolActivity & { agents: ToolDispatch[] }>, worker: WorkerLite): (ToolActivity & { agents: ToolDispatch[] }) | undefined {
  const path = worker.path?.replace(/\/$/, "");
  if (!path || !isPresent(worker)) return undefined;
  return views.find((view) => view.state === "working" && view.cwd && (view.cwd === path || view.cwd.startsWith(`${path}/`)));
}

/** Attach each present dispatch to the tool its agent names and the role its task names. */
export function joinToolAgents(
  tools: ToolActivity[],
  workers: WorkerLite[],
  roles: string[],
): Array<ToolActivity & { agents: ToolDispatch[] }> {
  const views = tools.map((tool) => ({ ...tool, agents: [] as ToolDispatch[] }));
  const byId = new Map(views.map((view) => [view.id, view]));
  for (const worker of workers) {
    // Pending dispatches remain visible; settled history belongs to run history.
    if (!isPresent(worker)) continue;
    const view = byId.get(toolForAgent(worker.agent) ?? "") ?? matchByPath(views, worker);
    if (!view) continue;
    const text = [worker.taskTitle, worker.taskSpec, worker.label, worker.worktreeName, worker.agent]
      .filter(Boolean).join(" ").toLowerCase();
    view.agents.push({
      dispatchId: worker.dispatchId ?? null,
      agent: worker.agent ?? null,
      model: worker.model ?? null,
      state: worker.workerState ?? worker.dispatchStatus ?? worker.liveness ?? null,
      role: roles.find((name) => text.includes(name.toLowerCase())) ?? null,
      task: worker.taskTitle ?? worker.taskSpec ?? worker.label ?? null,
      worktree: worker.worktreeName ?? null,
    });
  }
  for (const view of views) {
    view.agents.sort((a, b) => Number(b.state === "running") - Number(a.state === "running"));
  }
  return views;
}

/** Live sample: one `ps` spawn, one bounded walk per store, no caching of its own. */
export async function collectToolActivity(now = Date.now()): Promise<ToolActivity[]> {
  let ps = "";
  try {
    const proc = Bun.spawn(["ps", "-axo", "pid=,time=,command="], { stdout: "pipe", stderr: "ignore" });
    ps = await new Response(proc.stdout).text();
    const timer = setTimeout(() => proc.kill(), 3000);
    await proc.exited;
    clearTimeout(timer);
  } catch { /* no process table: stores alone still answer */ }

  const procs = parsePs(ps).filter((row) => row.pid !== process.pid);
  const livePids = new Set(procs.map((row) => row.pid));
  for (const pid of cwdByPid.keys()) if (!livePids.has(pid)) cwdByPid.delete(pid);
  const stores: Record<string, StoreMap> = {};
  for (const def of TOOL_DEFS) stores[def.id] = scanStores(def);

  const installed: Record<string, boolean> = {};
  for (const def of TOOL_DEFS) {
    installed[def.id] = def.bins.some((bin) => Bun.which(bin) !== null)
      || Object.values(stores[def.id]).some((stamp) => stamp !== null);
  }

  const tools = interpretTools(TOOL_DEFS, procs, stores, installed, prevCpu, now);
  const omp = tools.find((tool) => tool.id === "omp");
  if (omp) omp.subagents = await readOmpSubagents(now);
  // Each live pid names its own project; never borrow another session's cwd.
  await Promise.all(tools.map(async (tool) => {
    await Promise.all(tool.sessions.map(async (session) => { session.cwd = await cwdFor(session.pid); }));
    tool.cwd = tool.sessions.length ? tool.sessions[0].cwd : projectFromSession(tool.lastSession);
    tool.model = tool.sessions[0]?.model ?? null;
  }));
  for (const row of procs) prevCpu.set(row.pid, row.cpu);
  for (const pid of prevCpu.keys()) if (!procs.some((row) => row.pid === pid)) prevCpu.delete(pid);
  return tools;
}
