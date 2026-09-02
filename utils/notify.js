import { supabase } from '../lib/supabase'

// Notify a facility's owning provider that a question arrived.
//
// EVERYTHING happens server-side, in notify_facility_owner() (20260923): the recipient
// is derived from the facility, authorization is derived from the questions table, the strings come from notify_owner_text() in the RECIPIENT's language, and the
// push is sent from Postgres via net.http_post. This client passes an id and a kind.
//
// WHY IT LOOKS LIKE THIS NOW. The previous version read the provider's profile from the
// client for a push_token. No RLS policy has ever permitted a customer to read a
// provider's row, so that read returned null, `prov?.push_token` was always undefined,
// and the push was never even attempted — for 70 days, silently, because "no rows" and
// "this provider has no token" are indistinguishable from here. It also meant `lang`
// always fell back to English, against a comment promising the recipient's language.
//
// The fix is not "read it with more permission" — that would put another user's push
// token in the client. It is: the client should never have known the token at all.
//
// CALL ORDER IS LOAD-BEARING: insert the question FIRST, then call this.
// The RPC authorizes by looking for that row; called before the insert it raises.
//
// 'appointment' left the kind vocabulary with 20261004; 'question' is the only kind the
// server now accepts, and notify_facility_owner raises on anything else.
//
// Still swallowed: a notification must never block the write that triggered it. What
// changed is that the failure is now COUNTED — push_log records every attempt, and
// scripts/check-notify-health.mjs reads it. Silence is no longer invisible.
export async function notifyFacilityOwner(facility, kind) {
  if (!facility?.id) return
  try {
    await supabase.rpc('notify_facility_owner', { p_facility_id: facility.id, p_kind: kind })
  } catch { /* non-critical — see above */ }
}

// Alert every admin. Same story: the client used to read admin profiles for push tokens,
// which RLS empties for a non-admin, so the `for` loop ran zero times and neither the
// push NOR the in-app row was written. No admin had been alerted to a content report or
// a provider application since those screens shipped.
//
// p_ref_id is the content id (content_report) or the facility id (facility_submission);
// notify_admins() authorizes against the caller's own report/claim row and composes the
// text itself.
export async function notifyAdmins(kind, refId) {
  if (!refId) return
  try {
    await supabase.rpc('notify_admins', { p_kind: kind, p_ref_id: refId })
  } catch { /* non-critical */ }
}
