#!/bin/bash
# Removes the Novest relay from Hermes. Run as root: sudo bash teardown.sh. Idempotent: skips what is already gone.
set -euo pipefail
U=novest-relay; PORT=8443
[[ $(id -u) -eq 0 ]] || { echo "run as root" >&2; exit 1; }

if [[ -e /etc/systemd/system/novest-relay.service ]]; then
  systemctl disable --now novest-relay || true
  rm -f /etc/systemd/system/novest-relay.service
  systemctl daemon-reload
else
  echo "unit already gone"
fi
if command -v ufw >/dev/null && ufw status | grep -Eq "^${PORT}/tcp[[:space:]]+ALLOW"; then
  ufw delete allow "$PORT/tcp"
else
  echo "ufw rule already gone"
fi
rm -rf /usr/local/lib/novest-relay /etc/novest-relay
if id "$U" >/dev/null 2>&1; then userdel "$U"; else echo "user already gone"; fi
echo "now delete GitHub secrets NOVEST_RELAY_URL/KEY/CA and variable NOVEST_ROUTE"
