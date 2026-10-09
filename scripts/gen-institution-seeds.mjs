#!/usr/bin/env node
// ─── Universities outside the TRNC: CSV → seed migration (20261096-98) ──────
//
//   node scripts/gen-institution-seeds.mjs TR 20261096   # writes supabase/migrations/20261096_institutions_seed_tr.sql
//   node scripts/gen-institution-seeds.mjs --activate 20261099   # the publish step, by id
//   node scripts/gen-institution-seeds.mjs --ids         # print every id (review / diff)
//
// Input: data/institutions/<country>.csv (source_key,name,city_name,website_url,source_url,note),
// curated from the official lists by data/institutions/curate.py — YÖK (TR), the Cyprus
// Department of Higher Education (CY), OfS + Medr + SFC + nidirect (GB). Every row names its
// source.
//
// ─── IDS: UUIDv5, COMPUTED HERE, WRITTEN AS LITERALS ────────────────────────
// The hand-numbered …b000-0000000000NN ids of 20261001-21 do not scale to a world list.
// v5 of `<country>|<source_key>` (YÖK id, UKPRN, register name) under a fixed namespace is
// deterministic: the same university gets the same id on every run, on every machine, with
// no database extension (uuid-ossp is not assumed). The literals make ON CONFLICT (id) work
// and keep the migration reviewable. Never change NAMESPACE: every id would move.
//
// ─── SEEDED INACTIVE ────────────────────────────────────────────────────────
// is_active = false (module go-live SOP, step 1). A separate activation migration publishes
// them, right before the Preview device pass — until then no client lists them.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// uuidv5(DNS namespace, 'institutions.getadaapp.com'). Fixed forever.
const NAMESPACE = uuidv5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'institutions.getadaapp.com')
const SORT_ORDER = 500   // below every TRNC row (10–145), above Other (999)
// Names this seed may share with a TRNC row (case-insensitive). Empty since 20261101 renamed the
// TRNC ASBÜ campus (…0017) to "… KKTC Yerleşkesi" (2026-10-09): the seeds 1096–1099 ran while
// it still carried its parent's exact name. Anything matching an XN row refuses the seed: it
// is a duplicate, a mislabelled row, or a campus that needs its campus name first.
const XN_NAME_ALLOWED = {
  TR: [],
  CY: [],
  GB: [],
}
const COUNTRIES = ['TR', 'CY', 'GB']

export function uuidv5(namespace, name) {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex')
  const h = createHash('sha1').update(Buffer.concat([ns, Buffer.from(name, 'utf8')])).digest()
  h[6] = (h[6] & 0x0f) | 0x50
  h[8] = (h[8] & 0x3f) | 0x80
  const x = h.subarray(0, 16).toString('hex')
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`
}

// RFC 4180 enough for these files: quoted fields, doubled quotes, commas inside quotes.
function parseCsv(text) {
  const rows = []; let row = []; let f = ''; let q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { f += '"'; i++ } else if (ch === '"') q = false; else f += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { row.push(f); f = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = '' }
    else f += ch
  }
  if (f || row.length) { row.push(f); rows.push(row) }
  const [head, ...body] = rows.filter(r => r.some(c => c !== ''))
  return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}

export function loadCountry(country) {
  const rows = parseCsv(readFileSync(resolve(ROOT, `data/institutions/${country.toLowerCase()}.csv`), 'utf8'))
  const out = rows.map(r => ({ ...r, id: uuidv5(NAMESPACE, `${country}|${r.source_key}`), country }))
  for (const r of out) {
    if (!r.name.trim()) throw new Error(`${country}: empty name (${r.source_key})`)
    if (r.website_url && !/^https:\/\/[a-z0-9.-]+$/.test(r.website_url)) throw new Error(`${country}: not an https origin: ${r.website_url}`)
    if (r.city_name !== r.city_name.trim()) throw new Error(`${country}: untrimmed city: "${r.city_name}"`)
  }
  for (const k of ['id', 'name', 'source_key']) {
    const seen = new Set()
    for (const r of out) { if (seen.has(r[k])) throw new Error(`${country}: duplicate ${k}: ${r[k]}`); seen.add(r[k]) }
  }
  return out
}

const lit = v => (v == null || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)

export function migration(country, prefix, rows) {
  const file = `${prefix}_institutions_seed_${country.toLowerCase()}.sql`
  const n = rows.length
  const sources = [...new Set(rows.map(r => r.source_url))]
  const values = rows.map(r =>
    `  (${lit(r.id)}, ${lit(r.name)}, '${country}', ${lit(r.city_name)}, ${lit(r.website_url)}, ${SORT_ORDER}, false)`).join(',\n')
  const idList = rows.map(r => `'${r.id}'`).join(',')
  return { file, sql: `-- ═══ institutions — ${n} universities in ${country}, seeded INACTIVE (generated) ═══════
--
-- Generated by scripts/gen-institution-seeds.mjs from data/institutions/${country.toLowerCase()}.csv.
-- Do not hand-edit: change the CSV (or curate.py) and regenerate before the apply; an applied
-- file is never edited. Ids are UUIDv5 of '${country}|<source_key>' (see the generator).
--
-- Sources:
${sources.map(s => `--   ${s}`).join('\n')}
--
-- is_active = false: nothing here is visible until the activation migration runs (module
-- go-live SOP). sort_order ${SORT_ORDER}: below every TRNC row, above Other (999).
--
-- RE-RUN: ON CONFLICT (id) DO NOTHING, so a later edit to one of these rows is never
-- reverted. The checks below assert the ids exist in ${country}, not their current values.
--
-- EXECUTION: supabase-migrate workflow (dry, then -f apply=true). Requires 20261095.

SET ROLE postgres;

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'institutions_country_name_unique'
                  AND conrelid = 'public.institutions'::regclass) THEN
    RAISE EXCEPTION 'REFUSING: 20261095 (institutions.country, per-country names) is not applied. Nothing applied.';
  END IF;
