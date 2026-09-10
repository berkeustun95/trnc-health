#!/usr/bin/env node
// ─── Ad placement guard — the permanent exclusion list, enforced ─────────────
//
//   node scripts/check-ad-placement.mjs          # exit 0 if every placement is legal
//   node scripts/check-ad-placement.mjs --self   # prove every failure path is reachable
//
// ─── WHAT THIS ANSWERS, AND WHAT IT DOES NOT ────────────────────────────────
//
// ANSWERS:  "does the code in this repo mount an advert on a forbidden surface, or point
//           one at a forbidden destination?"
// DOES NOT: anything about the DATABASE. It reads supabase/migrations/*.sql as TEXT. A
//           migration file is a statement of INTENT — between it and the database sit a
//           manual paste, a partial selection and a later CREATE OR REPLACE.
//           supabase/verify_schema.sql owns the applied half, and only if somebody runs
//           it. Same honest limit check-terms-commitment.mjs carries.
//
// ─── WHY A MOUNT-POINT ALLOWLIST, AND WHY PER FILE ──────────────────────────
//
// The exclusion list is: NO ADS ON duty pharmacy, emergency contacts, health facilities,
// search results, push notifications, or Ask Oli.
//
// A placement is POSITION x MODULE. Neither half can encode that rule. `detail_bottom` is
// a position; `explore` is an ALLOWED module; and the pair mounted on
// FacilityProfileScreen is an ad on a health surface with a perfectly valid row behind it.
// Every CHECK constraint in the migration stays green. **The module being allowed does not
// make a screen allowed** — that is the single most tempting wrong inference here, and the
// check named "no allowlisted file is an excluded surface" exists precisely to refuse it.
//
// Only a file path identifies a surface. So constants/ads.js declares AD_PLACEMENTS —
// {file, position, module, host, span} — and this script enforces it in .githooks/pre-push
// and in the `npm run ota` chain. `eas update` bundles the WORKING TREE, which is why the
// ota wrapper matters more than the hook.
//
// ─── AND WHY EACH PLACEMENT IS ITS OWN ONE-LINE WRAPPER FILE ────────────────
//
// Two screens host more than one surface in ONE file:
//   • EventsScreen.js holds the list AND EventDetailScreen (defined at its line 323).
//   • HomeScreen.js holds the V2 hub, the global search results, and the gated read-only
//     facility list — and TWO of those three are on the exclusion list.
// A whole-file rule cannot tell those apart. The wrappers in components/ads/ give the
// allowlist file granularity, and `span` pins a mount to one function inside its host.
//
// ─── EVERY NEGATIVE HAS A CONTROL ───────────────────────────────────────────
//
// A check asserting something is ABSENT passes trivially when it is looking at nothing.
// So: excluded-surface files must EXIST (a renamed screen silently leaves the set), the
// wrapper files must exist AND import AdSlot (a stale allowlist certifies a blind spot),
// and every slice taken out of a file is proved non-empty before anything is concluded
// from it — a slice whose end marker precedes its start returns '' and passes everything.
//
// `--self` mutates in-memory copies and asserts each check goes RED, verifying the
// MUTATION LANDED first: a break that does not break looks exactly like a dead check.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname, relative, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATION_A = 'supabase/migrations/20261008_ad_banners.sql'
const MIGRATION_B = 'supabase/migrations/20261009_ad_slots_position_module.sql'
const AD_COMPONENT = 'components/AdSlot.js'
const APP = 'App.js'

const adsMod = await import(resolve(ROOT, 'constants/ads.js'))

// Handed to every check instead of the module namespace — an ES module namespace is
// non-configurable, so --self could not override a field on it. Both modes take the
// identical path, so the self-test exercises the same code the real run does.
const adsPlain = () => ({
  AD_POSITIONS: adsMod.AD_POSITIONS,
  AD_MODULES: adsMod.AD_MODULES,
  AD_PLACEMENTS: adsMod.AD_PLACEMENTS.map(p => ({ ...p })),
  AD_MOUNT_ALLOWLIST: adsMod.AD_PLACEMENTS.map(p => p.file),
  AD_ROUTES: adsMod.AD_ROUTES,
  AD_EXCLUDED_ROUTES: adsMod.AD_EXCLUDED_ROUTES,
  AD_EXCLUDED_SURFACES: { ...adsMod.AD_EXCLUDED_SURFACES },
  AD_DEFERRED_MODULES: { ...adsMod.AD_DEFERRED_MODULES },
  AD_REJECTED_PLACEMENTS: { ...adsMod.AD_REJECTED_PLACEMENTS },
  AD_PAGE_INSET: adsMod.AD_PAGE_INSET,
})

// ─── Input gathering ────────────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', 'dist', 'assets'].includes(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (name.endsWith('.js') || name.endsWith('.jsx')) out.push(relative(ROOT, full))
  }
  return out
}

