#!/usr/bin/env bash
# Screenshot the Android emulator (or any single adb device) into .screenshots/ for the designer agent.
#
#   scripts/screenshot-android.sh <name>            → .screenshots/<YYYY-MM-DD>/<name>.png, prints the path
#   scripts/screenshot-android.sh --boot            → start AVD ada_pixel headless-ish, wait for boot, set demo mode
#   scripts/screenshot-android.sh --tap X Y | --swipe X1 Y1 X2 Y2 | --back | --text "..."
#   scripts/screenshot-android.sh --shutdown        → stop the emulator (~2.5 GB RAM) when the session is done
#
# Mac only: the Hermes server has no emulator (no KVM) and ADA has no react-native-web, so visual
# checks run here. .screenshots/ is gitignored; never commit screenshots under docs/ (GitHub Pages is public).
set -euo pipefail

SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
AVD="${ADA_AVD:-ada_pixel}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

need_device() {
  local n
  n=$("$ADB" devices | awk 'NR>1 && $2=="device"' | wc -l | tr -d ' ')
  if [ "$n" = "0" ]; then echo "No adb device. Run: $0 --boot" >&2; exit 1; fi
  if [ "$n" != "1" ] && [ -z "${ANDROID_SERIAL:-}" ]; then echo "$n devices attached; set ANDROID_SERIAL" >&2; exit 1; fi
}

case "${1:-}" in
  --boot)
    if ! "$ADB" devices | grep -q '^emulator-'; then
      # 2 GB data partition: the default (~7 GB) does not fit this Mac's disk; Expo Go needs far less.
      nohup "$SDK/emulator/emulator" -avd "$AVD" -partition-size 2048 -no-snapshot-save -no-boot-anim -gpu swiftshader_indirect >/tmp/ada-emulator.log 2>&1 &
      epid=$!
    fi
    until [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
      if [ -n "${epid:-}" ] && ! kill -0 "$epid" 2>/dev/null; then echo "emulator exited:" >&2; grep -E 'FATAL|ERROR' /tmp/ada-emulator.log >&2; exit 1; fi
      sleep 3
    done
    # Still frames: no animations mid-capture, a fixed clock and full battery in the status bar.
    for k in window_animation_scale transition_animation_scale animator_duration_scale; do "$ADB" shell settings put global $k 0; done
    "$ADB" shell settings put global sysui_demo_allowed 1
    "$ADB" shell am broadcast -a com.android.systemui.demo -e command enter >/dev/null
    "$ADB" shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941 >/dev/null
    "$ADB" shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false >/dev/null
    "$ADB" shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false >/dev/null
    "$ADB" reverse tcp:8081 tcp:8081 >/dev/null
    echo "booted: $("$ADB" devices | awk 'NR==2{print $1}')"
    ;;
  --shutdown)
    if "$ADB" devices | grep -q '^emulator-'; then
      "$ADB" emu kill >/dev/null 2>&1 || true
      for _ in $(seq 1 20); do "$ADB" devices | grep -q '^emulator-' || break; sleep 1; done
    fi
    pkill -f "qemu-system.*-avd $AVD" 2>/dev/null || true
    echo "emulator stopped"
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
