#!/usr/bin/env node
// ─── Schema drift audit generator ────────────────────────────────────────────
//
//   node scripts/audit-schema-drift.mjs          # regenerate supabase/schema_drift_audit.sql
//   node scripts/audit-schema-drift.mjs --print  # also dump the parsed repo model
//
// Replays every DDL statement in supabase/ and supabase/migrations/ to build the
// schema the repo CLAIMS, then emits a READ-ONLY SQL script that compares the live
// database against it and returns only the disagreements.
//
// WHY A COMMITTED SCRIPT: the first version lived in a scratch directory, which is the
// same mistake scripts/prepare-gisekibris-feed.mjs exists to stop. A generated
// artifact whose generator is not in the repo cannot be reproduced or trusted twice.
//
// WHY NOT JUST verify_schema.sql: that checks a hand-maintained REGISTER, so anything
// that drifted before somebody registered it is invisible to it by construction —
// which is how events.organizer_id sat NOT NULL in the repo and nullable in the
// database for weeks. This derives expectations from the migrations themselves.
//
// ─── FOUR BUGS THIS PARSER HAD, AND WHY THEY MATTER ──────────────────────────
// The first run of this tool produced ~70 false positives. Every one was a parser
// defect, not drift. A tool whose output has to be hand-filtered is worse than no
// tool, because the filtering is the judgement it was supposed to automate.
//
// 1. DROP-THEN-CREATE READ AS "DROPPED". Migrations use
//        DROP CONSTRAINT IF EXISTS x;  ADD CONSTRAINT x …
//    for idempotency. The old code collected drops into a set and subtracted them from
//    the adds regardless of ORDER, so every idempotently-recreated constraint vanished
//    from the expected list and then showed up as live-only. Now every add/drop is
//    recorded as an ordered event and the LAST one wins.
//
// 2. INLINE CONSTRAINTS NEVER PARSED. The repo writes
//        status text CHECK (status IN (…))
//    with no name; Postgres auto-names it events_status_check. Only explicit
//    ADD CONSTRAINT was collected, so every inline CHECK/UNIQUE/PK/FK in every
//    CREATE TABLE read as live-only — ~60 rows. Now inline and table-level
//    constraints are parsed and Postgres's own naming rule is replicated.
//
// 3. ROOT FILES SORTED ALPHABETICALLY, so beaches_landmarks_desc_jsonb.sql (which does
//    ALTER COLUMN description TYPE JSONB) was replayed BEFORE
//    beaches_landmarks_migration.sql (which CREATEs the table with description TEXT).
//    The ALTER hit a nonexistent table, the CREATE then won, and two live jsonb
//    columns read as drift. Now the replay is two-phase: every CREATE TABLE first,
//    then every ALTER, so a table always exists before it is altered.
//
// 4. TRUNCATED TYPE NAMES. `double precision` was captured as `double`, so 9 columns
//    read as type drift. Multi-word type names are now matched as units.
//
// ─── KNOWN LIMITS — "zero rows" must not be read as more than this ───────────
//   • Constraint bodies are compared by LITERAL SIGNATURE (section K): the sorted set
//     of quoted strings and numbers in the definition. Postgres rewrites expressions
//     (`x IN ('a','b')` becomes `x = ANY (ARRAY['a'::text,'b'::text])`), so comparing
//     definition text directly is all false positives. The signature is stable across
//     that rewriting and still catches the cases that matter: a widened bound
//     (500 → 2500) or a changed enum member. It will NOT catch a change that preserves
//     every literal, e.g. `<=` flipped to `<`.
//   • Types (section T) are compared loosely; precision and domain differences may not
//     surface.
//   • Policies, triggers, functions and views are out of scope for this pass.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'supabase/schema_drift_audit.sql')

const files = [
  ...readdirSync(resolve(ROOT, 'supabase')).filter(f => f.endsWith('.sql')).sort()
    .map(f => `supabase/${f}`),
  ...readdirSync(resolve(ROOT, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort()
    .map(f => `supabase/migrations/${f}`),
].filter(f => !/verify_schema|schema_drift_audit|_seed|dummy_listing/.test(f))

// ─── SQL text helpers ────────────────────────────────────────────────────────

function blank(sql) {
  let out = '', i = 0
  while (i < sql.length) {
    if (sql.startsWith('--', i)) {
      const j = sql.indexOf('\n', i), end = j === -1 ? sql.length : j
      out += ' '.repeat(end - i); i = end
    } else if (sql.startsWith('/*', i)) {
      const j = sql.indexOf('*/', i), end = j === -1 ? sql.length : j + 2
      out += ' '.repeat(end - i); i = end
    } else if (sql.startsWith('$$', i)) {
      const j = sql.indexOf('$$', i + 2), end = j === -1 ? sql.length : j + 2
      out += ' '.repeat(end - i); i = end
    } else if (sql[i] === "'") {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2
        else if (sql[j] === "'") { j++; break }
        else j++
      }
      out += sql.slice(i, j).replace(/\n/g, ' '); i = j
    } else { out += sql[i]; i++ }
  }
  return out
}

function splitTopLevel(body) {
  const parts = []; let depth = 0, cur = '', instr = false
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (instr) { cur += c; if (c === "'" && body[i + 1] !== "'") instr = false; continue }
    if (c === "'") { instr = true; cur += c; continue }
    if (c === '(') depth++
    if (c === ')') depth--
    if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue }
    cur += c
  }
  if (cur.trim()) parts.push(cur)
  return parts.map(p => p.trim()).filter(Boolean)
}

