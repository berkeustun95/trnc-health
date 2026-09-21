#!/usr/bin/env bash
# Storage hardening verification. Run from the repo root, BEFORE and AFTER applying
# 20261039 + 20261040, and compare. Read-only except where marked.
set -u
cd "$(dirname "$0")/../../../../../Users/berkeustun/trnc-health" 2>/dev/null || cd /Users/berkeustun/trnc-health
set -a; . ./.env 2>/dev/null; set +a
U="$EXPO_PUBLIC_SUPABASE_URL"; K="$EXPO_PUBLIC_SUPABASE_ANON_KEY"
h=(-H "apikey: $K" -H "Authorization: Bearer $K" -H "Content-Type: application/json")
pass=0; fail=0
chk(){ if [ "$2" = "$3" ]; then echo "   PASS  $1"; pass=$((pass+1)); else echo "   FAIL  $1  (want '$3', got '$2')"; fail=$((fail+1)); fi; }

echo "=== POSITIVE CONTROL: the API is reachable and anon can read something ==="
CTRL=$(curl -s -o /dev/null -w '%{http_code}' "$U/rest/v1/facilities?select=id&limit=1" "${h[@]}")
chk "facilities readable as anon (control)" "$CTRL" "200"

echo ""
echo "=== 1. avatars must NOT be listable as anon ==="
N=$(curl -s -X POST "$U/storage/v1/object/list/avatars" "${h[@]}" -d '{"prefix":"","limit":1000}' | grep -o '"name"' | wc -l | tr -d ' ')
chk "avatars list returns 0 entries" "$N" "0"

echo ""
echo "=== 2. the unauthenticated object GET must NOT return bytes ==="
# ⚠ THE CACHE-BUSTER IS LOAD-BEARING, NOT HYGIENE.
# Without it this check tests CLOUDFLARE'S CACHE, not the bucket. Measured 2026-09-20,
# AFTER the bucket was made private: the plain URL returned 200 with
# `cf-cache-status: HIT` and `cache-control: public, max-age=3600`, while the same URL
# with a query param returned 400 `NoSuchBucket` and `cf-cache-status: BYPASS`.
# So the check reported an open bucket for an hour after it was closed — and the copy
# was warm only because THIS SCRIPT's own repeated probing kept it there.
#
# A query param forces BYPASS on the /object/public/ route, so this reads current state.
# (Not the same trap as the getadaapp.com/privacy probe in CLAUDE.md, where `?cb=` routed
# past the Worker to a different origin and 404'd a healthy deploy. Here the query param
# does not change WHICH origin answers — it only defeats the edge cache. Verified: the
# busted request reaches Supabase Storage and returns a Storage JSON error body.)
OBJ="$U/storage/v1/object/public/avatars/235da7e5-330e-47d4-a656-fa070bafee32/avatar.jpeg"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$OBJ?cb=$(date +%s)")
if [ "$CODE" = "200" ]; then echo "   FAIL  unauthenticated avatar GET still returns 200 (cache bypassed — this is real)"; fail=$((fail+1));
else echo "   PASS  unauthenticated avatar GET blocked (HTTP $CODE, cache bypassed)"; pass=$((pass+1)); fi

# The cached copy, reported but NOT scored. It is a stale artifact of an already-closed
# bucket and it ages out on its own; failing the run on it would be failing on history.
PLAIN=$(curl -s -o /dev/null -w '%{http_code}' "$OBJ")
[ "$PLAIN" = "200" ] && echo "   note  a CDN-cached copy is still being served on the un-busted URL (max-age 3600, dying)"

echo ""
echo "=== 3. a signed URL must still WORK (the app depends on it) ==="
# THE OTHER HALF OF THE CLAIM, and without it this script is a one-way ratchet: every
# check above passes most completely when the bucket is broken for everyone. A closed
# bucket that nobody can read is not the goal.
#
# As `anon` this correctly FAILS — avatars_read_authenticated excludes anon, so signing
# is denied. That is why this is reported, not scored: the role that must succeed is
# `authenticated`, and proving it from a shell needs a real JWT. It is the device pass.
SIGNED=$(curl -s -X POST "$U/storage/v1/object/sign/avatars/235da7e5-330e-47d4-a656-fa070bafee32/avatar.jpeg" \
  "${h[@]}" -d '{"expiresIn":60}')
if echo "$SIGNED" | grep -q signedURL; then
  echo "   note  anon CAN sign — unexpected: avatars_read_authenticated should exclude anon"
else
  echo "   note  anon cannot sign (expected). AUTHENTICATED signing is the device pass —"
  echo "         open the app signed in and confirm your avatar renders."
fi

echo ""
echo "=== 3b. a GUEST must not be able to upload to property-images ==="
echo "   (not scored — needs a live guest JWT, and a write test mutates production."
echo "    verify_schema's 1039 token asserts the policy shape instead.)"

echo ""
echo "=== 4. business buckets stay listable (they are NOT part of this fix) ==="
FN=$(curl -s -X POST "$U/storage/v1/object/list/facility-images" "${h[@]}" -d '{"prefix":"","limit":50}' | grep -o '"name"' | wc -l | tr -d ' ')
if [ "$FN" -gt 0 ]; then echo "   PASS  facility-images still listable ($FN) — expected, content is businesses"; pass=$((pass+1));
else echo "   NOTE  facility-images returned 0 — unexpected, check separately"; fi

echo ""
echo "=== 5. no profiles row may still hold a public avatars URL ==="
echo "   (not checkable as anon — profiles is RLS-blocked. Assert with verify_schema's 1040 token.)"

echo ""
echo "──────────────────────────────────────────"
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
