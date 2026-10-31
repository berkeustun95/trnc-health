#!/usr/bin/env node
// ─── Eatery images — upload a partner's logo/gallery/menu/dish photos ─────────────
//
//   node scripts/eatery-images.mjs --slug=crunchy-express                   # DRY (default): validate + print the plan
//   node scripts/eatery-images.mjs --slug=crunchy-express --apply [--replace]
//   options: --report=path.json  (plan + sanitised codes only: the artifact is PUBLIC-downloadable on this repo; no raw error text)
//
// CI-only for anything that writes (scripts/lib/prod-write-guard.mjs). Workflow: eatery-images, whose apply
// path waits for Berke's approval in the `production-db` environment.
// ⚠ A manifest with a "banner" entry needs migration 20261151 (eatery_partners.banner_path) APPLIED: the partner
//   select reads banner_path, so every run (dry included) fails on a database without the column. Even a dry run needs the service key
// (inactive rows are invisible to anon), so it too runs in CI.
//
// FILE LAYOUT (committed to main; the bucket is public, so a file is world-readable once uploaded)
//   data/eatery/<slug>/manifest.json   { "logo": "logo.png", "banner": "banner.jpg", "gallery": ["a.jpg", "b.jpg"], "menu": ["m1.jpg"],
//                                         "dishes": { "Chicken Burger": "burger.jpg", "Sides › Fries": "fries.jpg" } }
//   "banner" (optional, one file) is the full-width partner-page header: width >= 1000 px (lib: MIN) and wider than tall.
//   A smaller original needs "bannerSizeWaiver": { "minWidth": 600..999, "reason": ">= 20 chars", "approvedBy": "...", "date": "YYYY-MM-DD" }
//   (printed as "!! SIZE WAIVER APPLIED"; refused if malformed, if there is no banner, or if the banner meets the floor anyway).
//   data/eatery/<slug>/<files>         plain names, display order = array order; logo optional; arrays optional
//   DISH KEYS: an eatery_menu_items.name, matched EXACTLY (trimmed) for this partner. A name that occurs in more than
//   one section is accepted only as "Section › Name" (U+203A). Refused: a key matching no item, matching several
//   items, two keys for one item, one file used twice (also across logo/gallery/menu), unknown manifest keys.
//   Dishes need the partner's menu items to exist (the menu data migration first). Problems and the report name the
//   FILE and the item id, never the item name (Actions logs and artifacts are public).
//
// OBJECT PATHS (bucket eatery-images)   <slug>/logo.<ext>   <slug>/banner.<ext>   <slug>/gallery-<n>.<ext>   <slug>/menu-<n>.<ext>
//   <slug>/dish-<eatery_menu_items.id>.<ext>   (dish photo; the row gets photo_path/photo_width/photo_height)
//   n is the 1-based manifest position and also eatery_photos.sort_order. <ext> comes from the real bytes
//   (a .jpeg file is stored as .jpg).
//
// VALIDATION (the whole run refuses, listing EVERY problem): slug ^[a-z0-9-]+$; manifest files exist; <= 2 MB;
//   magic bytes JPEG/PNG/WebP match the extension; width/height read from the header; minimums (lib: MIN);
//   path matches the database CHECK. Dish minimum: 800 px on the SHORT side (lib: MIN, with the reasoning).
// READINESS: the partner row must exist with lat/lng, address, menu_verified_on and (>= 1 menu item OR menu_url),
//   i.e. go-live checklist step 1 is done. Active or inactive are both allowed; is_active is printed loudly.
// ADD-ONLY + RE-RUNNABLE: an identical object is skipped; a DIFFERENT file at the same path is refused without
//   --replace (upload uses upsert:false, so storage itself refuses a silent overwrite); photo rows are inserted
//   only if absent; logo_path, banner_path and eatery_menu_items.photo_path are set only if null or equal. Order: ALL uploads
//   (gallery, menu, logo, dish), verify by re-download, then photo rows, logo_path, dish photo_path.
//   Nothing is ever deleted; rows for photos not in the manifest are listed, not touched.

import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { prodWriteGuard, serviceRoleKey } from './lib/prod-write-guard.mjs'
import { BUCKET, MIN, SLUG_RE, sha256, validateLocal, readiness, plan, safeRead, matchDishes, planDishes, applyPlan } from './lib/eatery-images-lib.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const opt = n => args.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const slug = opt('slug')
const apply = args.includes('--apply')
const replace = args.includes('--replace')
const reportPath = opt('report')
prodWriteGuard({ wouldWrite: apply, workflow: 'eatery-images', dryHint: 'node scripts/eatery-images.mjs --slug=<slug>' })

