// getadaapp.com/o/<code> — WhatsApp order verification page.
// GET/HEAD never call the RPC (link previews must not count as views); a visible browser's inline script POSTs /o/<code>/check.
// Every other request is handed to the static-assets binding untouched (privacy/support/delete-account).

const CODE_RE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/
const TZ = 'Europe/Istanbul'

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
.a{color:#0E7C7B;font-weight:700}.big{font-size:28px;font-weight:800;letter-spacing:.06em;color:#0A5E5D;margin:8px 0}.foot{margin-top:24px;text-align:center;font-size:12px}.foot a{color:#55657A}`

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

// Runs only in a VISIBLE tab (link-preview renderers are never visible). DOM is built with textContent only.
const CLIENT_JS = `(function(){
var box=document.getElementById('r'),done=false;
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function banner(tr,en,bad){var d=el('div','banner'+(bad?' bad':''));d.appendChild(el('b',null,tr));d.appendChild(el('div','en',en));return d}
function put(){box.textContent='';for(var j=0;j<arguments.length;j++)box.appendChild(arguments[j])}
function fail(){var b=banner('Şu an doğrulanamadı, biraz sonra tekrar dene','Could not verify right now, please try again shortly',true);var a=el('a','a','Tekrar dene');a.href='?view=1';var p=el('p','note');p.appendChild(a);put(b,p)}
function show(j){
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
put(b,c)}
function run(){if(done)return;done=true;
fetch(location.pathname.replace(/\\/$/,'')+'/check',{method:'POST',cache:'no-store',credentials:'omit'})
.then(function(r){return r.json()}).then(show).catch(fail)}
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
function respondJson(o, status) {
  return new Response(jsonSafe(o), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': JSON_CSP,
  } })
}

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
  }
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
<div class="seen">${seen}</div></div>`
  return respond(page(body, 'ADA'), 200)
}

async function verify(code, env) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5000)
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/verify_eatery_order`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_code: code }),
      signal: ctrl.signal,
    })
    if (!res.ok) return null
    const j = await res.json()
    return j && typeof j === 'object' && ['ok', 'expired', 'not_found'].includes(j.status) ? j : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const m = url.pathname.match(/^\/o\/([^/]*?)(\/check)?\/?$/)
    if (!m) return env.ASSETS.fetch(request)
    const isCheck = !!m[2]
    const method = request.method
    const code = normalizeCode(m[1])
    if (isCheck) {
      if (method !== 'POST') return plainResponse('Method Not Allowed', 405, { Allow: 'POST' })
      if (!sameOrigin(request, url)) return respondJson({ status: 'forbidden' }, 403)
      if (!code) return respondJson({ status: 'not_found' }, 404)
      if (BOT_UA.test(request.headers.get('user-agent') || '')) return respondJson({ status: 'bot' }, 200)
      const r = await verify(code, env)
      if (!r) return respondJson({ status: 'error' }, 503)
      if (r.status === 'not_found') return respondJson({ status: 'not_found' }, 404)
      return respondJson(viewModel(code, r), 200)
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
