// Araçlar S1 (20261164 → 20261167) and S3 (20261181) against the PGlite harness (PostgreSQL 18; prod is older, see supabase/CLAUDE.md).
// Applies the release in order on a fixture that stubs what production already has (profiles, is_admin, is_previewer,
// the word filters, content_reports + the 20260712/20260824 moderation functions, contact_events, storage, pg_cron,
// the 20261104 notify functions, 20261033's admin_content_author), then answers: who can post, read, edit, approve, renew and report what.
// Red-first mutants prove the in-file assertions and the behaviour checks can fail.
// Not wired into CI, like its siblings: run by hand.
//
//   node scripts/test-vehicles-sql.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { freshDb, applyFile as applyRaw } from './migration-harness.mjs'

const mig = f => fileURLToPath(new URL(`../supabase/migrations/${f}`, import.meta.url))
const RELEASE = ['20261164_shared_adult_age.sql', '20261165_vehicles.sql', '20261166_vehicles_moderation.sql', '20261167_cars_waitlist_notify.sql',
  '20261181_vehicle_admin_author.sql'].map(mig)
const read = f => readFileSync(mig(f), 'utf8')

// Slice `CREATE … FUNCTION <name>(` up to its closing dollar-quote terminator, from an earlier migration.
function slice(file, head, close) {
  const t = read(file)
  const s = t.indexOf(head)
  if (s < 0) throw new Error(`${file}: ${head} not found`)
  const body = t.indexOf(close, t.indexOf(close, s) + close.length)
  return t.slice(s, body + close.length) + ';'
}
const OLD_AGE = slice('20261036_age_oracle_needs_a_real_caller.sql', 'CREATE OR REPLACE FUNCTION public.may_initiate_by_age(', '$function$')
const GUARD_MOD = slice('20260712_ugc_moderation.sql', 'CREATE OR REPLACE FUNCTION guard_moderation_columns()', '$$')
const AUTO_HIDE = slice('20260824_place_moderation.sql', 'CREATE OR REPLACE FUNCTION auto_hide_reported_content()', '$$')
const NOTIF_TXT = slice('20261104_duyurular_waitlist_notify.sql', 'CREATE OR REPLACE FUNCTION public.module_notif_text(', '$function$')
const OLD_AUTHOR = slice('20261033_reviews_author_not_public.sql', 'CREATE OR REPLACE FUNCTION public.admin_content_author(', '$function$')
const NOTIFY = slice('20261104_duyurular_waitlist_notify.sql', 'CREATE OR REPLACE FUNCTION public.notify_module_waitlist(', '$function$')

const U = {
  owner:  '00000000-0000-4000-8000-0000000000a1',
  owner2: '00000000-0000-4000-8000-0000000000a2',
  minor:  '00000000-0000-4000-8000-0000000000a3',
  nodob:  '00000000-0000-4000-8000-0000000000a4',
  banned: '00000000-0000-4000-8000-0000000000a5',
  admin:  '00000000-0000-4000-8000-0000000000a6',
  guest:  '00000000-0000-4000-8000-0000000000a7',
  r1: '00000000-0000-4000-8000-0000000000b1', r2: '00000000-0000-4000-8000-0000000000b2', r3: '00000000-0000-4000-8000-0000000000b3',
}
const MODS16 = ['accommodation','events','explore','garages','grooming','homeServices','hotels','insurance','jobs','pets','studentHub','towing','transport','ehliyet','connectivity','eatery']

const FIXTURE = ({ contactMods = MODS16 } = {}) => `
CREATE SCHEMA private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO anon, authenticated;

CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid serial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean NOT NULL DEFAULT true);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $f$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (n, s, c) RETURNING jobid $f$;
CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS $f$ DELETE FROM cron.job WHERE jobname = n RETURNING true $f$;

CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $f$
  SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $f$;
GRANT USAGE ON SCHEMA storage TO anon, authenticated;
GRANT ALL ON storage.objects TO authenticated;
CREATE POLICY "property_images_upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'property-images');

CREATE FUNCTION public.is_anonymous_session() RETURNS boolean LANGUAGE sql STABLE SET search_path TO '' AS $f$
  SELECT coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous')::boolean, false) $f$;
-- Stand-in for the preview-key header: a claim the test sets.
CREATE FUNCTION public.is_previewer() RETURNS boolean LANGUAGE sql STABLE SET search_path TO '' AS $f$
  SELECT coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'preview')::boolean, false) $f$;

CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, role text NOT NULL DEFAULT 'customer',
  date_of_birth date, ugc_banned_until timestamptz);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_own ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') $f$;
CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT role FROM profiles WHERE id = auth.uid() $f$;
CREATE FUNCTION public.contains_blocked_term(p text) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT p ILIKE '%badword%' $f$;
CREATE FUNCTION public.contains_payment_solicitation(p text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT p ~* '\\miban\\M' $f$;

INSERT INTO auth.users (id) VALUES ${Object.values(U).map(id => `('${id}')`).join(', ')};
INSERT INTO public.profiles (id, role, date_of_birth, ugc_banned_until) VALUES
  ('${U.owner}',  'customer', '1990-05-01', NULL),
  ('${U.owner2}', 'customer', '1985-01-01', NULL),
  ('${U.minor}',  'customer', (current_date - interval '16 years')::date, NULL),
  ('${U.nodob}',  'customer', NULL, NULL),
  ('${U.banned}', 'customer', '1980-01-01', now() + interval '7 days'),
  ('${U.admin}',  'admin',    '1980-01-01', NULL),
  ('${U.guest}',  'customer', NULL, NULL),
  ('${U.r1}', 'customer', '1990-01-01', NULL), ('${U.r2}', 'customer', '1990-01-01', NULL), ('${U.r3}', 'customer', '1990-01-01', NULL);

CREATE TABLE public.contact_events (id bigserial PRIMARY KEY, module text NOT NULL, entity_id text, action text,
  CONSTRAINT contact_events_module_check CHECK (module IN (${contactMods.map(m => `'${m}'`).join(',')})));

CREATE TABLE public.content_reports (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reporter_id uuid NOT NULL DEFAULT auth.uid(),
  content_type text NOT NULL, content_id uuid NOT NULL, reason text NOT NULL DEFAULT 'spam', status text NOT NULL DEFAULT 'pending',
  UNIQUE (reporter_id, content_type, content_id),
  CONSTRAINT content_reports_content_type_check CHECK (content_type IN ('answer','facility','message','place','profile','question','review')));
ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY cr_insert ON public.content_reports FOR INSERT TO authenticated WITH CHECK (reporter_id = auth.uid());
${GUARD_MOD}
${AUTO_HIDE}
CREATE TRIGGER auto_hide_on_report AFTER INSERT ON public.content_reports FOR EACH ROW EXECUTE FUNCTION auto_hide_reported_content();

${OLD_AGE}
${OLD_AUTHOR}
REVOKE ALL ON FUNCTION public.admin_content_author(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_content_author(text, uuid) TO authenticated;
${NOTIF_TXT}
${NOTIFY}
REVOKE EXECUTE ON FUNCTION public.notify_module_waitlist(text) FROM PUBLIC, anon;
`

