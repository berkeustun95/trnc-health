// Home strip tap wiring (Yeme-İçme slice 3). Every action.type the strip can emit has a case in
// HomeScreen.handleStripPress; the Sponsorlu 'eatery' case reaches App.js, which opens the partner
// with the one-press-back flag; HomeScreen passes the real eateryGate. strip:sponsored stubs the
// resolver's inputs and check-back-chain sets state directly, so neither sees a dropped case or
// prop — this file is what does (each check seen red on a planted break, 2026-10-18).
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const root = process.argv[2] || fileURLToPath(new URL('..', import.meta.url))
const rd=f=>fs.readFileSync(root+'/'+f,'utf8')
const emitted=new Set([...(rd('utils/homeStripResolver.js')+rd('constants/eatery.js')).matchAll(/action:\s*\{\s*type:\s*'(\w+)'/g)].map(m=>m[1]))
const home=rd('screens/HomeScreen.js'), app=rd('App.js'); let bad=0
const ok=(n,c,raw)=>{console.log((c?'✓ ':'✗ ')+n+'  '+raw); if(!c)bad++}
console.log('emitted action types:',[...emitted])
if(emitted.size<4){console.log('✗ too few action types found — extraction broke'); process.exit(1)}
const sw=home.slice(home.indexOf('function handleStripPress'), home.indexOf('function handleStripPress')+4000)
for(const t of emitted) ok(`handleStripPress has case '${t}'`, new RegExp(`case '${t}':`).test(sw), t)
const m=app.match(/onOpenEateryPartner=\{([^\n]*)\}\n/)
ok('App.js passes onOpenEateryPartner', !!m, m?.[1]??'(absent)')
ok('  ...and it sets showEatery, openSlug AND eateryFromMap(true)', !!m && /setShowEatery\(true\)/.test(m[1]) && /setEateryOpenSlug\(slug\)/.test(m[1]) && /setEateryFromMap\(true\)/.test(m[1]), m?.[1]??'')
ok("HomeScreen 'eatery' case calls onOpenEateryPartner", /case 'eatery':[^\n]*onOpenEateryPartner\?\.\(a\.slug\)/.test(home), '')
ok('HomeScreen passes eateryGate: CRUNCHY_EXPRESS', /resolveStripItem\(\{[^}]*eateryGate: CRUNCHY_EXPRESS/.test(home), '')
process.exit(bad?1:0)
