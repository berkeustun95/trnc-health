// ─── Döveç images — plan + run, with the I/O injected ────────────────────────
//
// scripts/mirror-dovec-images.mjs wires this to Supabase Storage + PostgREST (CI only);
// scripts/test-dovec-sync.mjs wires it to PGlite + the fixture files, which is how the mock
// sync proves the photo half end to end without touching production.
//
// Same rules as the Novest mirror (mirror-novest-images.mjs), smaller because the feed hands us
// URLs directly instead of WordPress media ids to resolve:
//   • RESUME KEY = (property_id, source_url): a row whose source_url is the partner's URL means done.
//   • UPLOAD THEN INSERT: a crash between the two re-uploads (same deterministic path, upsert) and
//     never duplicates a row.
//   • Paths keyed on the partner's MEDIA ID, never a position:
//       partner/dovec/{external_id}/{media_id}.{ext}
//   • PRIMARY goes to the first image of a unit that has none (property_images_primary_unique).
//   • A project's photo is ONE cover column (property_projects.cover_image_url); a changed cover
//     URL in the feed re-mirrors it. No prune here: removing photos stays a separate, gated act.

export const BUCKET = 'property-images'
export const PREFIX = 'partner/dovec'

// mapped = mapFeed() output; dbProjects [{id, external_id, cover_source_url}];
// dbUnits [{id, external_id}]; haveImages [{property_id, source_url, is_primary}].
export function planImages({ mapped, dbProjects, dbUnits, haveImages }) {
  const projById = new Map(dbProjects.map(p => [p.external_id, p]))
  const unitById = new Map(dbUnits.map(u => [u.external_id, u]))
  const done = new Set(haveImages.map(r => `${r.property_id}|${r.source_url}`))
  const hasPrimary = new Set(haveImages.filter(r => r.is_primary).map(r => r.property_id))

  const covers = []
  for (const p of mapped.projects) {
    const db = projById.get(p.external_id)
    const cover = p.media[0]
    if (!db || !cover) continue
    if (db.cover_source_url === cover.url) continue
    covers.push({ projectId: db.id, externalId: p.external_id, mediaId: cover.mediaId, url: cover.url })
  }

  const unitJobs = []
  for (const u of mapped.units) {
    const db = unitById.get(u.external_id)
    if (!db) continue
    let primaryTaken = hasPrimary.has(db.id)
    u.media.forEach((m, i) => {
      if (done.has(`${db.id}|${m.url}`)) return
      unitJobs.push({ propertyId: db.id, externalId: u.external_id, mediaId: m.mediaId, url: m.url,
                      sortOrder: i, isPrimary: !primaryTaken })
      primaryTaken = true
    })
  }
  return { covers, unitJobs }
}

// io = { fetchImage(url) -> {body, contentType}, optimise(body, ext), upload(path, buffer, contentType) -> publicUrl,
//        insertImage(row), setCover(projectId, publicUrl, sourceUrl) }
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' }

export async function runImages(plan, io) {
  const failed = []
  let mirrored = 0
  const store = async (job) => {
    const { body, contentType } = await io.fetchImage(job.url)
    const srcExt = MIME_EXT[(contentType.split(';')[0] || '').trim()] ?? 'jpg'
    const opt = await io.optimise(body, srcExt)
    const path = `${PREFIX}/${job.externalId}/${job.mediaId}.${opt.ext}`
    return io.upload(path, opt.buffer, opt.contentType ?? contentType)
  }
  for (const c of plan.covers) {
    try { await io.setCover(c.projectId, await store(c), c.url); mirrored++ }
    catch (e) { failed.push(`${c.externalId}/${c.mediaId}: ${e.message}`) }
  }
  for (const j of plan.unitJobs) {
    try {
      const url = await store(j)
      await io.insertImage({ property_id: j.propertyId, url, source_url: j.url, sort_order: j.sortOrder, is_primary: j.isPrimary })
      mirrored++
    } catch (e) { failed.push(`${j.externalId}/${j.mediaId}: ${e.message}`) }
  }
  return { mirrored, failed }
}
