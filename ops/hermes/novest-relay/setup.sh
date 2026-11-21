#!/bin/bash
# Installs the Novest relay on Hermes. Normally run by provision.sh (on the Mac), which uploads a staging dir:
#   sudo bash setup.sh --staging <dir>     <dir> holds `ip` (the public IPv4) and `key.sha256` (the relay key's hash)
#   bash setup.sh --dry-run                prints every command with placeholders; needs no root and touches nothing
#   sudo bash setup.sh --rotate-cert --staging <dir>   replaces the TLS key+cert of an installed relay (<dir> holds `ip` only);
#   bash setup.sh --rotate-cert --dry-run              the relay key hash and every other file are left untouched
# This script never receives, generates or prints the relay key (only its sha256), and never prints the IP.
# Not idempotent by choice: it REFUSES if the user, the folders, the unit or a ufw rule for 8443 already exist
# (it never overwrites or backs up). Run teardown.sh first to start over. Installs nothing from the network.
# Exit codes: 0 done; 3 REFUSED BEFORE CHANGING ANYTHING (preflight; nothing to remove); 1 failed after it started changing
# things (install: run teardown.sh; rotation: the old key+cert were restored whenever the new ones were already in place).
set -euo pipefail
cd "$(dirname "$0")"

U=novest-relay; PORT=8443; LIB=/usr/local/lib/novest-relay; ETC=/etc/novest-relay; UNIT=/etc/systemd/system/novest-relay.service
PRE=1
die() { echo "REFUSED: $*" >&2; exit $(( PRE ? 3 : 1 )); }
USAGE="usage: sudo bash setup.sh --staging <dir>   |   sudo bash setup.sh --rotate-cert --staging <dir>   |   bash setup.sh [--rotate-cert] --dry-run"

