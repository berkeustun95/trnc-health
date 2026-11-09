// The approve / reject decision, free of remote imports so `deno test` runs it offline (index.ts wires the real
// Supabase client in). Every outcome is a code; nothing about the seller, the listing or the path is logged.
import { stripImageMetadata, metadataFound, FORMAT_EXT, FORMAT_MIME } from '../_shared/image-metadata.mjs'
import { displaySize } from '../_shared/image-size.mjs'

export const REJECT_REASONS = ['not_item', 'inappropriate', 'prohibited', 'contact_info', 'low_quality', 'other'] as const
export type Reason = typeof REJECT_REASONS[number]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
// One notice per seller per burst: an admin rejecting three photos of one listing sends one, not three.
export const NOTICE_GAP_MS = 10 * 60_000

export interface Photo { id: string; listing_id: string; owner_id: string; status: string; storage_path: string }
export interface Deps {
  // the reviewer: null = not signed in (or a guest); throws { status: 503 } on an auth outage
  reviewer(jwt: string): Promise<{ id: string; isAdmin: boolean } | null>
  photo(id: string): Promise<Photo | null>
  // the pending object, resized server-side to fit 1600×1600 (Storage image transformation), original format
  transformed(path: string): Promise<Uint8Array>
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>
  remove(paths: string[]): Promise<void>
  // conditional on status = 'pending'; false = someone else got there first (or the seller deleted it)
  settle(id: string, fields: Record<string, unknown>): Promise<boolean>
  seller(ownerId: string, listingId: string): Promise<{ lang: string; token: string | null; title: string; noticedAt: number | null }>
  notify(row: { user_id: string; title: string; body: string }): Promise<void>
  push(message: Record<string, unknown>): Promise<void>
  now(): number
  log(code: string): void
}
export type Result = { status: number; body: Record<string, unknown> }
const out = (status: number, body: Record<string, unknown>): Result => ({ status, body })

export async function handle(jwt: string, input: unknown, d: Deps): Promise<Result> {
  let who
  try { who = await d.reviewer(jwt) } catch { d.log('auth_unavailable'); return out(503, { error: 'AUTH_UNAVAILABLE' }) }
  if (!who) return out(401, { error: 'NOT_SIGNED_IN' })
  if (!who.isAdmin) return out(403, { error: 'NOT_ADMIN' })

  const { photo_id, action, reason } = (input ?? {}) as Record<string, unknown>
  if (typeof photo_id !== 'string' || !UUID.test(photo_id) || (action !== 'approve' && action !== 'reject')) {
    return out(400, { error: 'BAD_REQUEST' })
  }
  if (action === 'reject' && !REJECT_REASONS.includes(reason as Reason)) return out(400, { error: 'BAD_REASON' })

  const p = await d.photo(photo_id)
  if (!p) return out(404, { error: 'NO_SUCH_PHOTO' })
  if (p.status !== 'pending' || !p.storage_path.startsWith('pending/')) return out(409, { error: 'ALREADY_REVIEWED' })
  const reviewed = { reviewed_by: who.id, reviewed_at: new Date(d.now()).toISOString(), review_source: 'admin' }

  return action === 'approve' ? approve(p, reviewed, d) : reject(p, reason as Reason, reviewed, d)
}

