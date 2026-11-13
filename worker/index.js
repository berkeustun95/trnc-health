// getadaapp.com/o/<code> — WhatsApp order verification page, plus the order status (customer timeline, restaurant buttons).
// GET/HEAD never call the RPC (link previews must not count as views); a visible browser's inline script POSTs /o/<code>/check.
// Restaurant side (20261194): POST /pin enrols this phone (device token in an HttpOnly cookie only), POST /status changes
// the status, POST /forget clears the cookie, POST /token renews the action token. The Worker key (env.ADA_WORKER_KEY) is
// sent to Supabase from here only, never taken from a client header; unset = customer-only page, every write refused.
// Every other request is handed to the static-assets binding untouched (privacy/support/delete-account).

const CODE_RE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/
const TZ = 'Europe/Nicosia'

const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}
const csp = nonce => `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
const CSP_NO_SCRIPT = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

// Link-preview renderers and crawlers: never allowed to trigger the RPC.
// Pure crawlers / preview fetchers only. Never add a pattern an in-app browser (Viber, Line, Snapchat, Pinterest...) sends: a real restaurant opening the link must verify.
const BOT_UA = /whatsapp|facebookexternalhit|facebot|telegrambot|twitterbot|slackbot|discordbot|linkedinbot|skypeuripreview|googlebot|bingbot|applebot|redditbot|embedly|iframely|vkshare|zoominfobot/i

const newNonce = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))

export function esc(v) {
  return String(v ?? '').replace(/[&<>"'`]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]))
}

export function normalizeCode(raw) {
  let s
  try { s = decodeURIComponent(raw) } catch { return null }
  s = s.replace(/-/g, '').toUpperCase()
  return CODE_RE.test(s) ? s : null
}

const fmtTime = iso => {
  const d = new Date(iso)
  if (isNaN(d)) return ''
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map(x => [x.type, x.value]))
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`
}

const fmtMoney = (n, cur) => {
  const v = Number(n)
  if (!isFinite(v)) return ''
  const [i, f] = v.toFixed(2).split('.')
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${grouped},${f} ${cur === 'TRY' || !cur ? 'TL' : cur}`
}

const CSS = `*{box-sizing:border-box}body{margin:0;background:#F4F6F5;color:#1A2B33;font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.w{max-width:480px;margin:0 auto;padding:20px 16px 32px}.logo{font-weight:800;letter-spacing:.12em;color:#0E7C7B;font-size:20px;margin:4px 0 16px}
.card{background:#fff;border-radius:16px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.banner{border-radius:12px;padding:16px;margin-bottom:16px;background:#E6F4F4;color:#0A5E5D}.banner b{display:block;font-size:20px;line-height:1.25}
.banner.bad{background:#FBE9EC;color:#C0384A}.en{font-size:13px;color:#55657A;margin-top:2px}.banner .en{color:inherit;opacity:.8}
h2{margin:0 0 2px;font-size:20px}.meta{color:#55657A;font-size:14px;margin:2px 0}
ul{list-style:none;margin:16px 0 0;padding:0;border-top:1px solid #E3E8E6}li{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid #E3E8E6}
li span:last-child{white-space:nowrap;color:#55657A}.total{display:flex;justify-content:space-between;font-weight:700;font-size:18px;margin-top:12px;color:#0A5E5D}
li span.d{display:block;white-space:normal;color:#55657A;font-size:13px;margin-top:2px}.grey{opacity:.55}.seen{margin-top:14px;font-size:14px;color:#55657A}.note{margin:16px 4px 0;font-size:13px;color:#55657A}
.a{color:#0E7C7B;font-weight:700}.big{font-size:28px;font-weight:800;letter-spacing:.06em;color:#0A5E5D;margin:8px 0}.foot{margin-top:24px;text-align:center;font-size:12px}.foot a{color:#55657A}
.sec{background:#fff;border-radius:16px;padding:16px 20px;margin-top:12px;box-shadow:0 1px 3px rgba(0,0,0,.08)}.sh{font-weight:700;font-size:16px;margin:0 0 8px}
.step{display:flex;gap:12px;align-items:flex-start;padding:6px 0;color:#8A97A8}.step.done{color:#1A2B33}.step.cur{font-weight:700}.step .en{font-weight:400}
.dot{flex-shrink:0;width:12px;height:12px;border-radius:6px;border:2px solid #C5CFCB;background-color:transparent;margin-top:5px}.done .dot{background:#0E7C7B;border-color:#0E7C7B}
.tm{font-weight:400;color:#55657A;font-size:14px}.cx{border-radius:12px;padding:12px 14px;background:#FBE9EC;color:#C0384A}.cx .en{color:inherit;opacity:.8}
.warn{border-radius:12px;padding:12px 14px;margin-bottom:10px;background:#FFF4DC;color:#7A5200;font-weight:700}.warn .en{color:inherit;opacity:.85;font-weight:400}
.btn{display:block;width:100%;min-height:48px;margin:8px 0 0;padding:10px 14px;border:0;border-radius:12px;background:#0E7C7B;color:#fff;font:inherit;font-weight:700;text-align:left;cursor:pointer}
.btn .en{color:inherit;opacity:.85;font-weight:400}.btn:disabled{opacity:.45}.btn.bad{background:#C0384A}
.btn.opt,.btn.ghost{background-color:transparent;color:#1A2B33;border:1.5px solid #C5CFCB}.btn.opt.on{border-color:#C0384A;color:#C0384A}
.lnk{display:inline-block;margin-top:12px;padding:6px 0;border:0;background:none;color:#0E7C7B;font:inherit;font-size:14px;font-weight:700;text-decoration:underline;cursor:pointer}
.pin{display:block;width:100%;margin-top:10px;padding:12px 14px;border:1.5px solid #C5CFCB;border-radius:12px;background-color:transparent;font:inherit;font-size:24px;letter-spacing:.3em;text-align:center}
.msg{margin-top:10px;font-size:14px;color:#C0384A}.msg:empty{display:none}`

