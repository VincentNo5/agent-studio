import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { Check, Circle, Hourglass, X } from 'lucide-react'
import { Bar, Collapse, Count, Meter, Row, Stage, Window, type Act } from '../../kit'
import './hero.css'

// Agent Studio's operations HUD, one agent's task from pick to done.
// Started from the dark-hero gold: a dark window inset top and left, off the
// right and the bottom, depth from surface steps, a status that changes on
// its own pill.
//
// Beats: the roster is quiet (two Working, one Pending, idle below); the
// pointer presses analytics-engineer, the row lifts and its detail panel
// slides in from the right; three log lines arrive and the progress bar
// fills; the chip turns Working to Completed on the same pill, the lead dot
// becomes a green tick, its desk on the floor plan turns green, the header
// rolls 2 to 1 working and 0 to 1 completed, and a short confetti burst
// leaves the row. The payoff holds. The reset has a cause: the panel is
// closed, then the agent picks up its next task, so the row turns Working
// again and the counters roll back. That is the opening frame, so the loop
// has no cut.
//
// Real strings: the product name, the three counters, three agent names,
// the task title and its three log lines. Everything else is placeholder.

type S = { selected: boolean; panel: boolean; log: number; done: boolean; burst: boolean }

const initial: S = { selected: false, panel: false, log: 0, done: false, burst: false }
const POSTER: S = { selected: true, panel: true, log: 3, done: true, burst: false }
const REST = { x: 842, y: 548 }
// The loop is a whole number of the 2s pulse, so a looping video has no seam
const LOOP = 14000

async function script(a: Act<S>) {
  const start = performance.now()
  a.mark('quiet')
  await a.wait(1300)
  await a.move({ at: 'agent-a', x: 0.6, y: 0.5 }, { duration: 900 })
  await a.wait(120)
  await a.click()
  a.mark('pick')
  a.put({ selected: true, panel: true })
  await a.wait(500)
  // Out of the way: the empty middle of an idle row, clear of every word
  await a.move({ x: 440, y: 548 }, { duration: 700 })
  await a.wait(200)
  a.mark('log')
  for (let i = 1; i <= 3; i++) {
    a.put({ log: i })
    await a.wait(i < 3 ? 780 : 640)
  }
  a.mark('settle')
  a.put({ done: true, burst: true })
  await a.wait(1300)
  a.put({ burst: false })
  a.mark('hold')
  await a.wait(1500)
  // The reset: close the panel, then the agent takes its next task
  await a.move({ at: 'close', x: 0.5, y: 0.5 }, { duration: 800 })
  await a.wait(100)
  await a.click()
  a.mark('reset')
  a.put({ panel: false, selected: false })
  await a.wait(650)
  await a.snap({ log: 0 }, 'panel')
  a.put({ done: false })
  await a.move(REST, { duration: 800 })
  await a.wait(Math.max(0, LOOP - (performance.now() - start)))
}

// The roster: three real agents, then idle rows as placeholder
type Status = 'working' | 'completed' | 'pending' | 'idle'
const ROWS: { id: string; name: string | null; status: Status; time: string | null; task: number }[] = [
  { id: 'a', name: 'analytics-engineer', status: 'working', time: '01:42', task: 168 },
  { id: 'b', name: 'gameplay-programmer', status: 'working', time: '00:58', task: 140 },
  { id: 'c', name: 'network-programmer', status: 'pending', time: null, task: 186 },
  { id: 'd', name: null, status: 'idle', time: null, task: 120 },
  { id: 'e', name: null, status: 'idle', time: null, task: 150 },
  { id: 'f', name: null, status: 'idle', time: null, task: 104 },
]

const LOG = [
  { t: '01:44', text: 'Patched the cooldown timer' },
  { t: '01:51', text: 'Tests passed, 14 of 14' },
  { t: '01:58', text: 'Ready for review' },
]

