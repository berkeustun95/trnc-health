import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

  const title = '💊 Tonight\'s Duty Pharmacy'
  const body = duties.length === 1
    ? `${duties[0].name}${duties[0].phone ? ' · ' + duties[0].phone : ''} (${duties[0].open_from}–${duties[0].open_until})`
    : `${duties.length} pharmacies on duty tonight — open the app to see the list`

  // Get all user profiles
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, push_token')

  if (!profiles?.length) {
    return new Response(JSON.stringify({ message: 'No profiles found' }), { status: 200 })
  }

  // Insert in-app notifications for every user
  const notifRows = profiles.map(p => ({ user_id: p.id, title, body }))

  // Insert in batches of 500 to stay under Postgres limits
  for (let i = 0; i < notifRows.length; i += 500) {
    await supabase.from('notifications').insert(notifRows.slice(i, i + 500))
  }

  // Send Expo push notifications to users with a token
  const tokens = profiles.map(p => p.push_token).filter(Boolean) as string[]

  if (tokens.length > 0) {
    const messages = tokens.map(token => ({
      to: token,
      title,
      body,
      data: { type: 'duty', date: today },
      sound: 'default',
    }))

    // Expo push API accepts max 100 messages per request
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
        console.error('Expo push batch failed:', await res.text())
      }
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      date: today,
      pharmacies: duties.map(d => d.name),
      notified: profiles.length,
      pushed: tokens.length,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
})
