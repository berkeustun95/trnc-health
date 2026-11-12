// marketplace-photo-review's decision logic (supabase/functions/marketplace-photo-review/review.ts) with fake
// Supabase deps and REAL images written by sharp, node only (Node 24 strips the .ts types):
//   node scripts/test-marketplace-photo-review.mjs
// What a pass is evidence of: who may review, what is stored, what the row is settled to, what is removed, when the
// seller is told — given the bytes the transform returns. NOT the transform itself (the Storage image transformation
// runs only on Supabase: its resize, rotation and GPS removal are proven at the first deploy's smoke test), not the
// Storage API, not PostgREST. The fake transform here returns the original, i.e. the worst case: every byte of
// metadata a phone writes reaches the stripper.
import sharp from 'sharp'
import { handle, rejectText, NOTICE_GAP_MS } from '../supabase/functions/marketplace-photo-review/review.ts'
import { metadataFound } from '../supabase/functions/_shared/image-metadata.mjs'

const GPS = { IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '35/1 20/1 1234/100', GPSLongitudeRef: 'E', GPSLongitude: '33/1 19/1 4321/100' } }
const EXIF = { IFD0: { Make: 'Apple', Model: 'iPhone 15', Software: 'ADA-test' }, ...GPS }
const phone = (fmt, orientation = 1) => {
  let s = sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r: 30, g: 140, b: 90 } } })
    .withExif(EXIF)
  if (orientation !== 1) s = s.withMetadata({ orientation })
  return s[fmt]().toBuffer().then(b => new Uint8Array(b))
}

const IDS = { admin: 'ad000000-0000-4000-8000-000000000001', user: 'b0000000-0000-4000-8000-00000000000b',
  owner: 'a0000000-0000-4000-8000-00000000000a', listing: 'e0000000-0000-4000-8000-000000000001', photo: 'f0000000-0000-4000-8000-000000000001' }
const PENDING = `pending/${IDS.owner}/${IDS.listing}/1731000000000-0.jpg`

function rig(o = {}) {
  const calls = { uploads: [], removed: [], settled: [], notices: [], attempts: [], pushes: [], logs: [] }
  const photo = o.photo === null ? null : { id: IDS.photo, listing_id: IDS.listing, owner_id: IDS.owner, status: 'pending', storage_path: PENDING, ...o.photo }
  const deps = {
    reviewer: async jwt => {
      if (o.authDown) throw { status: 503 }
      return jwt === 'admin' ? { id: IDS.admin, isAdmin: true } : jwt === 'user' ? { id: IDS.user, isAdmin: false } : null
    },
    photo: async () => photo,
    transformed: async () => { if (o.transformFails) throw new Error('x'); return o.bytes },
    upload: async (path, bytes, type) => { if (o.uploadFails) throw new Error('x'); calls.uploads.push({ path, bytes, type }) },
    remove: async paths => { calls.removed.push(...paths) },
    settle: async (id, f) => { if (o.lostRace) return false; calls.settled.push(f); return true },
    seller: async () => ({ lang: o.lang ?? 'Turkish', token: o.token === undefined ? 'ExponentPushToken[x]' : o.token, title: 'Bisiklet satılık',
                           noticedAt: o.noticedAgoMs == null ? null : 1_000_000 - o.noticedAgoMs }),
    notify: async row => {
      calls.attempts.push(row)
      if (o.notifyFails || (o.notifyFailsWithListing && 'listing_id' in row)) throw new Error('x')
      calls.notices.push(row)
    },
    push: async m => { calls.pushes.push(m) },
    now: () => 1_000_000,
    log: c => calls.logs.push(c),
  }
  return { deps, calls }
}
const body = (action, extra = {}) => ({ photo_id: IDS.photo, action, ...extra })

let failed = 0
const check = (name, ok, got) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  got: ' + JSON.stringify(got)}`) }

const jpg = await phone('jpeg'), jpg6 = await phone('jpeg', 6), png = await phone('png'), webp = await phone('webp')
check('fixtures really carry GPS (red first)', [jpg, jpg6, png, webp].every(b => metadataFound(b).gps), [jpg, png, webp].map(b => metadataFound(b)))

