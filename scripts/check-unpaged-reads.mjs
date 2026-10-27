// Guard: no UNPAGED supabase-js read of a table that grows with users or content.
//
//   node scripts/check-unpaged-reads.mjs            # scan supabase/functions/** and scripts/**; exit 1 on a finding
//   node scripts/check-unpaged-reads.mjs --self-test
//
// WHY. PostgREST's server-side `max-rows` (1000) silently truncates a plain `.select()`: no error, just fewer rows.
// On 2026-10-27 the duty push read `profiles` that way; every later user past 1000 would have been skipped without a
// trace (CLAUDE.md verification principle 12: compare `count: 'exact'` to rows received, never `rows >= cap`).
//
// WHAT IT FLAGS: `.from('<table>')` immediately followed by `.select(` for a table in GROWING below, unless the whole
// chain (and the wrapper call it sits in) carries one of:
//   .range(                              a paging loop
//   readAllRows / readAllResult /        the repo's paging helpers, but only when the read sits INSIDE the helper's
//                                        argument list (a helper call on the line above exempts nothing) (scripts/lib/read-all-rows.mjs,
//   readAllById / fetchAll               send-duty-notification/page.ts, check-notify-health.mjs fetchAll: all compare
//                                        the exact count to the rows received and refuse a shortfall)
//   .limit(N)  with a LITERAL N <= 1000 bounded by the caller (.limit(1) newest-row probes)
//   .maybeSingle() / .single()           at most one row
//   head: true                           a count, no rows
//   count: 'exact' + a comparison        a single read that asks for the exact count and, right after, compares it to the
//                                        the read's OWN rows received (`rows.length !== count` for the `const { data: rows, count }` of that same call): principle 12 applied inline
//   .eq('id', …)                         primary-key lookup, at most one row
//   // unpaged-ok: <reason>              on the statement or the line above, for a table that is bounded for a reason
//                                        you can state (the reason is the review).
//
// THE LIST (derived, not remembered): a table is here if it holds one row per USER or per user ACTION (profiles,
// notifications, push_log, messages, conversations, checkins, reviews, appointments, eatery_orders, content_reports,
// moderation_rejections, route_medals, student_education, *_waitlist, claim_requests, facility_change_requests,
// job_postings, quiz_submissions, contact_events, app_update_events, apple_refresh_tokens), or one row per synced
// CONTENT item or log line that only ever grows (events, properties, property_images, walking_legs, hotels,
// announcements, google_place_pins, match_events, api_request_log, duty_push_runs). The script also checks every
// listed name appears in supabase/migrations, so a typo or a renamed table cannot silently disarm the guard.
//
// WHAT IT CANNOT SEE (honest list):
//   - a dynamic table name (`.from(table)`, `.from(\`x_${n}\`)`): only string literals are matched;
//   - the app client (screens/, utils/, App.js): out of scope by design, those reads are RLS-scoped per user;
//   - a chain built across statements (`let q = sb.from('t'); q = q.select(…)`): the `.select` is not adjacent;
//   - PostgREST reads that bypass supabase-js (raw `fetch(.../rest/v1/<table>)`, e.g. check-*.mjs probes);
//   - RPC results (`.rpc(...)`), which have their own caps inside the SQL function;
//   - whether a `.range(` loop actually advances (the paging helpers are unit-tested separately);
//   - a table that is NOT on the list but has grown: the list is a judgement, extend it when a table becomes large;
//   - SQL inside Postgres (functions, cron): max-rows applies only to PostgREST, so it is not affected.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { resolve, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const GROWING = [
  'profiles', 'notifications', 'push_log', 'messages', 'conversations', 'checkins', 'reviews', 'appointments',
  'eatery_orders', 'content_reports', 'moderation_rejections', 'route_medals', 'student_education', 'module_waitlist',
  'esim_waitlist', 'claim_requests', 'facility_change_requests', 'job_postings', 'quiz_submissions', 'contact_events',
  'app_update_events', 'apple_refresh_tokens',
  'events', 'properties', 'property_images', 'walking_legs', 'hotels', 'announcements', 'google_place_pins',
  'match_events', 'api_request_log', 'duty_push_runs',
]

