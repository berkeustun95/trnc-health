// CALLER: only the cron's service key (Vault novest_sync_key). 'role' is sound only while verify_jwt stays true (deploy-config.json).
// The response carries no user counts (they go to duty_push_runs); scripts/check-push-fn-auth.mjs pins that.
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { serviceCaller } from '../_shared/caller-auth.mjs'
import { profileReadKinds, readAllById } from './page.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { lastSignIns, onePerToken, pushOutcome, sendBatch, sharedTokenIds } from './push.ts'

const DUTY_TITLES: Record<string, string> = {
  English: "💊 Today's Duty Pharmacy",
  Turkish: '💊 Bugünkü Nöbetçi Eczane',
  Arabic:  '💊 صيدلية المناوبة اليوم',
  Russian: '💊 Дежурная аптека сегодня',
  Greek:   '💊 Εφημερεύον Φαρμακείο Σήμερα',
  French:  "💊 Pharmacie de garde aujourd'hui",
  Spanish: '💊 Farmacia de guardia hoy',
  German:  '💊 Notdienstapotheke heute',
  Persian: '💊 داروخانه نوبتی امروز',
}

const DUTY_BODY_MULTI: Record<string, string> = {
  English: '{count} pharmacies on duty today — open the app to see the list',
  Turkish: 'Bugün {count} nöbetçi eczane var — listeyi görmek için uygulamayı açın',
  Arabic:  '{count} صيدليات في المناوبة اليوم — افتح التطبيق لرؤية القائمة',
  Russian: '{count} дежурных аптек сегодня — откройте приложение для просмотра',
  Greek:   '{count} εφημερεύοντα φαρμακεία σήμερα — ανοίξτε την εφαρμογή για τη λίστα',
  French:  "{count} pharmacies de garde aujourd'hui — ouvrez l'application pour voir la liste",
  Spanish: '{count} farmacias de guardia hoy — abre la app para ver la lista',
  German:  '{count} Notdienstapotheken heute — App öffnen für die Liste',
  Persian: '{count} داروخانه نوبتی امروز — برای دیدن لیست اپ را باز کنید',
}

function getDutyTitle(lang: string): string {
  return DUTY_TITLES[lang] ?? DUTY_TITLES['English']
}

function getDutyBody(lang: string, duties: { name: string; phone?: string; open_from: string; open_until: string }[]): string {
  if (duties.length === 1) {
    const d = duties[0]
    return `${d.name}${d.phone ? ' · ' + d.phone : ''} (${d.open_from}–${d.open_until})`
  }
  const template = DUTY_BODY_MULTI[lang] ?? DUTY_BODY_MULTI['English']
  return template.replace('{count}', String(duties.length))
}

// duty_push_runs (20261141): one counts-only summary row per invocation, written at start and
// finished at the end (both timestamps from this function's clock, so finished_at >= started_at holds). Logging must never block or fail a push: a missing table (function deployed
// before the migration) or any error is logged and ignored.
const MAX_ERROR_KINDS = 20

async function startRun(supabase: any, dutyDate: string): Promise<number | null> {
  try {
    const { data, error } = await supabase.from('duty_push_runs').insert({ duty_date: dutyDate, started_at: new Date().toISOString() }).select('id').maybeSingle()
    if (error) {
      console.error('duty_push_runs start failed', error.message)
      return null
    }
    return data?.id ?? null
  } catch (e) {
    console.error('duty_push_runs start threw', String(e))
    return null
  }
}

async function finishRun(supabase: any, id: number | null, patch: Record<string, unknown>): Promise<void> {
  if (id == null) return
  try {
    const { error } = await supabase
      .from('duty_push_runs')
      .update({ ...patch, finished_at: new Date().toISOString() })
      .eq('id', id)
    if (error) console.error('duty_push_runs finish failed', error.message)
  } catch (e) {
    console.error('duty_push_runs finish threw', String(e))
  }
}

