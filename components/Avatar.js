import { useState, useEffect, useRef } from 'react'
import { View, Text, Image, StyleSheet } from 'react-native'
import { supabase } from '../lib/supabase'
import { colors } from '../constants/theme'
import { getPreset } from '../constants/avatars'

// ─── ONE AVATAR RENDERER, AND WHY IT HAD TO BECOME ONE ──────────────────────
//
// There were FIVE copies of the preset / http / initials branch — ProfileScreen's
// AvatarDisplay, App.js's drawer row, ConversationsScreen, StudentHubScreen and
// StudentProfileScreen. That was survivable while the branch was three lines. It stopped
// being survivable the moment avatars went PRIVATE: signing, caching, expiry refresh and
// a two-stage error fallback are not something to maintain in five places, and the copy
// that drifts is the one that shows a stranger a broken image or, worse, keeps working
// from a stale URL nobody can revoke.
//
// Same lesson as constants/i18n.js's LANGUAGES, which was consolidated BECAUSE four
// copies had already drifted. Enforced here up front rather than after the drift.
//
// ─── WHAT avatar_url CAN CONTAIN, IN THE ORDER THIS CHECKS ──────────────────
//
//   'preset:<id>'   a built-in emoji avatar. No network, no storage.
//   '<uid>/avatar-<rand>.<ext>'   a STORAGE PATH — the current shape. Signed on demand.
//   'https://…'     a LEGACY public URL, from before the bucket went private. Rendered
//                   directly. These rows are migrated by 20261040, but a client can hold
//                   a stale profile object in memory across the migration, so the branch
//                   stays. It costs one startsWith and removing it would produce exactly
//                   one broken image per straggler.
//   null / ''       initials.
//
// ⚠ THE ORDER MATTERS: path is checked LAST of the non-null shapes, because it is the
//   only one defined by exclusion ("not preset, not http"). Reversing it would try to
//   sign an https URL.
//
// ─── SIGNED URLS EXPIRE. THE THREE THINGS THAT FOLLOW FROM THAT ─────────────
//
//   1. NEVER PERSIST ONE. Not to profiles, not to AsyncStorage. A stored signed URL is a
//      credential with an expiry that outlives the reason it was minted, and it would
//      turn a revoked photo back into a fetchable one. The cache below is in MEMORY and
//      dies with the process, deliberately.
//   2. REFRESH BEFORE EXPIRY, not on failure. At REFRESH_AT of the TTL a URL already on
//      screen is re-minted, so a photo visible during a long scroll never blinks out.
//   3. onError IS STILL REQUIRED, because a URL can die for reasons that are not expiry —
//      the object was replaced, the row was migrated under us, the device slept through
//      the refresh. One retry, then initials. A broken-image glyph is never rendered.
//
// TTL is ONE HOUR, not AdminScreen's 60 seconds. That screen mints on a tap to open a
// document; this renders lists that scroll. At 60s a student list would re-sign
// continuously and flicker on every re-render.

const TTL_SECONDS = 3600
const REFRESH_AT  = 0.8          // re-mint once 80% of the TTL has elapsed
const BUCKET      = 'avatars'

// path -> { url, expiresAt(ms), promise }
const cache = new Map()

function isPath(v) {
  return typeof v === 'string' && v !== '' && !v.startsWith('preset:') && !v.startsWith('http')
}

function fresh(entry) {
  return entry?.url && Date.now() < entry.expiresAt
}

