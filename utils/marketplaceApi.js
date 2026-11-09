import { supabase } from '../lib/supabase'
import { MODULE_FLAGS } from '../constants/flags'
import { MARKETPLACE } from '../constants/redesign'
import { MK_BUCKET, MK_LISTING_COLUMNS, MK_SIGNED_URL_TTL, MK_NOTICE_VERSION } from '../constants/marketplace'
import { notifyAdmins } from './notify'

// Bandabuliya data access. Every read goes through RLS (20261183): browse sees only visible listings and
// approved photos; the seller sees their own in every state.
//
// ─── Preview fixture ────────────────────────────────────────────────────────
// Before 20261183 is applied the tables do not exist. In dev / ADA Preview (MARKETPLACE on, flag off)
// a "relation does not exist" answer switches this module to an in-memory store so the screens can be
// walked on a phone; the first successful query after the apply switches it back for good. Production
// never gets here: with MODULE_FLAGS.marketplace false the screens are unreachable, and with it true
// FIXTURE_ALLOWED is false.
const FIXTURE_ALLOWED = MARKETPLACE && !MODULE_FLAGS.marketplace
let fixture = null
const MISSING = e => e && (e.code === 'PGRST205' || e.code === '42P01' || e.code === 'PGRST202' || /does not exist|schema cache/i.test(e.message || ''))
export const usingFixture = () => fixture !== null

function useFixtureOr(error) {
  if (FIXTURE_ALLOWED && MISSING(error)) { fixture = fixture || seedFixture(); return true }
  return false
}

const PAGE = 30
const likeEscape = q => q.replace(/[\\%_]/g, c => '\\' + c)

export async function listListings({ category, district, query, from = 0 } = {}) {
  if (fixture) return fxList({ category, district, query, from })
  let q = supabase.from('marketplace_listings').select(MK_LISTING_COLUMNS)
    .eq('status', 'active')
    .order('bumped_at', { ascending: false }).order('id', { ascending: false })
    .range(from, from + PAGE - 1)
  if (category) q = q.eq('category', category)
  if (district) q = q.eq('district', district)
  if (query?.trim()) q = q.ilike('title', `%${likeEscape(query.trim())}%`)
  const { data, error } = await q
  if (error) { if (useFixtureOr(error)) return fxList({ category, district, query, from }); throw error }
  return { rows: data, more: data.length === PAGE }
}

export async function getListing(id) {
  // As the read policy: a hidden listing is the seller's alone.
  if (fixture) return fixture.listings.find(l => l.id === id && !l.deleted_at && (!l.hidden_at || l.owner_id === fixture.me)) || null
  const { data, error } = await supabase.from('marketplace_listings').select(MK_LISTING_COLUMNS).eq('id', id).maybeSingle()
  if (error) { if (useFixtureOr(error)) return getListing(id); throw error }
  return data
}

export async function myListings(uid) {
  if (fixture) return fixture.listings.filter(l => l.owner_id === uid && !l.deleted_at).sort(byNewest)
  const { data, error } = await supabase.from('marketplace_listings').select(MK_LISTING_COLUMNS)
    .eq('owner_id', uid).order('created_at', { ascending: false })
  if (error) { if (useFixtureOr(error)) return myListings(uid); throw error }
  return data
}

// Profiles are owner-read only; the username comes through marketplace_seller_names (20261183), which
// answers only for listings the caller can see.
export async function sellerName(listing) {
  if (fixture) return fixture.names[listing.owner_id] || null
  const { data, error } = await supabase.rpc('marketplace_seller_names', { p_listing_ids: [listing.id] })
  if (error) return null
  return data?.[0]?.display_name || null
}

// Photos per listing, position order. RLS decides: others get approved rows only.
export async function photosFor(listingIds) {
  const out = Object.fromEntries(listingIds.map(id => [id, []]))
  if (!listingIds.length) return out
  if (fixture) {
    fixture.photos.filter(p => out[p.listing_id]).sort((a, b) => a.position - b.position).forEach(p => out[p.listing_id].push(p))
    return out
  }
  const { data, error } = await supabase.from('marketplace_photos')
    .select('id, listing_id, position, status, storage_path, reject_reason')
    .in('listing_id', listingIds).order('position')
  if (error) { if (useFixtureOr(error)) return photosFor(listingIds); throw error }
  data.forEach(p => out[p.listing_id]?.push(p))
  return out
}