serve(async (req) => {
  const caller = await serviceCaller(req.headers.get('Authorization'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))
  if (!caller) {
    console.error('send-duty-notification: caller refused')
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  }
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // TRNC local date. Asia/Famagusta, not a fixed offset: TRNC is UTC+3 in summer, UTC+2 in winter
  // (and not Europe/Istanbul, which stays UTC+3). en-CA formats as YYYY-MM-DD.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Famagusta' }).format(new Date())
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    console.error('unexpected TRNC date format:', today)
    return new Response(JSON.stringify({ ok: false, caller, error: 'unexpected date format' }), { status: 500 })
  }

  const runId = await startRun(supabase, today)

  const { data: duties, error: dutyError } = await supabase
    .from('duty_list')
    .select('name, phone, region, open_from, open_until')
    .eq('duty_date', today)
    .order('region')
    .order('name')

  if (dutyError) {
    await finishRun(supabase, runId, { outcome: 'duty_query_failed' })
    console.error('duty_list read failed', dutyError.message)
    return new Response(JSON.stringify({ ok: false, caller, error: 'duty read failed' }), { status: 500 })
  }

  if (!duties?.length) {
    await finishRun(supabase, runId, { outcome: 'no_duties' })
    return new Response(JSON.stringify({ ok: true, caller, date: today, outcome: 'no_duties' }), { status: 200 })
  }

  // Paged + count-verified (page.ts): a plain select stops silently at PostgREST max-rows (1000).
  const { rows: profiles, error: profilesError, shortBy: profilesShortBy, countUnverified: profilesCountUnverified } = await readAllById<{ id: string; push_token: string | null; preferred_language: string | null }>(
    (after) => {
      let q = supabase.from('profiles').select('id, push_token, preferred_language', { count: 'exact' }).order('id').limit(1000)
      if (after) q = q.gt('id', after)
      return q
    },
  )

  if (profilesError) {
    console.error('profiles read failed:', profilesError)
    await finishRun(supabase, runId, { outcome: 'profiles_query_failed', pharmacies: duties.length })
    return new Response(JSON.stringify({ ok: false, caller, error: 'profiles read failed' }), { status: 500 })
  }

  if (!profiles?.length) {
    await finishRun(supabase, runId, { outcome: 'no_profiles', pharmacies: duties.length })
    return new Response(JSON.stringify({ ok: true, caller, date: today, outcome: 'no_profiles' }), { status: 200 })
  }

  // Insert in-app notifications per user in their language
  const notifRows = profiles.map(p => {
    const lang = p.preferred_language || 'English'
    return {
      user_id: p.id,
      // 20261066. Deploy AFTER that migration: before it, this column does not exist and
      // the whole day's insert fails.
      type: 'duty',
      title: getDutyTitle(lang),
      body: getDutyBody(lang, duties),
    }
  })

  let notified = 0
  let notifBatchesFailed = 0
  for (let i = 0; i < notifRows.length; i += 500) {
    const batch = notifRows.slice(i, i + 500)
    const { error: insertError } = await supabase.from('notifications').insert(batch)
    if (insertError) notifBatchesFailed++
    else notified += batch.length
    // Not fatal: the pushes below still go out. But a failed insert used to vanish, and the
    // likeliest one is deploying this before 20261066 (column "type" does not exist).
    if (insertError) console.error('notifications insert failed', insertError.message)
  }

  // Send push notifications — each message in the user's language, ONE per token (push.ts onePerToken)
  const signIns = await lastSignIns(sharedTokenIds(profiles),
    async (id) => (await supabase.auth.admin.getUserById(id)).data?.user?.last_sign_in_at)
  const messages = onePerToken(profiles, signIns)
    .map(p => {
      const lang = p.preferred_language || 'English'
      return {
        to: p.push_token,
        title: getDutyTitle(lang),
        body: getDutyBody(lang, duties),
        data: { screen: 'duty', date: today },
        sound: 'default',
        channelId: 'default',
      }
    })

  let pushOk = 0
  let pushErrCount = 0
  const errorKinds: Record<string, number> = Object.create(null)
  // Counts only; merged straight into error_kinds, NOT via bump(): these are not failed pushes and must not touch
  // push_errors (push_ok + push_errors <= push_attempted). profileReadKinds is unit-tested (page_test.ts).
  Object.assign(errorKinds, profileReadKinds({ shortBy: profilesShortBy, countUnverified: profilesCountUnverified }))
  if (profilesShortBy) console.error('profiles read still short after a re-read; sending to the rows read')
  const bump = (kind: string, n = 1) => {
    pushErrCount += n
    // At most 20 distinct keys; the rest fold into 'other'.
    const key = kind in errorKinds || Object.keys(errorKinds).length < MAX_ERROR_KINDS ? kind : 'other'
    errorKinds[key] = (errorKinds[key] ?? 0) + n
  }

  let batchesAccepted = 0
  let batchesFailed = 0
  for (let i = 0; i < messages.length; i += 100) {
    const r = await sendBatch(messages.slice(i, i + 100), { fetchFn: fetch })
    pushOk += r.ok
    if (r.accepted) batchesAccepted++
    else batchesFailed++
    for (const [kind, n] of Object.entries(r.kinds)) bump(kind, n)
  }

  // Batch-level, not ticket-level: error tickets (dead tokens) are not delivery failures.
  const outcome = pushOutcome(messages.length, batchesAccepted, batchesFailed)
  const pushFailed = outcome === 'push_failed'
  await finishRun(supabase, runId, {
    outcome: outcome,
    pharmacies: duties.length,
    notified,
    notif_batches_failed: notifBatchesFailed,
    push_attempted: messages.length,
    push_ok: pushOk,
    push_errors: pushErrCount,
    push_retries: 0,   // batches are sent once (push.ts); the column stays for the run history
    error_kinds: errorKinds,
  })

  return new Response(
    JSON.stringify({ ok: !pushFailed, caller, date: today, outcome }),
    { status: pushFailed ? 502 : 200, headers: { 'Content-Type': 'application/json' } }
  )
})