END $$;

-- A name already used in ${country} by a DIFFERENT id would make the INSERT fail with a bare
-- 23505; say which instead.
DO $$
DECLARE v_clash text;
BEGIN
  SELECT string_agg(i.name, ' · ') INTO v_clash
    FROM public.institutions i
    JOIN (VALUES
${rows.map(r => `      (${lit(r.id)}::uuid, ${lit(r.name)})`).join(',\n')}
    ) AS v(id, name) ON v.name = i.name AND i.country = '${country}' AND i.id <> v.id;
  IF v_clash IS NOT NULL THEN
    RAISE EXCEPTION 'REFUSING: already in ${country} under another id: %. Nothing applied.', v_clash;
  END IF;
END $$;

-- Against the TRNC rows: the names this seed shares with an XN row must be EXACTLY the
-- reviewed allowance (${JSON.stringify(XN_NAME_ALLOWED[country] ?? [])}). Printed either way.
DO $$
DECLARE v_shared text;
BEGIN
  SELECT coalesce(string_agg(DISTINCT i.name, ' · ' ORDER BY i.name), '') INTO v_shared
    FROM public.institutions i
    JOIN (VALUES
${rows.map(r => `      (${lit(r.name)})`).join(',\n')}
    ) AS v(name) ON lower(v.name) = lower(i.name) AND i.country = 'XN';
  RAISE NOTICE 'names shared with TRNC rows: [%]', v_shared;
  IF v_shared IS DISTINCT FROM '${(XN_NAME_ALLOWED[country] ?? []).slice().sort().join(' · ').replace(/'/g, "''")}' THEN
    RAISE EXCEPTION 'REFUSING: names shared with TRNC rows are [%], reviewed allowance is [${(XN_NAME_ALLOWED[country] ?? []).join(' · ').replace(/'/g, "''")}]. Nothing applied.', v_shared;
  END IF;
END $$;

INSERT INTO public.institutions (id, name, country, city_name, website_url, sort_order, is_active) VALUES
${values}
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_here   int;
  v_total  int;
BEGIN
  SELECT count(*) INTO v_here FROM public.institutions
   WHERE country = '${country}' AND id IN (${idList});
  IF v_here <> ${n} THEN
    RAISE EXCEPTION 'expected all ${n} ids in ${country}, found %. Nothing applied.', v_here;
  END IF;
  SELECT count(*) INTO v_total FROM public.institutions WHERE country = '${country}';
  IF v_total <> ${n} THEN
    RAISE EXCEPTION '${country} holds % rows, expected exactly ${n} (rows from elsewhere?). Nothing applied.', v_total;
  END IF;
  IF (SELECT count(*) FROM public.institutions WHERE country = 'XN') <> 24 THEN
    RAISE EXCEPTION 'the TRNC rows changed under this seed. Nothing applied.';
  END IF;
  RAISE NOTICE '${file}: ${n} rows in ${country} (% active).',
    (SELECT count(*) FROM public.institutions WHERE country = '${country}' AND is_active);
END $$;

COMMIT;

