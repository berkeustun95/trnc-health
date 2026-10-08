#!/usr/bin/env bash
# Deploy ONE Edge Function from this Mac, the way .github/workflows/supabase-functions-deploy.yml
# does: verify_jwt from supabase/functions/deploy-config.json (a plain deploy turns it back ON and
# breaks apple-token, walk-leg and weather), refuse on live drift, assert after.
#
#   scripts/fn-deploy.sh google-places            # dry: prints what it would do
#   scripts/fn-deploy.sh google-places --go       # deploys — only with Berke's go
set -euo pipefail
cd "$(dirname "$0")/.."
f=${1:?usage: scripts/fn-deploy.sh <function> [--go]}
go=${2:-}
want=$(node -e '
  const c = require("./supabase/functions/deploy-config.json").functions[process.argv[1]]
  if (!c) { console.error(`${process.argv[1]} is not in deploy-config.json — add it (with verify_jwt) first`); process.exit(1) }
  process.stdout.write(String(c.verify_jwt))' "$f")
[ -f "supabase/functions/$f/index.ts" ] || { echo "supabase/functions/$f/index.ts missing" >&2; exit 1; }
[ -z "$(git status --porcelain -- "supabase/functions/$f" supabase/functions/_shared)" ] \
  || { echo "uncommitted changes under supabase/functions/$f or _shared — the deploy ships the working tree" >&2; exit 1; }
live() { scripts/sb.sh functions list -o json 2>/dev/null | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{ const f=JSON.parse(s).find(x=>x.slug===process.argv[1]);
  process.stdout.write(f ? `${f.verify_jwt} ${f.version} ${f.status}` : "absent") })' "$f"; }
before=$(live)
echo "$f: deploy-config verify_jwt=$want · live: $before · HEAD $(git rev-parse --short HEAD)"
if [ "$before" != "absent" ] && [ "${before%% *}" != "$want" ]; then
  echo "REFUSED: live verify_jwt ${before%% *} differs from deploy-config ($want) — decide which is right, edit the file" >&2; exit 1
fi
[ "$go" = "--go" ] || { echo "DRY RUN — re-run with --go (Berke's go first)."; exit 0; }
flag=(); [ "$want" = "false" ] && flag=(--no-verify-jwt)
# ${flag[@]+…}: macOS bash 3.2 + set -u treats an EMPTY array as unbound (verify_jwt=true case).
scripts/sb.sh functions deploy "$f" --use-api ${flag[@]+"${flag[@]}"}
after=$(live)
read -r a_jwt a_ver a_status <<<"$after"
b_ver=$([ "$before" = "absent" ] && echo 0 || echo "$before" | cut -d' ' -f2)
if [ "$a_jwt" = "$want" ] && [ "$a_status" = "ACTIVE" ] && [ "$a_ver" -gt "$b_ver" ]; then
  echo "✓ $f: v$b_ver → v$a_ver · verify_jwt=$a_jwt · $a_status"
else
  echo "✗ $f after deploy: $after (wanted verify_jwt=$want, ACTIVE, version > $b_ver)" >&2; exit 1
fi
