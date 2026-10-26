#!/usr/bin/env node
// Offline proof of the Novest image-prune planner (scripts/lib/novest-prune-plan.mjs) and of the
// workflow wiring that keeps the SCHEDULED run from ever pruning. No network, no keys.
//
//   node scripts/check-novest-prune.mjs
//   node scripts/check-novest-prune.mjs --planner <alt.mjs>   # red-first: run against a broken copy

import { readFileSync, mkdtempSync, writeFileSync, chmodSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pi = process.argv.indexOf('--planner')
const { planPrune } = await import(pi !== -1
  ? pathToFileURL(resolve(process.argv[pi + 1])).href
  : './lib/novest-prune-plan.mjs')

const { pruneRefusal, parseImageUrl, deletablePaths } = await import('./lib/novest-prune-plan.mjs')
const rai = process.argv.indexOf('--reader')
const { readAllRows } = await import(rai !== -1
  ? pathToFileURL(resolve(process.argv[rai + 1])).href
  : './lib/read-all-rows.mjs')

const U = (ext, media, e = 'jpg') => `https://x.supabase.co/storage/v1/object/public/property-images/partner/novest/${ext}/${media}.${e}`
let img = 0
const row = (prop, ext, media, so, primary = false, url) =>
  ({ id: `i${++img}`, property_id: prop, url: url ?? U(ext, media), sort_order: so, is_primary: primary })
const L = (id, ext, status = 'active') => ({ id, external_id: ext, status })
const feedOf = o => new Map(Object.entries(o))
const ids = a => a.map(x => x.media_id).sort().join(',')

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n      got    ${JSON.stringify(got)}\n      wanted ${JSON.stringify(want)}`}`)
}