// One request per screen: path → signed URL (private bucket; nothing in it has a public URL).
const urlCache = new Map()
export async function signedUrls(paths) {
  const now = Date.now()
  const need = [...new Set(paths)].filter(p => !(urlCache.get(p)?.until > now))
  if (need.length && !fixture) {
    const { data, error } = await supabase.storage.from(MK_BUCKET).createSignedUrls(need, MK_SIGNED_URL_TTL)
    if (!error) data.forEach(d => d.signedUrl && urlCache.set(d.path, { url: d.signedUrl, until: now + (MK_SIGNED_URL_TTL - 120) * 1000 }))
  }
  if (fixture) need.forEach(p => urlCache.set(p, { url: fixture.localUri[p] || null, until: now + 3600e3 }))
  return Object.fromEntries(paths.map(p => [p, urlCache.get(p)?.url || null]))
}

const ITEM_FIELDS = ['title', 'description', 'price_tl', 'is_free', 'category', 'condition', 'district']
const pick = f => Object.fromEntries(ITEM_FIELDS.map(k => [k, f[k]]))

export async function createListing(fields) {
  if (fixture) return fxCreate(fields)
  const { data, error } = await supabase.from('marketplace_listings').insert(pick(fields)).select('id').single()
  if (error) { if (useFixtureOr(error)) return fxCreate(fields); throw error }
  return data.id
}

export async function updateListing(id, fields) {
  if (fixture) { Object.assign(fixture.listings.find(l => l.id === id), pick(fields)); return }
  const { error } = await supabase.from('marketplace_listings').update(pick(fields)).eq('id', id)
  if (error) throw error
}

export async function setSold(id, sold) {
  const status = sold ? 'sold' : 'active'
  if (fixture) { Object.assign(fixture.listings.find(l => l.id === id), { status, sold_at: sold ? new Date().toISOString() : null }); return }
  const { error } = await supabase.from('marketplace_listings').update({ status }).eq('id', id)
  if (error) throw error
}

export async function deleteListing(id) {
  if (fixture) { fixture.listings.find(l => l.id === id).deleted_at = new Date().toISOString(); return }
  const { error } = await supabase.rpc('delete_marketplace_listing', { p_listing_id: id })
  if (error) throw error
}

export async function renewListing(id) {
  if (fixture) {
    const l = fixture.listings.find(x => x.id === id)
    l.expires_at = new Date(Date.now() + 30 * 86400e3).toISOString(); l.bumped_at = new Date().toISOString()
    return l.expires_at
  }
  const { data, error } = await supabase.rpc('renew_marketplace_listing', { p_listing_id: id })
  if (error) throw error
  return data
}

// Upload one picked photo to pending/<uid>/<listing>/<file>, then its row. File name: a timestamp and the
// slot, not crypto.randomUUID (unreliable on Hermes, ExploreSubmitScreen). Row insert failing after the
// upload leaves an orphan object; marketplace-maintenance sweeps objects with no row (20261185).
export async function uploadPhoto({ uid, listingId, asset, position }) {
  const type = (asset.mimeType || '').toLowerCase()
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg'
  const path = `pending/${uid}/${listingId}/${Date.now()}-${position}.${ext}`
  if (fixture) {
    fixture.localUri[path] = asset.uri
    fixture.photos.push({ id: `fx-p-${fixture.seq++}`, listing_id: listingId, position, status: 'pending', storage_path: path, reject_reason: null })
    return
  }
  const contentType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
  const { error: upErr } = await supabase.storage.from(MK_BUCKET).upload(path, decode(asset.base64), { contentType, upsert: false })
  if (upErr) throw upErr
  const { error } = await supabase.from('marketplace_photos').insert({ listing_id: listingId, position, storage_path: path })
  if (error) throw error
}