const applyFile = async (d, f) => {
  const r = await applyRaw(d, f)
  if (!r.ok) await d.exec('ROLLBACK; RESET ROLE;')
  return r
}
async function ready(files = RELEASE, fixture = FIXTURE()) {
  const d = await freshDb(fixture)
  for (const f of files) {
    const r = await applyFile(d, f)
    if (!r.ok) return { d, r: { ...r, file: f.split('/').pop() } }
  }
  return { d, r: { ok: true, msg: null } }
}

// Run SQL as a session. who: a user key, 'anon', or 'postgres'. opts: guest, preview.
async function as(d, who, sql, { guest = false, preview = false, multi = false } = {}) {
  await d.exec('RESET ROLE;')
  const claims = who === 'anon' || who === 'postgres'
    ? (preview ? JSON.stringify({ role: 'anon', preview: true }) : '')
    : JSON.stringify({ sub: U[who], role: 'authenticated', ...(guest ? { is_anonymous: true } : {}), ...(preview ? { preview: true } : {}) })
  await d.query("SELECT set_config('request.jwt.claims', $1, false)", [claims])
  if (who === 'anon') await d.exec('SET ROLE anon;')
  else if (who !== 'postgres') await d.exec('SET ROLE authenticated;')
  try { return { ok: true, rows: multi ? (await d.exec(sql), []) : (await d.query(sql)).rows, msg: null } }
  catch (e) { return { ok: false, rows: [], msg: String(e.message || e).split('\n')[0] } }
  finally { await d.exec('RESET ROLE;'); await d.query("SELECT set_config('request.jwt.claims', '', false)") }
}

let bad = 0
const failures = []
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) { bad++; failures.push(name) }
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}

const LISTING = (o = {}) => {
  const v = { intent: 'sale', make: 'Toyota', model: 'Corolla', year: 2018, km: 65000, fuel: 'petrol', gearbox: 'automatic',
    body_type: 'sedan', colour: 'white', steering: 'right', price: 9500, currency: 'GBP', price_per_day: null,
    region: 'Girne', area: 'Alsancak', description: 'Tek elden, bakımlı.', contact_phone: '+905338000000', whatsapp: null, ...o }
  const cols = Object.keys(v)
  const val = x => x === null ? 'NULL' : typeof x === 'number' ? String(x) : `'${String(x).replace(/'/g, "''")}'`
  return `INSERT INTO public.vehicles (${cols.join(', ')}) VALUES (${cols.map(c => val(v[c])).join(', ')}) RETURNING id`
}
const n = r => Number(r.rows?.[0]?.n ?? NaN)
const countVisible = (d, who, opts) => as(d, who, 'SELECT count(*) n FROM public.vehicles', opts).then(n)

