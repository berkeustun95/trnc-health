// Android back chain (App.js) — 45 cases from the "back keeps your place" slices
// (2026-09-27), +1 on 2026-10-01 for an event opened from the redesign Home banner, +2 on 2026-10-02 for the check-in feed, +1 on 2026-10-07 for its add-place form. Extracts the handler body registered through addBackListener and runs it
// against a Proxy scope, asserting which close each state reaches. The same body is what
// the iOS edge swipe dispatches, so this covers both platforms' back.
//   npm run backchain:check            (reads App.js)
//   node scripts/check-back-chain.cjs <file>
const fs=require('fs'); const path=require('path')
const file=process.argv[2] || path.join(__dirname,'..','App.js')
const src=fs.readFileSync(file,'utf8')
// The anchor must be found, or the brace scan below would parse an arbitrary block and
// report on it — a test that runs green on the wrong code.
const ANCHOR="const sub = addBackListener(() => {"
const start=src.indexOf(ANCHOR)
if(start===-1){ console.error(`back chain: anchor not found in ${file}: ${ANCHOR}`); process.exit(1) }
let i=start+ANCHOR.length-1, d=0, j=i
for(;j<src.length;j++){ if(src[j]==='{')d++; else if(src[j]==='}'){d--; if(!d)break} }
const body=src.slice(i+1,j)
// Positive control: the slice is the chain — first line the force tier, last the root exit.
if(!body.includes("updateTier === 'force'") || !/return false\s*$/.test(body)){
  console.error('back chain: extracted body is not the back chain\n'+body.slice(0,200)); process.exit(1)
}
const fn=new Function('ctx',`with(ctx){ ${body} }`)
function run(state, home=null, prof=null, refs={}){
  const calls=[]
  const ctx=new Proxy({}, {has:()=>true, get:(_,k)=>{
    if(k===Symbol.unscopables) return undefined
    if(k in state) return state[k]
    if(k in refs) return {current: refs[k]}
    if(k==='homeBackRef') return {current: home}
    if(k==='profileGuardRef') return {current: prof}
    if(k==='oliCloseRef') return {current: ()=>calls.push('oliClose')}
    if(k==='sessionRef') return {current: {user:{id:'u'}}}
    if(typeof k==='string' && (/^(set|close|petsSubBack)/.test(k))) return (...a)=>calls.push(k+'('+a.map(x=>JSON.stringify(x)).join(',')+')')
    if(k==='closePetHotel') return ()=>calls.push('closePetHotel')
    if(typeof k==='string' && k.endsWith('Ref')) return {current:null}
    return undefined }})
  const r=fn(ctx); return {r, calls:calls.join(' ')}
}
const base={updateTier:null, activeTab:'home', showWelcome:false}
const cases4=[
 ['Place open, check-in page up -> closes check-in only', {...base, showExplore:true, selectedExplorePlace:{id:1}}, {placeBackRef:()=>true}, r=>r.calls===''],
 ['Place open -> closes place, NOT the module', {...base, showExplore:true, selectedExplorePlace:{id:1}}, {placeBackRef:()=>false, exploreBackRef:()=>{throw new Error('module asked')}}, r=>r.calls==='setSelectedExplorePlace(null)'],
 ['Explore layer (saved/submit/group) -> module step, no close', {...base, showExplore:true}, {exploreBackRef:()=>true}, r=>r.calls===''],
 ['Explore top level -> closes module', {...base, showExplore:true}, {exploreBackRef:()=>false}, r=>r.calls==='setShowExplore(false)'],
 ['Check-in feed (Keşfet) -> closes the feed', {...base, activeTab:'map', showCheckinFeed:true}, {}, r=>r.calls==='setShowCheckinFeed(false)'],
 ['Check-in feed + add-place form -> closes the form, NOT the feed', {...base, activeTab:'map', showCheckinFeed:true}, {checkinFeedBackRef:()=>true}, r=>r.r===true && r.calls===''],
 ['Check-in feed + place open -> closes the place, NOT the feed', {...base, activeTab:'map', showCheckinFeed:true, selectedExplorePlace:{id:1}}, {placeBackRef:()=>false}, r=>r.calls==='setSelectedExplorePlace(null)'],
 ['Renovation layer (partner/category) -> module step, no close', {...base, showHomeServices:true}, {homeServicesBackRef:()=>true}, r=>r.calls===''],
 ['Renovation top -> closes module', {...base, showHomeServices:true}, {homeServicesBackRef:()=>false}, r=>r.calls==='setShowHomeServices(false)'],
 ['Student Hub layer (conv/profile/uni) -> hub step, no close', {...base, showStudentHub:true}, {studentHubBackRef:()=>true}, r=>r.calls===''],
 ['Student Hub top -> closes hub', {...base, showStudentHub:true}, {studentHubBackRef:()=>false}, r=>r.calls==='setShowStudentHub(false)'],
 ['eSIM over hub -> closes eSIM, not hub', {...base, showStudentHub:true, showEsim:true}, {studentHubBackRef:()=>{throw new Error('hub asked')}}, r=>r.calls.startsWith('setShowEsim(false)')],
 ['SCROLL SPOT Renovation category -> landing (module step, not close)', {...base, showHomeServices:true}, {homeServicesBackRef:()=>true}, r=>r.calls===''],
 ['SCROLL SPOT Explore Submit/Saved/MySubs -> back into Explore', {...base, showExplore:true}, {exploreBackRef:()=>true}, r=>r.calls===''],
 ['SCROLL SPOT Explore check-in -> back to the place', {...base, showExplore:true, selectedExplorePlace:{id:1}}, {placeBackRef:()=>true}, r=>r.calls===''],
 ['SCROLL SPOT Pets vet directory -> back to Owning (origin)', {...base, showPets:true, petsSubScreen:'vetdirectory'}, {}, r=>r.calls==='petsSubBack()'],
 ['SCROLL SPOT Pets hotel -> back to origin page', {...base, showPets:true, petsSubScreen:'pethotel'}, {}, r=>r.calls==='closePetHotel()'],
 ['SCROLL SPOT Hub <- Welcome Guide (guide closes, hub stays)', {...base, showStudentHub:true, showNewcomerEssentials:true}, {studentHubBackRef:()=>{throw new Error('hub asked')}}, r=>r.calls==='setShowNewcomerEssentials(false)'],
 ['S8 Guide card open -> closes card, not guide', {...base, showNewcomerEssentials:true}, {guideBackRef:()=>true}, r=>r.calls===''],
 ['S8 Rates over guide -> closes rates, guide stays', {...base, showNewcomerEssentials:true, showExchangeRates:true}, {guideBackRef:()=>{throw new Error('guide asked')}}, r=>r.calls==='setShowExchangeRates(false)'],
 ['S10 Duty over notifications -> closes duty, notifs stay', {...base, showNotifs:true, showDutyList:true}, {}, r=>r.calls==='closeDutyList()'],
 ['S10 Facility reviews -> closes reviews, not profile', {...base, selectedFacility:{id:1}}, {facilityBackRef:()=>true}, r=>r.calls===''],
 ['S10 Facility over Garages -> closes facility, garages stay', {...base, showGarages:true, selectedFacility:{id:1}}, {facilityBackRef:()=>false, garagesBackRef:()=>{throw new Error('garages asked')}}, r=>r.calls==='setSelectedFacility(null)'],
 ['S10 Towing over Garages -> closes towing, garages stay', {...base, showGarages:true, showTowing:true}, {garagesBackRef:()=>{throw new Error('garages asked')}}, r=>r.calls==='setShowTowing(false)'],
 ['S10 Garages Compare -> module step', {...base, showGarages:true}, {garagesBackRef:()=>true}, r=>r.calls===''],
 ['S10 Jobs detail/category -> module step', {...base, showJobPostings:true}, {jobsBackRef:()=>true}, r=>r.calls===''],
 ['S10 Jobs top -> closes', {...base, showJobPostings:true}, {jobsBackRef:()=>false}, r=>r.calls==='setShowJobPostings(false)'],
 ['S10 Transport layer -> module step', {...base, showTransport:true}, {transportBackRef:()=>true}, r=>r.calls===''],
 ['S10 Insurance layer -> module step', {...base, showInsurance:true}, {insuranceBackRef:()=>true}, r=>r.calls===''],
 ['S10 Grooming onboarding -> module step', {...base, showGrooming:true}, {groomingBackRef:()=>true}, r=>r.calls===''],
 ['S10 Towing detail over Garages -> closes detail only', {...base, showGarages:true, showTowing:true}, {towingBackRef:()=>true, garagesBackRef:()=>{throw new Error('garages asked')}}, r=>r.calls===''],
 ['S10 Towing detail standalone -> closes detail only', {...base, showTowing:true}, {towingBackRef:()=>true}, r=>r.calls===''],
 ['Beaches layer -> module step', {...base, showExploreBeach:true}, {exploreBackRef:()=>true}, r=>r.calls===''],
]
const cases=[
 ['Pets vet overlay open -> closes facility only', {...base, showPets:true, petsSubScreen:'vetdirectory', selectedFacility:{id:1}}, null,null, r=>r.calls==='setSelectedFacility(null)'],
 ['Pets sub page -> petsSubBack (to origin)', {...base, showPets:true, petsSubScreen:'vetdirectory'}, null,null, r=>r.calls==='petsSubBack()'],
 ['Home, search open', {...base}, ()=>{return true}, null, r=>r.r===true],
 ['Home, directory open', {...base}, ()=>true, null, r=>r.r===true],
 ['Home, nothing open -> exit (root)', {...base}, ()=>false, null, r=>r.r===false],
 ['Profile, legal/dirty handled by guard', {...base, activeTab:'profile'}, null, {back:()=>true}, r=>r.r===true && !r.calls.includes('setActiveTab')],
 ['Profile, clean -> Home tab', {...base, activeTab:'profile'}, null, {back:()=>false}, r=>r.calls.includes("setActiveTab(\"home\")")],
 ['Pets vet profile -> closes profile first', {...base, showPets:true, petsSubScreen:'vetdirectory', selectedFacility:{id:1}}, null,null, r=>r.calls==='setSelectedFacility(null)'],
 ['Events -> closeEvents (clears district)', {...base, showEvents:true}, null,null, r=>r.calls==='closeEvents()'],
 ['Events detail open -> closes ONLY the detail', {...base, showEvents:true, openedEvent:{id:1}}, null,null, r=>r.calls==='setOpenedEvent(null)'],
 ['Events detail closed -> closes module', {...base, showEvents:true, openedEvent:null}, null,null, r=>r.calls==='closeEvents()'],
 ['Event opened from the Home banner -> back to Home, not the list', {...base, showEvents:true, openedEvent:{id:1}, eventFromHome:true}, null,null, r=>r.calls==='closeEvents()'],
 ['Duty -> closeDutyList (clears region)', {...base, showDutyList:true}, null,null, r=>r.calls==='closeDutyList()'],
 ['Notifs -> closeNotifs (marks read)', {...base, showNotifs:true}, null,null, r=>r.calls==='closeNotifs()'],
 ['Beach -> closeExploreBeach', {...base, showExploreBeach:true}, null,null, r=>r.calls==='closeExploreBeach()'],
 ['Module open while home hook would fire: module wins', {...base, showEvents:true}, ()=>{throw new Error('home hook called')}, null, r=>r.calls==='closeEvents()'],
]
let bad=0
for (const [n,st,refs,ok] of cases4){ let r; try{ r=run(st,null,null,refs) }catch(e){ r={r:'THREW '+e.message,calls:''} } const pass=ok(r); if(!pass)bad++; console.log((pass?'PASS ':'FAIL ')+n+'  -> '+r.r+' | '+r.calls) }
for (const [n,st,h,p,ok] of cases){ let r; try{ r=run(st,h,p) }catch(e){ r={r:'THREW '+e.message,calls:''} } const pass=ok(r); if(!pass)bad++; console.log((pass?'PASS ':'FAIL ')+n+'  -> '+r.r+' | '+r.calls) }
console.log(bad?`back chain: ${bad} of ${cases4.length+cases.length} FAILED`:`back chain: OK (${cases4.length+cases.length}/${cases4.length+cases.length})`)
if(bad) process.exit(1)
