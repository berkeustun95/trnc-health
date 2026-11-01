// ─── sync-dovec — Döveç projects + units, on cron (DISABLED until the API is connected) ──────
//
// Deploy:  scripts/fn-deploy.sh sync-dovec --go   (after Berke's go; verify_jwt from deploy-config.json)
// Cron:    schedule.sql in this directory — NOT applied. Turning it on: PLUG-IN.md.
//
// The Novest rails, second source: same upsert shape, same content_hash skip, same mass-delist
// floor, same last_seen_at heartbeat, metadata only (images are mirror-dovec-images.mjs, because
// sharp is native Node and this is Deno — see sync-novest/index.ts for why that split is right).
//
// ALL API KNOWLEDGE IS IN ../_shared/dovec-feed.mjs. This file only moves rows.
//
// THREE LOCKS, any one of which keeps it from writing:
//   1. DOVEC_SYNC_ENABLED must be the string 'true' (Edge Function secret). Unset = 200 no-op.
//   2. DOVEC_API_BASE_URL + DOVEC_API_KEY must be set, or fetchFeed throws before any write.
//   3. The cron job does not exist yet (schedule.sql is a file, not a migration).
//
// PUBLISHING: new rows land 'pending' while the Döveç estate_agencies row is 'pending' (as
// 20261153 seeds it), and the sync never promotes pending -> active. Go-live flips the agency and
// the rows together, with the flag (PLUG-IN.md, step 6).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { readAllResult } from '../_shared/read-all-rows.mjs'
import {
  SOURCE, AGENCY_ID, ENV_BASE_URL, ENV_API_KEY, fetchFeed, mapFeed, planSync, projectPayload, unitPayload,
} from '../_shared/dovec-feed.mjs'
import { AREAS_BY_REGION, areaSlug } from '../../../constants/areas.js'