async function approve(p: Photo, reviewed: Record<string, unknown>, d: Deps): Promise<Result> {
  let src: Uint8Array
  try { src = await d.transformed(p.storage_path) } catch { d.log('transform_failed'); return out(502, { error: 'TRANSFORM_FAILED' }) }

  // The transform drops GPS but keeps a small Exif block and IPTC (measured 2026-11-09), so the byte-level
  // stripper still runs, and its output is re-scanned: a photo that cannot be proven clean is never published.
  let clean: { format: string; bytes: Uint8Array; orientation: number }
  let size: { width: number; height: number }
  try {
    clean = stripImageMetadata(src)
    size = displaySize(clean.bytes, clean.orientation)
  } catch (e) {
    d.log('strip_' + ((e as Error).message === 'UNSUPPORTED_FORMAT' ? 'unsupported' : 'corrupt'))
    return out(422, { error: 'CORRUPT' })
  }
  const left = metadataFound(clean.bytes)
  if (left.found.length || left.gps) { d.log('strip_left_metadata'); return out(422, { error: 'CORRUPT' }) }

  // Deterministic per photo, so a retry after a half-finished approve overwrites instead of leaving a twin.
  const path = `approved/${p.owner_id}/${p.listing_id}/${p.id}.${(FORMAT_EXT as Record<string, string>)[clean.format]}`
  try { await d.upload(path, clean.bytes, (FORMAT_MIME as Record<string, string>)[clean.format]) }
  catch { d.log('upload_failed'); return out(500, { error: 'STORE_FAILED' }) }

  const ok = await d.settle(p.id, { status: 'approved', storage_path: path, width: size.width, height: size.height, ...reviewed })
  if (!ok) {
    await d.remove([path]).catch(() => d.log('cleanup_failed'))
    return out(409, { error: 'ALREADY_REVIEWED' })
  }
  // A failed removal leaves only a private, unreferenced original: the nightly sweep (20261185) takes it.
  await d.remove([p.storage_path]).catch(() => d.log('pending_remove_failed'))
  return out(200, { status: 'approved', width: size.width, height: size.height })
}

async function reject(p: Photo, reason: Reason, reviewed: Record<string, unknown>, d: Deps): Promise<Result> {
  const ok = await d.settle(p.id, { status: 'rejected', reject_reason: reason, ...reviewed })
  if (!ok) return out(409, { error: 'ALREADY_REVIEWED' })
  await d.remove([p.storage_path]).catch(() => d.log('pending_remove_failed'))

  // The decision stands even if the notice fails: the seller also sees the reason on the listing.
  try {
    const s = await d.seller(p.owner_id, p.listing_id)
    if (s.noticedAt == null || d.now() - s.noticedAt >= NOTICE_GAP_MS) {
      const text = rejectText(s.lang, s.title)
      await d.notify({ user_id: p.owner_id, ...text })
      if (s.token) await d.push({ to: s.token, title: text.title, body: text.body, sound: 'default',
                                  data: { screen: 'marketplace', listing_id: p.listing_id } })
    }
  } catch { d.log('notice_failed') }
  return out(200, { status: 'rejected' })
}

// profiles.preferred_language → text. English fallback, as module_notif_text (20261167). Pending the slice 6
// translation review with the other mk* strings.
const BODY: Record<string, string> = {
  English: 'A photo on “{t}” wasn\'t published. Open your listing to see why.',
  Turkish: '“{t}” ilanındaki bir fotoğraf yayınlanmadı. Nedenini görmek için ilanını aç.',
  Arabic: 'لم تُنشر إحدى صور «{t}». افتح إعلانك لمعرفة السبب.',
  Russian: 'Одно из фото в «{t}» не опубликовано. Откройте объявление, чтобы узнать причину.',
  Greek: 'Μια φωτογραφία στην αγγελία «{t}» δεν δημοσιεύτηκε. Άνοιξε την αγγελία σου για να δεις γιατί.',
  French: 'Une photo de « {t} » n\'a pas été publiée. Ouvrez votre annonce pour voir pourquoi.',
  Spanish: 'Una foto de «{t}» no se ha publicado. Abre tu anuncio para ver el motivo.',
  German: 'Ein Foto in „{t}“ wurde nicht veröffentlicht. Öffne deine Anzeige, um den Grund zu sehen.',
  Persian: 'یکی از عکس‌های «{t}» منتشر نشد. آگهی‌ات را باز کن تا دلیلش را ببینی.',
}
export function rejectText(lang: string, listingTitle: string) {
  const t = listingTitle.length > 40 ? listingTitle.slice(0, 39).trimEnd() + '…' : listingTitle
  return { title: 'Bandabuliya', body: (BODY[lang] ?? BODY.English).replace('{t}', t) }
}
