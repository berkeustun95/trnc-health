// 20261178 + 20261179 against a Supabase-shaped Postgres (scripts/migration-harness.mjs).
// The claim under test: a staged OSM row exists ONLY for a request carrying the ADA Preview key —
// anon and signed-in production users see none of them, and the public 'active' read is unchanged.
import assert from 'node:assert/strict'
import { freshDb, applyFile, asRole } from './migration-harness.mjs'

// The minimum of places that the two files touch, in its production shape: the 20260822 status check
// and places_select, the 20260824 restrictive hide policy, the 20261045 source pair + UNIQUE.
// is_previewer() stands in for 20261120's header read with a session GUC.
const SEED = `
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.is_previewer() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('test.preview', true), '') = 'yes' $$;
CREATE TABLE public.places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), category text NOT NULL, name text NOT NULL,
  region text NOT NULL, latitude double precision, longitude double precision, address text, phone text, website text,
  status text NOT NULL DEFAULT 'pending', submitted_by uuid, provider_id uuid, hidden_at timestamptz,
  source text, source_id text,
  CONSTRAINT places_status_check CHECK (status = ANY (ARRAY['pending','active','rejected']::text[])),
  CONSTRAINT places_source_pair_check CHECK ((source IS NULL) = (source_id IS NULL)),
  CONSTRAINT places_source_source_id_key UNIQUE (source, source_id)
);
ALTER TABLE public.places ENABLE ROW LEVEL SECURITY;
CREATE POLICY "places_select" ON public.places FOR SELECT TO public
  USING (status = 'active' OR submitted_by = auth.uid() OR provider_id = auth.uid() OR is_admin());
CREATE POLICY "places_hide_reported" ON public.places AS RESTRICTIVE FOR SELECT
  USING (hidden_at IS NULL OR submitted_by = auth.uid() OR provider_id = auth.uid() OR is_admin());
GRANT SELECT ON public.places TO anon, authenticated;
INSERT INTO public.places (name, category, region, status) VALUES ('Bellapais Abbey', 'religious_site', 'kyrenia', 'active');
`
const USER = '00000000-0000-0000-0000-000000000001'
const db = await freshDb(SEED)
let r = await applyFile(db, 'supabase/migrations/20261179_osm_free_listings.sql')
assert.equal(r.ok, false, '1179 must refuse before 1178')
assert.match(r.msg, /20261178/)
await db.exec('ROLLBACK; RESET ROLE;')   // the refusal aborts inside BEGIN, as on the real database

r = await applyFile(db, 'supabase/migrations/20261178_places_staged_preview.sql')
assert.ok(r.ok, `1178: ${r.msg}`)
r = await applyFile(db, 'supabase/migrations/20261179_osm_free_listings.sql')
assert.ok(r.ok, `1179: ${r.msg}`)
const total = (await db.query("SELECT count(*)::int n FROM public.places WHERE source = 'osm' AND status = 'staged'")).rows[0].n
assert.ok(total > 300, `staged rows: ${total}`)

const seen = async (role, uid, preview) => {
  await db.exec(`SELECT set_config('test.preview', '${preview ? 'yes' : ''}', false)`)
  const q = await asRole(db, role, uid, "SELECT count(*) FILTER (WHERE status = 'staged')::int staged, count(*) FILTER (WHERE status = 'active')::int active FROM public.places")
  assert.ok(q.ok, q.msg)
  return q.rows[0]
}
assert.deepEqual(await seen('anon', null, false), { staged: 0, active: 1 }, 'anon, production: no staged rows, the active one still there')
assert.deepEqual(await seen('authenticated', USER, false), { staged: 0, active: 1 }, 'signed in, production: no staged rows')
assert.deepEqual(await seen('anon', null, true), { staged: total, active: 1 }, 'anon, Preview key: all staged rows')
assert.deepEqual(await seen('authenticated', USER, true), { staged: total, active: 1 }, 'signed in, Preview key: all staged rows')

// A hidden staged row stays hidden even for Preview (the restrictive policy still applies).
await db.exec("UPDATE public.places SET hidden_at = now() WHERE source_id = (SELECT min(source_id) FROM public.places WHERE source = 'osm')")
assert.equal((await seen('anon', null, true)).staged, total - 1, 'hidden staged row hidden for Preview too')

// Re-running the import adds nothing.
r = await applyFile(db, 'supabase/migrations/20261179_osm_free_listings.sql')
assert.ok(r.ok, `1179 rerun: ${r.msg}`)
assert.equal((await db.query("SELECT count(*)::int n FROM public.places WHERE source = 'osm'")).rows[0].n, total, 'rerun is a no-op')

// A user still cannot write a staged row (no insert policy here at all → refused for anon).
r = await asRole(db, 'anon', null, "INSERT INTO public.places (name, category, region, status) VALUES ('x', 'cafe', 'nicosia', 'staged')")
assert.equal(r.ok, false, 'anon cannot insert')

console.log(`osm staged: OK (${total} staged rows; production anon/authenticated see 0, Preview sees all; rerun no-op)`)
