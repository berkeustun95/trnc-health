// admin-push: the admin's two many-recipient pushes (duty swap, Broadcast tab), free of remote imports so `deno test`
// runs it offline (index.ts wires the real clients in). The caller is already a verified admin when this runs.
//
// SEND ONCE: the request id is claimed in admin_push_sends BEFORE any recipient is read or written; a repeat of the same
// id sends nothing, and a claim that cannot be written sends nothing. A crash after the claim means that id never sends
// again: a missed push is recoverable, a double push to everyone is not. Every Expo group of 25 is sent exactly once (push.ts).
// Nothing here logs or returns a user id, token, title/body, the allowlist or an Expo message: codes only.
import { readAllById, profileReadKinds, type PageFetcher } from '../send-duty-notification/page.ts'
import { lastSignIns, onePerToken, pushOutcome, sendGroups, sharedTokenIds } from '../send-duty-notification/push.ts'
import { dutySwapText } from './strings.mjs'

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_TITLE = 100
export const MAX_BODY = 300
const MAX_ERROR_KINDS = 20

export type Profile = { id: string; push_token: string | null; preferred_language: string | null }
export type Request =
  | { kind: 'duty_swap'; request_id: string; duty_list_id: string; test: boolean }
  | { kind: 'broadcast'; request_id: string; target: 'all' | 'customers' | 'providers'; title: string; body: string; test: boolean }
export type Result = { status: number; body: Record<string, unknown> }

export interface Deps {
  testUserIds(): string | undefined | null
  claim(row: { request_id: string; kind: string; test: boolean; admin_id: string }): Promise<'claimed' | 'duplicate' | 'error'>
  storedOutcome(requestId: string): Promise<string | null>
  finish(requestId: string, fields: Record<string, unknown>): Promise<void>
  dutyEntry(id: string): Promise<{ data: { name: string; duty_date: string } | null; error: boolean }>
  profilePage(role: 'customer' | 'provider' | null): PageFetcher<Profile>
  insertNotifications(rows: { user_id: string; title: string; body: string; type: string }[]): Promise<boolean>
  getLastSignIn(id: string): Promise<string | null | undefined>
  fetchFn: (url: string, init: RequestInit) => Promise<Response>
  sleep?: (ms: number) => Promise<void>   // tests only: skips the 0.5 s gaps between groups
  now?: () => number
  log(code: string): void
}

const out = (status: number, body: Record<string, unknown>): Result => ({ status, body })
const bad = () => out(400, { ok: false, error: 'bad_request' })

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const hasOnly = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).every((k) => keys.includes(k))

// null = 400. Unknown keys are refused too: a request is exactly the shape the contract lists.
export function parseRequest(input: unknown): Request | null {
  if (!isObj(input)) return null
  const { kind, request_id, test } = input
  if (typeof request_id !== 'string' || !UUID_RE.test(request_id)) return null
  if (test !== undefined && typeof test !== 'boolean') return null
  if (kind === 'duty_swap') {
    if (!hasOnly(input, ['kind', 'request_id', 'duty_list_id', 'test'])) return null
    if (typeof input.duty_list_id !== 'string' || !UUID_RE.test(input.duty_list_id)) return null
    return { kind, request_id, duty_list_id: input.duty_list_id, test: test === true }
  }
  if (kind === 'broadcast') {
    if (!hasOnly(input, ['kind', 'request_id', 'target', 'title', 'body', 'test'])) return null
    const { target } = input
    if (target !== 'all' && target !== 'customers' && target !== 'providers') return null
    if (typeof input.title !== 'string' || typeof input.body !== 'string') return null
    const title = input.title.trim(), body = input.body.trim()
    if (title.length < 1 || title.length > MAX_TITLE || body.length < 1 || body.length > MAX_BODY) return null
    return { kind, request_id, target, title, body, test: test === true }
  }
  return null
}

// null = the secret is missing, empty, or has an entry that is not a UUID (never partially trusted).
export function parseAllowlist(raw: string | undefined | null): Set<string> | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  const ids = raw.split(',').map((s) => s.trim().toLowerCase())
  if (ids.some((s) => !UUID_RE.test(s))) return null
  return new Set(ids)
}

const fill = (tpl: string, name: string, date: string) =>
  tpl.replace('{name}', () => name).replace('{date}', () => date)

