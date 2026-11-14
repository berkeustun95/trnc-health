#!/usr/bin/env node
// ─── Send ONE test push to one account's device, from GitHub Actions only ────
//
//   gh workflow run push-test -f email=<account email> [-f kind=plain|messages]
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
import { readFileSync } from 'node:fs'
import { prodWriteGuard } from './lib/prod-write-guard.mjs'
import { seal } from './lib/readonly-seal.mjs'
import { onePerToken } from '../supabase/functions/send-duty-notification/push.ts'

prodWriteGuard({ wouldWrite: false, workflow: 'push-test' })

const fail = m => { console.error(`::error::${m}`); process.exit(1) }
const email = (process.argv[2] || '').trim().toLowerCase()
const kind = process.argv[3] || 'plain'
// Two-account mode (duplicate-push proof, 2026-11-14): a second e-mail of the SAME mailbox (name / name+tag only) and
// dedupe on|off. 'on' sends what the broadcasts send since #405 (onePerToken, the same function); 'off' sends one
// message per account, the old behaviour, so a shared token shows the duplicate.
const email2 = (process.argv[4] || '').trim().toLowerCase()
const dedupe = process.argv[5] || 'on'
if (!/^[^\s@']+@[^\s@']+\.[^\s@']+$/.test(email)) fail('Refused: that is not an email.')
if (!['plain', 'messages'].includes(kind)) fail(`Refused: kind must be plain or messages, got ${kind}.`)
const mailbox = e => { const [l, d] = e.split('@'); return `${l.split('+')[0]}@${d}` }
if (email2) {
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

const tr = lang === 'Turkish'
const data = kind === 'messages' ? { screen: 'conversation', type: 'message' } : {}
const send = await fetch('https://exp.host/--/api/v2/push/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify(recipients.map(({ push_token: to }) => ({ to, sound: 'default', data, channelId: 'default',
    title: tr ? 'ADA test bildirimi' : 'ADA test notification',
    body: kind === 'messages' ? (tr ? 'Dokun: Mesajlar açılmalı' : 'Tap: Messages should open')
                              : (tr ? 'Bu geldiyse bildirimler çalışıyor.' : 'If this arrived, push works.') }))),
})
const tickets = [].concat((await send.json().catch(() => ({})))?.data ?? [])
const ticket = tickets[0]
const publicKey = readFileSync('scripts/lib/readonly-results.pub', 'utf8')
console.log(seal(JSON.stringify({ account: `${id.slice(0, 8)}…`, role, language: lang, token: `…${pt.slice(-5, -1)}`, ticket,
  ...(email2 ? { dedupe, same_token: accounts[0].push_token === accounts[1].push_token, messages_sent: recipients.length, tickets } : {}) }), publicKey))
if (email2) console.log(`two-account mode: dedupe ${dedupe}, messages sent: ${recipients.length}`)
console.log(`ticket: ${ticket?.status ?? 'none'}`)
if (tickets.length !== recipients.length || tickets.some(x => x?.status !== 'ok')) fail(`Expo refused the message: ${ticket?.details?.error ?? ticket?.message ?? send.status}`)

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
    if (receipt.status !== 'ok') fail(`Delivery refused by FCM/APNs: ${receipt.details?.error ?? receipt.message}`)
    console.log('✓ accepted by FCM/APNs — now check the device.')
    process.exit(0)
  }
}
console.log('⚠ no receipt after 30 s (not an error by itself) — check the device.')
