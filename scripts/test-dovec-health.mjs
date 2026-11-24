// check-dovec-health prints to PUBLIC GitHub Actions logs: no project name may reach any output line. Fake client, fake names.
//   node scripts/test-dovec-health.mjs
import { run } from './check-dovec-health.mjs'

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}

const NAMES = ['Zzyzx Harbour Residences', 'Qwertyland Marina Villas', 'Plugh Gardens', 'Xyzzy Palm Court']
const NOW = Date.parse('2026-11-24T12:00:00Z')
const coordsData = {
  unmatched: [{ seed: NAMES[0], reason: 'no_match' }, { seed: NAMES[1], reason: 'ambiguous' }],
  renamed: [{ seed: NAMES[2], name: NAMES[3] }],
  live_without_coords: [{ name: NAMES[1] }, { name: NAMES[3] }, { name: NAMES[0] }],
}
const settings = { published: false, suspended: false, last_good_sync_at: '2026-11-24T11:55:00Z', last_run_at: '2026-11-24T11:55:00Z', last_run_status: 'ok' }
const fakeSb = ({ coords = { data: coordsData, error: null }, row = settings } = {}) => ({
  from: (table) => {
    const q = { select: () => q, eq: () => q, in: () => q, lt: () => q, gte: () => q, limit: () => q,
      maybeSingle: async () => ({ data: row, error: null }),
      then: (res) => res({ data: [], error: null }) }
    return table === 'dovec_leads' ? q : q
  },
  rpc: async () => coords,
})
const capture = async (sb) => {
  const lines = []
  const code = await run({ sb, log: (...a) => lines.push(a.join(' ')), err: (...a) => lines.push(a.join(' ')), now: () => NOW })
  return { code, out: lines.join('\n') }
}

console.log('dovec health output: counts only, never a project name')
{
  const { code, out } = await capture(fakeSb())
  const leaked = NAMES.filter(n => out.includes(n) || out.toLowerCase().includes(n.split(' ')[0].toLowerCase()))
  t('no fake project name (full or first word) in anything printed', leaked, [])
  const m = out.match(/pins unmatched   : (\d+)\n  pins renamed     : (\d+)\n  live without pin : (\d+)/)
  t('positive control: the three counts are printed', m && m.slice(1).map(Number), [2, 1, 3])
  console.log(`    matched: ${JSON.stringify(m?.[0])}`)
  t('exit code unchanged (healthy feed, pins never red)', code, 0)
}
{
  const { out } = await capture(fakeSb({ coords: { data: null, error: { code: '42883' } } }))
  t('a missing function is printed as a code, not failed', /pins +: not readable \(42883\)/.test(out), true)
}
{
  const { code } = await capture(fakeSb({ row: { ...settings, suspended: true } }))
  t('suspended is still red (exit 1)', code, 1)
}
{
  const { code, out } = await capture(fakeSb({ row: { ...settings, last_run_at: null } }))
  t('never-run feed is not armed (exit 0)', [code, out.includes('not armed')], [0, true])
}

console.log(bad ? `\n${bad} FAILED` : '\nall passed')
process.exit(bad ? 1 : 0)
