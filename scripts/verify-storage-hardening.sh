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
# The exact object that returned 200 / 47185 bytes on 2026-09-20.
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$U/storage/v1/object/public/avatars/235da7e5-330e-47d4-a656-fa070bafee32/avatar.jpeg")
if [ "$CODE" = "200" ]; then echo "   FAIL  unauthenticated avatar GET still returns 200"; fail=$((fail+1));
else echo "   PASS  unauthenticated avatar GET blocked (HTTP $CODE)"; pass=$((pass+1)); fi

echo ""
echo "=== 3. a GUEST must not be able to upload to property-images ==="
echo "   (skipped here — needs a live guest JWT; see the note in the journal)"

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
