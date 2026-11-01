# README hero

The animated hero at the top of the project README: one agent's task in the HUD, from pick to
done, as a 14-second silent loop, in a wide design and a phone design.

| File | What it is |
|---|---|
| `scene/index.tsx`, `scene/hero.css` | The scene: a React component on the Stageshow kit, with its wide and `compact` designs |
| `render.mjs` | Copies the scene into the skill, steps its virtual clock, writes the outputs |
| `poster.png` | The wide payoff frame (the scene's `poster`), 1100 × 620 stage at 2× = 2200 × 1240 |
| `hero.webm` | The wide loop: VP9, 1650 × 930, 30 fps, 420 frames, 14.0 s, no audio track |
| `poster-phone.png` | The phone payoff frame, the `compact` 390 × 844 stage at 2× = 780 × 1688 |
| `hero-phone.webm` | The phone loop: VP9, 780 × 1688, 30 fps, 420 frames, 14.0 s, no audio track |

It is an authored illustration of the HUD, not a screen recording. The strings, the tokens
(`#071018` ground, cyan `#38d9ff`, amber, green, red, 10 px radii, hairline borders, the Avenir
Next / Trebuchet stack, mono for times and ids) and the composition follow `public/studio.css`.

## Story

1. **Quiet.** Two agents `Working` (pulsing dot), one `Pending`, idle rows below. Header 2 / 0 / 23.
2. **Pick.** The pointer presses `analytics-engineer`; the row lifts, its floor desk is ringed, and
   the Agent detail panel glides in from the right with the task and its progress bar.
3. **Progress.** Three log lines arrive; the bar fills.
4. **Settle.** The chip turns `Working → Completed` on the same pill, the lead dot becomes a
   green tick, the desk turns green, the header rolls 2 → 1 working and 0 → 1 completed, and a
   short confetti burst leaves the row.
5. **Hold, then reset with a cause.** The payoff holds about 3 s (the poster). The panel is closed,
   then the agent picks up its next task, so its row turns `Working` and the counters roll back:
   that is the opening frame, and the last frame of the video is pixel-identical to the first.

The counters have one entrance: on first paint each value rises into its cell, left to right, as
the HUD's first poll lands. They stay mounted, so every later loop (and both videos, which are
recorded from the second loop) opens on them already there.

## Phone design

The scene's `compact` design (below 560 wide, a 390 × 844 stage drawn at 1:1) tells the same five
beats, rebuilt for the column instead of scaled: the HUD as a page a 16 px gutter in from the top
and sides, off the bottom (no desktop chrome, since a portrait window with traffic lights reads
as a squashed app); the wordmark over the counters as one row of three; the floor plan as a slim
strip of desk pods, still lit and ringed by status; the roster as the subject. Picking
`analytics-engineer` opens its row in place into the agent's card (task, progress, `T-104`, a
three-line log), carrying the rows below it down; the card is closed from its own head for the
reset. Named rows are one line, so no placeholder sits under a real word, and the burst rises
from the gap between the name and the chip, clear of both. Smallest type is 12 px (labels, mono
times and the id); every inset is 12 px or more.

## Render

Needs Node 20.19+, Google Chrome (or `CHROME_PATH`) and `ffmpeg` on `PATH`. From the repo root:

```sh
npx skills add benjitaylor/skills --skill stageshow   # installs .agents/skills/stageshow (gitignored)
(cd .agents/skills/stageshow && npm install)
node docs/hero/render.mjs                              # writes both posters and both loops here
node docs/hero/render.mjs --only wide                  # poster.png and hero.webm only
node docs/hero/render.mjs --only phone                 # poster-phone.png and hero-phone.webm only
node docs/hero/render.mjs --sheets /tmp/hero-sheets    # also contact sheets and every frame
```

Sheets are one frame a second: `sheet-wide-830.png` and `sheet-wide-390.png` for the wide loop,
`sheet-phone-390.png` for the phone loop at 1:1. The wide design is filmed in a 1140 wide page
and the phone design in a 390 wide page (the page width picks the layout); `render.mjs` stops if
the stage it films is not the expected size.

`render.mjs` copies `scene/` to `.agents/skills/stageshow/examples/studio-hero/` (the scene
imports the kit as `../../kit`), serves the skill's playground with Vite, and records the
`?embed=studio-hero` route frame by frame on the skill's virtual clock, so every render is
identical. Pass `--skill <dir>` if the skill lives elsewhere. Nothing is installed into this
app; the skill's `node_modules` stay inside its own gitignored folder.

To review the motion with the skill's own checks, run `npm run dev` in the skill folder and:

```sh
node scripts/film.mjs "http://127.0.0.1:5173/?capture=studio-hero" --every 2500 --count 6 --cols 3 --gate
node scripts/film.mjs "http://127.0.0.1:5173/?capture=studio-hero" --width 390 --every 1000 --count 14 --cols 7 --gate
node scripts/film.mjs "http://127.0.0.1:5173/?capture=studio-hero" --slow 3 --every 300 --count 8 --cols 4 --gate   # the load entrance
```

## Rehearsal notes

- Started from the skill's `dark-hero` gold (dark window inset top and left, off the right and
  bottom; a status that changes on its own pill), with the cursor beats after `hero-demo`.
- `film.mjs --gate` ends `rehearsal passed` at the shown width and at 390 (the compact design).
  Candidates left at both, judged intentional: `handoff shift` on confetti pieces (separate
  particles, not a handoff), and `appears with no entrance` on the counters' digit strips at
  normal speed. That second one is a sampling gap at page load (about 160 ms, longer than most of
  the 0.5 s rise); under `--slow 3` the line is gone at both widths and the sheet shows the values
  mid-rise.

### This pass

- **Phone design.** Added the `compact` design above, with `poster-phone.png` and
  `hero-phone.webm`. Rounds: the card first opened as an empty box for about 0.2 s (the kit's
  late fade for tall content), so it now fades from the first frame of the opening; a drop
  reveal was tried and drew the task line over the next row, so it unrolls from the head
  instead. The burst first crossed the chip mid-flip, then the end of the name; it is now
  narrower and starts above the text line. The first frame used a browser window, which the
  gate flags (`framing:` a desktop window narrower than tall); it became the chromeless page.
- **Panel glide.** The panel glided 48 px by a transform, so the close button and `T-104` were
  cut by the rail edge while faint. Animating `left` instead fixed the cut but moved the chip by
  layout (the gate's `steps in its box`). It is a transform again, with a soft mask that travels
  with it: its clear point is always at or past the rail's edge, so the right-hand controls fade
  at the edge instead of being cut, and the mask slides off as the panel lands. The gate's
  `hard edge` lines on the rail are gone.
- **Counters.** They now have the one entrance described in the Story.
- Not checked: Safari playback of the WebM, the GitHub mobile app, and how GitHub's README
  renders the two links on a phone.

## Credit

Built with [Stageshow](https://github.com/benjitaylor/skills) by Benji Taylor, MIT licensed.
The kit and playground are not copied here; `render.mjs` uses the installed skill.
