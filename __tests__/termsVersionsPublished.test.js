// The server holds ONE list of published terms versions (public.is_published_terms_version, 20261191) and ONE list of accepted
// languages (public.is_terms_locale). accept_terms() and the terms guard refuse anything not on them. So a LEGAL_VERSION bump
// committed WITHOUT a migration adding it would make every new acceptance fail (TERMS_VERSION_UNKNOWN) and re-ask every user on
// every launch. This test is the standing rule's guard: every version the client can write (LEGAL_VERSION and the two floors)
// must be in the NEWEST migration that defines the helper, and its language list must equal the LANGUAGES keys.
// It reads the helper BODY only: the file header lists versions in prose, and a whole-file match is not a probe.
// A missing helper or an unreadable list FAILS; it never skips.
const fs = require('fs')
const path = require('path')
const { LEGAL_VERSION, MARKETPLACE_TERMS_MIN, STUDENT_HUB_TERMS_MIN } = require('../constants/legal')
const { LANGUAGES } = require('../constants/i18n')

const DIR = path.join(__dirname, '..', 'supabase', 'migrations')

// Body of the LAST definition (in name order, last inside its file) of `public.<fn>(`, between its AS $tag$ … $tag$. Throws on a miss.
function lastBody(files, fn) {
  const def = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${fn}\\s*\\(`, 'gi')
  const defs = files.filter(f => { def.lastIndex = 0; return def.test(f.text) }).sort((a, b) => (a.name < b.name ? -1 : 1))
  if (!defs.length) throw new Error(`no migration defines ${fn} (scanned ${files.length} files)`)
  const last = defs[defs.length - 1]
  def.lastIndex = 0
  let start = -1
  for (let m; (m = def.exec(last.text)); ) start = m.index
  const rest = last.text.slice(start)
  const open = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(rest)
  if (!open) throw new Error(`${last.name}: no AS $tag$ body after ${fn}`)
  const from = open.index + open[0].length
  const to = rest.indexOf(open[1], from)
  if (to < 0) throw new Error(`${last.name}: the ${fn} body is never closed`)
  return { body: rest.slice(from, to), file: last.name }
}
const literals = body => [...body.matchAll(/'([^']*)'/g)].map(m => m[1])

const repoFiles = () => fs.readdirSync(DIR).filter(n => n.endsWith('.sql')).map(name => ({ name, text: fs.readFileSync(path.join(DIR, name), 'utf8') }))

test('every version the client can write is on the server\'s published list', () => {
  const { body, file } = lastBody(repoFiles(), 'is_published_terms_version')
  const list = literals(body)
  expect(list.length).toBeGreaterThan(10)
  expect({ file, missing: [LEGAL_VERSION, MARKETPLACE_TERMS_MIN, STUDENT_HUB_TERMS_MIN].filter(v => !list.includes(v)) }).toEqual({ file, missing: [] })
})

test('the server\'s language list equals the LANGUAGES keys, as full English names', () => {
  const { body, file } = lastBody(repoFiles(), 'is_terms_locale')
  const list = literals(body)
  expect({ file, list }).toEqual({ file, list: LANGUAGES.map(l => l.key) })
  expect(list.some(l => /^(tr|en)$/i.test(l))).toBe(false)
})

// The scan itself: the LAST definition wins, the body only is read, a miss throws.
const HELPER = (versions, header = '') => `${header}\nCREATE OR REPLACE FUNCTION public.is_published_terms_version(p_version text) RETURNS boolean AS $function$\n  SELECT p_version = ANY (ARRAY[${versions.map(v => `'${v}'`).join(', ')}]::text[]);\n$function$;`
test('the scan takes the LAST definition in name order, and reads its body only', () => {
  const files = [
    { name: '20261300_b.sql', text: HELPER(['2026-11-11', '2027-01-01'], "-- header mentions '2099-01-01' and '2026-08'") },
    { name: '20261191_a.sql', text: HELPER(['2026-11-11']) },
    { name: '20261100_c.sql', text: 'select 1;' },
  ]
  const { body, file } = lastBody(files, 'is_published_terms_version')
  expect({ file, list: literals(body) }).toEqual({ file: '20261300_b.sql', list: ['2026-11-11', '2027-01-01'] })
})
test('a missing helper fails with the raw count, it does not skip', () => {
  expect(() => lastBody([{ name: '20261191_a.sql', text: 'select is_published_terms_version(null);' }], 'is_published_terms_version')).toThrow(/no migration defines is_published_terms_version/)
})
test('a bump with no migration is caught: a version missing from the newest definition is reported', () => {
  const { body } = lastBody([{ name: '20261191_a.sql', text: HELPER(['2026-11-11']) }], 'is_published_terms_version')
  expect(['2026-11-11', '2026-12-01'].filter(v => !literals(body).includes(v))).toEqual(['2026-12-01'])
})
