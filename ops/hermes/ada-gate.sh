# ─── GO-code gate (sourced by ada-publish) ─────────────────────────────────────
#
# A production action waits for Berke to reply "GO <code>" to a SECOND Telegram bot whose token
# only root holds (/etc/ada/gate.env). Hermes and Claude Code run as `hermes`: they cannot read
# that token, so they cannot read the code, send the reply, or fake Berke's user id.
# The token never appears on a command line: curl reads its URL from stdin (-K -).

GATE_OWNER_ID=8321808511
GATE_TIMEOUT=600

_gate_api() { # $1 = method, rest = curl --data-urlencode pairs
  local method=$1; shift
  local args=()
  for kv in "$@"; do args+=(--data-urlencode "$kv"); done
  printf 'url = "https://api.telegram.org/bot%s/%s"\n' "$GATE_BOT_TOKEN" "$method" \
    | curl -sS --max-time 40 -K - "${args[@]}"
}

gate_require_go() { # $1 = request text. Returns 0 only on "GO <code>" from Berke in his own chat.
  local text=$1
  GATE_BOT_TOKEN=$(sed -n 's/^GATE_BOT_TOKEN=//p' /etc/ada/gate.env 2>/dev/null || true)
  [[ -n "$GATE_BOT_TOKEN" ]] || { echo "gate: /etc/ada/gate.env has no GATE_BOT_TOKEN — refusing" >&2; return 1; }

  local last off code deadline resp
  last=$(_gate_api getUpdates "offset=-1" "timeout=0" | jq -r '.result[-1].update_id // 0')
  off=$((last + 1))
  code=$(printf '%06d' $(( $(od -An -N4 -tu4 /dev/urandom | tr -d ' ') % 1000000 )))

  _gate_api sendMessage "chat_id=$GATE_OWNER_ID" \
    "text=$text

Reply exactly:  GO $code
within $((GATE_TIMEOUT / 60)) minutes. Anything else, or silence, = NOT published." >/dev/null \
    || { echo "gate: could not reach Telegram — refusing" >&2; return 1; }
  echo "gate: waiting up to $((GATE_TIMEOUT / 60)) min for Berke's GO in Telegram…"

  deadline=$(( $(date +%s) + GATE_TIMEOUT ))
  while (( $(date +%s) < deadline )); do
    resp=$(_gate_api getUpdates "offset=$off" "timeout=30" 'allowed_updates=["message"]') || { sleep 3; continue; }
    while IFS=$'\t' read -r uid from chat msg; do
      [[ -n "$uid" ]] || continue
      off=$((uid + 1))
      [[ "$from" == "$GATE_OWNER_ID" && "$chat" == "$GATE_OWNER_ID" ]] || continue
      if [[ "$msg" == "GO $code" ]]; then
        _gate_api sendMessage "chat_id=$GATE_OWNER_ID" "text=GO $code accepted — publishing." >/dev/null || true
        echo "gate: GO received from $GATE_OWNER_ID"
        return 0
      fi
      _gate_api sendMessage "chat_id=$GATE_OWNER_ID" "text=Not GO $code — request cancelled, nothing published." >/dev/null || true
      echo "gate: Berke replied something other than the code — refused" >&2
      return 1
    done < <(jq -r '.result[]? | [.update_id, (.message.from.id // ""), (.message.chat.id // ""), (.message.text // "")] | @tsv' <<<"$resp")
  done
  _gate_api sendMessage "chat_id=$GATE_OWNER_ID" "text=No GO within $((GATE_TIMEOUT / 60)) min — nothing published." >/dev/null || true
  echo "gate: timed out — refused" >&2
  return 1
}
