-- ─── Slice 4 (piece 1) — places column guards (the deferred admin-only locks) ──
-- The provider_id / status / featured columns are admin-only. Deferred from Slice 1
-- (safe because MODULE_FLAGS.explore=false gated all user writes); now required as the
-- precondition for piece 2 (claims) and piece 3 (featured). Mirrors the facilities
-- guard PAIR (facilities_guard_insert + facilities_guard_update) — an UPDATE-only guard
-- is not enough:
--
--   INSERT is only covered by the RLS WITH CHECK (is_admin() OR (submitted_by=auth.uid()
--   AND status='pending')), which inspects ONLY submitted_by + status. A non-admin could
--   INSERT a place with featured_until='2099-…' or provider_id=<own uid> — born pending so
--   the RLS passes, then the moment an admin approves it (status='active', touching nothing
--   else) it goes live ALREADY featured / ALREADY claimed (unclaimable by the real owner,
--   and granting the submitter owner-level RLS + request_featured_place eligibility). The
--   BEFORE INSERT guard below coerces those columns to their born state.
--
-- Both functions are plain plpgsql (NOT security definer — matches facilities_guard_*);
-- everything they touch is schema-qualified (public.profiles) and the admin check is
-- INLINED (no unqualified user-function call, since there's no pinned search_path).
--
-- SET ROLE postgres: ALTER TABLE + CREATE TRIGGER on places need the table owner. ADD
-- COLUMN with no default is metadata-only. NOTIFY pgrst at the tail (new columns).

SET ROLE postgres;
BEGIN;

-- ─── 1. Featured columns (deferred from Slice 1). Admin-only; locked by the guards. ──
ALTER TABLE public.places
  ADD COLUMN IF NOT EXISTS featured_until        timestamptz,
  ADD COLUMN IF NOT EXISTS featured_requested_at timestamptz;

COMMENT ON COLUMN public.places.featured_until IS
  'Admin-only. Active-featured = featured_until > now(). Auto-expires, no cron. Backend state (iOS 3.1.1).';
COMMENT ON COLUMN public.places.featured_requested_at IS
  'Set only by request_featured_place() (Slice 4 piece 3). Pending featured request awaiting admin activation.';

-- ─── 2. INSERT guard — a place is BORN unclaimed / pending / unfeatured ──────────────
-- Coerces (does NOT raise) for non-admin submitters: those columns aren't in the submit
-- UI, so an error would confuse. Service role (seed/backfill, auth.uid() null) and admin
-- insert whatever they set.
CREATE OR REPLACE FUNCTION public.places_guard_insert()
 RETURNS trigger LANGUAGE plpgsql AS $function$
declare is_admin_user boolean;
begin
  if auth.uid() is null then return new; end if;
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin')
    into is_admin_user;
  if is_admin_user then return new; end if;

  new.provider_id           := null;
  new.featured_until        := null;
  new.featured_requested_at := null;
  new.status                := 'pending';
  return new;
end $function$;

DROP TRIGGER IF EXISTS places_guard_insert ON public.places;
CREATE TRIGGER places_guard_insert
  BEFORE INSERT ON public.places
  FOR EACH ROW EXECUTE FUNCTION public.places_guard_insert();

-- ─── 3. UPDATE guard — status / provider_id / featured_* admin-only (OLD vs NEW) ─────
-- Order mirrors facilities_guard_update: trusted-write GUC escape → service-role escape
-- → admin bypass → locks. The GUC (set by request_featured_place, piece 3) lets that RPC's
-- single featured_requested_at write through; it ships here, ahead of the RPC — harmless.
CREATE OR REPLACE FUNCTION public.places_guard_update()
 RETURNS trigger LANGUAGE plpgsql AS $function$
declare is_admin_user boolean;
begin
  if current_setting('app.trusted_place_write', true) = '1' then
    return new;
  end if;

  if auth.uid() is null then return new; end if;
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin')
    into is_admin_user;
  if is_admin_user then return new; end if;

  -- status lock closes the rejected→pending hole: a submitter cannot change status AT ALL.
  -- (See the Slice-5 backlog note — editable-after-reject must NOT try a direct status flip.)
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

DROP TRIGGER IF EXISTS places_guard_update ON public.places;
CREATE TRIGGER places_guard_update
  BEFORE UPDATE ON public.places
  FOR EACH ROW EXECUTE FUNCTION public.places_guard_update();

COMMIT;
RESET ROLE;

-- New columns → refresh PostgREST's cache (else 42703 on featured_* via the REST API).
NOTIFY pgrst, 'reload schema';

-- ── Verification (run after applying, Role = postgres) ───────────────────────
--   -- Columns exist, all NULL today:
--   SELECT count(*) FILTER (WHERE featured_until IS NULL) AS nf, count(*) FROM places;   -- nf == total
--   -- As a NON-admin submitter (own place), each of these must FAIL:
--   UPDATE places SET status='pending'         WHERE submitted_by=auth.uid() AND status='rejected'; -- status admin-only (the closed hole)
--   UPDATE places SET provider_id=auth.uid()   WHERE submitted_by=auth.uid();                       -- provider_id admin-only
--   UPDATE places SET featured_until=now()+interval '30 days' WHERE submitted_by=auth.uid();        -- featured_until admin-only
--   -- INSERT coercion — a non-admin insert with these set lands NULL/pending anyway:
--   INSERT INTO places (category,name,region,latitude,longitude,submitted_by,status,provider_id,featured_until)
--     VALUES ('cafe','X','kyrenia',35.3,33.3,auth.uid(),'active',auth.uid(),now()+interval '99 years')
--     RETURNING status, provider_id, featured_until;   -- → pending, NULL, NULL
--   -- A minor non-admin edit still works:
--   UPDATE places SET description_i18n = '{"en":"x"}'::jsonb WHERE submitted_by=auth.uid();          -- OK
--   -- Admin bypass: an admin may set any of them.
--
-- ── Rollback ────────────────────────────────────────────────────────────────
--   SET ROLE postgres;
--   BEGIN;
--   DROP TRIGGER  IF EXISTS places_guard_update ON public.places;
--   DROP TRIGGER  IF EXISTS places_guard_insert ON public.places;
--   DROP FUNCTION IF EXISTS public.places_guard_update();
--   DROP FUNCTION IF EXISTS public.places_guard_insert();
--   ALTER TABLE public.places DROP COLUMN IF EXISTS featured_requested_at, DROP COLUMN IF EXISTS featured_until;
--   COMMIT;
--   RESET ROLE;
--   NOTIFY pgrst, 'reload schema';
