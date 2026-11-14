# Six direction cards

Shared inputs: `spec.md`, `backdrop.png` (live Three.js scene, HUD hidden), the sample state in `spec.md`. All six use the same content and 1440×900 viewport.

## 1 · Vignelli Ledger — best designer #1

- **Logic & source:** Massimo Vignelli's grid discipline (Helvetica, red/black/paper, information as typography). Not a specific page; working from the body of work.
- **Borrowed rules:** 12-column asymmetric grid; one red accent; paper/ink only; oversized numerals; hairline rules instead of cards; zero radius; no shadow or blur; display:body size ratio >3×.
- **Material:** the live 3D scene as a high-contrast printed plate, framed on paper. No decorative imagery.
- **Skeleton:** index rail left (giant 49 + status index), printed scene plate centre, agent ledger right, task table under the plate, event footnotes bottom.
- **Boldness:** the giant `49` and the amount of paper left empty.
- **Form from content:** the studio is a roster and a daily ledger; the page is printed like an operations sheet.

## 2 · Kenya Hara White — best designer #2

- **Logic & source:** Kenya Hara's *White* / Ma: emptiness as structure, the subject carries the colour, UI recedes.
- **Borrowed rules:** near-white field, black text, one faint warm grey; content in a quiet column; huge margins; tiny technical captions; almost no rules.
- **Material:** the 3D scene inside a generous white mount, like a print in a gallery.
- **Skeleton:** a single white field with the scene plate upper-right, a narrow status column upper-left, caption below, no sidebars.
- **Boldness:** removing almost all of the HUD and letting the scene sit in white space.
- **Form from content:** a studio is a place you observe; the interface is a mount, not a cockpit.

## 3 · Flight Control — real reference #1

- **Logic & source:** NASA Apollo Mission Operations Control Room, 1969. Reference photographed and inspected at `refs/nasa-control.jpg` (public-domain NASA image via Wikimedia Commons).
- **Borrowed rules:** pale grey/bone console surfaces; warm amber and green indicator lamps; dark ambient room; curved dense console rows; large wall display as the scene; every lamp has a label; red only for abort/failure.
- **Material:** live 3D scene as the wall display; console surfaces are flat, opaque, slightly warm; mono numerals.
- **Skeleton:** top mission bar; left flight-status console (status lamps + crew manifest + task board); centre wall display; right crew detail; bottom event log + task timeline + controls.
- **Boldness:** the console surface is genuinely light and physical against the dark room, not another glass panel.
- **Form from content:** Orca dispatches *are* flights: run → dispatch → station → outcome. The HUD is a flight controller's console.

## 4 · Bloomberg Market Ops — real reference #2

- **Logic & source:** Bloomberg Terminal. Reference photographed and inspected at `refs/bloomberg-terminal.jpg` (Wikimedia Commons).
- **Borrowed rules:** black field; amber, green, white and red data; monospaced tables; one row per instrument; keyboard-first density; colour only inside the data grid; no cards.
- **Material:** the 3D scene reduced to a narrow monitor strip; the rest is a data terminal.
- **Skeleton:** dense left table of agents and tasks, centre scene strip, right evidence + event tape, bottom command line.
- **Boldness:** committing to a table-first screen rather than a dashboard of panels.
- **Form from content:** agents as positions, tasks as orders, status as the tape. Deliberately the "too far" candidate.

## 5 · Gallery Dark — style wheel #18

- **Logic & source:** web style library #18, *Gallery Dark* (specimen inspected at `~/.agents/skills/huashu-design/assets/style-specimens/web/18-gallery-dark.jpg`): black field, one centred image, EXIF-like caption, UI recedes.
- **Borrowed rules:** near-black; one image/object per view; enormous negative space; small caption type; metadata in a quiet mono face; no cards, no glass.
- **Material:** the live 3D scene is the artwork; the HUD is wall text.
- **Skeleton:** full-bleed scene; thin status rail left; museum label right for the selected agent; event caption strip bottom; minimal top line.
- **Boldness:** no panels at all — the scene is the interface.
- **Form from content:** a live studio is something to watch; the command center becomes an operations gallery.

## 6 · Signboard Stack — style wheel east #6

- **Logic & source:** Hong Kong street signs (specimen inspected at `~/.agents/skills/huashu-design/assets/style-specimens/east/06-hk-street-signs.jpg`): layered solid-colour placards, vertical type, dense overlapping information.
- **Borrowed rules:** solid red/yellow/blue/cream blocks with hard 1px frames; vertical labels; overlapping tags; no gradients; information layers physically.
- **Material:** status tags as physical placards attached to the scene edges.
- **Skeleton:** stacked placards on the left edge, scene centre, vertical agent label right, price-board-like task list bottom.
- **Boldness:** the whole HUD is a stack of signs.
- **Form from content:** a studio building with rooms and departments literally gets a signage system. The most prop-like candidate.

## Chosen three

1. **Vignelli Ledger** — the most premium departure from dark glass; closest to a printed operations artifact.
2. **Flight Control** — the clearest status instrument; the warm console is a real material change.
3. **Gallery Dark** — the most cinematic; makes the 3D world the interface and strips the HUD back.

Backups: Kenya Hara White (quiet), Bloomberg Market Ops (dense), Signboard Stack (bold).