async function behaviour(d) {
  // ── Posting ──────────────────────────────────────────────────────────────
  const p1 = await as(d, 'owner', LISTING())
  t('an adult signed-in user posts a sale listing', p1.ok, true)
  const v1 = p1.rows[0]?.id
  t('…it lands as their own pending private listing',
    (await as(d, 'postgres', `SELECT status, source, owner_id = '${U.owner}' mine, expires_at IS NULL noexp FROM public.vehicles WHERE id = '${v1}'`)).rows[0],
    { status: 'pending', source: 'private', mine: true, noexp: true })
  t('posting with status active is refused (column not granted)', /permission denied/.test((await as(d, 'owner', LISTING().replace('(intent,', '(status, intent,').replace("VALUES ('sale'", "VALUES ('active', 'sale'"))).msg), true)
  t('posting for someone else is refused (owner_id not granted)', /permission denied/.test((await as(d, 'owner', LISTING().replace('(intent,', '(owner_id, intent,').replace("VALUES ('sale'", `VALUES ('${U.owner2}', 'sale'`))).msg), true)
  t('a guest cannot post', (await as(d, 'guest', LISTING(), { guest: true })).ok, false)
  t('anon cannot post', /permission denied/.test((await as(d, 'anon', LISTING())).msg), true)
  t('an under-18 is refused with UNDER_18', (await as(d, 'minor', LISTING())).msg, 'UNDER_18')
  t('no date of birth is refused with NO_DOB', (await as(d, 'nodob', LISTING())).msg, 'NO_DOB')
  t('a UGC-banned user is refused with UGC_BANNED', (await as(d, 'banned', LISTING())).msg, 'UGC_BANNED')
  t('a blocked term is refused', (await as(d, 'owner2', LISTING({ description: 'badword here' }))).msg, 'BLOCKED_TERM')
  t('payment instructions are refused', (await as(d, 'owner2', LISTING({ description: 'IBAN ile kapora' }))).msg, 'BLOCKED_PAYMENT')
  t('a sale without a price is refused', (await as(d, 'owner2', LISTING({ price: null }))).ok, false)
  t('a rental with a sale price is refused', (await as(d, 'owner2', LISTING({ intent: 'rent', price_per_day: 40 }))).ok, false)
  t('a rental with a daily price is accepted (positive control)', (await as(d, 'owner2', LISTING({ intent: 'rent', price: null, price_per_day: 40 }))).ok, true)
  t('a listing with no phone and no WhatsApp is refused', (await as(d, 'owner2', LISTING({ contact_phone: null }))).ok, false)
  t('a malformed phone is refused', (await as(d, 'owner2', LISTING({ contact_phone: 'call me' }))).ok, false)
  const p2 = await as(d, 'owner', LISTING({ model: 'Yaris' }))
  const p3 = await as(d, 'owner', LISTING({ model: 'Auris' }))
  t('the owner reaches 3 open listings', p2.ok && p3.ok, true)
  t('the 4th open listing is refused with VEHICLE_LIMIT', (await as(d, 'owner', LISTING({ model: 'Prius' }))).msg, 'VEHICLE_LIMIT')
  const v2 = p2.rows[0]?.id, v3 = p3.rows[0]?.id

  // ── Visibility of pending ────────────────────────────────────────────────
  t('anon sees no pending listing', await countVisible(d, 'anon'), 0)
  t('another user sees none of the owner\'s pending listings', n(await as(d, 'owner2', `SELECT count(*) n FROM public.vehicles WHERE id IN ('${v1}', '${v2}', '${v3}')`)), 0)
  t('the owner sees their own 3 through my_vehicles()', n(await as(d, 'owner', `SELECT count(*) n FROM public.my_vehicles()`)), 3)
  t('my_vehicles() returns only the caller\'s own (owner2: their rental)', n(await as(d, 'owner2', `SELECT count(*) n FROM public.my_vehicles()`)), 1)
  t('anon cannot call my_vehicles()', (await as(d, 'anon', `SELECT * FROM public.my_vehicles()`)).ok, false)
  t('a guest gets nothing from my_vehicles()', n(await as(d, 'owner', `SELECT count(*) n FROM public.my_vehicles()`, { guest: true })), 0)
  t('no client can read owner_id (anon)', /permission denied/.test((await as(d, 'anon', 'SELECT owner_id FROM public.vehicles')).msg), true)
  t('no client can read owner_id (signed in)', /permission denied/.test((await as(d, 'owner', 'SELECT owner_id FROM public.vehicles')).msg), true)
  t('select * is refused, named columns work (positive control)', [(await as(d, 'owner', 'SELECT * FROM public.vehicles')).ok, (await as(d, 'owner', 'SELECT id, make FROM public.vehicles')).ok], [false, true])
  t('a multi-row insert past the cap is refused as a whole', (await as(d, 'owner2', LISTING({ model: 'A' }).replace(' RETURNING id', '') + ', ' + LISTING({ model: 'B' }).replace(/^.*VALUES /s, '').replace(' RETURNING id', '') + ', ' + LISTING({ model: 'C' }).replace(/^.*VALUES /s, ''))).msg, 'VEHICLE_LIMIT')
  t('…and wrote nothing (owner2 still has 1)', n(await as(d, 'owner2', `SELECT count(*) n FROM public.my_vehicles()`)), 1)
  t('the admin sees all 4', await countVisible(d, 'admin'), 4)
  t('ADA Preview does not see pending private listings', await countVisible(d, 'anon', { preview: true }), 0)

  // ── Approval ─────────────────────────────────────────────────────────────
  t('the owner cannot approve their own listing', (await as(d, 'owner', `UPDATE public.vehicles SET status = 'active' WHERE id = '${v1}'`)).msg, 'VEHICLE_STATUS')
  t('a non-admin cannot approve another\'s listing (no row matches)', (await as(d, 'owner2', `UPDATE public.vehicles SET status = 'active' WHERE id = '${v1}' RETURNING id`)).rows.length, 0)
  t('the admin approves', (await as(d, 'admin', `UPDATE public.vehicles SET status = 'active' WHERE id = '${v1}'`)).ok, true)
  t('…which stamps published_at and a 30-day expiry',
    (await as(d, 'postgres', `SELECT published_at IS NOT NULL pub, expires_at BETWEEN now() + interval '29 days 23 hours' AND now() + interval '30 days 1 hour' exp FROM public.vehicles WHERE id = '${v1}'`)).rows[0],
    { pub: true, exp: true })
  t('an approved listing without a photo stays hidden from anon', await countVisible(d, 'anon'), 0)
  t('the admin cannot edit listing content', (await as(d, 'admin', `UPDATE public.vehicles SET price = 1 WHERE id = '${v1}'`)).msg, 'VEHICLE_FIELD_LOCKED')

  // ── Photos ───────────────────────────────────────────────────────────────
  const img = vid => `INSERT INTO public.vehicle_images (vehicle_id, storage_path, sort_order) VALUES ('${vid}', '${vid}/${randomUUID()}.jpg', 0)`
  t('photos cannot be added to an approved listing', (await as(d, 'owner', img(v1))).ok, false)
  t('the owner adds a photo to their pending listing', (await as(d, 'owner', img(v2))).ok, true)
  t('a photo path outside <vehicle>/<uuid>.<ext> is refused', (await as(d, 'owner', `INSERT INTO public.vehicle_images (vehicle_id, storage_path) VALUES ('${v2}', '${U.owner}/${v2}/a.jpg')`)).ok, false)
  t('a photo path under another listing is refused', (await as(d, 'owner', `INSERT INTO public.vehicle_images (vehicle_id, storage_path) VALUES ('${v2}', '${v3}/${randomUUID()}.jpg')`)).ok, false)
  t('another user cannot add photos to the owner\'s listing', (await as(d, 'owner2', img(v2))).ok, false)
  t('anon cannot see photos of a pending listing', n(await as(d, 'anon', 'SELECT count(*) n FROM public.vehicle_images')), 0)
  for (let i = 1; i < 8; i++) await as(d, 'owner', img(v2))
  t('8 photos reached', n(await as(d, 'owner', `SELECT count(*) n FROM public.vehicle_images WHERE vehicle_id = '${v2}'`)), 8)
  t('the 9th photo is refused', (await as(d, 'owner', img(v2))).msg, 'VEHICLE_PHOTO_LIMIT')
  t('the admin approves the photographed listing', (await as(d, 'admin', `UPDATE public.vehicles SET status = 'active' WHERE id = '${v2}'`)).ok, true)
  t('anon now sees exactly that listing', (await as(d, 'anon', 'SELECT id FROM public.vehicles')).rows.map(r => r.id), [v2])
  t('…and its 8 photos', n(await as(d, 'anon', 'SELECT count(*) n FROM public.vehicle_images')), 8)
  t('anon cannot add photos', (await as(d, 'anon', img(v2))).ok, false)

  // ── Edits go back to review ──────────────────────────────────────────────
  t('the owner edits the approved listing\'s price', (await as(d, 'owner', `UPDATE public.vehicles SET price = 9000 WHERE id = '${v2}'`)).ok, true)
  t('…which sends it back to pending with no expiry',
    (await as(d, 'postgres', `SELECT status, expires_at IS NULL noexp FROM public.vehicles WHERE id = '${v2}'`)).rows[0], { status: 'pending', noexp: true })
  t('…and anon no longer sees it', await countVisible(d, 'anon'), 0)
  t('the owner cannot set a rejection reason', (await as(d, 'owner', `UPDATE public.vehicles SET rejection_reason = 'x' WHERE id = '${v2}'`)).msg, 'VEHICLE_FIELD_LOCKED')
  t('the owner cannot set hidden_at', (await as(d, 'owner', `UPDATE public.vehicles SET hidden_at = now() WHERE id = '${v2}'`)).ok, false)
  t('the owner cannot mark their listing expired', (await as(d, 'owner', `UPDATE public.vehicles SET status = 'expired' WHERE id = '${v2}'`)).msg, 'VEHICLE_STATUS')
  t('editing in a blocked term is refused', (await as(d, 'owner', `UPDATE public.vehicles SET description = 'badword' WHERE id = '${v2}'`)).msg, 'BLOCKED_TERM')
  await as(d, 'admin', `UPDATE public.vehicles SET status = 'active' WHERE id = '${v2}'`)
  t('re-approved, anon sees it again', await countVisible(d, 'anon'), 1)

  // ── Remove ───────────────────────────────────────────────────────────────
  t('the owner removes a listing', (await as(d, 'owner', `UPDATE public.vehicles SET status = 'removed' WHERE id = '${v3}'`)).ok, true)
  t('a removed listing is frozen', (await as(d, 'owner', `UPDATE public.vehicles SET price = 1 WHERE id = '${v3}'`)).msg, 'VEHICLE_REMOVED')
  t('nobody can DELETE a listing', (await as(d, 'owner', `DELETE FROM public.vehicles WHERE id = '${v3}'`)).ok, false)
  const p4 = await as(d, 'owner', LISTING({ model: 'C-HR' }))
  t('removing freed a slot under the cap', p4.ok, true)
  const v4 = p4.rows[0]?.id

  // ── Expiry + renew ───────────────────────────────────────────────────────
  await as(d, 'postgres', `UPDATE public.vehicles SET expires_at = now() - interval '1 minute' WHERE id = '${v2}'`)
  t('past expires_at, anon stops seeing it before any job runs', await countVisible(d, 'anon'), 0)
  t('a client cannot run the expiry job', (await as(d, 'owner', 'SELECT public.expire_vehicles()')).ok, false)
  t('the job expires exactly that one listing', (await as(d, 'postgres', 'SELECT public.expire_vehicles() r')).rows[0].r, { expired: 1 })
  t('the owner holds 2 open listings (one active, one pending)', n(await as(d, 'owner', `SELECT count(*) n FROM public.my_vehicles() WHERE status IN ('pending','active')`)), 2)
  t('anon cannot renew', (await as(d, 'anon', `SELECT public.renew_vehicle('${v2}')`)).ok, false)
  t('a guest cannot renew', (await as(d, 'owner', `SELECT public.renew_vehicle('${v2}')`, { guest: true })).msg, 'NOT_SIGNED_IN')
  t('another user cannot renew it', (await as(d, 'owner2', `SELECT public.renew_vehicle('${v2}')`)).msg, 'VEHICLE_NOT_FOUND')
  t('a pending listing cannot be renewed', (await as(d, 'owner', `SELECT public.renew_vehicle('${v4}')`)).msg, 'VEHICLE_STATUS')
  const p5 = await as(d, 'owner', LISTING({ model: 'RAV4' }))
  t('with 3 open again, renewing the expired one is refused', (await as(d, 'owner', `SELECT public.renew_vehicle('${v2}')`)).msg, 'VEHICLE_LIMIT')
  await as(d, 'owner', `UPDATE public.vehicles SET status = 'removed' WHERE id = '${p5.rows[0]?.id}'`)
  t('the owner renews the expired listing', (await as(d, 'owner', `SELECT public.renew_vehicle('${v2}') IS NOT NULL ok`)).rows[0]?.ok, true)
  t('…anon sees it again for 30 days', await countVisible(d, 'anon'), 1)

  // ── Dealers, import sources, Preview ─────────────────────────────────────
  await as(d, 'postgres', `
    INSERT INTO public.dealers (id, slug, name) VALUES ('11111111-1111-4111-8111-111111111111', 'test-oto', 'Test Oto');
    INSERT INTO public.vehicles (id, intent, source, dealer_id, owner_id, make, model, year, km, fuel, gearbox, body_type, colour, steering, price, currency, region, status, published_at)
      VALUES ('22222222-2222-4222-8222-222222222222', 'sale', 'dealer', '11111111-1111-4111-8111-111111111111', NULL, 'BMW', '320i', 2020, 30000, 'petrol', 'automatic', 'sedan', 'black', 'left', 25000, 'GBP', 'Lefkoşa', 'active', now());
    INSERT INTO public.vehicle_images (vehicle_id, storage_path) VALUES ('22222222-2222-4222-8222-222222222222', 'partner/dealer/test-oto/1.jpg');
    INSERT INTO public.vehicle_sources (site, name) VALUES ('example-cars.test', 'Example');
    INSERT INTO public.vehicles (id, intent, source, source_site, external_id, owner_id, make, model, year, km, fuel, gearbox, body_type, colour, steering, price_per_day, currency, region, status, published_at)
      VALUES ('33333333-3333-4333-8333-333333333333', 'rent', 'import', 'example-cars.test', 'ex-1', NULL, 'Fiat', 'Egea', 2022, 10000, 'diesel', 'manual', 'sedan', 'grey', 'left', 35, 'GBP', 'Gazimağusa', 'active', now());
    INSERT INTO public.vehicle_images (vehicle_id, storage_path) VALUES ('33333333-3333-4333-8333-333333333333', 'partner/example-cars.test/ex-1/1.jpg');`, { multi: true }).then(r => { if (!r.ok) console.log('      setup failed:', r.msg); return r })
  t('anon does not see an inactive dealer', n(await as(d, 'anon', 'SELECT count(*) n FROM public.dealers')), 0)
  t('anon does not see the inactive dealer\'s or source\'s cars', await countVisible(d, 'anon'), 1)
  t('ADA Preview sees the inactive dealer', n(await as(d, 'anon', 'SELECT count(*) n FROM public.dealers', { preview: true })), 1)
  t('ADA Preview sees both pre-launch cars (plus the public one)', await countVisible(d, 'anon', { preview: true }), 3)
  t('ADA Preview sees the inactive source', n(await as(d, 'anon', 'SELECT count(*) n FROM public.vehicle_sources', { preview: true })), 1)
  t('a source cannot go live before its terms + robots check', (await as(d, 'postgres', `UPDATE public.vehicle_sources SET is_active = true WHERE site = 'example-cars.test'`)).ok, false)
  await as(d, 'postgres', `UPDATE public.vehicle_sources SET terms_checked_at = now(), robots_checked_at = now(), is_active = true WHERE site = 'example-cars.test';
                           UPDATE public.dealers SET is_active = true`, { multi: true })
  t('with dealer and source live, anon sees all three', await countVisible(d, 'anon'), 3)
  t('a signed-in user cannot write dealers', (await as(d, 'owner', `INSERT INTO public.dealers (slug, name) VALUES ('x-y', 'X')`)).ok, false)
  t('a signed-in user cannot write sources', (await as(d, 'owner', `UPDATE public.vehicle_sources SET is_active = false`)).ok, false)
  t('an import row needs a source and external id', (await as(d, 'postgres', `INSERT INTO public.vehicles (intent, source, make, model, year, km, fuel, gearbox, body_type, colour, steering, price, currency, region)
    VALUES ('sale', 'import', 'A', 'B', 2020, 1, 'petrol', 'manual', 'sedan', 'red', 'left', 1, 'GBP', 'Girne')`)).ok, false)

  // ── Reports: hidden at 3 distinct reporters ──────────────────────────────
  const rep = who => as(d, who, `INSERT INTO public.content_reports (content_type, content_id) VALUES ('vehicle', '${v2}')`)
  t('a vehicle can be reported', (await rep('r1')).ok, true)
  await rep('r2')
  t('two reports: still visible (control)', n(await as(d, 'anon', `SELECT count(*) n FROM public.vehicles WHERE id = '${v2}'`)), 1)
  await rep('r3')
  t('three distinct reporters: hidden from anon', n(await as(d, 'anon', `SELECT count(*) n FROM public.vehicles WHERE id = '${v2}'`)), 0)
  t('…and from other users', n(await as(d, 'owner2', `SELECT count(*) n FROM public.vehicles WHERE id = '${v2}'`)), 0)
  t('…and from ADA Preview', n(await as(d, 'anon', `SELECT count(*) n FROM public.vehicles WHERE id = '${v2}'`, { preview: true })), 0)
  t('the owner still sees it', n(await as(d, 'owner', `SELECT count(*) n FROM public.vehicles WHERE id = '${v2}'`)), 1)
  t('the owner cannot un-hide it', (await as(d, 'owner', `UPDATE public.vehicles SET hidden_at = NULL, hidden_reason = NULL WHERE id = '${v2}'`)).ok, false)
  t('the admin restores it', (await as(d, 'admin', `UPDATE public.vehicles SET hidden_at = NULL, hidden_reason = NULL WHERE id = '${v2}'`)).ok, true)
  t('…visible again', n(await as(d, 'anon', `SELECT count(*) n FROM public.vehicles WHERE id = '${v2}'`)), 1)

  // ── Storage, contact taps, notify ────────────────────────────────────────
  // v4 is the owner's PENDING listing, v2 their APPROVED one.
  const obj = (who, name, opts) => as(d, who, `INSERT INTO storage.objects (bucket_id, name) VALUES ('vehicle-images', '${name}') RETURNING id`, opts)
  const f4 = `${v4}/${randomUUID()}.jpg`
  t('upload into your own pending listing', (await obj('owner', f4)).ok, true)
  t('upload into your own APPROVED listing is refused (no photo swap after review)', (await obj('owner', `${v2}/${randomUUID()}.jpg`)).ok, false)
  t('upload into someone else\'s pending listing is refused', (await obj('owner2', `${v4}/${randomUUID()}.jpg`)).ok, false)
  t('upload into a folder with no listing is refused (not an image host)', (await obj('owner', `${randomUUID()}/${randomUUID()}.jpg`)).ok, false)
  t('a non-random file name is refused', (await obj('owner', `${v4}/a.jpg`)).ok, false)
  t('upload into partner/ is refused', (await obj('owner', `partner/x/${randomUUID()}.jpg`)).ok, false)
  t('a guest cannot upload', (await obj('owner', `${v4}/${randomUUID()}.jpg`, { guest: true })).ok, false)
  t('the owner sees (and so can remove) their listing\'s file', n(await as(d, 'owner', `SELECT count(*) n FROM storage.objects WHERE bucket_id = 'vehicle-images'`)), 1)
  t('another user cannot list it', n(await as(d, 'owner2', `SELECT count(*) n FROM storage.objects WHERE bucket_id = 'vehicle-images'`)), 0)
  t('nobody can overwrite a file (no UPDATE policy)', (await as(d, 'owner', `UPDATE storage.objects SET name = name WHERE bucket_id = 'vehicle-images' RETURNING id`)).rows.length, 0)
  t('the owner deletes their pending listing\'s file', (await as(d, 'owner', `DELETE FROM storage.objects WHERE name = '${f4}' RETURNING id`)).rows.length, 1)
  const live = `${v2}/${randomUUID()}.jpg`
  await as(d, 'postgres', `INSERT INTO storage.objects (bucket_id, name) VALUES ('vehicle-images', '${live}')`)
  t('the owner cannot delete an approved listing\'s file', (await as(d, 'owner', `DELETE FROM storage.objects WHERE name = '${live}' RETURNING id`)).rows.length, 0)
  t('an admin can delete any listing file', (await as(d, 'admin', `DELETE FROM storage.objects WHERE name = '${live}' RETURNING id`)).rows.length, 1)
  t('contact_events accepts module cars', (await as(d, 'postgres', `INSERT INTO public.contact_events (module, entity_id, action) VALUES ('cars', 'x', 'call')`)).ok, true)
  t('contact_events still accepts eatery (control)', (await as(d, 'postgres', `INSERT INTO public.contact_events (module, entity_id, action) VALUES ('eatery', 'x', 'call')`)).ok, true)
  t('waitlist notification title in Turkish', (await as(d, 'postgres', `SELECT public.module_notif_text('title', 'cars', 'Turkish') x`)).rows[0].x, "ADA'da yeni: Araçlar")
  // ── S3: the admin can resolve a listing's seller (Ban, approve / reject notices); nobody else can ──
  t('admin_content_author resolves a private listing to its owner', (await as(d, 'admin', `SELECT public.admin_content_author('vehicle', '${v1}') = '${U.owner}' x`)).rows[0]?.x, true)
  t('…a non-admin is refused', (await as(d, 'owner', `SELECT public.admin_content_author('vehicle', '${v1}') x`)).msg, 'ADMIN_ONLY')
  t('…anon cannot call it', /permission denied/.test((await as(d, 'anon', `SELECT public.admin_content_author('vehicle', '${v1}') x`)).msg), true)
  t('…the other branches still answer (profile)', (await as(d, 'admin', `SELECT public.admin_content_author('profile', '${U.owner}') = '${U.owner}' x`)).rows[0]?.x, true)
  t('owner account deletion removes their listings', (await as(d, 'postgres', `DELETE FROM auth.users WHERE id = '${U.owner2}'`)).ok, true)
  t('…none left', n(await as(d, 'postgres', `SELECT count(*) n FROM public.vehicles WHERE owner_id = '${U.owner2}'`)), 0)
}

