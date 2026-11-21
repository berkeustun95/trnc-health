#!/bin/bash
# Provisions the Novest relay on Hermes from the Mac, in one run:
#   bash ops/hermes/novest-relay/provision.sh [--dry-run] [<ssh-alias>]      (alias defaults to ada-hermes)
#   bash ops/hermes/novest-relay/provision.sh --rotate-cert [--dry-run] [<ssh-alias>]   replaces only the TLS certificate
#     (new key + cert made ON Hermes, the private TLS key never leaves it) and sets only NOVEST_RELAY_CA; the relay key is not involved
# The relay key is generated here, lives only in a shell variable (never a file, never argv, never printed) and goes
# straight into the GitHub production secret NOVEST_RELAY_KEY over stdin. Hermes only ever gets sha256(key).
# The public IP is read from `ssh -G <alias>` and is never printed or put on any command line.
# NOVEST_ROUTE (the GitHub variable that switches the route on) is never touched here.
# Every ssh call runs with -o LogLevel=ERROR; the calls that capture output send ssh's stderr to /dev/null and print a fixed
# message instead, so a resolved IP in ssh diagnostics never reaches the log. The interactive setup call keeps its stderr
# (sudo prompt, setup output): a host-key-mismatch error from ssh itself can still name the host there.
# Exit codes of setup.sh: 3 = refused before changing anything, other non-zero = failed after it may have started.
# bash 3.2 compatible (macOS /bin/bash). --dry-run prints every command with placeholders and runs nothing.
set -euo pipefail
[[ -z ${BASH_ENV:-} ]] || { echo "REFUSED: BASH_ENV is set" >&2; exit 1; }
case ":${SHELLOPTS:-}:" in
  *:xtrace:*) set +x; echo "REFUSED: xtrace is on (it would print the key)" >&2; exit 1;;
  *:allexport:*) echo "REFUSED: allexport is on (every shell variable, the key included, would reach child processes)" >&2; exit 1;;
esac
set +x
unset GH_DEBUG DEBUG SSLKEYLOGFILE
SSH=(ssh -o LogLevel=ERROR)

REPO=berkeustun95/trnc-health; PORT=8443
GH=${NOVEST_GH:-gh}
HERE=$(cd "$(dirname "$0")" && pwd)
IMG=/n/wp-content/uploads/2026/11/WhatsApp-Image-2026-11-04-at-15.40.38-2-1536x2048.jpeg
IMG_SHA=d580dcf07676857e71cf3246b15df32224e4305bbfb0c83cb3b11f6d4c641041
FEED_UA='ADA-TRNC-Health/1.0 (+https://getadaapp.com; partner listing sync; getadaapp@gmail.com)'
IMG_UA='ADA-TRNC-Health/1.0 (+partner image mirror)'
PROP=/n/wp-json/wp/v2/properties?per_page=1
TEARDOWN='/usr/local/lib/novest-relay/teardown.sh'

DRY=0; ROT=0; ALIAS=ada-hermes; SEEN_ALIAS=0
for a in "$@"; do
  case $a in
    --dry-run) DRY=1;;
    --rotate-cert) ROT=1;;
    -*) echo "usage: provision.sh [--rotate-cert] [--dry-run] [<ssh-alias>]" >&2; exit 1;;
    *) (( SEEN_ALIAS == 0 )) || { echo "usage: provision.sh [--rotate-cert] [--dry-run] [<ssh-alias>]" >&2; exit 1; }
       ALIAS=$a; SEEN_ALIAS=1;;
  esac