function assertHomogeneous(label: string, rows: Record<string, unknown>[]) {
  if (rows.length < 2) return
  const shape = Object.keys(rows[0]).sort().join(',')
  const odd = rows.findIndex(r => Object.keys(r).sort().join(',') !== shape)
  if (odd !== -1) throw new Error(`ragged "${label}" payload — row ${odd} differs from row 0 (PostgREST would NULL the gaps)`)
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async () => {
  const started = Date.now()
  const log: string[] = []
  const say = (s: string) => { log.push(s); console.log(s) }

  if (Deno.env.get('DOVEC_SYNC_ENABLED') !== 'true') {
    return json({ ok: true, disabled: true, note: 'DOVEC_SYNC_ENABLED is not "true" — nothing fetched, nothing written' })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    )

    // ── Pre-flight: the agency row decides whether new rows publish ─────────
    const { data: agency } = await supabase
      .from('estate_agencies').select('id,status').eq('id', AGENCY_ID).maybeSingle()
    if (!agency || !['pending', 'active'].includes(agency.status)) {
      throw new Error('Döveç agency row missing or rejected — apply 20261153 first')
    }
    const publish = agency.status === 'active'

    // ── Fetch + map ─────────────────────────────────────────────────────────
    const feed = await fetchFeed({ baseUrl: Deno.env.get(ENV_BASE_URL), apiKey: Deno.env.get(ENV_API_KEY) })
    say(`feed: ${feed.length} project(s)`)
    if (!feed.length) throw new Error('feed returned ZERO projects — refusing to run')
    const { projects, units, skipped, flagged } = await mapFeed(feed, { areasByRegion: AREAS_BY_REGION, areaSlugOf: areaSlug })

    // ── Diff ────────────────────────────────────────────────────────────────
    const read = async (table: string) => {
      const { data, error } = await readAllResult((a: number, b: number) => supabase
        .from(table).select('id,external_id,status,content_hash', { count: 'exact' }).eq('source', SOURCE).order('id').range(a, b))
      if (error) throw new Error(`read ${table}: ${error.message}`)
      return (data ?? []) as { id: string; external_id: string; status: string; content_hash: string | null }[]
    }
    const pPlan = planSync(projects, await read('property_projects'), { publish })
    const uPlan = planSync(units, await read('properties'), { publish })
    for (const [label, plan] of [['projects', pPlan], ['units', uPlan]] as const) {
      if (plan.abort) throw new Error(`ABORT (${label}): ${plan.abort}. Looks like a bad fetch. Nothing written.`)
      say(`${label}: insert ${plan.inserts.length} · update ${plan.updates.length} · unchanged ${plan.unchanged} · ` +
          `relist ${plan.relist.length} · delist ${plan.delist.length}`)
    }
    say(`skipped ${skipped.length} · flagged ${flagged.length} · publish=${publish}`)

    const now = new Date().toISOString()

    // ── Write projects first: units need their ids ──────────────────────────
    const projIns = pPlan.inserts.map(r => projectPayload(r, { status: pPlan.insertStatus, last_seen_at: now }))
    const projUpd = pPlan.updates.map(r => projectPayload(r))
    assertHomogeneous('project insert', projIns)
    assertHomogeneous('project update', projUpd)
    for (const [label, payload] of [['project insert', projIns], ['project update', projUpd]] as const) {
      if (!payload.length) continue
      const { error } = await supabase.from('property_projects').upsert(payload, { onConflict: 'external_id' })
      if (error) throw new Error(`${label}: ${error.message}`)
    }
    const idByExternal = new Map((await read('property_projects')).map(r => [r.external_id, r.id]))

    const unitIns = uPlan.inserts.map(r => unitPayload(r, idByExternal, { status: uPlan.insertStatus, last_seen_at: now }))
    const unitUpd = uPlan.updates.map(r => unitPayload(r, idByExternal))
    assertHomogeneous('unit insert', unitIns)
    assertHomogeneous('unit update', unitUpd)
    for (const [label, payload] of [['unit insert', unitIns], ['unit update', unitUpd]] as const) {
      if (!payload.length) continue
      const { error } = await supabase.from('properties').upsert(payload, { onConflict: 'external_id' })
      if (error) throw new Error(`${label}: ${error.message}`)
    }

    // ── Status transitions: active <-> delisted only ────────────────────────
    for (const [table, plan] of [['property_projects', pPlan], ['properties', uPlan]] as const) {
      if (plan.relist.length) {
        const { error } = await supabase.from(table).update({ status: 'active' })
          .eq('source', SOURCE).eq('status', 'delisted').in('external_id', plan.relist.map(r => r.external_id))
        if (error) throw new Error(`relist ${table}: ${error.message}`)
      }
      if (plan.delist.length) {
        const { error } = await supabase.from(table).update({ status: 'delisted' })
          .eq('source', SOURCE).eq('status', 'active').in('external_id', plan.delist.map(r => r.external_id))
        if (error) throw new Error(`delist ${table}: ${error.message}`)
      }
    }

    // LAST: the heartbeat (max(last_seen_at) is the staleness signal, as for Novest).
    for (const [table, rows] of [['property_projects', projects], ['properties', units]] as const) {
      if (!rows.length) continue
      const { error } = await supabase.from(table).update({ last_seen_at: now })
        .eq('source', SOURCE).in('external_id', rows.map(r => r.external_id))
      if (error) throw new Error(`last_seen_at ${table}: ${error.message}`)
    }

    say(`ok in ${Date.now() - started}ms`)
    return json({ ok: true, publish, projects: projects.length, units: units.length,
      project_plan: { inserts: pPlan.inserts.length, updates: pPlan.updates.length, delist: pPlan.delist.length, relist: pPlan.relist.length },
      unit_plan: { inserts: uPlan.inserts.length, updates: uPlan.updates.length, delist: uPlan.delist.length, relist: uPlan.relist.length },
      skipped, flagged, log })
  } catch (e) {
    console.error('sync-dovec FAILED:', (e as Error).message)
    return json({ ok: false, error: (e as Error).message, log }, 500)
  }
})