// 1. media dropped from the feed is removed; the rest stays
{
  const p = planPrune({ listings: [L('A', 'novest-1')],
    images: [row('A', 'novest-1', '1010', 0, true), row('A', 'novest-1', '1011', 1), row('A', 'novest-1', '1012', 2)],
    feed: feedOf({ 'novest-1': ['1010', '1012'] }) })
  t('removed media is planned, referenced media is kept', ids(p.removals), '1011')
  t('  plan carries id, sort_order, is_primary, path', p.removals[0] && [p.removals[0].external_id, p.removals[0].sort_order, p.removals[0].is_primary, p.removals[0].path],
    ['novest-1', 1, false, 'partner/novest/novest-1/1011.jpg'])
  t('  no reassignment when the primary stays', p.reassign.length, 0)
}
// 2. still referenced but not served by /media (a 404) is NOT removed. The planner sees only refs.
{
  const p = planPrune({ listings: [L('A', 'novest-20111')],
    images: [row('A', 'novest-20111', '1001', 0, true), row('A', 'novest-20111', '1002', 1), row('A', 'novest-20111', '1003', 2)],
    feed: feedOf({ 'novest-20111': ['1001', '1002', '1003'] }) })   // 3 is still referenced (its /media 404s today): keep the row
  t('referenced-but-unserved media: nothing removed', p.removals.length, 0)
}
// 3. last photo: pruning would leave zero rows -> listing skipped entirely
{
  const p = planPrune({ listings: [L('A', 'novest-2')],
    images: [row('A', 'novest-2', '1020', 0, true), row('A', 'novest-2', '1021', 1)],
    feed: feedOf({ 'novest-2': ['1099'] }) })
  t('would-be photoless listing: no removals, listed as lastPhoto', [p.removals.length, p.skipped.lastPhoto], [0, ['novest-2']])
}
// 3b. dry only: photos the mirror will add first make the same listing prunable (dry == what apply does)
{
  const rows = [row('A', 'novest-2b', '1020', 0, true), row('A', 'novest-2b', '1021', 1)]
  const p = planPrune({ listings: [L('A', 'novest-2b')], images: rows, feed: feedOf({ 'novest-2b': ['1098', '1099'] }), incoming: new Map([['novest-2b', 2]]) })
  t('incoming mirror photos lift the last-photo skip (dry mirrors apply)', [p.removals.length, p.skipped.lastPhoto.length], [2, 0])
  t('  and plans a primary reassignment to a new photo (null id)', p.reassign.map(r => r.image_id), [null])
}
// 4. primary removed -> lowest remaining sort_order becomes primary
{
  const rows = [row('A', 'novest-3', '1030', 0, true), row('A', 'novest-3', '1031', 1), row('A', 'novest-3', '1032', 2)]
  const p = planPrune({ listings: [L('A', 'novest-3')], images: rows, feed: feedOf({ 'novest-3': ['1031', '1032'] }) })
  t('primary removal: reassign to lowest remaining sort_order', [ids(p.removals), p.reassign.map(r => r.image_id)], ['1030', [rows[1].id]])
}
// 5. unrecognised url, or an external_id segment that is not the listing's: never touched
{
  const p = planPrune({ listings: [L('A', 'novest-4')],
    images: [row('A', 'novest-4', '1040', 0, true), row('A', 'novest-4', '', 1, false, 'https://elsewhere.example/a.jpg'),
             row('A', 'novest-4', '1041', 2, false, U('novest-OTHER', '1041')), row('A', 'novest-4', '1042', 3, false, U('novest-4', '1042', ''))],
    feed: feedOf({ 'novest-4': ['1040'] }) })
  t('unrecognised / foreign-segment rows are not removed', p.removals.length, 0)
  t('  and are reported as unrecognised', p.skipped.unrecognised.length, 3)
}
// 6. delisted listing skipped entirely
{
  const p = planPrune({ listings: [L('A', 'novest-5', 'delisted'), L('B', 'novest-6')],
    images: [row('A', 'novest-5', '1050', 0, true), row('A', 'novest-5', '1051', 1), row('B', 'novest-6', '1060', 0, true)],
    feed: feedOf({ 'novest-5': ['1050'], 'novest-6': ['1060'] }) })
  t('delisted listing: not checked, nothing removed', [p.removals.length, p.checked, p.skipped.notActive], [0, 1, ['novest-5']])
}
// 7. the same media id on two listings: dropping it from one never touches the other
{
  const p = planPrune({ listings: [L('A', 'novest-7'), L('B', 'novest-8')],
    images: [row('A', 'novest-7', '1070', 0, true), row('A', 'novest-7', '1077', 1), row('B', 'novest-8', '1080', 0, true), row('B', 'novest-8', '1077', 1)],
    feed: feedOf({ 'novest-7': ['1070'], 'novest-8': ['1080', '1077'] }) })
  t('shared media id: only the listing that dropped it loses the row', p.removals.map(r => `${r.external_id}/${r.media_id}`), ['novest-7/1077'])
}
// 8. floors
{
  const mk = (n, nListings) => {
    const listings = [], images = [], feed = {}
    for (let i = 0; i < nListings; i++) {
      const e = `novest-f${i}`; listings.push(L(`P${i}`, e)); feed[e] = ['1001']
      images.push(row(`P${i}`, e, '1001', 0, true))
      for (let j = 0; j < n; j++) images.push(row(`P${i}`, e, String(1100 + j), j + 1))
    }
    return { listings, images, feed: feedOf(feed) }
  }
  t('removals above max(10, 15%) abort', [planPrune(mk(2, 6)).removals.length, planPrune(mk(2, 6)).abort.length > 0], [12, true])             // 12 removals of 18 rows
  const atCap = planPrune(mk(2, 5))
  t('removals at the cap (10) do not abort', [atCap.removals.length, atCap.abort.length], [10, 0])   // 10 removals of 15 rows
  t('fixture sanity: mk(0,10) has 10 checked listings', planPrune(mk(0, 10)).checked, 10)
  const m = mk(0, 10); m.feed.delete('novest-f0'); m.feed.delete('novest-f1'); m.feed.delete('novest-f2')
  t('> 20% of active listings missing from the feed aborts', planPrune(m).abort.length > 0, true)
  const m2 = mk(0, 10); m2.feed.delete('novest-f0'); m2.feed.delete('novest-f1')
  const p2 = planPrune(m2)
  t('exactly 20% missing: skipped, no abort', [p2.abort.length, p2.skipped.notInFeed.length], [0, 2])
  t('an empty feed aborts', planPrune({ ...mk(0, 3), feed: new Map() }).abort.length > 0, true)
  t('an empty feed aborts even with no listings (no 20% rule to catch it)', planPrune({ listings: [], images: [], feed: new Map() }).abort.length, 1)
}
// 9. mirror incomplete for the listing -> skipped, even though media was dropped
{
  const p = planPrune({ listings: [L('A', 'novest-9')],
    images: [row('A', 'novest-9', '1090', 0, true), row('A', 'novest-9', '1091', 1)],
    feed: feedOf({ 'novest-9': ['1090'] }), incomplete: new Set(['novest-9']) })
  t('mirror failed/pending for the listing: skipped', [p.removals.length, p.skipped.mirrorIncomplete], [0, ['novest-9']])
}

