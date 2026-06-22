import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DUTY_TITLES: Record<string, string> = {
  English: "💊 Tonight's Duty Pharmacy",
  Turkish: '💊 Bu Gece Nöbetçi Eczane',
  Arabic:  '💊 صيدلية المناوبة الليلة',
  Russian: '💊 Дежурная аптека сегодня ночью',
  Greek:   '💊 Εφημερεύον Φαρμακείο Απόψε',
  French:  '💊 Pharmacie de garde ce soir',
  Spanish: '💊 Farmacia de guardia esta noche',
  German:  '💊 Notdienstapotheke heute Nacht',
  Persian: '💊 داروخانه نوبتی امشب',
}

const DUTY_BODY_MULTI: Record<string, string> = {
  English: '{count} pharmacies on duty tonight — open the app to see the list',
  Turkish: 'Bu gece {count} nöbetçi eczane var — listeyi görmek için uygulamayı açın',
  Arabic:  '{count} صيدليات في المناوبة الليلة — افتح التطبيق لرؤية القائمة',
  Russian: '{count} дежурных аптек сегодня ночью — откройте приложение для просмотра',
  Greek:   '{count} εφημερεύοντα φαρμακεία απόψε — ανοίξτε την εφαρμογή για τη λίστα',
  French:  "{count} pharmacies de garde ce soir — ouvrez l'application pour voir la liste",
  Spanish: '{count} farmacias de guardia esta noche — abre la app para ver la lista',
  German:  '{count} Notdienstapotheken heute Nacht — App öffnen für die Liste',
  Persian: '{count} داروخانه نوبتی امشب — برای دیدن لیست اپ را باز کنید',
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

serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // TRNC is UTC+3 — use UTC date shifted by 3h so "today" is correct at 8pm TRNC
  const now = new Date()
  const trncNow = new Date(now.getTime() + 3 * 60 * 60 * 1000)
  const today = trncNow.toISOString().slice(0, 10)

  const { data: duties, error: dutyError } = await supabase
    .from('duty_list')
    .select('name, phone, region, open_from, open_until')
    .eq('duty_date', today)
    .order('region')
    .order('name')

  if (dutyError) {
    return new Response(JSON.stringify({ error: dutyError.message }), { status: 500 })
  }

  if (!duties?.length) {
    return new Response(JSON.stringify({ message: 'No duty pharmacies for today', date: today }), { status: 200 })
  }

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, push_token, preferred_language')

  if (!profiles?.length) {
    return new Response(JSON.stringify({ message: 'No profiles found' }), { status: 200 })
  }

  // Insert in-app notifications per user in their language
  const notifRows = profiles.map(p => {
    const lang = p.preferred_language || 'English'
    return {
      user_id: p.id,
      title: getDutyTitle(lang),
      body: getDutyBody(lang, duties),
    }
  })

  for (let i = 0; i < notifRows.length; i += 500) {
    await supabase.from('notifications').insert(notifRows.slice(i, i + 500))
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
        data: { type: 'duty', date: today },
        sound: 'default',
        channelId: 'default',
      }
    })

  const pushErrors: string[] = []

  for (let i = 0; i < messages.length; i += 100) {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify(messages.slice(i, i + 100)),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error('Expo push batch failed:', errText)
      pushErrors.push(errText)
    } else {
      const json = await res.json()
      const batchErrors = (json.data ?? [])
        .filter((r: any) => r.status === 'error')
        .map((r: any) => `${r.details?.error ?? 'unknown'}: ${r.message ?? ''}`)
      if (batchErrors.length) console.error('Expo push errors:', batchErrors)
      pushErrors.push(...batchErrors)
    }
  }

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
