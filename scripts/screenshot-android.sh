#!/usr/bin/env bash
# Screenshots of ADA on Berke's Android phone (USB, USB debugging on) into .screenshots/ for the designer agent.
# The phone is the only device: there is no emulator on this Mac (it ran at one vCPU here and was removed).
#
#   scripts/screenshot-android.sh --start           → FIRST: restores any leftover settings snapshot, links Metro's port
#   scripts/screenshot-android.sh <name>            → .screenshots/<YYYY-MM-DD>/<name>.png, prints the path
#   scripts/screenshot-android.sh --tap X Y | --swipe X1 Y1 X2 Y2 [ms] | --back | --text "..."
#   scripts/screenshot-android.sh --status          → the phone's animation settings + any leftover snapshot
#   scripts/screenshot-android.sh --shutdown        → ALWAYS at the end: restores, verifies, unlinks the port
#
# Berke's phone is never left changed (Berke, 2026-10-16): animations go off only around each capture and
# are restored, and read back, right after it. The snapshot lives per phone in ~/.ada-phone/, not in a
# worktree, so a leftover from a crashed session is found from any checkout. Every tap, swipe, key and
# capture first checks that ADA (Expo Go) is on screen and no call is active: twice on 2026-10-15 a call
# came in mid-session, and a capture caught the caller's name and number.
#
# Mac only: the Hermes server has no device and ADA has no react-native-web. .screenshots/ is gitignored;
# never commit screenshots under docs/ (GitHub Pages is public).
set -euo pipefail
# The phone is shared: only the preview-lock holder may drive it (CLAUDE.md, 2026-11-01). That includes a dev
# bundle: --prep links Metro to the phone for Expo Go, so it is gated like every other command here.
node "$(dirname "$0")/preview-lock.mjs" check >&2 || { echo "screenshot-android: take the preview lock first (scripts/preview-lock.mjs) — Expo Go and dev bundles on the test phone need it too" >&2; exit 1; }

SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SNAP_DIR="$HOME/.ada-phone"
PORT="${METRO_PORT:-8081}"
ANIMS="window_animation_scale transition_animation_scale animator_duration_scale"
APP="host.exp.exponent"

need_device() {
  local n
  n=$("$ADB" devices | awk 'NR>1 && $2=="device"' | wc -l | tr -d ' ')
  if [ "$n" = "0" ]; then echo "No phone. Plug it in (USB debugging on, Auto Blocker off) and accept the prompt." >&2; exit 1; fi
  if [ "$n" != "1" ] && [ -z "${ANDROID_SERIAL:-}" ]; then echo "$n devices attached; set ANDROID_SERIAL" >&2; exit 1; fi
  SERIAL="${ANDROID_SERIAL:-$("$ADB" devices | awk 'NR>1 && $2=="device"{print $1; exit}')}"
  SNAP="$SNAP_DIR/$SERIAL.settings"
}

# </dev/null on every adb call inside a read loop: adb shell reads stdin and would swallow the rest of the
# file, so only the first setting came back (caught on Berke's phone 2026-10-15).
get() { "$ADB" shell settings get global "$1" </dev/null | tr -d '\r'; }

restore() {
  [ -f "$SNAP" ] || return 0
  local k v now bad=0
  while IFS='=' read -r k v; do
    if [ "$v" = "null" ] || [ -z "$v" ]; then "$ADB" shell settings delete global "$k" >/dev/null </dev/null
    else "$ADB" shell settings put global "$k" "$v" </dev/null; fi
  done < "$SNAP"
  while IFS='=' read -r k v; do
    now=$(get "$k")
    [ "$now" = "$v" ] || { echo "RESTORE MISMATCH: $k is '$now', expected '$v'" >&2; bad=1; }
  done < "$SNAP"
  [ "$bad" = 0 ] || { echo "snapshot kept at $SNAP" >&2; exit 1; }
  rm -f "$SNAP"
  echo "phone settings restored" >&2
}

animations_off() {
  mkdir -p "$SNAP_DIR"
  # Never overwrite a snapshot: a leftover one holds the phone's REAL values, the current ones may be 0.
  [ -f "$SNAP" ] || for k in $ANIMS; do echo "$k=$(get "$k")"; done > "$SNAP"
  for k in $ANIMS; do "$ADB" shell settings put global "$k" 0; done
}

guard() {
  local top call
  top=$("$ADB" shell dumpsys activity activities | grep -m1 topResumedActivity || true)
  call=$("$ADB" shell dumpsys telephony.registry | grep -m1 -o 'mCallState=[0-9]' || true)
  case "$top" in *"$APP/"*) ;; *) echo "BLOCKED: ADA is not on screen (${top##* u0 })" >&2; exit 3 ;; esac
  [ "$call" = "mCallState=0" ] || { echo "BLOCKED: a call is active ($call)" >&2; exit 3; }
}

status() {
  for k in $ANIMS; do echo "$k=$(get "$k")"; done
  if [ -f "$SNAP" ]; then echo "leftover snapshot: $SNAP"; cat "$SNAP"; else echo "no leftover snapshot"; fi
}

case "${1:-}" in
  --start|--prep)
    need_device
    restore
    "$ADB" reverse "tcp:$PORT" "tcp:$PORT" >/dev/null
    echo "ready: $SERIAL · Metro port $PORT linked · now start Metro and open ADA in Expo Go"
    ;;
  --shutdown|--restore)
    need_device
    restore
    "$ADB" reverse --remove "tcp:$PORT" >/dev/null 2>&1 || true
    status
    echo "You can unplug now."
    ;;
  --status) need_device; status ;;
  --tap)   need_device; guard; "$ADB" shell input tap "$2" "$3" ;;
  --swipe) need_device; guard; "$ADB" shell input swipe "$2" "$3" "$4" "$5" "${6:-300}" ;;
  --back)  need_device; guard; "$ADB" shell input keyevent KEYCODE_BACK ;;
  --text)  need_device; guard; "$ADB" shell input text "$(printf '%s' "$2" | sed 's/ /%s/g')" ;;
  ""|-h|--help) sed -n 2,9p "$0"; exit 0 ;;
  -*) echo "unknown option: $1" >&2; exit 2 ;;
  *)
    need_device
    guard
    name="$(printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '-')"
    dir="$ROOT/.screenshots/$(date +%F)"
    mkdir -p "$dir"
    out="$dir/$name.png"
    trap restore EXIT
    animations_off
    sleep 0.6
    # exec-out, not `shell`: shell's pty rewrites \n to \r\n and corrupts the PNG.
    "$ADB" exec-out screencap -p > "$out"
    [ -s "$out" ] || { echo "empty capture: $out" >&2; exit 1; }
    echo "$out"
    ;;
esac
