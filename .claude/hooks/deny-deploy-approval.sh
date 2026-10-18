#!/bin/sh
# PreToolUse guard (Berke, 2026-10-18): Claude Code must never approve or reject a GitHub
# environment deployment (production-db is the only lock on migrations / image uploads).
# Blocks any Bash command, and any file write/edit, whose text reaches the approval endpoints:
#   POST /repos/{o}/{r}/actions/runs/{id}/pending_deployments   (approve / reject reviewers)
#   POST /repos/{o}/{r}/actions/runs/{id}/deployment_protection_rule (custom gates)
# Exit 2 = blocked; stderr goes back to Claude. Defence in depth only — the real lock is
# prevent_self_review on production-db once Code has its own GitHub identity.
input=$(cat)
text=$(printf '%s' "$input" | jq -r '[.tool_input.command, .tool_input.content, .tool_input.new_string, (.tool_input.edits // [] | map(.new_string) | join("\n"))] | map(select(. != null)) | join("\n")' 2>/dev/null)
if printf '%s' "$text" | grep -qiE 'pending[_-]?deployments|deployment[_-]?protection[_-]?rule'; then
  echo "BLOCKED: approving or rejecting GitHub deployments (pending_deployments / deployment_protection_rule) is reserved for Berke. Claude Code never approves, through gh, curl, the API or a script." >&2
  exit 2
fi
exit 0
