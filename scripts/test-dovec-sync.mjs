#!/usr/bin/env node
// ─── Döveç: the full sync against the mock fixture, on the PGlite harness ────
//
//   node scripts/test-dovec-sync.mjs        (npm run dovec:test)
//
// Applies the REAL 20261153 + 20261154 to a Supabase-shaped fixture of the Novest-era schema,
// then runs the whole Döveç pipeline against supabase/functions/sync-dovec/fixtures/dovec-mock.json:
// paginated fetch (fake HTTP serving the fixture pages) → mapFeed → planSync → upserts → image
// plan + mirror (fixture JPEGs, real optimise) → go-live → change detection → delist/relist →
// mass-delist floor. Every visibility claim is asked AS anon / guest / admin, never reasoned.
//
// WHAT THIS ENVIRONMENT DOES DIFFERENTLY FROM PRODUCTION, IN THE DIMENSION UNDER TEST
//   • PGlite is PostgreSQL 18; prod is older. CHECK-on-proposed-row and RESTRICTIVE policy
//     semantics are the same in both; error renderings may not be.
//   • No PostgREST. The writer below emulates supabase-js upsert exactly as PostgREST emits it:
//     INSERT (payload columns) … ON CONFLICT (external_id) DO UPDATE SET <payload columns> — so the
//     sync-novest "CHECK on the proposed insert row" trap is exercised for real. It uses the SAME
//     payload builders and planSync as sync-dovec/index.ts; only the transport differs.
//   • The properties fixture carries the columns, CHECKs and 8 policies the files touch, not the
//     whole production table. Storage is a Map.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freshDb, applyFile, asRole } from './migration-harness.mjs'
import {
  SOURCE, AGENCY_ID, fetchFeed, mapFeed, planSync, projectPayload, unitPayload, parseDelivery, parseLayout,
} from '../supabase/functions/_shared/dovec-feed.mjs'
import { AREAS_BY_REGION, areaSlug } from '../constants/areas.js'
import { planImages, runImages } from './lib/dovec-images.mjs'
import { optimise } from './lib/partner-image-optimise.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mig = n => join(ROOT, 'supabase/migrations', n)
const FIXTURE = JSON.parse(readFileSync(join(ROOT, 'supabase/functions/sync-dovec/fixtures/dovec-mock.json'), 'utf8'))
const ADMIN = '00000000-0000-4000-8000-00000000ad01'
const GUEST = '00000000-0000-4000-8000-00000000c0e5'
const areas = { areasByRegion: AREAS_BY_REGION, areaSlugOf: areaSlug }

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`)
}

// ─── Fixture: the Novest-era schema the two files are written against ───────
const REGIONS = `'nicosia','kyrenia','famagusta','morphou','iskele','lefke','karpaz'`
const SEED = `
CREATE TABLE public.profiles (id uuid PRIMARY KEY, role text);
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
  AS $f$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') $f$;
CREATE FUNCTION public.is_anonymous_session() RETURNS boolean LANGUAGE sql STABLE
  AS $f$ SELECT coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous')::boolean, false) $f$;
CREATE TABLE public.estate_agencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES public.profiles(id), name text NOT NULL,
  logo_url text, website text, description text, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','rejected')),
  contact_name text, contact_phone text, contact_whatsapp text);
