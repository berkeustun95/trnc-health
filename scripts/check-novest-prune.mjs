#!/usr/bin/env node
// Offline proof of the Novest image-prune planner (scripts/lib/novest-prune-plan.mjs) and of the
// workflow wiring that keeps the SCHEDULED run from ever pruning. No network, no keys.
//
//   node scripts/check-novest-prune.mjs
//   node scripts/check-novest-prune.mjs --planner <alt.mjs>   # red-first: run against a broken copy

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pi = process.argv.indexOf('--planner')
const { planPrune } = await import(pi !== -1
  ? pathToFileURL(resolve(process.argv[pi + 1])).href
  : './lib/novest-prune-plan.mjs')

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
    images: [row('A', 'novest-1', '10', 0, true), row('A', 'novest-1', '11', 1), row('A', 'novest-1', '12', 2)],
    feed: feedOf({ 'novest-1': ['10', '12'] }) })
  t('removed media is planned, referenced media is kept', ids(p.removals), '11')
  t('  plan carries id, sort_order, is_primary, path', p.removals[0] && [p.removals[0].external_id, p.removals[0].sort_order, p.removals[0].is_primary, p.removals[0].path],
    ['novest-1', 1, false, 'partner/novest/novest-1/11.jpg'])
  t('  no reassignment when the primary stays', p.reassign.length, 0)
}
// 2. still referenced but not served by /media (a 404) is NOT removed. The planner sees only refs.
{
  const p = planPrune({ listings: [L('A', 'novest-20111')],
    images: [row('A', 'novest-20111', '1', 0, true), row('A', 'novest-20111', '2', 1), row('A', 'novest-20111', '3', 2)],
    feed: feedOf({ 'novest-20111': ['1', '2', '3'] }) })   // 3 is still referenced (its /media 404s today): keep the row
  t('referenced-but-unserved media: nothing removed', p.removals.length, 0)
}
// 3. last photo: pruning would leave zero rows -> listing skipped entirely
{
  const p = planPrune({ listings: [L('A', 'novest-2')],
    images: [row('A', 'novest-2', '20', 0, true), row('A', 'novest-2', '21', 1)],
    feed: feedOf({ 'novest-2': ['99'] }) })
  t('would-be photoless listing: no removals, listed as lastPhoto', [p.removals.length, p.skipped.lastPhoto], [0, ['novest-2']])
}
// 3b. dry only: photos the mirror will add first make the same listing prunable (dry == what apply does)
{
  const rows = [row('A', 'novest-2b', '20', 0, true), row('A', 'novest-2b', '21', 1)]
  const p = planPrune({ listings: [L('A', 'novest-2b')], images: rows, feed: feedOf({ 'novest-2b': ['98', '99'] }), incoming: new Map([['novest-2b', 2]]) })
  t('incoming mirror photos lift the last-photo skip (dry mirrors apply)', [p.removals.length, p.skipped.lastPhoto.length], [2, 0])
  t('  and plans a primary reassignment to a new photo (null id)', p.reassign.map(r => r.image_id), [null])
}
// 4. primary removed -> lowest remaining sort_order becomes primary
{
  const rows = [row('A', 'novest-3', '30', 0, true), row('A', 'novest-3', '31', 1), row('A', 'novest-3', '32', 2)]
  const p = planPrune({ listings: [L('A', 'novest-3')], images: rows, feed: feedOf({ 'novest-3': ['31', '32'] }) })
  t('primary removal: reassign to lowest remaining sort_order', [ids(p.removals), p.reassign.map(r => r.image_id)], ['30', [rows[1].id]])
}
// 5. unrecognised url, or an external_id segment that is not the listing's: never touched
{
  const p = planPrune({ listings: [L('A', 'novest-4')],
    images: [row('A', 'novest-4', '40', 0, true), row('A', 'novest-4', '', 1, false, 'https://elsewhere.example/a.jpg'),
             row('A', 'novest-4', '41', 2, false, U('novest-OTHER', '41')), row('A', 'novest-4', '42', 3, false, U('novest-4', '42', ''))],
    feed: feedOf({ 'novest-4': ['40'] }) })
  t('unrecognised / foreign-segment rows are not removed', p.removals.length, 0)
  t('  and are reported as unrecognised', p.skipped.unrecognised.length, 3)
}
// 6. delisted listing skipped entirely
{
  const p = planPrune({ listings: [L('A', 'novest-5', 'delisted'), L('B', 'novest-6')],
    images: [row('A', 'novest-5', '50', 0, true), row('A', 'novest-5', '51', 1), row('B', 'novest-6', '60', 0, true)],
    feed: feedOf({ 'novest-5': ['50'], 'novest-6': ['60'] }) })
  t('delisted listing: not checked, nothing removed', [p.removals.length, p.checked, p.skipped.notActive], [0, 1, ['novest-5']])
}
// 7. the same media id on two listings: dropping it from one never touches the other
{
  const p = planPrune({ listings: [L('A', 'novest-7'), L('B', 'novest-8')],
    images: [row('A', 'novest-7', '70', 0, true), row('A', 'novest-7', '77', 1), row('B', 'novest-8', '80', 0, true), row('B', 'novest-8', '77', 1)],
    feed: feedOf({ 'novest-7': ['70'], 'novest-8': ['80', '77'] }) })
  t('shared media id: only the listing that dropped it loses the row', p.removals.map(r => `${r.external_id}/${r.media_id}`), ['novest-7/77'])
}
// 8. floors
{
  const mk = (n, nListings) => {
    const listings = [], images = [], feed = {}
    for (let i = 0; i < nListings; i++) {
      const e = `novest-f${i}`; listings.push(L(`P${i}`, e)); feed[e] = ['1']
      images.push(row(`P${i}`, e, '1', 0, true))
      for (let j = 0; j < n; j++) images.push(row(`P${i}`, e, String(100 + j), j + 1))
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
    images: [row('A', 'novest-9', '90', 0, true), row('A', 'novest-9', '91', 1)],
    feed: feedOf({ 'novest-9': ['90'] }), incomplete: new Set(['novest-9']) })
  t('mirror failed/pending for the listing: skipped', [p.removals.length, p.skipped.mirrorIncomplete], [0, ['novest-9']])
}

// ─── Workflow wiring: the schedule can never prune ───────────────────────────
{
  const wf = readFileSync(resolve(ROOT, '.github/workflows/novest-images.yml'), 'utf8')
  const line = wf.split('\n').find(l => l.includes('--prune') && !l.trim().startsWith('#')) ?? ''
  t('workflow passes --prune only for prune==true AND workflow_dispatch',
    /"\$IN_PRUNE" = "true"/.test(line) && /"\$GITHUB_EVENT_NAME" = "workflow_dispatch"/.test(line), true)
  const sched = wf.split('\n').filter(l => !l.trim().startsWith('#') && /schedule/.test(l) && /--prune/.test(l))
  t('no line pairs schedule with --prune', sched.length, 0)
}

console.log(bad ? `\n${bad} check(s) FAILED` : '\nall checks passed')
process.exit(bad ? 1 : 0)
