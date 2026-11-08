// vehicle-photo — the ONLY way a car photo gets into the vehicle-images bucket from the app.
//
//   POST  body: the image bytes (JPEG / PNG / WebP, ≤ 5 MB)
//         headers: Authorization: Bearer <user JWT>, x-vehicle-id: <listing uuid>, x-sort-order: 0–7, x-primary: 1 | 0
//   → 200 { id, path }   | 4xx/5xx { error: CODE }
//
// Why a function: every photo must lose its location data (all Exif / XMP) BEFORE it is stored (Berke, 2026-11-08, a
// go-live gate). A phone cannot be trusted to do that, so 20261182 removed the client upload policy on the bucket and
// this function, holding the service key, is the one writer. It strips with ../_shared/image-metadata.mjs (byte level,
// no re-encode), checks the result is clean, and refuses anything it cannot prove clean.
//
// Who may add a photo is unchanged from 20261165: the signed-in, non-guest OWNER of a PRIVATE listing that is PENDING
// (review is what stops a photo swap after approval). The owner check reads owner_id with the service key; the
// vehicle_images row is then inserted with the CALLER's JWT, so its RLS policy (pending + path shape) and the 8-photo
// guard still apply exactly as before. A refused row removes the file again.
//
// verify_jwt = true. Nothing about the caller or the listing is logged; failures log a code only.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { stripImageMetadata, metadataFound, FORMAT_EXT, FORMAT_MIME } from '../_shared/image-metadata.mjs'

const BUCKET = 'vehicle-images'
const MAX_BYTES = 5 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SB_URL = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const admin = createClient(SB_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

Deno.serve(async req => {
  if (req.method !== 'POST') return json(405, { error: 'METHOD' })
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: { user } = { user: null }, error: authErr } = await admin.auth.getUser(jwt)
  if (authErr || !user || user.is_anonymous === true) return json(401, { error: 'NOT_SIGNED_IN' })

  const vehicleId = (req.headers.get('x-vehicle-id') ?? '').toLowerCase()
  const sortOrder = Number(req.headers.get('x-sort-order') ?? '0')
  const primary = req.headers.get('x-primary') === '1'
  if (!UUID.test(vehicleId) || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 7) return json(400, { error: 'BAD_REQUEST' })

  const { data: v, error: vErr } = await admin.from('vehicles').select('owner_id, source, status').eq('id', vehicleId).maybeSingle()
  if (vErr) { console.error('vehicle-photo: read', vErr.code); return json(500, { error: 'STORE_FAILED' }) }
  if (!v || v.owner_id !== user.id || v.source !== 'private') return json(403, { error: 'NOT_YOURS' })
  if (v.status !== 'pending') return json(409, { error: 'VEHICLE_STATUS' })

  const raw = new Uint8Array(await req.arrayBuffer())
  if (raw.length === 0) return json(400, { error: 'BAD_REQUEST' })
  if (raw.length > MAX_BYTES) return json(413, { error: 'TOO_LARGE' })

  let clean: { format: string; bytes: Uint8Array }
  try { clean = stripImageMetadata(raw) } catch (e) {
    const code = (e as Error).message === 'UNSUPPORTED_FORMAT' ? 'UNSUPPORTED_FORMAT' : 'CORRUPT'
    return json(code === 'UNSUPPORTED_FORMAT' ? 415 : 422, { error: code })
  }
  // Proof, not trust: the stored bytes are re-scanned, and anything still carrying metadata is refused.
  const left = metadataFound(clean.bytes)
  if (left.found.length || left.gps) { console.error('vehicle-photo: strip left', left.found.join(',')); return json(422, { error: 'CORRUPT' }) }

  const path = `${vehicleId}/${crypto.randomUUID()}.${(FORMAT_EXT as Record<string, string>)[clean.format]}`
  const { error: upErr } = await admin.storage.from(BUCKET)
    .upload(path, clean.bytes, { contentType: (FORMAT_MIME as Record<string, string>)[clean.format], upsert: false, cacheControl: '31536000' })
  if (upErr) { console.error('vehicle-photo: upload', upErr.name); return json(500, { error: 'STORE_FAILED' }) }

  const asCaller = createClient(SB_URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
  const { data: row, error: rowErr } = await asCaller.from('vehicle_images')
    .insert({ vehicle_id: vehicleId, storage_path: path, sort_order: sortOrder, is_primary: primary }).select('id').single()
  if (rowErr || !row) {
    await admin.storage.from(BUCKET).remove([path])
    const limit = String(rowErr?.message ?? '').includes('VEHICLE_PHOTO_LIMIT')
    return json(limit ? 409 : 403, { error: limit ? 'VEHICLE_PHOTO_LIMIT' : 'VEHICLE_STATUS' })
  }
  return json(200, { id: row.id, path })
})
