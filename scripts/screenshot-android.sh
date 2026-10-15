#!/usr/bin/env bash
# Screenshots of ADA on an Android device into .screenshots/ for the designer agent.
#
# PRIMARY: Berke's Android phone over USB (USB debugging on). FALLBACK: the ada_pixel emulator, which on
# this Intel Mac (i7-7660U, 4 logical cores) is capped at ONE vCPU ("less than 6 logical cores"; it
# ignores -cores and hw.cpu.ncore) and took 27-43 min to boot: effectively unusable here.
#
#   scripts/screenshot-android.sh --prep            → phone: still-frame settings + demo status bar + Metro port
#   scripts/screenshot-android.sh --boot            → emulator fallback: boot ada_pixel headless, then --prep
#   scripts/screenshot-android.sh <name>            → .screenshots/<YYYY-MM-DD>/<name>.png, prints the path
#   scripts/screenshot-android.sh --tap X Y | --swipe X1 Y1 X2 Y2 | --back | --text "..."
#   scripts/screenshot-android.sh --shutdown        → ALWAYS at the end: restores the phone's settings, or
#                                                     stops the emulator (~4 GB RAM)
#
# Mac only: the Hermes server has no KVM and ADA has no react-native-web. .screenshots/ is gitignored;
# never commit screenshots under docs/ (GitHub Pages is public).
set -euo pipefail

SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
AVD="${ADA_AVD:-ada_pixel}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SAVED="$ROOT/.screenshots/.device-settings"
ANIMS="window_animation_scale transition_animation_scale animator_duration_scale"

need_device() {
  local n
  n=$("$ADB" devices | awk 'NR>1 && $2=="device"' | wc -l | tr -d ' ')
  if [ "$n" = "0" ]; then echo "No adb device. Plug in the phone (USB debugging on) and accept the prompt, or --boot." >&2; exit 1; fi
  if [ "$n" != "1" ] && [ -z "${ANDROID_SERIAL:-}" ]; then echo "$n devices attached; set ANDROID_SERIAL" >&2; exit 1; fi
}

demo() { "$ADB" shell am broadcast -a com.android.systemui.demo -e command "$@" >/dev/null; }

prep() {
  need_device
  mkdir -p "$(dirname "$SAVED")"
  # Remember the device's own values once, so --shutdown can put a real phone back exactly as it was.
  if [ ! -f "$SAVED" ]; then
    for k in $ANIMS sysui_demo_allowed; do
      echo "$k=$("$ADB" shell settings get global $k | tr -d '\r')"
    done > "$SAVED"
  fi
  # Still frames: no animations mid-capture, a fixed clock and full battery in the status bar.
  for k in $ANIMS; do "$ADB" shell settings put global $k 0; done
  "$ADB" shell settings put global sysui_demo_allowed 1
  demo enter
  demo clock -e hhmm 0941
  demo battery -e level 100 -e plugged false
  demo notifications -e visible false
  "$ADB" reverse tcp:8081 tcp:8081 >/dev/null
  echo "ready: $("$ADB" devices | awk 'NR>1 && $2=="device"{print $1; exit}') · now start Metro and open ADA in Expo Go"
}

case "${1:-}" in
  --prep) prep ;;
  --boot)
    if ! "$ADB" devices | grep -q '^emulator-'; then
      # Headless with 4 GB guest RAM: windowed at 2.5 GB the guest's package service crashed installing
      # Expo Go (185 MB). screencap does not need a window. ADA_EMU_WINDOW=1 to watch.
      win="-no-window"; [ "${ADA_EMU_WINDOW:-}" = "1" ] && win=""
      nohup "$SDK/emulator/emulator" -avd "$AVD" $win -memory 4096 -no-audio -no-snapshot-save -no-boot-anim \
        -gpu swiftshader_indirect >/tmp/ada-emulator.log 2>&1 &
      epid=$!
    fi
    until [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
      if [ -n "${epid:-}" ] && ! kill -0 "$epid" 2>/dev/null; then echo "emulator exited:" >&2; grep -E 'FATAL|ERROR' /tmp/ada-emulator.log >&2; exit 1; fi
      sleep 3
    done
    # Emulator only (never on the phone): no Play Protect scan of adb installs.
    "$ADB" shell settings put global verifier_verify_adb_installs 0
    "$ADB" shell settings put global package_verifier_enable 0
    prep
    ;;
  --shutdown)
    if "$ADB" devices | grep -q '^emulator-'; then
      "$ADB" emu kill >/dev/null 2>&1 || true
      for _ in $(seq 1 20); do "$ADB" devices | grep -q '^emulator-' || break; sleep 1; done
      pkill -f "qemu-system.*-avd $AVD" 2>/dev/null || true
      echo "emulator stopped"
    elif "$ADB" devices | awk 'NR>1 && $2=="device"' | grep -q .; then
      demo exit || true
      if [ -f "$SAVED" ]; then
        while IFS='=' read -r k v; do
          if [ "$v" = "null" ] || [ -z "$v" ]; then "$ADB" shell settings delete global "$k" >/dev/null
          else "$ADB" shell settings put global "$k" "$v"; fi
        done < "$SAVED"
      else
        for k in $ANIMS; do "$ADB" shell settings put global $k 1; done
      fi
      "$ADB" reverse --remove tcp:8081 >/dev/null 2>&1 || true
      echo "device settings restored"
    else
      echo "nothing attached"
    fi
    rm -f "$SAVED"
    ;;
  --tap)   need_device; "$ADB" shell input tap "$2" "$3" ;;
  --swipe) need_device; "$ADB" shell input swipe "$2" "$3" "$4" "$5" "${6:-300}" ;;
  --back)  need_device; "$ADB" shell input keyevent KEYCODE_BACK ;;
  --text)  need_device; "$ADB" shell input text "$(printf '%s' "$2" | sed 's/ /%s/g')" ;;
  ""|-h|--help) sed -n 2,17p "$0"; exit 0 ;;
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