function gather() {
  const files = {}
  for (const rel of walk(ROOT)) files[rel] = readFileSync(resolve(ROOT, rel), 'utf8')
  const read = f => (existsSync(resolve(ROOT, f)) ? readFileSync(resolve(ROOT, f), 'utf8') : null)
  return { files, migrationA: read(MIGRATION_A), migrationB: read(MIGRATION_B), ads: adsPlain() }
}

// ─── Comment stripper — a real tokenizer, and it had to be ─────────────────
//
// So a commented-out import or mount is not read as live code.
//
// ⚠ THE NAIVE TWO-REGEX VERSION SILENTLY DELETED 45,000 CHARACTERS OF App.js. That file
//   carries the LINE comment `// screens/games/* and HomeScreen's ...`, and a regex pass
//   that removes /* … */ FIRST sees that `/*` as a block-comment opener and runs to the
//   next `*/` — which is 45kB later, inside an unrelated JSX comment. openAdRoute() went
//   with it, and the guard reported "openAdRoute not found in App.js" against a file that
//   plainly contains it. The system was right; the instrument was reading a different
//   document than the one on disk.
//
//   Reordering the two passes does not fix it, it moves it: strip line comments first and
//   a block comment whose last line ends `// … */` loses its terminator instead.
//
// So this walks the source once, tracking strings, template literals, regex literals and
// both comment forms — and BLANKS rather than deletes, preserving every byte offset. That
// second property matters as much as the first: the span checks compare an offset found in
// the stripped text against a span computed from the same stripped text, and any pass that
// shifted offsets would put those two in different frames of reference.
function stripComments(src) {
  const out = new Array(src.length)
  const blank = (from, to) => { for (let k = from; k < to; k++) out[k] = src[k] === '\n' ? '\n' : ' ' }
  const copy  = (from, to) => { for (let k = from; k < to; k++) out[k] = src[k] }
  let i = 0
  // Last significant character decides whether a `/` opens a regex literal or is division.
  let prev = ''
  while (i < src.length) {
    const c = src[i], two = src.slice(i, i + 2)
    if (two === '//') { let j = src.indexOf('\n', i); if (j < 0) j = src.length; blank(i, j); i = j; continue }
    if (two === '/*') { let j = src.indexOf('*/', i + 2); j = j < 0 ? src.length : j + 2; blank(i, j); i = j; continue }
    // ⚠ STRINGS, TEMPLATES AND REGEXES ARE COPIED VERBATIM, NOT BLANKED. They are skipped
    //   only so a `/*` or `//` inside one cannot be read as a comment marker. Blanking them
    //   was the second version of this function and it broke every check that reads a
    //   string literal — `case 'events'`, `position="list_top"` — reporting eighteen
    //   missing routes against an App.js that had all of them. Skip, do not erase.
    if (c === "'" || c === '"') {
      let j = i + 1
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++ }
      j = Math.min(j + 1, src.length); copy(i, j); i = j; prev = c; continue
    }
    if (c === '`') {
      let j = i + 1
      while (j < src.length && src[j] !== '`') { if (src[j] === '\\') j++; j++ }
      j = Math.min(j + 1, src.length); copy(i, j); i = j; prev = c; continue
    }
    if (c === '/' && /[(,=:[!&|?{};+\-*%~^<>]/.test(prev)) {
      let j = i + 1, inClass = false, ok = false
      while (j < src.length) {
        const d = src[j]
        if (d === '\\') { j += 2; continue }
        if (d === '[') inClass = true
        else if (d === ']') inClass = false
        else if (d === '/' && !inClass) { ok = true; break }
        else if (d === '\n') break
        j++
      }
      // Unterminated on this line means it was not a regex after all — fall through and
      // treat the `/` as an ordinary character rather than swallowing to end of line.
      if (ok) { copy(i, j + 1); i = j + 1; prev = '/'; continue }
    }
    out[i] = c
    if (!/\s/.test(c)) prev = c
    i++
  }
  return out.join('')
}

const wrapperName = file => file.split('/').pop().replace(/\.js$/, '')

// Byte span of a function body, by brace matching from its declaration. Indent-independent
// on purpose: EventsScreen declares at column 0 and HomeScreen at column 2, and an
// indent-based rule would split an outer span at the first nested helper.
// Returns null when it cannot be determined — the caller must fail loudly, not conclude.
function functionSpan(clean, name) {
  const re = new RegExp(`(?:^|\\n)\\s*(?:export\\s+default\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`)
  const m = re.exec(clean)
  if (!m) return null
  // ⚠ PAREN-MATCH THE PARAMETER LIST FIRST. Taking the first `{` after the opening paren
  //   lands on the DESTRUCTURING brace of `function EventsScreen({ lang, onBack }) {`, and
  //   brace-matching from there returns the parameter object — a 96-character "span" that
  //   contains no mount and makes every offset test meaningless. Caught by the span
  //   control, which is why the control exists.
  let p = m.index + m[0].length - 1, pd = 0, close = -1
  for (; p < clean.length; p++) {
    if (clean[p] === '(') pd++
    else if (clean[p] === ')') { pd--; if (pd === 0) { close = p; break } }
  }
  if (close < 0) return null
  const open = clean.indexOf('{', close)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < clean.length; i++) {
    if (clean[i] === '{') depth++
    else if (clean[i] === '}') { depth--; if (depth === 0) return [m.index, i] }
  }
  return null
}

