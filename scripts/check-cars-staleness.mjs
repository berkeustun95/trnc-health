#!/usr/bin/env node
// ─── Araçlar health: is anything stuck? ─────────────────────────────────────
//
//   node scripts/check-cars-staleness.mjs        # exit 1 on any red (daily-health)
//
// Three questions, read-only, service key (pending and expired rows are not public):
//   1. The approval queue: no private listing pending longer than PENDING_MAX_H (sellers wait on us).
//   2. The expiry cron: no listing still 'active' more than EXPIRE_SLACK_H past expires_at (expire-vehicles, 02:40 UTC).
//      Visibility never waits for it (the read policy checks expires_at), but İlanlarım and the admin tab do.
//   3. The photo cleanup: no listing still holding photo rows more than CLEANUP_SLACK_D days past its grace
//      (araclar-photo-cleanup, nightly). That is the go-live gate, so it must be seen to run.
// Prints ages and yes/no only: Actions logs are public.
import { createClient } from '@supabase/supabase-js'
import { prodWriteGuard, serviceRoleKey } from './lib/prod-write-guard.mjs'
import { CLEANUP_GRACE_DAYS, photoCleanupReason } from '../constants/cars.js'

prodWriteGuard({ wouldWrite: false, workflow: 'daily-health' })

const PENDING_MAX_H = 48
const EXPIRE_SLACK_H = 26
const CLEANUP_SLACK_D = 2
const url = process.env.EXPO_PUBLIC_SUPABASE_URL
if (!url) { console.error('EXPO_PUBLIC_SUPABASE_URL missing'); process.exit(2) }
const sb = createClient(url, serviceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } })
const now = Date.now()
const red = []

const { data: oldest, error: e1 } = await sb.from('vehicles').select('created_at')
  .eq('status', 'pending').eq('source', 'private').order('created_at', { ascending: true }).limit(1)
if (e1) { console.error('read pending:', e1.message); process.exit(2) }
const pendingH = oldest?.[0] ? (now - Date.parse(oldest[0].created_at)) / 36e5 : null
if (pendingH != null && pendingH > PENDING_MAX_H) red.push(`a car listing has waited ${pendingH.toFixed(0)}h for approval (cap ${PENDING_MAX_H}h): admin → Cars`)

const cutoff = new Date(now - EXPIRE_SLACK_H * 36e5).toISOString()
const { data: stale, error: e2 } = await sb.from('vehicles').select('id').eq('status', 'active').lt('expires_at', cutoff).limit(1)
if (e2) { console.error('read expiry:', e2.message); process.exit(2) }
if (stale.length) red.push(`an active listing is ${EXPIRE_SLACK_H}h+ past expiry: the expire-vehicles cron is not running`)

// Earliest grace is the shortest one; anything older than that may be due. Then the shared rule decides.
const since = new Date(now - Math.min(...Object.values(CLEANUP_GRACE_DAYS)) * 864e5).toISOString()
const { data: gone, error: e3 } = await sb.from('vehicles')
  .select('id, source, status, updated_at, hidden_at, vehicle_images(id)')
  .eq('source', 'private').or(`status.in.(removed,rejected),hidden_at.not.is.null`).lt('updated_at', since).limit(1000)
if (e3) { console.error('read cleanup:', e3.message); process.exit(2) }
const late = gone.some(v => v.vehicle_images.length
  && photoCleanupReason(v, now - CLEANUP_SLACK_D * 864e5))
if (late) red.push(`photos of a removed / rejected / hidden listing are ${CLEANUP_SLACK_D}+ days past their grace: araclar-photo-cleanup is not running`)

console.log(`\n── Araçlar health ──\n  oldest pending : ${pendingH == null ? 'none' : pendingH.toFixed(0) + 'h'} (cap ${PENDING_MAX_H}h)\n  expiry cron    : ${stale.length ? 'LATE' : 'ok'}\n  photo cleanup  : ${late ? 'LATE' : 'ok'}\n`)
if (red.length) { for (const r of red) console.error(`::error::${r}`); process.exit(1) }