const FROM = /\.from\(\s*(['"`])(\w+)\1\s*\)\s*\.select\(/g
const HELPERS = /\b(readAllRows|readAllResult|readAllById|fetchAll)\b/

// The text of the call chain starting at `.from(`: until the enclosing call closes, a `;` at depth 0, or a newline at
// depth 0 whose next non-blank line does not continue the chain with `.`.
function chainFrom(text, start) {
  let depth = 0
  let q = null // inside a string literal: its parens/brackets/braces do not count (blankComments does the same)
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue }
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') { if (--depth < 0) return text.slice(start, i) }
    else if (ch === ';' && depth === 0) return text.slice(start, i)
    else if (ch === '\n' && depth === 0) {
      const rest = text.slice(i + 1).match(/^\s*(\S)/)
      if (!rest || rest[1] !== '.') return text.slice(start, i)
    }
  }
  return text.slice(start)
}

const stripComments = s => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

// Same text with every COMMENT blanked to spaces (newlines kept), so offsets line up with the original and a
// commented-out `.from('profiles').select(` cannot match. String literals are skipped, so `'https://x'` survives.
// The original text is still searched for `unpaged-ok:` (that marker lives in a comment).
export function blankComments(text) {
  // modes: 'code', or a string quote; a template literal can nest code in ${ } (tracked with a stack, so
  // `a ${b ? `c` : d}` does not desynchronise the scanner and swallow the comments after it)
  let out = '', i = 0
  const stack = [] // entries: { mode: 'tpl' } | { mode: 'code', braces: n } for ${ } bodies
  let mode = 'code', q = null, braces = 0
  while (i < text.length) {
    const ch = text[i], nx = text[i + 1]
    if (mode === 'str') {
      out += ch
      if (ch === '\\') { out += nx ?? ''; i += 2; continue }
      if (ch === q) mode = stack.length ? 'tpl-or-code' : 'code'
      i++
      if (mode === 'tpl-or-code') mode = 'code'
    } else if (mode === 'tpl') {
      out += ch
      if (ch === '\\') { out += nx ?? ''; i += 2; continue }
      if (ch === '`') { mode = stack.length ? stack.pop().back : 'code'; i++; continue }
      if (ch === '$' && nx === '{') { out += '{'; stack.push({ back: 'tpl', braces }); braces = 0; mode = 'code'; i += 2; continue }
      i++
    } else if (ch === '/' && nx === '/') {
      while (i < text.length && text[i] !== '\n') { out += ' '; i++ }
    } else if (ch === '/' && nx === '*') {
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) { out += text[i] === '\n' ? '\n' : ' '; i++ }
      if (i < text.length) { out += '  '; i += 2 }
    } else {
      if (ch === "'" || ch === '"') { mode = 'str'; q = ch }
      else if (ch === '`') mode = 'tpl'
      else if (ch === '{') braces++
      else if (ch === '}') {
        if (braces === 0 && stack.length) { const e = stack.pop(); braces = e.braces; mode = e.back; out += ch; i++; continue }
        braces--
      }
      out += ch
      i++
    }
  }
  return out
}

// The callee names of every call whose ARGUMENT LIST contains `index` (innermost first). A completed earlier statement
// (`const a = await readAllRows(p)`) is a matched pair and never counts; only an UNCLOSED `(` before `index` does.
// So a helper only exempts a read that sits inside its arguments, not one on the next line.
function enclosingCallees(text, index, limit = 1500) {
  const out = []
  let depth = 0
  for (let i = index - 1; i >= Math.max(0, index - limit); i--) {
    const ch = text[i]
    if (ch === ')' || ch === ']' || ch === '}') depth++
    else if (ch === '(' || ch === '[' || ch === '{') {
      if (depth > 0) { depth--; continue }
      if (ch === '(') {
        const name = text.slice(Math.max(0, i - 60), i).match(/([A-Za-z_$][\w$.]*)\s*$/)
        out.push(name ? name[1].split('.').pop() : '')
      } else if (ch === '{') break // an enclosing block: a new statement scope, nothing above applies
    }
  }
  return out
}

// `const { data: rows, count: n } = await sb` directly before the `.from(`: the read's OWN rows/count variable names.
function ownResultNames(text, index) {
  const before = text.slice(Math.max(0, index - 300), index)
  const m = before.match(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*await\s+[\w.$]+\s*$/)
  if (!m) return null
  const props = Object.fromEntries(m[1].split(',').map(x => x.trim()).filter(Boolean).map(x => { const [k, v] = x.split(':').map(y => y.trim()); return [k, v || k] }))
  return props.data && props.count ? { rows: props.data, count: props.count } : null
}

