# Remote control from a phone

Four ways to drive the agents on this machine from an iPhone, in the order most people want them.
Facts below were measured on this Mac (2026-10-18); commands are copy-pasteable.

## 1. Paseo mobile app — drive agents (recommended)

The Paseo daemon runs on this machine and relays to the phone; the phone app is
**Paseo Pocket Engineer** (App Store / Play Store).

```bash
paseo status              # daemon health, listen address, version
paseo pair                # prints the pairing QR code / link — scan it with the app
paseo ls                  # agents, from the CLI
paseo provider ls         # which agent CLIs the daemon can currently launch
```

Measured state on this machine: daemon v0.11.2 on `127.0.0.1:6767`, `relay.enabled: true`,
push subscription valid, and providers **claude / codex / opencode / pi** available.
`omp` shows as *unavailable*: Paseo gates it on a Bun runtime it can locate, and its
diagnostic still reports `Bun runtime: unavailable` even with Bun 1.4.3 on the login-shell
`PATH` — enable it under **Settings → host → Providers → OMP** and re-read the diagnostic
before relying on it.

Rules that matter in practice:

- **Provider changes need a daemon restart to resolve.** Installing a CLI is not enough:
  `codex` and `opencode` stayed `unavailable` until `paseo daemon restart`.
- **Quota is shared with everything else on this machine.** Prefer `codex` or `opencode`
  from the phone; reserve `claude` for planning/design. A Claude 5-hour window that is
  exhausted makes `--agent claude` workers sit in a 429 retry loop.
- Agents launched from the phone appear in this repo's studio pages (PASEO BAY on the 1F
  plate, LLM QUOTA and PASEO AGENTS panels on the overview).

## 2. SSH + tmux — drive OMP itself

Paseo drives *agent CLIs*; to drive **omp** (TUI, sessions, its own subagents) from the
phone, use SSH into this Mac with tmux so a dropped connection does not kill the session.

```bash
# On the Mac: turn on Remote Login (needs admin; not enabled as of 2026-10-18)
sudo systemsetup -setremotelogin on
# then verify
lsof -nP -iTCP:22 -sTCP:LISTEN
```

On the phone, install an SSH client (Blink, Termius, …) and:

```bash
ssh vincent@<mac-address>
tmux new -As omp        # first time
tmux attach -t omp      # after a disconnect
# inside tmux:
omp
```

Outside the home network this needs a way to reach the Mac. **Tailscale is not installed**
here; `brew install --cask tailscale` plus signing in on both devices gives a stable
`100.x.y.z` address with no port forwarding. (Paseo's relay is an alternative for agents,
but it does not give you a shell.)

## 3. Studio pages — watch, from any browser

The studio server listens on all interfaces (`*:8787`), so a phone on the same Wi-Fi can
open it directly:

```
http://<mac-lan-ip>:8787/        # command overview
http://<mac-lan-ip>:8787/floor   # studio tower
```

Measured: `http://192.168.1.63:8787/` → 200. The pages are a fixed 1600×900 stage that
scales to the viewport, so they read fine on a phone in landscape.

For access from cellular, put the Mac (or just this port) behind Tailscale or a reverse
proxy. **Do not port-forward 8787 to the internet**: it is an unauthenticated read-only
view of your agent fleet, but it also names repositories, task titles and account emails.

## 4. Hermes gateway — chat-app control

The hermes gateway is already connected to **Feishu / WeChat**, so a message from the phone
drives the hermes agent on this machine (which can run shell commands and spawn work).

```bash
hermes status              # gateway + connected platforms
hermes gateway restart     # after config changes
```

This controls *hermes*, not omp; use it for "tell the machine to do X" rather than for
interactive coding.

## Quota routing (learned the hard way)

| Account | Where it is spent | Guidance |
|---|---|---|
| Claude Pro (5h / 7d windows) | omp `@plan`/`@review`, Orca `--agent claude`, Paseo `claude` | scarcest — design, planning, review only |
| Codex (ChatGPT Plus) | omp `@codex`, Orca `--agent codex`, Paseo `codex` | default for implementation work |
| opencode-go | omp `@code`, Orca `--agent opencode` | cheap high-frequency calls |
| Cursor | Paseo `cursor` | separate budget, largely unused |

Check the live numbers any time:

```bash
curl -s http://127.0.0.1:3425/v1/magpie/quotas | python3 -m json.tool
```

omp already falls back automatically (`plan`/`review` → codex → opencode-go); **Orca and
Paseo do not** — pick the provider deliberately when you launch.

## Security notes

- `paseo pair` prints a pairing secret. Treat the QR/link like a password; do not paste it
  into chat logs or issues.
- The studio pages have no authentication. Keep them on LAN/Tailscale, never on a public port.
- `docs/*.png` screenshots in this repo are redacted (repository names and local paths
  replaced) before commit; keep that habit when adding new ones.
