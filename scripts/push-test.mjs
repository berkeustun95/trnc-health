#!/usr/bin/env node
// ─── Send ONE test push to one account's device, from GitHub Actions only ────
//
//   gh workflow run push-test -f email=<account email> [-f kind=plain|messages]
//
// Proves the chain the app depends on: profiles.push_token → Expo push service → FCM (Android)
// or APNs (iOS) → device. The token is looked up through the Management API's READ-ONLY
// endpoint (supabase_read_only_user) and never printed — only its platform shape and last 4.
// Writes nothing to the database. The Expo RECEIPT is fetched too: a ticket only says Expo
// accepted the message; the receipt says whether FCM/APNs did (InvalidCredentials,
// DeviceNotRegistered … show up only there).
//
// kind=messages sends the Student Hub payload with no conversation_id ({screen:'conversation',
// type:'message'}): tapping it must open Student Hub → Messages (the "old push" path).
import { prodWriteGuard } from './lib/prod-write-guard.mjs'

prodWriteGuard({ wouldWrite: false, workflow: 'push-test' })

const fail = m => { console.error(`::error::${m}`); process.exit(1) }
const email = (process.argv[2] || '').trim().toLowerCase()
const kind = process.argv[3] || 'plain'
if (!/^[^\s@']+@[^\s@']+\.[^\s@']+$/.test(email)) fail(`Refused: ${JSON.stringify(email)} is not an email.`)
if (!['plain', 'messages'].includes(kind)) fail(`Refused: kind must be plain or messages, got ${kind}.`)
const token = process.env.SUPABASE_ACCESS_TOKEN
const ref = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec(process.env.SUPABASE_URL ?? '')?.[1]
if (!token || !ref) fail('SUPABASE_ACCESS_TOKEN / SUPABASE_URL missing.')

const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query/read-only`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: `select p.id::text as id, p.role, p.push_token, p.preferred_language
    from auth.users u join public.profiles p on p.id = u.id where lower(u.email) = '${email}'` }),
})
const rows = await r.json().catch(() => null)
if (!r.ok || !Array.isArray(rows)) fail(`Lookup failed (HTTP ${r.status}).`)
if (rows.length !== 1) fail(`Expected exactly 1 account for that email, found ${rows.length}.`)
const { id, role, push_token: pt, preferred_language: lang } = rows[0]
console.log(`account ${id.slice(0, 8)}… · role ${role} · language ${lang}`)
if (!pt) fail('That account has no push_token: open the app signed in on the device, allow notifications, retry.')
if (!/^ExponentPushToken\[.+\]$/.test(pt)) fail(`push_token is not an Expo push token (shape ${pt.slice(0, 18)}…).`)
console.log(`token: ExponentPushToken[…${pt.slice(-5, -1)}]`)

const tr = lang === 'Turkish'
const data = kind === 'messages' ? { screen: 'conversation', type: 'message' } : {}
const send = await fetch('https://exp.host/--/api/v2/push/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify({ to: pt, sound: 'default', data,
    title: tr ? 'ADA test bildirimi' : 'ADA test notification',
    body: kind === 'messages' ? (tr ? 'Dokun: Mesajlar açılmalı' : 'Tap: Messages should open')
                              : (tr ? 'Bu geldiyse bildirimler çalışıyor.' : 'If this arrived, push works.') }),
})
const ticket = (await send.json().catch(() => ({})))?.data
console.log(`ticket: ${JSON.stringify(ticket)}`)
if (ticket?.status !== 'ok') fail(`Expo refused the message: ${ticket?.details?.error ?? ticket?.message ?? send.status}`)

// Receipts appear after the provider answers; poll briefly.
for (let i = 0; i < 6; i++) {
  await new Promise(res => setTimeout(res, 5000))
  const rr = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [ticket.id] }) })
  const receipt = (await rr.json().catch(() => ({})))?.data?.[ticket.id]
  if (receipt) {
    console.log(`receipt: ${JSON.stringify(receipt)}`)
    if (receipt.status !== 'ok') fail(`Delivery refused by FCM/APNs: ${receipt.details?.error ?? receipt.message}`)
    console.log('✓ accepted by FCM/APNs — now check the device.')
    process.exit(0)
  }
}
console.log('⚠ no receipt after 30 s (not an error by itself) — check the device.')
