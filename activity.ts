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
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
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

export interface OmpSubagent { id: string; agent: string; state: string; task: string | null; model: string | null; provider: string | null; remaining: number | null; stale?: boolean; cwd?: string | null }

export interface ToolSession {
  pid: number; cwd: string | null; model: string | null; provider: string | null;
  /** Explicit rollout provider, retained when worker-show overrides the model. */
  modelProvider?: string | null;
  current: string | null; remaining: number | null; command: string; state: "working" | "idle"; cpuActive: boolean;
}

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
  /** Identity and work of the newest live session; null without attributable evidence. */
  model: string | null;
  provider: string | null;
  current: string | null;
  remaining: number | null;
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

/** Literal model namespace; never infer a vendor from an executable or role. */
export function providerOf(model: string | null): string | null {
  return model?.includes("/") ? model.split("/", 1)[0] || null : null;
}

/** Known surface providers use the same ids as quotas; model namespaces take precedence. */
export function providerFor(model: string | null, toolOrAgent: string | null | undefined): string | null {
  const providers: Record<string, string> = { "claude-code": "claude", codex: "codex", opencode: "opencode-go", omp: "opencode-go", cursor: "cursor" };
  return providerOf(model) ?? providers[toolForAgent(toolOrAgent) ?? toolOrAgent ?? ""] ?? null;
}

/** ps flattens argv: quotes are literal characters, not shell grouping syntax. */
export function modelFromArgv(command: string): string | null {
  const tokens = command.trim().split(/\s+/);
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] === "--") break;
    const option = tokens[i].match(/^(?:-m|--model)(?:=(.*))?$/);
    if (!option) continue;
    const model = option[1] ?? tokens[i + 1];
    return model && !model.startsWith("-") ? model : null;
  }
  return null;
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
  return script !== undefined && bins.includes(basename(script.replace(/[),;]+$/, "")).replace(/\.(?:js|mjs|cjs)$/, ""));
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

const SETTLED_CHILD = new Set(["completed", "complete", "succeeded", "failed", "cancelled", "aborted", "error"]);
type OmpChildRecord = OmpSubagent & { at: number };
interface OmpParse {
  sessionId: string | null;
  cwd: string | null;
  model: string | null;
  current: string | null;
  remaining: number | null;
  children: Map<string, OmpChildRecord>;
}
const emptyOmpParse = (): OmpParse => ({ sessionId: null, cwd: null, model: null, current: null, remaining: null, children: new Map() });

function ompTodos(details: any): { current: string | null; remaining: number | null } {
  const unknown = { current: null, remaining: null };
  // omp stores the complete todo snapshot in phases, not in its rendered text summary.
  if (!Array.isArray(details?.phases) || details.phases.some((phase: any) => !Array.isArray(phase?.tasks))) return unknown;
  const tasks = details.phases.flatMap((phase: any) => phase.tasks);
  if (tasks.some((task: any) => typeof task?.content !== "string" || typeof task.status !== "string")) return unknown;
  const open = tasks.filter((task: any) => task.status === "pending" || task.status === "in_progress");
  return { current: (open.find((task: any) => task.status === "in_progress") ?? open[0])?.content ?? null, remaining: open.length };
}

/** Last complete todo result in a JSONL tail; absent or unreadable work stays unknown. */
export function parseOmpTodos(text: string): { current: string | null; remaining: number | null } {
  const parsed = emptyOmpParse();
  consumeOmpRecords(text, parsed);
  return { current: parsed.current, remaining: parsed.remaining };
}