console.log('Araçlar S1 + S3 — real files, in release order')
{
  const { d, r } = await ready()
  t('the five files apply, including their own assertions', r, { ok: true, msg: null })
  if (r.ok) await behaviour(d)
}
// ── verify_schema tokens: the release's own H tokens must read TRUE on the migrated fixture and not on a fresh one.
// The apply job fails unless QUERY 1 is green, so a token that cannot go green is a failed release.
{
  const vs = readFileSync(fileURLToPath(new URL('../supabase/verify_schema.sql', import.meta.url)), 'utf8')
  const tokens = []
  const re = /UNION ALL SELECT '(2026116[4-7]_[a-z_]+|20261181_[a-z_]+|1029_student_messaging|1026_student_education)','([^']*(?:''[^']*)*)',\n/g
  let m
  while ((m = re.exec(vs))) {
    if (m[1].startsWith('10') && !/is_adult_on|vehicle/.test(m[2])) continue
    const start = re.lastIndex
    const rest = vs.slice(start)
    const end = rest.search(/\n\s*(?:--[^\n]*\n\s*)*(?:UNION ALL SELECT|\) z\b)/)
    tokens.push({ label: `${m[1]}: ${m[2].replace(/''/g, "'").slice(0, 90)}`, expr: rest.slice(0, end) })
  }
  console.log(`\nverify_schema tokens of this release (${tokens.length})`)
  const { d } = await ready()
  const fresh = await freshDb(FIXTURE())
  for (const tk of tokens) {
    const after = await as(d, 'postgres', `SELECT (${tk.expr}) AS ok`)
    const before = await as(fresh, 'postgres', `SELECT (${tk.expr}) AS ok`)
    t(`green after the release — ${tk.label}`, after.ok ? after.rows[0].ok : after.msg, true)
    t(`  …and not before it`, before.ok ? before.rows[0].ok === true : false, false)
  }
  t('found the release tokens (positive control on the parser)', tokens.length >= 8, true)
}

