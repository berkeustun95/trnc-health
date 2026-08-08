import { supabase } from '../lib/supabase'
import { t } from '../constants/i18n'

// Push + in-app notification to a facility's owning provider. Looks up the
// provider's preferred language so the title/body are localized to the
// recipient, not the sender. Silent on any failure — a notification must never
// block the user action that triggered it (booking, question). Shared by
// BookingScreen (new appointment) and FacilityProfileScreen (new question).
export async function notifyProvider(facility, titleKey, bodyKey) {
  if (!facility.provider_id) return
  try {
    const { data: prov } = await supabase
      .from('profiles')
      .select('push_token, preferred_language')
      .eq('id', facility.provider_id)
      .maybeSingle()
    const lang = prov?.preferred_language || 'English'
    const title = t(titleKey, lang)
    const body = t(bodyKey, lang).replace('{name}', facility.name)
    if (prov?.push_token) {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ to: prov.push_token, title, body, sound: 'default' }),
      })
    }
    await supabase.rpc('insert_notification', { p_user_id: facility.provider_id, p_title: title, p_body: body })
  } catch {}
}