/** Returns consumed bytes; an incomplete final JSON record is retried on the next append. */
function consumeOmpRecords(text: string, parsed: OmpParse): number {
  const lines = text.split("\n");
  let consumed = Buffer.byteLength(text);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch {
      if (index === lines.length - 1) consumed -= Buffer.byteLength(line);
      continue;
    }
    if (!record || typeof record !== "object") continue;
    if (record.type === "session") {
      if (typeof record.id === "string" && record.id) parsed.sessionId = record.id;
      if (typeof record.cwd === "string" && record.cwd) parsed.cwd = record.cwd;
    }
    if (record.type === "model_change") {
      parsed.model = typeof record.model === "string" && record.model ? record.model : null;
    }
    if (record.type === "custom_message" && record.customType === "async-result") {
      const content = typeof record.content === "string" ? record.content :
        Array.isArray(record.content) ? record.content.map((part: { text?: string }) => part?.text ?? "").join("\n") : "";
      for (const match of content.matchAll(/<task-result\b([^>]*)>/g)) {
        const attrs = new Map([...match[1].matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map(m => [m[1], m[2]]));
        if (SETTLED_CHILD.has(attrs.get("status") ?? "")) parsed.children.delete(attrs.get("id") ?? "");
      }
    }
    const message = record.message;
    if (message?.role === "toolResult" && message.toolName === "todo" && !message.isError) {
      Object.assign(parsed, ompTodos(message.details));
    }
    if (message?.role !== "toolResult" || message.toolName !== "task" || !Array.isArray(message.details?.progress)) continue;
    const at = Date.parse(String(record.timestamp ?? "")) || 0;
    for (const entry of message.details.progress) {
      if (typeof entry?.id !== "string" || typeof entry.agent !== "string") continue;
      const state = entry.status === "pending" ? "running" : entry.status ?? "running";
      if (SETTLED_CHILD.has(state)) { parsed.children.delete(entry.id); continue; }
      parsed.children.set(entry.id, { id: entry.id, agent: entry.agent, state,
        task: taskSummary(typeof entry.task === "string" ? entry.task : ""),
        model: typeof entry.model === "string" && entry.model ? entry.model : null,
        provider: providerFor(typeof entry.model === "string" ? entry.model : null, "omp"), remaining: null, at });
    }
  }
  return consumed;
}

/** Real omp lifecycle: pending task spawn, then custom_message async-result settlement. */
export function parseOmpSubagents(text: string): OmpChildRecord[] {
  const parsed = emptyOmpParse();
  consumeOmpRecords(text, parsed);
  return [...parsed.children.values()];
}

interface OmpCache { mtime: number; size: number; ino: number; offset: number; parsed: OmpParse }
const ompParses = new Map<string, OmpCache>();

async function readOmpSession(path: string): Promise<OmpParse> {
  const stat = statSync(path);
  const cached = ompParses.get(path);
  if (cached && cached.ino === stat.ino && cached.mtime === stat.mtimeMs && cached.size === stat.size) return cached.parsed;
  // Rewrites/truncations reset the parse; ordinary appends preserve early spawn records.
  const append = cached && cached.ino === stat.ino && stat.size > cached.size;
  const offset = append ? cached.offset : 0;
  const parsed = append ? cached.parsed : emptyOmpParse();
  const text = await Bun.file(path).slice(offset, stat.size).text();
  const consumed = consumeOmpRecords(text, parsed);
  ompParses.set(path, { mtime: stat.mtimeMs, size: stat.size, ino: stat.ino, offset: offset + consumed, parsed });
  return parsed;
}