const realBad = bad

// ── Mutants ────────────────────────────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), 'vehicles-'))
function mutantFile(idx, name, from, to) {
  const src = readFileSync(RELEASE[idx], 'utf8')
  if (!src.includes(from)) throw new Error(`mutant "${name}": anchor not found`)
  const p = join(dir, RELEASE[idx].split('/').pop())
  writeFileSync(p, src.replace(from, () => to))
  return RELEASE.map((f, i) => i === idx ? p : f)
}
console.log('\nmutants that the files must refuse at apply')
const refused = async (name, files, fixture) => {
  const { r } = await ready(files, fixture)
  t(`${name} → refused`, r.ok, false)
  if (!r.ok) console.log(`      [${r.file}] ${r.msg}`)
}
await refused('public read drops the expiry condition', mutantFile(1, 'exp', "    AND (expires_at IS NULL OR expires_at > now())\n    AND (dealer_id IS NULL", "    AND (dealer_id IS NULL"))
await refused('photoless policy made permissive', mutantFile(1, 'perm', 'CREATE POLICY vehicles_hide_photoless ON public.vehicles\n  AS RESTRICTIVE FOR SELECT', 'CREATE POLICY vehicles_hide_photoless ON public.vehicles\n  FOR SELECT'))
await refused('preview policy without NOT is_active', mutantFile(1, 'prev', 'FOR SELECT TO anon, authenticated USING (NOT is_active AND (SELECT public.is_previewer()));\nDROP POLICY IF EXISTS dealers_select_admin', 'FOR SELECT TO anon, authenticated USING ((SELECT public.is_previewer()));\nDROP POLICY IF EXISTS dealers_select_admin'))
await refused('status added to the INSERT grant', mutantFile(1, 'grant', 'region, area, description, contact_phone, whatsapp) ON public.vehicles TO authenticated;', 'region, area, description, contact_phone, whatsapp, status) ON public.vehicles TO authenticated;'))
await refused('listing guard made SECURITY DEFINER', mutantFile(1, 'def', 'RETURNS trigger\nLANGUAGE plpgsql\nSET search_path = public\nAS $function$\nDECLARE\n  v_uid     uuid := auth.uid();\n  v_refusal text;\n  v_edited', 'RETURNS trigger\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path = public\nAS $function$\nDECLARE\n  v_uid     uuid := auth.uid();\n  v_refusal text;\n  v_edited'))
await refused('storage upload policy loses the guest guard', mutantFile(1, 'stg', "    AND private.my_vehicle_status((storage.foldername(name))[1]) = 'pending'\n    AND NOT (select public.is_anonymous_session())\n  );\nDROP POLICY IF EXISTS \"vehicle_images_select\"", "    AND private.my_vehicle_status((storage.foldername(name))[1]) = 'pending'\n  );\nDROP POLICY IF EXISTS \"vehicle_images_select\""))
await refused('storage upload no longer tied to a PENDING listing (photo swap)', mutantFile(1, 'swap', "    AND private.my_vehicle_status((storage.foldername(name))[1]) = 'pending'\n    AND NOT (select public.is_anonymous_session())\n  );\nDROP POLICY IF EXISTS \"vehicle_images_select\"", "    AND private.my_vehicle_status((storage.foldername(name))[1]) IS NOT NULL\n    AND NOT (select public.is_anonymous_session())\n  );\nDROP POLICY IF EXISTS \"vehicle_images_select\""))
await refused('owner_id readable again', mutantFile(1, 'oid', 'GRANT SELECT (id, intent, source,', 'GRANT SELECT (owner_id, id, intent, source,'))
await refused('an overwrite (UPDATE) storage policy added', mutantFile(1, 'upd', 'DROP POLICY IF EXISTS "vehicle_images_select" ON storage.objects;', 'CREATE POLICY "vehicle_images_update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = \'vehicle-images\' AND NOT (select public.is_anonymous_session()) AND private.my_vehicle_status((storage.foldername(name))[1]) IS NOT NULL);\nDROP POLICY IF EXISTS "vehicle_images_select" ON storage.objects;'))
await refused('dealers get a client write policy', mutantFile(1, 'dw', 'DROP POLICY IF EXISTS dealers_select_admin ON public.dealers;', 'CREATE POLICY dealers_write ON public.dealers FOR INSERT TO authenticated WITH CHECK (true);\nDROP POLICY IF EXISTS dealers_select_admin ON public.dealers;'))
await refused('live contact_events list differs (eatery missing in production)', RELEASE, FIXTURE({ contactMods: MODS16.filter(m => m !== 'eatery') }))
await refused('auto-hide gains more than the vehicle branch', mutantFile(2, 'ah', "    UPDATE vehicles   SET hidden_at = now(), hidden_reason = 'auto_reports' WHERE id = NEW.content_id AND hidden_at IS NULL;\n  END IF;", "    UPDATE vehicles   SET hidden_at = now(), hidden_reason = 'auto_reports' WHERE id = NEW.content_id AND hidden_at IS NULL;\n  ELSIF NEW.content_type = 'profile' THEN\n    NULL;\n  END IF;"))
await refused('admin_content_author gains more than the vehicle branch', mutantFile(4, 'aca', "    ELSE RAISE EXCEPTION 'UNSUPPORTED_CONTENT_TYPE: %', p_content_type;", "    WHEN 'dealer'   THEN v_author := NULL;\n    ELSE RAISE EXCEPTION 'UNSUPPORTED_CONTENT_TYPE: %', p_content_type;"))
await refused('admin_content_author loses its admin gate', mutantFile(4, 'acg', "  IF NOT is_admin() THEN\n    RAISE EXCEPTION 'ADMIN_ONLY';\n  END IF;\n", ''))
await refused('report hide policy made permissive', mutantFile(2, 'hr', 'CREATE POLICY vehicles_hide_reported ON public.vehicles\n  AS RESTRICTIVE FOR SELECT', 'CREATE POLICY vehicles_hide_reported ON public.vehicles\n  FOR SELECT'))
await refused('notify allow-list loses duyurular while adding cars', mutantFile(3, 'nt', "'checkins','duyurular','cars') THEN", "'checkins','cars') THEN"))