CREATE TABLE public.estate_agents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, subscription_expires_at timestamptz);
CREATE TABLE public.properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agent_id uuid REFERENCES public.estate_agents(id), agency_id uuid REFERENCES public.estate_agencies(id),
  title text NOT NULL, description text,
  intent text NOT NULL CHECK (intent IN ('rent','sale','short_term')),
  property_type text NOT NULL CHECK (property_type IN ('apartment','villa','studio','house','land','commercial')),
  price numeric NOT NULL, currency text NOT NULL DEFAULT 'GBP', price_period text,
  bedrooms int, bathrooms int, living_rooms int, area_sqm numeric, net_area_sqm numeric, plot_sqm numeric, floor int,
  furnished boolean, gated_community boolean, district text, area text, development_name text, deed_type text, amenities text[],
  latitude numeric, longitude numeric, location_precision text DEFAULT 'exact',
  status text NOT NULL DEFAULT 'pending', source text, external_id text, source_url text, last_seen_at timestamptz,
  content_hash text, published_at timestamptz, view_count int DEFAULT 0, created_at timestamptz DEFAULT now(),
  CONSTRAINT properties_status_check CHECK (status = ANY (ARRAY['pending','active','rejected','archived','delisted'])),
  CONSTRAINT properties_currency_check CHECK (currency = ANY (ARRAY['GBP','TRY','EUR','USD'])),
  CONSTRAINT properties_district_check CHECK (district = ANY (ARRAY[${REGIONS}])),
  CONSTRAINT properties_price_period_check CHECK (price_period = ANY (ARRAY['monthly','nightly','weekly','yearly','total'])),
  CONSTRAINT properties_amenities_shape_check CHECK (amenities IS NULL OR (cardinality(amenities) BETWEEN 1 AND 60 AND char_length(array_to_string(amenities, ',')) <= 2000)),
  CONSTRAINT properties_structure_range_check CHECK ((floor IS NULL OR floor BETWEEN -5 AND 200) AND (living_rooms IS NULL OR living_rooms BETWEEN 0 AND 20)),
  CONSTRAINT properties_feed_precision_check CHECK (source IS NULL OR (location_precision IS NOT NULL AND location_precision = 'area')),
  CONSTRAINT properties_source_agent_xor_check CHECK ((source IS NULL AND agent_id IS NOT NULL) OR (source IS NOT NULL AND agent_id IS NULL)),
  CONSTRAINT properties_external_id_unique UNIQUE (external_id));
CREATE TABLE public.property_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  url text NOT NULL, sort_order int DEFAULT 0, source_url text, content_hash text, is_primary boolean NOT NULL DEFAULT false);
CREATE UNIQUE INDEX property_images_primary_unique ON public.property_images (property_id) WHERE is_primary;
ALTER TABLE public.estate_agencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY agencies_select_public ON public.estate_agencies FOR SELECT USING (status = 'active' OR owner_id = auth.uid() OR public.is_admin());
CREATE POLICY props_select_public ON public.properties FOR SELECT TO public USING (
  (status = 'active' AND (source IS NOT NULL OR EXISTS (SELECT 1 FROM public.estate_agents ea WHERE ea.id = properties.agent_id
     AND ea.subscription_expires_at IS NOT NULL AND ea.subscription_expires_at > now())))
  OR agent_id IN (SELECT id FROM public.estate_agents WHERE user_id = auth.uid()) OR public.is_admin());
