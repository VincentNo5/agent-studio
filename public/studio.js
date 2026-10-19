import { activeRoles, isWorking, matchesRole, taskBoard, getJSON, outputBlocks, floorForRoom, ROOM_COLORS, hash } from './studio-data.js';
const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls)
    n.className = cls; if (text != null)
    n.textContent = String(text); return n; };
const button = (text, fn, cls = '') => { const b = el('button', cls, text); b.type = 'button'; b.onclick = fn; return b; };
const time = value => { if (!value)
    return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
const date = value => { if (!value)
    return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString(); };
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
$('hud').innerHTML = `
<header class="topbar">
 <a class="brand" href="/" aria-label="Agent Studio overview"><div class="brand-mark">⬡</div><div><h1>AGENT STUDIO</h1><p>AI AGENT COMMAND CENTER</p></div></a>
 <button class="connection" id="connection" data-state="loading" title="Retry connection"><strong id="connection-label">Connecting</strong><small id="clock">Awaiting state</small></button>
 <div class="metrics"><div class="metric"><span>Working workers</span><b id="metric-working">—</b></div><div class="metric"><span>Active roles</span><b id="metric-roles">—</b></div><div class="metric"><span>Pending / blocked</span><b id="metric-pending">—</b></div><div class="metric"><span id="metric-board-label">Task board</span><b id="metric-tasks">—</b></div></div>
 <nav class="floor-switch" aria-label="Focus a floor"><button data-floor="0" aria-pressed="true">ALL</button><button data-floor="1" aria-pressed="false">1F</button><button data-floor="2" aria-pressed="false">2F</button><button data-floor="3" aria-pressed="false">3F</button></nav>
 <button class="settings-button" id="settings" aria-label="Rendering settings" title="Rendering settings">⚙</button>
</header>
<div class="world-heading"><div class="eyebrow">HEADQUARTERS / LIVE SPATIAL VIEW</div><h2 id="world-title">ONE STUDIO. EVERY AGENT.</h2><p id="world-subtitle">Three floors. One connected operation.</p></div>
<nav class="view-links" aria-label="Studio view"><a href="/" ${!isFloor ? 'aria-current="page"' : ''}>COMMAND OVERVIEW</a><a href="/floor" ${isFloor ? 'aria-current="page"' : ''}>FLOOR VIEW ↗</a></nav>
<aside class="left-column" aria-label="Task board and operations">
 <section class="panel task-board"><div class="panel-head"><h2>Task board</h2><small id="board-total">—</small></div><p class="board-source" id="board-source">Awaiting state</p><div class="lanes" id="lanes"></div></section>
 <nav class="panel operations" aria-label="Operations"><button data-panel="history"><span>◷</span>Run history</button><button data-panel="roster"><span>◈</span>Roster</button><button data-panel="audit"><span>⌁</span>Audit</button><button data-panel="quotas"><span>◴</span>Quotas</button><button data-panel="paseo"><span>◇</span>Paseo</button><button data-panel="tasks"><span>☷</span>All tasks</button></nav>
 <section class="panel role-summary"><div class="panel-head"><h2>Active roles</h2><small id="active-count">—</small></div><div id="active-list" class="mini-list"><p class="empty">Awaiting state.</p></div></section>
</aside>
<aside class="right-column" aria-label="Agent inspection">
 <section class="panel detail"><div class="panel-head"><h2>Agent detail</h2><button id="clear-selection" aria-label="Clear agent selection" style="border:0;background:none;padding:0;color:var(--muted)">×</button></div><div id="detail-body" class="detail-body"></div></section>
 <section class="panel live-work"><div class="panel-head"><h2>Live work</h2><small id="run-tag">—</small></div><p id="run-objective" class="run-objective">Awaiting orchestration state.</p><div id="worker-list" class="worker-list"></div><pre id="live-tail" class="live-tail" hidden></pre></section>
</aside>
<div class="scene-hint">DRAG TO ORBIT <span style="color:#315269"> / </span> SCROLL TO ZOOM <span style="color:#315269"> / </span> SELECT AN AGENT</div>
<nav class="panel navigator" aria-label="Building navigator"><div class="mini-tower"><button data-floor="3" aria-label="Engineering and design floor">3F</button><button data-floor="2" aria-label="Production and quality floor">2F</button><button data-floor="1" aria-label="Lobby and dispatch floor">1F</button></div><div class="nav-floors"><button data-floor="0" aria-pressed="true"><small>◈</small>Overview</button><button data-floor="1"><small>1F</small>Lobby</button><button data-floor="2"><small>2F</small>Production</button><button data-floor="3"><small>3F</small>Engineering</button></div></nav>
<section class="panel events"><div class="panel-head"><h2>Live events</h2><button data-panel="audit">AUDIT TRAIL ↗</button></div><div class="event-list" id="events"><p class="empty">Awaiting audit events.</p></div></section>
<section class="panel preferences" id="preferences" aria-label="Rendering preferences"><label class="toggle-row" for="particles">Particle effects<input type="checkbox" id="particles" checked></label><label class="toggle-row" for="low-performance">Low performance mode<input type="checkbox" id="low-performance"></label><div class="performance"><button id="reset-camera">↺ Reset camera</button><output id="fps">— FPS</output></div></section>
<footer class="ticker"><strong>ACTIVITY</strong><span id="ticker-text">Awaiting observed state changes.</span><span class="scope" id="scope">READ-ONLY TELEMETRY</span></footer>`;
const dialog = el('dialog');
dialog.setAttribute('aria-labelledby', 'dialog-title');
dialog.innerHTML = '<div class="dialog-header"><h2 id="dialog-title"></h2><div class="dialog-actions"><button id="dialog-refresh" aria-label="Refresh panel">↻ Refresh</button><button id="dialog-close" aria-label="Close panel">×</button></div></div><div id="dialog-content" class="dialog-content"></div>';
document.body.append(dialog);
let world = null, state = null, roster = { rooms: [], agents: [] }, rosterLoaded = false, selected = null, active = new Set(), board = null, pickedWorker = null, follow = true, currentPanel = null, selectedLane = null;
let pollTimer = null, outputTimer = null, clockTimer = null, loading = false, closed = false, logId = null, logGeneration = 0, outputBusy = false, outputCache = null, previous = null, transitions = [];
let stateError = null, rosterError = null, lastSuccess = null;
const floorNames = ['ONE STUDIO. EVERY AGENT.', 'AGENT LOBBY & DISPATCH', 'PRODUCTION & QUALITY', 'ENGINEERING & DESIGN'];
function floorChanged(f) { document.querySelectorAll('[data-floor]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.floor) === f))); $('world-title').textContent = floorNames[f]; $('world-subtitle').textContent = f ? ['', 'Orca visitors · dispatch · Paseo agents', 'Art · audio · narrative · QA · engines · community', 'Directors · leads · engineering · design'][f] : 'Three floors. One connected operation.'; }
function focusFloor(f) { world?.focusFloor(f); floorChanged(f); }
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
$('low-performance').checked = preference('low', false);
$('particles').onchange = () => { world?.setParticles($('particles').checked); savePreference('particles', $('particles').checked); };
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
function renderDetail() {
    const box = $('detail-body');
    box.replaceChildren();
    document.querySelector('.detail').scrollTop = 0;
    if (!selected) {
        const empty = el('div', 'detail-empty');
        const cast = [['ai-programmer', 'engineering'], ['systems-designer', 'design'], ['sound-designer', 'audio']].map(([n, r]) => portrait(n, r)).join('');
        empty.innerHTML = `<div class="empty-cast">${cast}</div><h3>Select an agent</h3><p>Choose a character in the headquarters<br>to inspect its role, task, and activity.</p>`;
        empty.append(button('Explore studio roster ↗', () => openPanel('roster'), 'wide'));
        box.append(empty);
        return;
    }
    const role = roster.agents.find(a => a.name === selected);
    const worker = selected.startsWith('worker:') ? findWorker(selected.slice(7)) : ((state?.workers || []).find(w => isWorking(w) && role && matchesRole(w, role)) || (state?.workers || []).find(w => role && matchesRole(w, role)));
    if (!role && !worker) {
        box.append(el('p', 'empty', 'This dispatch is no longer available in the current state. It may still be in run history.'));
        return;
    }
    const name = role?.name || worker.label || worker.taskTitle || worker.dispatchId, room = role?.room || 'lobby';
    const avatar = el('div', 'detail-avatar');
    avatar.innerHTML = portrait(name, room, selected.startsWith('worker:'));
    avatar.style.setProperty('--avatar', `#${(ROOM_COLORS[room] || 0x54d9fa).toString(16)}`);
    box.append(avatar, el('h3', 'agent-name', name));
    const status = role ? (state ? (active.has(role.name) ? 'Working' : 'Idle') : 'Unknown') : (isWorking(worker) ? 'Working' : worker.workerState || worker.dispatchStatus || 'Unknown');
    box.append(el('div', 'status', `◉ ${status}`), el('div', 'department', `${room.toUpperCase()} · ${floorForRoom(room)}F`));
    if (role?.desc)
        box.append(el('p', 'description', role.desc));
    const section = el('section', 'detail-section');
    section.append(el('h3', null, 'CURRENT TASK'), el('p', null, worker?.taskTitle || worker?.label || (role && active.has(role.name) ? 'Active in audit; task is not provided.' : 'No associated task reported.')));
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
        details.append(dl);
        box.append(details);
    }
    const recent = el('section', 'detail-section');
    recent.append(el('h3', null, 'RECENT AUDIT EVENTS'));
    const list = el('div', 'detail-events');
    if (!events.length)
        list.append(el('p', null, 'No matching audit events.'));
    for (const e of events.slice(-4)) {
        const row = el('div');
        row.append(el('time', null, time(e.ts)), document.createTextNode(e.kind));
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
    $('board-source').textContent = `${board.source} · ${board.total} tasks`;
    $('board-total').textContent = String(board.total);
    const colors = { running: '#46cefa', blocked: '#ef8495', failed: '#ef8495', completed: '#5edaba', done: '#5edaba', review: '#e5b67b', pending: '#e5b67b', todo: '#ad9de2' };
    const box = $('lanes');
    const existing = new Map([...box.children].map(b => [b.dataset.lane, b]));
    const max = Math.max(1, ...Object.values(board.counts));
    for (const lane of board.lanes) {
        let b = existing.get(lane);
        if (!b) {
            b = button('', () => { selectedLane = selectedLane === lane ? null : lane; highlightLane(); renderBoard(); openPanel('tasks'); }, 'lane');
            b.dataset.lane = lane;
            b.append(el('span', 'lane-icon', '◈'), el('span', 'lane-name', lane), el('b'));
            const meter = el('span', 'lane-meter');
            meter.append(el('i'));
            b.append(meter);
        }
        b.style.setProperty('--lane', colors[lane] || '#779cb9');
        b.querySelector('b').textContent = String(board.counts[lane]);
        b.querySelector('i').style.width = `${board.counts[lane] / max * 100}%`;
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
        const row = el('div', 'event-row');
        row.append(el('time', null, time(e.ts)), el('i'), el('span', null, e.agent), el('b', null, e.kind));
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
    $('run-tag').textContent = scope.live ? 'LIVE' : scope.runId || run ? 'RECORDED' : 'NO RUN';
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
        const b = button('', () => selectAgent(`worker:${w.dispatchId}`), 'worker-row');
        b.classList.toggle('selected', pickedWorker === w.dispatchId);
        b.title = [w.dispatchId, w.agent, w.workerState, w.liveness].filter(Boolean).join(' · ');
        b.append(el('i'), el('span', null, w.taskTitle || w.label || w.dispatchId || 'Unnamed worker'), el('small', null, w.agent || w.workerState || 'unknown'));
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
function render() {
    board = taskBoard(state);
    active = activeRoles(state, roster);
    const realRoles = roster.agents.filter(r => active.has(r.name));
    $('metric-working').textContent = String(state.workers.filter(isWorking).length);
    $('metric-roles').textContent = rosterLoaded ? String(realRoles.length) : '—';
    $('metric-pending').textContent = `${board.counts.pending || 0} / ${board.counts.blocked || 0}`;
    $('metric-tasks').textContent = String(board.total);
    $('metric-board-label').textContent = `${board.source} tasks`;
    for (const f of [1, 2, 3]) {
        const rooms = roster.rooms.filter(room => floorForRoom(room) === f);
        const count = f === 1 ? state.workers.filter(isWorking).length : realRoles.filter(role => floorForRoom(role.room) === f).length;
        document.querySelectorAll(`[data-floor="${f}"]`).forEach(b => { b.dataset.active = String(count > 0); b.title = `${count} working · ${rooms.map(room => `${room}: ${realRoles.filter(r => r.room === room).length}`).join(' · ') || 'Orca visitor bay'}`; });
    }
    $('active-count').textContent = String(realRoles.length);
    $('active-list').replaceChildren();
    if (!realRoles.length)
        $('active-list').append(el('p', 'empty', rosterLoaded ? 'No active roster roles.' : 'Roster unavailable.'));
    for (const r of realRoles)
        $('active-list').append(button(r.name, () => selectAgent(r.name)));
    $('scope').textContent = `${state.terminals?.length || 0} TERMINALS · ${state.worktrees?.length || 0} WORKTREES · ${state.workerScope?.hidden || 0} HISTORICAL DISPATCHES`;
    world?.update(state, active, board);
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
        content.append(el('p', 'dialog-intro', 'Drag to orbit. Scroll or pinch to zoom. Right-drag to pan. When the scene has keyboard focus: 1, 2, 3 focus a floor; Home resets the camera. Reduced-motion preferences are respected.'));
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
            card.append(pic, el('h3', null, role.name), el('p', null, `${floorForRoom(role.room)}F · ${role.room} · ${state ? (active.has(role.name) ? 'Working' : 'Idle') : 'Unknown'}`), el('p', null, role.desc), button('Locate agent ↗', () => { dialog.close(); selectAgent(role.name); }, 'wide'));
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
            for (const w of run.workers || [])
                card.append(button(`${w.agent || 'Unknown agent'} · ${w.label || w.taskTitle || w.dispatchId} · ${w.workerState || 'unknown'} ↗`, () => { selected = `worker:${w.dispatchId}`; pickedWorker = w.dispatchId; follow = false; renderDetail(); openLogs(w.dispatchId); }, 'wide'));
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
import('./hq3d.js?v=6').then(({ Headquarters }) => {
    if (closed)
        return;
    world = new Headquarters($('world'), { onSelect: id => selectAgent(id, false), onFPS: fps => { $('fps').textContent = `${fps} FPS`; }, onFloor: floorChanged });
    world.setParticles($('particles').checked);
    world.setLow($('low-performance').checked);
    if (rosterLoaded)
        world.setRoster(roster);
    if (state)
        world.update(state, active, board);
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
