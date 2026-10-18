import { supabase } from '../lib/supabase'
import { CRUNCHY_EXPRESS, EATERY_PREVIEW_DATA } from '../constants/redesign'
import { eateryPartnerVisible } from '../constants/eatery'

// The ONE reader of eatery_partners (list and map) and the ONE importer of the Preview fixture
// (scripts/check-eatery-partners.mjs rule (c)). On dev / ADA Preview a partner the database has no row for
// yet falls back to its placeholder. RLS returns active partners only; is_active is asked for anyway.
const PREVIEW_PARTNERS = EATERY_PREVIEW_DATA ? require('../constants/eateryPreview').EATERY_PREVIEW_PARTNERS : null

// A partner behind its own dark flag stays out of a live section (CRUNCHY_EXPRESS_LIVE).
export const EATERY_GATES = { 'crunchy-express': CRUNCHY_EXPRESS }

// -> { rows, error }; rows already pass the partner gates.
export async function loadEateryPartners(cols) {
  const { data, error } = await supabase
    .from('eatery_partners')
    .select(cols)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) return { rows: [], error }
  let list = data ?? []
  if (PREVIEW_PARTNERS) {
    for (const p of PREVIEW_PARTNERS) if (!list.some(r => r.slug === p.slug)) list = [...list, p]
  }
  return { rows: list.filter(r => eateryPartnerVisible(r, EATERY_GATES)), error: null }
}
