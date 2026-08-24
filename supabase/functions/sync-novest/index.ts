// ─── sync-novest — the metadata half of the Novest import, on cron ───────────
//
// Deploy:  supabase functions deploy sync-novest
// Cron:    see schedule.sql in this directory
//
// WHAT THIS DOES AND DELIBERATELY DOES NOT DO
//
// Metadata only: price, status, title, description, delisting. NOT images.
//
// Images cannot run here and that is not a limitation to work around. The mandated
// pipeline is `sharp` (MAX_WIDTH 1200, mozjpeg q80), a NATIVE NODE MODULE, and this is
// Deno. The alternative — reusing WordPress's pre-rendered `houzez-gallery` variant
// without re-encoding — was measured and rejected: it is 1170x785 against full's
// 2560x1440, aspect 1.49 vs 1.78, so it is a CROP and would silently crop every image in
// the module. Images stay a local pass (scripts/mirror-novest-images.mjs).
//
// The split is also the right one on its merits: metadata is what goes STALE and what a
// property app must not get wrong. Images are append-mostly, and a new listing renders
// the existing placeholder until the image pass runs — a path Slice 3 already handles.
//
// THE MAPPING RULES ARE NOT DUPLICATED HERE. Everything that decides what a listing
// becomes lives in ../_shared/novest-feed.mjs and is imported by this function AND by
// the local Node tooling. Two copies of the type priority list would drift, and both
// would keep working while only one stayed right.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  SOURCE, AGENCY_ID, getAll, decodeEntities, cleanDescription, assertNoPhone,
  num, int, meta, mapPropertyType, extractDeedType, coordsInCyprus,
  INTENT_BY_STATUS, DISTRICT_BY_STATE, AREA_ALIASES, FEATURE_TO_COLUMN,
} from '../_shared/novest-feed.mjs'
import { AREAS_BY_REGION, areaSlug } from '../../../constants/areas.js'

const DELIST_FLOOR = 0.7

// Identical list, identical order to import-novest-properties.mjs. If you change one,
// change both — the content_hash is computed over exactly these keys, so a divergence
// makes every row look modified on the next run of whichever side changed.
const MUTABLE = [
  'title', 'description', 'intent', 'property_type', 'price', 'currency', 'price_period',
  'bedrooms', 'bathrooms', 'living_rooms', 'area_sqm', 'plot_sqm',
  'district', 'area', 'deed_type', 'amenities', 'furnished', 'gated_community',
  'source_url', 'published_at',
]