// 10. legacy `{n}.{ext}` rows
{
  const legacy = U('novest-L', '3')                                   // small index, not a media id
  t('small integers are never parsed as media ids', [parseImageUrl(legacy), parseImageUrl(U('novest-L', '999')), parseImageUrl(U('novest-L', '1000'))?.mediaId], [null, null, '1000'])
  // 4+ digit path that is NOT referenced, but its source_url is exactly what the mirror would fetch for referenced media 9999
  const served = new Map([['novest-L', new Set(['https://novest.example/wp/9999-1536.jpg'])]])
  const mk = () => [
    { ...row('A', 'novest-L', '5555', 0, true), source_url: 'https://novest.example/wp/9999-1536.jpg' },   // old path, live media behind it
    { ...row('A', 'novest-L', '6666', 1), source_url: 'https://novest.example/wp/gone.jpg' },
    { ...row('A', 'novest-L', '7777', 2), source_url: null },
    row('A', 'novest-L', '9999', 3)]
  const p = planPrune({ listings: [L('A', 'novest-L')], images: mk(), feed: feedOf({ 'novest-L': ['9999'] }), served })
  t('row whose source_url is a served URL of a referenced media is kept (path irrelevant)', p.removals.map(r => r.media_id).sort(), ['6666', '7777'])
  const p2 = planPrune({ listings: [L('A', 'novest-L')], images: [row('A', 'novest-L', '', 0, true, legacy), { ...row('A', 'novest-L', '', 1, false, legacy), source_url: 'https://novest.example/wp/9999-1536.jpg' }, row('A', 'novest-L', '9999', 2)], feed: feedOf({ 'novest-L': ['9999'] }), served })
  t('legacy small-integer path rows are never removed', [p2.removals.length, p2.skipped.unrecognised.length], [0, 2])
}

// 11. pagination: the server caps a response at 1000 rows; a stub client behaves like PostgREST
{
  const mkStub = (total, cap = 1000, countOverride) => {
    const all = Array.from({ length: total }, (_, i) => ({ id: i }))
    return (from, to) => Promise.resolve({ data: all.slice(from, Math.min(to + 1, from + cap)), error: null, count: countOverride ?? total })
  }
  const r = await readAllRows(mkStub(2350))
  t('2350 rows with a 1000-row cap are all read', [r.rows.length, r.exact, new Set(r.rows.map(x => x.id)).size], [2350, 2350, 2350])
  t('exactly 1000 rows (boundary) are read once', (await readAllRows(mkStub(1000))).rows.length, 1000)
  t('zero rows is a valid read', (await readAllRows(mkStub(0))).rows.length, 0)
  for (const cap of [500, 1000]) {
    let got
    try { const rc = await readAllRows(mkStub(2350, cap)); got = [rc.rows.length, new Set(rc.rows.map(x => x.id)).size] } catch (e) { got = e.message }
    t(`server cap ${cap}: all 2350 rows read, no dupes`, got, [2350, 2350])
  }
  let msg = null
  try { await readAllRows(mkStub(2350, 1000, 2400)) } catch (e) { msg = e.message }
  t('rows received != exact count fails', msg, 'read 2350 rows, expected 2400')
  let msg2 = null
  try { await readAllRows(() => Promise.resolve({ data: null, error: { message: 'boom' }, count: null })) } catch (e) { msg2 = e.message }
  t('a read error fails', msg2, 'boom')
}

