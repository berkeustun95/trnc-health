#!/usr/bin/env node
// ─── Send ONE test push to one account's device, from GitHub Actions only ────
//
//   gh workflow run push-test -f email=<account email> [-f kind=plain|messages|duty|datajobs]
//
// Proves the chain the app depends on: profiles.push_token → Expo push service → FCM (Android)
// or APNs (iOS) → device. The token is looked up through the Management API's READ-ONLY
// endpoint (supabase_read_only_user). Actions logs are public, so the account, token and ticket
// are sealed: open them with `node scripts/readonly-results.mjs <run-id>`.
// Writes nothing to the database. The Expo RECEIPT is fetched too: a ticket only says Expo
// accepted the message; the receipt says whether FCM/APNs did (InvalidCredentials,
// DeviceNotRegistered … show up only there).
//
// kind=messages sends the Student Hub payload with no conversation_id ({screen:'conversation',
// type:'message'}): tapping it must open Student Hub → Messages (the "old push" path).
// kind=duty sends the duty push's own data ({screen:'duty', date}, as send-duty-notification): tapping it must open
// Nöbetçi Eczane from a killed, a backgrounded and a foreground app.
// kind=datajobs sends the data-jobs watchdog's data ({screen:'admin', tab:'datajobs'}, as 20261211): tapping it must open
// AdminScreen's Data jobs tab. Admin accounts only (AdminScreen is the only reader; a non-admin tap is a no-op).
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { prodWriteGuard } from './lib/prod-write-guard.mjs'
import { seal } from './lib/readonly-seal.mjs'
import { errorKind, onePerToken } from '../supabase/functions/send-duty-notification/push.ts'

prodWriteGuard({ wouldWrite: false, workflow: 'push-test' })

