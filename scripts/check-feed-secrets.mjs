#!/usr/bin/env node
// ─── Pre-flight: are the feed pipeline's four secrets actually present? ──────
//
//   node scripts/check-feed-secrets.mjs            # assert, from the environment
//   node scripts/check-feed-secrets.mjs --selftest
//
// Runs FIRST in the scheduled workflow, before the guards and before anything
// touches the network.
//
// ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
//
// Run #1 of the workflow did four minutes of real work — install, four guard
// self-tests, a live fetch, a transform, 37 URL probes — and then failed at the
// import, the first step that needs the Supabase credentials. The cause turned out
// to be a Node version, not a secret, but the shape of that run is the point: a
// missing secret would have looked identical, and would have been discovered in
// the same expensive place with the same generic message.
//
// So: assert every credential up front, and NAME the one that is missing. The
// cheapest failure is the one that happens first and says what to fix.
//
// ─── IT PRINTS SHAPES, NEVER VALUES ─────────────────────────────────────────
//
// Length and scheme prefix only. Those are enough to distinguish "unset" from
// "set to the wrong thing" — the two failures worth telling apart — and neither
// is entropy. A workflow log on a PUBLIC repo is not a place to be clever about
// what "probably won't get read".
//
// The token inside GISEKIBRIS_FEED_URL is masked to its scheme and host, because
// the path segment IS the partner key.
const REQUIRED = [
  { name: 'GISEKIBRIS_FEED_URL',
    why: 'the partner feed; its path segment is the partner key',
    shape: v => { try { const u = new URL(v); return `${u.protocol}//${u.host}/…/<TOKEN>` } catch { return '(not a URL)' } } },
  { name: 'SUPABASE_SERVICE_ROLE_KEY',
    why: 'bypasses RLS; required to write status=approved and to upload mirrored images',
    shape: keyShape },
  { name: 'EXPO_PUBLIC_SUPABASE_URL',
    why: 'project endpoint',
    shape: v => { try { return new URL(v).origin } catch { return '(not a URL)' } } },
  { name: 'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    why: 'the guest-session health check',
    shape: keyShape },
]

// The scheme prefix is a FORMAT MARKER, not entropy. Supabase replaced the legacy
// JWTs (eyJ…, 200+ chars) with sb_secret_ / sb_publishable_, and telling those
// apart is exactly the check worth having: a publishable key pasted into the
// service-role slot is the plausible mistake, and it fails much later and much
// more confusingly than it fails here.
function keyShape(v) {
  if (v.startsWith('sb_secret_')) return 'sb_secret_… (secret)'
  if (v.startsWith('sb_publishable_')) return 'sb_publishable_… (PUBLISHABLE)'
  if (v.startsWith('eyJ')) return 'eyJ… (legacy JWT)'
  return '(unrecognised scheme)'
}

// Assertions that are about MEANING, not presence. Kept separate from the shape
// display so they can be self-tested.
export function problems(env) {
  const out = []
  for (const r of REQUIRED) {
    const v = env[r.name]
    if (v === undefined || v === null || v.trim() === '') { out.push(`${r.name} is not set — ${r.why}`); continue }
    if (v !== v.trim()) out.push(`${r.name} has leading/trailing whitespace — usually a newline picked up when pasting`)
  }
  const svc = env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (svc.startsWith('sb_publishable_')) {
    out.push('SUPABASE_SERVICE_ROLE_KEY holds the PUBLISHABLE key, not the secret one. ' +
             'It is bound by RLS, so it cannot write status=approved or mirror images.')
  }
  const anon = env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''
  if (anon.startsWith('sb_secret_')) {
    out.push('EXPO_PUBLIC_SUPABASE_ANON_KEY holds a SECRET key. That name is inlined into the ' +
             'client bundle by Expo — rotate it.')
  }
  return out
}

// ⚠ THE FIXTURES BELOW ARE DELIBERATELY NOT KEY-SHAPED. check-secrets.mjs matches
//   /\bsb_secret_[A-Za-z0-9_-]{8,}/ — prefix plus 8+ characters of entropy — so a
//   realistic-looking dummy blocks every push from this repo. `sb_secret_FAKE`
//   exercises the same startsWith() branch with four characters after the prefix.
//   This file is deliberately NOT added to that guard's EXEMPT list: an exemption
//   would blind it to this file permanently, and a test fixture is not a reason to
//   give up coverage on a script whose whole subject is credentials.
if (process.argv.includes('--selftest')) {
  const ok = { GISEKIBRIS_FEED_URL:'https://core.example.com/partners/feed/abc123',
               SUPABASE_SERVICE_ROLE_KEY:'sb_secret_FAKE',
               EXPO_PUBLIC_SUPABASE_URL:'https://x.supabase.co',
               EXPO_PUBLIC_SUPABASE_ANON_KEY:'sb_publishable_FAKE' }
  let bad = 0
  const T = (label, env, wantCount) => {
    const n = problems(env).length
    const good = wantCount === 'some' ? n > 0 : n === wantCount
    if (!good) bad++
    console.log(`    ${good ? '✓' : '✗'} ${label.padEnd(52)} ${n} problem(s)`)
  }
  console.log('\n  presence')
  T('all four set, correct schemes', ok, 0)
  for (const k of Object.keys(ok)) T(`${k} unset`, { ...ok, [k]: undefined }, 'some')
  T('empty string counts as unset', { ...ok, EXPO_PUBLIC_SUPABASE_URL:'' }, 'some')
  T('whitespace-only counts as unset', { ...ok, EXPO_PUBLIC_SUPABASE_URL:'   ' }, 'some')
  console.log('\n  the mistakes worth naming')
  T('publishable key in the service-role slot', { ...ok, SUPABASE_SERVICE_ROLE_KEY: ok.EXPO_PUBLIC_SUPABASE_ANON_KEY }, 'some')
  T('secret key in the anon slot',              { ...ok, EXPO_PUBLIC_SUPABASE_ANON_KEY: ok.SUPABASE_SERVICE_ROLE_KEY }, 'some')
  T('trailing newline from a paste',            { ...ok, SUPABASE_SERVICE_ROLE_KEY: ok.SUPABASE_SERVICE_ROLE_KEY + '\n' }, 'some')
  console.log(bad ? `\n  ${bad} self-test failure(s).\n` : '\n  Self-test clean.\n')
  process.exit(bad ? 1 : 0)
}

console.log('\nFeed pipeline secrets — shapes only, never values\n')
for (const r of REQUIRED) {
  const v = process.env[r.name]
  const set = v !== undefined && v !== null && v.trim() !== ''
  console.log(`  ${set ? '✓' : '✗'} ${r.name.padEnd(30)} ${set ? `len=${String(v.length).padStart(4)}  ${r.shape(v)}` : 'NOT SET'}`)
}
const errs = problems(process.env)
if (!errs.length) { console.log('\n  All four present and the right kind.\n'); process.exit(0) }
console.log('')
for (const e of errs) console.log(`  ⛔ ${e}`)
console.log('\n  Set these under Settings → Secrets and variables → Actions.\n')
process.exit(1)
