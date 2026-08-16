-- ─── Slice 4 (piece 3) — Featured tier for places (behind EXPLORE_FEATURED_LIVE) ──
-- Paid promotion for a place listing: a featured place is PINNED to the top of its
-- directory with a "Featured" badge. Clones the facilities featured tier (20260808):
-- owner self-requests → MANUAL admin activation (payment arranged OFF-APP) → time-boxed
-- → auto-expires. "Actively featured" is DERIVED (featured_until > now()), so a place
-- drops out the moment its window passes — NO cron, NO status flip, NO sweep.
--
-- LISTING IS FREE FOREVER. Only the featured PLACEMENT is paid. This is NOT the
-- estate_agents subscription model — a place NEVER disappears for non-payment; when the
-- featured window lapses the place stays live, it just loses the pin/badge.
--
-- ANTI-STEERING (iOS 3.1.1): featured_until / featured_requested_at are BACKEND state.
-- No pricing, amount, bank details, or payment instruction in any screen. The consumer
-- browse select excludes featured_requested_at entirely (ExploreScreen ships that here).
--
-- COLUMNS ALREADY EXIST — featured_until + featured_requested_at were front-loaded in
-- piece 1 (20260825). This migration does NOT re-add them. It ships two things:
--   1. request_featured_place() — the owner's only write path (SECURITY DEFINER).
--   2. A behavior-only CREATE OR REPLACE of places_guard_update that SCOPES the
--      trusted-write GUC to featured_requested_at only (see below).
--
-- ─── The GUC scoping question (answered, not deferred) ───────────────────────────
-- request_featured_place writes featured_requested_at, which places_guard_update locks
-- admin-only. approve_place_claim (piece 2) got through via the ADMIN bypass — but a
-- featured request is OWNER-initiated, not admin, so that route is unavailable here. The
-- owner path uses the app.trusted_place_write GUC the guard early-returns on.
--
-- CAN the GUC be scoped to featured_requested_at only? YES. The guard has OLD and NEW in
-- scope, so the trusted-write branch can reject any change to the other three locked
-- columns before returning. Piece 1 shipped the GUC branch as a FULL bypass (return new)
-- with a comment describing the intent as "lets that RPC's single featured_requested_at
-- write through" — this migration converts that documented convention into an ENFORCED
-- invariant. Two reasons to enforce it rather than trust-by-convention:
--   • Defense in depth: request_featured_place is the ONLY GUC-setter today and writes
--     ONLY featured_requested_at (defense layer #1 — the sole-setter argument). Scoping
--     the guard is defense layer #2 — the guard itself now refuses a status/provider_id/
--     featured_until change even under the GUC.
--   • Slice-5 safety: the editable-after-reject path (backlog) may need its own GUC-set
--     RPC. Scoping here means such a future RPC physically CANNOT reuse this escape to
--     flip status (the rejected→pending hole piece 1 closed) or self-feature.
--
-- SET ROLE postgres: CREATE FUNCTION / CREATE OR REPLACE on a places trigger fn need the
-- table owner. NOTIFY pgrst at the tail so PostgREST exposes the new RPC.

SET ROLE postgres;
BEGIN;

-- ─── 1. Guard: SCOPE the trusted-write GUC to featured_requested_at only ─────────────
-- Body is the piece-1 places_guard_update() (20260825) reproduced verbatim, with ONE
-- change: the trusted-write branch now REJECTS a change to status / provider_id /
-- featured_until instead of blanket return new. The four admin-only locks below the GUC
-- branch are unchanged (the 0825 verify token still matches on 'featured_requested_at').
-- CREATE OR REPLACE keeps the existing trigger bound (no drop/create). NOT security
-- definer, everything schema-qualified — matches the live 0825 signature exactly.
CREATE OR REPLACE FUNCTION public.places_guard_update()
 RETURNS trigger LANGUAGE plpgsql AS $function$
declare is_admin_user boolean;
begin
  -- Trusted-write escape, SCOPED: request_featured_place() sets this GUC and writes ONLY
  -- featured_requested_at. Reject any attempt to ride the GUC into the other three locks
  -- (a future GUC-setting RPC cannot self-feature or flip status/provider_id through here).
  if current_setting('app.trusted_place_write', true) = '1' then
    if new.status is distinct from old.status
       or new.provider_id is distinct from old.provider_id
       or new.featured_until is distinct from old.featured_until then
      raise exception 'places: trusted write may only set featured_requested_at';
    end if;
    return new;
  end if;

  if auth.uid() is null then return new; end if;
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin')
    into is_admin_user;
  if is_admin_user then return new; end if;

  -- status lock closes the rejected→pending hole: a submitter cannot change status AT ALL.
  if new.status is distinct from old.status then
    raise exception 'places: status is admin-only'; end if;
  if new.provider_id is distinct from old.provider_id then
    raise exception 'places: provider_id is admin-only (set via the claim approve flow)'; end if;
  if new.featured_until is distinct from old.featured_until then
    raise exception 'places: featured_until is admin-only'; end if;
  if new.featured_requested_at is distinct from old.featured_requested_at then
    raise exception 'places: featured_requested_at is set via request_featured_place'; end if;

  return new;
end $function$;

-- ─── 2. Owner request RPC — the only owner write path ────────────────────────────────
-- Sets featured_requested_at = now() on the owner's own LIVE place. Payment is arranged
-- off-app afterwards; this RPC does NOT touch featured_until (admin-only). Idempotent: a
-- repeat request while one is pending is a silent no-op.
-- Live predicate = status='active' AND hidden_at IS NULL. places has no is_public column
-- (unlike facilities); hidden_at IS NULL is the places-equivalent — a moderation-hidden
-- place is not publicly visible, so it must not be featurable.
CREATE OR REPLACE FUNCTION public.request_featured_place(p_place_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row places%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR is_anonymous_session() THEN
    RAISE EXCEPTION 'request_featured_place: authentication required';
  END IF;

  SELECT * INTO v_row FROM places WHERE id = p_place_id;
  IF NOT FOUND OR v_row.provider_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'request_featured_place: not your place';
  END IF;
  IF v_row.status <> 'active' OR v_row.hidden_at IS NOT NULL THEN
    RAISE EXCEPTION 'request_featured_place: place must be live';
  END IF;
  IF v_row.featured_until IS NOT NULL AND v_row.featured_until > now() THEN
    RAISE EXCEPTION 'request_featured_place: already featured';
  END IF;
  IF v_row.featured_requested_at IS NOT NULL THEN
    RETURN;  -- request already pending → no-op
  END IF;

  -- Trust THIS write only: the guard early-returns on this transaction-local GUC and (as
  -- of this migration) permits only featured_requested_at to move under it.
  PERFORM set_config('app.trusted_place_write', '1', true);
  UPDATE places SET featured_requested_at = now() WHERE id = p_place_id;
END;
$function$;

REVOKE ALL     ON FUNCTION public.request_featured_place(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.request_featured_place(uuid) TO authenticated;

COMMIT;
RESET ROLE;

-- New RPC → refresh PostgREST's cache so /rpc/request_featured_place resolves.
NOTIFY pgrst, 'reload schema';

-- ── ADMIN ACTIVATION (manual SQL — there is no FeaturedTab for places this slice) ────
-- After payment is arranged off-app, an admin activates a pending request by pinning a
-- window and clearing the request. Run as admin (or postgres); the admin bypass / service
-- escape lets featured_until through. Pin for 30 days:
--   UPDATE places
--      SET featured_until = now() + interval '30 days', featured_requested_at = NULL
--    WHERE id = '<place-id>';
-- Extend a still-live window: base off featured_until instead of now(). End early:
--   UPDATE places SET featured_until = now(), featured_requested_at = NULL WHERE id = '<place-id>';
-- Dismiss a request without featuring:
--   UPDATE places SET featured_requested_at = NULL WHERE id = '<place-id>';

-- ── VERIFICATION (run after applying, Role = postgres) ───────────────────────────────
--   -- (a) Owner RPC — SQL editor runs as postgres (auth.uid() NULL) so the happy path
--   --     needs a faked JWT. There is NO in-app owner caller until the Slice-5 CTA; this
--   --     block is the only way to exercise the success path today. All writes rolled back:
--   BEGIN;
--     UPDATE places SET provider_id='<test-uid>', status='active', hidden_at=NULL,
--                       featured_until=NULL, featured_requested_at=NULL
--       WHERE id='<place-id>';                                        -- as postgres, sets up an owned live place
--     SELECT set_config('request.jwt.claims',
--       json_build_object('sub','<test-uid>','role','authenticated')::text, true);  -- become the owner
--     SELECT request_featured_place('<place-id>');                    -- succeeds
--     SELECT featured_requested_at, featured_until FROM places WHERE id='<place-id>';
--       -- → featured_requested_at set to now(), featured_until still NULL.
--   ROLLBACK;
--   -- Deny paths (each RAISES under the same faked JWT): a place whose provider_id is a
--   -- DIFFERENT uid → 'not your place'; status<>'active' or hidden_at set → 'place must be
--   -- live'; featured_until in the future → 'already featured'. A 2nd call while a request
--   -- is pending is a silent no-op (RETURN).
--
--   -- (b) Guard scoping — as a NON-admin owner, featured_until stays admin-only, and the
--   --     GUC cannot be ridden into the other locks. Direct (non-RPC) featured writes FAIL:
--   UPDATE places SET featured_until = now() + interval '30 days' WHERE provider_id=auth.uid(); -- admin-only
--   UPDATE places SET featured_requested_at = now()               WHERE provider_id=auth.uid(); -- set via RPC
--   -- A minor owner edit still works:
--   UPDATE places SET description_i18n='{"en":"x"}'::jsonb WHERE provider_id=auth.uid();          -- OK
--   -- Guard scoping token: the function body now contains the scoped-bypass raise string.
--   SELECT pg_get_functiondef('public.places_guard_update()'::regprocedure) ILIKE '%trusted write may only%'; -- t

-- ── Rollback ────────────────────────────────────────────────────────────────────────
--   SET ROLE postgres;
--   BEGIN;
--   DROP FUNCTION IF EXISTS public.request_featured_place(uuid);
--   -- then restore places_guard_update() body from 20260825_places_column_guards.sql
--   -- (the full-bypass GUC branch). Columns stay — they belong to piece 1.
--   COMMIT;
--   RESET ROLE;
--   NOTIFY pgrst, 'reload schema';