// ─── THE BATCH DOOR ─────────────────────────────────────────────────────────
//
// A list screen calls this ONCE with every path it is about to render, so N avatars cost
// ONE round trip instead of N. createSignedUrls (plural) is a single request; the
// per-component path below would otherwise fire one each.
//
// Already-fresh paths are filtered out first, so a re-render after a filter change costs
// nothing. Failures are simply absent from the cache — the component falls back to
// initials rather than the screen failing to render.
export async function prefetchAvatars(values) {
  const paths = [...new Set((values || []).filter(isPath))]
    .filter(p => !fresh(cache.get(p)))
  if (paths.length === 0) return
  try {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, TTL_SECONDS)
    if (error || !data) return
    const now = Date.now()
    for (const row of data) {
      if (row?.signedUrl && row?.path) {
        cache.set(row.path, { url: row.signedUrl, expiresAt: now + TTL_SECONDS * REFRESH_AT * 1000 })
      }
    }
  } catch {
    // Signing is best-effort by design: a failure renders initials, never an error state.
  }
}

// Single-path signing, de-duplicated. Two components mounting the same path in one frame
// share one in-flight request rather than racing two.
async function signOne(path) {
  const hit = cache.get(path)
  if (fresh(hit)) return hit.url
  if (hit?.promise) return hit.promise

  const promise = (async () => {
    try {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, TTL_SECONDS)
      if (error || !data?.signedUrl) { cache.delete(path); return null }
      cache.set(path, {
        url: data.signedUrl,
        expiresAt: Date.now() + TTL_SECONDS * REFRESH_AT * 1000,
      })
      return data.signedUrl
    } catch {
      cache.delete(path)
      return null
    }
  })()

  cache.set(path, { ...(hit || {}), promise })
  return promise
}

export function invalidateAvatar(path) {
  if (path) cache.delete(path)
}

export default function Avatar({ avatarUrl, initials = '?', size = 72, textSize = 26, style }) {
  const [signed, setSigned] = useState(() => {
    const hit = isPath(avatarUrl) ? cache.get(avatarUrl) : null
    return fresh(hit) ? hit.url : null
  })
  const [failed, setFailed] = useState(false)
  const retried = useRef(false)

  const path = isPath(avatarUrl) ? avatarUrl : null

  useEffect(() => {
    let alive = true
    retried.current = false
    setFailed(false)
    if (!path) { setSigned(null); return }
    const hit = cache.get(path)
    if (fresh(hit)) { setSigned(hit.url); return }
    setSigned(null)
    signOne(path).then(url => { if (alive) setSigned(url) })
    return () => { alive = false }
  }, [path])

  const box = { width: size, height: size, borderRadius: size / 2 }

  const preset = getPreset(avatarUrl)
  if (preset) {
    return (
      <View style={[box, s.center, { backgroundColor: preset.bg }, style]}>
        <Text style={{ fontSize: textSize * 0.9 }}>{preset.emoji}</Text>
      </View>
    )
  }

  // Legacy public URL — pre-20261040 rows, and any profile object a client is still
  // holding from before the migration.
  if (typeof avatarUrl === 'string' && avatarUrl.startsWith('http') && !failed) {
    return (
      <Image
        source={{ uri: avatarUrl }}
        style={[box, style]}
        onError={() => setFailed(true)}
      />
    )
  }

  if (path && signed && !failed) {
    return (
      <Image
        source={{ uri: signed }}
        style={[box, style]}
        // ONE retry, then initials. Re-minting forever on a genuinely dead object would
        // be a request loop behind a silent UI, which is worse than the missing photo.
        onError={() => {
          if (retried.current) { setFailed(true); return }
          retried.current = true
          invalidateAvatar(path)
          signOne(path).then(url => (url ? setSigned(url) : setFailed(true)))
        }}
      />
    )
  }

  // Initials: the resting state, the in-flight state and the give-up state. All three
  // look identical on purpose — a user should never be shown that something failed to
  // load, and a spinner on a 32pt avatar in a list is noise.
  return (
    <View style={[box, s.center, { backgroundColor: colors.primary }, style]}>
      <Text style={{ fontSize: textSize, fontFamily: 'Inter_700Bold', color: colors.surface }}>
        {initials}
      </Text>
    </View>
  )
}

const s = StyleSheet.create({
  center: { justifyContent: 'center', alignItems: 'center' },
})
