import { supabase } from '../lib/supabase'
import { CRUNCHY_EXPRESS, EATERY_PREVIEW_DATA } from '../constants/redesign'
import { eateryPartnerVisible } from '../constants/eatery'

// The ONE reader of eatery_partners (list and map) and the ONE importer of the Preview fixture
// (scripts/check-eatery-partners.mjs rule (c)). On dev / ADA Preview a partner the database has no row for
// yet falls back to its placeholder. is_active is always selected so a screen can tag a preview-only (inactive) row.
const PREVIEW_PARTNERS = EATERY_PREVIEW_DATA ? require('../constants/eateryPreview').EATERY_PREVIEW_PARTNERS : null

// A partner behind its own dark flag stays out of a live section (CRUNCHY_EXPRESS_LIVE).
export const EATERY_GATES = { 'crunchy-express': CRUNCHY_EXPRESS }

// -> { rows, error }; rows already pass the partner gates.
export async function loadEateryPartners(cols) {
  const select = /(^|,)\s*is_active\s*(,|$)/.test(cols) ? cols : `is_active, ${cols}`
  let q = supabase.from('eatery_partners').select(select)
  // Production builds keep the filter for everyone (admins included). On dev / Preview RLS decides: inactive rows
  // come back only for the previewer (public.is_previewer(), 20261119); every other user still gets active rows.
  if (!EATERY_PREVIEW_DATA) q = q.eq('is_active', true)
  const { data, error } = await q
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) return { rows: [], error }
  let list = data ?? []
  if (PREVIEW_PARTNERS) {
    for (const p of PREVIEW_PARTNERS) if (!list.some(r => r.slug === p.slug)) list = [...list, p]
  }
  return { rows: list.filter(r => eateryPartnerVisible(r, EATERY_GATES)), error: null }
}
