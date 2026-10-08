import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { t } from '../constants/i18n'
import { getNatLabel } from '../constants/nationalityTranslations'
import { TRNC_NATIONALITY_CODE } from '../constants/profileGate'

// ─── Universities by country (20261095) ─────────────────────────────────────
//
// institutions.country is ISO 3166-1 alpha-2, plus 'XN' for the TRNC (no ISO code; see
// TRNC_NATIONALITY_CODE). Other (…00ff) has no country: it is offered in every country's
// picker and never in the directory.
//
// Read ONE COUNTRY AT A TIME. PostgREST's max-rows is 1000 and a world list is far past
// it; one country is under it today (TR 202). The count:'exact' guard turns the day one
// country passes the cap into an error state instead of a silently short list — that is
// the day this moves to server-side search.

export const OTHER_INSTITUTION_ID = '00000000-0000-4000-b000-0000000000ff'

// Countries with seeded universities, in the order users meet them. A new country is a
// seed migration plus one entry here (and a label below if it is not a nationality).
export const INSTITUTION_COUNTRIES = [TRNC_NATIONALITY_CODE, 'TR', 'CY', 'GB']

const NATIONALITY_NAME = { [TRNC_NATIONALITY_CODE]: 'Northern Cyprus', TR: 'Turkey', GB: 'United Kingdom' }

// The Republic of Cyprus is deliberately NOT a nationality in constants/nationalityTranslations
// (adding it there adds it to both nationality pickers), so its label is its own key.
export function countryLabel(code, lang) {
  if (code === 'CY') return t('countryCyprusSouth', lang)
  return getNatLabel(NATIONALITY_NAME[code] ?? code, lang)
}

export const countryOptions = lang => INSTITUTION_COUNTRIES.map(c => ({ value: c, label: countryLabel(c, lang) }))

export const institutionLabel = inst =>
  !inst ? '' : inst.short_name ? `${inst.name} (${inst.short_name})` : inst.name

export const INSTITUTION_COLUMNS = 'id, name, short_name, country, city, city_name, website_url'

// Active universities of one country, by sort_order then name. `withOther` appends Other
// (sort_order 999 keeps it last) — the pickers want it, the directory does not.
export async function fetchInstitutions(country, { withOther = false } = {}) {
  let q = supabase.from('institutions')
    .select(INSTITUTION_COLUMNS, { count: 'exact' })
    .eq('is_active', true)
  q = withOther ? q.or(`country.eq.${country},id.eq.${OTHER_INSTITUTION_ID}`) : q.eq('country', country)
  const { data, error, count } = await q.order('sort_order').order('name')
  if (error) throw error
  if (count !== data.length) throw new Error(`institutions ${country}: received ${data.length} of ${count}`)
  return data
}

// The two profile screens share one cache: the picker re-opens without a refetch, and a
// country loaded on one screen is there on the other.
const cache = new Map()

export function useCountryInstitutions(country) {
  const [state, setState] = useState(() => ({ country, rows: cache.get(country) ?? null, failed: false }))
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!country) return
    if (cache.has(country)) { setState({ country, rows: cache.get(country), failed: false }); return }
    let cancelled = false
    setState({ country, rows: null, failed: false })
    fetchInstitutions(country, { withOther: true })
      .then(rows => { cache.set(country, rows); if (!cancelled) setState({ country, rows, failed: false }) })
      .catch(() => { if (!cancelled) setState({ country, rows: null, failed: true }) })
    return () => { cancelled = true }
  }, [country, attempt])
  const current = state.country === country ? state : { country, rows: null, failed: false }
  return { ...current, retry: () => setAttempt(n => n + 1) }
}
