const details = {
  state: { eyebrow: 'STATE PLANE', title: '/state collector', body: 'One shared read of every source, cached for 1.5 seconds. Concurrent clients join the same in-flight promise, so several tabs do not queue seven CLI processes each.', facts: [['Reads', 'Paseo, Orca, Hermes, CCGS, Magpie'], ['Exposes', '/state · /worker/:id'], ['Boundary', 'Allowlisted clients only']], href: '/' },
  paseo: { eyebrow: 'DATA PLANE · AGENTS', title: 'Paseo', body: 'Live agent sessions from `paseo ls --json`. The collector maps provider, thinking level, status and working directory into the same read-only state the HUD consumes.', facts: [['Source', 'paseo ls --json'], ['Feeds', 'Agents panel · roster'], ['Mode', 'read-only']], href: '/' },
  orca: { eyebrow: 'DATA PLANE · WORKERS', title: 'Orca', body: 'Supervised workers, task specs, terminal state and worktrees. Orca is the dispatch plane: worker-list establishes the floor, task-list binds tasks to roles, and worker-show fills in the launched agent.', facts: [['Sources', 'worker-list · task-list · worker-show'], ['Scope', 'newest live run'], ['Feeds', 'Floor · live work']], href: '/floor' },
  hermes: { eyebrow: 'DATA PLANE · TASKS', title: 'Hermes', body: 'The persistent kanban fallback when Orca has no task list. Hermes keeps the task board useful even when the orchestration plane is idle.', facts: [['Source', 'hermes kanban list'], ['Feeds', 'Task board'], ['Mode', 'fallback']], href: '/' },
  audit: { eyebrow: 'DATA PLANE · ACTIVITY', title: 'CCGS audit', body: 'The CCGS SubagentStart/Stop log. Invoked and completed events give each roster role evidence and a timestamp; the status rules never infer activity from a role name alone.', facts: [['Source', 'agent-audit.log'], ['Feeds', 'Roster · status evidence'], ['Window', '30 min completion']], href: '/' },
  magpie: { eyebrow: 'DATA PLANE · QUOTAS', title: 'Magpie', body: 'Local quota windows for each provider. The collector makes one local HTTP read and normalizes used/remaining/reset fields for the quota rail.', facts: [['Source', '127.0.0.1:3425'], ['Feeds', 'Quota bars'], ['Mode', 'read-only']], href: '/' },
  hud: { eyebrow: 'EXPERIENCE PLANE', title: 'Command HUD', body: 'The overview shell: roster, task lanes, active roles, live events, quota and the selected agent. It reads the same `/state` snapshot as every other view.', facts: [['View', '/'], ['State', 'shared /state'], ['Focus', 'overview']], href: '/' },
  floor: { eyebrow: 'EXPERIENCE PLANE', title: 'Studio Floor', body: 'The spatial three.js view of the same state. Orbit, zoom, select a character or focus a floor; the live work sidebar tails the selected worker.', facts: [['View', '/floor'], ['Renderer', 'three.js'], ['Focus', 'spatial']], href: '/floor' },
  mobile: { eyebrow: 'EXPERIENCE PLANE', title: 'Mobile', body: 'A phone-first 390×844 single screen: quotas, worker counts, active agents and rooms, with no page scroll.', facts: [['View', '/mobile'], ['Viewport', '390 × 844'], ['Focus', 'glanceable']], href: '/mobile' },
  anatomy: { eyebrow: 'EXPERIENCE PLANE', title: 'Anatomy', body: 'This cutaway. It is deliberately a map, not a dashboard: sources, collector and views in one plane so new contributors can see where a field enters the system.', facts: [['View', '/anatomy'], ['Shape', 'isometric'], ['Focus', 'system']], href: '/anatomy' },
  blender: { eyebrow: 'OPTIONAL · 3D PIPELINE', title: 'Blender asset kit', body: 'The optional modelling path: an agent drives Blender through MCP, applies production skills for UVs, baking and glTF export, then the studio can load the kit with a procedural fallback. The live app never depends on Blender.', facts: [['Path', 'Blender → GLB → three.js'], ['Skill', 'blender-skills'], ['Fallback', 'procedural meshes']], href: 'https://github.com/VincentNo5/agent-studio/blob/main/docs/BLENDER-PIPELINE.md' }
};
const nodes = [...document.querySelectorAll('.node')];
const title = document.getElementById('inspector-title');
const eyebrow = document.getElementById('inspector-eyebrow');
const body = document.getElementById('inspector-body');
const facts = document.getElementById('inspector-facts');
const link = document.getElementById('inspector-link');
function select(key) {
  const d = details[key]; if (!d) return;
  nodes.forEach(n => { const on = n.dataset.key === key; n.classList.toggle('selected', on); n.setAttribute('aria-pressed', String(on)); });
  eyebrow.textContent = d.eyebrow; title.textContent = d.title; body.textContent = d.body;
  facts.innerHTML = d.facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  link.href = d.href; link.textContent = d.href === '/docs/BLENDER-PIPELINE.md' ? 'Open pipeline notes ↗' : 'Open related view ↗';
}
nodes.forEach(n => {
  n.addEventListener('click', () => select(n.dataset.key));
  n.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(n.dataset.key); } });
});
select('state');
fetch('/state').then(r => r.json()).then(s => {
  const count = (s.workers?.length ?? 0) + (s.agents?.length ?? 0);
  const metric = document.querySelector('[data-live="state"]');
  if (metric) metric.textContent = `${s.workers?.length ?? 0} workers · ${s.agents?.length ?? 0} agents`;
  const live = document.querySelector('.live-pill');
  if (live) live.title = `${count} live records in the current state snapshot`;
}).catch(() => {});
