#!/bin/bash
# Installs the Novest relay on Hermes. Run as root from this folder:  sudo bash setup.sh <public-ip>
# Not idempotent by choice: it REFUSES if the user, the folders, the unit or a ufw rule for 8443 already exist
# (it never overwrites or backs up). Run teardown.sh first to start over. Installs nothing from the network.
set -euo pipefail
cd "$(dirname "$0")"

U=novest-relay; PORT=8443; LIB=/usr/local/lib/novest-relay; ETC=/etc/novest-relay; UNIT=/etc/systemd/system/novest-relay.service
die() { echo "REFUSED: $*" >&2; exit 1; }

[[ $(id -u) -eq 0 ]] || die "run as root: sudo bash setup.sh <public-ip>"
[[ $# -eq 1 ]] || die "usage: sudo bash setup.sh <public-ip> (the server's public IPv4)"
IP=$1
[[ $IP =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]] || die "'$IP' is not an IPv4 address"
for o in "${BASH_REMATCH[@]:1}"; do (( 10#$o <= 255 )) || die "'$IP' is not an IPv4 address"; done
[[ $IP =~ ^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.|2(2[4-9]|[3-5][0-9])\.) ]] \
  && die "$IP is not a public address; pass the server's public IPv4"
[[ -f relay.mjs && -f novest-relay.service ]] || die "relay.mjs and novest-relay.service must sit next to setup.sh"
for c in openssl curl sha256sum ss systemctl ufw useradd; do command -v "$c" >/dev/null || die "$c not found"; done

if ! ufw status | grep -q '^Status: active'; then
  die "ufw is not active; it is the only firewall layer on this host (no Hetzner Cloud Firewall). Enable ufw with SSH allowed first, then re-run."
fi
ufw status | grep -Eq "^${PORT}(/tcp)?[[:space:]]" && die "a ufw rule for ${PORT} already exists; remove it or run teardown.sh"

NODE_CMD=$(command -v node || true)
[[ -n $NODE_CMD ]] || die "node not found in root's PATH. Install a system Node 20+ (root-owned, e.g. /usr/bin/node) yourself, then re-run. This script never installs anything."
NODE=$(readlink -f "$NODE_CMD")
node_info="path=$NODE owner=$(stat -c %U "$NODE") mode=$(stat -c %a "$NODE")"
[[ $NODE =~ ^[A-Za-z0-9/._+-]+$ ]] || die "odd characters in node path. Found: $node_info"
case $NODE in /home/*|/root/*|/tmp/*|/var/tmp/*) die "node must not live under /home, /root or /tmp. Found: $node_info";; esac
[[ $(stat -c %U "$NODE") == root ]] || die "node must be root-owned. Found: $node_info"
(( (8#$(stat -c %a "$NODE") & 8#022) == 0 )) || die "node must not be group/world writable. Found: $node_info"
d=$(dirname "$NODE")
while [[ $d != / ]]; do
  [[ $(stat -c %U "$d") == root ]] && (( (8#$(stat -c %a "$d") & 8#022) == 0 )) || die "directory $d (above node) is not root-owned and non-writable. Found: $node_info"
  d=$(dirname "$d")
done
NODE_VER=$("$NODE" -p 'process.versions.node')
(( ${NODE_VER%%.*} >= 20 )) || die "node must be >= 20. Found: $node_info version=$NODE_VER"

[[ -z $(ss -ltnH "sport = :$PORT") ]] || die "port $PORT is already in use"
id "$U" >/dev/null 2>&1 && die "user $U already exists; run teardown.sh first"
[[ -e $ETC || -e $LIB || -e $UNIT ]] && die "$ETC, $LIB or $UNIT already exists; run teardown.sh first"

useradd --system --no-create-home --shell /usr/sbin/nologin "$U"
install -d -o root -g root -m 755 "$LIB"
install -o root -g root -m 644 relay.mjs "$LIB/relay.mjs"
install -d -o root -g root -m 700 "$ETC"
(umask 077; openssl ecparam -name prime256v1 -genkey -noout -out "$ETC/tls.key")
chmod 600 "$ETC/tls.key"
openssl req -new -x509 -key "$ETC/tls.key" -sha256 -days 730 -subj "/CN=novest-relay" -addext "subjectAltName=IP:$IP" -out "$ETC/tls.crt"
chmod 644 "$ETC/tls.crt"
KEY=$(openssl rand -hex 32)
printf '%s' "$KEY" | sha256sum | cut -d' ' -f1 > "$ETC/key.sha256"
chmod 600 "$ETC/key.sha256"

tmpl=$(<novest-relay.service)
(umask 022; printf '%s\n' "${tmpl//@NODE@/$NODE}" > "$UNIT")
chown root:root "$UNIT"; chmod 644 "$UNIT"
ufw allow "$PORT/tcp" comment novest-relay
systemctl daemon-reload
systemctl enable --now novest-relay

for _ in $(seq 1 20); do [[ -n $(ss -ltnH "sport = :$PORT") ]] && break; sleep 0.5; done
systemctl is-active -q novest-relay || { journalctl -u novest-relay -n 20 --no-pager >&2; die "service did not start (key was NOT shown; run teardown.sh and retry)"; }

IMG=/n/wp-content/uploads/2026/11/WhatsApp-Image-2026-11-04-at-15.40.38-2-1536x2048.jpeg
IMG_SHA=d580dcf07676857e71cf3246b15df32224e4305bbfb0c83cb3b11f6d4c641041
FEED_UA='ADA-TRNC-Health/1.0 (+https://getadaapp.com; partner listing sync; getadaapp@gmail.com)'
IMG_UA='ADA-TRNC-Health/1.0 (+partner image mirror)'
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
FAILS=0
call() {
  local with_key=$1; shift
  if [[ $with_key == key ]]; then
    printf 'Authorization: Bearer %s\n' "$KEY" | curl -sS --max-time 90 --cacert "$ETC/tls.crt" --connect-to "$IP:$PORT:127.0.0.1:$PORT" -H @- "$@"
  else
    curl -sS --max-time 90 --cacert "$ETC/tls.crt" --connect-to "$IP:$PORT:127.0.0.1:$PORT" "$@"
  fi
}
check() {
  local name=$1 want=$2 got=$3
  if [[ $got == "$want" ]]; then echo "  PASS $name -> $got"; else echo "  FAIL $name -> $got (wanted $want)"; FAILS=$((FAILS+1)); fi
}
BASE="https://$IP:$PORT"
echo "local checks:"
check "no key" 401 "$(call nokey -o /dev/null -w '%{http_code}' "$BASE/n/wp-json/wp/v2/properties?per_page=1" || echo err)"
check "POST" 405 "$(call nokey -o /dev/null -w '%{http_code}' -X POST "$BASE/n/wp-json/wp/v2/properties" || echo err)"
check "/n/wp-admin/ with key" 403 "$(call key -o /dev/null -w '%{http_code}' "$BASE/n/wp-admin/" || echo err)"
check "properties?per_page=1 with key (positive control)" 200 "$(call key -A "$FEED_UA" -o /dev/null -w '%{http_code}' "$BASE/n/wp-json/wp/v2/properties?per_page=1" || echo err)"
check "image with key (positive control)" 200 "$(call key -A "$IMG_UA" -o "$WORK/img" -w '%{http_code}' "$BASE$IMG" || echo err)"
check "curl's default User-Agent with key" 400 "$(call key -A 'curl/8' -o /dev/null -w '%{http_code}' "$BASE/n/wp-json/wp/v2/properties?per_page=1" || echo err)"
check "  ...and its error code" bad_user_agent "$(call key -A 'curl/8' -D - -o /dev/null "$BASE/n/wp-json/wp/v2/properties?per_page=1" | tr -d '\r' | sed -n 's/^x-relay-error: //Ip' || echo err)"
check "image sha256" "$IMG_SHA" "$(sha256sum "$WORK/img" 2>/dev/null | cut -d' ' -f1)"

echo
echo "================================================================"
echo "Copy into GitHub production secret NOVEST_RELAY_KEY NOW. It is not stored anywhere:"
echo "$KEY"
echo "----------------------------------------------------------------"
echo "GitHub production secret NOVEST_RELAY_URL:"
echo "https://$IP:$PORT"
echo "----------------------------------------------------------------"
echo "GitHub production secret NOVEST_RELAY_CA (whole PEM):"
cat "$ETC/tls.crt"
echo "================================================================"
(( FAILS == 0 )) || { echo "$FAILS local check(s) FAILED; do not wire the workflow yet" >&2; exit 1; }
echo "all local checks passed"