// The report is an Actions artifact: on this PUBLIC repo anyone signed in to GitHub can download it, and secret
// masking does not apply to artifacts. So it never holds raw Supabase error text (which could echo a request or
// header): only the step, the object path and a short sanitised code.
const why = e => (typeof e === 'string' ? e : `code=${[e?.statusCode, e?.status, e?.code].map(String).find(c => /^[A-Za-z0-9_-]{1,20}$/.test(c) && c !== 'undefined') ?? 'unknown'}`)
const report = { slug, apply, replace, problems: [], errors: [] }
const out = (...l) => console.log(...l)
const finish = code => {
  if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2))
  process.exit(code)
}
const refuse = problems => {
  report.problems.push(...problems)
  console.error(`\nREFUSED: ${problems.length} problem(s), nothing was written:`)
  for (const p of problems) console.error(`  - ${p}`)
  finish(1)
}

if (!slug || !SLUG_RE.test(slug)) refuse([`--slug is required and must match ${SLUG_RE}`])
if (apply && process.env.GITHUB_REF !== 'refs/heads/main') refuse([`apply runs from refs/heads/main only (GITHUB_REF=${process.env.GITHUB_REF ?? 'unset'})`])

// 1. local files
const dir = resolve(ROOT, 'data/eatery', slug)
const rawManifest = safeRead(dir, 'manifest.json')
if (!rawManifest) refuse([`data/eatery/${slug}/manifest.json not found`])
if (rawManifest.unsafe) refuse([`manifest.json refused, ${rawManifest.unsafe}`])
let manifest
try { manifest = JSON.parse(rawManifest.toString('utf8')) } catch { refuse(['manifest.json is not valid JSON']) }
const readFile = name => safeRead(dir, name)
const local = validateLocal(slug, manifest, readFile)
if (local.problems.length) refuse(local.problems)
out(`manifest OK: ${local.items.length} image(s) + ${local.dishes.length} dish photo(s) for ${slug}`)
for (const it of local.items) out(`  ${it.path}  ${it.bytes} bytes  ${it.mime}  ${it.width}x${it.height}`)
for (const d of local.dishes) out(`  dish ${d.src}  ${d.bytes} bytes  ${d.mime}  ${d.width}x${d.height}`)
for (const w of local.waivers) out(w.kind === 'banner'
  ? `  !! SIZE WAIVER APPLIED: banner ${w.src} is ${w.width}x${w.height}, below width ${MIN.bannerWidth}; accepted down to ${w.minWidth} (approved by ${w.approvedBy}, ${w.date})`
  : `  !! SIZE WAIVER APPLIED: ${w.src} is ${w.width}x${w.height}, below ${MIN.dishShortSide}; accepted down to ${w.minShortSide} (approved by ${w.approvedBy}, ${w.date})`)

// 2. production state (service key; reads only until the apply section below)
const url = process.env.EXPO_PUBLIC_SUPABASE_URL
if (!url) refuse(['EXPO_PUBLIC_SUPABASE_URL is empty'])
const sb = createClient(url, serviceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } })
const bail = (what, error) => { report.errors.push(`${what}: ${why(error)}`); refuse([`${what} failed (code in the report artifact)`]) }

const pr = await sb.from('eatery_partners')
  .select('id,is_active,lat,lng,address,menu_url,menu_verified_on,logo_path,banner_path,eatery_menu_items(count)').eq('slug', slug)
if (pr.error) bail('partner query', pr.error)
if (pr.data.length > 1) refuse([`slug matched ${pr.data.length} partner rows`])
const partner = pr.data[0] ?? null
const menuItems = partner?.eatery_menu_items?.[0]?.count ?? 0
out(`\npartner: ${partner ? `found, IS_ACTIVE = ${partner.is_active ? 'TRUE (LIVE - photos become visible immediately)' : 'false (hidden)'}` : 'NOT FOUND'}`)
out(`readiness inputs: menu items ${menuItems}, menu_url ${partner?.menu_url ? 'set' : 'unset'}, logo_path ${partner?.logo_path ?? 'null'}`)
const notReady = readiness(partner, menuItems, local.dishes.length)
if (notReady.length) refuse(notReady.map(p => `not ready: ${p}`))

const rr = await sb.from('eatery_photos').select('storage_path,kind,width,height,sort_order', { count: 'exact' }).eq('partner_id', partner.id)
if (rr.error) bail('photo rows query', rr.error)
if (rr.count !== rr.data.length) bail('photo rows query', `truncated: count ${rr.count} vs received ${rr.data.length}`)

