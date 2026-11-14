// send-weekend-digest — the Friday "Bu hafta sonu" push (Explore stage 4, 20261175).
//
// POST { "testers_only": true } sends ONLY to order_testers (20261133: Berke's two accounts, by uid
// fingerprint) — the device test before the weekly job exists. Without it, every profile with
// weekend_digest = true. The weekly call comes from pg_cron (20261177), Friday 17:00 TRNC.
//
// Content: this weekend's listed events (first two named, the rest counted) + one EEMD site a week.
// Nothing listed this weekend → nothing is sent ('no_events'): a digest that says "nothing on" is spam.
// Writes the in-app Bildirimler row (type 'weekend') and the push (data.screen 'weekend' → Keşfet,
// events mode, Bu hafta sonu). Run log: weekend_digest_runs, counts only.
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { readAllById } from '../send-duty-notification/page.ts'
import { lastSignIns, onePerToken, pushOutcome, RUN_DEADLINE_MS, sendBatch, sharedTokenIds } from '../send-duty-notification/push.ts'
import { weekendWindow, inWindow, weekPick, digestMessage, type DigestEvent, type DigestPlace } from './digest.ts'

const MAX_ERROR_KINDS = 20

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

async function finishRun(supabase: any, id: number | null, fields: Record<string, unknown>) {
  if (id == null) return
  try {
    const { error } = await supabase.from('weekend_digest_runs').update({ ...fields, finished_at: new Date().toISOString() }).eq('id', id)
    if (error) console.error('weekend_digest_runs finish failed', error.message)
  } catch (e) { console.error('weekend_digest_runs finish threw', String(e)) }
}

serve(async (req) => {
  const runStartedAt = Date.now()
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  let testersOnly = false
  try { testersOnly = (await req.json())?.testers_only === true } catch { /* empty body = the weekly run */ }

  let runId: number | null = null
  try {
    const { data } = await supabase.from('weekend_digest_runs').insert({ mode: testersOnly ? 'testers' : 'all' }).select('id').maybeSingle()
    runId = data?.id ?? null
  } catch (e) { console.error('weekend_digest_runs start threw', String(e)) }

  const now = new Date()
  const w = weekendWindow(now)
  const { data: evRows, error: evErr } = await supabase.from('events')
    .select('title, start_date, end_date')
    .eq('status', 'approved')
    .lt('start_date', w.to.toISOString())
    .or(`end_date.gte.${w.from.toISOString()},and(end_date.is.null,start_date.gte.${new Date(w.from.getTime() - 18 * 3600_000).toISOString()})`)
    .order('start_date', { ascending: true })
    .limit(500)   // one weekend: tens of rows
  if (evErr) {
    await finishRun(supabase, runId, { outcome: 'events_query_failed' })
    return new Response(JSON.stringify({ error: 'events read failed' }), { status: 500 })
  }
  const events = ((evRows ?? []) as DigestEvent[]).filter(e => inWindow(e, w))
  if (!events.length) {
    await finishRun(supabase, runId, { outcome: 'no_events' })
    return new Response(JSON.stringify({ message: 'no events this weekend', from: w.from, to: w.to }), { status: 200 })
  }

  const { data: placeRows } = await supabase.from('places')
    .select('id, name, name_i18n, official_visit').eq('status', 'active').not('official_visit', 'is', null).order('id').limit(500)   // ~33 EEMD sites
  const place = weekPick(((placeRows ?? []) as (DigestPlace & { official_visit: { status?: string } })[])
    .filter(p => p.official_visit?.status !== 'closed'), now)

  const { rows: allProfiles, error: profilesError } = await readAllById<{ id: string; push_token: string | null; preferred_language: string | null }>(
    (after) => {
      let q = supabase.from('profiles').select('id, push_token, preferred_language', { count: 'exact' })
        .eq('weekend_digest', true).order('id').limit(1000)
      if (after) q = q.gt('id', after)
      return q
    },
  )
  if (profilesError) {
    await finishRun(supabase, runId, { outcome: 'profiles_query_failed', events: events.length })
    return new Response(JSON.stringify({ error: 'profiles read failed' }), { status: 500 })
  }
  let profiles = allProfiles ?? []
  if (testersOnly) {
    const { data: testers } = await supabase.from('order_testers').select('uid_sha256')
    const set = new Set((testers ?? []).map((t: { uid_sha256: string }) => t.uid_sha256))
    const keep: typeof profiles = []
    for (const p of profiles) if (set.has(await sha256Hex(p.id))) keep.push(p)
    profiles = keep
  }
  if (!profiles.length) {
    await finishRun(supabase, runId, { outcome: 'no_profiles', events: events.length })
    return new Response(JSON.stringify({ message: 'no recipients' }), { status: 200 })
  }

  const msgOf = (lang: string | null) => digestMessage(lang || 'English', events, place)

  let notified = 0, notifBatchesFailed = 0
  const notifRows = profiles.map(p => ({ user_id: p.id, type: 'weekend', ...msgOf(p.preferred_language) }))
  for (let i = 0; i < notifRows.length; i += 500) {
    const { error } = await supabase.from('notifications').insert(notifRows.slice(i, i + 500))
    if (error) { notifBatchesFailed++; console.error('notifications insert failed', error.message) }
    else notified += Math.min(500, notifRows.length - i)
  }

  // ONE push per token (push.ts onePerToken); the in-app rows above still go to every account.
  const signIns = await lastSignIns(sharedTokenIds(profiles),
    async (id) => (await supabase.auth.admin.getUserById(id)).data?.user?.last_sign_in_at)
  const messages = onePerToken(profiles, signIns).map(p => ({
    to: p.push_token, ...msgOf(p.preferred_language),
    data: { screen: 'weekend' }, sound: 'default', channelId: 'default',
  }))
  let pushOk = 0, pushErrors = 0, batchesAccepted = 0, batchesFailed = 0
  const errorKinds: Record<string, number> = Object.create(null)
  for (let i = 0; i < messages.length; i += 100) {
    const r = await sendBatch(messages.slice(i, i + 100), {
      fetchFn: fetch, sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
      now: Date.now, random: Math.random, deadlineAt: runStartedAt + RUN_DEADLINE_MS,
    }, Math.max(0, Math.ceil((messages.length - i - 100) / 100)))
    pushOk += r.ok
    if (r.accepted) batchesAccepted++; else batchesFailed++
    for (const [kind, n] of Object.entries(r.kinds)) {
      pushErrors += n
      const key = kind in errorKinds || Object.keys(errorKinds).length < MAX_ERROR_KINDS ? kind : 'other'
      errorKinds[key] = (errorKinds[key] ?? 0) + n
    }
  }

  const outcome = pushOutcome(messages.length, batchesAccepted, batchesFailed)
  await finishRun(supabase, runId, {
    outcome, events: events.length, notified, notif_batches_failed: notifBatchesFailed,
    push_attempted: messages.length, push_ok: pushOk, push_errors: pushErrors, error_kinds: errorKinds,
  })
  return new Response(JSON.stringify({ ok: outcome !== 'push_failed', mode: testersOnly ? 'testers' : 'all', events: events.length }),
    { status: outcome === 'push_failed' ? 502 : 200, headers: { 'Content-Type': 'application/json' } })
})