export async function handle(input: unknown, adminId: string, d: Deps): Promise<Result> {
  const req = parseRequest(input)
  if (!req) return bad()

  let allow: Set<string> | null = null
  if (req.test) {
    allow = parseAllowlist(d.testUserIds())
    if (!allow) { d.log('test_mode_unconfigured'); return out(503, { ok: false, error: 'test_mode_unconfigured' }) }
  }

  const claim = await d.claim({ request_id: req.request_id, kind: req.kind, test: req.test, admin_id: adminId })
  if (claim === 'error') { d.log('claim_failed'); return out(500, { ok: false, error: 'server_error' }) }
  if (claim === 'duplicate') {
    let previous = 'running'
    try { previous = (await d.storedOutcome(req.request_id)) ?? 'running' } catch { /* the id is claimed either way */ }
    return out(200, { ok: true, outcome: 'duplicate', test: req.test, previous })
  }

  const stop = async (outcome: string, res: Result): Promise<Result> => {
    await d.finish(req.request_id, { outcome })
    return res
  }

  try {
    let role: 'customer' | 'provider' | null
    let textFor: (lang: string | null) => { title: string; body: string }
    let data: Record<string, unknown>
    if (req.kind === 'duty_swap') {
      const e = await d.dutyEntry(req.duty_list_id)
      if (e.error) { d.log('duty_read_failed'); return await stop('duty_read_failed', out(500, { ok: false, error: 'server_error' })) }
      if (!e.data) return await stop('duty_entry_not_found', out(404, { ok: false, error: 'duty_entry_not_found' }))
      const { name, duty_date } = e.data
      role = 'customer'
      textFor = (lang) => {
        const s = dutySwapText(lang || 'English')
        return { title: s.title, body: fill(s.body, name, duty_date) }
      }
      data = { screen: 'duty' }
    } else {
      role = req.target === 'customers' ? 'customer' : req.target === 'providers' ? 'provider' : null
      const { title, body } = req
      textFor = () => ({ title, body })
      data = {}
    }

    const read = await readAllById<Profile>(d.profilePage(role))
    if (read.error) { d.log('profiles_read_failed'); return await stop('profiles_query_failed', out(500, { ok: false, error: 'server_error' })) }
    let profiles = read.rows
    if (allow) profiles = profiles.filter((p) => allow!.has(p.id.toLowerCase()))
    if (!profiles.length) {
      await d.finish(req.request_id, { outcome: 'no_recipients', recipients: 0, notified: 0, push_attempted: 0, push_ok: 0, push_errors: 0, error_kinds: profileReadKinds(read) })
      return out(200, { ok: true, outcome: 'no_recipients', test: req.test, recipients: 0, pushed: 0 })
    }

    const errorKinds: Record<string, number> = Object.create(null)
    Object.assign(errorKinds, profileReadKinds(read))

    let notified = 0
    for (let i = 0; i < profiles.length; i += 500) {
      const chunk = profiles.slice(i, i + 500)
      const ok = await d.insertNotifications(chunk.map((p) => ({ user_id: p.id, ...textFor(p.preferred_language), type: 'admin_message' })))
      if (ok) notified += chunk.length
      else { errorKinds.notif_batch_failed = (errorKinds.notif_batch_failed ?? 0) + 1; d.log('notifications_insert_failed') }
    }

    const signIns = await lastSignIns(sharedTokenIds(profiles), d.getLastSignIn)
    const messages = onePerToken(profiles, signIns).map((p) => ({
      to: p.push_token, ...textFor(p.preferred_language), sound: 'default', data,
    }))
    let pushErrors = 0
    const sent = await sendGroups(messages, { fetchFn: d.fetchFn, sleep: d.sleep, now: d.now })
    const pushOk = sent.ok, accepted = sent.groupsAccepted, failed = sent.groupsFailed
    for (const [kind, n] of Object.entries(sent.kinds)) {
      pushErrors += n
      const key = kind in errorKinds || Object.keys(errorKinds).length < MAX_ERROR_KINDS ? kind : 'other'
      errorKinds[key] = (errorKinds[key] ?? 0) + n
    }

    const outcome = pushOutcome(messages.length, accepted, failed)
    await d.finish(req.request_id, {
      outcome, recipients: profiles.length, notified, push_attempted: messages.length, push_ok: pushOk,
      push_errors: pushErrors, error_kinds: errorKinds,
    })
    if (outcome === 'push_failed') return out(502, { ok: false, error: 'push_failed', test: req.test, recipients: profiles.length })
    return out(200, { ok: true, outcome, test: req.test, recipients: profiles.length, pushed: pushOk })
  } catch {
    d.log('unexpected_throw')
    try { await d.finish(req.request_id, { outcome: 'server_error' }) } catch { /* ledger stays 'running' */ }
    return out(500, { ok: false, error: 'server_error' })
  }
}