export async function removePhoto(photoId) {
  if (fixture) { fixture.photos = fixture.photos.filter(p => p.id !== photoId); return }
  const { error } = await supabase.from('marketplace_photos').delete().eq('id', photoId)
  if (error) throw error
}

// ─── Chat (20261184), for ConversationScreen / ConversationsScreen (utils/chatApi.js shape) ─────────────
// Only three calls differ from Student Hub: the inbox asks for kind 'listing', a buyer starts a thread from a
// listing, and send_message routes listing threads to send_listing_message itself. On the Preview sample data the
// seller accepts and answers a few seconds after the first message, so the whole flow can be walked on one phone.
const ok = data => ({ data, error: null })
const fail = code => ({ data: null, error: { message: code } })
export const MARKETPLACE_CHAT = {
  async list() {
    if (fixture) return ok(fxThreads())
    const r = await supabase.rpc('list_conversations', { p_kind: 'listing' })
    if (r.error && useFixtureOr(r.error)) return ok(fxThreads())
    return r
  },
  async messages(conversationId) {
    if (fixture) return ok([...(fixture.messages[conversationId] || [])])
    return supabase.from('messages').select('id, sender_id, sender_display_name, body, created_at')
      .eq('conversation_id', conversationId).order('created_at', { ascending: true })
  },
  async start(other, body) {
    if (fixture) return fxStart(other, body)
    const r = await supabase.rpc('start_listing_conversation', { p_listing_id: other.listingId, p_body: body })
    if (r.error && useFixtureOr(r.error)) return fxStart(other, body)
    return r
  },
  async send(conversationId, body) {
    if (fixture) return fxSend(conversationId, body)
    return supabase.rpc('send_message', { p_conversation_id: conversationId, p_body: body })
  },
  async act(rpc, args) {
    if (fixture) return fxAct(rpc, args)
    return supabase.rpc(rpc, args)
  },
}

// The notice is per user and versioned; the server refuses a listing message without it (NOTICE_REQUIRED).
export async function noticeAccepted(uid) {
  if (fixture) return fixture.noticeVersion === MK_NOTICE_VERSION
  const { data, error } = await supabase.from('profiles').select('marketplace_notice_version').eq('id', uid).maybeSingle()
  if (error) { if (useFixtureOr(error)) return noticeAccepted(uid); throw error }
  return data?.marketplace_notice_version === MK_NOTICE_VERSION
}
export async function acceptNotice() {
  if (fixture) { fixture.noticeVersion = MK_NOTICE_VERSION; return }
  const { error } = await supabase.rpc('accept_marketplace_notice', { p_version: MK_NOTICE_VERSION })
  if (error) { if (useFixtureOr(error)) { fixture.noticeVersion = MK_NOTICE_VERSION; return } throw error }
}

// ContentReportMenu's submitReport for a listing. One report hides it (20261183's auto-hide); the sample data does
// the same so the "gone" state after a report can be walked.
export async function reportListing(row) {
  if (fixture) { const l = fixture.listings.find(x => x.id === row.content_id); if (l) l.hidden_at = new Date().toISOString(); return { error: null } }
  const { error } = await supabase.from('content_reports').insert(row)
  if (!error) notifyAdmins('content_report', row.content_id)
  return { error }
}