CREATE POLICY props_insert_agent ON public.properties FOR INSERT WITH CHECK (agent_id IN (SELECT id FROM public.estate_agents WHERE user_id = auth.uid()));
CREATE POLICY props_update_agent ON public.properties FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY props_delete_admin ON public.properties FOR DELETE USING (public.is_admin());
CREATE POLICY no_anon_insert_properties ON public.properties AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT public.is_anonymous_session());
CREATE POLICY no_anon_update_properties ON public.properties AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_anonymous_session());
CREATE POLICY no_anon_delete_properties ON public.properties AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_anonymous_session());
CREATE POLICY images_select_public ON public.property_images FOR SELECT TO public USING (true);
CREATE SCHEMA private;
GRANT USAGE ON SCHEMA private TO anon, authenticated;
CREATE FUNCTION private.property_has_photo(p uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $f$ SELECT EXISTS (SELECT 1 FROM public.property_images i WHERE i.property_id = p) $f$;
GRANT EXECUTE ON FUNCTION private.property_has_photo(uuid) TO anon, authenticated;
-- 20261068 exactly as applied.
CREATE POLICY props_hide_photoless_novest ON public.properties AS RESTRICTIVE FOR SELECT TO public
  USING (source IS DISTINCT FROM 'novest' OR public.is_admin() OR private.property_has_photo(id));
INSERT INTO auth.users VALUES ('${ADMIN}'), ('${GUEST}');
INSERT INTO public.profiles VALUES ('${ADMIN}', 'admin');
INSERT INTO public.estate_agencies (id, owner_id, name, status) VALUES ('00000000-0000-4000-9000-000000000002', '${ADMIN}', 'Novest', 'active');
INSERT INTO public.estate_agents (id, user_id, subscription_expires_at) VALUES ('00000000-0000-4000-7000-000000000001', NULL, now() + interval '30 days');
-- Novest + agent controls: the widened photo rule must leave both exactly as they were.
INSERT INTO public.properties (source, external_id, agency_id, title, intent, property_type, price, status, location_precision) VALUES
  ('novest', 'novest-photo',   '00000000-0000-4000-9000-000000000002', 'n1', 'sale', 'villa', 100000, 'active', 'area'),
  ('novest', 'novest-nophoto', '00000000-0000-4000-9000-000000000002', 'n2', 'sale', 'villa', 100000, 'active', 'area');
INSERT INTO public.properties (agent_id, external_id, title, intent, property_type, price, status) VALUES
  ('00000000-0000-4000-7000-000000000001', 'agent-nophoto', 'a1', 'rent', 'apartment', 900, 'active');
INSERT INTO public.property_images (property_id, url, is_primary) SELECT id, 'https://x/n1.jpg', true FROM public.properties WHERE external_id = 'novest-photo';
CREATE TABLE public.contact_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), module text NOT NULL, entity_id uuid NOT NULL, action text NOT NULL,
  region text, lang text, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_events_module_check CHECK (module IN ('accommodation','events','explore','garages','grooming','homeServices','hotels',
    'insurance','jobs','pets','studentHub','towing','transport','ehliyet','connectivity','eatery')),
  CONSTRAINT contact_events_action_check CHECK (action IN ('call','whatsapp','call_secondary','website','maps','route_complete','book',
    'instagram','facebook','email','menu','order_whatsapp')));
`

// ─── The writer: supabase-js upsert / update, as PostgREST sends them ───────
const lit = v => v === null || v === undefined ? 'NULL'
  : Array.isArray(v) ? `ARRAY[${v.map(lit).join(',')}]::text[]`
  : typeof v === 'number' || typeof v === 'boolean' ? String(v)
  : `'${String(v).replace(/'/g, "''")}'`
async function upsert(db, table, rows) {
  for (const r of rows) {
    const cols = Object.keys(r)
    await db.exec(`INSERT INTO public.${table} (${cols.join(',')}) VALUES (${cols.map(c => lit(r[c])).join(',')})
      ON CONFLICT (external_id) DO UPDATE SET ${cols.map(c => `${c} = excluded.${c}`).join(', ')}`)
  }
}
const readExisting = async (db, table) =>
  (await db.query(`SELECT id, external_id, status, content_hash FROM public.${table} WHERE source = $1 ORDER BY id`, [SOURCE])).rows

// One full sync run — the same steps, in the same order, as sync-dovec/index.ts.
async function syncRun(db, feed) {
  const agency = (await db.query('SELECT status FROM public.estate_agencies WHERE id = $1', [AGENCY_ID])).rows[0]
  const publish = agency.status === 'active'
  const mapped = await mapFeed(feed, areas)
  const pPlan = planSync(mapped.projects, await readExisting(db, 'property_projects'), { publish })
  const uPlan = planSync(mapped.units, await readExisting(db, 'properties'), { publish })
  for (const p of [pPlan, uPlan]) if (p.abort) return { abort: p.abort, mapped }
  const now = new Date().toISOString()
  await upsert(db, 'property_projects', pPlan.inserts.map(r => projectPayload(r, { status: pPlan.insertStatus, last_seen_at: now })))
  await upsert(db, 'property_projects', pPlan.updates.map(r => projectPayload(r)))
  const idBy = new Map((await readExisting(db, 'property_projects')).map(r => [r.external_id, r.id]))
  await upsert(db, 'properties', uPlan.inserts.map(r => unitPayload(r, idBy, { status: uPlan.insertStatus, last_seen_at: now })))
  await upsert(db, 'properties', uPlan.updates.map(r => unitPayload(r, idBy)))
  for (const [table, plan] of [['property_projects', pPlan], ['properties', uPlan]]) {
    if (plan.relist.length) await db.query(`UPDATE public.${table} SET status = 'active' WHERE source = $1 AND status = 'delisted' AND external_id = ANY($2)`, [SOURCE, plan.relist.map(r => r.external_id)])
    if (plan.delist.length) await db.query(`UPDATE public.${table} SET status = 'delisted' WHERE source = $1 AND status = 'active' AND external_id = ANY($2)`, [SOURCE, plan.delist.map(r => r.external_id)])
  }
  for (const [table, rows] of [['property_projects', mapped.projects], ['properties', mapped.units]]) {
    if (rows.length) await db.query(`UPDATE public.${table} SET last_seen_at = $1 WHERE source = $2 AND external_id = ANY($3)`, [now, SOURCE, rows.map(r => r.external_id)])
  }
  const n = p => ({ ins: p.inserts.length, upd: p.updates.length, same: p.unchanged, relist: p.relist.length, delist: p.delist.length })
  return { projects: n(pPlan), units: n(uPlan), mapped }
}

