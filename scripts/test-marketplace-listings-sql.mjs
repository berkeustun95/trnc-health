// 20261168 (Dükkân listings, photos, private bucket, reports, notice) against the live messaging fixture plus
// Araçlar S1's prerequisites (scripts/fixtures/*.sql). PGlite = PostgreSQL 18; prod is 17.6.
//   node scripts/test-marketplace-listings-sql.mjs
// What a pass is evidence of: the RLS / grant / trigger outcomes seeded here. Not the Storage API, not signed
// URLs, not PostgREST (no RETURNING-through-SELECT-policy effects).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { freshDb, applyFile } from './migration-harness.mjs'

const rel = p => fileURLToPath(new URL(p, import.meta.url))
const BASE = readFileSync(rel('./fixtures/messaging-live.sql'), 'utf8') + readFileSync(rel('./fixtures/marketplace-prereqs.sql'), 'utf8')
const FILE = rel('../supabase/migrations/20261168_marketplace_listings.sql')

const U = {
  A: 'a0000000-0000-4000-8000-00000000000a', B: 'b0000000-0000-4000-8000-00000000000b',
  C: 'c0000000-0000-4000-8000-00000000000c', M: '10000000-0000-4000-8000-000000000001',
  N: '40000000-0000-4000-8000-000000000004', X: '50000000-0000-4000-8000-000000000005',
  Q: '60000000-0000-4000-8000-000000000006', G: '20000000-0000-4000-8000-000000000002',
}
const SEED = `
INSERT INTO auth.users VALUES ${Object.values(U).map(u => `('${u}')`).join(',')};
INSERT INTO profiles (id, display_name, date_of_birth, role) VALUES
  ('${U.A}', 'Ayla', '1990-01-01', 'customer'), ('${U.B}', 'Burak', '1991-02-02', 'customer'),
  ('${U.C}', 'Cem', '1992-03-03', 'customer'), ('${U.M}', 'Mert', (current_date - interval '16 years')::date, 'customer'),
  ('${U.N}', 'Nur', NULL, 'customer'), ('${U.X}', 'Admin', '1985-01-01', 'admin'),
  ('${U.Q}', NULL, '1990-05-05', 'customer'), ('${U.G}', NULL, NULL, NULL);
`
async function as(db, who, sql) {
  const claims = who === 'G' ? { sub: U.G, is_anonymous: true } : who === null ? null : { sub: U[who] }
  try {
    await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [claims ? JSON.stringify(claims) : ''])
    await db.exec(who === null ? 'SET role anon;' : 'SET role authenticated;')
    const r = await db.query(sql)
    return { ok: true, rows: r.rows, value: r.rows[0] ? Object.values(r.rows[0])[0] : null }
  } catch (e) { return { ok: false, err: e.message } } finally { await db.exec('RESET role;') }
}
const errIs = (r, code) => !r.ok && r.err.includes(code)
const ITEM = (title = 'Bisiklet satılık', extra = '') =>
  `INSERT INTO marketplace_listings (title, description, price_tl, is_free, category, condition, district)
   VALUES ('${title}', 'Az kullanılmış, temiz bisiklet.', 1500, false, 'sports', 'like_new', 'kyrenia') ${extra}`
async function listing(db, who = 'A', title) {
  const r = await as(db, who, ITEM(title) + ' RETURNING id')
  if (!r.ok) throw new Error(r.err)
  return r.value
}
const visible = async (db, who, id) => (await as(db, who, `SELECT count(*)::int FROM marketplace_listings WHERE id = '${id}'`)).value === 1
const photoPath = (owner, lid, n = 1) => `pending/${U[owner]}/${lid}/${n}.jpg`
const addPhoto = (db, who, lid, pos, owner = who) =>
  as(db, who, `INSERT INTO marketplace_photos (listing_id, position, storage_path) VALUES ('${lid}', ${pos}, '${photoPath(owner, lid, pos)}') RETURNING id`)

async function build(extra = '') {
  const db = await freshDb(BASE + SEED + extra)
  const r = await applyFile(db, FILE)
  if (!r.ok) throw new Error('apply failed: ' + r.msg)
  return db
}

let failed = 0
const check = (name, ok, got) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  got: ' + JSON.stringify(got)}`) }

