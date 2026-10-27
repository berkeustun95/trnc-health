import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
const KIND_RE = /^[A-Za-z0-9_]{1,64}$/
function errorKind(k: unknown): string {
  return typeof k === 'string' && KIND_RE.test(k) ? k : 'other'
}

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

serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // TRNC local date. Asia/Famagusta, not a fixed offset: TRNC is UTC+3 in summer, UTC+2 in winter
  // (and not Europe/Istanbul, which stays UTC+3). en-CA formats as YYYY-MM-DD.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Famagusta' }).format(new Date())
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return new Response(JSON.stringify({ error: `unexpected TRNC date format: ${today}` }), { status: 500 })
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
    return new Response(JSON.stringify({ error: dutyError.message }), { status: 500 })
  }

  if (!duties?.length) {
    await finishRun(supabase, runId, { outcome: 'no_duties' })
    return new Response(JSON.stringify({ message: 'No duty pharmacies for today', date: today }), { status: 200 })
  }

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, push_token, preferred_language')

  if (!profiles?.length) {
    await finishRun(supabase, runId, { outcome: 'no_profiles', pharmacies: duties.length })
    return new Response(JSON.stringify({ message: 'No profiles found' }), { status: 200 })
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

  // Send push notifications — each message in the user's language
  const messages = profiles
    .filter(p => p.push_token)
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

  const pushErrors: string[] = []
  let pushOk = 0
  let pushErrCount = 0
  const errorKinds: Record<string, number> = {}
  const bump = (kind: string, n = 1) => {
    pushErrCount += n
    errorKinds[kind] = (errorKinds[kind] ?? 0) + n
  }

  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100)
    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify(batch),
      })

      if (!res.ok) {
        const errText = await res.text()
        console.error('Expo push batch failed:', errText)
        pushErrors.push(errText)
        bump(`http_${res.status}`, batch.length)
      } else {
        const json = await res.json()
        const tickets: any[] = Array.isArray(json.data) ? json.data : []
        const batchErrors: string[] = []
        for (const r of tickets) {
          if (r.status === 'ok') {
            pushOk++
          } else {
            bump(errorKind(r.details?.error ?? 'unknown'))
            if (r.status === 'error') batchErrors.push(`${r.details?.error ?? 'unknown'}: ${r.message ?? ''}`)
          }
        }
        if (tickets.length < batch.length) bump('no_ticket', batch.length - tickets.length)
        if (batchErrors.length) console.error('Expo push errors:', batchErrors)
        pushErrors.push(...batchErrors)
      }
    } catch (e) {
      console.error('Expo push batch threw:', String(e))
      pushErrors.push(String(e))
      bump('fetch_failed', batch.length)
    }
  }

  await finishRun(supabase, runId, {
    outcome: 'sent',
    pharmacies: duties.length,
    notified,
    notif_batches_failed: notifBatchesFailed,
    push_attempted: messages.length,
    push_ok: pushOk,
    push_errors: pushErrCount,
    error_kinds: errorKinds,
  })

  return new Response(
    JSON.stringify({
      ok: true,
      date: today,
      pharmacies: duties.map(d => d.name),
      notified: profiles.length,
      pushed: messages.length,
      pushErrors: pushErrors.length ? pushErrors : undefined,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
})