// ─── The checks. Each is a pure function of the gathered input. ────────────
// Returning a string means FAILED, and the string is what the developer reads.

const CHECKS = [

  ['placement vocabulary is coherent', ({ ads }) => {
    if (!ads.AD_PLACEMENTS.length) return 'AD_PLACEMENTS is empty — nothing may mount an ad, which is not the intended state'
    for (const p of ads.AD_PLACEMENTS) {
      if (!ads.AD_POSITIONS.includes(p.position)) return `placement ${p.file} uses position "${p.position}", not in AD_POSITIONS`
      if (!ads.AD_MODULES.includes(p.module))     return `placement ${p.file} uses module "${p.module}", not in AD_MODULES`
      if (!Array.isArray(p.hosts) || p.hosts.length === 0) {
        return `placement ${p.file} declares no hosts[] — it is `
          + (p.host ? `still on the old singular \`host\` field; that field is gone, use hosts: ['...']`
                    : `dead inventory: a wrapper no screen may mount`)
      }
      // A span is a byte offset inside ONE file. Two hosts and it is measuring one of them
      // and silently ignoring the other, which is worse than not checking at all.
      if (p.span && p.hosts.length !== 1) {
        return `placement ${p.file} declares a span (${p.span}) with ${p.hosts.length} hosts — `
          + `a span pins a mount to a function inside one file and has no meaning across two`
      }
      for (const h of p.hosts) {
        if (typeof h !== 'string' || !h) return `placement ${p.file} has a non-string entry in hosts[]`
      }
      if (new Set(p.hosts).size !== p.hosts.length) {
        return `placement ${p.file} lists the same host twice — the mount-count check below would then demand two mounts in one file`
      }
    }
    const seen = new Set()
    for (const p of ads.AD_PLACEMENTS) {
      const k = `${p.position}/${p.module}`
      if (seen.has(k)) return `two placements claim ${k} — one wrapper per placement, or the allowlist stops being a 1:1 map`
      seen.add(k)
    }
    return null
  }],

  ['wrappers exist and actually wrap AdSlot', ({ files, ads }) => {
    // CONTROL for everything downstream. A wrapper naming a file that does not exist, or
    // that does not import AdSlot, would let the import scan below conclude "no
    // violations" while enforcing nothing at all.
    for (const p of ads.AD_PLACEMENTS) {
      if (!(p.file in files)) return `AD_PLACEMENTS names ${p.file}, which does not exist. A renamed wrapper leaves the allowlist pointing at nothing and the guard enforcing nothing.`
      const src = stripComments(files[p.file])
      if (!/from\s+['"][^'"]*AdSlot['"]/.test(src)) return `${p.file} is on the allowlist but does not import AdSlot — a stale entry is a permanently open door.`
      if (!src.includes(`position="${p.position}"`) || !src.includes(`module="${p.module}"`)) {
        return `${p.file} declares ${p.position}/${p.module} in constants/ads.js but does not pass that pair to AdSlot.\n`
          + `      The wrapper and the allowlist would then describe different placements, and the allowlist is what the guard trusts.`
      }
    }
    return null
  }],

  ['excluded surfaces still exist', ({ files, ads }) => {
    // CONTROL. If DutyListScreen.js is renamed, "no ad is mounted in DutyListScreen.js"
    // becomes true for the wrong reason and stays green forever.
    for (const rel of Object.keys(ads.AD_EXCLUDED_SURFACES)) {
      if (!(rel in files)) return `AD_EXCLUDED_SURFACES names ${rel}, which does not exist. The exclusion is now vacuous — find where that surface moved and update constants/ads.js.`
    }
    return null
  }],

  ['only wrappers import AdSlot', ({ files, ads }) => {
    const offenders = []
    for (const [rel, src] of Object.entries(files)) {
      if (rel === AD_COMPONENT) continue
      if (!/from\s+['"][^'"]*\/AdSlot['"]|require\(['"][^'"]*\/AdSlot['"]\)/.test(stripComments(src))) continue
      if (!ads.AD_MOUNT_ALLOWLIST.includes(rel)) offenders.push(rel)
    }
    if (offenders.length) {
      return `these files import AdSlot directly but are not wrappers in AD_PLACEMENTS: ${offenders.join(', ')}\n`
        + `      A new placement is a deliberate edit to constants/ads.js plus a wrapper in components/ads/,\n`
        + `      reviewed against the exclusion list. Importing AdSlot into a screen bypasses both.`
    }
    return null
  }],

  ['no wrapper file is an excluded surface', ({ ads }) => {
    // ⚠ THE LOAD-BEARING CHECK. This is what refuses "explore is an allowed module, so its
    //   detail screen is fine": FacilityProfileScreen is an excluded surface BY FILE, and
    //   no amount of the module being allowed reaches it.
    for (const p of ads.AD_PLACEMENTS) {
      for (const rel of [p.file, ...(p.hosts || [])]) {
        if (rel in ads.AD_EXCLUDED_SURFACES) {
          return `${p.position}/${p.module} would put an ad on ${rel}, which is on the PERMANENT exclusion list.\n`
            + `      Excluded because: ${ads.AD_EXCLUDED_SURFACES[rel]}\n`
            + `      The MODULE being allowed does not make the SCREEN allowed — that is the whole reason\n`
            + `      this rule is keyed on files. Remove the placement, not the exclusion.`
        }
      }
    }
    return null
  }],

  ['no ad is mounted in an excluded surface', ({ files, ads }) => {
    const names = ads.AD_PLACEMENTS.map(p => wrapperName(p.file))
    for (const [rel, why] of Object.entries(ads.AD_EXCLUDED_SURFACES)) {
      const src = stripComments(files[rel] || '')
      if (/<\s*AdSlot\b/.test(src)) return `${rel} renders <AdSlot> directly, and it is on the permanent exclusion list.\n      Excluded because: ${why}`
      for (const n of names) {
        if (new RegExp(`<\\s*${n}\\b`).test(src)) {
          return `${rel} mounts <${n}>, and it is on the permanent exclusion list.\n      Excluded because: ${why}`
        }
      }
    }
    return null
  }],

  ['every wrapper is mounted only in its declared host', ({ files, ads }) => {
    for (const p of ads.AD_PLACEMENTS) {
      const n = wrapperName(p.file)
      const re = new RegExp(`<\\s*${n}\\b`, 'g')
      const found = Object.entries(files)
        .filter(([rel, src]) => rel !== p.file && re.test(stripComments(src)))
        .map(([rel]) => rel)
      // EVERY declared host must actually mount it. A host listed but never mounted is the
      // dangerous direction: it reads as an approved placement that renders nothing, and
      // nobody notices until an advertiser asks why their banner is missing on one screen.
      // (p.hosts || []) everywhere below: every check runs even after another has failed,
      // so a placement still on the old singular `host` field must not CRASH here. A
      // TypeError reads as a broken guard and buries the vocabulary check's clean message.
      const unmounted = (p.hosts || []).filter(h => !found.includes(h))
      if (unmounted.length) {
        return `<${n}> is not mounted in declared host(s) ${unmounted.join(', ')} (found in: ${found.join(', ') || 'nowhere'}).\n`
          + `      A wrapper nobody mounts is dead inventory; a wrapper mounted elsewhere is an unreviewed placement.`
      }
      const stray = found.filter(h => !(p.hosts || []).includes(h))
      if (stray.length) return `<${n}> is mounted outside its declared hosts: ${stray.join(', ')}`
      for (const h of (p.hosts || [])) {
        const count = [...stripComments(files[h] || '').matchAll(re)].length
        if (count !== 1) return `expected exactly 1 <${n}> in ${h}, found ${count}`
      }
    }
    return null
  }],

  ['span-pinned mounts sit inside their declared function', ({ files, ads }) => {
    // The check a whole-file rule cannot do. EventsScreen.js holds the list AND
    // EventDetailScreen; HomeScreen.js holds the hub, the search results and the gated
    // facility list. Only an offset comparison separates them.
    for (const p of ads.AD_PLACEMENTS) {
      if (!p.span) continue
      // Safe to take hosts[0]: the vocabulary check above refuses a span with anything
      // other than exactly one host, so this is not a silent pick of the first of several.
      const host = (p.hosts || [])[0]
      const clean = stripComments(files[host] || '')
      if (!clean) return `${host} is missing`
      const span = functionSpan(clean, p.span)
      if (!span) {
        // Name the likelier culprit first. If the declaration is in the RAW file but not
        // the stripped one, the stripper ate it and the screen is innocent.
        const inRaw = new RegExp(`function\\s+${p.span}\\s*\\(`).test(files[host])
        return `could not locate function ${p.span}() in ${host} for ${p.position}/${p.module}.\n`
          + (inRaw
              ? `      ⚠ IT IS PRESENT IN THE RAW FILE — so this is the COMMENT STRIPPER, not the screen.\n`
                + `        Fix stripComments(); do not touch ${host}.`
              : `      If it was renamed this check is measuring NOTHING — repoint it rather than deleting it.`)
      }
      const [start, end] = span
      // CONTROL: a slice whose end precedes its start returns '' and passes on everything.
      if (end <= start || end - start < 100) {
        return `the ${p.span}() span in ${host} looks wrong (${start}..${end}, ${end - start} chars). Refusing to conclude anything from it.`
      }
      const n = wrapperName(p.file)
      const m = new RegExp(`<\\s*${n}\\b`).exec(clean)
      if (!m) return `<${n}> not found in ${host}`
      if (m.index < start || m.index > end) {
        return `<${n}> is at offset ${m.index}, OUTSIDE ${p.span}() (${start}..${end}) in ${host}.\n`
          + `      That file hosts more than one surface and some of them are on the exclusion list.`
      }
    }
    return null
  }],

  ['the Home mount is in the hub body, not the search branch', ({ files, ads }) => {
    // renderHubV2 CONTAINS the search branch — an early `if (searchOpen) return (…
    // {renderSearchResults()} …)` sits inside it — so "inside renderHubV2" alone stayed
    // GREEN on a mount moved onto the global search results, which are excluded. Found by
    // --self, not by review. The rule is: inside renderHubV2, OUTSIDE the searchOpen early
    // return, and after <ModuleGrid>, which appears only in the hub's own body.
    const p = ads.AD_PLACEMENTS.find(x => x.module === 'home')
    if (!p) return null
    // hosts[0] is safe: this placement carries a span, and the vocabulary check refuses a
    // span with anything other than exactly one host.
    const pHost = (p.hosts || [])[0]
    const clean = stripComments(files[pHost] || '')
    if (!clean) return `${pHost} is missing`
    const span = functionSpan(clean, p.span)
    if (!span) return `renderHubV2() not found in ${pHost} — this check is measuring nothing`
    const [start, end] = span
    const body = clean.slice(start, end)
    if (!body.includes('<ModuleGrid')) {
      return `the renderHubV2 span (${start}..${end}) does not contain <ModuleGrid>. A slice without the hub's own grid is not the hub.`
    }
    const soRel = body.search(/if\s*\(\s*searchOpen\s*\)\s*\{/)
    if (soRel < 0) {
      return `the searchOpen early return was not found inside renderHubV2. It is what puts the global search results in this file; without locating it this check cannot tell the hub from an excluded surface.`
    }
    let depth = 0, soEnd = -1
    for (let i = body.indexOf('{', soRel); i >= 0 && i < body.length; i++) {
      if (body[i] === '{') depth++
      else if (body[i] === '}') { depth--; if (depth === 0) { soEnd = i; break } }
    }
    if (soEnd < 0) return 'could not brace-match the searchOpen block'
    if (!body.slice(soRel, soEnd).includes('renderSearchResults')) {
      return 'the block matched as the searchOpen early return does not call renderSearchResults — wrong block, so the exclusion below measures the wrong region.'
    }
    const n = wrapperName(p.file)
    const m = new RegExp(`<\\s*${n}\\b`).exec(body)
    if (!m) return `<${n}> not found inside renderHubV2`
    if (m.index >= soRel && m.index <= soEnd) {
      return `<${n}> is inside the searchOpen early return (span-relative ${m.index}, block ${soRel}..${soEnd}).\n`
        + `      That branch renders the GLOBAL SEARCH RESULTS, which is on the permanent exclusion list.`
    }
    if (m.index < body.indexOf('<ModuleGrid')) {
      return `<${n}> is before <ModuleGrid>. list_bottom on home is the FOOTER slot; a mount above the grid is not the placement that was reviewed.`
    }
    return null
  }],

  ['inline hosts use the page inset the bleed assumes', ({ files, ads }) => {
    // list_inline runs full-bleed with marginHorizontal: -AD_PAGE_INSET. That negative
    // margin is a CONTRACT with the hosting list's own padding, not a local style value —
    // if a host changes its inset, the strip stops being flush and starts being crooked,
    // which reads as a rendering bug rather than as a config mismatch.
    const inset = ads.AD_PAGE_INSET
    // EVERY host, not just the first: a second host with a different list inset would put
    // the same sold strip flush on one screen and crooked on the other.
    for (const p of ads.AD_PLACEMENTS.filter(x => x.position === 'list_inline')) {
      for (const h of (p.hosts || [])) {
        const src = files[h] || ''
        const m = /listContent:\s*\{[^}]*paddingHorizontal:\s*(\d+)/.exec(src)
        if (!m) return `could not read listContent's paddingHorizontal in ${h} — refusing to assume it matches AD_PAGE_INSET (${inset})`
        if (Number(m[1]) !== inset) {
          return `${h} insets its list by ${m[1]} but AD_PAGE_INSET is ${inset}.\n`
            + `      The full-bleed inline strip breaks out by exactly -AD_PAGE_INSET, so it would sit ${Math.abs(Number(m[1]) - inset)}pt off on each edge.`
        }
      }
    }
    return null
  }],

  ['rejected placements stay rejected', ({ ads }) => {
    // Recorded decisions with reasons, asserted rather than remembered.
    for (const key of Object.keys(ads.AD_REJECTED_PLACEMENTS)) {
      const [position, module] = key.split('/')
      if (!ads.AD_POSITIONS.includes(position)) continue   // descriptive keys like explore-landing
      if (ads.AD_PLACEMENTS.some(p => p.position === position && p.module === module)) {
        return `${key} is in AD_PLACEMENTS but is a RECORDED REJECTION:\n      ${ads.AD_REJECTED_PLACEMENTS[key]}`
      }
    }
    for (const m of Object.keys(ads.AD_DEFERRED_MODULES)) {
      if (ads.AD_MODULES.includes(m)) {
        return `${m} is in AD_MODULES but is recorded as deliberately deferred:\n      ${ads.AD_DEFERRED_MODULES[m]}`
      }
    }
    return null
  }],

  ['no excluded destination is reachable', ({ ads }) => {
    const bad = ads.AD_ROUTES.filter(r => ads.AD_EXCLUDED_ROUTES.includes(r))
    if (bad.length) {
      return `AD_ROUTES contains excluded destination(s): ${bad.join(', ')}\n`
        + `      The exclusion list forbids ads ON those surfaces; a paid banner routed INTO one\n`
        + `      monetises it at one remove, which is the same thing by a different door.`
    }
    if (!ads.AD_ROUTES.length)          return 'AD_ROUTES is empty — the check above tested nothing'
    if (!ads.AD_EXCLUDED_ROUTES.length) return 'AD_EXCLUDED_ROUTES is empty — the check above tested nothing'
    return null
  }],

  ['every in-app route resolves in App.js', ({ files, ads }) => {
    // An unknown route is a PAID banner that does nothing when tapped — a failure that
    // looks like a frozen app, not like a bad row, and nothing would report it.
    const clean = stripComments(files[APP] || '')
    if (!clean) return `${APP} is missing`
    const span = functionSpan(clean, 'openAdRoute')
    if (!span) return `openAdRoute() not found in ${APP} — this check is measuring nothing`
    const body = clean.slice(span[0], span[1])
    if (body.length < 100) return `the openAdRoute() span is ${body.length} chars — refusing to conclude anything from it`
    const missing = ads.AD_ROUTES.filter(r => !body.includes(`case '${r}'`))
    if (missing.length) {
      return `AD_ROUTES ids with no case in openAdRoute(): ${missing.join(', ')}\n`
        + `      A banner routed there would render, charge the advertiser, and do nothing when tapped.`
    }
    const leaked = ads.AD_EXCLUDED_ROUTES.filter(r => body.includes(`case '${r}'`))
    if (leaked.length) return `openAdRoute() can reach an EXCLUDED destination: ${leaked.join(', ')}`
    return null
  }],

  ['the migrations agree with constants/ads.js', ({ migrationA, migrationB, ads }) => {
    // ⚠ THIS COMPARES FILES. It says nothing about the database — see the header.
    if (!migrationA) return `${MIGRATION_A} is missing`
    if (!migrationB) return `${MIGRATION_B} is missing — the position/module restructure is unwritten`

    const constraintValues = (sql, name) => {
      const at = sql.indexOf(`ADD CONSTRAINT ${name}`)
      if (at < 0) return null
      const end = sql.indexOf(';', at)
      if (end < 0) return null
      const body = sql.slice(at, end)
      const inAt = body.indexOf('IN (')
      if (inAt < 0) return null
      const v = [...body.slice(inAt).matchAll(/'([^']+)'/g)].map(m => m[1])
      return v.length ? v : null
    }

    const positions = constraintValues(migrationB, 'ad_banners_position_check')
    if (!positions) return `could not read the position vocabulary out of ad_banners_position_check in ${MIGRATION_B}. Refusing to report agreement from an empty slice.`
    const onlyJs = ads.AD_POSITIONS.filter(x => !positions.includes(x))
    const onlySql = positions.filter(x => !ads.AD_POSITIONS.includes(x))
    if (onlyJs.length || onlySql.length) {
      return `position vocabularies disagree:\n`
        + (onlyJs.length ? `      only in constants/ads.js: ${onlyJs.join(', ')}\n` : '')
        + (onlySql.length ? `      only in the migration:    ${onlySql.join(', ')}` : '')
    }

    // The ad_modules seed, read from the INSERT rather than from a remembered list.
    const seedAt = migrationB.indexOf('INSERT INTO public.ad_modules')
    const seedEnd = migrationB.indexOf('ON CONFLICT', seedAt)
    if (seedAt < 0 || seedEnd <= seedAt) return `could not slice the ad_modules seed in ${MIGRATION_B}`
    const seeded = [...migrationB.slice(seedAt, seedEnd).matchAll(/\(\s*'([a-zA-Z]+)'\s*,/g)].map(m => m[1])
    if (!seeded.length) return `the ad_modules seed slice parsed no modules — refusing to conclude anything from it`
    const modOnlyJs = ads.AD_MODULES.filter(x => !seeded.includes(x))
    const modOnlySql = seeded.filter(x => !ads.AD_MODULES.includes(x))
    if (modOnlyJs.length || modOnlySql.length) {
      return `ad_modules seed disagrees with AD_MODULES:\n`
        + (modOnlyJs.length ? `      only in constants/ads.js: ${modOnlyJs.join(', ')}\n` : '')
        + (modOnlySql.length ? `      only in the migration:    ${modOnlySql.join(', ')}` : '')
    }
    for (const m of Object.keys(ads.AD_DEFERRED_MODULES)) {
      if (seeded.includes(m)) {
        return `${MIGRATION_B} seeds ${m} into ad_modules, but it is recorded as deferred.\n`
          + `      A lookup row with no placeable position accepts a PAID campaign that renders nowhere.`
      }
    }

    const routes = constraintValues(migrationA, 'ad_banners_route_check')
    if (!routes) return `could not read the route vocabulary out of ad_banners_route_check in ${MIGRATION_A}`
    const rOnlyJs = ads.AD_ROUTES.filter(x => !routes.includes(x))
    const rOnlySql = routes.filter(x => !ads.AD_ROUTES.includes(x))
    if (rOnlyJs.length || rOnlySql.length) {
      return `route vocabularies disagree:\n`
        + (rOnlyJs.length ? `      only in constants/ads.js: ${rOnlyJs.join(', ')}\n` : '')
        + (rOnlySql.length ? `      only in the migration:    ${rOnlySql.join(', ')}` : '')
    }
    const leaked = routes.filter(r => ads.AD_EXCLUDED_ROUTES.includes(r))
    if (leaked.length) return `${MIGRATION_A} admits an excluded destination: ${leaked.join(', ')}`
    return null
  }],
]

// ─── Runner ─────────────────────────────────────────────────────────────────

const run = input => CHECKS.map(([name, fn]) => [name, fn(input)]).filter(([, r]) => r)
const SELF = process.argv.includes('--self')

if (!SELF) {
  const problems = run(gather())
  if (problems.length) {
    console.error('')
    console.error('  ┌─ AD PLACEMENT GUARD FAILED ────────────────────────────────────┐')
    for (const [name, msg] of problems) console.error(`  │ ${name}: ${msg}`)
    console.error('  └────────────────────────────────────────────────────────────────┘')
    console.error('')
    console.error('  The permanent exclusion list is: no ads on duty pharmacy, emergency contacts,')
    console.error('  health facilities, search results, push notifications, or Ask Oli.')
    console.error('  It is keyed on FILES because only a file path identifies a surface — a module')
    console.error('  being allowed never makes a screen allowed. Surfaces and reasons: constants/ads.js.')
    console.error('')
    process.exit(1)
  }
  const a = adsPlain()
  const byModule = {}
  for (const p of a.AD_PLACEMENTS) (byModule[p.module] ||= []).push(p.position)
  console.log(`ad placement: OK (${CHECKS.length} checks · ${a.AD_PLACEMENTS.length} placements · `
    + `${Object.keys(a.AD_EXCLUDED_SURFACES).length} excluded surfaces · ${a.AD_ROUTES.length} destinations)`)
  for (const [m, ps] of Object.entries(byModule)) console.log(`  ${m.padEnd(14)} ${ps.join(', ')}`)
  if (Object.keys(a.AD_DEFERRED_MODULES).length) {
    console.log(`  deferred:      ${Object.keys(a.AD_DEFERRED_MODULES).join(', ')} (no placeable position — not seeded)`)
  }
  console.log('  NOTE: this reads FILES. It says nothing about what is applied in the database —')
  console.log('        that is supabase/verify_schema.sql, and only if somebody runs it.')
  process.exit(0)
}

// ─── --self: prove every check can go RED ───────────────────────────────────
const base = gather()
const clone = () => ({ files: { ...base.files }, migrationA: base.migrationA, migrationB: base.migrationB, ads: adsPlain() })

const CASES = [
  ['placement vocabulary is coherent', () => {
    const i = clone(); i.ads.AD_PLACEMENTS[0].position = 'not_a_position'
    return [i, s => s.ads.AD_PLACEMENTS[0].position === 'not_a_position']
  }],
  ['wrappers exist and actually wrap AdSlot', () => {
    const i = clone()
    const f = i.ads.AD_PLACEMENTS[0].file
    i.files[f] = base.files[f].replace(/import AdSlot[^\n]*\n/, '')
    return [i, s => !/from\s+['"][^'"]*AdSlot['"]/.test(stripComments(s.files[f]))]
  }],
  ['excluded surfaces still exist', () => {
    const i = clone(); delete i.files['screens/DutyListScreen.js']
    return [i, s => !('screens/DutyListScreen.js' in s.files)]
  }],
  ['only wrappers import AdSlot', () => {
    const i = clone()
    i.files['screens/DutyListScreen.js'] = `import AdSlot from '../components/AdSlot'\n` + base.files['screens/DutyListScreen.js']
    return [i, s => /from\s+['"][^'"]*\/AdSlot['"]/.test(stripComments(s.files['screens/DutyListScreen.js']))]
  }],
  // ⚠ THE CASE THE MODEL EXISTS TO CATCH: someone reasons "explore is an allowed module,
  //   so its detail screen is fine" and allowlists FacilityProfileScreen for
  //   detail_bottom/explore. It must fail on the FILE, not on the module.
  ['no wrapper file is an excluded surface', () => {
    const i = clone()
    const p = i.ads.AD_PLACEMENTS.find(x => x.position === 'detail_bottom' && x.module === 'explore')
    p.hosts = ['screens/FacilityProfileScreen.js']
    return [i, s => s.ads.AD_PLACEMENTS.some(x => (x.hosts || []).includes('screens/FacilityProfileScreen.js'))]
  }],
  ['no ad is mounted in an excluded surface', () => {
    const i = clone()
    i.files['components/OliGuide.js'] = base.files['components/OliGuide.js'].replace(
      'export default', 'const X = () => <ExploreListTopSlot />\nexport default')
    return [i, s => s.files['components/OliGuide.js'].includes('<ExploreListTopSlot')]
  }],
  ['every wrapper is mounted only in its declared host', () => {
    const i = clone()
    i.files['screens/NotificationsScreen.js'] = base.files['screens/NotificationsScreen.js'] + '\nconst Y = () => <EventsListTopSlot />\n'
    return [i, s => /<\s*EventsListTopSlot/.test(stripComments(s.files['screens/NotificationsScreen.js']))]
  }],
  ['span-pinned mounts sit inside their declared function', () => {
    // Move the events DETAIL slot out of EventDetailScreen and into the list's own body —
    // same file, different surface, which is exactly what a file-level rule cannot see.
    const i = clone()
    const f = 'screens/EventsScreen.js'
    i.files[f] = base.files[f]
      .replace('          <EventsDetailBottomSlot lang={lang} onNavigate={onAdNavigate} />\n', '')
      .replace('          ListEmptyComponent={', '          ListEmptyComponent={/* moved */ null && <EventsDetailBottomSlot />}\n          ListEmptyComponentUnused={')
    return [i, s => s.files[f] !== base.files[f] && s.files[f].includes('ListEmptyComponentUnused')]
  }],
  ['the Home mount is in the hub body, not the search branch', () => {
    const i = clone()
    const f = 'screens/HomeScreen.js'
    i.files[f] = base.files[f]
      .replace('            <HomeListBottomSlot lang={lang} onNavigate={openAdRoute} />\n', '')
      .replace('            {renderSearchResults()}', '            {renderSearchResults()}\n            <HomeListBottomSlot lang={lang} onNavigate={openAdRoute} />')
    return [i, s => s.files[f].includes('{renderSearchResults()}\n            <HomeListBottomSlot')]
  }],
  ['inline hosts use the page inset the bleed assumes', () => {
    const i = clone(); i.ads.AD_PAGE_INSET = 20
    return [i, s => s.ads.AD_PAGE_INSET === 20]
  }],
  ['rejected placements stay rejected', () => {
    const i = clone()
    i.ads.AD_PLACEMENTS.push({ file: 'components/ads/ExploreListBottomSlot.js', position: 'list_bottom', module: 'explore', hosts: ['screens/ExploreScreen.js'] })
    return [i, s => s.ads.AD_PLACEMENTS.some(p => p.position === 'list_bottom' && p.module === 'explore')]
  }],
  ['no excluded destination is reachable', () => {
    const i = clone(); i.ads.AD_ROUTES = [...i.ads.AD_ROUTES, 'emergency']
    return [i, s => s.ads.AD_ROUTES.includes('emergency')]
  }],
  ['every in-app route resolves in App.js', () => {
    const i = clone(); i.ads.AD_ROUTES = [...i.ads.AD_ROUTES, 'notARealModule']
    return [i, s => s.ads.AD_ROUTES.includes('notARealModule')]
  }],
  ['the migrations agree with constants/ads.js', () => {
    const i = clone()
    const before = i.migrationB
    i.migrationB = before.replace("('explore',       'ExploreScreen", "('newcomerEssentials', 'x'),\n  ('explore',       'ExploreScreen")
    return [i, s => s.migrationB !== before && s.migrationB.includes("('newcomerEssentials', 'x')")]
  }],
]

let bad = 0
console.log('')
console.log('  ── --self: every check must be able to go RED ──')
const baseline = run(base)
if (baseline.length) {
  console.log(`  !! the UNMUTATED repo already fails: ${baseline.map(([n]) => n).join(', ')}`)
  for (const [n, m] of baseline) console.log(`     ${n}: ${m}`)
  console.log('     --self cannot distinguish a working check from a broken repo. Fix the repo first.')
  process.exit(1)
}
console.log('  baseline: clean (so every RED below is caused by the mutation, not by the repo)')
for (const [name, build] of CASES) {
  const [input, landed] = build()
  if (!landed(input)) { console.log(`  !! ${name}: MUTATION DID NOT LAND — result meaningless`); bad++; continue }
  if (!run(input).some(([n]) => n === name)) { console.log(`  !! ${name}: mutation landed, check DID NOT FIRE  <-- dead check`); bad++ }
  else console.log(`  ok ${name}`)
}
console.log('')
if (bad) { console.log(`  ${bad} check(s) could not be proven able to fail.`); process.exit(1) }
console.log(`  all ${CASES.length} checks proven able to fail, and all ${CHECKS.length} checks green on the real repo.`)
process.exit(0)
