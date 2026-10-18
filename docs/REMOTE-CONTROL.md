# Remote control from a phone

Four ways to drive the agents on this machine from an iPhone, in the order most people want them.
Facts below were measured on this Mac (2026-10-18); commands are copy-pasteable.

## 0. The Mac moves between networks — design for that first

This machine is sometimes at home and sometimes at the office, so **any address that belongs to
one network is a trap**: the LAN IP (`192.168.1.63`) is home-specific, and `MacBook-Pro-2.local`
only resolves on the same link and only where mDNS is not filtered — office Wi-Fi commonly blocks
Bonjour *and* isolates clients from each other, so "same Wi-Fi" is not a reliable path there.

| Where the phone is | How to reach the Mac | Works when |
|---|---|---|
| same home LAN | `MacBook-Pro-2.local` | home only |
| same office LAN | usually **not** — mDNS filtered, client isolation | unreliable |
| anywhere else (cellular, hotel, other office) | **Tailscale MagicDNS name** | everywhere |

**Recommendation: make Tailscale the primary path.** Install it on the Mac
(`brew install --cask tailscale`, sign in) and on the iPhone (App Store), then use the MagicDNS
name (`<host>.<tailnet>.ts.net`) as the single host address in Termius/Blink. It resolves at home,
at the office, and on cellular, and nothing needs port forwarding.

### Three real obstacles on this machine

1. **Sleep kills remote access.** Measured: `pmset -g` reports `sleep 1` — the Mac sleeps after one
   minute of idle, and `womp` (wake for network access) is not enabled. Today only omp's power
   assertion keeps it awake. For 24/7 reachability:
   ```bash
   sudo pmset -a sleep 0 womp 1      # never system-sleep; wake for network access
   ```
   Run this **only while plugged in** — a laptop on battery that never sleeps will die, and a
   sleeping laptop is unreachable either way. The honest alternative is to accept that remote
   access works only while the machine is awake (a `caffeinate -s` window, or keeping it on power).
2. **GlobalProtect (the office VPN) is running on this machine.** Two VPN clients competing for
   routes is the classic failure: Tailscale usually coexists, but a corporate policy can block its
   UDP transport, in which case Tailscale falls back to DERP relays (works, slower). If the office
   network misbehaves, test with GlobalProtect disconnected before blaming Tailscale.
3. **The studio has no authentication.** The server binds `*:8787`, so on an office LAN anyone on
   the subnet can read the fleet view (repository names, task titles, account names). Two fixes:
   bind it to the Tailscale interface only (change the launchd plist's hostname to the Tailscale
   IP) or put a token in front of it. On an untrusted network, do not leave it on `*`.

Also worth doing once a key works: keys-only SSH —
`PasswordAuthentication no` in `/etc/ssh/sshd_config` (needs sudo, then
`sudo launchctl kickstart -k system/com.openssh.sshd`).

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

### What the phone needs

| App | Why | Required |
|---|---|---|
| **Blink Shell** (paid) or **Termius** (free tier) | an SSH client; Blink has native tmux control mode and Mosh, which is the best mobile experience | yes |
| **Tailscale** (iOS) | reach the Mac when you are not on the home Wi-Fi (no port forwarding, no public port) | only for remote access |
| Paseo Pocket Engineer | drives agent CLIs, **not** a shell — already paired | optional |
| Feishu / WeChat | the hermes gateway is connected to both | optional |

### What the Mac needs

```bash
# 1. Turn on Remote Login — needs admin, still OFF as of 2026-10-18
sudo systemsetup -setremotelogin on
lsof -nP -iTCP:22 -sTCP:LISTEN          # verify

# 2. tmux + mosh — installed 2026-10-18 (tmux 3.8, mosh 1.4.0)
brew install tmux mosh

# 3. Authorize the phone's key (no authorized_keys existed before 2026-10-18)
#    Generate a key in Blink/Termius, then paste the public key here:
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo '<phone-public-key>' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
```

### Daily loop

```bash
ssh vincent@MacBook-Pro-2.local     # same Wi-Fi (Bonjour); Tailscale 100.x address off-LAN
mosh vincent@MacBook-Pro-2.local    # preferred on cellular: survives network switches and lock
tmux new -As omp                    # first time
tmux attach -t omp                  # after any disconnect
omp                                 # inside tmux
```

### Trap: non-interactive SSH shells do not read .zshrc

`ssh host <command>` and mosh's remote `mosh-server` startup run **non-interactive** zsh, which
never sources `.zshrc`/`.zprofile`. sshd hands them a minimal `PATH` without `/opt/homebrew/bin`,
so `tmux` and `mosh-server` come back `command not found` and **mosh fails outright** with
`Did not find mosh server startup message`. Measured here on 2026-10-18 before the fix:

```
$ ssh vincent@127.0.0.1 'tmux -V'
zsh:1: command not found: tmux
$ mosh vincent@127.0.0.1
/opt/homebrew/bin/mosh: Did not find mosh server startup message.
```

Fixed by adding a plain PATH export to `~/.zshenv`, which every zsh reads:

```sh
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"
```

**Why mosh + tmux and not plain SSH:** a phone switches between Wi-Fi and cellular, locks the
screen, and gets backgrounded. Plain SSH drops the connection; mosh keeps the session alive
across those changes, and tmux keeps the process alive even if the client dies.

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
