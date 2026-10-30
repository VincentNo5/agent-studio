import { agentStatuses, workerStatus, countStatuses, STATUS_META, STATUS_ORDER, COMPLETED_WINDOW_MS, isWorking, matchesRole, taskBoard, getJSON, outputBlocks, ROOM_COLORS, hash } from './studio-data.js';
const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls)
    n.className = cls; if (text != null)
    n.textContent = String(text); return n; };
const button = (text, fn, cls = '') => { const b = el('button', cls, text); b.type = 'button'; b.onclick = fn; return b; };
const time = value => { if (!value)
    return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
const date = value => { if (!value)
    return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString(); };
const clock = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' }); };
// Every status is shape + label + colour, never colour alone.
const ICONS = {
    working: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-opacity=".28" stroke-width="2"/><path d="M8 2.4a5.6 5.6 0 0 1 5.6 5.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    completed: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.4 8.6l3 3 6.2-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    pending: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.5h7M4.5 13.5h7M5.4 2.5c0 3.2 5.2 3 5.2 5.5s-5.2 2.3-5.2 5.5M10.6 2.5c0 3.2-5.2 3-5.2 5.5s5.2 2.3 5.2 5.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    failed: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2l6.3 11.3H1.7z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 6.4v3.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="11.7" r="1" fill="currentColor"/></svg>',
    idle: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4.4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>'
};
const meta = status => STATUS_META[status] || STATUS_META.idle;
const icon = status => `<i class="ico" data-status="${status}">${ICONS[status] || ICONS.idle}</i>`;
function chip(status, text = meta(status).label, cls = 'chip') {
    const c = el('span', cls);
    c.dataset.status = status;
    c.style.setProperty('--s', meta(status).color);
    c.innerHTML = icon(status);
    c.append(text);
    return c;
}
const LANE_STATUS = { running: 'working', dispatched: 'working', review: 'working', pending: 'pending', ready: 'pending', scheduled: 'pending', blocked: 'failed', failed: 'failed', completed: 'completed', done: 'completed' };
function portrait(id, room = 'lobby', visitor = false) {
    const h = hash(id + room);
    const hex = (ROOM_COLORS[room] || 0x54d9fa).toString(16).padStart(6, '0');
    const color = `#${hex}`;
    const skin = ['#f4d0ae', '#e3b18b', '#c08563', '#95633f'][h % 4];
    const hair = ['#1a1e27', '#3a2822', '#6d4a33', '#b07b45', '#d9b47e', '#27354d', '#5c3450'][h % 7];
    const style = h % 5;
    const glasses = !visitor && (['engineering', 'engines', 'qa'].includes(room) || (room === 'directors' && h % 2 === 0));
    const phones = !visitor && ['audio', 'narrative', 'community'].includes(room);
    const beret = !visitor && ['design', 'art'].includes(room) && style !== 3;
    const cap = !visitor && (room === 'community' || (room === 'art' && style === 3));
    const tie = !visitor && ['directors', 'leads'].includes(room);
    const locks = !visitor && (style === 1 || style === 4)
        ? `<rect x="25" y="52" width="8" height="${style === 4 ? 46 : 30}" rx="4" fill="${hair}"/><rect x="87" y="52" width="8" height="${style === 4 ? 46 : 30}" rx="4" fill="${hair}"/>`
        : '';
    const pony = !visitor && style === 2 ? `<ellipse cx="60" cy="31" rx="10" ry="13" fill="${hair}"/><rect x="53" y="38" width="14" height="5" rx="2.5" fill="${color}"/>` : '';
    const bun = !visitor && style === 3 ? `<circle cx="60" cy="22" r="11" fill="${hair}"/>` : '';
    const face = visitor ? `
      <ellipse cx="60" cy="55" rx="30" ry="29" fill="#e9f4fa"/>
      <rect x="34" y="45" width="52" height="19" rx="9.5" fill="#111a24"/>
      <circle cx="50" cy="54.5" r="3.6" fill="${color}"/><circle cx="70" cy="54.5" r="3.6" fill="${color}"/>
      <rect x="58" y="17" width="4" height="13" rx="2" fill="#111a24"/><circle cx="60" cy="15" r="4" fill="${color}"/>
      <rect x="26" y="51" width="8" height="18" rx="4" fill="${color}"/><rect x="86" y="51" width="8" height="18" rx="4" fill="${color}"/>
      <rect x="37" y="76" width="46" height="4" rx="2" fill="#cfe4ee" opacity=".65"/>` : `
      <ellipse cx="60" cy="58" rx="31" ry="32" fill="${skin}"/>
      ${pony}${bun}
      <path d="M29 58c1-21 14-35 31-35s30 14 31 35c-4-12-10-18-18-19-7 6-18 8-29 6-9-2-12 3-15 13z" fill="${hair}"/>
      ${locks}
      <circle cx="49.5" cy="62" r="3.5" fill="#111a24"/><circle cx="70.5" cy="62" r="3.5" fill="#111a24"/>
      <circle cx="50.7" cy="60.8" r="1.1" fill="#fff"/><circle cx="71.7" cy="60.8" r="1.1" fill="#fff"/>
      <ellipse cx="38" cy="71" rx="6" ry="3" fill="#ff9fa6" opacity=".32"/><ellipse cx="82" cy="71" rx="6" ry="3" fill="#ff9fa6" opacity=".32"/>
      <path d="M55 75q5 5 10 0" fill="none" stroke="#7c4b3e" stroke-width="2" stroke-linecap="round"/>
      ${glasses ? `<g fill="none" stroke="#111a24" stroke-width="2"><rect x="42" y="55" width="15" height="13" rx="4"/><rect x="63" y="55" width="15" height="13" rx="4"/><path d="M57 60h6M42 59h-8M78 59h8"/></g>` : ''}
      ${phones ? `<path d="M30 57a30 30 0 0 1 60 0" fill="none" stroke="${color}" stroke-width="4"/><rect x="23" y="51" width="10" height="19" rx="5" fill="${color}"/><rect x="87" y="51" width="10" height="19" rx="5" fill="${color}"/>` : ''}
      ${beret ? `<g transform="rotate(-8 58 37)"><ellipse cx="58" cy="37" rx="31" ry="12" fill="${color}"/><rect x="55" y="22" width="6" height="8" rx="3" fill="${color}"/></g>` : ''}
      ${cap ? `<path d="M31 52a29 29 0 0 1 58 0z" fill="${color}"/><rect x="27" y="49" width="32" height="6" rx="3" fill="${color}"/><rect x="31" y="46" width="58" height="5" rx="2.5" fill="${color}"/>` : ''}
      ${tie ? `<path d="M48 100l12 12 12-12" fill="none" stroke="#e8f2f8" stroke-width="3"/><path d="M57 105h6l3 24-6 7-6-7z" fill="#e9b978"/>` : ''}`;
    return `<svg viewBox="0 0 120 140" role="img" aria-label="${id} agent portrait">
      <ellipse cx="60" cy="134" rx="37" ry="7" fill="#000" opacity=".3"/>
      <path d="M17 140c0-27 19-43 43-43s43 16 43 43z" fill="${visitor ? '#e9f4fa' : color}"/>
      ${visitor ? `<rect x="36" y="114" width="48" height="5" rx="2.5" fill="${color}"/><circle cx="60" cy="106" r="5" fill="${color}"/>` : `<path d="M46 99l14 13 14-13" fill="none" stroke="#dfeef7" stroke-opacity=".8" stroke-width="3"/><rect x="42" y="118" width="36" height="20" rx="3" fill="#0c1e2c" stroke="${color}" stroke-opacity=".7"/><rect x="47" y="123" width="26" height="2" rx="1" fill="${color}" opacity=".8"/><rect x="47" y="128" width="18" height="2" rx="1" fill="${color}" opacity=".5"/>`}
      ${face}
    </svg>`;
}
const isFloor = document.body.dataset.view === 'floor';
const metric = (status, key, label) => `<div class="metric" data-status="${status}" style="--s:${meta(status).color}"><span class="metric-label">${icon(status)}${label}</span><b id="metric-${key}">—</b><small id="metric-${key}-sub">&nbsp;</small></div>`;
$('hud').innerHTML = `
<header class="topbar">
 <a class="brand" href="/" aria-label="Agent Studio overview"><div class="brand-mark">⬡</div><div><h1>Agent Studio</h1><p>AI agent command center</p></div></a>
 <button class="connection" id="connection" data-state="loading" title="Retry connection"><strong id="connection-label">Connecting</strong><small id="clock">Awaiting state</small></button>
 <div class="metrics">${metric('working', 'working', 'Working agents')}${metric('completed', 'completed', 'Completed')}${metric('pending', 'pending', 'Pending / blocked')}<div class="metric" data-status="tasks"><span class="metric-label"><i class="ico">☷</i><span id="metric-board-label">Tasks</span></span><b id="metric-tasks">—</b><small id="metric-tasks-sub">&nbsp;</small></div></div>
 <ul class="legend" aria-label="Status legend">${STATUS_ORDER.map(s => `<li style="--s:${meta(s).color}" title="${meta(s).description}">${icon(s)}${meta(s).label}</li>`).join('')}</ul>
 <nav class="floor-switch" aria-label="Campus view"><button data-floor="0" aria-pressed="true">Campus</button></nav>
 <button class="settings-button" id="settings" aria-label="Rendering settings" title="Rendering settings">⚙</button>
</header>
<div class="world-heading"><div class="eyebrow">Headquarters · live spatial view</div><h2 id="world-title">ONE STUDIO. EVERY AGENT.</h2><p id="world-subtitle">One open campus. Every team on the same floor.</p></div>
<nav class="view-links" aria-label="Studio view"><a href="/" ${!isFloor ? 'aria-current="page"' : ''}>Command overview</a><a href="/floor" ${isFloor ? 'aria-current="page"' : ''}>Floor view ↗</a><a href="/anatomy">Anatomy ↗</a></nav>
<aside class="left-column" aria-label="Agent status, task board and operations">
 <section class="panel agent-status" aria-labelledby="agent-status-title"><div class="panel-head"><h2 id="agent-status-title">Agent status</h2><small id="status-total">—</small></div>
  <div class="status-strip">${['working', 'completed', 'idle'].map(s => `<div style="--s:${meta(s).color}" data-status="${s}"><b>${icon(s)}<span id="count-${s}">—</span></b><span>${meta(s).label}</span></div>`).join('')}</div>
  <div class="status-groups" id="status-groups"><p class="empty">Awaiting state.</p></div>
 </section>
 <section class="panel task-board"><div class="panel-head"><h2>Task board</h2><small id="board-total">—</small></div><p class="board-source" id="board-source">Awaiting state</p><div class="board-progress" id="board-progress" hidden><i></i></div><div class="lanes" id="lanes"></div></section>
 <nav class="panel operations" aria-label="Operations">${[['history', '◷', 'Run history'], ['roster', '◈', 'Roster'], ['audit', '⌁', 'Audit'], ['quotas', '◴', 'Quotas'], ['paseo', '◇', 'Paseo'], ['tasks', '☷', 'All tasks']].map(([k, i, t]) => `<button data-panel="${k}" title="${t}" aria-label="${t}"><span>${i}</span><em>${t}</em></button>`).join('')}</nav>
</aside>
<aside class="right-column" aria-label="Agent inspection">
 <section class="panel detail"><div class="panel-head"><h2>Agent detail</h2><button id="clear-selection" class="icon-button" aria-label="Clear agent selection">×</button></div><div id="detail-body" class="detail-body"></div></section>
 <section class="panel live-work"><div class="panel-head"><h2>Live work</h2><small id="run-tag">—</small></div><p id="run-objective" class="run-objective">Awaiting orchestration state.</p><div id="worker-list" class="worker-list"></div><pre id="live-tail" class="live-tail" hidden></pre></section>
</aside>
<div class="scene-hint">Drag to orbit <span>·</span> scroll to zoom <span>·</span> select an agent</div>
<nav class="panel navigator" aria-label="Campus navigator"><div class="mini-tower"><button data-floor="0" aria-label="Campus overview">◎</button></div><div class="nav-floors"><button data-floor="0" aria-pressed="true"><small>◈</small><span class="nav-name">Campus</span><span class="floor-badges" data-floor-badges="0"></span></button></div></nav>
<section class="panel events"><div class="panel-head"><h2>Live events</h2><button data-panel="audit" class="link-button">Audit trail ↗</button></div><div class="event-list" id="events"><p class="empty">Awaiting audit events.</p></div></section>
<section class="panel preferences" id="preferences" aria-label="Rendering preferences"><label class="toggle-row" for="particles">Particle effects<input type="checkbox" id="particles" checked></label><label class="toggle-row" for="role-labels">Role labels<input type="checkbox" id="role-labels" checked></label><label class="toggle-row" for="low-performance">Low performance mode<input type="checkbox" id="low-performance"></label><div class="performance"><button id="reset-camera">↺ Reset camera</button><output id="fps">— FPS</output></div></section>
<footer class="ticker"><strong>Activity</strong><span id="ticker-text">Awaiting observed state changes.</span><span class="scope" id="scope">Read-only telemetry</span></footer>`;
const dialog = el('dialog');
dialog.setAttribute('aria-labelledby', 'dialog-title');
dialog.innerHTML = '<div class="dialog-header"><h2 id="dialog-title"></h2><div class="dialog-actions"><button id="dialog-refresh" aria-label="Refresh panel">↻ Refresh</button><button id="dialog-close" aria-label="Close panel">×</button></div></div><div id="dialog-content" class="dialog-content"></div>';
document.body.append(dialog);
let world = null, state = null, roster = { rooms: [], agents: [] }, rosterLoaded = false, selected = null, statuses = new Map(), board = null, pickedWorker = null, follow = true, currentPanel = null, selectedLane = null;
let pollTimer = null, outputTimer = null, clockTimer = null, loading = false, closed = false, logId = null, logGeneration = 0, outputBusy = false, outputCache = null, previous = null, transitions = [];
let stateError = null, rosterError = null, lastSuccess = null;
const floorNames = ['ONE CAMPUS. EVERY TEAM.'];
function floorChanged(f) { document.querySelectorAll('[data-floor]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.floor) === 0))); $('world-title').textContent = floorNames[0]; $('world-subtitle').textContent = 'One open campus. Every team on the same floor.'; }
function focusFloor(f) { world?.focusFloor(); floorChanged(0); }
document.querySelectorAll('[data-floor]').forEach(b => b.onclick = () => focusFloor(Number(b.dataset.floor)));
document.querySelectorAll('[data-panel]').forEach(b => b.onclick = () => openPanel(b.dataset.panel));
$('clear-selection').onclick = () => { selected = null; world?.select(null, false); renderDetail(); };
$('reset-camera').onclick = () => { world?.reset(); floorChanged(0); };
$('settings').onclick = () => openPanel('settings');
function savePreference(key, val) { try {
    localStorage.setItem(`studio-${key}`, String(val));
}
catch { } }
function preference(key, fallback) { try {
    const v = localStorage.getItem(`studio-${key}`);
    return v === null ? fallback : v === 'true';
}
catch {
    return fallback;
} }
$('particles').checked = preference('particles', true);
$('role-labels').checked = preference('role-labels', true);
$('low-performance').checked = preference('low', false);
$('particles').onchange = () => { world?.setParticles($('particles').checked); savePreference('particles', $('particles').checked); };
$('role-labels').onchange = () => { world?.setRoleLabels($('role-labels').checked); savePreference('role-labels', $('role-labels').checked); };
$('low-performance').onchange = () => { world?.setLow($('low-performance').checked); savePreference('low', $('low-performance').checked); };
$('dialog-refresh').onclick = () => { if (currentPanel === 'logs')
    refreshOutput();
else
    renderPanel(); };
$('dialog-close').onclick = () => dialog.close();
dialog.addEventListener('click', e => { if (e.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        dialog.close();
} });
dialog.addEventListener('close', () => { currentPanel = null; logId = null; logGeneration++; });
$('connection').onclick = () => poll();
function connection() { const err = stateError || rosterError; const stale = state && Date.now() - Number(state.ts) > 10000; $('connection').dataset.state = err ? 'error' : stale ? 'loading' : state ? 'ok' : 'loading'; $('connection-label').textContent = err ? 'Link error · retry' : stale ? 'State is stale · retry' : state ? 'State connected' : 'Connecting'; $('connection').title = err ? `${err}. Click to retry.${lastSuccess ? ' Last success: ' + date(lastSuccess) : ''}` : state ? `State snapshot: ${date(state.ts)}. Click to refresh.` : 'Connecting to /state and /roster.json'; $('clock').textContent = new Date().toLocaleDateString('en-CA') + ' ' + time(Date.now()); }
// Display name for a status-map key: a roster role, or an Orca dispatch on the floor.
function agentName(id, entry) {
    if (!id.startsWith('worker:'))
        return id;
    const w = entry?.worker || findWorker(id.slice(7));
    return w?.label || w?.taskTitle || `${w?.agent || 'Orca worker'} · ${id.slice(7, 17)}${id.length > 17 ? '…' : ''}`;
}
function statusOf(id) {
    if (statuses.has(id))
        return statuses.get(id);
    const w = id.startsWith('worker:') ? findWorker(id.slice(7)) : null;
    return w ? { ...workerStatus(w), worker: w, task: w.taskTitle || w.label || null, since: null, lastEvent: null } : null;
}
function renderDetail() {
    const box = $('detail-body');
    box.replaceChildren();
    document.querySelector('.detail').scrollTop = 0;
    if (!selected) {
        const empty = el('div', 'detail-empty');
        const cast = [['ai-programmer', 'engineering'], ['engine-programmer', 'engineering'], ['gameplay-programmer', 'engineering']].map(([n, r]) => portrait(n, r)).join('');
        empty.innerHTML = `<div class="empty-cast">${cast}</div><h3>Select an agent</h3><p>Choose a character in the headquarters, or a row in Agent status, to inspect its work.</p>`;
        empty.append(button('Explore studio roster ↗', () => openPanel('roster'), 'wide'));
        box.append(empty);
        return;
    }
    const role = roster.agents.find(a => a.name === selected), entry = state ? statusOf(selected) : null;
    const worker = selected.startsWith('worker:') ? findWorker(selected.slice(7)) : entry?.worker || ((state?.workers || []).find(w => isWorking(w) && role && matchesRole(w, role)) || (state?.workers || []).find(w => role && matchesRole(w, role)));
    if (!role && !worker) {
        box.append(el('p', 'empty', 'This dispatch is no longer available in the current state. It may still be in run history.'));
        return;
    }
    const status = entry?.status || 'idle', name = role?.name || agentName(selected, entry), room = role?.room || 'lobby';
    // The status pill leads the panel: icon + label + colour, then the evidence behind it.
    const pill = chip(status, state ? meta(status).label : 'Awaiting state', 'status-pill');
    if (entry?.since)
        pill.append(el('time', null, status === 'completed' ? `at ${clock(entry.since)}` : `since ${clock(entry.since)}`));
    pill.title = meta(status).description;
    box.append(pill);
    const head = el('div', 'detail-head');
    const avatar = el('div', 'detail-avatar');
    avatar.innerHTML = portrait(name, room, selected.startsWith('worker:'));
    avatar.style.setProperty('--avatar', `#${(ROOM_COLORS[room] || 0x54d9fa).toString(16).padStart(6, '0')}`);
    avatar.style.setProperty('--s', meta(status).color);
    avatar.dataset.status = status;
    const who = el('div');
    who.append(el('h3', 'agent-name', name), el('div', 'department', `${room[0].toUpperCase()}${room.slice(1)} · Campus${worker?.agent ? ' · ' + worker.agent : ''}`));
    head.append(avatar, who);
    box.append(head);
    if (role?.desc)
        box.append(el('p', 'description', role.desc));
    const evidence = el('section', 'detail-section');
    const proof = el('dl', 'fields');
    const facts = [['Evidence', entry?.evidence || (state ? 'No current work reported' : null)], ['Since', entry?.since ? date(entry.since) : null], ['Last audit', entry?.lastEvent ? `${entry.lastEvent.kind} · ${clock(entry.lastEvent.ts)}` : null]];
    for (const [key, value] of facts)
        if (value)
            proof.append(el('dt', null, key), el('dd', null, value));
    evidence.append(el('h3', null, 'Status evidence'), proof);
    box.append(evidence);
    const section = el('section', 'detail-section');
    section.append(el('h3', null, 'Current task'), el('p', null, entry?.task || worker?.taskTitle || worker?.label || (status === 'working' ? 'Active in audit; task is not provided.' : 'No associated task reported.')));
    box.append(section);
    const details = el('section', 'detail-section'), dl = el('dl', 'fields');
    const events = (state?.audit?.events || []).filter(e => role ? e.agent === role.name : e.agent === worker?.agent);
    const lastInvoke = events.filter(e => e.kind === 'invoked').at(-1);
    const fields = [['Stage', worker?.workerState], ['Dispatch', worker?.dispatchStatus], ['Model', worker?.model || role?.model], ['Agent', worker?.agent], ['Liveness', worker?.liveness], ['Reason', worker?.livenessReason], ['Next action', worker?.nextAction], ['Terminal', worker?.terminalState], ['Host', worker?.host], ['Last invoked', lastInvoke ? date(lastInvoke.ts) : null]];
    for (const [key, value] of fields)
        if (value) {
            dl.append(el('dt', null, key), el('dd', null, value === 'inherit' ? 'Inherited (roster)' : value));
        }
    if (dl.children.length) {
        details.append(el('h3', null, 'Reported fields'), dl);
        box.append(details);
    }
    const recent = el('section', 'detail-section');
    recent.append(el('h3', null, 'Recent audit events'));
    const list = el('div', 'detail-events');
    if (!events.length)
        list.append(el('p', null, 'No matching audit events.'));
    for (const e of events.slice(-4).reverse()) {
        const row = el('div');
        row.append(el('time', null, time(e.ts)), chip(e.kind === 'completed' ? 'completed' : 'working', e.kind));
        list.append(row);
    }
    recent.append(list);
    box.append(recent);
    if (worker?.dispatchId)
        box.append(button('View full logs ↗', () => openLogs(worker.dispatchId), 'wide'));
    else
        box.append(el('p', 'department', 'No dispatch is associated with this role.'));
}
function findWorker(id) { return state?.workers?.find(w => w.dispatchId === id) || state?.runs?.flatMap(r => r.workers || []).find(w => w.dispatchId === id); }
function selectAgent(id, focus = true) { selected = id; world?.select(id, focus); if (id.startsWith('worker:')) {
    pickedWorker = id.slice(7);
    follow = false;
    outputCache = null;
    refreshOutput();
} renderDetail(); renderWorkers(); }
function renderBoard() {
    if (!board)
        return;
    const doneLane = board.source === 'Orca' ? 'completed' : 'done', done = board.counts[doneLane] || 0;
    $('board-source').textContent = `${board.source} · ${board.total} tasks`;
    $('board-total').textContent = board.total ? `${done} / ${board.total} done` : '0 tasks';
    $('board-progress').hidden = !board.total;
    $('board-progress').firstChild.style.width = `${board.total ? done / board.total * 100 : 0}%`;
    $('board-progress').title = `${done} of ${board.total} tasks completed`;
    const box = $('lanes');
    const existing = new Map([...box.children].map(b => [b.dataset.lane, b]));
    const max = Math.max(1, ...Object.values(board.counts));
    for (const lane of board.lanes) {
        let b = existing.get(lane);
        const status = LANE_STATUS[lane];
        if (!b) {
            b = button('', () => { selectedLane = selectedLane === lane ? null : lane; highlightLane(); renderBoard(); openPanel('tasks'); }, 'lane');
            b.dataset.lane = lane;
            const glyph = el('span', 'lane-icon');
            glyph.innerHTML = status ? icon(status) : '<i class="ico">◈</i>';
            b.append(glyph, el('span', 'lane-name', lane), el('b'));
            const meter = el('span', 'lane-meter');
            meter.append(el('i'));
            b.append(meter);
        }
        b.style.setProperty('--lane', status ? meta(status).color : '#8aa6bd');
        b.classList.toggle('done-lane', status === 'completed');
        b.classList.toggle('empty-lane', !board.counts[lane]);
        b.querySelector('b').textContent = String(board.counts[lane]);
        b.querySelector('.lane-meter i').style.width = `${board.counts[lane] / max * 100}%`;
        b.setAttribute('aria-pressed', String(selectedLane === lane));
        b.setAttribute('aria-label', `${lane}: ${board.counts[lane]} tasks. Filter tasks.`);
        box.append(b);
        existing.delete(lane);
    }
    existing.forEach(n => n.remove());
}
function highlightLane() {
    if (!selectedLane) {
        world?.highlight(null);
        return;
    }
    const tasks = board.groups[selectedLane] || [], ids = [];
    for (const w of state.workers || [])
        if (tasks.some(t => t.id === w.taskId) || w.workerState === selectedLane || w.dispatchStatus === selectedLane) {
            ids.push(`worker:${w.dispatchId}`);
            for (const r of roster.agents)
                if (matchesRole(w, r))
                    ids.push(r.name);
        }
    for (const task of tasks)
        for (const r of roster.agents)
            if ([task.title, task.spec].filter(Boolean).join(' ').toLowerCase().includes(r.name.toLowerCase()))
                ids.push(r.name);
    world?.highlight(ids);
}
function renderEvents() {
    const box = $('events');
    box.replaceChildren();
    const events = state?.audit?.events || [];
    if (!events.length) {
        box.append(el('p', 'empty', state ? 'No audit events reported.' : 'Awaiting audit events.'));
        return;
    }
    for (const e of events.slice(-12)) {
        const row = el('div', 'event-row'), status = e.kind === 'completed' ? 'completed' : 'working';
        row.append(el('time', null, time(e.ts)), el('span', null, e.agent), chip(status, e.kind));
        row.title = `${date(e.ts)} · ${e.session}`;
        box.append(row);
    }
    box.scrollTop = box.scrollHeight;
}
function workerSource() { return state?.workers?.length ? state.workers : state?.runs?.[0]?.workers || []; }
function renderWorkers() {
    if (!state)
        return;
    const source = workerSource(), scope = state.workerScope || {}, run = state.runs?.[0];
    $('run-tag').textContent = scope.live ? 'Live' : scope.runId || run ? 'Recorded' : 'No run';
    $('run-tag').dataset.live = String(!!scope.live);
    $('run-objective').textContent = scope.objective || run?.objective || 'No orchestration run recorded.';
    if (follow) {
        const next = source.find(isWorking) || source[0];
        if (next?.dispatchId !== pickedWorker) {
            pickedWorker = next?.dispatchId || null;
            outputCache = null;
            refreshOutput();
        }
    }
    const box = $('worker-list');
    box.replaceChildren();
    if (!source.length)
        box.append(el('p', 'empty', 'No workers reported.'));
    for (const w of source) {
        const s = statuses.get(`worker:${w.dispatchId}`) || workerStatus(w);
        const b = button('', () => selectAgent(`worker:${w.dispatchId}`), 'worker-row');
        b.dataset.status = s.status;
        b.style.setProperty('--s', meta(s.status).color);
        b.classList.toggle('selected', pickedWorker === w.dispatchId);
        b.title = [s.evidence, w.agent, w.liveness].filter(Boolean).join(' · ');
        const text = el('span', 'worker-text');
        text.append(el('span', 'worker-name', w.taskTitle || w.label || w.dispatchId || 'Unnamed worker'), el('small', null, [w.agent || 'agent unknown', w.workerState || w.dispatchStatus || 'no state'].join(' · ')));
        b.append(text, chip(s.status));
        box.append(b);
    }
    $('live-tail').hidden = !isFloor || !pickedWorker;
}
function diffActivity(next) {
    if (previous) {
        const old = new Map(previous.workers.map(w => [w.dispatchId, w]));
        for (const w of next.workers) {
            const p = old.get(w.dispatchId);
            if (!p || p.workerState !== w.workerState || p.liveness !== w.liveness)
                transitions.push(`${time(next.ts)} · ${w.label || w.dispatchId} · ${p ? `${p.workerState || 'unknown'} → ` : ''}${w.workerState || 'unknown'} / ${w.liveness || 'unknown'}`);
        }
        const before = taskBoard(previous);
        for (const t of taskBoard(next).tasks) {
            const p = before.tasks.find(a => a.id === t.id);
            if (p && p.status !== t.status)
                transitions.push(`${time(next.ts)} · ${t.title || t.id} · ${p.status} → ${t.status}`);
        }
    }
    transitions = transitions.slice(-40);
    previous = next;
    $('ticker-text').textContent = transitions.at(-1) || 'No state transitions observed in this session.';
}
// Combined map: roster roles from agentStatuses, plus every Orca dispatch on the floor.
function computeStatuses() {
    const map = new Map(agentStatuses(state, roster));
    for (const w of workerSource())
        if (w.dispatchId)
            map.set(`worker:${w.dispatchId}`, { ...workerStatus(w), worker: w, task: w.taskTitle || w.label || null, since: null, lastEvent: null });
    return map;
}
const floorOf = () => 0;
function badgesFor(entries) {
    const counts = countStatuses(entries);
    return ['working', 'completed'].map(s => `<span class="floor-badge" data-status="${s}" data-zero="${!counts[s]}" style="--s:${meta(s).color}" title="${counts[s]} ${meta(s).label.toLowerCase()}">${icon(s)}${counts[s]}</span>`).join('');
}
function statusRow(id, entry) {
    const b = button('', () => selectAgent(id), 'status-row');
    b.dataset.status = entry.status;
    b.style.setProperty('--s', meta(entry.status).color);
    b.classList.toggle('selected', selected === id);
    b.title = [entry.evidence, entry.task].filter(Boolean).join(' · ');
    const text = el('span', 'status-text');
    // Dispatch rows say so, so a role and the Orca dispatch that lit it read as two distinct agents.
    const detail = id.startsWith('worker:') ? `Orca dispatch · ${entry.evidence}` : entry.status === 'completed' ? entry.evidence : entry.task || entry.evidence;
    text.append(el('span', 'status-name', agentName(id, entry)), el('small', null, detail || meta(entry.status).label));
    b.innerHTML = icon(entry.status);
    b.append(text, el('time', null, entry.since ? clock(entry.since) : ''));
    return b;
}
function renderStatusPanel(counts) {
    for (const s of ['working', 'completed', 'idle'])
        $(`count-${s}`).textContent = String(counts[s]);
    $('status-total').textContent = `${counts.total} roles`;
    const box = $('status-groups');
    box.replaceChildren();
    const recent = (a, b) => String(b[1].since || '').localeCompare(String(a[1].since || '')) || a[0].localeCompare(b[0]);
    const groups = [
        ['working', 'Working now', 'No agent is working right now.'],
        ['pending', 'Waiting to start', null],
        ['failed', 'Failed', null],
        ['completed', 'Recently completed', `No settled worker on the floor and no audit completion in the last ${COMPLETED_WINDOW_MS / 60000} minutes.`]
    ];
    for (const [status, title, empty] of groups) {
        const rows = [...statuses].filter(([id, e]) => !id.startsWith('worker:') && e.status === status).sort(recent);
        if (!rows.length && !empty)
            continue;
        const group = el('section', 'status-group');
        group.style.setProperty('--s', meta(status).color);
        const h = el('h3');
        h.innerHTML = icon(status);
        h.append(title, el('span', 'count', String(rows.length)));
        group.append(h);
        if (!rows.length)
            group.append(el('p', 'group-empty', empty));
        for (const [id, entry] of rows)
            group.append(statusRow(id, entry));
        box.append(group);
    }
}
function render() {
    board = taskBoard(state);
    statuses = computeStatuses();
    const counts = countStatuses(statuses), entries = [...statuses];
    const dispatches = entries.filter(([id]) => id.startsWith('worker:')), roles = entries.filter(([id]) => !id.startsWith('worker:'));
    const roleCounts = countStatuses(roles.map(([, e]) => e));
    const working = list => list.filter(([, e]) => e.status === 'working').length;
    const completed = list => list.filter(([, e]) => e.status === 'completed').length;
    const doneLane = board.source === 'Orca' ? 'completed' : 'done';
    $('metric-working').textContent = String(roleCounts.working);
    $('metric-working-sub').textContent = `${roleCounts.working} role${roleCounts.working === 1 ? '' : 's'} · ${working(dispatches)} dispatch${working(dispatches) === 1 ? '' : 'es'}`;
    $('metric-completed').textContent = String(roleCounts.completed);
    $('metric-completed-sub').textContent = `${roleCounts.completed} role${roleCounts.completed === 1 ? '' : 's'} · ${completed(dispatches)} dispatch${completed(dispatches) === 1 ? '' : 'es'}`;
    $('metric-pending').textContent = `${roleCounts.pending} / ${board.counts.blocked || 0}`;
    $('metric-pending-sub').textContent = roleCounts.failed ? `roles / tasks · ${roleCounts.failed} failed` : 'roles / tasks';
    $('metric-pending-sub').dataset.alert = String(roleCounts.failed > 0);
    $('metric-tasks').textContent = String(board.total);
    $('metric-tasks-sub').textContent = board.total ? `${board.counts[doneLane] || 0}/${board.total} done` : 'none reported';
    $('metric-board-label').textContent = `${board.source} tasks`;
    for (const f of [0, 1, 2, 3]) {
        const onFloor = f ? entries.filter(([id]) => floorOf(id) === f) : entries;
        const values = onFloor.map(([, e]) => e), c = countStatuses(values);
        document.querySelectorAll(`[data-floor-badges="${f}"]`).forEach(n => { n.innerHTML = badgesFor(values); });
        if (f)
            document.querySelectorAll(`[data-floor="${f}"]`).forEach(b => { b.dataset.active = String(c.working > 0); b.title = `${c.working} working · ${c.completed} completed · ${c.pending} pending · ${c.failed} failed`; });
    }
    renderStatusPanel(roleCounts);
    $('scope').textContent = `${state.terminals?.length || 0} terminals · ${state.worktrees?.length || 0} worktrees · ${state.workerScope?.hidden || 0} historical dispatches`;
    world?.update(state, statuses, board);
    highlightLane();
    renderBoard();
    renderDetail();
    renderWorkers();
    renderEvents();
    diffActivity(state);
    connection();
    // Operational dialogs are snapshots: explicit refresh preserves keyboard focus
    // and text selection while background telemetry continues to poll.
}
async function poll() {
    if (loading || closed || document.hidden)
        return;
    loading = true;
    clearTimeout(pollTimer);
    const jobs = [getJSON('/state').then(data => { if (!data || !Array.isArray(data.workers) || !Number.isFinite(data.ts))
            throw new Error('Invalid state payload'); state = data; stateError = null; lastSuccess = Date.now(); }).catch(e => { stateError = `State: ${e.message}`; })];
    if (!rosterLoaded)
        jobs.push(getJSON('/roster.json').then(data => { if (!data || !Array.isArray(data.agents) || !Array.isArray(data.rooms))
            throw new Error('Invalid roster payload'); roster = data; rosterLoaded = true; rosterError = null; world?.setRoster(roster); }).catch(e => { rosterError = `Roster: ${e.message}`; }));
    await Promise.allSettled(jobs);
    if (closed)
        return;
    try {
        if (state)
            render();
        else
            connection();
    }
    catch (e) {
        stateError = `Rendering state: ${e.message}`;
        connection();
        console.error(e);
    }
    loading = false;
    pollTimer = setTimeout(poll, stateError || rosterError ? 5000 : 2000);
}
function openPanel(kind) { currentPanel = kind; logId = null; logGeneration++; renderPanel(); if (!dialog.open)
    dialog.showModal(); }
function intro(text) { $('dialog-content').append(el('p', 'dialog-intro', text)); }
function emptyPanel(text) { $('dialog-content').append(el('p', 'empty', text)); }
function table(headers, rows) { const t = el('table', 'data-table'), head = el('thead'), tr = el('tr'); headers.forEach(h => tr.append(el('th', null, h))); head.append(tr); const body = el('tbody'); for (const values of rows) {
    const row = el('tr');
    for (const value of values) {
        const td = el('td');
        td.append(value instanceof Node ? value : document.createTextNode(String(value ?? '—')));
        row.append(td);
    }
    body.append(row);
} t.append(head, body); $('dialog-content').append(t); }
function renderPanel() {
    const content = $('dialog-content');
    content.replaceChildren();
    $('dialog-refresh').hidden = currentPanel === 'settings';
    $('dialog-refresh').title = `Refresh from latest snapshot${state ? ' · ' + date(state.ts) : ''}`;
    const names = { history: 'Run history', roster: 'Studio roster', audit: 'Subagent audit', quotas: 'Provider quotas', paseo: 'Paseo agents', tasks: 'Task board', settings: 'Rendering & navigation', logs: 'Worker output' };
    $('dialog-title').textContent = names[currentPanel] || currentPanel;
    if (stateError)
        intro(`Connection error: ${stateError}. Showing the last received state.`);
    if (currentPanel === 'settings') {
        intro('Rendering settings apply to the live headquarters and are remembered on this browser.');
        for (const [id, label] of [['particles', 'Particle effects'], ['low-performance', 'Low performance mode']]) {
            const row = el('label', 'toggle-row', label), input = el('input');
            input.type = 'checkbox';
            input.checked = $(id).checked;
            input.onchange = () => { $(id).checked = input.checked; $(id).onchange(); };
            row.append(input);
            content.append(row);
        }
        content.append(el('p', 'dialog-intro', 'Drag to orbit. Scroll or pinch to zoom. Right-drag to pan. When the scene has keyboard focus, Home resets the camera. Reduced-motion preferences are respected.'));
        content.append(button('Reset camera', () => world?.reset(), 'wide'));
        return;
    }
    if (currentPanel === 'roster') {
        intro(rosterLoaded ? `${roster.agents.length} roles · ${roster.rooms.length} departments. Activity comes from audit records and matching live work.` : rosterError || 'Loading roster.');
        const search = el('input', 'search');
        search.type = 'search';
        search.placeholder = 'Find a role or department…';
        search.setAttribute('aria-label', 'Search roster');
        content.append(search);
        const grid = el('div', 'card-grid');
        content.append(grid);
        const fill = () => { grid.replaceChildren(); const q = search.value.toLowerCase(); for (const role of roster.agents.filter(a => [a.name, a.room, a.desc].join(' ').toLowerCase().includes(q))) {
            const card = el('article', 'data-card');
            const pic = el('div', 'card-avatar');
            pic.innerHTML = portrait(role.name, role.room);
            const entry = statuses.get(role.name), title = el('div', 'card-title');
            title.append(el('h3', null, role.name), state ? chip(entry?.status || 'idle') : chip('idle', 'Unknown'));
            card.dataset.status = entry?.status || 'idle';
            card.style.setProperty('--s', meta(entry?.status || 'idle').color);
            card.append(pic, title, el('p', null, `Campus · ${role.room}${entry?.evidence ? ' · ' + entry.evidence : ''}`), el('p', null, role.desc), button('Locate agent ↗', () => { dialog.close(); selectAgent(role.name); }, 'wide'));
            grid.append(card);
        } if (!grid.children.length)
            grid.append(el('p', 'empty', 'No matching roles.')); };
        search.oninput = fill;
        fill();
        return;
    }
    if (!state) {
        emptyPanel(stateError || 'Waiting for the first state snapshot.');
        content.append(button('Retry connection', () => poll(), 'wide'));
        return;
    }
    if (currentPanel === 'history') {
        intro(`${state.runs?.length || 0} recorded runs. ${state.workerScope?.hidden || 0} dispatches are outside the current floor scope.`);
        if (!state.runs?.length) {
            emptyPanel('No run history reported.');
            return;
        }
        for (const run of state.runs) {
            const card = el('article', 'data-card');
            card.style.marginBottom = '12px';
            card.append(el('h3', null, run.objective || run.id), el('p', null, `${date(run.createdAt)} · ${run.total} dispatches · ${run.live} live · ${run.failed} failed${run.legacy ? ' · legacy' : ''}`), el('p', null, `Run: ${run.id}${run.coordinatorHandle ? ' · Coordinator: ' + run.coordinatorHandle : ''}`));
            for (const w of run.workers || []) {
                const row = button(`${w.agent || 'Unknown agent'} · ${w.label || w.taskTitle || w.dispatchId} · ${w.workerState || 'unknown'} ↗`, () => { selected = `worker:${w.dispatchId}`; pickedWorker = w.dispatchId; follow = false; renderDetail(); openLogs(w.dispatchId); }, 'wide history-row');
                row.prepend(chip(workerStatus(w).status));
                card.append(row);
            }
            content.append(card);
        }
        return;
    }
    if (currentPanel === 'audit') {
        const audit = state.audit || {};
        intro(audit.source ? `Source: ${audit.source}` : 'No audit source is reported.');
        const agents = audit.agents || [];
        if (agents.length)
            table(['Agent', 'Invoked', 'Completed', 'Active', 'Last event'], agents.map(a => [a.agent, a.invoked, a.completed, a.active, time(a.lastTs)]));
        else
            emptyPanel('No subagent activity reported.');
        if (audit.events?.length) {
            intro('Audit events · chronological');
            table(['Time', 'Agent', 'Event', 'Session'], audit.events.map(e => [date(e.ts), e.agent, e.kind, e.session]));
        }
        if (transitions.length) {
            intro('Observed worker and task transitions · this browser session');
            transitions.forEach(t => content.append(el('p', 'dialog-intro', t)));
        }
        return;
    }
    if (currentPanel === 'quotas') {
        intro('Provider usage reported by the local quota service. Values are percentages when provided.');
        if (!state.quotas?.length) {
            emptyPanel('No provider quotas are available.');
            return;
        }
        const grid = el('div', 'card-grid');
        for (const quota of state.quotas) {
            const card = el('article', 'data-card');
            card.append(el('h3', null, quota.name || quota.provider || 'Unnamed provider'), el('p', null, [quota.provider, quota.kind, quota.user].filter(Boolean).join(' · ')));
            for (const w of quota.windows || []) {
                card.append(el('p', null, `${w.name || 'Usage window'} · ${w.used == null ? 'usage unknown' : w.used + '% used'}${w.remaining == null ? '' : ' · ' + w.remaining + '% remaining'}`));
                if (w.used != null) {
                    const track = el('div', 'quota-track'), fill = el('i');
                    fill.style.width = `${Math.min(100, Math.max(0, w.used))}%`;
                    track.append(fill);
                    card.append(track);
                }
                if (w.resetsAt)
                    card.append(el('p', null, `Resets ${date(w.resetsAt)}`));
            }
            if (!quota.windows?.length)
                card.append(el('p', null, 'No usage windows reported.'));
            grid.append(card);
        }
        content.append(grid);
        return;
    }
    if (currentPanel === 'paseo') {
        intro(`${state.paseo?.length || 0} connected Paseo sessions.`);
        if (!state.paseo?.length) {
            emptyPanel('No Paseo agents reported.');
            return;
        }
        table(['Agent', 'Provider', 'Status', 'Thinking', 'Workspace', 'Created'], state.paseo.map(a => [a.name || a.shortId || a.id, a.provider, a.status, a.thinking, a.cwd, date(a.created)]));
        return;
    }
    if (currentPanel === 'tasks') {
        intro(`${board.source} · ${board.total} tasks${selectedLane ? ' · filtered to ' + selectedLane : ''}. Matching workers and roster roles are highlighted in the headquarters.`);
        if (selectedLane)
            content.append(button('Clear filter', () => { selectedLane = null; highlightLane(); renderBoard(); renderPanel(); }, 'wide'));
        const tasks = selectedLane ? board.groups[selectedLane] || [] : board.tasks;
        if (!tasks.length) {
            emptyPanel(board.total ? 'No task records in this lane. Only aggregate counts may be available.' : 'No tasks reported.');
            return;
        }
        table(['Task', 'Status', 'Run / ID', 'Inspect'], tasks.map(t => { const worker = state.workers.find(w => w.taskId === t.id) || state.runs?.flatMap(r => r.workers || []).find(w => w.taskId === t.id); const b = worker ? button('Worker ↗', () => { dialog.close(); selectAgent(`worker:${worker.dispatchId}`); }) : el('span', null, 'No associated dispatch'); return [t.title || t.name || t.id || 'Untitled task', t.status || 'unknown', t.runId || t.id, b]; }));
    }
}
function openLogs(id) { if (!id)
    return; currentPanel = 'logs'; $('dialog-refresh').hidden = false; logId = id; logGeneration++; $('dialog-title').textContent = 'Worker output'; $('dialog-content').replaceChildren(el('div', 'log-meta', findWorker(id)?.taskTitle || findWorker(id)?.label || id)); const meta = el('div', 'log-meta'); meta.id = 'log-meta'; const out = el('pre', 'log-output', 'Loading worker output…'); out.id = 'log-output'; $('dialog-content').append(meta, out, button('Refresh output', () => refreshOutput(), 'wide')); if (!dialog.open)
    dialog.showModal(); refreshOutput(); }
async function refreshOutput() {
    if (outputBusy || closed || document.hidden)
        return;
    const id = logId || (isFloor ? pickedWorker : null);
    if (!id)
        return;
    outputBusy = true;
    const generation = logGeneration;
    try {
        const data = await getJSON(`/worker/${encodeURIComponent(id)}`);
        if (closed)
            return;
        const blocks = outputBlocks(data), status = data.status || {};
        const text = blocks.lines.length ? blocks.lines.join('\n\n') : `No output available. Source: ${data.source || 'unknown'}.${data.fallbackReason ? ' ' + data.fallbackReason : ''}\nA finished dispatch may have no retained terminal tail.`;
        outputCache = { id, text };
        if (generation === logGeneration && id === logId && $('log-output')) {
            $('log-output').textContent = text;
            $('log-meta').textContent = [id, status.worker, status.terminal, status.liveness, blocks.kind, blocks.clipped ? 'bounded / clipped' : null].filter(Boolean).join(' · ');
        }
        if (id === pickedWorker)
            $('live-tail').textContent = text;
    }
    catch (e) {
        if (generation === logGeneration && id === logId && $('log-output'))
            $('log-output').textContent = `Worker output unavailable: ${e.message}. Use Refresh output to retry.`;
        if (id === pickedWorker)
            $('live-tail').textContent = `Worker output unavailable: ${e.message}`;
    }
    finally {
        outputBusy = false;
    }
}
renderDetail();
connection();
poll();
clockTimer = setInterval(connection, 1000);
outputTimer = setInterval(refreshOutput, 2000);
import('./hq3d.js?v=13').then(({ Headquarters }) => {
    if (closed)
        return;
    world = new Headquarters($('world'), { onSelect: id => selectAgent(id, false), onFPS: fps => { $('fps').textContent = `${fps} FPS`; }, onStats: stats => { $('fps').title = `${stats.calls} draw calls · ${stats.triangles.toLocaleString()} triangles · DPR ${stats.dpr.toFixed(2)}`; }, onFloor: floorChanged });
    world.setParticles($('particles').checked);
    world.setRoleLabels($('role-labels').checked);
    world.setLow($('low-performance').checked);
    if (rosterLoaded)
        world.setRoster(roster);
    if (state)
        world.update(state, statuses, board);
    if (isFloor)
        world.focusFloor(3);
}).catch(e => { console.error(e); const error = el('div', 'scene-error', `3D renderer unavailable: ${e.message}. Live data and inspection panels remain available.`); $('hud').append(error); $('fps').textContent = '3D unavailable'; });
const visibility = () => { if (!document.hidden) {
    poll();
    refreshOutput();
}
else
    clearTimeout(pollTimer); };
document.addEventListener('visibilitychange', visibility);
addEventListener('pagehide', () => { closed = true; clearTimeout(pollTimer); clearInterval(outputTimer); clearInterval(clockTimer); document.removeEventListener('visibilitychange', visibility); world?.dispose(); });
// A restored page must recreate the GPU resources disposed on pagehide.
addEventListener('pageshow', event => { if (event.persisted)
    location.reload(); });