DRY=0; ROT=0; STG=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run) DRY=1; shift;;
    --rotate-cert) ROT=1; shift;;
    --staging) [[ $# -ge 2 ]] || die "$USAGE"; STG=$2; shift 2;;
    *) die "$USAGE";;
  esac
done
if (( DRY )); then
  [[ -n $STG ]] || STG='<staging-dir>'
  IP='<ip>'; HASH='<sha256(key)>'
else
  [[ -n $STG ]] || die "$USAGE"
fi

say() { printf '+ %s\n' "$*"; }
chk() { printf 'check: %s\n' "$*"; }
run() { if (( DRY )); then printf '+'; printf ' %s' "$@"; printf '\n'; else "$@"; fi; }

if (( DRY )); then
  echo "DRY RUN: nothing below is executed"
  chk "running as root, and SUDO_USER is a non-root user"
  if (( ROT )); then
    chk "staging dir matches ^/tmp/novest-relay\\.[A-Za-z0-9]+\$, owned by SUDO_USER, not group/world writable; ip is a plain file"
  else
    chk "staging dir matches ^/tmp/novest-relay\\.[A-Za-z0-9]+\$, owned by SUDO_USER, not group/world writable; ip and key.sha256 are plain files"
  fi
  chk "ip is a public IPv4 (not 0/10/127/169.254/192.168/172.16-31/100.64-127/224+)"
  (( ROT )) || chk "key.sha256 matches ^[0-9a-f]{64}\$"
  if (( ROT )); then say "read ip from $STG, then rm -f $STG/ip"; else say "read ip and key.sha256 from $STG, then rm -f $STG/ip $STG/key.sha256"; fi
else
  [[ $(id -u) -eq 0 ]] || die "run as root: sudo bash setup.sh --staging <dir>"
  [[ -n ${SUDO_USER:-} && $SUDO_USER != root ]] || die "run it with sudo from the operator account (SUDO_USER is needed to hand the public certificate back)"
  [[ $STG =~ ^/tmp/novest-relay\.[A-Za-z0-9]+$ ]] || die "staging dir must look like /tmp/novest-relay.XXXXXX"
  [[ -d $STG && ! -L $STG ]] || die "staging dir missing or a symlink"
  [[ $(pwd -P) == "$(cd "$STG" && pwd -P)" ]] || die "setup.sh is not running from the staging dir"
  [[ -f setup.sh && ! -L setup.sh ]] || die "setup.sh in the staging dir is missing or a symlink"
  [[ $(stat -c %U "$STG") == "$SUDO_USER" ]] || die "staging dir is not owned by $SUDO_USER"
  (( (8#$(stat -c %a "$STG") & 8#022) == 0 )) || die "staging dir is group/world writable"
  INPUTS=(ip); (( ROT )) || INPUTS=(ip key.sha256)
  for f in "${INPUTS[@]}"; do [[ -f $STG/$f && ! -L $STG/$f ]] || die "$STG/$f is missing or not a plain file"; done
  IP=$(<"$STG/ip"); HASH=""; (( ROT )) || HASH=$(<"$STG/key.sha256")
  rm -f "$STG/ip" "$STG/key.sha256"
  [[ $IP =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]] || die "the staged ip is not an IPv4 address"
  for o in "${BASH_REMATCH[@]:1}"; do (( 10#$o <= 255 )) || die "the staged ip is not an IPv4 address"; done
  [[ $IP =~ ^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.|2(2[4-9]|[3-5][0-9])\.) ]] \
    && die "the staged ip is not a public address"
  (( ROT )) || [[ $HASH =~ ^[0-9a-f]{64}$ ]] || die "key.sha256 is not 64 lowercase hex characters"
fi

# Check-and-curl helpers shared by install and rotation (only checks that need no key run here; the keyed ones run
# from the Mac through the public port, see provision.sh).
FAILS=0
check() {
  local name=$1 want=$2 got=$3
  if [[ $got == "$want" ]]; then echo "  PASS $name -> $got"; else echo "  FAIL $name -> $got (wanted $want)"; FAILS=$((FAILS+1)); fi
}
local_curl() { curl -sS --max-time 30 --cacert "$ETC/tls.crt" --connect-to "$IP:$PORT:localhost:$PORT" "$@" 2>/dev/null; }
P=/n/wp-json/wp/v2/properties

if (( ROT )); then
  # Order: (1) write BOTH new files under temporary names and back up the live pair (a failure up to here leaves the live
  # pair untouched); (2) mv the key, then the cert (atomic renames, same directory). Key first because the old key
  # without the old cert is useless anyway and the cert is what clients pin; if the second mv fails the old key is put
  # back, so the live pair is always one consistent pair. (3) restart; if the service does not come back, both old
  # files are restored and it is restarted again, and the script says so. key.sha256 is never touched.
  NEWK="$ETC/tls.key.new"; NEWC="$ETC/tls.crt.new"
  if (( DRY )); then
    chk "relay is installed: user $U, $ETC, $ETC/tls.key, $ETC/tls.crt, $ETC/key.sha256 and $UNIT exist (else REFUSED)"
    say "(umask 077) openssl ecparam -name prime256v1 -genkey -noout -out $NEWK   # the TLS private key never leaves this server"
    say "chmod 600 $NEWK"
    say "openssl req -new -x509 -key $NEWK -sha256 -days 730 -subj /CN=novest-relay -addext subjectAltName=IP:<ip> -out $NEWC"
    say "chmod 644 $NEWC"
    say "cp -p $ETC/tls.key $ETC/tls.key.old; cp -p $ETC/tls.crt $ETC/tls.crt.old   # backup of the live pair"
    say "mv $NEWK $ETC/tls.key   # key first, then cert; key.sha256 is not touched"
    say "mv $NEWC $ETC/tls.crt   # if this fails: restore the old key, stop"
    say "systemctl restart novest-relay   # a failing restart is caught, not fatal: it triggers the rollback below"
    say "wait up to 10 s for port $PORT to listen"
    say "curl --cacert $ETC/tls.crt --connect-to <ip>:$PORT:localhost:$PORT -o /dev/null -w '%{http_code}' https://<ip>:$PORT$P?per_page=1   # expect 401 (no key), NEW cert pinned"
    say "curl --cacert $ETC/tls.crt --connect-to <ip>:$PORT:localhost:$PORT -o /dev/null -w '%{http_code}' -X POST https://<ip>:$PORT$P   # expect 405"
    say "sleep 3; systemctl is-active -q novest-relay and port $PORT still listening   # catches a Restart=always flap"
    say "install -o <operator> -m 644 $ETC/tls.crt $STG/tls.crt"
    say "(ANY failure above: print the last 20 journal lines, restore tls.key.old and tls.crt.old, restart, say 'old certificate restored', exit 1; only when all pass: rm -f the .old files)"
    echo "certificate rotated (dry run)"
    exit 0
  fi
  id "$U" >/dev/null 2>&1 || die "user $U does not exist: the relay is not installed (rotation needs an installed relay)"
  for f in "$ETC/tls.key" "$ETC/tls.crt" "$ETC/key.sha256" "$UNIT"; do [[ -f $f ]] || die "$f is missing: the relay is not installed (rotation needs an installed relay)"; done
  command -v openssl >/dev/null && command -v curl >/dev/null && command -v ss >/dev/null && command -v systemctl >/dev/null || die "openssl, curl, ss and systemctl are required"
  [[ ! -e $NEWK && ! -e $NEWC && ! -e $ETC/tls.key.old && ! -e $ETC/tls.crt.old ]] || die "a .new or .old file is left over in $ETC from an earlier run; inspect and remove it first"
  PRE=0
  (umask 077; openssl ecparam -name prime256v1 -genkey -noout -out "$NEWK")
  chmod 600 "$NEWK"
  openssl req -new -x509 -key "$NEWK" -sha256 -days 730 -subj "/CN=novest-relay" -addext "subjectAltName=IP:$IP" -out "$NEWC" || { rm -f "$NEWK" "$NEWC"; die "could not create the new certificate; nothing was replaced"; }
  chmod 644 "$NEWC"
  (umask 077; cp -p "$ETC/tls.key" "$ETC/tls.key.old"; cp -p "$ETC/tls.crt" "$ETC/tls.crt.old")
  mv "$NEWK" "$ETC/tls.key"
  mv "$NEWC" "$ETC/tls.crt" || { mv -f "$ETC/tls.key.old" "$ETC/tls.key"; rm -f "$NEWC" "$ETC/tls.crt.old"; die "could not install the new certificate; the old key and certificate are in place"; }
  listening() { [[ -n $(ss -ltnH "sport = :$PORT") ]]; }
  rot_ok=1; why=""
  systemctl restart novest-relay || { rot_ok=0; why="systemctl restart failed"; }
  if (( rot_ok )); then
    for _ in $(seq 1 20); do listening && break; sleep 0.5; done
    listening || { rot_ok=0; why="the relay is not listening on :$PORT"; }
  fi
  g401=err; g405=err
  if (( rot_ok )); then
    g401=$(local_curl -o /dev/null -w '%{http_code}' "https://$IP:$PORT$P?per_page=1") || g401=err
    g405=$(local_curl -o /dev/null -w '%{http_code}' -X POST "https://$IP:$PORT$P") || g405=err
    [[ $g401 == 401 && $g405 == 405 ]] || { rot_ok=0; why="the local checks with the new certificate failed (no key: $g401, POST: $g405)"; }
  fi
  if (( rot_ok )); then
    sleep 3
    { systemctl is-active -q novest-relay && listening; } || { rot_ok=0; why="the service is not stable after the restart"; }
  fi
  if (( rot_ok )); then
    install -o "$SUDO_USER" -m 644 "$ETC/tls.crt" "$STG/tls.crt" || { rot_ok=0; why="could not hand the public certificate back"; }
  fi
  if (( ! rot_ok )); then
    echo "FAILED: $why" >&2
    journalctl -u novest-relay -n 20 --no-pager >&2 || true
    mv -f "$ETC/tls.key.old" "$ETC/tls.key"; mv -f "$ETC/tls.crt.old" "$ETC/tls.crt"
    systemctl restart novest-relay || true
    echo "old certificate restored (key and certificate; the relay was restarted with them). Set no secret." >&2
    exit 1
  fi
  rm -f "$ETC/tls.key.old" "$ETC/tls.crt.old"
  echo "local checks (no key, NEW certificate pinned):"
  check "no key" 401 "$g401"
  check "POST" 405 "$g405"
echo "certificate rotated; relay listening on :$PORT"
  exit 0
fi

if (( DRY )); then
  chk "relay.mjs, novest-relay.service and teardown.sh sit next to setup.sh"
  chk "openssl curl ss systemctl ufw useradd are installed"
  chk "ufw is active (the only firewall layer on this host)"
  chk "no ufw rule for $PORT exists"
  chk "node is on root's PATH, root-owned, not group/world writable, every directory above it root-owned and non-writable, not under /home /root /tmp /var/tmp, version >= 20 (otherwise stop and report path/owner/version)"
  chk "port $PORT is free"
  chk "user $U does not exist"
  chk "$ETC, $LIB and $UNIT do not exist"
  NODE='<node-path>'
else
  for f in relay.mjs novest-relay.service teardown.sh; do [[ -f $f && ! -L $f ]] || die "$f must sit next to setup.sh as a plain file (not a symlink)"; done
  for c in openssl curl ss systemctl ufw useradd; do command -v "$c" >/dev/null || die "$c not found"; done

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
fi

PRE=0
run useradd --system --no-create-home --shell /usr/sbin/nologin "$U"
run install -d -o root -g root -m 755 "$LIB"
run install -o root -g root -m 644 relay.mjs "$LIB/relay.mjs"
run install -o root -g root -m 755 teardown.sh "$LIB/teardown.sh"
run install -d -o root -g root -m 700 "$ETC"
if (( DRY )); then
  say "(umask 077) openssl ecparam -name prime256v1 -genkey -noout -out $ETC/tls.key   # the TLS private key never leaves this server"
else
  (umask 077; openssl ecparam -name prime256v1 -genkey -noout -out "$ETC/tls.key")
fi
run chmod 600 "$ETC/tls.key"
run openssl req -new -x509 -key "$ETC/tls.key" -sha256 -days 730 -subj "/CN=novest-relay" -addext "subjectAltName=IP:$IP" -out "$ETC/tls.crt"
run chmod 644 "$ETC/tls.crt"
if (( DRY )); then
  say "(umask 077) write <sha256(key)> to $ETC/key.sha256"
else
  (umask 077; printf '%s\n' "$HASH" > "$ETC/key.sha256")
fi
run chmod 600 "$ETC/key.sha256"

if (( DRY )); then
  say "render novest-relay.service with @NODE@ replaced by $NODE -> $UNIT (umask 022)"
else
  tmpl=$(<novest-relay.service)
  (umask 022; printf '%s\n' "${tmpl//@NODE@/$NODE}" > "$UNIT")
fi
run chown root:root "$UNIT"
run chmod 644 "$UNIT"
run ufw allow "$PORT/tcp" comment novest-relay
run systemctl daemon-reload
run systemctl enable --now novest-relay

if (( DRY )); then
  say "wait up to 10 s for port $PORT to listen"
  say "systemctl is-active -q novest-relay   # else print the last 20 journal lines and stop"
else
  for _ in $(seq 1 20); do [[ -n $(ss -ltnH "sport = :$PORT") ]] && break; sleep 0.5; done
  systemctl is-active -q novest-relay || { journalctl -u novest-relay -n 20 --no-pager >&2; die "service did not start; run: sudo bash $LIB/teardown.sh"; }
fi

run install -o "${SUDO_USER:-<operator>}" -m 644 "$ETC/tls.crt" "$STG/tls.crt"

if (( DRY )); then
  say "curl --cacert $ETC/tls.crt --connect-to <ip>:$PORT:localhost:$PORT -o /dev/null -w '%{http_code}' https://<ip>:$PORT$P?per_page=1   # expect 401 (no key)"
  say "curl --cacert $ETC/tls.crt --connect-to <ip>:$PORT:localhost:$PORT -o /dev/null -w '%{http_code}' -X POST https://<ip>:$PORT$P   # expect 405"
  echo "relay listening on :$PORT (dry run)"
  exit 0
fi
echo "local checks (no key):"
check "no key" 401 "$(local_curl -o /dev/null -w '%{http_code}' "https://$IP:$PORT$P?per_page=1" || echo err)"
check "POST" 405 "$(local_curl -o /dev/null -w '%{http_code}' -X POST "https://$IP:$PORT$P" || echo err)"
(( FAILS == 0 )) || { echo "$FAILS local check(s) FAILED; run: sudo bash $LIB/teardown.sh" >&2; exit 1; }
echo "relay listening on :$PORT"
