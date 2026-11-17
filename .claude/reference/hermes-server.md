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

