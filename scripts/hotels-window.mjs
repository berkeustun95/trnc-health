// Hotels test window (Berke 2026-09-29): activate / roll back the listed KITOB hotels, probing as
// anon (the store role) before and after: how many hotels anon sees, and that search_content
// returns no hotel rows (it has no hotels arm; MODULE_FLAGS does not gate search).
//   node scripts/hotels-window.mjs --dry | --apply | --rollback
// Writes (--apply / --rollback) run only in CI: gh workflow run hotels-window -f mode=--apply
import { readFileSync, existsSync } from 'node:fs'
import { prodWriteGuard, serviceRoleKey } from './lib/prod-write-guard.mjs'
process.chdir(new URL('..', import.meta.url).pathname)
const mode = process.argv[2]
if (!['--dry', '--apply', '--rollback'].includes(mode) || process.argv.length > 3) throw new Error('exactly one of --dry | --apply | --rollback')
prodWriteGuard({ wouldWrite: mode !== '--dry', workflow: 'hotels-window', dryHint: 'node scripts/hotels-window.mjs --dry' })
const env = { ...(existsSync('.env') ? Object.fromEntries(readFileSync('.env','utf8').split('\n').map(l=>l.match(/^\s*([\w.-]+)\s*=\s*(.*)$/)).filter(Boolean).map(m=>[m[1],m[2].trim().replace(/^["']|["']$/g,'')])) : {}), ...process.env }
const { createClient } = await import('@supabase/supabase-js')
const anon = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.EXPO_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const svc = createClient(env.EXPO_PUBLIC_SUPABASE_URL, serviceRoleKey(), { auth: { persistSession: false } })
async function probe(label) {
  const { count: seen, error: e1 } = await anon.from('hotels').select('id', { count: 'exact', head: true })
  const hits = []
  for (const q of ['Acapulco', 'Almond Holiday', 'Mimoza Hotel']) {
    const { data, error } = await anon.rpc('search_content', { query: q })
    if (error) throw error
    hits.push(`${q}: ${data.length} rows [${[...new Set(data.map(r => r.module))].join(',') || '-'}]`)
  }
  console.log(`${label} · anon sees ${seen ?? e1?.message} hotels · search_content: ${hits.join(' · ')}`)
}
const { data: all, error, count } = await svc.from('hotels').select('id,is_active,delisted_at,geocode_source', { count: 'exact' })
if (error) throw error
if (all.length !== count) throw new Error(`partial ${all.length}/${count}`)
const listed = all.filter(r => !r.delisted_at)
const by = k => listed.reduce((m, r) => (m[r[k] ?? 'none'] = (m[r[k] ?? 'none'] || 0) + 1, m), {})
console.log(`hotels ${all.length} · listed ${listed.length} · active ${JSON.stringify(by('is_active'))} · source ${JSON.stringify(by('geocode_source'))}`)
await probe('BEFORE')
if (mode === '--dry') { console.log(`DRY: would set is_active=true on ${listed.filter(r => !r.is_active).length} rows`); process.exit(0) }
const target = mode === '--apply'
const ids = listed.filter(r => r.is_active !== target).map(r => r.id)
const { data: upd, error: ue } = await svc.from('hotels').update({ is_active: target }).in('id', ids).select('id')
if (ue) throw ue
console.log(`${mode.slice(2).toUpperCase()}: ${upd.length}/${ids.length} rows set is_active=${target}`)
if (upd.length !== ids.length) throw new Error('row count mismatch')
await probe('AFTER')
