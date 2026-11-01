#!/usr/bin/env node
// ─── Döveç images — mirror to our storage (the half sync-dovec cannot do) ────
//
//   node scripts/mirror-dovec-images.mjs --dry     # plan only
//   gh workflow run dovec-images -f apply=true     # the only way it writes (CI, prodWriteGuard)
//
// Planning and the upload/insert order live in scripts/lib/dovec-images.mjs (shared with the mock
// test); the re-encode is scripts/lib/partner-image-optimise.mjs (shared with Novest). This file
// only wires them to Supabase. A unit or project stays hidden from app users until its first
// photo lands here (props_hide_photoless_novest / pp_select_public), so a failed image exits
// non-zero and the run goes red.
//
// Needs DOVEC_API_BASE_URL + DOVEC_API_KEY (the photo URLs come from the feed) — until Döveç
// sends them this script refuses at fetchFeed, which is the intended state.

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { SOURCE, ENV_BASE_URL, ENV_API_KEY, fetchFeed, mapFeed } from '../supabase/functions/_shared/dovec-feed.mjs'
import { AREAS_BY_REGION, areaSlug } from '../constants/areas.js'
import { prodWriteGuard, serviceRoleKey } from './lib/prod-write-guard.mjs'
import { readAllRows } from './lib/read-all-rows.mjs'
import { optimise } from './lib/partner-image-optimise.mjs'
import { BUCKET, planImages, runImages } from './lib/dovec-images.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dry = process.argv.includes('--dry')
prodWriteGuard({ wouldWrite: !dry, workflow: 'dovec-images', dryHint: 'node scripts/mirror-dovec-images.mjs --dry' })
const fail = (...l) => { for (const x of l) console.error(x); process.exit(1) }

if (existsSync(resolve(ROOT, '.env'))) {
  for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}
const KEY = serviceRoleKey()
if (!process.env.EXPO_PUBLIC_SUPABASE_URL) fail('EXPO_PUBLIC_SUPABASE_URL missing')
const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, KEY,
  { auth: { persistSession: false, autoRefreshToken: false } })

const read = async (table, cols) => (await readAllRows((a, b) => supabase.from(table)
  .select(cols, { count: 'exact' }).eq('source', SOURCE).order('id').range(a, b))).rows

const dbProjects = await read('property_projects', 'id,external_id,cover_source_url')
const dbUnits = await read('properties', 'id,external_id')
if (!dbProjects.length) fail('No Döveç projects in the database — sync-dovec has not run.')
const haveImages = dbUnits.length ? (await readAllRows((a, b) => supabase.from('property_images')
  .select('property_id,source_url,is_primary', { count: 'exact' })
  .in('property_id', dbUnits.map(u => u.id)).order('id').range(a, b))).rows : []

const feed = await fetchFeed({ baseUrl: process.env[ENV_BASE_URL], apiKey: process.env[ENV_API_KEY] })
const mapped = await mapFeed(feed, { areasByRegion: AREAS_BY_REGION, areaSlugOf: areaSlug })
const plan = planImages({ mapped, dbProjects, dbUnits, haveImages })
console.log(`plan: ${plan.covers.length} project cover(s) · ${plan.unitJobs.length} unit image(s)`)
if (dry) { console.log('(dry) nothing written.'); process.exit(0) }

const { mirrored, failed } = await runImages(plan, {
  async fetchImage(url) {
    const res = await fetch(url, { headers: { 'User-Agent': 'ADA-TRNC-Health/1.0 (+partner image mirror)' } })
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`)
    return { body: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') || '' }
  },
  optimise,
  async upload(path, buffer, contentType) {
    const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType, upsert: true })
    if (error) throw new Error(`upload: ${error.message}`)
    return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  },
  async insertImage(row) {
    const { error } = await supabase.from('property_images').insert(row)
    if (error) throw new Error(`row: ${error.message}`)
  },
  async setCover(projectId, publicUrl, sourceUrl) {
    const { error } = await supabase.from('property_projects')
      .update({ cover_image_url: publicUrl, cover_source_url: sourceUrl }).eq('id', projectId)
    if (error) throw new Error(`cover: ${error.message}`)
  },
})
console.log(`mirrored ${mirrored}; ${failed.length} failure(s)`)
for (const f of failed.slice(0, 15)) console.log(`  ${f}`)
if (failed.length) process.exit(1)
