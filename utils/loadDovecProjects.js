import { supabase } from '../lib/supabase'

// The ONE reader of Döveç projects (partner page, map pins, Home slot).
//
// RLS decides visibility, not this file: a project comes back only while active AND carrying a
// mirrored cover (pp_select_public), a unit only while active AND carrying a photo
// (props_select_public + props_hide_photoless_novest). Pending rows (before go-live) return nothing.
//
// Dev preview: __DEV__ && EXPO_PUBLIC_DOVEC_MOCK=1 serves constants/dovecPreview.js — the sync
// fixture through the real mapper — instead of the database. Those rows carry fromFixture, and a tap
// on them is never logged (constants/dovec.js).
const PREVIEW = typeof __DEV__ !== 'undefined' && __DEV__ && process.env.EXPO_PUBLIC_DOVEC_MOCK === '1'
  ? require('../constants/dovecPreview').DOVEC_PREVIEW_PROJECTS : null

const PROJECT_COLS = 'id, external_id, name, description, project_status, construction_progress, delivery_date, ' +
  'unit_types, price_from, currency, price_on_request, district, area, address, latitude, longitude, ' +
  'location_precision, cover_image_url'
const UNIT_COLS = 'id, project_id, title, property_type, price, price_on_request, currency, bedrooms, living_rooms, ' +
  'bathrooms, area_sqm, floor, property_images(url, is_primary, sort_order)'

const primaryPhoto = imgs => {
  const list = (imgs || []).slice().sort((a, b) => (b.is_primary === true) - (a.is_primary === true) || a.sort_order - b.sort_order)
  return list[0]?.url || null
}

// -> { projects, error }. withUnits: the partner page wants them; the map and Home do not.
export async function loadDovecProjects({ withUnits = false } = {}) {
  if (PREVIEW) return { projects: PREVIEW, error: null }

  const { data, error } = await supabase.from('property_projects').select(PROJECT_COLS)
    .eq('source', 'dovec').order('name', { ascending: true })
  if (error) return { projects: [], error }
  const projects = (data ?? []).map(p => ({ ...p, coverSource: { uri: p.cover_image_url }, units: [] }))
  if (!withUnits || !projects.length) return { projects, error: null }

  const { data: units, error: uErr } = await supabase.from('properties').select(UNIT_COLS)
    .eq('source', 'dovec').eq('status', 'active').in('project_id', projects.map(p => p.id))
    .order('price', { ascending: true, nullsFirst: false })
  // Projects without their units still render (status, progress, contact): a partial page beats none.
  if (uErr) return { projects, error: null }
  const byProject = new Map()
  for (const u of units ?? []) {
    const photo = primaryPhoto(u.property_images)
    if (!photo) continue
    ;(byProject.get(u.project_id) || byProject.set(u.project_id, []).get(u.project_id))
      .push({ ...u, photoSource: { uri: photo } })
  }
  return { projects: projects.map(p => ({ ...p, units: byProject.get(p.id) || [] })), error: null }
}