const ALLOWED: Record<string, string[]> = {
  property_type: ['apartment', 'villa', 'studio', 'house', 'land', 'commercial'],
  intent: ['rent', 'sale', 'short_term'],
  currency: ['GBP', 'TRY', 'EUR', 'USD'],
  price_period: ['monthly', 'nightly', 'weekly', 'yearly', 'total'],
  district: ['nicosia', 'kyrenia', 'famagusta', 'morphou', 'iskele', 'lefke', 'karpaz'],
  deed_type: ['turkish', 'exchange', 'foreign', 'allocation', 'tmd'],
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function validateRow(r: Record<string, unknown>): string[] {
  const bad: string[] = []
  for (const [k, vals] of Object.entries(ALLOWED)) {
    if (r[k] != null && !vals.includes(r[k] as string)) bad.push(`${k}=${JSON.stringify(r[k])}`)
  }
  const a = r.amenities as string[] | null
  if (a !== null && (!Array.isArray(a) || a.length < 1 || a.length > 60)) {
    bad.push(`amenities cardinality ${a?.length} (use null, never [])`)
  }
  if (!((r.price as number) > 0)) bad.push(`price=${r.price}`)
  if (!r.title) bad.push('title empty')
  return bad
}

function assertHomogeneous(label: string, rows: Record<string, unknown>[]) {
  if (rows.length < 2) return
  const shape = Object.keys(rows[0]).sort().join(',')
  const odd = rows.findIndex(r => Object.keys(r).sort().join(',') !== shape)
  if (odd !== -1) {
    throw new Error(`ragged "${label}" payload — row ${odd} differs from row 0. ` +
      `PostgREST would NULL every column the shorter rows omit.`)
  }
}

Deno.serve(async () => {
  const started = Date.now()
  const log: string[] = []
  const say = (s: string) => { log.push(s); console.log(s) }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    )

    // ── Pre-flight ──────────────────────────────────────────────────────────
    const { data: agency } = await supabase
      .from('estate_agencies').select('id,status').eq('id', AGENCY_ID).maybeSingle()
    if (!agency || agency.status !== 'active') {
      throw new Error('Novest agency row missing or not active — apply 20260916 first')
    }

    // ── Fetch ───────────────────────────────────────────────────────────────
    const [types, statuses, states, cities, features] = await Promise.all([
      getAll('/property_type',    { _fields: 'id,name,slug' }),
      getAll('/property_status',  { _fields: 'id,name,slug' }),
      getAll('/property_state',   { _fields: 'id,name,slug' }),
      getAll('/property_city',    { _fields: 'id,name,slug' }),
      getAll('/property_feature', { _fields: 'id,name,slug' }),
    ])
    const byId = (l: any[]) => new Map(l.map(t => [t.id, t]))
    const T = byId(types), S = byId(statuses), ST = byId(states)
    const CI = byId(cities), F = byId(features)

    const feed = await getAll('/properties', { orderby: 'modified', order: 'desc' })
    say(`feed: ${feed.length} listing(s)`)

    // An empty feed would delist everything. Refuse before any write.
    if (!feed.length) throw new Error('feed returned ZERO listings — refusing to run')

    // ── Map ─────────────────────────────────────────────────────────────────
    const rows: Record<string, any>[] = []
    const skipped: string[] = []

    for (const p of feed) {
      const typeSlugs = (p.property_type || []).map((i: number) => T.get(i)?.slug).filter(Boolean)
      const property_type = mapPropertyType(typeSlugs)
      if (!property_type) { skipped.push(`${p.id}: no property_type`); continue }

      const statusSlug = (p.property_status || []).map((i: number) => S.get(i)?.slug).filter(Boolean)[0]
      const intent = INTENT_BY_STATUS[statusSlug]
      if (!intent) { skipped.push(`${p.id}: no property_status`); continue }

      const price = num(meta(p, 'fave_property_price'))
      if (price === null || price <= 0) { skipped.push(`${p.id}: price ${JSON.stringify(meta(p, 'fave_property_price'))}`); continue }

      const stateSlug = (p.property_state || []).map((i: number) => ST.get(i)?.slug).filter(Boolean)[0]
      const district = DISTRICT_BY_STATE[stateSlug] ?? null

      const citySlug = (p.property_city || []).map((i: number) => CI.get(i)?.slug).filter(Boolean)[0]
      let area: string | null = null
      if (citySlug && district) {
        const cand = AREA_ALIASES[citySlug] ?? citySlug
        if ((AREAS_BY_REGION[district] || []).some((n: string) => areaSlug(n) === cand)) area = cand
      }

      const featureSlugs = (p.property_feature || []).map((i: number) => F.get(i)?.slug).filter(Boolean)
      const amenityNames = (p.property_feature || [])
        .map((i: number) => F.get(i))
        .filter((f: any) => f && !FEATURE_TO_COLUMN[f.slug])
        .map((f: any) => decodeEntities(f.name))

      const title = decodeEntities(p.title.rendered).trim()
      const description = cleanDescription(p.content.rendered) || null

      // Throws -> the listing is skipped, never stored. A missing listing is a smaller
      // failure than a partner's private mobile number published inside it.
      try { assertNoPhone(String(p.id), title, description) }
      catch (e) { skipped.push(`${p.id}: ${(e as Error).message}`); continue }

      if (coordsInCyprus(num(meta(p, 'houzez_geolocation_lat')), num(meta(p, 'houzez_geolocation_long')))) {
        say(`⚠ ${p.id} now carries coordinates inside the Cyprus box — NOT imported`)
      }

      const row: Record<string, any> = {
        external_id: `${SOURCE}-${p.id}`,
        title, description, intent, property_type, price,
        currency: 'GBP',
        price_period: intent === 'rent' ? 'monthly' : 'total',
        bedrooms:     int(meta(p, 'fave_property_bedrooms')),
        bathrooms:    int(meta(p, 'fave_property_bathrooms')),
        living_rooms: int(meta(p, 'fave_property_rooms')),
        area_sqm:     num(meta(p, 'fave_property_size')),
        plot_sqm:     num(meta(p, 'fave_property_land')),
        district, area,
        deed_type: extractDeedType(p.content.rendered),
        // null, never [] — properties_amenities_shape_check rejects an empty array.
        amenities: amenityNames.length ? amenityNames : null,
        furnished:       featureSlugs.includes('esyali') || null,
        gated_community: featureSlugs.includes('siteicerisinde') || null,
        source_url: p.link,
        published_at: p.date_gmt ? `${p.date_gmt}Z` : null,
      }

      const bad = validateRow(row)
      if (bad.length) { skipped.push(`${p.id}: ${bad.join('; ')}`); continue }

      row.content_hash = await sha256Hex(JSON.stringify(MUTABLE.map(k => row[k] ?? null)))
      rows.push(row)
    }

    // ── Diff ────────────────────────────────────────────────────────────────
    const { data: existing, error: readErr } = await supabase
      .from('properties').select('external_id,status,content_hash').eq('source', SOURCE)
    if (readErr) throw new Error(`read failed: ${readErr.message}`)

    const prev = new Map((existing ?? []).map(r => [r.external_id, r]))
    const presentIds = rows.map(r => r.external_id)
    const presentSet = new Set(presentIds)

    const inserts = rows.filter(r => !prev.has(r.external_id))
    const updates = rows.filter(r => prev.has(r.external_id) && prev.get(r.external_id)!.content_hash !== r.content_hash)
    const unchanged = rows.length - inserts.length - updates.length

    // Sync owns active <-> delisted and nothing else. rejected/archived are admin acts.
    const relist = (existing ?? []).filter(r => r.status === 'delisted' && presentSet.has(r.external_id))
    const delist = (existing ?? []).filter(r => r.status === 'active' && !presentSet.has(r.external_id))

    // ── Mass-delist guard ───────────────────────────────────────────────────
    const activeBefore = (existing ?? []).filter(r => r.status === 'active').length
    if (activeBefore > 0 && presentIds.length < activeBefore * DELIST_FLOOR) {
      throw new Error(`ABORT: ${presentIds.length} usable listing(s) against ${activeBefore} active — ` +
        `below the ${Math.round(DELIST_FLOOR * 100)}% floor. Looks like a bad fetch. Nothing written.`)
    }

    say(`insert ${inserts.length} · update ${updates.length} · unchanged ${unchanged} · ` +
        `relist ${relist.length} · delist ${delist.length} · skipped ${skipped.length}`)

    // ── Write ───────────────────────────────────────────────────────────────
    const now = new Date().toISOString()
    const insertPayload = inserts.map(r => ({
      ...r, source: SOURCE, agency_id: AGENCY_ID, status: 'active',
      location_precision: 'area',   // properties_feed_precision_check demands it
      last_seen_at: now,
    }))
    // ⚠ source / agency_id / location_precision ARE IN THE UPDATE PAYLOAD, AND MUST BE.
    //
    // They are immutable for a feed row, so including them looks redundant. It is not.
    // PostgREST's upsert is INSERT ... ON CONFLICT DO UPDATE, and Postgres validates CHECK
    // constraints against the PROPOSED INSERT ROW before it ever detects the conflict. A
    // payload without them proposes a row with source NULL and agent_id NULL, which fails
    // properties_source_agent_xor_check (both NULL satisfies neither branch), and without
    // location_precision it inherits the 'exact' DEFAULT and fails
    // properties_feed_precision_check. The existing row is never reached.
    //
    // FOUND THE HARD WAY, AND LATE: run 1 was 88 inserts and run 2 was 88 content_hash
    // matches, so the update path had not executed once. It failed on the first real content
    // change — and the cron function carries the same shape, so it would have failed there
    // on the first price edit Novest made. Third instance this slice of a branch that was
    // written, shipped and never run.
    const updatePayload = updates.map(r => ({
      ...r, source: SOURCE, agency_id: AGENCY_ID, location_precision: 'area',
    }))

    assertHomogeneous('insert', insertPayload)
    assertHomogeneous('update', updatePayload)

    for (const [label, payload] of [['insert', insertPayload], ['update', updatePayload]] as const) {
      if (!payload.length) continue
      const { error } = await supabase.from('properties').upsert(payload, { onConflict: 'external_id' })
      if (error) throw new Error(`${label} upsert: ${error.message}`)
    }

    if (relist.length) {
      const { error } = await supabase.from('properties').update({ status: 'active' })
        .eq('source', SOURCE).eq('status', 'delisted').in('external_id', relist.map(r => r.external_id))
      if (error) throw new Error(`relist: ${error.message}`)
    }
    if (delist.length) {
      const { error } = await supabase.from('properties').update({ status: 'delisted' })
        .eq('source', SOURCE).eq('status', 'active').in('external_id', delist.map(r => r.external_id))
      if (error) throw new Error(`delist: ${error.message}`)
    }

    // LAST, and on every row present in the feed. This is the ONLY health signal the
    // module has — the AdminScreen staleness banner reads max(last_seen_at), so a run
    // that changed nothing must still prove it ran. Reaching this line IS the heartbeat.
    const { error: stampErr } = await supabase.from('properties')
      .update({ last_seen_at: now }).eq('source', SOURCE).in('external_id', presentIds)
    if (stampErr) throw new Error(`last_seen_at stamp: ${stampErr.message}`)

    say(`ok in ${Date.now() - started}ms`)
    return new Response(JSON.stringify({
      ok: true, feed: feed.length, imported: rows.length,
      inserts: inserts.length, updates: updates.length, unchanged,
      relist: relist.length, delist: delist.length, skipped, log,
    }), { headers: { 'Content-Type': 'application/json' } })

  } catch (e) {
    // 500 so the failure is visible in the Edge Function logs and to pg_cron. It is NOT
    // the primary alarm though — a cron that never fires produces no failed invocation
    // to look at. The staleness banner is what catches that, and it catches this too.
    console.error('sync-novest FAILED:', (e as Error).message)
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message, log }),
      { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