// A fake Döveç API: serves the fixture's pages, records what it was sent.
function fakeApi(pages) {
  const seen = []
  return {
    seen,
    fetchImpl: async (url, init) => {
      seen.push({ url, auth: init.headers.Authorization })
      const page = Number(new URL(url).searchParams.get('page'))
      const body = pages[page - 1]
      return { ok: !!body, status: body ? 200 : 404, json: async () => body }
    },
  }
}
const feedOf = async pages => fetchFeed({ baseUrl: 'https://api.mock.invalid/v1', apiKey: 'test-key', fetchImpl: fakeApi(pages).fetchImpl, delayMs: 0 })
const clone = o => JSON.parse(JSON.stringify(o))

// Visible external ids, as a role.
const sees = async (db, role, uid, table) => {
  const r = await asRole(db, role, uid, `SELECT external_id FROM public.${table} WHERE source = 'dovec' OR external_id LIKE 'novest-%' OR external_id LIKE 'agent-%' ORDER BY external_id`)
  if (!r.ok) return `ERROR ${r.msg}`
  return r.rows.map(x => x.external_id)
}
const asGuest = (db, sql) => asRole(db, 'authenticated', null, sql)

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n── parsers')
t('2027-Q2 → first day of the quarter', parseDelivery('2027-Q2'), '2027-04-01')
t('ISO date kept', parseDelivery('2025-11-30'), '2025-11-30')
t('garbage → null', parseDelivery('soon'), null)
t('"2+1" → 2 bedrooms + 1 salon', parseLayout('2+1'), { bedrooms: 2, living_rooms: 1 })
t('"Studio" → 0 bedrooms', parseLayout('Studio'), { bedrooms: 0, living_rooms: null })

console.log('\n── migrations (real files)')
const db = await freshDb(SEED)
await db.exec(`SELECT set_config('request.jwt.claims', '', false)`)
t('20261153 applies (its own pre-flight + role probes green)', await applyFile(db, mig('20261153_dovec_partner_feed.sql')), { ok: true, msg: null })
t('20261154 applies (16-module pre-state, dovec accepted, control refused)', await applyFile(db, mig('20261154_contact_events_dovec.sql')), { ok: true, msg: null })
t('Döveç agency seeded pending', (await db.query(`SELECT status FROM public.estate_agencies WHERE id = $1`, [AGENCY_ID])).rows[0]?.status, 'pending')
t('properties still has exactly 8 policies', (await db.query(`SELECT count(*)::int n FROM pg_policies WHERE tablename = 'properties'`)).rows[0].n, 8)

console.log('\n── Novest + agent rows are unchanged by the widened photo rule')
t('anon: novest-photo + agent-nophoto, NOT novest-nophoto', await sees(db, 'anon', null, 'properties'), ['agent-nophoto', 'novest-photo'])

