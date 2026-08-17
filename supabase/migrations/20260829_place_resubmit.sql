-- ─── Slice 5 (piece D2) — editable-after-reject: resubmit_place() + guard amendment ──
-- A submitter whose place was REJECTED can edit it and put it back in the review queue.
-- The Slice-4 status lock (places_guard_update) deliberately blocks a submitter from
-- changing status AT ALL — so rejected→pending needs a dedicated, tightly-scoped path,
-- NOT a direct UPDATE and NOT the featured GUC (which 20260827 scoped to featured_requested_at
-- only, precisely so a future RPC could not reuse it to flip status).
--
-- This migration ships three things:
--   1. places.resubmit_count — a churn counter (admin-LOCKED; see the guard) that caps how
--      many times one place can be re-queued. CAP = 10.
--   2. places_guard_update — the live 20260827 body reproduced VERBATIM + two additions:
--        (a) a second scoped GUC branch, app.trusted_place_resubmit, that permits EXACTLY
--            rejected→pending (+ the content edits + the resubmit_count bump) and rejects any
--            provider_id / featured change ridden through it;
--        (b) resubmit_count added to the admin-only locks, so a direct REST update cannot
--            reset the counter and defeat the cap (a non-locked counter is not a guard —
--            anyone with the anon key + their JWT can update their own row).
--   3. resubmit_place() — the owner's only resubmit path (SECURITY DEFINER, search_path
--      pinned, sets the GUC, FOR UPDATE before validate to close the concurrent-admin race).
--
-- CONTENT FILTER: check_place_content fires BEFORE INSERT OR UPDATE and re-scans whenever
-- name / name_i18n / description_i18n change — so a blocked term in the RESUBMIT edit raises
-- here, before the row re-queues. (Category / region / lat-lng / photos are not content-scanned,
-- same as fresh submit — the filter never covered them.)
--
-- ── CAP=10 RECOVERY PATH (document so a future session does not rediscover it) ────────
-- At resubmit_count = 10 the place is STUCK rejected — the RPC refuses further resubmits and
-- there is no user-side escape. The admin rescue is Admin → PlacesTab: an admin edits/approves
-- the row directly (is_admin() bypasses both the counter check, which is in the RPC, and the
-- guard locks). The counter is not resettable by design; an admin approving the place ends the
-- churn. 10 is generous — hitting it is either abuse (10 rejections = ample evidence) or a user
-- who needs a human anyway.
--
-- SET ROLE postgres: ALTER TABLE places + CREATE OR REPLACE on a places trigger fn need the
-- table owner. ADD COLUMN with a default is metadata-only on PG11+. NOTIFY pgrst at the tail
-- (new column → else 42703 on resubmit_count through the REST API).

SET ROLE postgres;
BEGIN;

-- ─── 1. Churn counter (admin-locked by the guard below) ──────────────────────────────
ALTER TABLE public.places
  ADD COLUMN IF NOT EXISTS resubmit_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.places.resubmit_count IS
  'Times this place has been re-queued via resubmit_place(). Admin-locked (places_guard_update). Cap 10.';

-- ─── 2. Guard: 20260827 body VERBATIM + trusted_place_resubmit branch + resubmit_count lock ──
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

  -- Resubmit escape, SCOPED: resubmit_place() sets this GUC to flip a REJECTED place back to
  -- PENDING (+ content edits + the resubmit_count bump). Permit EXACTLY rejected→pending;
  -- reject any provider_id / featured change ridden through it. Same discipline as above.
  if current_setting('app.trusted_place_resubmit', true) = '1' then
    if not (old.status = 'rejected' and new.status = 'pending') then
      raise exception 'places: trusted resubmit may only flip rejected to pending';
    end if;
    if new.provider_id is distinct from old.provider_id
       or new.featured_until is distinct from old.featured_until
       or new.featured_requested_at is distinct from old.featured_requested_at then
      raise exception 'places: trusted resubmit may not touch provider_id or featured';
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
  -- resubmit_count is bumped ONLY by resubmit_place() (under the GUC above); lock it so a
  -- direct REST update cannot reset the churn counter and defeat the cap.
  if new.resubmit_count is distinct from old.resubmit_count then
    raise exception 'places: resubmit_count is set via resubmit_place'; end if;

  return new;
end $function$;