const CASES = [
  // ── posting rules ──
  ['adult posts; server-owned columns are forced', async db => {
    const r = await as(db, 'A', ITEM('Bisiklet satılık', '') + ` RETURNING status, owner_id, expires_at > now() + interval '29 days' AS exp, hidden_at`)
    return r.ok && r.rows[0].status === 'active' && r.rows[0].owner_id === U.A && r.rows[0].exp && r.rows[0].hidden_at === null
  }],
  ['16-year-old cannot post', async db => !(await as(db, 'M', ITEM())).ok],
  ['unknown date of birth cannot post', async db => !(await as(db, 'N', ITEM())).ok],
  ['guest cannot post', async db => !(await as(db, 'G', ITEM())).ok],
  ['no session (anon role) cannot post or read', async db => !(await as(db, null, ITEM())).ok && !(await as(db, null, 'SELECT 1 FROM marketplace_listings')).ok],
  ['adult without a display name → NO_DISPLAY_NAME', async db => errIs(await as(db, 'Q', ITEM()), 'NO_DISPLAY_NAME')],
  ['blocked term in the title → BLOCKED_TERM', async db => errIs(await as(db, 'A', ITEM('Satılık yasakkelime')), 'BLOCKED_TERM')],
  ['client cannot pick owner_id or status on insert (column grants)', async db =>
    !(await as(db, 'A', `INSERT INTO marketplace_listings (owner_id, title, description, is_free, category, condition, district)
      VALUES ('${U.B}', 'Masa sandalye', 'Ahşap masa, dört sandalye.', true, 'home', 'used', 'nicosia')`)).ok],
  ['11th listing in 24 h → LISTING_RATE_LIMIT', async db => {
    for (let i = 0; i < 10; i++) await listing(db, 'A', `Eşya numara ${i}`)
    return errIs(await as(db, 'A', ITEM('Eşya numara 11')), 'LISTING_RATE_LIMIT')
  }],
  ['51st live listing → ACTIVE_LISTING_LIMIT', async db => {
    await db.exec(`ALTER TABLE marketplace_listings DISABLE TRIGGER mkt_10_insert_guard;
      INSERT INTO marketplace_listings (owner_id, title, description, is_free, category, condition, district, created_at)
      SELECT '${U.A}', 'Eski eşya ' || g, 'Eski ama çalışıyor.', true, 'other', 'used', 'iskele', now() - interval '2 days'
      FROM generate_series(1, 50) g;
      ALTER TABLE marketplace_listings ENABLE TRIGGER mkt_10_insert_guard;`)
    return errIs(await as(db, 'A', ITEM()), 'ACTIVE_LISTING_LIMIT')
  }],
  ['free listing drops a price; price without is_free is required', async db => {
    const r = await as(db, 'A', `INSERT INTO marketplace_listings (title, description, price_tl, is_free, category, condition, district)
      VALUES ('Kitaplar bedava', 'Ders kitapları, ücretsiz.', 50, true, 'books', 'used', 'famagusta') RETURNING price_tl`)
    const r2 = await as(db, 'A', `INSERT INTO marketplace_listings (title, description, is_free, category, condition, district)
      VALUES ('Fiyatsız eşya', 'Fiyatı yazılmamış eşya.', false, 'other', 'used', 'famagusta')`)
    return r.ok && r.rows[0].price_tl === null && !r2.ok
  }],
  ['vehicles / real estate are not categories; Karpaz is not a district', async db =>
    !(await as(db, 'A', ITEM().replace("'sports'", "'vehicles'"))).ok && !(await as(db, 'A', ITEM().replace("'kyrenia'", "'karpaz'"))).ok],
  // ── editing ──
  ['owner edits title, marks sold (sold_at stamped), un-marks (sold_at cleared)', async db => {
    const id = await listing(db)
    await as(db, 'A', `UPDATE marketplace_listings SET title = 'Bisiklet, fiyat düştü' WHERE id = '${id}'`)
    await as(db, 'A', `UPDATE marketplace_listings SET status = 'sold' WHERE id = '${id}'`)
    const s1 = (await db.query(`SELECT title, sold_at IS NOT NULL s FROM marketplace_listings WHERE id = '${id}'`)).rows[0]
    await as(db, 'A', `UPDATE marketplace_listings SET status = 'active' WHERE id = '${id}'`)
    const s2 = (await db.query(`SELECT sold_at FROM marketplace_listings WHERE id = '${id}'`)).rows[0]
    return s1.title === 'Bisiklet, fiyat düştü' && s1.s && s2.sold_at === null
  }],
  ['owner cannot touch hidden_at / expires_at / deleted_at / boosted_until', async db => {
    const id = await listing(db)
    const tries = ['hidden_at = NULL', "expires_at = now() + interval '1 year'", 'deleted_at = now()', 'boosted_until = now()']
    for (const t of tries) if ((await as(db, 'A', `UPDATE marketplace_listings SET ${t} WHERE id = '${id}'`)).ok) return false
    return true
  }],
  ['another user cannot edit the listing (0 rows)', async db => {
    const id = await listing(db)
    await as(db, 'B', `UPDATE marketplace_listings SET title = 'Benim artık' WHERE id = '${id}'`)
    return (await db.query(`SELECT title FROM marketplace_listings WHERE id = '${id}'`)).rows[0].title === 'Bisiklet satılık'
  }],
  ['edit into a blocked term → BLOCKED_TERM', async db => {
    const id = await listing(db)
    return errIs(await as(db, 'A', `UPDATE marketplace_listings SET description = 'çok yasakkelime ürün' WHERE id = '${id}'`), 'BLOCKED_TERM')
  }],
  // ── visibility ──
  ['guest and other users browse an active listing', async db => { const id = await listing(db); return (await visible(db, 'G', id)) && (await visible(db, 'B', id)) }],
  ['sold listing stays readable (chat shows "Satıldı")', async db => {
    const id = await listing(db); await as(db, 'A', `UPDATE marketplace_listings SET status = 'sold' WHERE id = '${id}'`)
    return visible(db, 'B', id)
  }],
  ['soft delete via RPC: nobody but an admin sees it; a stranger cannot delete it', async db => {
    const id = await listing(db)
    const r0 = await as(db, 'B', `SELECT delete_marketplace_listing('${id}')`)
    await as(db, 'A', `SELECT delete_marketplace_listing('${id}')`)
    return errIs(r0, 'NO_SUCH_LISTING') && !(await visible(db, 'B', id)) && !(await visible(db, 'A', id)) && (await visible(db, 'X', id))
  }],
  ['block either way hides the listing both ways', async db => {
    const a = await listing(db, 'A'); const b = await listing(db, 'B', 'Masa lambası')
    await as(db, 'B', `SELECT block_user('${U.A}')`)
    return !(await visible(db, 'B', a)) && !(await visible(db, 'A', b)) && (await visible(db, 'C', a))
  }],
  ['expired: hidden from others, still the owner\'s', async db => {
    const id = await listing(db)
    await db.exec(`SELECT set_config('app.trusted_marketplace', 'on', false); UPDATE marketplace_listings SET expires_at = now() - interval '1 minute' WHERE id = '${id}'; SELECT set_config('app.trusted_marketplace', 'off', false);`)
    return !(await visible(db, 'B', id)) && (await visible(db, 'A', id))
  }],
  // ── reports ──
  ['ONE report hides it at once; owner and admin still see it', async db => {
    const id = await listing(db)
    const r = await as(db, 'B', `INSERT INTO content_reports (reporter_id, content_type, content_id, reason) VALUES ('${U.B}', 'listing', '${id}', 'prohibited_item')`)
    return r.ok && !(await visible(db, 'B', id)) && !(await visible(db, 'C', id)) && (await visible(db, 'A', id)) && (await visible(db, 'X', id))
  }],
  ['owner edit of a hidden listing does NOT un-hide it', async db => {
    const id = await listing(db)
    await as(db, 'B', `INSERT INTO content_reports (reporter_id, content_type, content_id, reason) VALUES ('${U.B}', 'listing', '${id}', 'spam')`)
    await as(db, 'A', `UPDATE marketplace_listings SET title = 'Tamamen temiz ilan' WHERE id = '${id}'`)
    return (await db.query(`SELECT hidden_at IS NOT NULL h FROM marketplace_listings WHERE id = '${id}'`)).rows[0].h
  }],
  ['admin restores; a non-admin gets ADMIN_ONLY', async db => {
    const id = await listing(db)
    await as(db, 'B', `INSERT INTO content_reports (reporter_id, content_type, content_id, reason) VALUES ('${U.B}', 'listing', '${id}', 'spam')`)
    const r0 = await as(db, 'A', `SELECT admin_set_listing_hidden('${id}', false)`)
    await as(db, 'X', `SELECT admin_set_listing_hidden('${id}', false)`)
    return errIs(r0, 'ADMIN_ONLY') && (await visible(db, 'C', id))
  }],
  ['other report types still need 3 reporters (vehicle/place path intact)', async db => {
    const src = (await db.query(`SELECT prosrc FROM pg_proc WHERE proname = 'auto_hide_reported_content'`)).rows[0].prosrc
    return src.includes('IF v_count < 3 THEN RETURN NEW;') && src.includes("NEW.content_type = 'vehicle'")
  }],
  // ── renew ──
  ['renew: too early refused; in the last 3 days renews to +30 d', async db => {
    const id = await listing(db)
    const r0 = await as(db, 'A', `SELECT renew_marketplace_listing('${id}')`)
    await db.exec(`SELECT set_config('app.trusted_marketplace', 'on', false); UPDATE marketplace_listings SET expires_at = now() + interval '2 days' WHERE id = '${id}'; SELECT set_config('app.trusted_marketplace', 'off', false);`)
    const r1 = await as(db, 'A', `SELECT renew_marketplace_listing('${id}') > now() + interval '29 days'`)
    const r2 = await as(db, 'B', `SELECT renew_marketplace_listing('${id}')`)
    return errIs(r0, 'TOO_EARLY_TO_RENEW') && r1.value === true && errIs(r2, 'NO_SUCH_LISTING')
  }],
  // ── photos ──
  ['photo row: pending forced; seller and admin see it, others do not', async db => {
    const id = await listing(db); const p = await addPhoto(db, 'A', id, 0)
    const st = (await db.query(`SELECT status FROM marketplace_photos`)).rows[0]?.status
    const see = async w => (await as(db, w, `SELECT count(*)::int FROM marketplace_photos`)).value
    return p.ok && st === 'pending' && (await see('A')) === 1 && (await see('X')) === 1 && (await see('B')) === 0 && (await see('G')) === 0
  }],
  ['client cannot insert an approved photo (column grant)', async db => {
    const id = await listing(db)
    return !(await as(db, 'A', `INSERT INTO marketplace_photos (listing_id, position, storage_path, status) VALUES ('${id}', 0, '${photoPath('A', id)}', 'approved')`)).ok
  }],
  ['photo path must be pending/<own uid>/<listing>/ ; not on someone else\'s listing', async db => {
    const id = await listing(db); const other = await listing(db, 'B', 'Masa lambası')
    return errIs(await addPhoto(db, 'A', id, 0, 'B'), 'BAD_PHOTO_PATH') && errIs(await addPhoto(db, 'A', other, 0), 'NO_SUCH_LISTING')
  }],
  ['9th live photo → PHOTO_LIMIT', async db => {
    const id = await listing(db); for (let i = 0; i < 8; i++) await addPhoto(db, 'A', id, i)
    return errIs(await as(db, 'A', `INSERT INTO marketplace_photos (listing_id, position, storage_path) VALUES ('${id}', 7, 'pending/${U.A}/${id}/x9.jpg')`), 'PHOTO_LIMIT')
  }],
  ['approved photo: visible to others while the listing is; hidden with it', async db => {
    const id = await listing(db); await addPhoto(db, 'A', id, 0)
    await db.exec(`UPDATE marketplace_photos SET status = 'approved'`)
    const before = (await as(db, 'B', `SELECT count(*)::int FROM marketplace_photos`)).value
    await as(db, 'C', `INSERT INTO content_reports (reporter_id, content_type, content_id, reason) VALUES ('${U.C}', 'listing', '${id}', 'spam')`)
    const after = (await as(db, 'B', `SELECT count(*)::int FROM marketplace_photos`)).value
    return before === 1 && after === 0
  }],
  // ── storage ──
  ['bucket is private', async db => (await db.query(`SELECT public FROM storage.buckets WHERE id = 'marketplace-photos'`)).rows[0].public === false],
  ['upload: own pending folder only, adults only, never a guest', async db => {
    const up = (w, owner) => as(db, w, `INSERT INTO storage.objects (bucket_id, name) VALUES ('marketplace-photos', 'pending/${U[owner]}/l/1.jpg')`)
    return (await up('A', 'A')).ok && !(await up('A', 'B')).ok && !(await up('M', 'M')).ok && !(await up('G', 'G')).ok
  }],
  ['object read follows the photo row (pending: seller only; approved + visible: everyone)', async db => {
    const id = await listing(db); await addPhoto(db, 'A', id, 0)
    await db.exec(`INSERT INTO storage.objects (bucket_id, name) VALUES ('marketplace-photos', '${photoPath('A', id, 0)}')`)
    const see = async w => (await as(db, w, `SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'marketplace-photos'`)).value
    const pend = [await see('A'), await see('B')]
    await db.exec(`UPDATE marketplace_photos SET status = 'approved'`)
    return pend[0] === 1 && pend[1] === 0 && (await see('B')) === 1
  }],
  // ── safety notice ──
  ['notice: RPC stamps it; a direct write is refused; a guest gets AUTH_REQUIRED', async db => {
    const r = await as(db, 'B', `SELECT accept_marketplace_notice('2026-11-07')`)
    const at = (await db.query(`SELECT marketplace_notice_version v FROM profiles WHERE id = '${U.B}'`)).rows[0].v
    await db.exec(`GRANT UPDATE (marketplace_notice_at) ON profiles TO authenticated;`)
    const direct = await as(db, 'C', `UPDATE profiles SET marketplace_notice_at = now() WHERE id = '${U.C}'`)
    return r.ok && at === '2026-11-07' && errIs(direct, 'MARKETPLACE_NOTICE_SERVER_ONLY') && errIs(await as(db, 'G', `SELECT accept_marketplace_notice('2026-11-07')`), 'AUTH_REQUIRED')
  }],
  ['seller name: only for listings the caller can see', async db => {
    const id = await listing(db)
    const name = async w => (await as(db, w, `SELECT display_name FROM marketplace_seller_names(ARRAY['${id}']::uuid[])`)).value
    const before = [await name('B'), await name('G')]
    await as(db, 'B', `INSERT INTO content_reports (reporter_id, content_type, content_id, reason) VALUES ('${U.B}', 'listing', '${id}', 'spam')`)
    return before[0] === 'Ayla' && before[1] === 'Ayla' && (await name('C')) === null && (await name('A')) === 'Ayla'
      && !(await as(db, null, `SELECT * FROM marketplace_seller_names(ARRAY['${id}']::uuid[])`)).ok
  }],
  // ── no age oracle ──
  ['i_am_adult answers only for the caller', async db =>
    (await as(db, 'A', 'SELECT i_am_adult()')).value === true && (await as(db, 'M', 'SELECT i_am_adult()')).value === false
    && (await as(db, 'G', 'SELECT i_am_adult()')).value === false],
]

for (const [name, fn] of CASES) {
  let ok, got
  try { ok = await fn(await build()) } catch (e) { ok = false; got = e.message }
  check(name, ok === true, got)
}

// Migration-level: re-run is clean; the pre-flight refuses without Araçlar S1.
{
  const db = await build()
  const again = await applyFile(db, FILE)
  check('second apply is a clean re-run', again.ok, again.msg)
}
{
  const db = await freshDb(BASE + SEED + `DROP FUNCTION private.is_adult_on(date, date);`)
  const r = await applyFile(db, FILE)
  check('red: no private.is_adult_on → refused', !r.ok && /is_adult_on\(date,date\) is missing/.test(r.msg), r.msg)
}
{
  const live = readFileSync(rel('./fixtures/messaging-live.sql'), 'utf8')
  const db = await freshDb(BASE + SEED + `CREATE OR REPLACE FUNCTION public.auto_hide_reported_content() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $f$BEGIN RETURN NEW; END$f$;`)
  const r = await applyFile(db, FILE)
  check('red: auto-hide body not Araçlar\'s → refused', !r.ok && /REFUSING: live auto_hide_reported_content/.test(r.msg), r.msg)
  void live
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
