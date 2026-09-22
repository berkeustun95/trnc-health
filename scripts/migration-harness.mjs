// ─── A SUPABASE-SHAPED Postgres to run a migration against ──────────────────
//
//   import { freshDb, applyFile } from './migration-harness.mjs'
//
// ─── WHY THIS FILE IS IN THE REPO AND NOT IN SOMEBODY'S /tmp ────────────────
//
// It was in somebody's /tmp, and that is how 20261033 shipped a hole.
//
// That migration asserted that neither of its two new SECURITY DEFINER functions was
// EXECUTE-able by anon. The assertion was correct. It passed in PGlite and on two real
// Postgres versions, and then failed on first contact with the real database — because
// the throwaway harness seeded Supabase's default privileges for TABLES and never for
// FUNCTIONS. Every function under test was therefore born with a stock-Postgres ACL, the
// file's `REVOKE ... FROM PUBLIC` looked sufficient, and the assertion was UNREACHABLE in
// every environment it ever ran in.
//
// The harness modelled tables correctly because tables were that file's subject. The
// function grants were incidental to what was being thought about, so they defaulted to
// stock Postgres and took the assertion with them. You model what you are looking at —
// which is an argument for the fixture being a reviewable file rather than something
// rebuilt from memory each time.
//
//     THE QUESTION THIS FILE EXISTS TO ANSWER, ASKED BEFORE EVERY RUN:
//     WHAT DOES THIS ENVIRONMENT DO DIFFERENTLY FROM PRODUCTION,
//     IN THE DIMENSION I AM ACTUALLY TESTING?
//
// ─── WHAT IT MODELS ─────────────────────────────────────────────────────────
//
//   • The three Supabase roles, and BOTH ALTER DEFAULT PRIVILEGES lines. A new table and
//     a new function are each born carrying anon and authenticated BY NAME — not via
//     PUBLIC — which is what makes `REVOKE ... FROM PUBLIC` a no-op against anon.
//   • auth.uid() as Supabase actually writes it: nullif BEFORE the cast. A stub that
//     casts first raises on ''::json for a JWT-less caller — stricter than production, and
//     it fails on precisely the anonymous case most of these migrations are about. That
//     bug cost two runs while this was being written.
//   • asRole(), so a test can ask a question as anon / authenticated / postgres and read
//     the answer rather than reasoning about the grant.
//
// ─── WHAT IT DOES NOT MODEL — STATED, NOT LEFT TO BE DISCOVERED ─────────────
//
//   • PostgREST. No HTTP, no JWT verification, no schema cache. `role` is set by hand.
//   • auth.users. Callers that need profiles rows must create the auth.users row too,
//     because profiles.id is FK'd to it — a fabricated uuid aborts on the foreign key.
//   • RLS policies, triggers and the real function bodies. Seed whatever the file needs.
//   • Extensions: pg_net, pg_cron, postgis. Stub them per test.
//
// A pass here is evidence about the dimension you seeded and nothing else. Say which.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

export const SUPABASE_SEED = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
-- BYPASSRLS, as in production: it is how every Edge Function writes an RLS table. Without
-- it the fixture is STRICTER than Supabase and a service_role write fails here while
-- succeeding live — found on 20261044, whose positive control is exactly that write.
CREATE ROLE service_role NOLOGIN BYPASSRLS;

-- ⚠ BOTH LINES. The second one is the one that was missing, and its absence is what let
--   a real defect through a green test suite. Do not delete either without reading the
--   note at the top of this file.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL     ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
-- nullif BEFORE the cast, exactly as Supabase defines it.
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $harness$
  SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$harness$;

-- ⚠ AND THE GRANT, WITHOUT WHICH THIS FIXTURE IS STRICTER THAN PRODUCTION. Supabase gives
--   anon and authenticated USAGE on the auth schema and EXECUTE on auth.uid(); every RLS
--   policy in this app calls it as one of those roles. Omitting it makes any policy
--   evaluation raise "permission denied for schema auth" — a failure that belongs to the
--   harness and looks like one belonging to the migration. Caught on this file's own
--   first run, which is the third time the same shape has appeared in two days.
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- Every manual-apply migration ends by stamping itself here.
CREATE TABLE public.schema_migrations_applied (
  filename text PRIMARY KEY, checksum text,
  applied_at timestamptz DEFAULT now(), applied_by text DEFAULT current_user
);
`

export async function freshDb(extraSeed = '') {
  const db = await PGlite.create()
  await db.exec(SUPABASE_SEED)
  if (extraSeed) await db.exec(extraSeed)
  return db
}

// Returns { ok, msg } rather than throwing: a migration that REFUSES is a result, not a
// crash, and most tests here are asserting exactly which refusal came back.
export async function applyFile(db, path, { stripNotify = true } = {}) {
  let sql = readFileSync(path, 'utf8')
  if (stripNotify) sql = sql.replace(/^NOTIFY pgrst.*$/m, '')
  try { await db.exec(sql); return { ok: true, msg: null } }
  catch (e) { return { ok: false, msg: String(e.message || e).split('\n')[0] } }
}

// Ask a question as a given role, with or without a session, then always RESET.
// uid null => no JWT at all, which is the state the `anon` role is really in.
export async function asRole(db, role, uid, sql, params = []) {
  await db.exec('RESET ROLE;')
  await db.query("SELECT set_config('request.jwt.claims', $1, false)",
                 [uid ? JSON.stringify({ sub: uid, role: role || 'authenticated' }) : ''])
  if (role) await db.exec(`SET ROLE ${role};`)
  try { return { ok: true, rows: (await db.query(sql, params)).rows } }
  catch (e) { return { ok: false, msg: String(e.message || e).split('\n')[0] } }
  finally { await db.exec('RESET ROLE;') }
}
