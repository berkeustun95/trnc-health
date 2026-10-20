// Home strip tap wiring (Yeme-İçme slice 3). Every action.type the strip can emit has a case in
// HomeScreen.handleStripPress; the Sponsorlu 'eatery' case reaches App.js, which opens the partner
// with the one-press-back flag; HomeScreen builds the slider from resolveStripSlides with EATERY_GATES, and only the lead records
// rememberStripKind. strip:slides tests the pure assembly
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
ok('HomeScreen assembles the slider with resolveStripSlides', /resolveStripSlides\(\{/.test(home), '')
ok('  ...passing gates: EATERY_GATES', /resolveStripSlides\(\{[^}]*gates: EATERY_GATES/.test(home), '')
ok('  ...fetches partners whenever EATERY (editorial slides, 2026-10-20), NOT behind promosEligible', /if \(EATERY === true\) \{[\s\S]{0,160}loadEateryPartners\(/.test(home) && !/EATERY === true && promosEligible[\s\S]{0,160}loadEateryPartners\(/.test(home), '')
ok('  ...selecting adult_only (otherwise every partner fails closed to the 18+ gate)', /loadEateryPartners\('[^']*\badult_only\b[^']*'\)/.test(home), '')
ok('  ...and still passes promosEligible to resolveStripSlides (paid promos + adult partners)', /resolveStripSlides\(\{[^}]*promosEligible/.test(home), '')
ok('partner slides carry no Sponsorlu flag; the DB promo keeps it', !/sponsored:\s*true/.test(rd('utils/stripSlides.js')) && /sponsored/.test(rd('utils/homeStripResolver.js')), '')
ok('the band row renders for the ÖRNEK / ÖNİZLEME tags even without a Sponsorlu tag', /\(!!time \|\| !!tag \|\| !!item\.placeholder \|\| !!item\.unpublished\)/.test(rd('components/home/redesign/Widgets.js')), '')
ok('HomeScreen renders StripSlider', /<StripSlider\b/.test(home), '')
ok('the old single-card eateryGate is gone', !/eateryGate/.test(home) && !/eateryGate/.test(rd('utils/homeStripResolver.js')), '')
{ const h = rd('screens/HomeScreen.js'), m = h.match(/const stripPaused = ([^\n]*)/)
  ok('App-level sheets pause the slider (overlayOpen reaches stripPaused)', !!m && /overlayOpen/.test(m[1]) && /overlayOpen=\{[^}]*oliSheetOpen/.test(rd('App.js')), m?.[1] ?? '(stripPaused absent)') }
ok('only the lead records its kind, never a partner slide (remember={index === 0 && !item.eaterySlug})', /remember=\{index === 0 && !item\.eaterySlug\}/.test(rd('components/home/redesign/Widgets.js')), '')
process.exit(bad?1:0)