-- ─── 3. Owner resubmit RPC — the only rejected→pending path ───────────────────────────
-- Params mirror ExploreSubmitScreen's payload (the only fields the submit/edit form exposes).
-- cover_image_url is DERIVED from the first photo (self-consistent, not client-trusted).
CREATE OR REPLACE FUNCTION public.resubmit_place(
  p_place_id         uuid,
  p_category         text,
  p_name             text,
  p_description_i18n  jsonb,
  p_region           text,
  p_latitude         double precision,
  p_longitude        double precision,
  p_photos           text[],
  p_blue_flag        boolean,
  p_access_type      text
)
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
    RAISE EXCEPTION 'resubmit_place: authentication required';
  END IF;

  -- Category must be a real SUBMIT category. The column CHECK is only a shape regex, so a
  -- direct call could set an unknown slug that categoryToGroup() maps to null → the row would
  -- VANISH from every group view while sitting in the queue looking normal.
  -- ⚠ KEEP IN SYNC with SUBMITTABLE_CATEGORIES (constants/exploreCategories.js).
  IF p_category NOT IN ('beach','nature_scenic','castle_fortress','ancient_ruins','museum',
                        'religious_site','monument','cafe','restaurant','bakery','gym',
                        'sports_facility','pool','barber','print_shop','laundry') THEN
    RAISE EXCEPTION 'resubmit_place: unknown category %', p_category;
  END IF;

  -- Lock the row, THEN validate (closes the concurrent admin reject/approve race).
  SELECT * INTO v_row FROM places WHERE id = p_place_id FOR UPDATE;
  IF NOT FOUND OR v_row.submitted_by IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'resubmit_place: not your submission';
  END IF;
  IF v_row.status <> 'rejected' THEN
    RAISE EXCEPTION 'resubmit_place: only a rejected place can be resubmitted';
  END IF;
  IF v_row.resubmit_count >= 10 THEN
    RAISE EXCEPTION 'resubmit_place: limit reached';   -- fixed prefix → the form maps it to an i18n key
  END IF;

  -- Trust THIS write only: the guard permits rejected→pending + edits + resubmit_count under
  -- this transaction-local GUC (and nothing else). check_place_content re-scans the edited
  -- name/description on this UPDATE, so a blocked term raises before the row re-queues.
  PERFORM set_config('app.trusted_place_resubmit', '1', true);
  UPDATE places SET
    category         = p_category,
    name             = p_name,
    description_i18n  = p_description_i18n,
    region           = p_region,
    latitude         = p_latitude,
    longitude        = p_longitude,
    photos           = p_photos,
    cover_image_url  = p_photos[1],   -- derived (SQL arrays are 1-indexed); NULL when no photos
    -- Beach-only fields: coerce to NULL off-beach, so a category fix (beach→museum) cannot
    -- leave a stale blue_flag and a hand-crafted call cannot smuggle access_type onto a café.
    blue_flag        = CASE WHEN p_category = 'beach' THEN p_blue_flag   ELSE NULL END,
    access_type      = CASE WHEN p_category = 'beach' THEN p_access_type ELSE NULL END,
    status           = 'pending',
    rejection_reason = NULL,
    resubmit_count   = v_row.resubmit_count + 1
  WHERE id = p_place_id;
END;
$function$;

REVOKE ALL     ON FUNCTION public.resubmit_place(uuid,text,text,jsonb,text,double precision,double precision,text[],boolean,text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.resubmit_place(uuid,text,text,jsonb,text,double precision,double precision,text[],boolean,text) TO authenticated;

COMMIT;
RESET ROLE;

-- New column + RPC → refresh PostgREST's cache (else 42703 on resubmit_count / 404 on the RPC).
NOTIFY pgrst, 'reload schema';

-- ── Verification (run after applying, Role = postgres) ───────────────────────────────
--   -- Column + guard scoping (side-effect-free):
--   SELECT column_name FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='places' AND column_name='resubmit_count';  -- 1 row
--   SELECT pg_get_functiondef('public.places_guard_update()'::regprocedure) ILIKE '%trusted_place_resubmit%'; -- t
--
--   -- (a) resubmit a REJECTED own place (faked JWT — SQL editor runs as postgres). Rolled back:
--   BEGIN;
--     UPDATE places SET submitted_by='<test-uid>', status='rejected', rejection_reason='x', resubmit_count=0
--       WHERE id='<place-id>';                                            -- set up a rejected own place
--     SELECT set_config('request.jwt.claims',
--       json_build_object('sub','<test-uid>','role','authenticated')::text, true);
--     SELECT resubmit_place('<place-id>','cafe','Fixed name','{"en":"clean desc"}'::jsonb,
--                           'kyrenia', 35.3, 33.3, ARRAY['https://x/1.jpg'], NULL, NULL);
--     SELECT status, rejection_reason, resubmit_count, category, blue_flag FROM places WHERE id='<place-id>';
--       -- → pending, NULL, 1, cafe, NULL (blue_flag coerced off-beach).
--   ROLLBACK;
--   -- Deny paths (same faked JWT): a place whose submitted_by is a DIFFERENT uid → 'not your
--   -- submission'; status<>'rejected' → 'only a rejected place…'; resubmit_count>=10 → 'limit
--   -- reached'; p_category='zzz' → 'unknown category zzz'; a name/description with a blocked term
--   -- → BLOCKED_TERM (from check_place_content, before the row moves).
--
--   -- (b) Guard: a NON-admin owner CANNOT reset the counter or flip status directly:
--   UPDATE places SET resubmit_count=0 WHERE submitted_by=auth.uid();  -- FAILS (admin-only)
--   UPDATE places SET status='pending' WHERE submitted_by=auth.uid() AND status='rejected'; -- FAILS (admin-only)
--
-- ── Rollback ────────────────────────────────────────────────────────────────────────
--   SET ROLE postgres;
--   BEGIN;
--   DROP FUNCTION IF EXISTS public.resubmit_place(uuid,text,text,jsonb,text,double precision,double precision,text[],boolean,text);
--   -- restore places_guard_update() body from 20260827_places_featured_tier.sql (drops the
--   -- resubmit GUC branch + the resubmit_count lock).
--   ALTER TABLE public.places DROP COLUMN IF EXISTS resubmit_count;
--   COMMIT;
--   RESET ROLE;
--   NOTIFY pgrst, 'reload schema';