console.log('\n── fetch: pagination + auth')
const api = fakeApi(FIXTURE.pages)
const feed = await fetchFeed({ baseUrl: 'https://api.mock.invalid/v1/', apiKey: 'test-key', fetchImpl: api.fetchImpl, delayMs: 0 })
t('both pages read → 4 projects', feed.length, 4)
t('two requests, bearer key on each', api.seen.map(s => [new URL(s.url).pathname, new URL(s.url).searchParams.get('page'), s.auth]),
  [['/v1/projects', '1', 'Bearer test-key'], ['/v1/projects', '2', 'Bearer test-key']])
let refused = null
try { await fetchFeed({ baseUrl: '', apiKey: '' }) } catch (e) { refused = e.message }
t('no URL/key → refuses before any request', /not connected/.test(refused ?? ''), true)

console.log('\n── mapping')
const m = await mapFeed(feed, areas)
t('projects mapped', m.projects.map(p => p.external_id), ['dovec-p101', 'dovec-p102', 'dovec-p103', 'dovec-p104'])
t('units mapped (sold, reserved, parking skipped)', m.units.map(u => u.external_id),
  ['dovec-u5001', 'dovec-u5002', 'dovec-u5004', 'dovec-u5101', 'dovec-u5102', 'dovec-u5201', 'dovec-u5202', 'dovec-u5301', 'dovec-u5302'])
t('skipped carry id + reason only', m.skipped, ['dovec-u5003: sold', 'dovec-u5103: reserved', 'dovec-u5303: category "parking"'])
const p101 = m.projects[0]
t('status vocab: under_construction / selling / delivered / selling', m.projects.map(p => p.project_status), ['under_construction', 'selling', 'delivered', 'selling'])
t('delivered project → progress 100', m.projects[2].construction_progress, 100)
t('İskele / Long Beach placed', [p101.district, p101.area], ['iskele', 'long-beach'])
t('site pin stored as exact', [p101.latitude, p101.longitude, p101.location_precision], [35.2906, 33.9247, 'exact'])
t('contact block cut from project text (no phone left)', /539|105 05/.test(p101.description ?? ''), false)
t('…and the real text kept', /Long Beach/.test(p101.description ?? ''), true)
t('e-mail cut from unit 5002', /@/.test(m.units[1].description ?? ''), false)
const ph = m.units.find(u => u.external_id === 'dovec-u5004')
t('penthouse on request: price NULL + flag', [ph.price, ph.price_on_request, ph.currency], [null, true, 'GBP'])
t('project 104 on request', [m.projects[3].price_from, m.projects[3].price_on_request], [null, true])
t('unit title = project · layout code', m.units[1].title, 'Mavi Kıyı Residences · 2+1 B-305')

console.log('\n── run 1, agency PENDING: everything lands pending, nobody sees it')
const r1 = await syncRun(db, feed)
t('projects: 4 inserted', r1.projects, { ins: 4, upd: 0, same: 0, relist: 0, delist: 0 })
t('units: 9 inserted', r1.units, { ins: 9, upd: 0, same: 0, relist: 0, delist: 0 })
t('every Döveç row is pending', (await db.query(`SELECT DISTINCT status FROM public.properties WHERE source='dovec' UNION SELECT DISTINCT status FROM public.property_projects`)).rows.map(r => r.status), ['pending'])
t('anon sees no Döveç project', await sees(db, 'anon', null, 'property_projects'), [])
t('anon sees no Döveç unit (Konaklama stays clean)', (await sees(db, 'anon', null, 'properties')).filter(x => x.startsWith('dovec')), [])
t('admin sees all 4 projects', (await sees(db, 'authenticated', ADMIN, 'property_projects')).length, 4)