// Balanced-paren slice starting at the '(' that follows `from`.
function parenSlice(s, from) {
  const open = s.indexOf('(', from)
  if (open === -1) return null
  let depth = 0, i = open, instr = false
  for (; i < s.length; i++) {
    const c = s[i]
    if (instr) { if (c === "'" && s[i + 1] !== "'") instr = false; continue }
    if (c === "'") { instr = true; continue }
    if (c === '(') depth++
    else if (c === ')') { depth--; if (depth === 0) return { body: s.slice(open + 1, i), end: i + 1 } }
  }
  return null
}

const tblName = t => t.replace(/^public\./i, '').replace(/"/g, '').trim().toLowerCase()
const colName = c => c.replace(/"/g, '').toLowerCase()

function parseDefault(def) {
  const m = def.match(/\bDEFAULT\s+(.+?)(?=\s+(?:NOT\s+NULL|NULL|CHECK|REFERENCES|PRIMARY|UNIQUE|GENERATED|COLLATE)\b|$)/is)
  return m ? m[1].trim().replace(/,$/, '') : null
}

// Multi-word type names must be matched as units — capturing only the first token
// turned `double precision` into `double` and reported 9 columns as drift.
const MULTIWORD_TYPES = [
  'timestamp with time zone', 'timestamp without time zone',
  'time with time zone', 'time without time zone',
  'double precision', 'character varying', 'bit varying',
]

function extractType(rest) {
  const s = rest.trim()
  const lower = s.toLowerCase()
  for (const mw of MULTIWORD_TYPES) {
    if (lower.startsWith(mw)) {
      const after = s.slice(mw.length)
      return mw + (/^\s*\[\s*\]/.test(after) ? '[]' : '')
    }
  }
  const m = s.match(/^([\w"]+)(\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?(\s*\[\s*\])?/)
  if (!m) return s.split(/\s+/)[0]
  return (m[1] + (m[2] ?? '') + (m[3] ? '[]' : '')).replace(/\s+/g, '')
}

function normType(raw) {
  let t = String(raw).trim().toLowerCase().replace(/\s+/g, ' ')
  const arr = /\[\]$/.test(t)
  if (arr) t = t.replace(/\s*\[\s*\]$/, '')
  t = t.replace(/\(\s*\d+\s*(,\s*\d+\s*)?\)/, '')      // drop precision
  const alias = {
    timestamptz: 'timestamp with time zone', timestamp: 'timestamp without time zone',
    timetz: 'time with time zone', serial: 'integer', bigserial: 'bigint',
    bool: 'boolean', int: 'integer', int2: 'smallint', int4: 'integer', int8: 'bigint',
    float4: 'real', float8: 'double precision', varchar: 'character varying',
    decimal: 'numeric', char: 'character',
  }
  t = alias[t] ?? t
  return t + (arr ? '[]' : '')
}

// ─── Postgres constraint auto-naming ─────────────────────────────────────────
//
// Replicates heap.c/indexcmds.c: an unnamed constraint is named
//   {table}_{column}_check  when its expression references exactly ONE column
//   {table}_check           when it references zero or several
//   {table}_{cols…}_key     for UNIQUE
//   {table}_pkey            for PRIMARY KEY
//   {table}_{cols…}_fkey    for FOREIGN KEY
// with a numeric suffix on collision. Without this, every inline CHECK in the repo
// looked like an unregistered live constraint.
function autoName(table, cols, kind, taken) {
  const base = cols.length ? `${table}_${cols.join('_')}_${kind}` : `${table}_${kind}`
  let name = base.slice(0, 63)
  let n = 1
  while (taken.has(name)) name = `${base.slice(0, 63 - String(n).length)}${n++}`
  return name
}

// Which of this table's columns does a CHECK expression mention?
function colsInExpr(expr, knownCols) {
  const found = new Set()
  for (const m of expr.matchAll(/\b([a-z_][a-z0-9_]*)\b/gi)) {
    const w = m[1].toLowerCase()
    if (knownCols.has(w)) found.add(w)
  }
  return [...found]
}

// Signature = sorted distinct quoted strings + numbers in a definition. Postgres
// rewrites expressions, so comparing definition text is hopeless; literals survive it.
//
// TWO RULES THE SQL SIDE MUST MATCH EXACTLY, both learned the hard way:
//
// CASE IS PRESERVED. An earlier version lowercased both sides, which turned the regex
// literal '^[a-zA-Z]{2,40}$' into '^[a-za-z]{2,40}$'. That was not merely ugly in the
// report — it made the check BLIND to a genuine case-sensitive change, e.g. a regex
// narrowed from [a-zA-Z] to [a-z]. A false negative in a drift detector is worse than
// a false positive, because nothing prompts anyone to look.
//
// SORT IS BYTE ORDER. This sorts by UTF-16 code unit (JS default); the SQL side must
// use `ORDER BY x COLLATE "C"` to get the same sequence. Under the database's default
// collation Postgres weights punctuation differently, so the SAME set of literals
// serialised to a different ORDER and every signature containing '^' or '{' mismatched
// — which is exactly what put module_waitlist_module_check and
// events_description_i18n_check in section K when nothing was wrong with them.
// (Caveat: JS code-unit order and COLLATE "C" byte order agree on ASCII, which is all
// a constraint body has ever contained here. Non-ASCII literals could diverge.)
function litSig(def) {
  const out = new Set()
  for (const m of String(def).matchAll(/'((?:[^']|'')*)'/g)) out.add(m[1].replace(/''/g, "'"))
  for (const m of String(def).matchAll(/\b(\d+(?:\.\d+)?)\b/g)) out.add(m[1])
  return [...out].sort().join('|')
}

// Inline constraints written on a single column, from EITHER a CREATE TABLE column
// definition or an ALTER TABLE ADD COLUMN. Both spellings produce identically
// auto-named constraints in Postgres, and missing the ADD COLUMN case is what put
// claim_requests_verified_by_fkey, job_postings_poster_type_check and
// job_postings_payment_status_check in section F as phantom live-only constraints.
function inlineConstraintsFor(table, col, rest) {
  const out = []
  const named = rest.match(/\bCONSTRAINT\s+([\w"]+)\s+CHECK\b/i)
  const chk = /\bCHECK\s*\(/i.exec(rest)
  if (chk) {
    const sl = parenSlice(rest, chk.index)
    if (sl) out.push({ name: named ? colName(named[1]) : null, kind: 'check', cols: [col], body: `CHECK (${sl.body})` })
  }
  if (/\bPRIMARY\s+KEY\b/i.test(rest)) out.push({ name: null, kind: 'pkey', cols: [col], body: 'PRIMARY KEY' })
  else if (/\bUNIQUE\b/i.test(rest)) out.push({ name: null, kind: 'key', cols: [col], body: 'UNIQUE' })
  if (/\bREFERENCES\b/i.test(rest)) out.push({ name: null, kind: 'fkey', cols: [col], body: 'FOREIGN KEY' })
  return out
}

// ─── Replay ──────────────────────────────────────────────────────────────────

const repo = {}                       // table -> col -> {type,notnull,default}
const conEvents = []                  // ordered {name, op:'add'|'drop', body}
const idxEvents = []                  // ordered {name, op:'add'|'drop'}
const ensure = t => (repo[t] ??= {})

const parsed = files.map(f => ({ f, sql: blank(readFileSync(resolve(ROOT, f), 'utf8')) }))

// ── Phase 1: every CREATE TABLE, so a table always exists before it is altered.
for (const { f, sql } of parsed) {
  const ctRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w".]+)\s*(?=\()/gi
  let m
  while ((m = ctRe.exec(sql))) {
    const t = tblName(m[1])
    const slice = parenSlice(sql, m.index + m[0].length)
    if (!slice) continue
    ctRe.lastIndex = slice.end
    const cols = ensure(t)
    const taken = new Set(conEvents.filter(e => e.op === 'add').map(e => e.name))
    const tableCons = []

    for (const part of splitTopLevel(slice.body)) {
      // Table-level constraint, named or not.
      const named = part.match(/^CONSTRAINT\s+([\w"]+)\s+([\s\S]+)$/i)
      const spec = named ? named[2] : part
      if (/^(PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY|EXCLUDE)\b/i.test(spec)) {
        tableCons.push({ name: named ? colName(named[1]) : null, spec })
        continue
      }
      if (named) { tableCons.push({ name: colName(named[1]), spec }); continue }

      // Column definition.
      const cm = part.match(/^([\w"]+)\s+([\s\S]+)$/)
      if (!cm) continue
      const c = colName(cm[1]), rest = cm[2]
      if (!cols[c]) {
        cols[c] = {
          type: normType(extractType(rest)),
          notnull: /\bNOT\s+NULL\b/i.test(rest) || /\bPRIMARY\s+KEY\b/i.test(rest),
          default: parseDefault(rest),
        }
      }
      // Inline constraints on this column.
      const inlineNamed = rest.match(/\bCONSTRAINT\s+([\w"]+)\s+CHECK\b/i)
      const chk = /\bCHECK\s*\(/i.exec(rest)
      if (chk) {
        const s = parenSlice(rest, chk.index)
        if (s) tableCons.push({ name: inlineNamed ? colName(inlineNamed[1]) : null, spec: `CHECK (${s.body})`, ownCol: c })
      }
      if (/\bPRIMARY\s+KEY\b/i.test(rest)) tableCons.push({ name: null, spec: 'PRIMARY KEY', pkCols: [c] })
      else if (/\bUNIQUE\b/i.test(rest)) tableCons.push({ name: null, spec: 'UNIQUE', uqCols: [c] })
      if (/\bREFERENCES\b/i.test(rest)) tableCons.push({ name: null, spec: 'FOREIGN KEY', fkCols: [c] })
    }

    // Name them the way Postgres would, now that every column of the table is known.
    const known = new Set(Object.keys(cols))
    for (const tc of tableCons) {
      let name = tc.name
      if (!name) {
        if (/^PRIMARY\s+KEY/i.test(tc.spec)) name = autoName(t, [], 'pkey', taken).replace(`${t}_pkey`, `${t}_pkey`)
        else if (/^UNIQUE/i.test(tc.spec)) {
          const cs = tc.uqCols ?? splitTopLevel(parenSlice(tc.spec, 0)?.body ?? '').map(colName)
          name = autoName(t, cs, 'key', taken)
        } else if (/^FOREIGN\s+KEY/i.test(tc.spec)) {
          const cs = tc.fkCols ?? splitTopLevel(parenSlice(tc.spec, 0)?.body ?? '').map(colName)
          name = autoName(t, cs, 'fkey', taken)
        } else if (/^CHECK/i.test(tc.spec)) {
          const body = parenSlice(tc.spec, 0)?.body ?? ''
          const cs = tc.ownCol ? [tc.ownCol] : colsInExpr(body, known)
          name = autoName(t, cs.length === 1 ? cs : [], 'check', taken)
        } else continue
      }
      if (/^PRIMARY\s+KEY/i.test(tc.spec) && !tc.name) name = `${t}_pkey`
      taken.add(name)
      conEvents.push({ name, op: 'add', body: tc.spec, from: f })
    }
  }
}

// ── Phase 2: every ALTER TABLE, plus index create/drop, in file order.
for (const { f, sql } of parsed) {
  const atRe = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([\w".]+)\s+([\s\S]*?);/gi
  let m
  while ((m = atRe.exec(sql))) {
    const t = tblName(m[1])
    for (const a of splitTopLevel(m[2])) {
      let am
      if ((am = a.match(/^ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w"]+)\s+([\s\S]+)$/i))) {
        const c = colName(am[1]), rest = am[2], cols = ensure(t)
        cols[c] ??= { type: null, notnull: false, default: null }
        cols[c].type ??= normType(extractType(rest))
        if (/\bNOT\s+NULL\b/i.test(rest)) cols[c].notnull = true
        const d = parseDefault(rest); if (d) cols[c].default = d
        // Inline CHECK / UNIQUE / PRIMARY KEY / REFERENCES on the added column.
        const taken = new Set(conEvents.filter(e => e.op === 'add').map(e => e.name))
        for (const ic of inlineConstraintsFor(t, c, rest)) {
          const name = ic.name ?? (ic.kind === 'pkey' ? `${t}_pkey` : autoName(t, ic.cols, ic.kind, taken))
          taken.add(name)
          conEvents.push({ name, op: 'add', body: ic.body, from: f })
        }
      } else if ((am = a.match(/^ALTER\s+(?:COLUMN\s+)?([\w"]+)\s+SET\s+NOT\s+NULL$/i))) {
        const c = ensure(t)[colName(am[1])]; if (c) c.notnull = true
      } else if ((am = a.match(/^ALTER\s+(?:COLUMN\s+)?([\w"]+)\s+DROP\s+NOT\s+NULL$/i))) {
        const c = ensure(t)[colName(am[1])]; if (c) c.notnull = false
      } else if ((am = a.match(/^ALTER\s+(?:COLUMN\s+)?([\w"]+)\s+SET\s+DEFAULT\s+([\s\S]+)$/i))) {
        const c = ensure(t)[colName(am[1])]; if (c) c.default = am[2].trim()
      } else if ((am = a.match(/^ALTER\s+(?:COLUMN\s+)?([\w"]+)\s+DROP\s+DEFAULT$/i))) {
        const c = ensure(t)[colName(am[1])]; if (c) c.default = null
      } else if ((am = a.match(/^ALTER\s+(?:COLUMN\s+)?([\w"]+)\s+(?:SET\s+DATA\s+)?TYPE\s+([\s\S]+)$/i))) {
        const c = ensure(t)[colName(am[1])]
        if (c) c.type = normType(extractType(am[2].split(/\s+USING\s+/i)[0]))
      } else if ((am = a.match(/^DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?([\w"]+)/i))) {
        delete repo[t]?.[colName(am[1])]
      } else if ((am = a.match(/^RENAME\s+COLUMN\s+([\w"]+)\s+TO\s+([\w"]+)/i))) {
        const cols = ensure(t), from = colName(am[1]), to = colName(am[2])
        if (cols[from]) { cols[to] = cols[from]; delete cols[from] }
      } else if ((am = a.match(/^ADD\s+CONSTRAINT\s+([\w"]+)\s+([\s\S]+)$/i))) {
        conEvents.push({ name: colName(am[1]), op: 'add', body: am[2], from: f })
      } else if ((am = a.match(/^ADD\s+(CHECK|UNIQUE|PRIMARY\s+KEY|FOREIGN\s+KEY)\b([\s\S]*)$/i))) {
        // Unnamed ALTER … ADD CHECK: Postgres auto-names it the same way.
        const kindWord = am[1].toUpperCase()
        const taken = new Set(conEvents.filter(e => e.op === 'add').map(e => e.name))
        const known = new Set(Object.keys(repo[t] ?? {}))
        let name
        if (kindWord === 'CHECK') {
          const body = parenSlice(a, a.toUpperCase().indexOf('CHECK'))?.body ?? ''
          const cs = colsInExpr(body, known)
          name = autoName(t, cs.length === 1 ? cs : [], 'check', taken)
        } else if (kindWord === 'UNIQUE') {
          const cs = splitTopLevel(parenSlice(a, a.toUpperCase().indexOf('UNIQUE'))?.body ?? '').map(colName)
          name = autoName(t, cs, 'key', taken)
        } else if (kindWord === 'PRIMARY KEY') name = `${t}_pkey`
        else {
          const cs = splitTopLevel(parenSlice(a, a.toUpperCase().indexOf('FOREIGN'))?.body ?? '').map(colName)
          name = autoName(t, cs, 'fkey', taken)
        }
        conEvents.push({ name, op: 'add', body: `${kindWord}${am[2]}`, from: f })
      } else if ((am = a.match(/^DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?([\w"]+)/i))) {
        conEvents.push({ name: colName(am[1]), op: 'drop', from: f })
      }
    }
  }
  // Collected WITH POSITIONS and sorted, not create-pass-then-drop-pass. Migrations
  // write `DROP INDEX IF EXISTS x; CREATE INDEX x …` for idempotency, and scanning all
  // creates before all drops inverts that inside a single file — which is what kept
  // appointments_active_slot_unique out of the expected set.
  const fileIdx = []
  for (const mm of sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([\w"]+)/gi))
    fileIdx.push({ at: mm.index, name: colName(mm[1]), op: 'add', from: f })
  for (const mm of sql.matchAll(/DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?(?:public\.)?([\w"]+)/gi))
    fileIdx.push({ at: mm.index, name: colName(mm[1]), op: 'drop', from: f })
  fileIdx.sort((a, b) => a.at - b.at)
  idxEvents.push(...fileIdx)
}

// LAST operation wins. This is the whole fix for drop-then-create idempotency: the old
// code subtracted a set of drops from a set of adds and lost every recreated object.
function settle(events) {
  const state = new Map()
  for (const e of events) state.set(e.name, e)
  return [...state.values()].filter(e => e.op === 'add')
}
const constraints = settle(conEvents).sort((a, b) => a.name.localeCompare(b.name))
const indexes = settle(idxEvents).map(e => e.name).sort()

// ─── Emitted-SQL validation ──────────────────────────────────────────────────

const PG_RESERVED = new Set(`
all analyse analyze and any array as asc asymmetric both case cast check collate
column constraint create current_catalog current_date current_role current_time
current_timestamp current_user default deferrable desc distinct do else end except
false fetch for foreign from grant group having in initially intersect into lateral
leading limit localtime localtimestamp not null offset on only or order placing
primary references returning select session_user some symmetric system_user table
then to trailing true union unique user using variadic when where window with
`.trim().split(/\s+/))

// "reserved (can be function or type name)" — legal as a function/type name, ILLEGAL
// as a ColId. NOTNULL lives here, which is what made `AS notnull` a syntax error.
const PG_TYPE_FUNC_NAME = new Set(`
authorization binary collation concurrently cross current_schema freeze full ilike
inner is isnull join left like natural notnull outer overlaps right similar
tablesample verbose
`.trim().split(/\s+/))

const UNUSABLE_AS_COLID = new Set([...PG_RESERVED, ...PG_TYPE_FUNC_NAME])

// Comments and strings must go before scanning: raw text finds "as more" in the
// sentence "read as more than this", and a comment saying "as null" would block
// generation with a bogus error. Prose is not grammar.
function stripForScan(sql) {
  let out = '', i = 0
  while (i < sql.length) {
    if (sql.startsWith('--', i)) {
      const j = sql.indexOf('\n', i), end = j === -1 ? sql.length : j
      out += ' '.repeat(end - i); i = end
    } else if (sql[i] === "'") {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2
        else if (sql[j] === "'") { j++; break }
        else j++
      }
      out += "''" + ' '.repeat(Math.max(0, j - i - 2)); i = j
    } else { out += sql[i]; i++ }
  }
  return out
}

// `) d` cannot be regex-scraped apart from `) ORDER BY` / `) UNION` / `) AND …`, so the
// generator's bare aliases are listed instead. Update if another is added.
const BARE_ALIASES = ['d']

function colIdPositions(raw) {
  const sql = stripForScan(raw)
  const found = BARE_ALIASES.map(ident => ({ ident, where: 'bare subquery alias' }))
  for (const m of sql.matchAll(/(?:^|[\s,])([a-z_][a-z0-9_]*)\s*\(([^()]*)\)\s+AS\s*\(/gi)) {
    found.push({ ident: m[1], where: 'CTE name' })
    for (const c of m[2].split(',')) {
      const id = c.trim()
      if (/^[a-z_][a-z0-9_]*$/i.test(id)) found.push({ ident: id, where: `CTE column list of ${m[1]}` })
    }
  }
  for (const m of sql.matchAll(/\bAS\s+([a-z_][a-z0-9_]*)\b/gi)) found.push({ ident: m[1], where: 'AS alias' })
  return found
}

function validateEmitted(sql) {
  const problems = []
  for (const { ident, where } of colIdPositions(sql)) {
    const lower = ident.toLowerCase()
    if (UNUSABLE_AS_COLID.has(lower)) {
      const cat = PG_RESERVED.has(lower) ? 'reserved_keyword' : 'type_func_name_keyword'
      problems.push(`"${ident}" (${where}) is a PostgreSQL ${cat} and cannot be a bare identifier — rename it`)
    }
  }
  let depth = 0, min = 0, instr = false, incom = false
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]
    if (incom) { if (c === '\n') incom = false; continue }
    if (instr) { if (c === "'") { if (sql[i + 1] === "'") i++; else instr = false } continue }
    if (c === "'") { instr = true; continue }
    if (c === '-' && sql[i + 1] === '-') { incom = true; i++; continue }
    if (c === '(') depth++
    else if (c === ')') { depth--; if (depth < min) min = depth }
  }
  if (depth !== 0) problems.push(`unbalanced parentheses (ends at depth ${depth})`)
  if (min < 0) problems.push(`parenthesis closed before it was opened (min depth ${min})`)
  if (instr) problems.push('unterminated string literal')
  const code = sql.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")
  const writes = ['insert', 'update', 'delete', 'alter', 'drop', 'truncate', 'grant', 'create']
    .filter(w => new RegExp(`\\b${w}\\b`, 'i').test(code))
  if (writes.length) problems.push(`writing keyword(s) present, must be read-only: ${writes.join(', ')}`)
  const statements = code.split(';').filter(s => s.trim())
  if (statements.length !== 1) problems.push(`${statements.length} statements — must be exactly 1 so no editor can truncate the result`)
  return problems
}

// ─── Emit ────────────────────────────────────────────────────────────────────

const q = s => `'${String(s).replace(/'/g, "''")}'`
const colVals = Object.entries(repo).flatMap(([t, cols]) =>
  Object.entries(cols).map(([c, v]) =>
    `    (${q(t)}, ${q(c)}, ${v.notnull}, ${v.default == null ? 'NULL' : q(v.default)}, ${v.type == null ? 'NULL' : q(v.type)})`))

const conVals = constraints.map(c => `    (${q(c.name)}, ${q(litSig(c.body ?? ''))})`)
const idxVals = indexes.map(n => `    (${q(n)})`)

const sql = `-- ─── Schema drift audit — READ ONLY, SINGLE RESULT SET ───────────────────────
--
-- GENERATED by scripts/audit-schema-drift.mjs. Do not hand-edit — regenerate.
--
-- Compares the live database against what every DDL statement in supabase/ and
-- supabase/migrations/ would produce, and returns ONLY the disagreements.
--
-- ONE statement, one grid, on purpose: several Supabase SQL editor versions display
-- only the LAST statement's result, which would hide every section but the last and
-- read as a pass.
--
-- ZERO ROWS = no drift in the dimensions below. Any row is drift.
--
-- SAFE: SELECT only. No writes, no SET ROLE, no transaction.
--
-- WHAT IT DOES NOT CHECK — "zero rows" must not be read as more than this:
--   • Constraint bodies are compared by LITERAL SIGNATURE (section K): the sorted set
--     of quoted strings and numbers. Postgres rewrites expressions — x IN ('a','b')
--     becomes x = ANY (ARRAY['a'::text,'b'::text]) — so comparing definition text is
--     all false positives. The signature survives rewriting and still catches a
--     widened bound (500 to 2500) or a changed enum member. It will NOT catch a
--     change that preserves every literal, such as <= flipped to <.
--   • Types (section T) are compared loosely; precision and domain differences may
--     not surface.
--   • Policies, triggers, functions and views are out of scope for this pass.

WITH expected (tbl, col, is_notnull, dflt, typ) AS (VALUES
${colVals.join(',\n')}
),
expected_constraint (cname, litsig) AS (VALUES
${conVals.join(',\n')}
),
expected_index (iname) AS (VALUES
${idxVals.join(',\n')}
),
expected_table (tbl) AS (
  SELECT DISTINCT tbl FROM expected
),
live_col AS (
  SELECT c.relname AS tbl, a.attname AS col, a.attnotnull AS is_notnull,
         pg_get_expr(d.adbin, d.adrelid) AS dflt,
         format_type(a.atttypid, a.atttypmod) AS typ
  FROM pg_class c
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
),
norm AS (
  SELECT e.tbl, e.col, e.dflt AS repo_d, l.dflt AS live_d,
         btrim(lower(regexp_replace(regexp_replace(coalesce(e.dflt,''), '::[a-z0-9_ \\[\\]"]+', '', 'gi'), '^\\((.*)\\)$', '\\1')), '''') AS rk,
         btrim(lower(regexp_replace(regexp_replace(coalesce(l.dflt,''), '::[a-z0-9_ \\[\\]"]+', '', 'gi'), '^\\((.*)\\)$', '\\1')), '''') AS lk
  FROM expected e JOIN live_col l ON l.tbl = e.tbl AND l.col = e.col
),
-- Live constraint literal signature, computed the same way the generator computes the
-- repo side: distinct quoted strings and numbers, CASE PRESERVED, sorted with
-- COLLATE "C" (byte order) to match the generator's code-unit sort. Lowercasing here
-- would blind the check to a case-sensitive regex change; the default collation would
-- order punctuation differently and mismatch every signature containing ^ or {.
live_con AS (
  SELECT k.conname AS cname, t.relname AS tbl, k.contype AS ctype,
         pg_get_constraintdef(k.oid) AS cdef,
         (SELECT coalesce(string_agg(x, '|' ORDER BY x COLLATE "C"), '')
            FROM (
              SELECT DISTINCT x FROM (
                SELECT (regexp_matches(pg_get_constraintdef(k.oid), '''((?:[^'']|'''')*)''', 'g'))[1] AS x
                UNION ALL
                SELECT (regexp_matches(pg_get_constraintdef(k.oid), '\\y(\\d+(?:\\.\\d+)?)\\y', 'g'))[1]
              ) u WHERE x IS NOT NULL
            ) s) AS litsig
  FROM pg_constraint k JOIN pg_class t ON t.oid = k.conrelid
  WHERE k.connamespace = 'public'::regnamespace AND t.relkind = 'r'
)
SELECT * FROM (
  -- A. nullability disagreement
  SELECT 'A-nullability' AS section, e.tbl AS c1, e.col AS c2,
         CASE WHEN l.is_notnull THEN 'NOT NULL' ELSE 'nullable' END AS c3_live,
         CASE WHEN e.is_notnull THEN 'NOT NULL' ELSE 'nullable' END AS c4_repo
  FROM expected e JOIN live_col l ON l.tbl = e.tbl AND l.col = e.col
  WHERE l.is_notnull <> e.is_notnull

  UNION ALL
  -- B. DEFAULT disagreement. The one dimension PostgREST's OpenAPI spec cannot see —
  --    it omits defaults for every array/jsonb column — so this is the only check.
  SELECT 'B-default', tbl, col, coalesce(live_d,'(none)'), coalesce(repo_d,'(none)')
  FROM norm
  WHERE rk <> lk
    AND NOT (rk ~ 'now\\(\\)|current_timestamp' AND lk ~ 'now\\(\\)|current_timestamp')
    AND NOT (rk ~ 'gen_random_uuid|uuid_generate' AND lk ~ 'gen_random_uuid|uuid_generate')

  UNION ALL
  -- T. type disagreement (loose; see header)
  SELECT 'T-type', e.tbl, e.col, l.typ, e.typ
  FROM expected e JOIN live_col l ON l.tbl = e.tbl AND l.col = e.col
  WHERE e.typ IS NOT NULL
    AND replace(replace(lower(l.typ),' ',''),'"','') <> replace(replace(lower(e.typ),' ',''),'"','')

  UNION ALL
  -- C. live column no migration accounts for
  SELECT 'C-live-only-column', l.tbl, l.col, l.typ,
         CASE WHEN l.is_notnull THEN 'NOT NULL' ELSE 'nullable' END
  FROM live_col l
  WHERE NOT EXISTS (SELECT 1 FROM expected e WHERE e.tbl = l.tbl AND e.col = l.col)
    AND EXISTS (SELECT 1 FROM expected_table t WHERE t.tbl = l.tbl)

  UNION ALL
  -- D. repo declares it, database lacks it (the facilities.area class)
  SELECT 'D-missing-column', e.tbl, e.col, '(absent)', coalesce(e.typ,'?')
  FROM expected e
  WHERE EXISTS (SELECT 1 FROM live_col l WHERE l.tbl = e.tbl)
    AND NOT EXISTS (SELECT 1 FROM live_col l WHERE l.tbl = e.tbl AND l.col = e.col)

  UNION ALL
  -- E. constraint the repo creates, database lacks
  SELECT 'E-missing-constraint', e.cname, '', '(absent)', ''
  FROM expected_constraint e
  WHERE NOT EXISTS (SELECT 1 FROM live_con l WHERE l.cname = e.cname)

  UNION ALL
  -- F. constraint live but created by no migration. Inline CHECK/UNIQUE/PK/FK in a
  --    CREATE TABLE are now parsed and auto-named the way Postgres names them, so this
  --    section no longer reports the whole schema.
  SELECT 'F-live-only-constraint', l.tbl, l.cname, l.ctype::text, left(l.cdef, 110)
  FROM live_con l
  WHERE NOT EXISTS (SELECT 1 FROM expected_constraint e WHERE e.cname = l.cname)
    AND l.cdef NOT ILIKE '%IS NOT NULL%'

  UNION ALL
  -- K. names match, BODIES differ. This is the events_description_check 500-to-2500
  --    class — invisible to a name-only comparison, which is exactly why it exists.
  SELECT 'K-constraint-body', l.tbl, l.cname, left(l.cdef, 110), 'repo literals: ' || e.litsig
  FROM live_con l JOIN expected_constraint e ON e.cname = l.cname
  WHERE e.litsig <> '' AND l.litsig <> '' AND e.litsig <> l.litsig

  UNION ALL
  -- G. index the repo creates, database lacks
  SELECT 'G-missing-index', e.iname, '', '(absent)', ''
  FROM expected_index e
  WHERE NOT EXISTS (SELECT 1 FROM pg_class i
    WHERE i.relname = e.iname AND i.relnamespace = 'public'::regnamespace AND i.relkind = 'i')

  UNION ALL
  -- H. index live but created by no migration, excluding constraint-backed ones
  SELECT 'H-live-only-index', x.tablename, x.indexname, '', left(x.indexdef, 110)
  FROM pg_indexes x
  WHERE x.schemaname = 'public'
    AND NOT EXISTS (SELECT 1 FROM expected_index e WHERE e.iname = x.indexname)
    AND NOT EXISTS (SELECT 1 FROM pg_constraint k
      WHERE k.conname = x.indexname AND k.connamespace = 'public'::regnamespace)

  UNION ALL
  -- I. table live with no CREATE TABLE anywhere in the repo
  SELECT 'I-live-only-table', c.relname, '',
         CASE WHEN c.relrowsecurity THEN 'RLS on' ELSE 'RLS OFF' END,
         (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = c.oid) || ' policies'
  FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
    AND NOT EXISTS (SELECT 1 FROM expected_table t WHERE t.tbl = c.relname)

  UNION ALL
  -- J. RLS off on a public table. Not drift, but RLS is this app's security boundary.
  SELECT 'J-rls-off', c.relname, '', 'RLS OFF',
         (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = c.oid) || ' policies'
  FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND NOT c.relrowsecurity
) d
ORDER BY section, c1, c2;
`

const problems = validateEmitted(sql)
if (problems.length) {
  console.error(`\nREFUSING to write ${OUT.replace(ROOT + '/', '')} — ${problems.length} problem(s):\n`)
  for (const p of problems) console.error(`  ✗ ${p}`)
  console.error('\nNothing was written. Fix this generator, not the output file.')
  process.exit(1)
}

writeFileSync(OUT, sql)
console.log('')
console.log(`written: ${OUT.replace(ROOT + '/', '')}`)
console.log(`  validated            : ${colIdPositions(sql).length} ColId positions, 0 reserved-word collisions`)
console.log(`  tables parsed        : ${Object.keys(repo).length}`)
console.log(`  column expectations  : ${colVals.length}`)
console.log(`  constraints expected : ${constraints.length}  (from ${conEvents.length} ordered add/drop events)`)
console.log(`  indexes expected     : ${indexes.length}  (from ${idxEvents.length} ordered add/drop events)`)
console.log('')
if (process.argv.includes('--print')) {
  for (const c of constraints) console.log(`    ${c.name}`)
}