export default function StudioHero() {
  return (
    <Stage<S>
      width={1100}
      height={620}
      theme="dark"
      initial={initial}
      poster={POSTER}
      script={script}
      cursor={{ at: REST }}
      className="sth"
    >
      {(s) => {
        const working = s.done ? 1 : 2
        const completed = s.done ? 1 : 0
        return (
          <Window url="localhost:8787" className="sth-win">
            <div className="sth-body">
              <header className="sth-top">
                <div className="sth-brand">Agent Studio</div>
                <Metric label="Working" value={working} tone="cyan" icon={<i className="sth-dot sth-dot--cyan" />} />
                <Metric label="Completed" value={completed} tone="green" icon={<Check size={12} strokeWidth={2.5} />} />
                <Metric label="Idle" value={23} tone="muted" icon={<Circle size={11} strokeWidth={2.25} />} />
                <span className="sth-top__end" aria-hidden>
                  <Bar w={64} h={6} tone={2} />
                  <Bar w={28} h={28} r={8} tone={1} />
                </span>
              </header>
              <Floor s={s} />
              <div className="sth-main">
                <section className="sth-list">
                  <div className="sth-list__head">
                    <span className="sth-label">Agent status</span>
                    <Bar w={44} h={6} tone={2} />
                  </div>
                  {ROWS.map((r) => (
                    <AgentRow key={r.id} row={r} s={s} />
                  ))}
                </section>
                <Detail s={s} />
              </div>
            </div>
          </Window>
        )
      }}
    </Stage>
  )
}

function Metric({ label, value, tone, icon }: { label: string; value: number; tone: 'cyan' | 'green' | 'muted'; icon: React.ReactNode }) {
  return (
    <div className="sth-metric" data-tone={tone}>
      <span className="sth-metric__label">
        <span className="sth-metric__icon">{icon}</span>
        {label}
      </span>
      <Count className="sth-metric__value" value={value} duration={600} />
    </div>
  )
}

// The floor plan: three glass rooms, desk pods and a lounge. Each agent has
// a desk; status lights it, so the pick and the completion show here too.
const PODS = [4, 4, 4, 4, 4, 4, 2]
const DESK: Record<string, number> = { a: 5, b: 13, c: 18 }

function Floor({ s }: { s: S }) {
  let n = 0
  const tone = (i: number): string => {
    if (i === DESK.a) return s.done ? 'completed' : 'working'
    if (i === DESK.b) return 'working'
    if (i === DESK.c) return 'pending'
    return 'idle'
  }
  return (
    <div className="sth-floor" aria-hidden>
      <div className="sth-rooms">
        {[0, 1, 2].map((i) => (
          <span key={i} className="sth-room">
            <Bar w={[34, 26, 30][i]!} h={5} tone={2} />
          </span>
        ))}
      </div>
      <div className="sth-pods">
        {PODS.map((size, p) => (
          <span key={p} className="sth-pod" data-size={size}>
            {Array.from({ length: size }, () => {
              const i = n++
              return <i key={i} className="sth-desk" data-status={tone(i)} data-picked={(i === DESK.a && s.selected) || undefined} />
            })}
          </span>
        ))}
      </div>
      <div className="sth-lounge">
        <Bar w={58} h={14} r={5} tone={1} />
        <Bar w={22} h={22} r={11} tone={1} />
        <Bar w={58} h={14} r={5} tone={1} />
      </div>
    </div>
  )
}

function AgentRow({ row, s }: { row: (typeof ROWS)[number]; s: S }) {
  const live = row.id === 'a'
  const status: Status = live && s.done ? 'completed' : row.status
  return (
    <div className="sth-row" data-status={status} data-lifted={(live && s.selected) || undefined} data-target={live ? 'agent-a' : undefined} data-cursor={live ? 'pointer' : undefined}>
      <Row
        pad={10}
        lead={<Lead status={status} />}
        title={row.name ?? <Bar w={[118, 96, 132][row.id.charCodeAt(0) - 100]!} h={7} tone={3} />}
        subtitle={<Bar w={row.task} h={6} tone={row.name ? 2 : 1} />}
      >
        <span className="sth-trail">
          {/* The last rows run off the bottom edge: filler, so no chip to slice */}
          {row.id === 'e' || row.id === 'f' ? <Bar w={52} h={24} r={12} tone={1} /> : <Chip status={status} flips={live} />}
          <span className="sth-time">{row.time ?? <Bar w={30} h={6} tone={1} />}</span>
        </span>
      </Row>
      {live && <Confetti on={s.burst} />}
    </div>
  )
}

// The lead mark: a pulsing dot while working, a green tick when done. Both
// share one cell and crossfade, so the name beside it never moves.
function Lead({ status }: { status: Status }) {
  return (
    <span className="sth-lead" data-status={status}>
      <i className="sth-lead__dot" />
      <span className="sth-lead__tick">
        <Check size={10} strokeWidth={3} />
      </span>
    </span>
  )
}