function fxThreads() {
  return fixture.threads.filter(c => !c.hidden).map(c => {
    const l = fixture.listings.find(x => x.id === c.listing_id)
    const msgs = fixture.messages[c.conversation_id] || []
    const last = msgs[msgs.length - 1]
    return { ...c, last_message_at: last?.created_at ?? c.created_at, last_body: last?.body ?? null,
      listing_title: l?.title ?? null, listing_status: l?.status ?? null,
      listing_available: !!l && l.status === 'active' && !l.deleted_at && !l.hidden_at }
  }).sort((a, b) => (a.last_message_at < b.last_message_at ? 1 : -1))
}
function fxMessage(cid, senderId, name, body) {
  const m = { id: `fx-m-${fixture.seq++}`, sender_id: senderId, sender_display_name: name, body, created_at: new Date().toISOString() }
  ;(fixture.messages[cid] ||= []).push(m)
  return m
}
function fxStart(other, body) {
  if (fixture.noticeVersion !== MK_NOTICE_VERSION) return fail('NOTICE_REQUIRED')
  const l = fixture.listings.find(x => x.id === other.listingId)
  if (!l || l.status !== 'active' || l.deleted_at || l.hidden_at) return fail('NO_SUCH_LISTING')
  if (l.owner_id === fixture.me) return fail('OWN_LISTING')
  if (fixture.threads.some(c => c.listing_id === l.id && c.other_user_id === l.owner_id && !c.is_closed)) return fail('CONVERSATION_EXISTS')
  const cid = `fx-c-${fixture.seq++}`
  fixture.threads.push({ conversation_id: cid, other_user_id: l.owner_id, display_name: fixture.names[l.owner_id], avatar_url: null,
    is_accepted: false, awaiting_me: false, is_closed: false, created_at: new Date().toISOString(), listing_id: l.id })
  fxMessage(cid, fixture.me, fixture.names[fixture.me], body)
  setTimeout(() => {
    const c = fixture?.threads.find(x => x.conversation_id === cid)
    if (!c || c.is_closed) return
    c.is_accepted = true
    fxMessage(cid, l.owner_id, fixture.names[l.owner_id], 'Merhaba! Evet, hâlâ duruyor. Ne zaman bakmak istersin?')
  }, 4000)
  return ok('started')
}
function fxSend(cid, body) {
  const c = fixture.threads.find(x => x.conversation_id === cid)
  if (!c || c.is_closed) return fail('CONVERSATION_CLOSED')
  if (fixture.noticeVersion !== MK_NOTICE_VERSION) return fail('NOTICE_REQUIRED')
  if (!c.is_accepted) return fail('AWAITING_ACCEPTANCE')
  fxMessage(cid, fixture.me, fixture.names[fixture.me], body)
  return ok('sent')
}
function fxAct(rpc, args) {
  const c = fixture.threads.find(x => x.conversation_id === args.p_conversation_id)
  if (rpc === 'accept_conversation' && c) { c.is_accepted = true; c.awaiting_me = false }
  else if (rpc === 'decline_conversation' && c) { c.is_closed = true; c.hidden = true }
  else if (rpc === 'leave_conversation' && c) { c.is_closed = true; c.hidden = true }
  else if (rpc === 'block_user') fixture.threads.filter(x => x.other_user_id === args.p_user_id).forEach(x => { x.is_closed = true })
  else if (rpc === 'delete_message') Object.values(fixture.messages).forEach(ms => { const i = ms.findIndex(m => m.id === args.p_message_id); if (i >= 0) ms.splice(i, 1) })
  else return fail('UNSUPPORTED')
  return ok(null)
}

// base64 → ArrayBuffer, the same helper the other upload screens carry (no base64-arraybuffer dependency).
function decode(base64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const lookup = new Uint8Array(256)
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i
  const len = base64.length
  let bufLen = (len * 3) >> 2
  if (base64[len - 1] === '=') bufLen--
  if (base64[len - 2] === '=') bufLen--
  const buf = new ArrayBuffer(bufLen)
  const out = new Uint8Array(buf)
  let p = 0
  for (let i = 0; i < len; i += 4) {
    const a = lookup[base64.charCodeAt(i)], b = lookup[base64.charCodeAt(i + 1)]
    const c = lookup[base64.charCodeAt(i + 2)], d = lookup[base64.charCodeAt(i + 3)]
    out[p++] = (a << 2) | (b >> 4)
    if (p < bufLen) out[p++] = ((b & 15) << 4) | (c >> 2)
    if (p < bufLen) out[p++] = ((c & 3) << 6) | (d & 63)
  }
  return buf
}

