// Renders the README hero: copies scene/ into the installed Stageshow skill,
// serves its playground, steps the skill's virtual clock frame by frame and
// writes poster.png and hero.webm (the wide design), poster-phone.png and
// hero-phone.webm (the compact design, filmed in a 390 wide page), and
// contact sheets.
//
//   node docs/hero/render.mjs [--only wide|phone] [--skill .agents/skills/stageshow] [--sheets <dir>]
//
// Needs the skill installed (npx skills add benjitaylor/skills --skill
// stageshow), `npm install` run inside it, Google Chrome, and ffmpeg on PATH.
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const skill = resolve(opt('skill', join(here, '../../.agents/skills/stageshow')))
const sheets = opt('sheets', null)
const only = opt('only', null)
const NAME = 'studio-hero'
const FPS = 30 // output frame rate; the clock runs at 60, two steps per frame
const LOOP = 14000 // the scene's loop length (LOOP in scene/index.tsx)
// The two designs. The page width picks the layout: the scene switches to
// its compact design below 560, so the phone is filmed in a 390 wide page.
// Both are captured at 2x; `out` is the loop's encoded width.
const SHOTS = [
  { id: 'wide', W: 1100, H: 620, page: 1140, out: 1650, poster: 'poster.png', video: 'hero.webm', sheet: [830, '3x5'] },
  { id: 'phone', W: 390, H: 844, page: 390, out: 780, poster: 'poster-phone.png', video: 'hero-phone.webm', sheet: [390, '5x3'] },
].filter((shot) => !only || shot.id === only)
if (!SHOTS.length) throw new Error(`--only takes wide or phone, not ${only}`)

// The scene lives beside the playground's examples so its kit import resolves
const dest = join(skill, 'examples', NAME)
mkdirSync(dest, { recursive: true })
cpSync(join(here, 'scene'), dest, { recursive: true })

const req = createRequire(join(skill, 'package.json'))
const { createServer } = await import(pathToFileURL(req.resolve('vite')).href)
const pw = await import(pathToFileURL(req.resolve('playwright-core')).href)
const chromium = pw.chromium ?? pw.default.chromium

const server = await createServer({
  root: join(skill, 'playground'),
  configFile: join(skill, 'playground/vite.config.ts'),
  server: { port: 5191, strictPort: false, host: '127.0.0.1' },
  logLevel: 'error',
})
await server.listen()
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' })
// The page's own timers and frames run on the virtual clock, so Playwright's
// in-page polling never fires: poll from Node instead
const until = async (page, fn) => {
  for (let i = 0; i < 300; i++) {
    if (await page.evaluate(fn)) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('the scene did not load')
}
const work = mkdtempSync(join(tmpdir(), 'studio-hero-'))

const kb = (p) => `${(statSync(p).size / 1024).toFixed(0)} KB`
const ff = (...a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a], { stdio: 'inherit' })

async function film({ id, W, H, page: pageW, out, poster, video, sheet }) {
  // The poster: the scene's own poster frame, as reduced motion shows it
  {
    const page = await browser.newPage({ viewport: { width: pageW, height: H + 40 }, deviceScaleFactor: 2, reducedMotion: 'reduce' })
    await page.goto(`${base}/?capture=${NAME}`)
    const stage = page.locator('.ss-stage').first()
    await stage.waitFor()
    await page.waitForTimeout(1500)
    await stage.screenshot({ path: join(here, poster), animations: 'disabled' })
    await page.close()
  }

  // The loop: the embed route installs the virtual clock before any scene
  // code runs. Playback is paused and the clock stepped from here.
  const page = await browser.newPage({ viewport: { width: pageW, height: H + 40 }, deviceScaleFactor: 2 })
  page.on('pageerror', (e) => console.error('page error:', e.message))
  await page.goto(`${base}/?embed=${NAME}`)
  // The embed driver waits to be told it is visible; paused, it still lays out
  await until(page, () => !!window.__stageshow?.clock)
  await page.evaluate(() => window.postMessage({ type: 'stageshow:control', playing: false, visible: true }, location.origin))
  await until(page, () => !!document.querySelector('.ss-stage'))
  const step = (n) => page.evaluate((n) => window.__stageshow.clock.step(n), n)
  const mark = () => page.evaluate(() => document.querySelector('.ss-stage')?.getAttribute('data-mark'))
  // Run one whole loop first, so the recording starts on the second loop's
  // opening: the same frame the recording ends on
  for (const want of ['reset', 'quiet']) {
    for (let i = 0; (await mark()) !== want; i++) {
      if (i > 60 * 30) throw new Error(`the scene never reached its "${want}" mark`)
      await step(1)
    }
  }
  const stage = page.locator('.ss-stage').first()
  const layout = await stage.getAttribute('data-layout')
  const size = await stage.evaluate((e) => [e.offsetWidth, e.offsetHeight])
  if (size[0] !== W || size[1] !== H) throw new Error(`the ${id} stage is ${size.join('x')} (${layout}), not ${W}x${H}`)
  const frames = Math.round((LOOP / 1000) * FPS)
  const dir = join(work, id)
  mkdirSync(dir)
  for (let f = 0; f < frames; f++) {
    await stage.screenshot({ path: join(dir, `f${String(f).padStart(4, '0')}.png`) })
    await step(60 / FPS)
  }
  await page.close()

  ff('-framerate', String(FPS), '-i', join(dir, 'f%04d.png'), '-vf', `scale=${out}:-2:flags=lanczos`, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '34', '-row-mt', '1', '-pix_fmt', 'yuv420p', '-an', join(here, video))
  if (sheets) {
    mkdirSync(sheets, { recursive: true })
    // One frame a second at the shown width
    const [w, tile] = sheet
    ff('-framerate', String(FPS), '-i', join(dir, 'f%04d.png'), '-vf', `select='not(mod(n\\,${FPS}))',scale=${w}:-2,tile=${tile}:padding=8:color=white`, '-frames:v', '1', join(sheets, `sheet-${id}-${w}.png`))
    if (id === 'wide') ff('-framerate', String(FPS), '-i', join(dir, 'f%04d.png'), '-vf', `select='not(mod(n\\,${FPS}))',scale=390:-2,tile=5x3:padding=8:color=white`, '-frames:v', '1', join(sheets, 'sheet-wide-390.png'))
    cpSync(dir, join(sheets, `frames-${id}`), { recursive: true })
  }
  console.log(`${id}: stage ${W}x${H} (${layout}), ${frames} frames at ${FPS} fps = ${(frames / FPS).toFixed(2)} s, ${readdirSync(dir).length} captured`)
  console.log(`  ${poster} ${kb(join(here, poster))}, ${video} ${kb(join(here, video))}`)
}

try {
  for (const shot of SHOTS) await film(shot)
} finally {
  await browser.close()
  await server.close()
  rmSync(work, { recursive: true, force: true })
}