const fail = m => { console.error(`::error::${m}`); process.exit(1) }
const email = (process.argv[2] || '').trim().toLowerCase()
const kind = process.argv[3] || 'plain'
// Two-account mode (duplicate-push proof, 2026-11-14): a second e-mail of the SAME mailbox (name / name+tag only) and
// dedupe on|off. 'on' sends what the broadcasts send since #405 (onePerToken, the same function); 'off' sends one
// message per account, the old behaviour, so a shared token shows the duplicate.
const email2 = (process.argv[4] || '').trim().toLowerCase()
const dedupe = process.argv[5] || 'on'
// Optional unique text (2026-11-14: "ADA test A" to one tester, so he can say whether THAT push arrived). Title and body.
const text = (process.argv[6] || '').trim()
if (text && !/^[A-Za-z0-9 ]{1,24}$/.test(text)) fail('Refused: text must be 1-24 letters, digits or spaces.')
// Double-send test (S2, 2026-11-20): the same message `repeat` times, `gap` seconds apart, as a retried Expo batch would
// land. keys=on adds the replace keys (collapseId: iOS replaces a shown notification; tag: Android) under a TEST key, so a
// test copy can never replace a real duty push on the phone.
const repeat = Number(process.argv[7] || '1')
const gap = Number(process.argv[8] || '0')
const keys = process.argv[9] || 'none'
if (![1, 2].includes(repeat)) fail(`Refused: repeat must be 1 or 2, got ${process.argv[7]}.`)
if (![0, 10, 30].includes(gap)) fail(`Refused: gap must be 0, 10 or 30 seconds, got ${process.argv[8]}.`)
if (!['none', 'on'].includes(keys)) fail(`Refused: keys must be none or on, got ${keys}.`)
// Silent copy (Berke, 2026-11-21): sound=second_off sends copy 2 without a sound; sound=off sends every copy without one
// (repeat=1 + off = "only the silent copy arrived"). iOS plays no sound when `sound` is absent. On Android 8+ the app's
// channel decides the sound, not the message, so the 'default' channel may still ring: that is what the test measures.
const sound = process.argv[10] || 'on'
if (!['on', 'second_off', 'off'].includes(sound)) fail(`Refused: sound must be on, second_off or off, got ${sound}.`)
const silent = r => sound === 'off' || (sound === 'second_off' && r > 0)
// One key per case (Berke, 2026-11-21): with a text, the key is ada-s2-test-<text>, so one case's copies can only replace
// each other, never another case's. Text is already limited to letters, digits and spaces.
const REPLACE_KEY = text ? `ada-s2-test-${text.toLowerCase().replace(/ +/g, '-')}` : 'ada-s2-test'
if (!/^[^\s@']+@[^\s@']+\.[^\s@']+$/.test(email)) fail('Refused: that is not an email.')
if (!['plain', 'messages', 'duty', 'datajobs'].includes(kind)) fail(`Refused: kind must be plain, messages, duty or datajobs, got ${kind}.`)
const mailbox = e => { const [l, d] = e.split('@'); return `${l.split('+')[0]}@${d}` }
// QA accounts only (Berke, 2026-11-20): the QA mailbox and its +tags (QA account 1 and berkeps15+qa2-style accounts).
// Matched by the SHA-256 of the lower-cased mailbox, the same value 20261133 already carries as one of its two e-mail hashes, so no new
// identifier enters this public repo.
const QA_MAILBOX_SHA256 = 'c5f67310246afe9b8deb939625d530743650b4412bcbf3ba5e852956130a025c'
const isQa = e => createHash('sha256').update(mailbox(e)).digest('hex') === QA_MAILBOX_SHA256
if (!isQa(email)) fail('Refused: push-test sends to the QA test accounts only.')
if (email2 && repeat !== 1) fail('Refused: repeat=2 is one account only; leave email2 empty.')
if (email2) {
  if (!isQa(email2)) fail('Refused: push-test sends to the QA test accounts only.')
  if (!/^[^\s@']+@[^\s@']+\.[^\s@']+$/.test(email2)) fail('Refused: the second e-mail is not an email.')
  if (email2 === email || mailbox(email2) !== mailbox(email)) fail('Refused: the second e-mail must be a +tag of the same mailbox.')
  if (!['on', 'off'].includes(dedupe)) fail(`Refused: dedupe must be on or off, got ${dedupe}.`)
}
const token = process.env.SUPABASE_ACCESS_TOKEN
const ref = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec(process.env.SUPABASE_URL ?? '')?.[1]
if (!token || !ref) fail('SUPABASE_ACCESS_TOKEN / SUPABASE_URL missing.')

async function lookup(e) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query/read-only`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `select p.id::text as id, p.role, p.push_token, p.preferred_language
      from auth.users u join public.profiles p on p.id = u.id where lower(u.email) = '${e}'` }),
  })
  const rows = await r.json().catch(() => null)
  if (!r.ok || !Array.isArray(rows)) fail(`Lookup failed (HTTP ${r.status}).`)
  if (rows.length !== 1) fail(`Expected exactly 1 account for that email, found ${rows.length}.`)
  const row = rows[0]
  if (!row.push_token) fail('That account has no push_token: open the app signed in on the device, allow notifications, retry.')
  if (!/^ExponentPushToken\[.+\]$/.test(row.push_token)) fail('push_token is not an Expo push token.')
  if (!['customer', 'admin'].includes(row.role)) fail('Refused: only customer/admin test accounts.')
  return row
}
const accounts = [await lookup(email), ...(email2 ? [await lookup(email2)] : [])]
const recipients = email2 && dedupe === 'on' ? onePerToken(accounts) : accounts
const { id, role, push_token: pt, preferred_language: lang } = recipients[0]
if (kind === 'datajobs' && recipients.some(r => r.role !== 'admin')) fail('Refused: kind=datajobs goes to admin accounts only.')

const tr = lang === 'Turkish'
const trncToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Famagusta' }).format(new Date())
const data = kind === 'messages' ? { screen: 'conversation', type: 'message' }
  : kind === 'duty' ? { screen: 'duty', date: trncToday }
  : kind === 'datajobs' ? { screen: 'admin', tab: 'datajobs' } : {}
const BODY = {
  messages: tr ? 'Dokun: Mesajlar açılmalı' : 'Tap: Messages should open',
  duty: tr ? 'Test: dokun, Nöbetçi Eczane açılmalı' : 'Test: tap, Duty Pharmacies should open',
  datajobs: tr ? 'Test: dokun, Veri görevleri açılmalı' : 'Test: tap, Data jobs should open',
  plain: tr ? 'Bu geldiyse bildirimler çalışıyor.' : 'If this arrived, push works.',
}
const TITLE = kind === 'duty' ? (tr ? '💊 Bugünkü Nöbetçi Eczane' : "💊 Today's Duty Pharmacy") : (tr ? 'ADA test bildirimi' : 'ADA test notification')
const messagesFor = r => recipients.map(({ push_token: to }) => ({ to, ...(silent(r) ? {} : { sound: 'default' }), data,
  channelId: 'default', title: text || TITLE, body: text || BODY[kind], ...(keys === 'on' ? { collapseId: REPLACE_KEY, tag: REPLACE_KEY } : {}) }))
let send
const tickets = []
for (let r = 0; r < repeat; r++) {
  if (r > 0) await new Promise(res => setTimeout(res, gap * 1000))
  send = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(messagesFor(r)),
  })
  tickets.push(...[].concat((await send.json().catch(() => ({})))?.data ?? []))
  console.log(`copy ${r + 1}/${repeat} sent at ${new Date().toISOString()} (keys ${keys}, ${silent(r) ? 'no sound' : 'sound'})`)
}
const expected = recipients.length * repeat
const ticket = tickets[0]
const publicKey = readFileSync('scripts/lib/readonly-results.pub', 'utf8')
console.log(seal(JSON.stringify({ account: `${id.slice(0, 8)}…`, role, language: lang, token: `…${pt.slice(-5, -1)}`, ticket,
  repeat, gap, keys, sound, ...(email2 ? { dedupe, same_token: accounts[0].push_token === accounts[1].push_token, messages_sent: recipients.length, tickets } : {}) }), publicKey))
if (email2) console.log(`two-account mode: dedupe ${dedupe}, messages sent: ${recipients.length}`)
console.log(`ticket: ${ticket?.status ?? 'none'}`)
if (tickets.length !== expected || tickets.some(x => x?.status !== 'ok')) {
  // Never Expo's free-text message: for DeviceNotRegistered it embeds the push token (public log).
  const bad = tickets.find(x => x?.status !== 'ok')
  fail(`Expo refused the message: ${bad ? errorKind(bad.details?.error) : `HTTP ${send.status}, ${tickets.length}/${expected} tickets`}`)
}

// Receipts appear after the provider answers; poll briefly.
for (let i = 0; i < 6; i++) {
  await new Promise(res => setTimeout(res, 5000))
  const rr = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: tickets.map(x => x.id) }) })
  const got = (await rr.json().catch(() => ({})))?.data ?? {}
  const receipts = tickets.map(x => got[x.id])
  if (receipts.every(Boolean)) {
    const receipt = receipts.find(x => x.status !== 'ok') ?? receipts[0]
    console.log(`receipts: ${receipts.map(x => x.status).join(', ')}`)
    if (receipt.status !== 'ok') fail(`Delivery refused by FCM/APNs: ${errorKind(receipt.details?.error)}`)
    console.log('✓ accepted by FCM/APNs — now check the device.')
    process.exit(0)
  }
}
console.log('⚠ no receipt after 30 s (not an error by itself) — check the device.')