// The status pill, after the product's .chip: tinted fill, a 1px edge in
// the status color. Working to Completed happens on this one pill: the tone
// eases, the icon crossfades in its cell, the label cell eases to the new
// word's width from the right edge only.
const WORDS: Record<Status, string> = { working: 'Working', completed: 'Completed', pending: 'Pending', idle: 'Idle' }

function Chip({ status, flips }: { status: Status; flips: boolean }) {
  return (
    <span className="sth-chip" data-status={status}>
      <span className="sth-chip__icon">
        {flips || status === 'working' ? <i className="sth-dot" /> : null}
        {flips && <Check size={10} strokeWidth={3} />}
        {status === 'pending' && <Hourglass size={10} strokeWidth={2.5} />}
        {status === 'idle' && <Circle size={9} strokeWidth={2.5} />}
      </span>
      {flips ? <FlipLabel on={status === 'completed' ? 1 : 0} words={['Working', 'Completed']} /> : WORDS[status]}
    </span>
  )
}

function FlipLabel({ on, words }: { on: number; words: string[] }) {
  const refs = useRef<HTMLSpanElement[]>([])
  const [w, setW] = useState<number[]>([])
  useLayoutEffect(() => setW(refs.current.map((e) => e.offsetWidth)), [])
  return (
    <span className="sth-flip" style={w.length ? { width: w[on] } : undefined}>
      {words.map((t, i) => (
        <span key={t} ref={(e) => { if (e) refs.current[i] = e }} className="sth-flip__word" data-on={i === on || undefined}>{t}</span>
      ))}
    </span>
  )
}

function Confetti({ on }: { on: boolean }) {
  // Fixed pieces, so every loop and every render throws the same burst
  const pieces = [
    [-96, -50, 200, 'c'], [-60, -86, -140, 'g'], [-20, -104, 90, 'a'], [18, -96, -60, 'g'], [56, -80, 160, 'c'],
    [80, -60, -110, 'r'], [-118, -20, 70, 'a'], [96, -70, -170, 'g'], [-44, -64, 120, 'r'], [40, -50, -90, 'c'],
    [-78, -34, -30, 'g'], [74, -30, 40, 'a'], [0, -74, 180, 'c'], [-8, -42, -150, 'g'], [-130, -60, 60, 'c'], [104, -96, -40, 'a'],
  ] as const
  return (
    <span className="sth-confetti" data-on={on || undefined} aria-hidden>
      {pieces.map(([x, y, r, c], i) => (
        <i key={i} data-c={c} style={{ '--x': `${x}px`, '--y': `${y}px`, '--r': `${r}deg`, animationDelay: `${(i % 4) * 25}ms` } as CSSProperties} />
      ))}
    </span>
  )
}

// The right rail: Agent detail. Empty until an agent is picked, then the
// agent's panel slides in from the right inside the rail, arriving full.
function Detail({ s }: { s: S }) {
  const progress = s.done ? 1 : [0.46, 0.62, 0.78, 0.9][s.log]!
  return (
    <aside className="sth-rail">
      <div className="sth-rail__empty" data-hidden={s.panel || undefined}>
        <span className="sth-label">Agent detail</span>
        <span className="sth-rail__hint">Select an agent</span>
        <Bar w={168} h={6} tone={1} />
      </div>
      <div className="sth-panel" data-open={s.panel || undefined} data-target="panel">
        <div className="sth-panel__head">
          <span className="sth-panel__name">analytics-engineer</span>
          <Chip status={s.done ? 'completed' : 'working'} flips />
          <span className="sth-close" data-target="close" data-cursor="pointer">
            <X size={14} strokeWidth={2} />
          </span>
        </div>
        <div className="sth-task">Build the ability cooldown</div>
        <div className="sth-progress">
          <Meter value={progress} tone={s.done ? 'success' : 'accent'} className="sth-meter" />
          <span className="sth-id">T-104</span>
        </div>
        <div className="sth-log">
          {[64, 52].map((w, i) => (
            <div key={i} className="sth-line sth-line--old">
              <Bar w={30} h={6} tone={1} />
              <Bar w={`${w}%`} h={6} tone={2} />
            </div>
          ))}
          {LOG.map((l, i) => (
            <Collapse key={l.t} open={s.log > i}>
              <div className="sth-line" data-last={(i === 2 && s.done) || undefined}>
                <span className="sth-line__t">{l.t}</span>
                <span className="sth-line__text">{l.text}</span>
              </div>
            </Collapse>
          ))}
        </div>
      </div>
    </aside>
  )
}
