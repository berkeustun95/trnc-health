// The server's terms floor (public.i_have_marketplace_terms, 20261190) and the client's MARKETPLACE_TERMS_MIN must be the same date,
// or the gate and the server disagree: the client lets a post through that the server refuses (TERMS_REQUIRED backstop), or asks
// people who are fine. Reads the LATEST migration that defines the helper (by name order), never a hard-coded file. A missing
// helper or an unreadable floor FAILS; it never skips.
const fs = require('fs')
const path = require('path')
const { MARKETPLACE_TERMS_MIN, LEGAL_VERSION, needsMarketplaceTerms } = require('../constants/legal')

const DIR = path.join(__dirname, '..', 'supabase', 'migrations')
const DEF = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?i_have_marketplace_terms\s*\(/gi
const FLOOR = /terms_version COLLATE "C" >= '(\d{4}-\d{2}-\d{2})'/g

// files: [{ name, text }]. Returns the floor literal of the last definition of the helper, or throws with the raw values.
function serverFloor(files) {
  const defs = files.filter(f => { DEF.lastIndex = 0; return DEF.test(f.text) }).sort((a, b) => (a.name < b.name ? -1 : 1))
  if (!defs.length) throw new Error(`no migration defines i_have_marketplace_terms (scanned ${files.length} files)`)
  const last = defs[defs.length - 1]
  DEF.lastIndex = 0
  let start = -1
  for (let m; (m = DEF.exec(last.text)); ) start = m.index          // the last definition inside that file
  const rest = last.text.slice(start)
  const open = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(rest)
  if (!open) throw new Error(`${last.name}: no AS $tag$ body after the helper definition: ${JSON.stringify(rest.slice(0, 200))}`)
  const bodyStart = open.index + open[0].length
  const bodyEnd = rest.indexOf(open[1], bodyStart)
  if (bodyEnd < 0) throw new Error(`${last.name}: the helper body ${open[1]} is never closed`)
  const body = rest.slice(bodyStart, bodyEnd)
  const floors = [...body.matchAll(FLOOR)].map(m => m[1])
  const anyDates = body.match(/'\d{4}-\d{2}-\d{2}'/g) || []
  if (floors.length !== 1 || anyDates.length !== 1) {
    throw new Error(`${last.name}: expected exactly one floor literal (terms_version COLLATE "C" >= 'YYYY-MM-DD'), got ${floors.length} floors / ${anyDates.length} date literals. Body: ${JSON.stringify(body)}`)
  }
  return { floor: floors[0], file: last.name }
}

const repoFiles = () => fs.readdirSync(DIR).filter(n => n.endsWith('.sql')).map(name => ({ name, text: fs.readFileSync(path.join(DIR, name), 'utf8') }))

test('the SQL floor equals MARKETPLACE_TERMS_MIN', () => {
  const { floor, file } = serverFloor(repoFiles())
  expect({ sqlFloor: floor, clientFloor: MARKETPLACE_TERMS_MIN, file }).toEqual({ sqlFloor: MARKETPLACE_TERMS_MIN, clientFloor: MARKETPLACE_TERMS_MIN, file })
})

const HELPER = floor => `CREATE OR REPLACE FUNCTION public.i_have_marketplace_terms() RETURNS boolean AS $function$
  SELECT coalesce((SELECT p.terms_version IS NOT NULL AND p.terms_version COLLATE "C" >= '${floor}' FROM profiles p), false);
$function$;`
test('the scan takes the LAST definition in name order', () => {
  const files = [{ name: '20261300_b.sql', text: HELPER('2027-01-01') }, { name: '20261190_a.sql', text: HELPER('2026-11-11') }, { name: '20261100_c.sql', text: 'select 1;' }]
  expect(serverFloor(files)).toEqual({ floor: '2027-01-01', file: '20261300_b.sql' })
})
test('hard fails, with the raw values, when no migration defines the helper', () => {
  expect(() => serverFloor([{ name: '20261190_a.sql', text: 'select i_have_marketplace_terms();' }])).toThrow(/no migration defines i_have_marketplace_terms/)
})
test('hard fails when the floor is not in the strict form, or there are two', () => {
  const loose = HELPER('2026-11-11').replace('COLLATE "C" >=', '>=')
  expect(() => serverFloor([{ name: '20261190_a.sql', text: loose }])).toThrow(/exactly one floor literal.*Body:/)
  const two = HELPER('2026-11-11').replace('FROM profiles p', "FROM profiles p WHERE p.terms_version COLLATE \"C\" >= '2026-11-12'")
  expect(() => serverFloor([{ name: '20261190_a.sql', text: two }])).toThrow(/got 2 floors/)
})

// Client JS string compare (`terms < MIN`) vs SQL `terms COLLATE "C" >= floor`: both are bytewise on ASCII, so they agree for the
// values the app writes (YYYY-MM from LEGAL_VERSION, YYYY-MM-DD dates) and for the stored ones.
test('the client compare agrees with the SQL byte compare for the values the app writes', () => {
  const sqlOk = v => v != null && Buffer.compare(Buffer.from(v), Buffer.from(MARKETPLACE_TERMS_MIN)) >= 0
  for (const v of [null, '2026-09-20', '2026-10', '2026-11', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-12', '2027-01', '2027-01-01']) {
    expect({ v, due: needsMarketplaceTerms(v) }).toEqual({ v, due: !sqlOk(v) })
  }
})

// Accepting writes LEGAL_VERSION: a floor above it would re-ask forever.
test('the floor never exceeds LEGAL_VERSION (an accept must clear it)', () => {
  expect({ floor: MARKETPLACE_TERMS_MIN, legal: LEGAL_VERSION, ok: MARKETPLACE_TERMS_MIN <= LEGAL_VERSION }).toMatchObject({ ok: true })
})
