#!/usr/bin/env bash
# Supabase CLI with the Mac's long-term access token (Keychain "Supabase CLI", from
# `supabase login`, 2026-10-07; scoped to project trnc-health: Project Settings read; Database,
# Edge Functions, Edge Function Secrets read-write).
#
#   scripts/sb.sh secrets list -o json
#   scripts/sb.sh functions deploy <name> --use-api        # only with Berke's go
#
# WHY A WRAPPER: CLI 2.104.0 reads the Keychain login for `functions` but NOT for `secrets`
# ("Access token not provided", measured 2026-10-07), so the token is passed as
# SUPABASE_ACCESS_TOKEN for every command. It is never printed. --project-ref is added
# unless the caller gave one. Pinned to the CI version (supabase@2.104.0 in the workflows).
set -euo pipefail
REF=jeihxnwqytnxtytgkzgf

# ALLOWLIST. The token can write the database; this wrapper is what keeps the CLI to functions and
# secrets. Migrations go only through the supabase-migrate workflow (supabase/CLAUDE.md); never
# `db push` (no CLI ledger in prod, 13 repeated prefixes), never SQL from here.
case "${1:-}" in
  functions|secrets|link|--version|--help|-h) ;;
  *) echo "sb.sh: '${1:-}' is not allowed from this Mac — only functions / secrets. Migrations: gh workflow run supabase-migrate (supabase/CLAUDE.md)." >&2; exit 2 ;;
esac
raw=$(security find-generic-password -s "Supabase CLI" -a supabase -w 2>/dev/null) \
  || { echo "sb.sh: no Supabase CLI login in the Keychain — run: supabase login" >&2; exit 1; }
case "$raw" in
  go-keyring-base64:*) tok=$(printf '%s' "${raw#go-keyring-base64:}" | base64 -D) ;;
  *) tok=$raw ;;
esac
[[ "$tok" =~ ^sbp_[0-9a-f]{40}$ ]] || { echo "sb.sh: Keychain token is not an sbp_ token" >&2; exit 1; }
have_ver=$(supabase --version 2>/dev/null | head -1)
[ "$have_ver" = "2.104.0" ] || { echo "sb.sh: supabase CLI is $have_ver, pinned 2.104.0 (as CI)" >&2; exit 1; }
args=("$@")
[[ " $* " == *" --project-ref "* ]] || args+=(--project-ref "$REF")
SUPABASE_ACCESS_TOKEN="$tok" exec supabase "${args[@]}"