console.log('\nbehaviour mutants: the files apply, and the named checks must go red')
const caught = async (name, files, mustFail) => {
  const before = bad, beforeList = failures.length
  const { d, r } = await ready(files)
  if (!r.ok) { t(`${name}: applies`, r.msg, null); return }
  const out = console.log
  console.log = () => {}
  await behaviour(d)
  console.log = out
  const red = failures.slice(beforeList)
  bad = before
  failures.length = beforeList
  const hit = mustFail.filter(m => red.includes(m))
  t(`${name} → caught by: ${mustFail.join(' | ')}`, hit.length === mustFail.length, true)
}
await caught('cap raised to 4', mutantFile(1, 'cap', 'IF private.my_open_vehicle_count() >= 3 THEN\n      RAISE EXCEPTION \'VEHICLE_LIMIT\' USING ERRCODE = \'P0001\';\n    END IF;\n  END IF;\n\n  IF v_edited', 'IF private.my_open_vehicle_count() >= 4 THEN\n      RAISE EXCEPTION \'VEHICLE_LIMIT\' USING ERRCODE = \'P0001\';\n    END IF;\n  END IF;\n\n  IF v_edited'),
  ['the 4th open listing is refused with VEHICLE_LIMIT'])
await caught('age rule skipped', mutantFile(1, 'age', "    WHEN NOT private.is_adult_on(p.date_of_birth, (now() AT TIME ZONE 'Europe/Istanbul')::date) THEN 'UNDER_18'\n", ''),
  ['an under-18 is refused with UNDER_18'])
await caught('edits no longer go back to review', mutantFile(1, 'rev', "    IF v_edited AND OLD.status IN ('active', 'expired', 'rejected') THEN\n      NEW.status := 'pending';\n    END IF;\n", ''),
  ['…which sends it back to pending with no expiry', '…and anon no longer sees it'])

console.log(realBad || bad ? `\n${Math.max(realBad, bad)} FAILED` : '\nall passed')
process.exit(realBad || bad ? 1 : 0)