/** Identity/work is count-bounded to eight newest sessions, not time-bounded; children expire after ten minutes. */
async function readOmpActivity(now: number, home: string): Promise<{ subagents: OmpSubagent[]; sessions: OmpParse[] }> {
  const roots = join(home, ".omp/agent/sessions");
  const files: { path: string; mtime: number }[] = [];
  let dirs: Dirent[] = [];
  try { dirs = readdirSync(roots, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return { subagents: [], sessions: [] }; }
  for (const dir of dirs) {
    let entries: Dirent[];
    try { entries = readdirSync(join(roots, dir.name), { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const path = join(roots, dir.name, entry.name);
      try {
        let mtime = statSync(path).mtimeMs;
        // A long-running child can still write while its parent transcript is quiet.
        const childDir = path.slice(0, -".jsonl".length);
        try {
          for (const child of readdirSync(childDir)) {
            if (!child.endsWith(".jsonl")) continue;
            try { mtime = Math.max(mtime, statSync(join(childDir, child)).mtimeMs); } catch { /* raced */ }
          }
        } catch { /* no child transcripts */ }
        files.push({ path, mtime });
      } catch { /* raced with a writer */ }
    }
  }
  // Child ids are local to a parent session, so qualify before merging.
  const merged = new Map<string, OmpSubagent>();
  const selected = files.sort((a, b) => a.mtime - b.mtime).slice(-8);
  const selectedPaths = new Set(selected.map(file => file.path));
  const sessions: OmpParse[] = [];
  for (const file of selected) {
    try {
      const parsed = await readOmpSession(file.path);
      sessions.push(parsed);
      const sessionId = parsed.sessionId ?? file.path.slice(roots.length + 1);
      for (const { at, ...child } of parsed.children.values()) {
        let lastEvidence = at;
        let detail: OmpParse | null = null;
        // Child ids name files, never arbitrary paths from session content.
        if (basename(child.id) === child.id && child.id !== "." && child.id !== "..") {
          const childPath = join(file.path.slice(0, -6), `${child.id}.jsonl`);
          try {
            lastEvidence = statSync(childPath).mtimeMs;
            selectedPaths.add(childPath);
            detail = await readOmpSession(childPath);
          } catch { /* spawn evidence only */ }
        }
        if (!lastEvidence || now - lastEvidence > SUBAGENT_SESSION_WINDOW_MS) continue;
        const id = `${sessionId}:${child.id}`;
        const model = child.model ?? detail?.model ?? null;
        merged.set(id, { ...child, id, cwd: parsed.cwd, stale: now - lastEvidence > SUBAGENT_LIVE_MS,
          model, provider: providerFor(model, "omp"), task: detail?.current ?? child.task, remaining: detail?.remaining ?? null });
      }
    } catch { /* unreadable session: skip it */ }
  }
  for (const path of ompParses.keys()) if (!selectedPaths.has(path)) ompParses.delete(path);
  return { subagents: [...merged.values()], sessions: sessions.reverse() };
}

/** Children and identity/work share the same incremental session reads. */
export async function readOmpSubagents(now = Date.now(), home = HOME): Promise<OmpSubagent[]> {
  return (await readOmpActivity(now, home)).subagents;
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

export function scanStores(def: ToolDef, home = HOME): StoreMap {
  const map: StoreMap = {};
  for (const relative of def.stores) {
    const full = join(home, relative);
    map[relative] = newestEntry(full);
  }
  return map;
}

interface StoreIdentity { cwd: string | null; model: string | null; provider: string | null }

/** Bounded reads of the transcript already selected by the store scan; no model defaults. */
async function readStoreIdentity(toolId: string, stores: StoreMap): Promise<StoreIdentity | null> {
  const stamp = stores[toolId === "codex" ? ".codex/sessions" : ".claude/projects"];
  if (!stamp?.path.endsWith(".jsonl")) return null;
  try {
    const file = Bun.file(stamp.path);
    // Codex metadata is at the front (and can contain long instructions); Claude models
    // are in assistant messages, so inspect its recent output instead.
    const text = await (toolId === "codex" ? file.slice(0, 1024 * 1024) : file.slice(Math.max(0, file.size - 128 * 1024))).text();
    const identity: StoreIdentity = { cwd: null, model: null, provider: null };
    const string = (value: unknown) => typeof value === "string" && value ? value : null;
    for (const line of text.split("\n")) {
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      if (toolId === "codex") {
        if (record?.type !== "session_meta") continue;
        return { cwd: string(record.payload?.cwd), model: string(record.payload?.model), provider: string(record.payload?.model_provider) };
      }
      identity.cwd = string(record?.cwd) ?? identity.cwd;
      if (record?.type === "assistant" && record.message?.role === "assistant") {
        identity.model = string(record.message.model) ?? identity.model;
      }
    }
    return identity;
  } catch { return null; }
}

/** Cache path resolution within a sample, including macOS /private aliases that no longer exist. */
function pathNormalizer(): (path: string | null) => string | null {
  const cache = new Map<string, string>();
  return path => {
    if (!path) return null;
    if (cache.has(path)) return cache.get(path)!;
    let normalized = path;
    try { normalized = realpathSync(path); } catch { /* session directories may have been removed */ }
    if (process.platform === "darwin") normalized = normalized.replace(/^\/private(?=\/)/, "");
    normalized = normalized.replace(/\/$/, "") || "/";
    cache.set(path, normalized);
    return normalized;
  };
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
    const mine = procs.filter((row) => runsTool(row.command, def.bins)
      && !(def.id === "omp" && /(?:^|\s)__omp_worker_\S*/.test(row.command)));
    const active = (row: PsRow) => {
      const before = prevCpu.get(row.pid);
      return before !== undefined && row.cpu - before >= 0.15;
    };
    const cpuActive = mine.some(active);

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
      evidence = `pid ${mine.find(active)!.pid} · cpu advancing`;
    } else if (mine.length > 0) {
      state = "idle";
      evidence = `${mine.length} process${mine.length === 1 ? "" : "es"} · no output for ${newest ? humanAge(now - newest.mtime) : "the session"}`;
    } else {
      state = "available";
      evidence = newest ? `last output ${humanAge(now - newest.mtime)} ago` : "installed · no session yet";
    }

    const sessions: ToolSession[] = [...mine].sort((a, b) => b.pid - a.pid).map(row => {
      const cpuActive = active(row);
      // A sole session inherits tool evidence. Store stamps have no pid identity,
      // so multiple sessions must use their own CPU deltas, not shared freshness.
      const working = mine.length === 1 ? state === "working" : cpuActive;
      const model = modelFromArgv(row.command);
      return { pid: row.pid, command: row.command, cwd: null, model, provider: providerFor(model, def.id), current: null, remaining: null,
        cpuActive, state: working ? "working" : "idle" };
    });
    return {
      id: def.id,
      name: def.name,
      kind: def.kind,
      installed: isInstalled,
      state,
      processes: mine.length,
      pids: mine.map((row) => row.pid),
      sessions,
      cwd: null,
      model: sessions[0]?.model ?? null,
      provider: sessions[0]?.provider ?? null,
      current: null,
      remaining: null,
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

/** Live sample: fresh ps/store scans, with cached prior CPU, per-pid cwd and incremental omp parses. */
export async function collectToolActivity(now = Date.now(), home = HOME): Promise<ToolActivity[]> {
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
  for (const def of TOOL_DEFS) stores[def.id] = scanStores(def, home);

  const installed: Record<string, boolean> = {};
  for (const def of TOOL_DEFS) {
    installed[def.id] = def.bins.some((bin) => Bun.which(bin) !== null)
      || Object.values(stores[def.id]).some((stamp) => stamp !== null);
  }

  const tools = interpretTools(TOOL_DEFS, procs, stores, installed, prevCpu, now);
  const omp = tools.find((tool) => tool.id === "omp");
  const ompActivity = omp ? await readOmpActivity(now, home) : null;
  if (omp && ompActivity) omp.subagents = ompActivity.subagents;
  const normalizePath = pathNormalizer();
  // Each live pid names its own project; never borrow another session's cwd.
  await Promise.all(tools.map(async (tool) => {
    await Promise.all(tool.sessions.map(async (session) => { session.cwd = await cwdFor(session.pid); }));
    if (tool.id === "omp" && ompActivity) {
      for (const session of tool.sessions) {
        const cwd = normalizePath(session.cwd);
        if (!cwd || tool.sessions.filter(s => normalizePath(s.cwd) === cwd).length !== 1) continue;
        const detail = ompActivity.sessions.find(s => normalizePath(s.cwd) === cwd);
        session.model ??= detail?.model ?? null;
        session.provider = providerFor(session.model, tool.id);
        session.current = detail?.current ?? null;
        session.remaining = detail?.remaining ?? null;
      }
    }
    const identity = tool.id === "codex" || tool.id === "claude-code" ? await readStoreIdentity(tool.id, stores[tool.id]) : null;
    if (identity?.cwd) {
      const matches = tool.sessions.filter(session => normalizePath(session.cwd) === normalizePath(identity.cwd));
      if (matches.length === 1) {
        matches[0].model ??= identity.model;
        if (identity.provider) matches[0].modelProvider = identity.provider;
        matches[0].provider = identity.provider ?? providerFor(matches[0].model, tool.id);
      }
    }
    tool.cwd = tool.sessions.length ? tool.sessions[0].cwd : identity?.cwd ?? projectFromSession(tool.lastSession);
    tool.model = tool.sessions.length ? tool.sessions[0].model : identity?.model ?? null;
    tool.provider = tool.sessions.length ? tool.sessions[0].provider : identity?.provider ?? providerFor(tool.model, tool.id);
    tool.current = tool.sessions[0]?.current ?? null;
    tool.remaining = tool.sessions[0]?.remaining ?? null;
  }));
  for (const row of procs) prevCpu.set(row.pid, row.cpu);
  for (const pid of prevCpu.keys()) if (!procs.some((row) => row.pid === pid)) prevCpu.delete(pid);
  return tools;
}
