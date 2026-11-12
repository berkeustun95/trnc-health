-- ─── 20261192 — a Bandabuliya notice knows which listing it is about ────────
--
-- WHAT IT DOES, IN PLAIN ENGLISH
-- notifications gains one nullable column, listing_id, pointing at marketplace_listings. When an admin
-- rejects a listing photo, the marketplace-photo-review function writes the seller's in-app notice with
-- the listing's id, so the app can open that listing when the notice is tapped (a push already does).
-- Every other notice leaves it NULL. If the listing is later hard-deleted (the nightly purge of 20261185,
-- or the seller's account deletion), the notice STAYS and listing_id becomes NULL: ON DELETE SET NULL.
--
-- WHO CAN READ / WRITE THE COLUMN
--   • Read: a signed-in user sees it on their OWN notification rows only (table-level SELECT for
--     authenticated, and the unchanged RLS "users read own notifications"). Nobody reads another user's.
--   • Write: no client. anon and authenticated hold no INSERT or UPDATE on it. The reason is 20261088:
--     it REVOKEd the table-level INSERT/UPDATE from both roles and granted UPDATE (read) alone, and a
--     column added afterwards inherits no column grant. This file changes NO grant and NO policy; it
--     asserts, by catalog, that the new column really is unwritable. Only service_role (the
--     marketplace-photo-review function) and the postgres-owned DEFINER writers can set it.
--   • RLS: untouched. The policy set is read at the top and compared at the end (derived, not a
--     remembered number); the failure message prints the policy names.
--
-- WHY ON DELETE SET NULL, AND WHY IT IS SAFE HERE (the 20261087 reasoning, re-checked)
-- A SET NULL is performed as an UPDATE, so any trigger or CHECK on notifications would see it: the
-- bug class that broke delete_own_account three times in 20261029. notifications has NO triggers
-- (asserted below, again by verify_schema) and its one CHECK (type) does not mention this column.
-- Account deletion removes a seller's listings and notifications by two cascades from profiles; in
-- either order the SET NULL finds the notice already gone or updates a row about to go, and nothing
-- raises (scripts/test-notifications-listing-id-sql.mjs runs both orders and the RPC path).
--
-- THE INDEX: partial (listing_id IS NOT NULL), as 20261087's. Almost every row is NULL. It also
-- serves the FK's lookup when the nightly purge deletes listings (without it each listing delete
-- would scan notifications).
--
-- OTHER WRITERS OF notifications: UNCHANGED, listing_id stays NULL for all of them. Read by grep of
-- supabase/migrations/*.sql for `INSERT INTO notifications` and supabase/functions/**/index.ts for
-- `.from('notifications').insert`: notify_new_message (20261184, the Student Hub / send_message /
-- send_listing_message notice), notify_facility_owner, notify_admins, insert_notification,
-- notify_module_waitlist and its module variants (20261104, 20261167), process_featured_expiring,
-- the booking lifecycle functions, the send-duty-notification and send-weekend-digest functions.
-- None of them names the column, so none needs a change.
--
-- RELEASE ORDER: this migration FIRST, then deploy marketplace-photo-review. The function is safe in
-- either order: if its insert carrying listing_id fails (column absent, schema cache stale, listing
-- deleted a moment before), it retries ONCE without listing_id, so the notice and the push are not
-- lost. Order still stays migration-first.
--
-- ROLLBACK (not part of this transaction; run by hand only if ever needed). Safe with the new
-- function live: the function retries without listing_id and logs notice_listing_id_dropped, so
-- redeploy/keep in mind the function: no notice is lost, the tapped notice just opens the list.
--   DROP INDEX IF EXISTS public.notifications_listing_id_idx;
--   ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_listing_id_fkey;
--   ALTER TABLE public.notifications DROP COLUMN IF EXISTS listing_id;
--   (then delete this file's row from schema_migrations_applied and run: NOTIFY pgrst, 'reload schema')
SET ROLE postgres;
BEGIN;

-- ─── 0. Refuse on a database this was not written against ────────────────────
DO $$
BEGIN
  IF to_regclass('public.notifications') IS NULL OR to_regclass('public.marketplace_listings') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: public.notifications or public.marketplace_listings is missing (20261183 not applied). Nothing applied.';
  END IF;
  IF to_regclass('public.schema_migrations_applied') IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.schema_migrations_applied WHERE filename = '20261088_notifications_lock_client_writes.sql') THEN
    RAISE EXCEPTION 'REFUSING: 20261088 is not recorded as applied; its column grants are what keep the new column out of clients'' hands. Nothing applied.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.notifications'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'REFUSING: notifications has triggers now; the ON DELETE SET NULL reasoning above assumed none. Nothing applied.';
  END IF;
  -- The policy set as found, kept (transaction-local) for the comparison at the end.
  PERFORM set_config('app.notif_policies_before',
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications')::text, true);
END $$;

-- ─── 1. The column, its FK and its index ─────────────────────────────────────
-- Add-if-absent, as 20261087 did: a leftover constraint of the wrong shape is caught by the
-- assertions below, not silently replaced.
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS listing_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.notifications'::regclass
                  AND conname = 'notifications_listing_id_fkey') THEN
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_listing_id_fkey
      FOREIGN KEY (listing_id) REFERENCES public.marketplace_listings(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS notifications_listing_id_idx
  ON public.notifications (listing_id) WHERE listing_id IS NOT NULL;
COMMENT ON COLUMN public.notifications.listing_id IS
  'The Bandabuliya listing a type=''marketplace'' photo-decision notice is about (20261192); NULL for every other kind and for rows whose listing is gone. Written only by marketplace-photo-review (service_role); never client-writable (20261088 grants).';

-- ─── 2. Assertions (catalog reads; every denial has its positive control) ────
DO $$
DECLARE
  v_n int; v_list text; v_att int;
  v_type text; v_notnull boolean;
BEGIN
  -- (a) the column: uuid, nullable
  SELECT a.attnum, format_type(a.atttypid, a.atttypmod), a.attnotnull INTO v_att, v_type, v_notnull
    FROM pg_attribute a WHERE a.attrelid = 'public.notifications'::regclass AND a.attname = 'listing_id' AND NOT a.attisdropped;
  IF v_att IS NULL THEN RAISE EXCEPTION 'notifications.listing_id is missing'; END IF;
  IF v_type IS DISTINCT FROM 'uuid' OR v_notnull THEN
    RAISE EXCEPTION 'notifications.listing_id must be nullable uuid, found % notnull=%', v_type, v_notnull;
  END IF;

  -- (b) the FK: on listing_id, to marketplace_listings(id), ON DELETE SET NULL (confdeltype n).
  --     Read from the catalog columns, not from pg_get_constraintdef (its rendering differs by version).
  SELECT count(*) INTO v_n FROM pg_constraint c
   WHERE c.conrelid = 'public.notifications'::regclass AND c.conname = 'notifications_listing_id_fkey'
     AND c.contype = 'f' AND c.confrelid = 'public.marketplace_listings'::regclass
     AND c.confdeltype = 'n' AND c.conkey = ARRAY[v_att]::smallint[]
     AND c.confkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.marketplace_listings'::regclass AND attname = 'id')]::smallint[];
  IF v_n IS DISTINCT FROM 1 THEN
    SELECT string_agg(conname || ' ' || pg_get_constraintdef(oid), ' | ') INTO v_list
      FROM pg_constraint WHERE conrelid = 'public.notifications'::regclass AND contype = 'f';
    RAISE EXCEPTION 'notifications_listing_id_fkey is not FK(listing_id) -> marketplace_listings(id) ON DELETE SET NULL; foreign keys on notifications: %', v_list;
  END IF;

  -- (c) the partial index
  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
                  WHERE i.indrelid = 'public.notifications'::regclass AND ic.relname = 'notifications_listing_id_idx'
                    AND i.indnatts = 1 AND i.indkey[0] = v_att AND i.indpred IS NOT NULL AND i.indisvalid) THEN
    RAISE EXCEPTION 'notifications_listing_id_idx is missing, not valid, or not a partial index on listing_id';
  END IF;

  -- (d) grants. Denials first, then the controls that prove the same question is not answering "no" to everyone.
  IF has_column_privilege('anon', 'public.notifications', 'listing_id', 'INSERT')
     OR has_column_privilege('anon', 'public.notifications', 'listing_id', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.notifications', 'listing_id', 'INSERT')
     OR has_column_privilege('authenticated', 'public.notifications', 'listing_id', 'UPDATE') THEN
    RAISE EXCEPTION 'a client role can write notifications.listing_id (anon/authenticated INSERT or UPDATE)';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.notifications', 'listing_id', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated cannot SELECT notifications.listing_id';
  END IF;
  IF NOT has_column_privilege('service_role', 'public.notifications', 'listing_id', 'INSERT') THEN
    RAISE EXCEPTION 'service_role cannot INSERT notifications.listing_id (the photo-review function writes it)';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.notifications', 'read', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated lost UPDATE on notifications.read (20261088 positive control)';
  END IF;
  IF has_column_privilege('authenticated', 'public.notifications', 'title', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated can UPDATE notifications.title; 20261088 is not in force';
  END IF;

  -- (e) the SET NULL premise: still no triggers
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.notifications'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'notifications has triggers; the ON DELETE SET NULL premise no longer holds';
  END IF;

  -- (f) the FULL policy set, unchanged. Printed in any failure. RLS must still be on.
  SELECT string_agg(policyname || ' ' || permissive || ' ' || cmd, ' | ' ORDER BY policyname), count(*)
    INTO v_list, v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications';
  IF v_n IS DISTINCT FROM current_setting('app.notif_policies_before', true)::int THEN
    RAISE EXCEPTION 'the notifications policy set changed during this file (before %, now %): %',
      current_setting('app.notif_policies_before', true), v_n, v_list;
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.notifications'::regclass) THEN
    RAISE EXCEPTION 'RLS is off on notifications';
  END IF;
END $$;

-- ─── ledger:stamp:begin ──────────────────────────────────────────────
-- Machine-generated by scripts/migration-ledger.mjs --stamp. Do not hand-edit.
-- The checksum is of THIS FILE WITH THIS BLOCK STRIPPED, which is what lets the file
-- carry its own stamp. Everything between the markers is excluded from the checksum
-- but still runs — so it may contain NOTHING but this INSERT. See the note in the
-- generator: anything else here would execute on paste while leaving no trace in the
-- hash, and the ledger would be attesting a file it never actually verified.
--
-- This is also the LAST statement inside BEGIN/COMMIT: if a paste is truncated before
-- it, COMMIT is never reached and nothing applies.
INSERT INTO public.schema_migrations_applied (filename, checksum)
VALUES ('20261192_notifications_listing_id.sql', 'c1b9c8131f48ce5f76d976b7537879c879953119cb1f728bb68e0ad06d795eb4')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;
NOTIFY pgrst, 'reload schema';