// ─── fixture ────────────────────────────────────────────────────────────────
const byNewest = (a, b) => new Date(b.bumped_at) - new Date(a.bumped_at)
function fxList({ category, district, query, from }) {
  const q = (query || '').trim().toLocaleLowerCase('tr')
  const rows = fixture.listings.filter(l => !l.deleted_at && !l.hidden_at && l.status === 'active'
    && new Date(l.expires_at) > new Date()
    && (!category || l.category === category) && (!district || l.district === district)
    && (!q || l.title.toLocaleLowerCase('tr').includes(q))).sort(byNewest)
  return { rows: rows.slice(from, from + PAGE), more: rows.length > from + PAGE }
}
function fxCreate(fields) {
  const now = new Date().toISOString()
  const id = `fx-l-${fixture.seq++}`
  fixture.listings.push({ id, owner_id: fixture.me, ...pick(fields), price_tl: fields.is_free ? null : fields.price_tl,
    status: 'active', sold_at: null, created_at: now, bumped_at: now, hidden_at: null, deleted_at: null,
    expires_at: new Date(Date.now() + 30 * 86400e3).toISOString() })
  return id
}
export function setFixtureUser(uid, name) {
  if (!fixture) return
  fixture.me = uid; fixture.names[uid] = name
  if (!uid || fixture.sellerSeeded) return
  fixture.sellerSeeded = true
  const now = Date.now(), ago = m => new Date(now - m * 60e3).toISOString()
  fixture.listings.push({ id: 'fx-5', owner_id: uid, title: 'Masa lambası, LED', description: 'Üç kademeli ışık, USB ile şarj oluyor.',
    price_tl: 600, is_free: false, category: 'home', condition: 'like_new', district: 'nicosia', status: 'active', sold_at: null,
    created_at: ago(600), bumped_at: ago(600), expires_at: new Date(now + 28 * 86400e3).toISOString(), hidden_at: null, deleted_at: null })
  fixture.names['fx-buyer'] = 'Deniz'
  fixture.threads.push({ conversation_id: 'fx-c-in', other_user_id: 'fx-buyer', display_name: 'Deniz', avatar_url: null,
    is_accepted: false, awaiting_me: true, is_closed: false, created_at: ago(30), listing_id: 'fx-5' })
  fixture.messages['fx-c-in'] = [{ id: 'fx-m-in', sender_id: 'fx-buyer', sender_display_name: 'Deniz',
    body: 'Merhaba, lamba hâlâ satılık mı? Yarın Lefkoşa’da alabilirim.', created_at: ago(30) }]
}
function seedFixture() {
  const ago = d => new Date(Date.now() - d * 86400e3).toISOString()
  const left = d => new Date(Date.now() + d * 86400e3).toISOString()
  const S = 'fx-seller'
  const mk = (id, title, description, price_tl, category, condition, district, days) => ({
    id, owner_id: S, title, description, price_tl, is_free: price_tl === null, category, condition, district,
    status: 'active', sold_at: null, created_at: ago(days), bumped_at: ago(days), expires_at: left(30 - days), hidden_at: null, deleted_at: null })
  return {
    seq: 1, me: null, names: { [S]: 'Önizleme Satıcı' }, localUri: {}, threads: [], messages: {}, noticeVersion: null,
    listings: [
      mk('fx-1', 'Şehir bisikleti, 21 vites', 'Az kullanıldı, lastikleri yeni. Kask hediye.', 4500, 'sports', 'like_new', 'kyrenia', 1),
      mk('fx-2', 'Çalışma masası ve sandalye', 'Ahşap masa 120×60, döner sandalye. Taşınma nedeniyle satılık.', 2500, 'home', 'used', 'nicosia', 2),
      mk('fx-3', 'Üniversite hazırlık kitapları', 'Matematik ve fizik setleri. Ücretsiz, gelip alman yeterli.', null, 'books', 'used', 'famagusta', 4),
      mk('fx-4', 'Bebek arabası', 'Katlanır, yağmurluğu var. Temiz kullanıldı.', 3200, 'baby_kids', 'like_new', 'morphou', 6),
    ],
    photos: [],
  }
}