export function scanText(original, file = '<memory>', tables = GROWING) {
  const text = blankComments(original)
  const findings = []
  FROM.lastIndex = 0
  let m
  while ((m = FROM.exec(text))) {
    const table = m[2]
    if (!tables.includes(table)) continue
    const lineStart = text.lastIndexOf('\n', m.index) + 1
    const line = text.slice(0, m.index).split('\n').length
    const chain = chainFrom(text, m.index)
    const chainOriginal = original.slice(m.index, m.index + chain.length)
    // The `unpaged-ok:` marker counts only (1) on the read's own line or inside its chain, or (2) in the run of PURE
    // comment lines directly above the statement (a `//` line; the first code line stops the walk). A trailing
    // comment on some other statement's line, or a marker above an EARLIER read, exempts nothing here.
    const startsDot = (a, b) => /^\s*\./.test(text.slice(a, b))
    let top = lineStart // top of the statement: hop over continuation lines (`  .from(` under `const x = await sb`)
    for (let k = 0; k < 4 && startsDot(top, text.indexOf('\n', top) === -1 ? text.length : text.indexOf('\n', top)) && top > 0; k++) {
      top = text.lastIndexOf('\n', top - 2) + 1
    }
    let aboveStart = top
    for (let k = 0; k < 6 && aboveStart > 0; k++) {
      const prev = text.lastIndexOf('\n', aboveStart - 2) + 1
      const orig = original.slice(prev, aboveStart).trim()
      if (!orig.startsWith('//')) break // a code line, a blank line, or a block comment: stop
      aboveStart = prev
    }
    const above = original.slice(aboveStart, top)
    const ownLine = original.slice(lineStart, m.index)
    const marker = /unpaged-ok:[ \t]*\S/
    if (marker.test(chainOriginal) || marker.test(ownLine) || marker.test(above)) continue

    const code = chain
    const lim = code.match(/\.limit\(\s*([^)]*?)\s*\)/)
    const insideHelper = enclosingCallees(text, m.index).some(n => HELPERS.test(n))
    const own = ownResultNames(text, m.index)
    const after = text.slice(m.index + chain.length, m.index + chain.length + 500)
    const countCompared = own && /count\s*:\s*['"`]exact['"`]/.test(chain) && !/head\s*:\s*true/.test(chain) &&
      new RegExp(`(\\b${own.rows}\\.length\\s*(!==?|<)\\s*${own.count}\\b|\\b${own.count}\\s*(!==?|>)\\s*${own.rows}\\.length)`).test(after)
    const ok =
      /\.range\(/.test(code) || insideHelper ||
      /\.(maybeSingle|single)\(/.test(code) || /head\s*:\s*true/.test(code) ||
      /\.eq\(\s*['"`]id['"`]/.test(code) || countCompared ||
      (lim && /^\d+$/.test(lim[1]) && Number(lim[1]) <= 1000)
    if (!ok) findings.push({ file, line, table, why: lim ? `.limit(${lim[1]}) is not a literal <= 1000` : 'no paging, no helper around it, no single-row/limit/head, no unpaged-ok' })
  }
  return findings
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (name === 'node_modules' || name === '.git') continue
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(mjs|js|cjs|ts)$/.test(name) && !/(^test-|_test\.|\.test\.)/.test(name) && name !== 'check-unpaged-reads.mjs') out.push(p)
  }
  return out
}

function migrationsText() {
  const dir = join(ROOT, 'supabase/migrations')
  return readdirSync(dir).filter(f => f.endsWith('.sql')).map(f => readFileSync(join(dir, f), 'utf8')).join('\n')
}

function main() {
  const files = [...walk(join(ROOT, 'supabase/functions')), ...walk(join(ROOT, 'scripts'))]
  const findings = files.flatMap(f => scanText(readFileSync(f, 'utf8'), relative(ROOT, f)))
  const mig = migrationsText()
  const unknown = GROWING.filter(t => !new RegExp(`(public\\.|")${t}\\b`).test(mig))
  let bad = 0
  for (const t of unknown) { bad++; console.error(`  ✗ GROWING lists "${t}" but no migration mentions it: renamed or typo, the guard would be disarmed for it`) }
  for (const f of findings) {
    bad++
    console.error(`  ✗ ${f.file}:${f.line}  unpaged read of "${f.table}" (${f.why})`)
  }
  if (bad) {
    console.error(`\n  PostgREST max-rows (1000) silently truncates an unpaged select. Page it (readAllRows/readAllResult/readAllById, or a .range loop with count: 'exact' compared to rows received), bound it (.limit(N<=1000), .maybeSingle()), or add \`// unpaged-ok: <reason>\`.`)
    process.exit(1)
  }
  console.log(`unpaged-reads guard: OK — ${files.length} files scanned, ${GROWING.length} growing tables, 0 findings (blind spots: see the header of this file)`)
}

function selfTest() {
  let failed = 0
  const t = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) failed++; console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`) }
  const n = src => scanText(src, 'x.mjs').length
  // RED: each of these must be flagged
  t('plain unpaged read of profiles', n(`const { data } = await sb.from('profiles').select('id')`), 1)
  t('unpaged read, multi-line chain', n(`const r = await sb\n  .from('events')\n  .select('id')\n  .eq('source', S)`), 1)
  t('.limit(5000) does not count (server cap wins)', n(`await sb.from('notifications').select('id').limit(5000)`), 1)
  t('.limit(REFRESH_BATCH) is not a literal', n(`await sb.from('google_place_pins').select('id').limit(REFRESH_BATCH)`), 1)
  t('double-quoted and template-literal names', n(`sb.from("push_log").select('*'); sb.from(\`hotels\`).select('*')`), 2)
  t('count requested but never compared is still unpaged', n(`const { data, count } = await sb.from('hotels').select('id', { count: 'exact' })\nconsole.log(data.length)`), 1)
  t('count compared to rows received (inline principle 12)', n(`const { data, error, count } = await sb.from('hotels').select('id', { count: 'exact' })\nif (error) fail(error)\nif (data.length !== count) fail('partial')`), 0)
  t('  ...with renamed variables', n(`const { data: existing, error, count: total } = await supabase.from('hotels')\n  .select('id', { count: 'exact' }).eq('source', S)\nif (total !== existing.length) fail('partial')`), 0)
  t('count without head is still a row read', n(`await sb.from('properties').select('id', { count: 'exact' }).eq('source', S)`), 1)
  t('REVIEW red: a helper call on the previous line exempts nothing', n(`const a = await readAllRows(p)\nconst { data } = await sb.from('profiles').select('id')`), 1)
  t('REVIEW red: a .limit(1) on the previous line exempts nothing', n(`const a = await sb.from('x').select('y').limit(1)\nconst { data } = await sb.from('profiles').select('id')`), 1)
  t('REVIEW red: a .maybeSingle() on the previous line exempts nothing', n(`const a = await sb.from('x').select('y').maybeSingle()\nconst { data } = await sb.from('profiles').select('id')`), 1)
  t('REVIEW red: comparing ANOTHER array to count does not make the read guarded', n(`const { data, count } = await sb.from('hotels').select('id', { count: 'exact' })\nif (other.length !== count) fail('x')`), 1)
  t('REVIEW red: a helper in an earlier, finished argument list', n(`foo(readAllRows(p), 1)\nconst { data } = await sb.from('profiles').select('id')`), 1)
  t('QA red 1: a finished readAllResult statement above', n(`const a = await readAllResult((x, y) => sb.from('events').select('id',{count:'exact'}).order('id').range(x, y))\nconst b = await sb.from('profiles').select('id')`), 1)
  t('QA red 2: a finished .range statement above', n(`const a = await sb.from('events').select('id').range(0,9)\nconst b = await sb.from('profiles').select('id')`), 1)
  t('QA red 3: a helper NAME mentioned earlier, then unrelated statements', n(`const x = readAllRows\nconst y = 1\nfoo(y)\nconst r = await sb.from('profiles').select('id')`), 1)
  t('a commented-out read is not flagged (line and block comments)', n(`// const r = await sb.from('profiles').select('id')\n/* sb.from('events').select('id') */\nconst ok = 1`), 0)
  t('  ...a URL string with // does not hide a read after it', n(`const u = 'https://x.y'; const r = await sb.from('profiles').select('id')`), 1)
  t('unpaged-ok WITH a reason still exempts', n(`// unpaged-ok: bounded by .in() of one page\nconst r = await sb.from('profiles').select('id').in('id', ids)`), 0)
  t('unpaged-ok with an EMPTY reason is rejected', n(`// unpaged-ok:\nconst r = await sb.from('profiles').select('id')`), 1)
  t('unpaged-ok: followed by a NEWLINE then more comment is still empty', n(`// unpaged-ok:\n// see above\nconst r = await sb.from('profiles').select('id')`), 1)
  t('unpaged-ok: with only spaces after is rejected', n(`// unpaged-ok:   \nconst r = await sb.from('profiles').select('id')`), 1)
  t('REVIEW red: a trailing unpaged-ok on an UNRELATED statement above exempts nothing', n(`const x = 1 // unpaged-ok: unrelated\nconst r = await sb.from('profiles').select('id')`), 1)
  t('REVIEW red: one unpaged-ok exempts only the FIRST read after it', n(`// unpaged-ok: this one is bounded\nconst a = await sb.from('events').select('id')\nconst r = await sb.from('profiles').select('id')`), 1)
  t('REVIEW red: a ( inside a string does not swallow a later .range', n(`const a = await sb.from('profiles').select('id, note(')\nfoo.bar(1).range(0, 9)`), 1)
  t('unpaged-ok above a multi-line statement head still works', n(`// unpaged-ok: bounded alarm query\nconst { data } = await sb\n  .from('events')\n  .select('id')`), 0)
  t('unpaged-ok trailing on the read\'s own line works', n(`const r = await sb.from('profiles').select('id') // unpaged-ok: one page of ids`), 0)
  t('a nested template literal does not desynchronise comment blanking', n("const m = `a ${x ? `b` : 'c'} d`\n// const r = await sb.from('profiles').select('id')\nconst ok = 1"), 0)
  t('  ...nor hide a real read after it', n("const m = `a ${x ? `b` : 'c'} d`\nconst r = await sb.from('profiles').select('id')"), 1)
  // GREEN: each of these must pass (positive controls: the guard is not just refusing everything)
  t('.range loop', n(`await sb.from('profiles').select('id', { count: 'exact' }).order('id').range(a, b)`), 0)
  t('wrapped in readAllResult', n(`await readAllResult((a, b) => sb\n  .from('events').select('id', { count: 'exact' }).order('id').range(a, b))`), 0)
  t('wrapped in fetchAll', n(`fetchAll('admins', sb.from('profiles')\n  .select('id', { count: 'exact' }).eq('role', 'admin'))`), 0)
  t('.limit(1)', n(`await sb.from('events').select('last_seen_at').order('last_seen_at').limit(1)`), 0)
  t('.maybeSingle()', n(`await sb.from('profiles').select('id').eq('x', 1).maybeSingle()`), 0)
  t('head count', n(`await sb.from('hotels').select('id', { count: 'exact', head: true })`), 0)
  t('primary-key lookup', n(`await sb.from('profiles').select('push_token').eq('id', uid)`), 0)
  t('unpaged-ok on the line above', n(`// unpaged-ok: bounded by .limit(REFRESH_BATCH)\nawait sb.from('google_place_pins').select('id').limit(REFRESH_BATCH)`), 0)
  t('a table not on the list is not this guard\'s business', n(`await sb.from('duty_list').select('name')`), 0)
  t('a dynamic table name is a stated blind spot', n(`await sb.from(table).select('id')`), 0)
  t('an update chain is not a read', n(`await sb.from('events').update({ a: 1 }).eq('source', S).select('id')`), 0)
  // the real repo reads, mutated: take a paged call and remove its paging
  const real = readFileSync(join(ROOT, 'scripts/verify-novest-import.mjs'), 'utf8')
  t('real repo file: paged as committed', scanText(real, 'verify-novest-import.mjs').length, 0)
  const broken = real.replace(/\.order\('id'\)\.range\(a, b\)\)/g, ')').replace(/readAllResult\(\(a, b\) => /g, '')
  t('real repo file with its paging removed is flagged', scanText(broken, 'verify-novest-import.mjs').length > 0, true)
  console.log(failed ? `\n${failed} FAILED` : '\nall passed')
  process.exit(failed ? 1 : 0)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.argv.includes('--self-test') ? selfTest() : main()
}