console.log('\n── images: mirror the fixture photos')
const store = new Map()
const assetFile = url => join(ROOT, 'assets/dovec-mock', new URL(url).pathname.split('/').pop())
const io = {
  async fetchImage(url) { return { body: readFileSync(assetFile(url)), contentType: 'image/jpeg' } },
  optimise,
  async upload(path, buffer) { store.set(path, buffer.length); return `https://storage.mock/property-images/${path}` },
  async insertImage(row) { await upsertImage(row) },
  async setCover(id, url, src) { await db.query('UPDATE public.property_projects SET cover_image_url = $1, cover_source_url = $2 WHERE id = $3', [url, src, id]) },
}
async function upsertImage(r) {
  await db.query('INSERT INTO public.property_images (property_id, url, source_url, sort_order, is_primary) VALUES ($1,$2,$3,$4,$5)',
    [r.property_id, r.url, r.source_url, r.sort_order, r.is_primary])
}
const imgState = async () => ({
  dbProjects: (await db.query(`SELECT id, external_id, cover_source_url FROM public.property_projects WHERE source='dovec'`)).rows,
  dbUnits: (await db.query(`SELECT id, external_id FROM public.properties WHERE source='dovec'`)).rows,
  haveImages: (await db.query(`SELECT property_id, source_url, is_primary FROM public.property_images`)).rows,
})
const plan1 = planImages({ mapped: m, ...(await imgState()) })
t('plan: 3 covers (104 has none), 7 unit images', [plan1.covers.length, plan1.unitJobs.length], [3, 7])
const res1 = await runImages(plan1, io)
t('all 10 mirrored, 0 failures', [res1.mirrored, res1.failed], [10, []])
t('paths keyed on external id + media id', [...store.keys()].includes('partner/dovec/dovec-u5002/m5002-2.jpg'), true)
t('one primary per unit with photos', (await db.query(`SELECT count(*)::int n FROM public.property_images WHERE is_primary`)).rows[0].n - 1, 6)
t('re-run plans nothing (resumable)', (({ covers, unitJobs }) => [covers.length, unitJobs.length])(planImages({ mapped: m, ...(await imgState()) })), [0, 0])

console.log('\n── go-live (the PLUG-IN.md step 6 UPDATE, simulated)')
await db.exec(`UPDATE public.estate_agencies SET status = 'active' WHERE id = '${AGENCY_ID}';
  UPDATE public.property_projects SET status = 'active' WHERE source = 'dovec' AND status = 'pending';
  UPDATE public.properties SET status = 'active' WHERE source = 'dovec' AND status = 'pending';`)
t('anon: projects with a cover only (104 hidden)', await sees(db, 'anon', null, 'property_projects'), ['dovec-p101', 'dovec-p102', 'dovec-p103'])
const liveUnits = ['dovec-u5001', 'dovec-u5002', 'dovec-u5004', 'dovec-u5101', 'dovec-u5201', 'dovec-u5202']
t('anon: units with a photo only (5102, 5301, 5302 hidden)', (await sees(db, 'anon', null, 'properties')).filter(x => x.startsWith('dovec')), liveUnits)
t('guest (authenticated, anonymous) sees the same', (await sees(db, 'authenticated', GUEST, 'properties')).filter(x => x.startsWith('dovec')), liveUnits)
t('admin sees every unit incl. photo-less', (await sees(db, 'authenticated', ADMIN, 'properties')).filter(x => x.startsWith('dovec')).length, 9)
t('agency row now public (phone readable)', (await asRole(db, 'anon', null, `SELECT contact_phone FROM public.estate_agencies WHERE id = '${AGENCY_ID}'`)).rows, [{ contact_phone: '+905391050515' }])
const write = await asRole(db, 'authenticated', GUEST, `UPDATE public.property_projects SET name = 'x' RETURNING id`)
t('a client cannot write a project (denial)…', write.ok, false)
t('…while it can read one (positive control)', (await asRole(db, 'authenticated', GUEST, `SELECT name FROM public.property_projects WHERE external_id='dovec-p101'`)).rows, [{ name: 'Mavi Kıyı Residences' }])

console.log('\n── run 2, nothing changed')
const r2 = await syncRun(db, await feedOf(FIXTURE.pages))
t('projects: all unchanged', r2.projects, { ins: 0, upd: 0, same: 4, relist: 0, delist: 0 })
t('units: all unchanged', r2.units, { ins: 0, upd: 0, same: 9, relist: 0, delist: 0 })

