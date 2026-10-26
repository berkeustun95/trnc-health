// ─── Novest image prune — the PURE planner ───────────────────────────────────
//
// rows + the feed's current media references -> a plan. No I/O, so scripts/check-novest-prune.mjs
// can prove every rule offline. mirror-novest-images.mjs --prune executes the plan.
//
// "Removed by Novest" = an ACTIVE listing that is in today's feed, with a property_images row whose
// media id (read from the storage path in `url`, partner/novest/{external_id}/{media_id}.{ext}) is
// no longer in that listing's reference list (featured_media + fave_property_images). A media id
// still referenced is kept even when /media does not serve it (novest-20111).

export const MISSING_FROM_FEED_MAX = 0.20   // abort when MORE than this share of active listings is absent
export const REMOVAL_SHARE_MAX = 0.15       // abort when removals exceed max(REMOVAL_FLOOR, this share of all rows)
export const REMOVAL_FLOOR = 10

// Media ids are 4+ digits. The legacy `{n}.{ext}` paths (n = a small index) must never parse as a media id.
const PATH_RE = /\/object\/public\/property-images\/(partner\/novest\/([^/?#]+)\/(\d{4,})\.[A-Za-z0-9]+)$/

// --prune may run in CI only from a manual dispatch that asked for it. Returns a refusal text or null.
export function pruneRefusal({ prune, env }) {
  if (!prune) return null
  if (env.GITHUB_EVENT_NAME === 'schedule') return '--prune never runs from the schedule.'
  if (env.GITHUB_ACTIONS === 'true' && !(env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.IN_PRUNE === 'true')) {
    return '--prune in CI needs a workflow_dispatch run with prune=true.'
  }
  return null
}

const OBJ_RE = /\/object\/public\/property-images\/(.+)$/

// Storage objects safe to delete after `deleted` rows are gone: a path still referenced by ANY row that
// remains (two rows can share one object) is never returned.
export function deletablePaths(allRows, deleted) {
  const gone = new Set(deleted.map(d => d.image_id ?? d.id))
  const kept = new Set()
  for (const r of allRows) if (!gone.has(r.id)) { const m = OBJ_RE.exec(String(r.url ?? '')); if (m) kept.add(m[1]) }
  return [...new Set(deleted.map(d => d.path))].filter(p => !kept.has(p))
}

export function parseImageUrl(url) {
  const m = PATH_RE.exec(String(url ?? ''))
  return m ? { path: m[1], externalId: m[2], mediaId: m[3] } : null
}

// listings : [{ id, external_id, status }]            (every novest properties row)
// images   : [{ id, property_id, url, sort_order, is_primary }]   (every novest property_images row)
// feed     : Map<external_id, string[]>               (media ids per listing, from the live feed)
// incomplete : Set<external_id>                       (mirror jobs failed / not yet done for the listing)
// served   : Map<external_id, Set<url>>               (the source_url pickVariant would fetch for every media id the
//                                                       listing still references; a row holding one is never removed,
//                                                       whatever its path looks like)
// incoming   : Map<external_id, n>                    (DRY ONLY: photos the mirror step would add first, so a
//                                                       dry plan shows what the applying run would remove)
export function planPrune({ listings, images, feed, incomplete = new Set(), incoming = new Map(), served = new Map() }) {
  const byProp = new Map()
  for (const r of images) (byProp.get(r.property_id) ?? byProp.set(r.property_id, []).get(r.property_id)).push(r)

  const plan = {
    checked: 0, removals: [], reassign: [], abort: [],
    totalRows: images.length,
    skipped: { notActive: [], notInFeed: [], mirrorIncomplete: [], lastPhoto: [], unrecognised: [] },
  }
  const active = listings.filter(l => l.status === 'active')
  for (const l of listings) if (l.status !== 'active') plan.skipped.notActive.push(l.external_id)

  if (!feed || feed.size === 0) plan.abort.push('the feed is empty')
  const missing = active.filter(l => !feed?.has(l.external_id))
  for (const l of missing) plan.skipped.notInFeed.push(l.external_id)
  if (active.length && missing.length / active.length > MISSING_FROM_FEED_MAX) {
    plan.abort.push(`${missing.length}/${active.length} active listings are missing from the feed (> ${MISSING_FROM_FEED_MAX * 100}%)`)
  }

  for (const l of active) {
    if (!feed?.has(l.external_id)) continue
    plan.checked++
    const rows = (byProp.get(l.id) ?? []).slice().sort((a, b) => a.sort_order - b.sort_order)
    const refs = new Set(feed.get(l.external_id).map(String))
    const remove = []
    for (const r of rows) {
      const p = parseImageUrl(r.url)
      if (!p || p.externalId !== l.external_id) {
        plan.skipped.unrecognised.push({ external_id: l.external_id, sort_order: r.sort_order })
        continue
      }
      if (r.source_url && served.get(l.external_id)?.has(r.source_url)) continue
      if (!refs.has(p.mediaId)) remove.push({ r, p })
    }
    if (!remove.length) continue
    if (incomplete.has(l.external_id)) { plan.skipped.mirrorIncomplete.push(l.external_id); continue }
    if (remove.length >= rows.length + (incoming.get(l.external_id) ?? 0)) { plan.skipped.lastPhoto.push(l.external_id); continue }
    for (const { r, p } of remove) {
      plan.removals.push({
        external_id: l.external_id, property_id: l.id, image_id: r.id, media_id: p.mediaId,
        sort_order: r.sort_order, is_primary: r.is_primary === true, path: p.path,
      })
    }
    if (remove.some(x => x.r.is_primary === true)) {
      const gone = new Set(remove.map(x => x.r.id))
      const next = rows.find(r => !gone.has(r.id))
      // next is undefined only in a DRY plan whose whole gallery is replaced by photos not mirrored yet
      plan.reassign.push({ external_id: l.external_id, property_id: l.id, image_id: next?.id ?? null, sort_order: next?.sort_order ?? null })
    }
  }

  plan.objectPaths = deletablePaths(images, plan.removals)

  const cap = Math.max(REMOVAL_FLOOR, Math.floor(REMOVAL_SHARE_MAX * images.length))
  if (plan.removals.length > cap) {
    plan.abort.push(`plan removes ${plan.removals.length} rows, above the cap ${cap} (max(${REMOVAL_FLOOR}, ${REMOVAL_SHARE_MAX * 100}% of ${images.length}))`)
  }
  return plan
}