let itemRows = []
let dishes = []
if (local.dishes.length) {
  const mr = await sb.from('eatery_menu_items').select('id,section,name,photo_path,photo_width,photo_height', { count: 'exact' }).eq('partner_id', partner.id)
  if (mr.error) bail('menu items query', mr.error)
  if (mr.count !== mr.data.length) bail('menu items query', `truncated: count ${mr.count} vs received ${mr.data.length}`)
  itemRows = mr.data
  const md = matchDishes(slug, local.dishes, itemRows)
  if (md.problems.length) refuse(md.problems)
  dishes = md.resolved
}

const lr = await sb.storage.from(BUCKET).list(slug, { limit: 1000 })
if (lr.error) bail('bucket listing', lr.error)
if (lr.data.length >= 1000) bail('bucket listing', 'folder holds >= 1000 objects, listing may be truncated')
const names = new Set(lr.data.map(o => o.name))
const existing = {}
for (const it of [...local.items, ...dishes]) {
  if (!names.has(it.path.slice(slug.length + 1))) continue
  const dl = await sb.storage.from(BUCKET).download(it.path)
  if (dl.error) bail(`download of existing ${it.path}`, dl.error)
  existing[it.path] = { sha256: sha256(Buffer.from(await dl.data.arrayBuffer())) }
}

// 3. plan
const pl = plan(local.items, { existing, rows: rr.data, logoPath: partner.logo_path, bannerPath: partner.banner_path }, replace)
const dp = planDishes(dishes, { existing, itemRows: Object.fromEntries(itemRows.map(r => [r.id, r])) }, replace)
pl.problems.push(...dp.problems)
pl.uploads.push(...dp.uploads)
report.plan = { uploads: pl.uploads, inserts: pl.inserts, updates: pl.updates, logo: pl.logo, banner: pl.banner, orphans: pl.orphans, dishes: dp.updates.map(u => ({ itemId: u.id, path: u.path, row: u.action })) }
out(`\nPLAN (${apply ? 'APPLY' : 'DRY - nothing is written'}${replace ? ', replace=true' : ''}):`)
for (const u of pl.uploads) out(`  object  ${u.action.padEnd(15)} ${u.path}`)
for (const r of pl.inserts) out(`  row     insert          ${r.kind} ${r.storage_path} ${r.width}x${r.height} order ${r.sort_order}`)
for (const r of pl.updates) out(`  row     update          ${r.kind} ${r.storage_path}`)
out(`  logo_path ${pl.logo.action}${pl.logo.path ? ' ' + pl.logo.path : ''}`)
out(`  banner_path ${pl.banner.action}${pl.banner.path ? ' ' + pl.banner.path : ''}`)
for (const d of dishes) {
  const up = pl.uploads.find(u => u.path === d.path), row = dp.updates.find(u => u.id === d.itemId)
  out(`  dish    ${d.src} -> item ${d.itemId} -> ${d.path}  ${d.bytes} bytes ${d.mime} ${d.width}x${d.height}  object ${up?.action ?? 'REFUSED'}, row ${row?.action ?? 'REFUSED'}`)
}
if (pl.orphans.length) out(`  note: ${pl.orphans.length} existing photo row(s) are not in the manifest and stay untouched: ${pl.orphans.join(', ')}`)
if (pl.problems.length) refuse(pl.problems)
const counts = a => pl.uploads.filter(u => u.action === a).length
out(`\nsummary: upload ${counts('upload')}, replace ${counts('replace')}, skip ${counts('skip-identical')}, rows insert ${pl.inserts.length}, rows update ${pl.updates.length}, logo ${pl.logo.action}, banner ${pl.banner.action}, dish rows set ${dp.updates.filter(u => u.action === 'set').length} keep ${dp.updates.filter(u => u.action === 'keep').length}`)
if (!apply) { out('DRY: no write of any kind was made.'); finish(0) }

// 4. apply
const fail = (what, error) => { report.errors.push(`${what}: ${why(error)}`); console.error(`FAILED ${what} (code in the report artifact)`) }
const bytesByPath = new Map([...local.items, ...dishes].map(i => [i.path, i]))
const failed = await applyPlan({ sb, partnerId: partner.id, uploads: pl.uploads, bytesByPath, inserts: pl.inserts, updates: pl.updates, logo: pl.logo, banner: pl.banner, dishUpdates: dp.updates, replace, out, fail })
if (failed && report.errors.some(e => /^(upload|verify) /.test(e))) console.error(`\n${failed} object failure(s): rows, logo_path, banner_path and dish photo_path NOT written (no row may point at a missing object).`)
out(failed ? `\n${failed} failure(s).` : '\nAPPLIED.')
finish(failed ? 1 : 0)
