#!/usr/bin/env bash
# Screenshots of ADA on Berke's Android phone (USB, USB debugging on) into .screenshots/ for the designer agent.
# The phone is the only device: there is no emulator on this Mac (it ran at one vCPU here and was removed).
#
#   scripts/screenshot-android.sh --prep            → still-frame settings + demo status bar + Metro port link
#   scripts/screenshot-android.sh <name>            → .screenshots/<YYYY-MM-DD>/<name>.png, prints the path
#   scripts/screenshot-android.sh --tap X Y | --swipe X1 Y1 X2 Y2 | --back | --text "..."
#   scripts/screenshot-android.sh --shutdown        → ALWAYS at the end: restores the phone's own settings
#
# Mac only: the Hermes server has no device and ADA has no react-native-web. .screenshots/ is gitignored;
# never commit screenshots under docs/ (GitHub Pages is public).
set -euo pipefail

SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SAVED="$ROOT/.screenshots/.device-settings"
ANIMS="window_animation_scale transition_animation_scale animator_duration_scale"

need_device() {
  local n
  n=$("$ADB" devices | awk 'NR>1 && $2=="device"' | wc -l | tr -d ' ')
  if [ "$n" = "0" ]; then echo "No phone. Plug it in (USB debugging on) and accept the prompt." >&2; exit 1; fi
  if [ "$n" != "1" ] && [ -z "${ANDROID_SERIAL:-}" ]; then echo "$n devices attached; set ANDROID_SERIAL" >&2; exit 1; fi
}

demo() { "$ADB" shell am broadcast -a com.android.systemui.demo -e command "$@" >/dev/null; }

case "${1:-}" in
  --prep)
    need_device
    mkdir -p "$(dirname "$SAVED")"
    # Remember the phone's own values once, so --shutdown puts it back exactly as it was.
    if [ ! -f "$SAVED" ]; then
      for k in $ANIMS sysui_demo_allowed; do
        echo "$k=$("$ADB" shell settings get global $k | tr -d '\r')"
      done > "$SAVED"
    fi
    # Still frames: no animations mid-capture. The demo status bar (fixed clock, full battery) works on stock
    # Android only: Samsung One UI (Berke's S25 Ultra) ignores it, so his real clock/battery show.
    for k in $ANIMS; do "$ADB" shell settings put global $k 0; done
    "$ADB" shell settings put global sysui_demo_allowed 1
    demo enter
    demo clock -e hhmm 0941
    demo battery -e level 100 -e plugged false
    demo notifications -e visible false
    "$ADB" reverse tcp:8081 tcp:8081 >/dev/null
    echo "ready: $("$ADB" devices | awk 'NR>1 && $2=="device"{print $1; exit}') · now start Metro and open ADA in Expo Go"
    ;;
  --shutdown)
    need_device
    demo exit || true
    if [ -f "$SAVED" ]; then
      # </dev/null: adb shell reads stdin, and inside this loop it swallowed the rest of $SAVED, so only
      # the first setting came back (caught on Berke's phone 2026-10-15).
      while IFS='=' read -r k v; do
        if [ "$v" = "null" ] || [ -z "$v" ]; then "$ADB" shell settings delete global "$k" >/dev/null </dev/null
        else "$ADB" shell settings put global "$k" "$v" </dev/null; fi
      done < "$SAVED"
      rm -f "$SAVED"
    else
      for k in $ANIMS; do "$ADB" shell settings put global $k 1; done
    fi
    "$ADB" reverse --remove tcp:8081 >/dev/null 2>&1 || true
    echo "phone settings restored"
    ;;
  --tap)   need_device; "$ADB" shell input tap "$2" "$3" ;;
  --swipe) need_device; "$ADB" shell input swipe "$2" "$3" "$4" "$5" "${6:-300}" ;;
  --back)  need_device; "$ADB" shell input keyevent KEYCODE_BACK ;;
  --text)  need_device; "$ADB" shell input text "$(printf '%s' "$2" | sed 's/ /%s/g')" ;;
  ""|-h|--help) sed -n 2,11p "$0"; exit 0 ;;
  *)
    need_device
    name="$(printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '-')"
    dir="$ROOT/.screenshots/$(date +%F)"
    mkdir -p "$dir"
    out="$dir/$name.png"
    # exec-out, not `shell`: shell's pty rewrites \n to \r\n and corrupts the PNG.
    "$ADB" exec-out screencap -p > "$out"
    [ -s "$out" ] || { echo "empty capture: $out" >&2; exit 1; }
    echo "$out"
    ;;
esac
