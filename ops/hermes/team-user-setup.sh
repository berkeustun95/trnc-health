#!/bin/bash
# One-time move (2026-10-13) of the agent team from the gateway user `hermes` to its own user `adateam`,
# so the team cannot write ~hermes/.hermes (SOUL.md, config), the claude binary, /usr/local/bin or any
# gateway file. Run as root from a folder holding the new ada-team, ada-sync-claude-key,
# managed-settings.json and sudoers-hermes, with hermes-gateway stopped and no team job running.
set -euo pipefail
cd "$(dirname "$0")"
H=/home/hermes; T=/home/adateam; CLAUDE_VER=2.1.296
[[ $(id -u) -eq 0 ]] || { echo "run as root" >&2; exit 1; }
if systemctl is-active -q hermes-gateway; then echo "stop hermes-gateway first" >&2; exit 1; fi
if pgrep -u hermes -f "claude -p" >/dev/null; then echo "a team job is running" >&2; exit 1; fi
visudo -cf sudoers-hermes

B=/var/backups/ada-hermes-$(date +%Y%m%d-%H%M%S); install -d -m 700 "$B"
cp -p /etc/sudoers.d/50-hermes /etc/claude-code/managed-settings.json /usr/local/bin/ada-team \
      /usr/local/sbin/ada-sync-claude-key "$H/.hermes/config.yaml" "$B/"
echo "backup: $B"

id adateam >/dev/null 2>&1 || useradd -m -s /bin/bash -c "ADA agent team" adateam
chmod 750 "$T"

install -d -o root -g root -m 755 /usr/local/lib/claude
install -o root -g root -m 755 "$H/.local/share/claude/versions/$CLAUDE_VER" "/usr/local/lib/claude/$CLAUDE_VER"
ln -sfn "/usr/local/lib/claude/$CLAUDE_VER" /usr/local/bin/claude

old_wts=$(runuser -u hermes -- git -C "$H/ada" worktree list --porcelain | sed -n "s#^worktree $H/##p" | grep -vx ada || true)
for d in ada $old_wts ada-jobs .claude .claude.json .npm .expo; do
  if [[ -e "$H/$d" ]]; then mv "$H/$d" "$T/$d"; fi
done
install -d -m 700 "$T/.ssh" "$T/.config" "$T/.cache"
for f in ada_bot ada_bot.pub config known_hosts; do mv "$H/.ssh/$f" "$T/.ssh/$f"; done
if [[ -e "$H/.config/eas-cli-nodejs" ]]; then mv "$H/.config/eas-cli-nodejs" "$T/.config/"; fi
for c in claude eas-cli node-gyp; do
  if [[ -e "$H/.cache/$c" ]]; then mv "$H/.cache/$c" "$T/.cache/"; fi
done
chown -R adateam:adateam "$T"
runuser -u adateam -- git -C "$T/ada" worktree repair $(for w in $old_wts; do echo "$T/$w"; done)

install -o root -g root -m 755 ada-team /usr/local/bin/ada-team
install -o root -g root -m 700 ada-sync-claude-key /usr/local/sbin/ada-sync-claude-key
install -o root -g root -m 644 managed-settings.json /etc/claude-code/managed-settings.json
install -o root -g root -m 440 sudoers-hermes /etc/sudoers.d/50-hermes
visudo -c >/dev/null
/usr/local/sbin/ada-sync-claude-key
rm -f "$H/.config/ada/anthropic.key"; rmdir "$H/.config/ada" 2>/dev/null || true

sed -i "s#^  cwd: \"$H/ada\"#  cwd: \"$H\"#" "$H/.hermes/config.yaml"
grep -q "^  cwd: \"$H\"" "$H/.hermes/config.yaml" || { echo "config.yaml terminal.cwd not updated" >&2; exit 1; }
echo "done; start hermes-gateway after the checks"
