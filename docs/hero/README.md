# README hero

The animated hero at the top of the project README: one agent's task in the HUD, from pick to
done, as a 14-second silent loop.

| File | What it is |
|---|---|
| `scene/index.tsx`, `scene/hero.css` | The scene: a React component on the Stageshow kit |
| `render.mjs` | Copies the scene into the skill, steps its virtual clock, writes the outputs |
| `poster.png` | The payoff frame (the scene's `poster`), 1100 × 620 stage at 2× = 2200 × 1240 |
| `hero.webm` | The loop: VP9, 1650 × 930, 30 fps, 420 frames, 14.0 s, no audio track |

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

## Render

Needs Node 20.19+, Google Chrome (or `CHROME_PATH`) and `ffmpeg` on `PATH`. From the repo root:

```sh
npx skills add benjitaylor/skills --skill stageshow   # installs .agents/skills/stageshow (gitignored)
(cd .agents/skills/stageshow && npm install)
node docs/hero/render.mjs                              # writes poster.png and hero.webm here
node docs/hero/render.mjs --sheets /tmp/hero-sheets    # also contact sheets at 830 and 390 wide
```

`render.mjs` copies `scene/` to `.agents/skills/stageshow/examples/studio-hero/` (the scene
imports the kit as `../../kit`), serves the skill's playground with Vite, and records the
`?embed=studio-hero` route frame by frame on the skill's virtual clock, so every render is
identical. Pass `--skill <dir>` if the skill lives elsewhere. Nothing is installed into this
app; the skill's `node_modules` stay inside its own gitignored folder.

To review the motion with the skill's own checks, run `npm run dev` in the skill folder and:

```sh
node scripts/film.mjs "http://127.0.0.1:5173/?capture=studio-hero" --every 2500 --count 6 --cols 3 --gate
```

## Rehearsal notes

- Started from the skill's `dark-hero` gold (dark window inset top and left, off the right and
  bottom; a status that changes on its own pill), with the cursor beats after `hero-demo`.
- `film.mjs --gate` ends `rehearsal passed` on the wide loop. Candidates left, judged
  intentional: `hard edge` on the close button and `T-104` while the panel glides past the
  rail edge (it is under about 30% opacity there); `handoff shift` on confetti pieces (separate
  particles, not a handoff); `appears with no entrance` on the counters' digit strips at first
  paint (the kit's `Count`).
- No `compact` variant: GitHub shows the poster as a fixed image, so a phone sees this design
  scaled to about 0.35. At 390 the story still reads by colour and shape (green row, counters,
  panel), but names are about 6 px. A separate phone poster would be the next step if needed.
- Not checked: Safari playback of the WebM, and the GitHub mobile app.

## Credit

Built with [Stageshow](https://github.com/benjitaylor/skills) by Benji Taylor, MIT licensed.
The kit and playground are not copied here; `render.mjs` uses the installed skill.