RESET ROLE;
` }
}

// The publish step (module go-live SOP step 3): every seeded id, by id, so a row added or
// deactivated by hand later is never swept up by a re-run of this file.
export function activation(prefix) {
  const by = Object.fromEntries(COUNTRIES.map(c => [c, loadCountry(c)]))
  const file = `${prefix}_institutions_activate_intl.sql`
  const total = COUNTRIES.reduce((n, c) => n + by[c].length, 0)
  return { file, sql: `-- ═══ institutions — publish the ${total} universities outside the TRNC (generated) ═══════
--
-- Generated by scripts/gen-institution-seeds.mjs --activate from data/institutions/*.csv.
-- ${COUNTRIES.map(c => `${c} ${by[c].length}`).join(' · ')}. Matched BY ID (the seeds' UUIDv5s): only rows the seeds
-- created, never one added by hand later. From this file on, every one is in the Student Hub
-- directory and the pickers, and has a student list (20261095).
--
-- RE-RUN: a no-op against its own end state. It does NOT re-activate a row someone
-- deactivated after it ran — it refuses instead, naming the rows.
--
-- EXECUTION: supabase-migrate workflow (dry, then -f apply=true). Requires the three seeds.

SET ROLE postgres;

BEGIN;

DO $$
DECLARE v_n int;
BEGIN
${COUNTRIES.map(c => `  SELECT count(*) INTO v_n FROM public.institutions WHERE country = '${c}';
  IF v_n <> ${by[c].length} THEN
    RAISE EXCEPTION 'REFUSING: ${c} holds % rows, its seed has ${by[c].length}. Apply the seed first. Nothing applied.', v_n;
  END IF;`).join('\n')}
  IF EXISTS (SELECT 1 FROM public.schema_migrations_applied WHERE filename = '${file}') THEN
    SELECT count(*) INTO v_n FROM public.institutions WHERE country IN (${COUNTRIES.map(c => `'${c}'`).join(', ')}) AND NOT is_active;
    IF v_n > 0 THEN
      RAISE EXCEPTION 'REFUSING: % row(s) were deactivated after this file ran; re-running would undo that. Nothing applied.', v_n;
    END IF;
  END IF;
END $$;

UPDATE public.institutions SET is_active = true
 WHERE NOT is_active AND id IN (
${COUNTRIES.map(c => by[c].map(r => `  '${r.id}'`).join(',\n')).join(',\n')}
 );

DO $$
DECLARE v_rows text;
BEGIN
  SELECT string_agg(format('%s %s/%s', coalesce(country, 'Other'), a, n), ' · ' ORDER BY country)
    INTO v_rows
    FROM (SELECT country, count(*) FILTER (WHERE is_active) a, count(*) n FROM public.institutions GROUP BY 1) x;
  RAISE NOTICE 'active/total per country: %', v_rows;
${COUNTRIES.map(c => `  IF (SELECT count(*) FROM public.institutions WHERE country = '${c}' AND is_active) <> ${by[c].length} THEN
    RAISE EXCEPTION '${c}: not all ${by[c].length} active. Nothing applied.';
  END IF;`).join('\n')}
  IF (SELECT count(*) FROM public.institutions WHERE country = 'XN' AND is_active) <> 23 THEN
    RAISE EXCEPTION 'the TRNC rows changed (expected 23 active). Nothing applied.';
  END IF;
END $$;

COMMIT;

RESET ROLE;
` }
}

if (process.argv.includes('--activate')) {
  const prefix = process.argv[process.argv.indexOf('--activate') + 1]
  if (!/^\d{8}$/.test(prefix ?? '')) { console.error('usage: --activate <prefix>'); process.exit(1) }
  const { file, sql } = activation(prefix)
  writeFileSync(resolve(ROOT, 'supabase/migrations', file), sql)
  console.log(`wrote supabase/migrations/${file}. Next: stamp, ledger, verify_schema token.`)
} else if (process.argv.includes('--ids')) {
  for (const c of COUNTRIES) for (const r of loadCountry(c)) console.log(`${c}\t${r.id}\t${r.source_key}\t${r.name}`)
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [country, prefix] = process.argv.slice(2)
  if (!COUNTRIES.includes(country) || !/^\d{8}$/.test(prefix ?? '')) {
    console.error('usage: node scripts/gen-institution-seeds.mjs <TR|CY|GB> <prefix from npm run migration:next>')
    process.exit(1)
  }
  const rows = loadCountry(country)
  const { file, sql } = migration(country, prefix, rows)
  writeFileSync(resolve(ROOT, 'supabase/migrations', file), sql)
  console.log(`wrote supabase/migrations/${file} (${rows.length} rows). Next: stamp, ledger, verify_schema token.`)
}