// 11b. a storage object still referenced by a row that remains is never deleted
{
  const shared = U('novest-S', '5000')
  const mk = () => [row('A', 'novest-S', '5000', 0, true, shared), row('A', 'novest-S', '5000', 1, false, shared), row('A', 'novest-S', '5001', 2), row('A', 'novest-S', '1111', 3)]
  const imgs = mk()
  const p = planPrune({ listings: [L('A', 'novest-S')], images: imgs, feed: feedOf({ 'novest-S': ['5001', '1111'] }) })
  t('both rows of a shared path removed -> object deleted', [p.removals.length, p.objectPaths], [2, ['partner/novest/novest-S/5000.jpg']])
  const p2 = planPrune({ listings: [L('A', 'novest-S')], images: imgs, feed: feedOf({ 'novest-S': ['5001', '1111'] }) })
  const oneKept = deletablePaths(imgs, p2.removals.slice(0, 1))
  t('two rows share a path, one remains -> object not in the delete list', oneKept, [])
}

// 12. the script-side guard
{
  const env = (o) => ({ GITHUB_ACTIONS: 'true', ...o })
  const R = (prune, o) => pruneRefusal({ prune, env: o }) !== null
  t('guard: dispatch + IN_PRUNE=true allowed', R(true, env({ GITHUB_EVENT_NAME: 'workflow_dispatch', IN_PRUNE: 'true' })), false)
  t('guard: dispatch + IN_PRUNE=false refused', R(true, env({ GITHUB_EVENT_NAME: 'workflow_dispatch', IN_PRUNE: 'false' })), true)
  t('guard: dispatch + IN_PRUNE unset refused', R(true, env({ GITHUB_EVENT_NAME: 'workflow_dispatch' })), true)
  t('guard: schedule refused', R(true, env({ GITHUB_EVENT_NAME: 'schedule', IN_PRUNE: 'true' })), true)
  t('guard: push refused', R(true, env({ GITHUB_EVENT_NAME: 'push', IN_PRUNE: 'true' })), true)
  t('guard: local (not CI) is allowed', R(true, {}), false)
  t('guard: no --prune never refuses', R(false, env({ GITHUB_EVENT_NAME: 'schedule' })), false)
  const src = readFileSync(resolve(ROOT, 'scripts/mirror-novest-images.mjs'), 'utf8')
  t('mirror passes `served` to planPrune', /planPrune\(\{[^}]*\bserved\b[^}]*\}\)/.test(src), true)
  const calls = src.split('readAllRows(').length - 1
  const okCalls = [...src.matchAll(/await readAllRows\(([\s\S]*?\.range\(a, b\)\))/g)].filter(m => m[1].includes("{ count: 'exact' }") && m[1].includes(".order('id')")).length
  t('every readAllRows( call site has count exact and .order(\'id\')', [calls, okCalls], [3, 3])
  t('haveImages / primary-repair catch blocks call fail(', [/haveImages = \(await readAllRows(?:(?!catch)[\s\S])*?\} catch \(e\) \{ fail\(/.test(src), /cur = \(await readAllRows(?:(?!catch)[\s\S])*?\} catch \(e\) \{ fail\(/.test(src)], [true, true])
  t('prune abort line prints no error text', /PRUNE ABORTED: reading property_images failed\.? Nothing/.test(src) && !/PRUNE ABORTED: reading[^\n]*\$\{e/.test(src), true)
  t('mirror deletes storage via deletablePaths', src.includes('deletablePaths(rows, deleted)'), true)
  t('mirror script calls pruneRefusal before prodWriteGuard', /pruneRefusal\(\{ prune, env: process\.env \}\)[\s\S]*?prodWriteGuard\(\{/.test(src), true)
}

// ─── Workflow wiring: execute the real Mirror step ───────────────────────────
// The run: block is parsed out of the YAML and run in bash with `node` stubbed to echo its args.
{
  const require = createRequire(import.meta.url)
  let yaml
  try { yaml = require('js-yaml') } catch { console.log('  ✗ js-yaml is not installed (npm ci)'); process.exit(1) }
  const doc = yaml.load(readFileSync(resolve(ROOT, '.github/workflows/novest-images.yml'), 'utf8'))
  const steps = doc.jobs.run.steps
  const mirror = steps.filter(s => s.name === 'Mirror')
  t('exactly one step named Mirror', mirror.length, 1)
  const run = mirror[0]?.run ?? ''
  t('no other step touches the mirror script or --prune', steps.filter(s => s !== mirror[0] && /--prune|mirror-novest-images/.test(s.run ?? '')).length, 0)
  t('job env wires IN_PRUNE / IN_APPLY / IN_LIMIT from the inputs', [doc.jobs.run.env.IN_PRUNE, doc.jobs.run.env.IN_APPLY, doc.jobs.run.env.IN_LIMIT], ['${{ inputs.prune }}', '${{ inputs.apply }}', '${{ inputs.limit }}'])
  t('on: schedule is cron-only, dispatch has the prune input', [Object.keys(doc.on).sort(), doc.on.workflow_dispatch.inputs.prune.default], [['schedule', 'workflow_dispatch'], false])
  const pruneLines = run.split('\n').filter(l => !l.trim().startsWith('#') && l.includes('--prune'))
  t('exactly one line of the Mirror step mentions --prune', pruneLines.length, 1)
  t('exactly one node invocation, of the mirror script', run.split('\n').filter(l => /\bnode\b/.test(l)).length, 1)

  const dir = mkdtempSync(resolve(tmpdir(), 'novest-wf-'))
  writeFileSync(resolve(dir, 'node'), '#!/bin/bash\necho "ARGS:$*"\n')
  chmodSync(resolve(dir, 'node'), 0o755)
  let wrong = []
  for (const ev of ['schedule', 'workflow_dispatch', 'push'])
    for (const pr of ['', 'false', 'true'])
      for (const ap of ['', 'false', 'true']) {
        const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', run], {
          env: { PATH: `${dir}:${process.env.PATH}`, GITHUB_EVENT_NAME: ev, IN_PRUNE: pr, IN_APPLY: ap, IN_LIMIT: '' }, encoding: 'utf8' })
        const argv = (/^ARGS:(.*)$/m.exec(r.stdout ?? '')?.[1] ?? 'NO-NODE-CALL').trim().split(/\s+/)
        const hasPrune = argv.includes('--prune'), hasDry = argv.includes('--dry')
        const wantPrune = ev === 'workflow_dispatch' && pr === 'true'
        const wantDry = !(ap === 'true' || ev === 'schedule')
        const problems = []
        if (r.status !== 0) problems.push(`exit ${r.status}`)
        if (hasPrune !== wantPrune) problems.push(`--prune ${hasPrune}, wanted ${wantPrune}`)
        if (hasDry !== wantDry) problems.push(`--dry ${hasDry}, wanted ${wantDry}`)
        if (hasPrune && !hasDry && !(ap === 'true' && ev === 'workflow_dispatch' && pr === 'true')) problems.push('applying prune without apply=true')
        if (ev === 'schedule' && hasPrune) problems.push('schedule pruned')
        if (problems.length) wrong.push(`${ev}/prune=${pr || '-'}/apply=${ap || '-'}: ${problems.join('; ')} [${argv.join(' ')}]`)
      }
  t('all 27 event x prune x apply combinations behave', wrong, [])
}

console.log(bad ? `\n${bad} check(s) FAILED` : '\nall checks passed')
process.exit(bad ? 1 : 0)