console.log('\n── run 3: price edit, progress edit, a unit sells')
const changed = clone(FIXTURE.pages)
changed[0].data[0].progress_percent = 70
changed[0].data[0].units[1].price.amount = 219000
changed[1].data[0].units[0].availability = 'sold'
const r3 = await syncRun(db, await feedOf(changed))
t('projects: 1 update (progress)', r3.projects, { ins: 0, upd: 1, same: 3, relist: 0, delist: 0 })
t('units: 1 update (price), 1 delist (sold)', r3.units, { ins: 0, upd: 1, same: 7, relist: 0, delist: 1 })
t('price written through the upsert path', (await db.query(`SELECT price::int, status FROM public.properties WHERE external_id='dovec-u5002'`)).rows[0], { price: 219000, status: 'active' })
t('progress written', (await db.query(`SELECT construction_progress FROM public.property_projects WHERE external_id='dovec-p101'`)).rows[0].construction_progress, 70)
t('sold unit delisted, row kept', (await db.query(`SELECT status FROM public.properties WHERE external_id='dovec-u5201'`)).rows[0].status, 'delisted')
t('anon no longer sees it', (await sees(db, 'anon', null, 'properties')).includes('dovec-u5201'), false)

console.log('\n── run 4: the sale falls through → relisted')
const r4 = await syncRun(db, await feedOf(FIXTURE.pages))
t('units: relist 1 + the two edits reverted', r4.units, { ins: 0, upd: 1, same: 8, relist: 1, delist: 0 })
t('relisted unit visible again', (await sees(db, 'anon', null, 'properties')).includes('dovec-u5201'), true)

console.log('\n── run 5: a broken feed (one project) trips the mass-delist floor')
const r5 = await syncRun(db, await feedOf([{ data: [FIXTURE.pages[1].data[1]], meta: { last_page: 1 } }]))
t('aborted before any write', /below the 70% floor/.test(r5.abort ?? ''), true)
t('nothing delisted', (await db.query(`SELECT count(*)::int n FROM public.properties WHERE source='dovec' AND status='delisted'`)).rows[0].n, 0)

console.log('\n── leads: contact_events accepts a dovec tap (grants/RLS unchanged by 20261154, not modelled here)')
const pid = (await db.query(`SELECT id FROM public.property_projects WHERE external_id='dovec-p101'`)).rows[0].id
t('dovec/call insert accepted', (await db.query(`INSERT INTO public.contact_events (module, entity_id, action) VALUES ('dovec', $1, 'call') RETURNING module`, [pid])).rows, [{ module: 'dovec' }])

console.log('\n── mutants: 20261153 must refuse a database it was not written for')
const dir = mkdtempSync(join(tmpdir(), 'dovec-'))
const mutant = async (name, seedExtra, sqlEdit = s => s) => {
  const p = join(dir, name.replace(/\W+/g, '_') + '.sql')
  writeFileSync(p, sqlEdit(readFileSync(mig('20261153_dovec_partner_feed.sql'), 'utf8')))
  const d = await freshDb(SEED + seedExtra)
  const r = await applyFile(d, p)
  t(`${name} → refused`, r.ok, false)
  console.log(`      ${r.msg}`)
}
await mutant('a 9th policy on properties', `CREATE POLICY zz_extra ON public.properties FOR SELECT USING (false);`)
await mutant('no admin profile', `UPDATE public.profiles SET role = 'customer';`)
await mutant('photo rule not widened (assertion must notice)', '', s => {
  const a = 'USING (source IS NULL OR public.is_admin() OR private.property_has_photo(id));'
  if (!s.includes(a)) throw new Error('anchor missing')
  return s.replace(a, "USING (source IS DISTINCT FROM 'novest' OR public.is_admin() OR private.property_has_photo(id));")
})
await mutant('price coupling dropped (probe must notice)', '', s => {
  const a = 'CHECK ((price_on_request AND price IS NULL) OR (NOT price_on_request AND price IS NOT NULL));'
  if (!s.includes(a)) throw new Error('anchor missing')
  return s.replace(a, 'CHECK (true);')
})
await mutant('project policy opened to pending rows (probe must notice)', '', s => {
  const a = "USING ((status = 'active' AND cover_image_url IS NOT NULL) OR public.is_admin());"
  if (!s.includes(a)) throw new Error('anchor missing')
  return s.replace(a, 'USING (true);')
})

if (bad) { console.log(`\n${bad} FAILED`); process.exit(1) }
console.log('\nall green')