function page(body, title, extraHead = '', script = '', nonce = '') {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title>${extraHead}<style>${CSS}</style></head>
<body><div class="w"><div class="logo">ADA</div>${body}
<p class="note">Fiyatlar ADA menüsündendir. Not satırı doğrulanmaz.<br><span class="en">Prices are from the ADA menu. The note line is not verified.</span></p>
<div class="foot"><a href="https://getadaapp.com/privacy">getadaapp.com/privacy</a></div></div>${script ? `<script nonce="${nonce}">${script}</script>` : ''}</body></html>`
}

function respond(html, status, csp = CSP_NO_SCRIPT, body = html) {
  return new Response(body, { status, headers: { ...HEADERS, 'Content-Security-Policy': csp } })
}

// Status words. TR primary, EN sub-line. Shared by the server page and the inline script (embedded as JSON).
const ST = {
  sent: ['Gönderildi', 'Sent'],
  received: ['Siparişi aldık', 'Order received'],
  preparing: ['Hazırlanıyor', 'Being prepared'],
  on_the_way: ['Yolda', 'On the way'],
  ready: ['Hazır, gelip alabilirsiniz', 'Ready, you can pick it up'],
  either: ['Yolda / Hazır, gelip alabilirsiniz', 'On the way / Ready for pickup'],
  cancelled: ['İptal edildi', 'Cancelled'],
}
const REASONS = {
  closed: ['Şu an kapalıyız', 'We are closed right now'],
  busy: ['Çok yoğunuz', 'We are too busy right now'],
  item_out: ['Ürün kalmadı', 'An item is sold out'],
  no_delivery_there: ['Bu adrese teslimat yok', 'No delivery to this address'],
  unreachable: ['Müşteriye ulaşılamadı', 'Could not reach the customer'],
  other: ['Diğer', 'Other'],
}
const ACT = { received: ['Siparişi aldık', 'Order received'], preparing: ['Hazırlanıyor', 'Preparing'], on_the_way: ['Yolda', 'On the way'], ready: ['Hazır', 'Ready'] }
const PIN_ERR = {
  wrong_pin: ['PIN yanlış', 'Wrong PIN'],
  locked: ['Çok fazla hatalı deneme. Bir süre sonra tekrar deneyin.', 'Too many wrong attempts. Please try again later.'],
  closed: ['Bu sipariş 12 saatten eski, durum artık değiştirilemez.', 'This order is over 12 hours old; its status can no longer be changed.'],
  no_pin: ['Bu restoran için PIN tanımlı değil. ADA ile iletişime geçin.', 'No PIN is set for this restaurant. Please contact ADA.'],
  disabled: ['Sipariş durumu bu restoran için açık değil.', 'Order status is not switched on for this restaurant.'],
  device_limit: ['Bu restoranda en fazla 5 cihaz kayıtlı olabilir. ADA ile iletişime geçin.', 'At most 5 devices per restaurant. Please contact ADA.'],
  rate_limited: ['Çok fazla deneme. Bir dakika sonra tekrar deneyin.', 'Too many attempts. Please try again in a minute.'],
  format: ['6 haneli PIN girin', 'Enter the 6-digit PIN'],
  error: ['Şu an giriş yapılamadı, tekrar deneyin.', 'Could not sign in right now, please try again.'],
}
const SET_ERR = {
  frozen: ['Durum artık değiştirilemez', 'The status can no longer be changed'],
  invalid_transition: ['Durum bu arada değişmiş. Sayfayı yenileyin.', 'The status changed in the meantime. Please reload the page.'],
  forbidden: ['Bu cihaz artık yetkili değil. PIN ile yeniden giriş yapın.', 'This device is no longer authorised. Sign in again with the PIN.'],
  disabled: ['Sipariş durumu bu restoran için kapalı.', 'Order status is switched off for this restaurant.'],
  error: ['Şu an kaydedilemedi, tekrar deneyin.', 'Could not save right now, please try again.'],
}
const RANK = { sent: 0, received: 1, preparing: 2, on_the_way: 3, ready: 3 }
const finalStep = v => v.fulfilment === 'delivery' ? 'on_the_way' : v.fulfilment === 'pickup' ? 'ready'
  : (v.orderStatus === 'on_the_way' || v.orderStatus === 'ready') ? v.orderStatus : 'either'

// Runs only in a VISIBLE tab (link-preview renderers are never visible). DOM is built with textContent only.
// Restaurant buttons appear only when /check says manage (Worker key + an enrolled device cookie); a customer never gets them.
const CLIENT_JS = `(function(){
var ST=${JSON.stringify(ST)},RS=${JSON.stringify(REASONS)},ACT=${JSON.stringify(ACT)},PE=${JSON.stringify(PIN_ERR)},SE=${JSON.stringify(SET_ERR)},RK=${JSON.stringify(RANK)};
var box=document.getElementById('r'),done=false,tok=null,cur=null,seen=null,base=location.pathname.replace(/\\/$/,'');
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function two(t,c,p){var d=el(t,c);d.appendChild(el(t==='button'?'span':'b',null,p[0]));d.appendChild(el('div','en',p[1]));return d}
function banner(tr,en,bad){var d=el('div','banner'+(bad?' bad':''));d.appendChild(el('b',null,tr));d.appendChild(el('div','en',en));return d}
function say(m,p){m.textContent='';if(p){m.appendChild(el('div',null,p[0]));m.appendChild(el('div','en',p[1]))}}
function put(){box.textContent='';for(var j=0;j<arguments.length;j++)if(arguments[j])box.appendChild(arguments[j])}
function fail(){var b=banner('Şu an doğrulanamadı, biraz sonra tekrar dene','Could not verify right now, please try again shortly',true);var a=el('a','a','Tekrar dene');a.href='?view=1';var p=el('p','note');p.appendChild(a);put(b,p)}
function post(p,b,again){b.token=tok;
return fetch(base+'/'+p,{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)})
.then(function(r){return r.json()}).then(function(r){if(r&&r.token)tok=r.token;
if(r&&r.status==='retry'&&!again)return fetch(base+'/token',{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'}).then(function(x){return x.json()}).then(function(x){if(!x||!x.token)return r;tok=x.token;return post(p,b,true)});
return r})}
function fin(j){return j.fulfilment==='delivery'?'on_the_way':j.fulfilment==='pickup'?'ready':(j.orderStatus==='on_the_way'||j.orderStatus==='ready')?j.orderStatus:'either'}
function timeline(j){var s=el('div','sec');s.appendChild(two('div','sh',[j.isTest===true?'Sipariş durumu · TEST':'Sipariş durumu',j.isTest===true?'Order status · TEST':'Order status']));
if(j.orderStatus==='cancelled'){var cx=el('div','cx');cx.appendChild(el('b',null,ST.cancelled[0]+(j.statusAt?' · '+j.statusAt:'')));var rs=RS[j.cancelReason];
cx.appendChild(el('div',null,rs?rs[0]:''));cx.appendChild(el('div','en',ST.cancelled[1]+(rs?' — '+rs[1]:'')));s.appendChild(cx);return s}
var seq=['sent','received','preparing',fin(j)],rk=RK[j.orderStatus]||0;
for(var i=0;i<seq.length;i++){var st=el('div','step'+(i<=rk?' done':'')+(i===rk?' cur':''));st.appendChild(el('span','dot'));var tx=el('div');var w=el('span',null,ST[seq[i]][0]);tx.appendChild(w);
if(i===rk){var t=j.statusAt||j.time;if(t)tx.appendChild(el('span','tm',' · '+t))}tx.appendChild(el('div','en',ST[seq[i]][1]));st.appendChild(tx);s.appendChild(st)}
return s}
function btn(p,c){var b=two('button','btn'+(c?' '+c:''),p);b.type='button';return b}
function lock(p){var b=p.getElementsByTagName?p.getElementsByTagName('button'):[];for(var i=0;i<b.length;i++)b[i].disabled=true}
function setStatus(p,m,s,reason){lock(p);post('status',{status:s,reason:reason}).then(function(r){
if(r&&r.status==='ok'){if(r.changed===false)return load();cur.orderStatus=r.orderStatus;cur.statusAt=r.statusAt;cur.cancelReason=r.orderStatus==='cancelled'?reason:null;cur.statusShown=true;cur.old2h=false;cur.next=r.next||[];show(cur);return}
var k=r&&r.status;if(k==='frozen'){cur.frozen=true;cur.next=[]}if(k==='forbidden'){cur.pinable=cur.next.length>0;cur.manage=false;cur.next=[]}show(cur,SE[k]||SE.error)}).catch(function(){show(cur,SE.error)})}
function chooser(p,m){var c=el('div');c.appendChild(two('div','sh',['İptal nedeni','Reason for cancelling']));var pick=null,opts=[];
var cf=btn(['Siparişi iptal et','Cancel the order — this cannot be undone'],'bad');cf.disabled=true;
Object.keys(RS).forEach(function(k){var o=btn(RS[k],'opt');o.onclick=function(){pick=k;for(var i=0;i<opts.length;i++)opts[i].className='btn opt'+(opts[i]===o?' on':'');cf.disabled=false};opts.push(o);c.appendChild(o)});
cf.onclick=function(){if(pick)setStatus(p,m,'cancelled',pick)};c.appendChild(cf);var no=btn(['Vazgeç','Back'],'ghost');no.onclick=function(){show(cur)};c.appendChild(no);return c}
function rest(j,msg){var p=el('div','sec');p.appendChild(two('div','sh',['Restoran',j.isTest===true?'Restaurant · TEST':'Restaurant']));var m=el('div','msg');var nx=j.next||[];
if(j.frozen)p.appendChild(two('div','warn',['Durum artık değiştirilemez','The status can no longer be changed']));
else{if(j.old2h)p.appendChild(two('div','warn',['2 saatten eski sipariş — müşteriyle teyit edin','Order is over 2 hours old — confirm with the customer']));
for(var i=0;i<nx.length;i++)if(ACT[nx[i]])(function(s){var b=btn(ACT[s]);b.onclick=function(){setStatus(p,m,s,null)};p.appendChild(b)})(nx[i]);
if(nx.indexOf('cancelled')>=0){var cb=btn(['İptal et','Cancel'],'ghost');cb.onclick=function(){p.textContent='';p.appendChild(chooser(p,m));p.appendChild(m)};p.appendChild(cb)}}
p.appendChild(m);say(m,msg);
var f=el('button','lnk','Bu cihazı unut · Forget this device');f.type='button';f.onclick=function(){lock(p);post('forget',{}).then(function(r){if(r&&r.status==='ok'){cur.pinable=!cur.frozen&&cur.next.length>0;cur.manage=false;cur.next=[];show(cur)}else show(cur,SE.error)}).catch(function(){show(cur,SE.error)})};p.appendChild(f);return p}
function pinPanel(){var p=el('div','sec');p.appendChild(two('div','sh',['Restoran girişi','Restaurant sign-in']));
var i=el('input','pin');i.type='text';i.inputMode='numeric';i.autocomplete='one-time-code';i.maxLength=6;i.placeholder='••••••';i.setAttribute&&i.setAttribute('aria-label','PIN');p.appendChild(i);
var m=el('div','msg');var b=btn(['Giriş yap','Sign in']);p.appendChild(b);p.appendChild(m);
b.onclick=function(){var v=String(i.value||'').trim();if(!/^[0-9]{6}$/.test(v)){say(m,PE.format);return}b.disabled=true;say(m,null);
post('pin',{pin:v}).then(function(r){i.value='';if(r&&r.status==='ok')return load();b.disabled=false;say(m,PE[r&&r.status]||PE.error)}).catch(function(){i.value='';b.disabled=false;say(m,PE.error)})};
return p}
function show(j,msg){
if(j.status==='bot'){var a0=el('a','a','Sonucu göster');a0.href='?view=1';var p0=el('p','note');p0.appendChild(a0);box.appendChild(p0);return}
if(j.status==='not_found'){put(banner("ADA'da böyle bir sipariş yok",'No such order in ADA',true));return}
if(j.status!=='ok'&&j.status!=='expired')return fail();
var ex=j.status==='expired';
var b=j.isTest===true?banner('TEST SİPARİŞİ — hazırlamayın','TEST ORDER — do not prepare',true):ex?banner('Süresi dolmuş','Expired',true):banner('✓ Bu sipariş ADA üzerinden geldi','This order came through ADA',false);
var c=el('div','card'+((ex||j.isTest===true)?' grey':''));
c.appendChild(el('h2',null,j.partner));
var m=el('div','meta','Sipariş no: ');m.appendChild(el('b',null,j.orderNo));c.appendChild(m);
c.appendChild(el('div','meta',j.time));
var ul=el('ul');
for(var i=0;i<j.lines.length;i++){var li=el('li');var ls=el('span',null,j.lines[i].l);if(j.lines[i].d)ls.appendChild(el('span','d',j.lines[i].d));li.appendChild(ls);li.appendChild(el('span',null,j.lines[i].r));ul.appendChild(li)}
c.appendChild(ul);
var t=el('div','total');t.appendChild(el('span',null,'Toplam'));t.appendChild(el('span',null,j.total));c.appendChild(t);
var s=el('div','seen',j.seenTr);s.appendChild(el('div','en',j.seenEn));c.appendChild(s);
var tl=j.statusShown===true?timeline(j):null,x=null;
if(j.manage===true)x=rest(j,msg);
else if(j.pinable===true&&tok){x=el('button','lnk','Restoran mısınız? PIN ile giriş');x.type='button';x.onclick=function(){put(b,c,tl,pinPanel())}}
put(b,c,tl,x)}
function load(){return fetch(base+'/check',{method:'POST',cache:'no-store',credentials:'same-origin'})
.then(function(r){return r.json()}).then(function(j){if(j&&j.token)tok=j.token;if(j&&j.seenTr!=null){if(seen){j.seenTr=seen[0];j.seenEn=seen[1]}else seen=[j.seenTr,j.seenEn]}cur=j;show(j)}).catch(fail)}
function run(){if(done)return;done=true;load()}
function go(){setTimeout(run,400)}
function start(){if(document.visibilityState==='visible')go();else document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible')go()})}
if(document.readyState==='complete')start();else window.addEventListener('load',start)
})()`

const JSON_CSP = "default-src 'none'; frame-ancestors 'none'"
// Every /o/* response that is not a page goes through here so no variant misses the privacy headers.
const plainResponse = (body, status, extra = {}) => new Response(body, { status, headers: {
  'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': JSON_CSP, ...extra } })

const sameOrigin = (request, url) => {
  const site = request.headers.get('sec-fetch-site')
  if (site) return site === 'same-origin'
  const origin = request.headers.get('origin')
  return !!origin && origin === url.origin
}

const jsonSafe = o => JSON.stringify(o).replace(/[<>&\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
function respondJson(o, status, extra = {}) {
  return new Response(jsonSafe(o), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': JSON_CSP, ...extra,
  } })
}

// ─── Restaurant device + CSRF ────────────────────────────────────────────────
// The device token (20261194: three uuids, dashes removed) lives ONLY in this HttpOnly cookie and POST bodies to Supabase.
const COOKIE = '__Secure-ada_rd'
const DEVICE_RE = /^[0-9a-f]{96}$/
const deviceCookie = t => `${COOKIE}=${t}; HttpOnly; Secure; SameSite=Strict; Path=/o/; Max-Age=15552000`
const CLEAR_COOKIE = `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/o/; Max-Age=0`
const STATUSES = ['sent', 'received', 'preparing', 'on_the_way', 'ready', 'cancelled']
const H2 = 2 * 3600 * 1000, H12 = 12 * 3600 * 1000, BUCKET_MS = 10 * 60 * 1000

const hasKey = env => typeof env.ADA_WORKER_KEY === 'string' && env.ADA_WORKER_KEY.length >= 32

function readDevice(request) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === COOKIE) {
      const v = part.slice(i + 1).trim()
      return DEVICE_RE.test(v) ? v : null
    }
  }
  return null
}

const enc = new TextEncoder()
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')

// Stateless action token: HMAC-SHA256(ADA_WORKER_KEY) over code + sha256(device) or 'anon' + 10-minute bucket.
async function actionToken(env, code, device, bucket) {
  const k = await crypto.subtle.importKey('raw', enc.encode(env.ADA_WORKER_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const dev = device ? hex(await crypto.subtle.digest('SHA-256', enc.encode(device))) : 'anon'
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(`ada-order-action|${code}|${dev}|${bucket}`)))
}
const newActionToken = (env, code, device) => actionToken(env, code, device, Math.floor(Date.now() / BUCKET_MS))
const sameHex = (a, b) => {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}
// Current or previous bucket: a token lives 10 to 20 minutes; the page renews it via /token on 'retry'.
async function actionTokenOk(env, code, device, t) {
  if (typeof t !== 'string' || !/^[0-9a-f]{64}$/.test(t)) return false
  const b = Math.floor(Date.now() / BUCKET_MS)
  const [now, prev] = [await actionToken(env, code, device, b), await actionToken(env, code, device, b - 1)]
  return sameHex(now, t) | sameHex(prev, t) ? true : false
}

const isJson = request => (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() === 'application/json'

// GET/HEAD: order number only, no RPC, no partner or items — a link preview never counts as a view.
function renderLoading(code, head) {
  const fmt = `${code.slice(0, 4)}-${code.slice(4)}`
  const nonce = newNonce()
  const body = `<div id="r"><div class="card"><h2>ADA sipariş doğrulama</h2><div class="en">ADA order verification</div>
<div class="big">${esc(fmt)}</div><div class="meta">Doğrulanıyor…<div class="en">Verifying…</div></div>
<noscript><p><a class="a" href="/o/${esc(code)}?view=1">Sonucu göster</a><span class="en"> Show result</span></p></noscript></div></div>`
  const html = page(body, 'ADA', `<noscript><meta http-equiv="refresh" content="1;url=/o/${esc(code)}?view=1"></noscript>`, CLIENT_JS, nonce)
  return respond(html, 200, csp(nonce), head ? null : html)
}

function renderNotFound() {
  return respond(page(`<div class="banner bad"><b>ADA'da böyle bir sipariş yok</b><div class="en">No such order in ADA</div></div>`, 'ADA'), 404)
}

function renderError() {
  return respond(page(`<div class="banner bad"><b>Şu an doğrulanamadı, biraz sonra tekrar dene</b><div class="en">Could not verify right now, please try again shortly</div></div>`, 'ADA'), 503)
}

// Plain-text view model shared by the server page and the JSON endpoint (callers escape / use textContent).
function viewModel(code, r) {
  const cur = r.currency
  const before = Number(r.view_count_before) || 0
  // view_count_before excludes this open, so this open is number before + 1
  const first = fmtTime(r.first_viewed_at_before)
  return {
    status: r.status,
    isTest: r.is_test === true,
    partner: String(r.partner_name ?? ''),
    orderNo: `${code.slice(0, 4)}-${code.slice(4)}`,
    time: fmtTime(r.created_at),
    lines: (Array.isArray(r.lines) ? r.lines : []).map(l => ({ l: `${Number(l.qty)} × ${String(l.name ?? '')}`, r: fmtMoney(Number(l.qty) * Number(l.unit_price), cur), ...(l.detail == null || l.detail === '' ? {} : { d: String(l.detail) }) })),
    total: fmtMoney(r.total, cur),
    seenTr: before > 0 ? `İlk görüntülenme: ${first} · ${before + 1} kez açıldı` : 'İlk kez görüntüleniyor',
    seenEn: before > 0 ? `First viewed ${first} · opened ${before + 1} times (including now)` : 'Viewed for the first time',
    ...statusModel(r),
  }
}

// Customer-safe status fields. The timeline shows only where status is in use (switched on, a TEST order, or already moved).
function statusModel(r) {
  const os = STATUSES.includes(r.order_status) ? r.order_status : 'sent'
  return {
    orderStatus: os,
    fulfilment: r.fulfilment === 'pickup' || r.fulfilment === 'delivery' ? r.fulfilment : null,
    statusAt: r.status_at ? fmtTime(r.status_at) : '',
    cancelReason: os === 'cancelled' && Object.hasOwn(REASONS, r.cancel_reason) ? r.cancel_reason : null,
    statusShown: r.is_test === true || r.status_enabled === true || os !== 'sent',
  }
}

// Restaurant fields: manage/next only with the Worker key AND verify's can_manage (an enrolled device of this partner).
function manageModel(r, env, device) {
  const age = Date.now() - Date.parse(r.created_at)
  const frozen = !(age < H12)
  const key = hasKey(env)
  const manage = key && !!device && r.can_manage === true
  const os = STATUSES.includes(r.order_status) ? r.order_status : 'sent'
  return {
    manage,
    pinable: key && !manage && r.status_open === true && !frozen && (r.status_enabled === true || r.is_test === true),
    next: manage && !frozen && Array.isArray(r.next) ? r.next.filter(x => STATUSES.includes(x) && x !== 'sent') : [],
    frozen: manage && frozen,
    old2h: manage && !frozen && os === 'sent' && age >= H2,
  }
}

const two = (p, cls = 'en') => `${esc(p[0])}<div class="${cls}">${esc(p[1])}</div>`
function timelineHtml(v) {
  const head = `<div class="sh">${two(v.isTest ? ['Sipariş durumu · TEST', 'Order status · TEST'] : ['Sipariş durumu', 'Order status'])}</div>`
  if (v.orderStatus === 'cancelled') {
    const rs = REASONS[v.cancelReason]
    return `<div class="sec">${head}<div class="cx"><b>${esc(ST.cancelled[0] + (v.statusAt ? ' · ' + v.statusAt : ''))}</b><div>${esc(rs ? rs[0] : '')}</div><div class="en">${esc(ST.cancelled[1] + (rs ? ' — ' + rs[1] : ''))}</div></div></div>`
  }
  const rk = RANK[v.orderStatus] || 0
  const steps = ['sent', 'received', 'preparing', finalStep(v)].map((s, i) => {
    const t = i === rk ? (v.statusAt || v.time) : ''
    return `<div class="step${i <= rk ? ' done' : ''}${i === rk ? ' cur' : ''}"><span class="dot"></span><div><span>${esc(ST[s][0])}</span>${t ? `<span class="tm"> · ${esc(t)}</span>` : ''}<div class="en">${esc(ST[s][1])}</div></div></div>`
  }).join('')
  return `<div class="sec">${head}${steps}</div>`
}

function renderOrder(code, r) {
  const expired = r.status === 'expired'
  const v = viewModel(code, r)
  const lines = v.lines.map(l => `<li><span>${esc(l.l)}${l.d ? `<span class="d">${esc(l.d)}</span>` : ''}</span><span>${esc(l.r)}</span></li>`).join('')
  const seen = `${esc(v.seenTr)}<div class="en">${esc(v.seenEn)}</div>`
  const banner = v.isTest
    ? `<div class="banner bad"><b>TEST SİPARİŞİ — hazırlamayın</b><div class="en">TEST ORDER — do not prepare</div></div>`
    : expired
    ? `<div class="banner bad"><b>Süresi dolmuş</b><div class="en">Expired</div></div>`
    : `<div class="banner"><b>✓ Bu sipariş ADA üzerinden geldi</b><div class="en">This order came through ADA</div></div>`
  const body = `${banner}<div class="card${(expired || v.isTest) ? ' grey' : ''}"><h2>${esc(r.partner_name)}</h2>
<div class="meta">Sipariş no: <b>${esc(v.orderNo)}</b></div>
<div class="meta">${esc(v.time)}</div>
<ul>${lines}</ul><div class="total"><span>Toplam</span><span>${esc(v.total)}</span></div>
<div class="seen">${seen}</div></div>${v.statusShown ? timelineHtml(v) : ''}`
  return respond(page(body, 'ADA'), 200)
}

// Headers are built here from env only: no client header (x-ada-worker-key included) is ever forwarded.
async function rpc(env, name, args, withKey) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5000)
  try {
    const headers = { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' }
    if (withKey) headers['x-ada-worker-key'] = env.ADA_WORKER_KEY
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(args), signal: ctrl.signal })
    if (!res.ok) return null
    const j = await res.json()
    return j && typeof j === 'object' && typeof j.status === 'string' ? j : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// p_device (and the key) only for a restaurant phone's cookie with the key set; a customer call stays exactly { p_code }.
async function verify(code, env, device = null) {
  const withDevice = !!device && hasKey(env)
  const j = await rpc(env, 'verify_eatery_order', withDevice ? { p_code: code, p_device: device } : { p_code: code }, withDevice)
  return j && ['ok', 'expired', 'not_found'].includes(j.status) ? j : null
}

const PIN_RESULTS = ['wrong_pin', 'locked', 'closed', 'no_pin', 'device_limit', 'not_found', 'forbidden']
const SET_RESULTS = ['forbidden', 'not_found', 'disabled', 'frozen', 'invalid_transition', 'invalid_reason']

// /pin, /status, /forget, /token: POST, same origin, no bot, JSON body (small), valid code, Worker key set.
async function writeGuard(request, url, env, code) {
  if (request.method !== 'POST') return { res: plainResponse('Method Not Allowed', 405, { Allow: 'POST' }) }
  if (!sameOrigin(request, url)) return { res: respondJson({ status: 'forbidden' }, 403) }
  if (BOT_UA.test(request.headers.get('user-agent') || '')) return { res: respondJson({ status: 'bot' }, 403) }
  if (!isJson(request)) return { res: respondJson({ status: 'bad_request' }, 415) }
  if (!code) return { res: respondJson({ status: 'not_found' }, 404) }
  if (!hasKey(env)) return { res: respondJson({ status: 'unavailable' }, 403) }
  let body
  try {
    const raw = await request.text()
    if (raw.length > 1024) throw new Error()
    body = JSON.parse(raw)
  } catch { return { res: respondJson({ status: 'bad_request' }, 400) } }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { res: respondJson({ status: 'bad_request' }, 400) }
  return { body }
}

// Per-IP limit on PIN tries when the rate-limit binding exists (wrangler.jsonc "ratelimits"); no binding = DB caps only.
async function pinRateOk(request, env) {
  if (typeof env.PIN_RATE_LIMITER?.limit !== 'function') return true
  try {
    const { success } = await env.PIN_RATE_LIMITER.limit({ key: 'pin:' + (request.headers.get('cf-connecting-ip') || 'unknown') })
    return success !== false
  } catch { return true }
}

async function restaurantAction(action, request, url, env, code) {
  const g = await writeGuard(request, url, env, code)
  if (g.res) return g.res
  const device = readDevice(request)
  if (action === 'token') return respondJson({ status: 'ok', token: await newActionToken(env, code, device) }, 200)
  if (!(await actionTokenOk(env, code, device, g.body.token))) return respondJson({ status: 'retry' }, 403)

  if (action === 'forget') {
    return respondJson({ status: 'ok', token: await newActionToken(env, code, null) }, 200, { 'Set-Cookie': CLEAR_COOKIE })
  }

  if (action === 'pin') {
    if (!(await pinRateOk(request, env))) return respondJson({ status: 'rate_limited' }, 429)
    const pin = g.body.pin
    if (typeof pin !== 'string' || !/^[0-9]{6}$/.test(pin)) return respondJson({ status: 'wrong_pin' }, 200)
    const r = await rpc(env, 'eatery_partner_enrol', { p_code: code, p_pin: pin }, true)
    if (!r) return respondJson({ status: 'error' }, 503)
    if (r.status === 'ok' && typeof r.device_token === 'string' && DEVICE_RE.test(r.device_token)) {
      return respondJson({ status: 'ok', token: await newActionToken(env, code, r.device_token) }, 200, { 'Set-Cookie': deviceCookie(r.device_token) })
    }
    return respondJson({ status: PIN_RESULTS.includes(r.status) ? r.status : 'error' }, PIN_RESULTS.includes(r.status) ? 200 : 503)
  }

  // action === 'status'
  if (!device) return respondJson({ status: 'forbidden' }, 403)
  const { status, reason } = g.body
  if (!STATUSES.includes(status) || status === 'sent') return respondJson({ status: 'invalid_transition' }, 200)
  if (status === 'cancelled' ? !Object.hasOwn(REASONS, reason) : reason != null) return respondJson({ status: 'invalid_reason' }, 200)
  const r = await rpc(env, 'eatery_order_set_status', { p_code: code, p_status: status, p_reason: status === 'cancelled' ? reason : null, p_device: device }, true)
  if (!r) return respondJson({ status: 'error' }, 503)
  if (r.status === 'ok') {
    return respondJson({
      status: 'ok', changed: r.changed !== false,
      orderStatus: STATUSES.includes(r.order_status) ? r.order_status : status,
      next: Array.isArray(r.next) ? r.next.filter(x => STATUSES.includes(x) && x !== 'sent') : [],
      statusAt: fmtTime(new Date().toISOString()),
      token: await newActionToken(env, code, device),
    }, 200)
  }
  return respondJson({ status: SET_RESULTS.includes(r.status) ? r.status : 'error' }, SET_RESULTS.includes(r.status) ? 200 : 503)
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const m = url.pathname.match(/^\/o\/([^/]*?)(?:\/(check|pin|status|forget|token))?\/?$/)
    if (!m) return env.ASSETS.fetch(request)
    const isCheck = m[2] === 'check'
    const method = request.method
    const code = normalizeCode(m[1])
    if (m[2] && !isCheck) return restaurantAction(m[2], request, url, env, code)
    if (isCheck) {
      if (method !== 'POST') return plainResponse('Method Not Allowed', 405, { Allow: 'POST' })
      if (!sameOrigin(request, url)) return respondJson({ status: 'forbidden' }, 403)
      if (!code) return respondJson({ status: 'not_found' }, 404)
      if (BOT_UA.test(request.headers.get('user-agent') || '')) return respondJson({ status: 'bot' }, 200)
      const device = readDevice(request)
      const r = await verify(code, env, device)
      if (!r) return respondJson({ status: 'error' }, 503)
      if (r.status === 'not_found') return respondJson({ status: 'not_found' }, 404)
      const out = { ...viewModel(code, r), ...manageModel(r, env, device) }
      if (hasKey(env)) out.token = await newActionToken(env, code, device)
      return respondJson(out, 200)
    }
    if (method !== 'GET' && method !== 'HEAD') return plainResponse('Method Not Allowed', 405, { Allow: 'GET, HEAD' })
    if (!code) return renderNotFound()
    // ?view=1 = no-script fallback: server-side result. Bots still never trigger it.
    if (method === 'GET' && url.searchParams.get('view') === '1' && !BOT_UA.test(request.headers.get('user-agent') || '')) {
      const r = await verify(code, env)
      if (!r) return renderError()
      if (r.status === 'not_found') return renderNotFound()
      return renderOrder(code, r)
    }
    return renderLoading(code, method === 'HEAD')
  },
}