done
[[ $ALIAS =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || { echo "REFUSED: odd ssh alias" >&2; exit 1; }

if (( DRY && ROT )); then
  A='<ssh-alias>'
  echo "DRY RUN: nothing below is executed (no network, no ssh)"
  cat <<EOF
+ ssh -o LogLevel=ERROR -G $A | hostname line -> public IPv4, validated, never printed (setup.sh's private-range rules)
+ $GH api repos/$REPO/environments/production/secrets/public-key >/dev/null   # preflight; on 403: refuse, nothing changed
+ mktemp -d (700) holding setup.sh ip   # no relay key, no hash; trap-deleted
+ COPYFILE_DISABLE=1 tar --no-xattrs -c ... | ssh -o LogLevel=ERROR $A 'umask 077; d=\$(mktemp -d /tmp/novest-relay.XXXXXX) && tar -x -C "\$d" && printf %s "\$d"' 2>/dev/null   # -> <staging-dir>; ssh stderr discarded, a fixed message on failure
+ ssh -o LogLevel=ERROR -t $A 'sudo bash <staging-dir>/setup.sh --rotate-cert --staging <staging-dir>'   # sudo may prompt; exit 3 = refused before changing anything; stderr kept (a host-key-mismatch error from ssh itself can still name the host)
+ ssh -o LogLevel=ERROR $A 'cat <staging-dir>/tls.crt && rm -rf <staging-dir>' 2>/dev/null   # public certificate only
+ openssl x509 -in <public cert> -noout -text   # must parse, be EC P-256, IP SAN equals <ip> (compared, not printed); prints only the sha256 fingerprint
+ curl -q -K - (url on stdin) --cacert <NEW public cert>: no key -> 401   # proves the pin works; keyed checks are impossible here: the Mac does not have the relay key in a rotation
+ (any FAIL: stop, set no secret; if setup.sh already replaced the certificate, say plainly: the relay serves the NEW one, GitHub pins the OLD one, recovery = re-run --rotate-cert)
+ printf %s "<public cert PEM>" | $GH secret set NOVEST_RELAY_CA --env production --repo $REPO
note: runs of the GitHub job between the relay restart and this secret update fail TLS pinning; rotate outside a novest-images run.
reminder: NOVEST_RELAY_KEY, NOVEST_RELAY_URL and the variable NOVEST_ROUTE are not touched
EOF
  exit 0
fi
if (( DRY )); then
  A='<ssh-alias>'
  echo "DRY RUN: nothing below is executed (no network, no ssh)"
  cat <<EOF
+ ssh -o LogLevel=ERROR -G $A | hostname line -> public IPv4, validated, never printed (setup.sh's private-range rules)
+ $GH api repos/$REPO/environments/production/secrets/public-key >/dev/null   # preflight; on 403: refuse, nothing changed
+ KEY=\$(openssl rand -hex 32)   # shell variable only: no file, no argv, no echo
+ HASH=\$(printf %s "\$KEY" | shasum -a 256 | cut -d' ' -f1)   # <sha256(key)>
+ mktemp -d (700) holding relay.mjs novest-relay.service setup.sh teardown.sh key.sha256 ip   # trap-deleted
+ COPYFILE_DISABLE=1 tar --no-xattrs -c ... | ssh -o LogLevel=ERROR $A 'umask 077; d=\$(mktemp -d /tmp/novest-relay.XXXXXX) && tar -x -C "\$d" && printf %s "\$d"' 2>/dev/null   # -> <staging-dir>; ssh stderr discarded, a fixed message on failure
+ ssh -o LogLevel=ERROR -t $A 'sudo bash <staging-dir>/setup.sh --staging <staging-dir>'   # sudo may prompt; exit 3 = refused before changing anything; stderr kept (a host-key-mismatch error from ssh itself can still name the host)
+ ssh -o LogLevel=ERROR $A 'cat <staging-dir>/tls.crt && rm -rf <staging-dir>' 2>/dev/null   # public certificate only
+ openssl x509 -in <public cert> -noout -text   # must parse, be EC P-256, IP SAN equals <ip> (compared, not printed); prints only the sha256 fingerprint
+ curl -q -K - (url + Authorization header on stdin) --cacert <public cert>: no key -> 401
+ curl -q -K - -A '$FEED_UA' properties?per_page=1 with key -> 200
+ curl -q -K - -A '$IMG_UA' $IMG with key -> 200, body sha256 $IMG_SHA
+ curl -q -K - /n/wp-admin/ with key -> 403
+ curl -q -K - (curl default User-Agent) properties?per_page=1 with key -> 400
+ (any FAIL: stop, set no secret, print: ssh -t $A sudo bash $TEARDOWN; no teardown advice when setup.sh exited 3 = refused before changing anything)
+ printf %s "\$KEY" | $GH secret set NOVEST_RELAY_KEY --env production --repo $REPO
+ printf %s "https://<ip>:$PORT" | $GH secret set NOVEST_RELAY_URL --env production --repo $REPO
+ printf %s "<public cert PEM>" | $GH secret set NOVEST_RELAY_CA --env production --repo $REPO
+ unset KEY
reminder: the variable NOVEST_ROUTE is not touched; it stays unset until Berke sets it
EOF
  exit 0
fi

WORK=""; STG=""; KEY=""; INSTALLED=0; SET_DONE=""; SETUP_DONE=0; SETUP_REFUSED=0""
cleanup() { [[ -z $WORK ]] || rm -rf "$WORK"; KEY=""; }
trap cleanup EXIT
fail() {
  echo "FAILED: $*" >&2
  if [[ -z $SET_DONE ]]; then
    echo "No GitHub secret was set." >&2
  else
    echo "GitHub secrets ALREADY set in this run:${SET_DONE}. The ones not listed were NOT set, so the secrets are now inconsistent; do not set NOVEST_ROUTE." >&2
  fi
  if (( SETUP_REFUSED )); then
    echo "setup.sh refused before changing anything on Hermes; there is nothing to remove or restore." >&2
  elif (( ROT && SETUP_DONE )); then
    echo "The relay now serves the NEW certificate, but GitHub still pins the OLD one (NOVEST_RELAY_CA was not updated). Relay-routed runs fail TLS pinning until this is fixed. Recovery: re-run provision.sh --rotate-cert. Teardown is not needed." >&2
  elif (( ROT )); then
    echo "The relay stays installed (rotation changes only its certificate; setup.sh restores the old pair if the service would not restart). Teardown is not needed." >&2
  elif (( INSTALLED )); then
    echo "To remove the relay from Hermes: ssh -t $ALIAS sudo bash $TEARDOWN" >&2
  else
    echo "setup.sh had not run yet; nothing was installed on Hermes." >&2
  fi
  exit 1
}

for c in ssh openssl shasum curl tar awk; do command -v "$c" >/dev/null || fail "$c not found on this Mac"; done
command -v "$GH" >/dev/null || fail "$GH not found on this Mac"

# Same rules as setup.sh (a public, non-private IPv4).
valid_public_ipv4() {
  local ip=$1 o
  [[ $ip =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]] || return 1
  for o in "${BASH_REMATCH[@]:1}"; do (( 10#$o <= 255 )) || return 1; done
  [[ $ip =~ ^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.|2(2[4-9]|[3-5][0-9])\.) ]] && return 1
  return 0
}

IP=$("${SSH[@]}" -G "$ALIAS" 2>/dev/null | awk '$1=="hostname"{print $2; exit}') || IP=""
valid_public_ipv4 "$IP" || fail "the ssh alias '$ALIAS' does not resolve (ssh -G hostname) to a public IPv4 address"

GHERR=$("$GH" api "repos/$REPO/environments/production/secrets/public-key" 2>&1 >/dev/null) && GHRC=0 || GHRC=$?
if (( GHRC != 0 )); then
  if [[ $GHERR == *403* ]]; then
    echo "REFUSED: the GitHub identity in use cannot write production environment secrets (needs the Environments: write permission); nothing was changed" >&2
  else
    echo "REFUSED: the GitHub preflight for production environment secrets failed; nothing was changed" >&2
  fi
  exit 1
fi

WORK=$(mktemp -d); chmod 700 "$WORK"
mkdir "$WORK/up"
if (( ROT )); then
  UPFILES="setup.sh ip"
  cp "$HERE/setup.sh" "$WORK/up/setup.sh"
else
  KEY=$(openssl rand -hex 32)
  [[ $KEY =~ ^[0-9a-f]{64}$ ]] || fail "key generation returned an unexpected value"
  HASH=$(printf %s "$KEY" | shasum -a 256 | cut -d' ' -f1)
  [[ $HASH =~ ^[0-9a-f]{64}$ ]] || fail "hash computation returned an unexpected value"
  UPFILES="relay.mjs novest-relay.service setup.sh teardown.sh key.sha256 ip"
  for f in relay.mjs novest-relay.service setup.sh teardown.sh; do cp "$HERE/$f" "$WORK/up/$f"; done
  printf '%s\n' "$HASH" > "$WORK/up/key.sha256"
fi
printf '%s\n' "$IP" > "$WORK/up/ip"
STG=$(COPYFILE_DISABLE=1 tar --no-xattrs -c -C "$WORK/up" $UPFILES \
  | "${SSH[@]}" "$ALIAS" 'umask 077; d=$(mktemp -d /tmp/novest-relay.XXXXXX) && tar -x -C "$d" && printf %s "$d"' 2>/dev/null) || fail "ssh to $ALIAS failed (uploading the staging files to Hermes)"
rm -rf "$WORK/up"
[[ $STG =~ ^/tmp/novest-relay\.[A-Za-z0-9]+$ ]] || fail "unexpected staging path from Hermes"

SETUP_ARGS="--staging $STG"; (( ROT == 0 )) || SETUP_ARGS="--rotate-cert --staging $STG"
echo "note: ssh's own host-key-mismatch error, if one appears below, can still name the host; nothing else here prints it." >&2
SRC=0
"${SSH[@]}" -t "$ALIAS" "sudo bash $STG/setup.sh $SETUP_ARGS" || SRC=$?
if (( SRC != 0 )); then
  "${SSH[@]}" "$ALIAS" "rm -rf $STG" >/dev/null 2>&1 || true
  if (( SRC == 3 )); then SETUP_REFUSED=1; fail "setup.sh on Hermes refused (exit 3)"; fi
  INSTALLED=1
  fail "setup.sh on Hermes failed (exit $SRC)"
fi
INSTALLED=1; SETUP_DONE=1

PEM=$("${SSH[@]}" "$ALIAS" "cat $STG/tls.crt && rm -rf $STG" 2>/dev/null) || fail "ssh to $ALIAS failed (fetching the public certificate)"
[[ $PEM == *"BEGIN CERTIFICATE"* && $PEM != *"PRIVATE KEY"* ]] || fail "the fetched file is not a public certificate"
CA="$WORK/ca.pem"
printf '%s\n' "$PEM" > "$CA"
chmod 600 "$CA"
TXT=$(openssl x509 -in "$CA" -noout -text 2>/dev/null) || fail "the certificate does not parse"
[[ $TXT == *prime256v1* || $TXT == *P-256* ]] || fail "the certificate is not EC P-256"
SAN_RE="IP Address:${IP//./\\.}([^0-9.]|\$)"
[[ $TXT =~ $SAN_RE ]] || fail "the certificate's IP SAN does not equal the server address"
echo "certificate: $(openssl x509 -in "$CA" -noout -fingerprint -sha256 2>/dev/null)"

# url and Authorization header go to curl on stdin (-K -): the IP and the key are on no command line.
rcurl() {
  local withkey=$1 path=$2 out=$3; shift 3
  {
    printf 'url = "https://%s:%s%s"\n' "$IP" "$PORT" "$path"
    if [[ $withkey == key ]]; then printf 'header = "Authorization: Bearer %s"\n' "$KEY"; fi
  } | curl -q -sS -K - --max-time 90 --cacert "$CA" -o "$out" -w '%{http_code}' "$@" 2>/dev/null
}
FAILS=0
check() {
  local name=$1 want=$2 got=$3
  if [[ $got == "$want" ]]; then echo "  PASS $name -> $got"; else echo "  FAIL $name -> $got (wanted $want)"; FAILS=$((FAILS+1)); fi
}
if (( ROT )); then
  echo "keyed checks are skipped in a rotation: this Mac does not have the relay key (only GitHub does). The no-key check below proves the NEW certificate pin works."
  check "no key, NEW certificate pinned" 401 "$(rcurl nokey "$PROP" /dev/null || echo err)"
  (( FAILS == 0 )) || fail "the new certificate does not pass the pinned check"
  echo "note: runs of the GitHub novest-images job between the relay restart and the NOVEST_RELAY_CA update below fail TLS pinning."
  printf %s "$PEM" | "$GH" secret set NOVEST_RELAY_CA --env production --repo "$REPO" || fail "setting NOVEST_RELAY_CA failed (the relay already serves the NEW certificate: set NOVEST_RELAY_CA by hand from the certificate, or run --rotate-cert again)"
  echo "set NOVEST_RELAY_CA"
  echo "Done. Only NOVEST_RELAY_CA was changed (NOVEST_RELAY_KEY, NOVEST_RELAY_URL and NOVEST_ROUTE are untouched)."
  exit 0
fi
echo "checks through the public port:"
check "no key" 401 "$(rcurl nokey "$PROP" /dev/null || echo err)"
check "properties?per_page=1 with key (positive control)" 200 "$(rcurl key "$PROP" /dev/null -A "$FEED_UA" || echo err)"
check "image with key (positive control)" 200 "$(rcurl key "$IMG" "$WORK/img" -A "$IMG_UA" || echo err)"
check "image sha256" "$IMG_SHA" "$(shasum -a 256 "$WORK/img" 2>/dev/null | cut -d' ' -f1)"
check "/n/wp-admin/ with key" 403 "$(rcurl key /n/wp-admin/ /dev/null -A "$FEED_UA" || echo err)"
check "curl's default User-Agent with key" 400 "$(rcurl key "$PROP" /dev/null || echo err)"
(( FAILS == 0 )) || fail "$FAILS check(s) failed"

set_secret() { printf %s "$2" | "$GH" secret set "$1" --env production --repo "$REPO"; }
set_secret NOVEST_RELAY_KEY "$KEY" || fail "setting NOVEST_RELAY_KEY failed"
echo "set NOVEST_RELAY_KEY"; SET_DONE="$SET_DONE NOVEST_RELAY_KEY"
set_secret NOVEST_RELAY_URL "https://$IP:$PORT" || fail "setting NOVEST_RELAY_URL failed"
echo "set NOVEST_RELAY_URL"; SET_DONE="$SET_DONE NOVEST_RELAY_URL"
set_secret NOVEST_RELAY_CA "$PEM" || fail "setting NOVEST_RELAY_CA failed"
echo "set NOVEST_RELAY_CA"; SET_DONE="$SET_DONE NOVEST_RELAY_CA"
unset KEY
echo "Done. The variable NOVEST_ROUTE is NOT touched and is still unset: the relay is installed and tested but unused until Berke sets it."
