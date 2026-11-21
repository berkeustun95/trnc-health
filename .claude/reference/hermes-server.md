# Hermes server
Moved out of `CLAUDE.md` (2026-11-16) to cut per-message context; still binding. CLAUDE.md links here.

**Hermes server** (Hetzner `<HERMES_HOST>`, address + SSH route in vault `2026-10-18_claude-code-github-identity.md`; Telegram @ada_dev_team_bot, Berke only; setup in `ops/hermes/`). The
team runs there as user `adateam` (since 2026-10-13; the gateway is user `hermes`, which the team cannot read or
write; `ops/hermes/team-user-setup.sh`) as GitHub `ada-hermes-bot` (Write): it pushes only `agent/*` branches, cannot
read any production credential, and acts through three root-owned wrappers (`sudo -n /usr/local/sbin/…`; sudoers
allows the team only `ada-publish preview|preview-check`, `ada-migrate dry` and `ada-pr`):
`ada-publish preview agent/<slug>-14 "<msg>"` (1.4.0 Preview; refuses agent commits touching config,
`package*.json`, `scripts/`, `.githooks/`, `.github/`), `ada-migrate dry <file>`, `ada-pr agent/<slug> <base> "<title>"` (also
`ada-pr comment|close <n>`, agent/* PRs only, never merge). `ada-team` (root-owned, `/usr/local/bin`) re-runs itself as
`adateam` with the root-owned `/usr/local/bin/claude` (auto-update off; upgrading = a root install) and resets `~/ada/.claude/agents` to origin/main before every run: agent-definition
changes go through an `agent/*` PR and apply after Berke merges. Managed-policy paths need `//` for absolute
(`Read(/etc/…)` is relative to the settings file and matched nothing until 2026-10-13); `Edit(path)` covers Write.
Production OTA (`ada-publish production`) and migration apply are outside the team's sudoers (and managed policy);
Berke asks Hermes for them, and production then waits for his `GO <code>` reply to the separate gate bot.


**Novest relay** (server user `novest-relay`, port 8443 opened in ufw): a GET-only relay to coldwellbankernovest.com, because GitHub runners are intermittently blocked by Novest and Hermes is not. Provisioned from the Mac by `ops/hermes/novest-relay/provision.sh [--dry-run] [<ssh-alias>]` (generates the key locally and sets the three GitHub production secrets over stdin; `setup.sh` runs on Hermes, only ever sees sha256(key) and never prints the key or the IP). Certificate rotation (730-day self-signed cert): `provision.sh --rotate-cert [--dry-run] [<ssh-alias>]` makes a new TLS key+cert on Hermes (the TLS key never leaves it), keeps the relay key, and sets only `NOVEST_RELAY_CA`; GitHub runs between the restart and that update fail TLS pinning, so rotate outside a `novest-images` run. Unauthenticated requests are also capped globally (120/min, all IPs; a valid key is never counted or refused by it). Every own refusal carries `x-relay-source: relay`, every passed-through Novest answer `x-relay-source: upstream` plus a validated `retry-after` (digits or IMF-date, else dropped). The mirror (`novest-images`) retries ONLY Novest's 429 and relay `busy`, at most 3 times per run in total (Retry-After clamped 1-60 s, else 10/20/40 s), then fails red naming the source; never `daily_cap`/`rate_limited`/auth refusals. On the relay route it waits `NOVEST_MEDIA_GAP_MS` (default 10000 relay, 0 direct, integer 0-60000) between `/media` lookups (`scripts/lib/novest-fetch-policy.mjs`; sync-novest is unaffected). Removed by `teardown.sh` (left at `/usr/local/lib/novest-relay/teardown.sh`). It holds no production credential. The GitHub switch is the variable `NOVEST_ROUTE` (unset/`direct`, `relay-dispatch`, `relay`; rollback = unset it); header of `.github/workflows/novest-images.yml`.
