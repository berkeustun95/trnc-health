// getadaapp.com/o/<code> — WhatsApp order verification page (server-rendered, no client JS).
// Every other request is handed to the static-assets binding untouched (privacy/support/delete-account).

const CODE_RE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/
const TZ = 'Europe/Istanbul'

const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
}

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
.grey{opacity:.55}.seen{margin-top:14px;font-size:14px;color:#55657A}.note{margin:16px 4px 0;font-size:13px;color:#55657A}
.btn{display:block;width:100%;margin-top:18px;padding:16px;border:0;border-radius:12px;background:#0E7C7B;color:#fff;font:700 18px/1 inherit;font-family:inherit}.btn:active{background:#0A5E5D}.big{font-size:28px;font-weight:800;letter-spacing:.06em;color:#0A5E5D;margin:8px 0}.foot{margin-top:24px;text-align:center;font-size:12px}.foot a{color:#55657A}`

function page(body, title) {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title><style>${CSS}</style></head>
<body><div class="w"><div class="logo">ADA</div>${body}
<p class="note">Fiyatlar ADA menüsündendir. Not satırı doğrulanmaz.<br><span class="en">Prices are from the ADA menu. The note line is not verified.</span></p>
<div class="foot"><a href="https://getadaapp.com/privacy">getadaapp.com/privacy</a></div></div></body></html>`
}

function respond(html, status) {
  return new Response(html, { status, headers: HEADERS })
}

// Link previews (WhatsApp) only GET/HEAD: no RPC, no partner or items, so a preview never counts as a view.
function renderGate(code, head) {
  const fmt = `${code.slice(0, 4)}-${code.slice(4)}`
  const body = `<div class="card"><h2>ADA sipariş doğrulama</h2><div class="en">ADA order verification</div>
<div class="big">${esc(fmt)}</div>
<form method="POST" action="/o/${esc(fmt)}"><button class="btn" type="submit">Siparişi doğrula<br><span style="font-size:13px;font-weight:400">Verify order</span></button></form></div>`
  return new Response(head ? null : page(body, 'ADA'), { status: 200, headers: HEADERS })
}

function renderNotFound() {
  return respond(page(`<div class="banner bad"><b>ADA'da böyle bir sipariş yok</b><div class="en">No such order in ADA</div></div>`, 'ADA'), 404)
}

function renderError() {
  return respond(page(`<div class="banner bad"><b>Şu an doğrulanamadı, biraz sonra tekrar dene</b><div class="en">Could not verify right now, please try again shortly</div></div>`, 'ADA'), 503)
}

function renderOrder(code, r) {
  const expired = r.status === 'expired'
  const cur = r.currency
  const lines = (Array.isArray(r.lines) ? r.lines : []).map(l =>
    `<li><span>${esc(Number(l.qty))} × ${esc(l.name)}</span><span>${esc(fmtMoney(Number(l.qty) * Number(l.unit_price), cur))}</span></li>`).join('')
  const before = Number(r.view_count_before) || 0
  // view_count_before excludes this open, so this open is number before + 1
  const seen = before > 0
    ? `İlk görüntülenme: ${esc(fmtTime(r.first_viewed_at_before))} · ${before + 1} kez açıldı<div class="en">First viewed ${esc(fmtTime(r.first_viewed_at_before))} · opened ${before + 1} times (including now)</div>`
    : `İlk kez görüntüleniyor<div class="en">Viewed for the first time</div>`
  const banner = expired
    ? `<div class="banner bad"><b>Süresi dolmuş</b><div class="en">Expired</div></div>`
    : `<div class="banner"><b>✓ Bu sipariş ADA üzerinden geldi</b><div class="en">This order came through ADA</div></div>`
  const body = `${banner}<div class="card${expired ? ' grey' : ''}"><h2>${esc(r.partner_name)}</h2>
<div class="meta">Sipariş no: <b>${esc(code.slice(0, 4))}-${esc(code.slice(4))}</b></div>
<div class="meta">${esc(fmtTime(r.created_at))}</div>
<ul>${lines}</ul><div class="total"><span>Toplam</span><span>${esc(fmtMoney(r.total, cur))}</span></div>
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
    const m = url.pathname.match(/^\/o\/([^/]*)\/?$/)
    if (!m) return env.ASSETS.fetch(request)
    if (!['GET', 'HEAD', 'POST'].includes(request.method)) return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD, POST' } })
    const code = normalizeCode(m[1])
    if (!code) return renderNotFound()
    if (request.method !== 'POST') return renderGate(code, request.method === 'HEAD')
    const r = await verify(code, env)
    if (!r) return renderError()
    if (r.status === 'not_found') return renderNotFound()
    return renderOrder(code, r)
  },
}