const CASES = [
  // ── who ──
  ['no session → 401', async () => (await handle('', body('approve'), rig({ bytes: jpg }).deps)).status === 401],
  ['signed-in non-admin → 403, nothing touched', async () => {
    const { deps, calls } = rig({ bytes: jpg })
    const r = await handle('user', body('approve'), deps)
    return r.status === 403 && !calls.uploads.length && !calls.settled.length && !calls.removed.length
  }],
  ['auth outage → 503, not 401', async () => (await handle('admin', body('approve'), rig({ authDown: true }).deps)).status === 503],
  // ── input ──
  ['bad photo id / action → 400', async () => {
    const { deps } = rig({ bytes: jpg })
    return (await handle('admin', { photo_id: 'x', action: 'approve' }, deps)).status === 400
      && (await handle('admin', body('delete'), deps)).status === 400
  }],
  ['reject without a listed reason → 400 BAD_REASON', async () =>
    (await handle('admin', body('reject', { reason: 'ugly' }), rig().deps)).body.error === 'BAD_REASON'],
  ['unknown photo → 404; already reviewed → 409', async () =>
    (await handle('admin', body('approve'), rig({ photo: null }).deps)).status === 404
    && (await handle('admin', body('approve'), rig({ photo: { status: 'approved' } }).deps)).status === 409],

  // ── approve ──
  ...[['jpeg', () => jpg, 'jpg', 'image/jpeg'], ['png', () => png, 'png', 'image/png'], ['webp', () => webp, 'webp', 'image/webp']]
    .map(([fmt, bytes, ext, mime]) => [`approve ${fmt}: stored clean (no GPS, no Exif) at approved/<owner>/<listing>/<photo>.${ext}, row settled, original removed`, async () => {
      const { deps, calls } = rig({ bytes: bytes() })
      const r = await handle('admin', body('approve'), deps)
      const up = calls.uploads[0], m = up && metadataFound(up.bytes), s = calls.settled[0]
      return r.status === 200 && up.path === `approved/${IDS.owner}/${IDS.listing}/${IDS.photo}.${ext}` && up.type === mime
        && m.found.length === 0 && !m.gps
        && s.status === 'approved' && s.storage_path === up.path && s.width === 1600 && s.height === 1200
        && s.reviewed_by === IDS.admin && s.review_source === 'admin'
        && calls.removed.length === 1 && calls.removed[0] === PENDING
    }]),
  ['approve, orientation 6: the tag is kept (so it shows upright) and width/height are the DISPLAYED ones', async () => {
    const { deps, calls } = rig({ bytes: jpg6 })
    const r = await handle('admin', body('approve'), deps)
    const meta = await sharp(Buffer.from(calls.uploads[0].bytes)).metadata()
    return r.status === 200 && meta.orientation === 6 && calls.settled[0].width === 1200 && calls.settled[0].height === 1600
      && metadataFound(calls.uploads[0].bytes).found.length === 0
  }],
  ['approve, transform fails → 502, nothing stored, row untouched', async () => {
    const { deps, calls } = rig({ transformFails: true })
    const r = await handle('admin', body('approve'), deps)
    return r.status === 502 && !calls.uploads.length && !calls.settled.length && !calls.removed.length
  }],
  ['approve, not an image → 422, nothing stored', async () => {
    const { deps, calls } = rig({ bytes: new TextEncoder().encode('<html>not a photo</html>') })
    const r = await handle('admin', body('approve'), deps)
    return r.status === 422 && !calls.uploads.length && !calls.settled.length
  }],
  ['approve, upload fails → 500, row untouched, original kept', async () => {
    const { deps, calls } = rig({ bytes: jpg, uploadFails: true })
    const r = await handle('admin', body('approve'), deps)
    return r.status === 500 && !calls.settled.length && !calls.removed.length
  }],
  ['approve loses the race (row no longer pending) → 409 and the new file is removed, original kept', async () => {
    const { deps, calls } = rig({ bytes: jpg, lostRace: true })
    const r = await handle('admin', body('approve'), deps)
    return r.status === 409 && calls.removed.length === 1 && calls.removed[0].startsWith('approved/')
  }],

  // ── reject ──
  ['reject: row settled with the reason, original removed, one notice + push opening the listing', async () => {
    const { deps, calls } = rig()
    const r = await handle('admin', body('reject', { reason: 'contact_info' }), deps)
    const s = calls.settled[0], p = calls.pushes[0]
    return r.status === 200 && s.status === 'rejected' && s.reject_reason === 'contact_info' && s.reviewed_by === IDS.admin
      && calls.removed[0] === PENDING && calls.notices.length === 1 && calls.notices[0].user_id === IDS.owner
      && calls.notices[0].body.includes('Bisiklet satılık') && p.data.screen === 'marketplace' && p.data.listing_id === IDS.listing
      && !calls.uploads.length
  }],
  ['reject: a second rejection within 10 minutes does not notify again; after 10 minutes it does', async () => {
    const a = rig({ noticedAgoMs: NOTICE_GAP_MS - 1 }), b = rig({ noticedAgoMs: NOTICE_GAP_MS })
    await handle('admin', body('reject', { reason: 'other' }), a.deps)
    await handle('admin', body('reject', { reason: 'other' }), b.deps)
    return a.calls.notices.length === 0 && a.calls.settled.length === 1 && b.calls.notices.length === 1
  }],
  ['reject: no push token → in-app notice only', async () => {
    const { deps, calls } = rig({ token: null })
    await handle('admin', body('reject', { reason: 'other' }), deps)
    return calls.notices.length === 1 && calls.pushes.length === 0
  }],
  ['reject: a failing notice does not undo the decision (200, logged as a code)', async () => {
    const { deps, calls } = rig({ notifyFails: true })
    const r = await handle('admin', body('reject', { reason: 'other' }), deps)
    return r.status === 200 && calls.settled.length === 1 && calls.logs.includes('notice_failed')
  }],
  // ── 20261192: the notice carries the listing; a DB that cannot take the column must not cost the notice or the push ──
  ['reject: the notice row carries listing_id = the photo\'s listing; push payload unchanged', async () => {
    const { deps, calls } = rig()
    await handle('admin', body('reject', { reason: 'other' }), deps)
    const m = calls.pushes[0]
    return calls.attempts.length === 1 && calls.notices[0].listing_id === IDS.listing && calls.notices[0].user_id === IDS.owner
      && Object.keys(m).sort().join() === 'body,data,sound,title,to' && JSON.stringify(m.data) === JSON.stringify({ screen: 'marketplace', listing_id: IDS.listing })
      && !calls.logs.length
  }],
  ['reject: insert with listing_id fails → retried ONCE without it, notice stored, push still sent, code logged', async () => {
    const { deps, calls } = rig({ notifyFailsWithListing: true })
    const r = await handle('admin', body('reject', { reason: 'other' }), deps)
    return r.status === 200 && calls.attempts.length === 2 && 'listing_id' in calls.attempts[0] && !('listing_id' in calls.attempts[1])
      && calls.notices.length === 1 && calls.notices[0].user_id === IDS.owner && calls.pushes.length === 1
      && calls.logs.join() === 'notice_listing_id_dropped'
  }],
  ['reject: both inserts fail → still 200, decision kept, no push, exactly two attempts, only notice_failed logged', async () => {
    const { deps, calls } = rig({ notifyFails: true })
    const r = await handle('admin', body('reject', { reason: 'other' }), deps)
    return r.status === 200 && r.body.status === 'rejected' && calls.settled.length === 1 && calls.attempts.length === 2
      && !calls.notices.length && !calls.pushes.length && calls.logs.join() === 'notice_failed'
  }],
  ['reject within the 10-minute gap: no insert attempt at all (throttle unchanged)', async () => {
    const { deps, calls } = rig({ noticedAgoMs: NOTICE_GAP_MS - 1 })
    await handle('admin', body('reject', { reason: 'other' }), deps)
    return calls.attempts.length === 0 && !calls.pushes.length
  }],
  ['approve: never writes a notice', async () => {
    const { deps, calls } = rig({ bytes: jpg })
    const r = await handle('admin', body('approve'), deps)
    return r.status === 200 && calls.attempts.length === 0 && !calls.pushes.length
  }],
  ['reject loses the race → 409, nothing removed, nobody told', async () => {
    const { deps, calls } = rig({ lostRace: true })
    const r = await handle('admin', body('reject', { reason: 'other' }), deps)
    return r.status === 409 && !calls.removed.length && !calls.notices.length
  }],

  // ── text ──
  ['notice text: the seller\'s language, English fallback, long titles shortened', async () => {
    const tr = rejectText('Turkish', 'Bisiklet'), xx = rejectText('Klingon', 'Bike'), long = rejectText('English', 'x'.repeat(80))
    return tr.title === 'Bandabuliya' && tr.body.startsWith('“Bisiklet” ilanındaki') && xx.body.startsWith('A photo on “Bike”')
      && long.body.includes('x'.repeat(39) + '…') && !long.body.includes('x'.repeat(41))
  }],
  ['logs carry codes only: no ids, no paths', async () => {
    const { deps, calls } = rig({ uploadFails: true, bytes: jpg })
    await handle('admin', body('approve'), deps)
    return calls.logs.length > 0 && calls.logs.every(c => /^[a-z_]+$/.test(c))
  }],
]

for (const [name, fn] of CASES) {
  let ok = false, got
  try { ok = await fn() } catch (e) { got = e.message }
  check(name, ok, got)
}
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
