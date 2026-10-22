-- ═══════════════════════════════════════════════════════════════════════════
-- 20261132 — Yeme-İçme: server-marked TEST orders (eatery_orders.is_test), deleted after 24 hours
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Orders made from the ADA Preview app, or by a listed tester during live checks, are TEST orders. The server
-- decides; the app sends nothing new. A test order never counts as real: it is excluded from stats, never counts
-- toward the per-partner guest cap (so testing can never block a real customer) and is deleted automatically
-- 24 hours after it was made. Real orders are unchanged (30-day retention).
--
-- (1) eatery_orders.is_test boolean NOT NULL DEFAULT false (every existing row stays false). No index: the table
--     is tiny (5 orders per user per hour, 30 days of retention) and the hourly delete below is a sequential scan
--     of a few thousand rows at most; a partial index would be one more object to register for nothing.
-- (2) public.order_testers (uid_sha256 text PRIMARY KEY, added_at, note): the people whose signed-in orders are test
--     orders, stored as a FINGERPRINT (lowercase hex SHA-256 of the lowercase hyphenated uuid text), never the user id:
--     this repository is public and so are workflow logs, and the raw id of a real account must not appear in either.
--     There is NO user_id column. RLS ON, ZERO policies, ALL privileges revoked from PUBLIC, anon and authenticated.
--     It starts EMPTY (a migration cannot carry a tester; a later one-row data migration adds Berke, see the block
--     "ADDING A TESTER" below). No foreign key to auth.users (there is no uuid column to reference, and an FK ...
--     ON DELETE SET NULL broke account deletion three times in this project): a deleted account's fingerprint simply
--     lingers until someone removes it, which marks nothing (a deleted user cannot call).
--     Placed in `public` as designed; the 20261120 preview-key store lives in schema `private` (not API-exposed).
--     Here the table has no client privilege at all, so PostgREST cannot read it either way.
-- (3) public.is_order_tester(p_uid): SECURITY DEFINER, search_path pinned to '', owner postgres, EXECUTE revoked
--     from PUBLIC, anon and authenticated. Only create_eatery_order (owner postgres) calls it. False for a NULL
--     uid and for an anonymous (guest) session: a guest can never be a tester even if its fingerprint is listed.
--     It fingerprints p_uid with the SAME built-in form 20261120 uses for the Preview key,
--     encode(pg_catalog.sha256(pg_catalog.convert_to(p_uid::text, 'UTF8')), 'hex') (no pgcrypto), and looks that up.
-- (4) create_eatery_order: IDENTICAL to 20261125 except (a) v_test := public.is_previewer() OR
--     public.is_order_tester(v_uid), server-derived, NO new parameter (a client cannot send is_test, and cannot
--     clear it); (b) the per-partner guest cap now reads `created_as_guest AND NOT is_test`; (c) the INSERT stores
--     is_test. The per-user 5-per-hour count still counts ALL orders including test orders (abuse protection).
--     The app-facing return value is unchanged. scripts/test-eatery-orders-is-test-sql.mjs proves "identical
--     except" by diffing pg_get_functiondef after 20261125 and after this file.
-- (5) verify_eatery_order: IDENTICAL except the returned object gains 'is_test' (additive; the Worker reads only
--     status). Everything else about who can call it and what it hides is unchanged.
-- (6) Retention: the cron job 'eatery-orders-retention' is re-scheduled HOURLY at minute 40 ('40 * * * *'). At
--     '40 3 * * *' a test order could live up to ~47 hours, which would break "deleted after 24 hours". The 30-day
--     rule for real orders is exactly as before (an hourly run is harmless for it). No other job runs at :40.
--
-- ─── ADDING A TESTER (a later one-row DATA migration; this file adds nobody) ─
--   The canonical text of the uid is the lowercase hyphenated uuid. Compute the fingerprint PRIVATELY, never in a
--   committed file or a workflow log, with either of:
--     SELECT encode(sha256(convert_to('<uuid>'::uuid::text, 'UTF8')), 'hex');      -- in the SQL editor, one statement
--     printf %s '<lowercase uuid>' | shasum -a 256                                 -- on the Mac (lowercase hex, 64 chars)
--   then the data migration is exactly:
--     INSERT INTO public.order_testers (uid_sha256, note) VALUES ('<64 lowercase hex>', 'Berke live checks') ON CONFLICT DO NOTHING;
--   (the placeholders above are placeholders: no real value belongs in this repository). The CHECK rejects anything
--   that is not 64 lowercase hex characters, so a raw uuid pasted by mistake fails instead of being stored.
--   Honest limit: the hash of a uuid is NOT secret-grade. uuids are not guessable, but the hash is a stable identifier
--   of that account; it only keeps the raw id out of the public repository and its logs.
--
-- ─── WHO CAN READ / WRITE WHAT ──────────────────────────────────────────────
--   • order_testers: nobody through the API (and it holds fingerprints, not user ids). Only postgres (this migration, and is_order_tester via DEFINER) and
--     service_role touch it; a tester is added/removed by a GitHub Actions workflow or the SQL editor, never by a
--     client. No policy exists, so even a privilege granted back by mistake would show zero rows.
--   • eatery_orders.is_test: same as the rest of eatery_orders (no client role can read or write the table). The
--     only client-visible effect is the extra 'is_test' key in verify_eatery_order, readable by anyone holding
--     the order code (the partner page); it reveals nothing beyond "this was a test".
--   • create_eatery_order / verify_eatery_order: grants exactly as 20261125 (create: authenticated only; verify:
--     anon + authenticated). is_order_tester: no client EXECUTE.
--
-- PROOF (inside this file, after the change): column NOT NULL DEFAULT false and existing rows false (counted
-- before the ALTER), both function bodies contain what they must and the per-user count does NOT contain the
-- test exclusion, create has exactly three arguments (none named *test*), grants, order_testers locked down
-- (RLS on, 0 policies, no privilege), exactly one active cron job with the new schedule and command, and
-- behaviour probes in a rolled-back sentinel: Preview key -> test; no key -> real; listed tester (seeded BY FINGERPRINT) -> test;
-- listed but anonymous -> real; a row with another uuid's fingerprint -> that user real; a raw uuid inserted -> 23514; authenticated calling is_order_tester -> 42501 (with positive control); a named
-- p_is_test argument -> 42883; 60 guest TEST orders do not block a guest while 60 guest REAL orders do; five
-- test orders by one user block the sixth; the retention command run as stored deletes a >24 h test order and a
-- >30 d real order and keeps a <24 h test order and a <30 d real order. All rows end as they began.
--
-- Apply: gh workflow run supabase-migrate -f file=20261132_eatery_orders_is_test.sql (dry), then -f apply=true
-- (Berke approves production-db). ADDs a column ⇒ ends with NOTIFY pgrst (after COMMIT and RESET ROLE).
-- Re-runnable: the second apply accepts the already-changed bodies.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── Pre-state (abort before changing anything) + capture ───────────────────
DO $$
DECLARE
  v_def text; v_done boolean; v_n int; v_md5 text; v_had_col boolean; v_had_tbl boolean; v_testers int := 0;
BEGIN
  IF to_regclass('public.schema_migrations_applied') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.schema_migrations_applied WHERE filename = '20261125_eatery_orders.sql') THEN
    RAISE EXCEPTION 'pre-state: 20261125_eatery_orders.sql is not in the ledger';
  END IF;
  IF to_regclass('public.eatery_orders') IS NULL OR to_regprocedure('public.create_eatery_order(uuid,jsonb,text)') IS NULL
     OR to_regprocedure('public.verify_eatery_order(text)') IS NULL THEN
    RAISE EXCEPTION 'pre-state: eatery_orders / create_eatery_order / verify_eatery_order missing';
  END IF;
  IF to_regprocedure('public.is_previewer()') IS NULL OR to_regprocedure('public.is_anonymous_session()') IS NULL
     OR to_regclass('private.preview_key_hashes') IS NULL THEN
    RAISE EXCEPTION 'pre-state: is_previewer() / is_anonymous_session() / private.preview_key_hashes missing';
  END IF;
  IF to_regnamespace('cron') IS NULL OR to_regclass('cron.job') IS NULL
     OR to_regprocedure('cron.schedule(text,text,text)') IS NULL OR to_regprocedure('cron.unschedule(text)') IS NULL THEN
    RAISE EXCEPTION 'pre-state: pg_cron is not installed';
  END IF;

  v_done := EXISTS (SELECT 1 FROM public.schema_migrations_applied WHERE filename = '20261132_eatery_orders_is_test.sql');
  v_def := pg_get_functiondef(to_regprocedure('public.create_eatery_order(uuid,jsonb,text)'));
  IF NOT v_done AND position('INSERT INTO public.eatery_orders (code, partner_id, lines, total, currency, created_by, client_id, created_as_guest)' IN v_def) = 0 THEN
    RAISE EXCEPTION 'pre-state: create_eatery_order is not the 20261125 body (INSERT anchor missing). Nothing applied.';
  END IF;
  IF v_done AND position('created_by, client_id, created_as_guest, is_test)' IN v_def) = 0 THEN
    RAISE EXCEPTION 'pre-state: 20261132 is in the ledger but create_eatery_order does not insert is_test';
  END IF;

  -- Freeze the table for the duration, then capture what must not change: count and md5 of every id.
  LOCK TABLE public.eatery_orders IN ACCESS EXCLUSIVE MODE;
  SELECT count(*), COALESCE(md5(string_agg(id::text, ',' ORDER BY id)), '') INTO v_n, v_md5 FROM public.eatery_orders;
  v_had_col := EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.eatery_orders'::regclass AND attname = 'is_test' AND NOT attisdropped);
  v_had_tbl := to_regclass('public.order_testers') IS NOT NULL;
  IF v_had_tbl THEN EXECUTE 'SELECT count(*) FROM public.order_testers' INTO v_testers; END IF;
  PERFORM set_config('ada.m1132_pre', concat_ws('|', v_n, v_md5, v_had_col, v_had_tbl, v_testers), true);
  RAISE NOTICE 'pre-state ok: % orders captured (md5 %), is_test present %, order_testers present % (% rows)', v_n, v_md5, v_had_col, v_had_tbl, v_testers;
END $$;

-- ─── (1) eatery_orders.is_test ──────────────────────────────────────────────
ALTER TABLE public.eatery_orders ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.eatery_orders.is_test IS
  'true = made from the ADA Preview app (key header) or by a listed order tester; set by create_eatery_order only. Never counts as real, never counts toward the partner guest cap, deleted by eatery-orders-retention after 24 hours. 20261132.';

-- ─── (2) order_testers ──────────────────────────────────────────────────────
-- Fingerprints, not user ids (public repo); no FK to auth.users (none possible, and FKs broke account deletion before).
CREATE TABLE IF NOT EXISTS public.order_testers (
  uid_sha256 text        NOT NULL,
  added_at   timestamptz NOT NULL DEFAULT now(),
  note       text,
  CONSTRAINT order_testers_pkey PRIMARY KEY (uid_sha256),
  CONSTRAINT order_testers_uid_sha256_check CHECK (uid_sha256 ~ '^[0-9a-f]{64}$')
);
ALTER TABLE public.order_testers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.order_testers FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.order_testers IS
  'Fingerprints (lowercase hex SHA-256 of the lowercase uuid text) of users whose signed-in orders are TEST orders (create_eatery_order -> is_test). Never a user id. RLS on, ZERO policies, all client privileges revoked; read only by is_order_tester (DEFINER). No FK. Starts empty. 20261132.';

-- ─── (3) is_order_tester ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_order_tester(p_uid uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = ''
AS $fn$
  SELECT COALESCE(
    p_uid IS NOT NULL
    AND NOT public.is_anonymous_session()
    AND EXISTS (SELECT 1 FROM public.order_testers t
                 WHERE t.uid_sha256 = encode(pg_catalog.sha256(pg_catalog.convert_to(p_uid::text, 'UTF8')), 'hex')),
    false)
$fn$;
ALTER FUNCTION public.is_order_tester(uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.is_order_tester(uuid) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.is_order_tester(uuid) IS
  'true when the SHA-256 fingerprint of p_uid is listed in order_testers AND the session is not anonymous. Internal helper of create_eatery_order: no client EXECUTE. 20261132.';

-- ─── (4) create_eatery_order: 20261125 body + v_test ────────────────────────
CREATE OR REPLACE FUNCTION public.create_eatery_order(p_partner uuid, p_items jsonb, p_client_id text DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
DECLARE
  c_alpha constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_uid     uuid := auth.uid();
  v_partner record;
  v_found   int;
  v_lines   jsonb;
  v_total   numeric;
  v_ncur    int;
  v_cur     text;
  v_user_n  int;
  v_part_n  int;
  v_guest   boolean := public.is_anonymous_session();
  v_dob     date;
  v_gate    text;
  v_code    text;
  v_b       bytea;
  v_bits    bigint;
  v_i       int;
  v_try     int := 0;
  v_expires timestamptz;
  v_done    boolean := false;
  v_test    boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_authenticated';
  END IF;

  -- 20261132: a TEST order is decided by the server, never by a parameter: the ADA Preview app (its key header) or a
  -- listed order tester. Test orders are deleted after 24 h and never count toward the partner cap.
  v_test := public.is_previewer() OR public.is_order_tester(v_uid);

  SELECT p.id, p.is_active, p.order_requires_account, p.adult_only INTO v_partner
    FROM public.eatery_partners p WHERE p.id = p_partner;
  IF NOT FOUND OR NOT (v_partner.is_active OR public.is_previewer()) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'partner_unavailable';
  END IF;

  IF v_partner.adult_only THEN
    IF v_guest THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'adult_only', DETAIL = 'guest';
    END IF;
    SELECT pr.date_of_birth INTO v_dob FROM public.profiles pr WHERE pr.id = v_uid;
    v_gate := public.eatery_order_age_gate(v_dob, (now() AT TIME ZONE 'Europe/Istanbul')::date);
    IF v_gate IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'adult_only', DETAIL = v_gate;
    END IF;
  END IF;

  IF v_partner.order_requires_account AND public.is_anonymous_session() THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'order_requires_account';
  END IF;

  IF p_client_id IS NOT NULL AND p_client_id !~ '^[A-Za-z0-9_-]{8,64}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_client_id';
  END IF;

  -- Shape of p_items: 1..30 objects {item_id: integer, qty: integer 1..99}, no repeated item_id. CASE guards every cast.
  IF p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_items';
  END IF;
  IF EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_items) e
        WHERE jsonb_typeof(e) IS DISTINCT FROM 'object'
           OR jsonb_typeof(e -> 'item_id') IS DISTINCT FROM 'number'
           OR jsonb_typeof(e -> 'qty') IS DISTINCT FROM 'number'
           OR (e ->> 'item_id') !~ '^[0-9]{1,15}$'
           OR CASE WHEN (e ->> 'qty') ~ '^[0-9]{1,2}$' THEN (e ->> 'qty')::int NOT BETWEEN 1 AND 99 ELSE true END)
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_items';
  END IF;
  IF (SELECT count(DISTINCT (e ->> 'item_id')::bigint) FROM jsonb_array_elements(p_items) e) IS DISTINCT FROM jsonb_array_length(p_items) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_items';
  END IF;

  -- Lines come from the DATABASE: name, price and currency of this partner's available, priced items. Any
  -- price the client sent is never read.
  SELECT count(*),
         jsonb_agg(jsonb_build_object('item_id', m.id, 'name', m.name, 'qty', x.qty, 'unit_price', m.price) ORDER BY x.ord),
         sum(x.qty * m.price),
         count(DISTINCT m.currency),
         min(m.currency)
    INTO v_found, v_lines, v_total, v_ncur, v_cur
    FROM (SELECT (e ->> 'item_id')::bigint AS item_id, (e ->> 'qty')::int AS qty, t.ord
            FROM jsonb_array_elements(p_items) WITH ORDINALITY AS t(e, ord)) x
    JOIN public.eatery_menu_items m
      ON m.id = x.item_id AND m.partner_id = p_partner AND m.is_available AND m.price IS NOT NULL;
  IF v_found IS DISTINCT FROM jsonb_array_length(p_items) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'item_unavailable';
  END IF;
  IF v_ncur IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'mixed_currency';
  END IF;
  v_total := round(v_total, 2);
  IF v_total > 99999999.99 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_items';
  END IF;

  -- Rate limits. Two transaction-scoped advisory locks (always user first, then partner) serialise concurrent
  -- creates of the same user / same partner, so the count below cannot be raced past the cap.
  PERFORM pg_advisory_xact_lock(hashtext('eatery_orders:user:' || v_uid::text));
  PERFORM pg_advisory_xact_lock(hashtext('eatery_orders:partner:' || p_partner::text));
  SELECT count(*) INTO v_user_n FROM public.eatery_orders WHERE created_by = v_uid AND created_at > now() - interval '1 hour';
  IF v_user_n >= 5 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rate_limited', DETAIL = 'user';
  END IF;
  SELECT count(*) INTO v_part_n FROM public.eatery_orders WHERE partner_id = p_partner AND created_as_guest AND NOT is_test AND created_at > now() - interval '1 hour';
  IF v_guest AND v_part_n >= 60 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rate_limited', DETAIL = 'partner';
  END IF;

  -- Code: 8 x 5 bits from bytes 0-3 and 10 of gen_random_uuid(); retry on a collision.
  WHILE NOT v_done AND v_try < 5 LOOP
    v_try := v_try + 1;
    v_b := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    v_bits := ((((get_byte(v_b, 0)::bigint * 256 + get_byte(v_b, 1)) * 256 + get_byte(v_b, 2)) * 256 + get_byte(v_b, 3)) * 256 + get_byte(v_b, 10));
    v_code := '';
    FOR v_i IN 0..7 LOOP
      v_code := v_code || substr(c_alpha, ((v_bits >> (5 * (7 - v_i))) & 31)::int + 1, 1);
    END LOOP;
    BEGIN
      INSERT INTO public.eatery_orders (code, partner_id, lines, total, currency, created_by, client_id, created_as_guest, is_test)
      VALUES (v_code, p_partner, v_lines, v_total, v_cur, v_uid, p_client_id, v_guest, v_test)
      RETURNING expires_at INTO v_expires;
      v_done := true;
    EXCEPTION WHEN unique_violation THEN
      v_done := false;
    END;
  END LOOP;
  IF NOT v_done THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'code_generation_failed';
  END IF;

  RETURN jsonb_build_object('code', v_code, 'lines', v_lines, 'total', v_total, 'currency', v_cur, 'expires_at', v_expires);
END;
$fn$;
ALTER FUNCTION public.create_eatery_order(uuid, jsonb, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.create_eatery_order(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.create_eatery_order(uuid, jsonb, text) TO authenticated;
COMMENT ON FUNCTION public.create_eatery_order(uuid, jsonb, text) IS
  'Records a WhatsApp order and returns {code, lines, total, currency, expires_at}. Prices come from eatery_menu_items, never the client. authenticated only (guests included unless the partner sets order_requires_account). 5/user/h counts ALL orders including test orders; 60/partner/h counts guest-session orders that are NOT test orders. is_test is derived by the server (ADA Preview key header, or a listed order tester who is not a guest), never a parameter; test orders are deleted after 24 h. Errors: SQLSTATE P0001, MESSAGE = not_authenticated | partner_unavailable | adult_only (DETAIL guest/no_dob/under_18) | order_requires_account | invalid_items | invalid_client_id | item_unavailable | mixed_currency | rate_limited | code_generation_failed. 20261132.';

-- ─── (5) verify_eatery_order: 20261125 body + 'is_test' key ────────────────
CREATE OR REPLACE FUNCTION public.verify_eatery_order(p_code text)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_c    text;
  v_o    public.eatery_orders%ROWTYPE;
  v_name text;
  v_ls   jsonb;
BEGIN
  IF p_code IS NULL OR length(p_code) > 40 THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  v_c := upper(regexp_replace(p_code, '[-\s]', '', 'g'));
  IF v_c !~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$' THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  SELECT * INTO v_o FROM public.eatery_orders WHERE code = v_c FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  UPDATE public.eatery_orders
     SET first_viewed_at = COALESCE(first_viewed_at, now()), view_count = view_count + 1
   WHERE id = v_o.id;

  SELECT name INTO v_name FROM public.eatery_partners WHERE id = v_o.partner_id;
  SELECT jsonb_agg(jsonb_build_object('name', l -> 'name', 'qty', l -> 'qty', 'unit_price', l -> 'unit_price') ORDER BY t.ord)
    INTO v_ls FROM jsonb_array_elements(v_o.lines) WITH ORDINALITY AS t(l, ord);

  RETURN jsonb_build_object(
    'status',                 CASE WHEN v_o.expires_at <= now() THEN 'expired' ELSE 'ok' END,
    'partner_name',           v_name,
    'created_at',             v_o.created_at,
    'expires_at',             v_o.expires_at,
    'lines',                  v_ls,
    'total',                  v_o.total,
    'currency',               v_o.currency,
    'first_viewed_at_before', v_o.first_viewed_at,
    'view_count_before',      v_o.view_count,
    'is_test',                v_o.is_test);
END;
$fn$;
ALTER FUNCTION public.verify_eatery_order(text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.verify_eatery_order(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.verify_eatery_order(text) TO anon, authenticated;
COMMENT ON FUNCTION public.verify_eatery_order(text) IS
  'Partner-side check of a WhatsApp order code (anon + authenticated). Returns {status ok|expired|not_found, partner_name, created_at, expires_at, lines[name,qty,unit_price], total, currency, first_viewed_at_before, view_count_before, is_test} and counts the call as a view. Never returns created_by, client_id or item ids. 20261132.';

-- ─── (6) Retention: 30 days for real orders, 24 hours for test orders, hourly ───
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'eatery-orders-retention') THEN
    PERFORM cron.unschedule('eatery-orders-retention');
  END IF;
END $$;
SELECT cron.schedule('eatery-orders-retention', '40 * * * *',
  $$DELETE FROM public.eatery_orders WHERE created_at < now() - interval '30 days' OR (is_test AND created_at < now() - interval '24 hours')$$);

-- ─── Structure proof (read from the live catalogs) ──────────────────────────
DO $$
DECLARE
  v_pre text[] := string_to_array(current_setting('ada.m1132_pre'), '|');
  v_n int; v_s text; v_def text; v_names text[]; v_fn record; v_rls boolean; v_md5 text; v_cnt int; v_perm text;
BEGIN
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'eatery_orders' AND column_name = 'is_test'
     AND data_type = 'boolean' AND is_nullable = 'NO' AND column_default = 'false';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'eatery_orders.is_test is not boolean NOT NULL DEFAULT false'; END IF;
  SELECT count(*), COALESCE(md5(string_agg(id::text, ',' ORDER BY id)), '') INTO v_cnt, v_md5 FROM public.eatery_orders;
  IF v_cnt::text IS DISTINCT FROM v_pre[1] OR v_md5 IS DISTINCT FROM v_pre[2] THEN
    RAISE EXCEPTION 'eatery_orders rows changed during the ALTER: % rows md5 % (before: % rows md5 %)', v_cnt, v_md5, v_pre[1], v_pre[2];
  END IF;
  IF v_pre[3] IS DISTINCT FROM 'true' THEN
    SELECT count(*) INTO v_n FROM public.eatery_orders WHERE is_test IS DISTINCT FROM false;
    IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION '% pre-existing order(s) are not is_test = false', v_n; END IF;
    RAISE NOTICE 'is_test: all % pre-existing rows are false', v_cnt;
  ELSE
    RAISE NOTICE 'is_test: column already existed (re-run): the "pre-existing rows are false" check is skipped, count and md5 of ids unchanged (% rows)', v_cnt;
  END IF;

  -- create_eatery_order: derivation + partner cap excludes tests + per-user count does NOT + insert stores it.
  v_def := pg_get_functiondef('public.create_eatery_order(uuid,jsonb,text)'::regprocedure);
  IF v_def NOT LIKE '%v_test := public.is_previewer() OR public.is_order_tester(v_uid);%'
     OR v_def NOT LIKE '%WHERE partner_id = p_partner AND created_as_guest AND NOT is_test AND created_at > now()%'
     OR v_def NOT LIKE '%WHERE created_by = v_uid AND created_at > now() - interval ''1 hour'';%'
     OR v_def LIKE '%created_by = v_uid AND NOT is_test%' OR v_def LIKE '%created_by = v_uid AND created_as_guest%'
     OR v_def NOT LIKE '%client_id, created_as_guest, is_test)%' OR v_def NOT LIKE '%p_client_id, v_guest, v_test)%' THEN
    RAISE EXCEPTION 'create_eatery_order body is not as designed (derivation / partner-cap exclusion / per-user count counting ALL / insert)';
  END IF;
  SELECT proargnames INTO v_names FROM pg_proc WHERE oid = 'public.create_eatery_order(uuid,jsonb,text)'::regprocedure;
  IF v_names IS DISTINCT FROM ARRAY['p_partner','p_items','p_client_id']::text[] OR EXISTS (SELECT 1 FROM unnest(v_names) a WHERE a ILIKE '%test%') THEN
    RAISE EXCEPTION 'create_eatery_order argument names are %, want exactly p_partner, p_items, p_client_id', v_names;
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'create_eatery_order';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'create_eatery_order has % overloads (want 1)', v_n; END IF;
  v_def := pg_get_functiondef('public.verify_eatery_order(text)'::regprocedure);
  IF v_def NOT LIKE '%''is_test'',                v_o.is_test%' OR v_def LIKE '%''created_by''%' OR v_def LIKE '%''client_id''%' THEN
    RAISE EXCEPTION 'verify_eatery_order body: expected the is_test key and still no created_by / client_id key';
  END IF;

  -- Functions: DEFINER, owner, pinned search_path, exact EXECUTE grantees (service_role aside).
  FOR v_fn IN
    SELECT p.proname, p.prosecdef, p.proconfig, p.provolatile, pg_get_userbyid(p.proowner) AS owner,
           CASE p.proname WHEN 'create_eatery_order' THEN 'authenticated' WHEN 'verify_eatery_order' THEN 'anon,authenticated' ELSE '' END AS want_grantees,
           CASE p.proname WHEN 'is_order_tester' THEN 'search_path=""' ELSE 'search_path=public, pg_temp' END AS want_cfg,
           CASE p.proname WHEN 'is_order_tester' THEN 's' ELSE 'v' END AS want_vol,
           COALESCE((SELECT string_agg(DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END, ',' ORDER BY CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END)
              FROM aclexplode(p.proacl) a LEFT JOIN pg_roles r ON r.oid = a.grantee
             WHERE a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner AND r.rolname IS DISTINCT FROM 'service_role'), '') AS grantees
      FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('create_eatery_order','verify_eatery_order','is_order_tester')
  LOOP
    IF v_fn.prosecdef IS DISTINCT FROM true OR v_fn.owner IS DISTINCT FROM 'postgres' OR v_fn.provolatile IS DISTINCT FROM v_fn.want_vol
       OR NOT COALESCE(v_fn.proconfig @> ARRAY[v_fn.want_cfg], false) THEN
      RAISE EXCEPTION '%: definer=% owner=% volatility=% config=% (want % / %)', v_fn.proname, v_fn.prosecdef, v_fn.owner, v_fn.provolatile, v_fn.proconfig, v_fn.want_vol, v_fn.want_cfg;
    END IF;
    IF v_fn.grantees IS DISTINCT FROM v_fn.want_grantees THEN
      RAISE EXCEPTION '%: EXECUTE grantees are "%" (want "%")', v_fn.proname, v_fn.grantees, v_fn.want_grantees;
    END IF;
    RAISE NOTICE '% -> definer, owner %, config %, EXECUTE for "%"', v_fn.proname, v_fn.owner, v_fn.proconfig, v_fn.grantees;
  END LOOP;
  SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('create_eatery_order','verify_eatery_order','is_order_tester');
  IF v_n IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'expected exactly 3 order functions, found %', v_n; END IF;
  IF NOT has_function_privilege('authenticated', 'public.create_eatery_order(uuid,jsonb,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.create_eatery_order(uuid,jsonb,text)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.verify_eatery_order(text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.verify_eatery_order(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'create / verify EXECUTE rights are not as designed';
  END IF;
  IF has_function_privilege('anon', 'public.is_order_tester(uuid)', 'EXECUTE') OR has_function_privilege('authenticated', 'public.is_order_tester(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('postgres', 'public.is_order_tester(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'is_order_tester EXECUTE rights wrong (anon/authenticated must have none, postgres must)';
  END IF;

  -- order_testers: RLS on, ZERO policies, no privilege of any kind for a client role; empty on first apply.
  SELECT c.relrowsecurity INTO v_rls FROM pg_class c WHERE c.oid = to_regclass('public.order_testers');
  IF v_rls IS DISTINCT FROM true THEN RAISE EXCEPTION 'RLS is not enabled on order_testers'; END IF;
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'order_testers';
  SELECT string_agg(policyname::text, ', ') INTO v_s FROM pg_policies WHERE schemaname = 'public' AND tablename = 'order_testers';
  RAISE NOTICE 'order_testers policies: % [%]', v_n, COALESCE(v_s, '-');
  IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'order_testers has % policies (want 0): %', v_n, v_s; END IF;
  FOREACH v_perm IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    IF has_table_privilege('anon', 'public.order_testers', v_perm) OR has_table_privilege('authenticated', 'public.order_testers', v_perm) THEN
      RAISE EXCEPTION 'anon or authenticated holds % on order_testers', v_perm;
    END IF;
  END LOOP;
  IF has_any_column_privilege('anon', 'public.order_testers', 'SELECT,INSERT,UPDATE,REFERENCES')
     OR has_any_column_privilege('authenticated', 'public.order_testers', 'SELECT,INSERT,UPDATE,REFERENCES') THEN
    RAISE EXCEPTION 'anon or authenticated holds a column privilege on order_testers';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.order_testers', 'SELECT,INSERT,UPDATE,DELETE')
     OR NOT has_table_privilege('postgres', 'public.order_testers', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'CONTROL FAILED: service_role / postgres lost their privileges on order_testers';
  END IF;
  SELECT count(*) INTO v_n FROM pg_constraint WHERE conrelid = 'public.order_testers'::regclass AND contype = 'f';
  IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'order_testers has % foreign key(s) (want none)', v_n; END IF;
  SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END, ', ' ORDER BY a.attnum) INTO v_s
    FROM pg_attribute a WHERE a.attrelid = 'public.order_testers'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_s IS DISTINCT FROM 'uid_sha256 text NOT NULL, added_at timestamp with time zone NOT NULL, note text' THEN
    RAISE EXCEPTION 'order_testers columns are [%] (want uid_sha256 text NOT NULL, added_at, note; no user_id)', v_s;
  END IF;
  SELECT string_agg(pg_get_constraintdef(c.oid), ' ; ' ORDER BY c.conname) INTO v_s FROM pg_constraint c
   WHERE c.conrelid = 'public.order_testers'::regclass AND c.contype = 'p' AND c.conname = 'order_testers_pkey';
  IF v_s IS DISTINCT FROM 'PRIMARY KEY (uid_sha256)' THEN RAISE EXCEPTION 'order_testers_pkey is [%] (want PRIMARY KEY (uid_sha256))', v_s; END IF;
  SELECT string_agg(pg_get_constraintdef(c.oid), ' ; ') INTO v_s FROM pg_constraint c
   WHERE c.conrelid = 'public.order_testers'::regclass AND c.contype = 'c' AND c.conname = 'order_testers_uid_sha256_check';
  IF v_s IS NULL OR v_s NOT LIKE '%^[0-9a-f]{64}$%' THEN RAISE EXCEPTION 'order_testers_uid_sha256_check is [%] (want a ^[0-9a-f]{64}$ CHECK)', v_s; END IF;
  v_def := pg_get_functiondef('public.is_order_tester(uuid)'::regprocedure);
  IF v_def NOT LIKE '%sha256%' OR v_def NOT LIKE '%convert_to%' OR v_def NOT LIKE '%uid_sha256%'
     OR v_def NOT LIKE '%t.uid_sha256 = encode(pg_catalog.sha256(pg_catalog.convert_to(p_uid::text, ''UTF8'')), ''hex'')%'
     OR v_def NOT LIKE '%NOT public.is_anonymous_session()%' OR v_def LIKE '%= p_uid%' OR v_def LIKE '%md5%' THEN
    RAISE EXCEPTION 'is_order_tester body is not the fingerprint lookup (sha256 + convert_to + uid_sha256, anonymous refusal, no raw p_uid comparison)';
  END IF;
  IF v_pre[4] IS DISTINCT FROM 'true' THEN
    EXECUTE 'SELECT count(*) FROM public.order_testers' INTO v_n;
    IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'order_testers was created with % row(s) (must start empty)', v_n; END IF;
  END IF;

  -- Cron: exactly one active job with this name, the new schedule and the new command.
  SELECT count(*), max(btrim(command)), max(schedule) INTO v_n, v_s, v_def FROM cron.job WHERE jobname = 'eatery-orders-retention' AND active;
  IF v_n IS DISTINCT FROM 1 OR v_def IS DISTINCT FROM '40 * * * *'
     OR v_s IS DISTINCT FROM 'DELETE FROM public.eatery_orders WHERE created_at < now() - interval ''30 days'' OR (is_test AND created_at < now() - interval ''24 hours'')' THEN
    RAISE EXCEPTION 'cron job eatery-orders-retention: % active rows, schedule %, command %', v_n, v_def, v_s;
  END IF;
  SELECT count(*) INTO v_n FROM cron.job WHERE jobname = 'eatery-orders-retention';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'cron job eatery-orders-retention exists % times (want 1)', v_n; END IF;
  RAISE NOTICE 'cron: eatery-orders-retention [%] %', v_def, v_s;
END $$;

-- ─── Behaviour proof (throwaway partners and rows; a sentinel rolls everything back) ───
DO $$
DECLARE
  c_key constant text := 'zz-20261132-probe-key-not-a-secret';
  v_pre text[] := string_to_array(current_setting('ada.m1132_pre'), '|');
  v_pa uuid; v_pl uuid; v_pm uuid; v_a1 bigint; v_l1 bigint; v_m1 bigint;
  s record; v_res jsonb; v_saved jsonb := '{}'::jsonb; v_sql text; v_state text; v_msg text; v_det text; v_role text; v_claims text; v_hdr text;
  v_got text; v_report text := ''; v_n int; v_cnt int; v_md5 text; v_keys text[]; v_b boolean; v_cmd text;
  v_raw text; v_pre_keys int; v_pre_partners int; v_pre_testers int; v_u1 constant uuid := '00000000-0000-4000-8000-000000000001';
BEGIN
  SELECT count(*) INTO v_pre_keys FROM private.preview_key_hashes;
  SELECT count(*) INTO v_pre_partners FROM public.eatery_partners;
  SELECT count(*) INTO v_pre_testers FROM public.order_testers;

  BEGIN
    INSERT INTO private.preview_key_hashes (hash, label) VALUES (encode(sha256(convert_to(c_key, 'UTF8')), 'hex'), 'zz probe 1132');
    -- Testers are seeded BY FINGERPRINT, computed here from the synthetic uuids. Users 1, 3, 8 and 0...ab (hex letters: only these catch a case-folding bug) are listed with the
    -- canonical fingerprint. User 12 has a WRONG row (fingerprint of the text 'zz wrong' + the real fingerprint of a
    -- different uuid, 0...0b) so neither may mark user 12; user 12's own fingerprint is deliberately absent.
    INSERT INTO public.order_testers (uid_sha256, note)
      SELECT encode(sha256(convert_to(u::uuid::text, 'UTF8')), 'hex'), n FROM (VALUES
        ('00000000-0000-4000-8000-000000000001', 'zz probe tester'), ('00000000-0000-4000-8000-000000000003', 'zz probe listed guest'),
        ('00000000-0000-4000-8000-000000000008', 'zz probe tester 8'), ('00000000-0000-4000-8000-00000000000b', 'zz probe other uuid'),
        ('00000000-0000-4000-8000-0000000000ab', 'zz probe tester whose uuid has hex letters')) AS x(u, n);
    INSERT INTO public.order_testers (uid_sha256, note) VALUES (encode(sha256(convert_to('zz wrong', 'UTF8')), 'hex'), 'zz probe wrong hash');
    -- The CHECK refuses anything but 64 lowercase hex: a raw uuid, an uppercased fingerprint, a short hash (23514 each).
    FOREACH v_raw IN ARRAY ARRAY['00000000-0000-4000-8000-000000000001',
        upper(encode(sha256(convert_to('00000000-0000-4000-8000-000000000001', 'UTF8')), 'hex')),
        substr(encode(sha256(convert_to('00000000-0000-4000-8000-000000000001', 'UTF8')), 'hex'), 1, 63)] LOOP
      v_state := NULL;
      BEGIN
        INSERT INTO public.order_testers (uid_sha256, note) VALUES (v_raw, 'zz must be refused');
      EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
      END;
      IF v_state IS DISTINCT FROM '23514' THEN RAISE EXCEPTION 'order_testers accepted or mis-refused a non-fingerprint value (sqlstate %): %', v_state, left(v_raw, 12); END IF;
    END LOOP;
    INSERT INTO public.eatery_partners (slug, name, category, lat, lng, geocode_source, logo_path, menu_verified_on, is_active)
      VALUES ('zz-ta', 'zz test A', 'cafe', 35.1, 33.3, 'partner', 'zz-ta/logo.png', current_date, true) RETURNING id INTO v_pa;
    INSERT INTO public.eatery_partners (slug, name, category, lat, lng, geocode_source, logo_path, menu_verified_on, is_active)
      VALUES ('zz-tl', 'zz test limit', 'cafe', 35.1, 33.3, 'partner', 'zz-tl/logo.png', current_date, true) RETURNING id INTO v_pl;
    INSERT INTO public.eatery_partners (slug, name, category, lat, lng, geocode_source, logo_path, menu_verified_on, is_active)
      VALUES ('zz-tm', 'zz test real cap', 'cafe', 35.1, 33.3, 'partner', 'zz-tm/logo.png', current_date, true) RETURNING id INTO v_pm;
    INSERT INTO public.eatery_menu_items (partner_id, section, name, price, currency) VALUES (v_pa, 'zz', 'zz dish', 10.00, 'TRY') RETURNING id INTO v_a1;
    INSERT INTO public.eatery_menu_items (partner_id, section, name, price, currency) VALUES (v_pl, 'zz', 'zz limit dish', 1.00, 'TRY') RETURNING id INTO v_l1;
    INSERT INTO public.eatery_menu_items (partner_id, section, name, price, currency) VALUES (v_pm, 'zz', 'zz real cap dish', 1.00, 'TRY') RETURNING id INTO v_m1;
    -- 60 fresh guest-session orders: all TEST on partner L, all REAL on partner M.
    INSERT INTO public.eatery_orders (code, partner_id, lines, total, currency, created_by, created_as_guest, is_test)
      SELECT 'TA' || lpad(translate(g::text, '01', 'AB'), 6, 'C'), v_pl, '[{"item_id":1,"name":"x","qty":1,"unit_price":1}]'::jsonb, 1, 'TRY', gen_random_uuid(), true, true
        FROM generate_series(1, 60) g;
    INSERT INTO public.eatery_orders (code, partner_id, lines, total, currency, created_by, created_as_guest, is_test)
      SELECT 'TB' || lpad(translate(g::text, '01', 'AB'), 6, 'C'), v_pm, '[{"item_id":1,"name":"x","qty":1,"unit_price":1}]'::jsonb, 1, 'TRY', gen_random_uuid(), true, false
        FROM generate_series(1, 60) g;

    -- Steps: (label, who, hdr, sql, want, save). who = anon | user:N | guest:N | pg ; hdr = '' | 'key' | 'wrong'.
    -- want = ok | err:<message>[|detail] | state:<sqlstate>.
    FOR s IN SELECT * FROM (VALUES
      ('Preview key header, unlisted user',        'user:4',  'key',   format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1))), 'ok', 'kp'),
      ('no key, unlisted user',                    'user:2',  '',      format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1))), 'ok', 'kr'),
      ('WRONG key header',                         'user:5',  'wrong', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1))), 'ok', 'kw'),
      ('listed tester, signed in',                 'user:1',  '',      format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1))), 'ok', 'kt'),
      ('listed tester whose uuid has hex letters (lowercase canonical form)', 'user:ab', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1))), 'ok', 'kl'),
      ('listed uid but ANONYMOUS session',         'guest:3', '',      format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1))), 'ok', 'kg'),
      ('user with only WRONG-hash rows in the list', 'user:12', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1))), 'ok', 'kx'),
      ('CONTROL unlisted guest',                   'guest:9', '',      format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1))), 'ok', 'kg0'),
      ('authenticated calls is_order_tester(listed)', 'user:1', '',    format('SELECT to_jsonb(public.is_order_tester(%L))', v_u1), 'state:42501', NULL),
      ('anon calls is_order_tester(listed)',       'anon',    '',      format('SELECT to_jsonb(public.is_order_tester(%L))', v_u1), 'state:42501', NULL),
      ('CONTROL postgres: is_order_tester(listed)', 'pg',     '',      format('SELECT to_jsonb(public.is_order_tester(%L))', v_u1), 'ok', 'ot1'),
      ('CONTROL postgres: is_order_tester(unlisted)', 'pg',   '',      format('SELECT to_jsonb(public.is_order_tester(%L))', '00000000-0000-4000-8000-000000000002'::uuid), 'ok', 'ot2'),
      ('CONTROL postgres: is_order_tester(uuid whose fingerprint is not listed)', 'pg', '', format('SELECT to_jsonb(public.is_order_tester(%L))', '00000000-0000-4000-8000-000000000012'::uuid), 'ok', 'ot4'),
      ('CONTROL postgres: is_order_tester(NULL)',  'pg',      '',      'SELECT to_jsonb(public.is_order_tester(NULL))', 'ok', 'ot3'),
      ('named argument p_is_test => true',         'user:2',  '',      format('SELECT public.create_eatery_order(p_partner => %L, p_items => %L::jsonb, p_is_test => true)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1))), 'state:42883', NULL),
      ('CONTROL same named call without p_is_test', 'user:2', '',     format('SELECT public.create_eatery_order(p_partner => %L, p_items => %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1))), 'ok', 'kn'),
      ('fresh guest NOT blocked by 60 guest TEST orders', 'guest:6', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pl, jsonb_build_array(jsonb_build_object('item_id', v_l1, 'qty', 1))), 'ok', 'cl'),
      ('CONTROL 60 guest REAL orders still block a guest', 'guest:7', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pm, jsonb_build_array(jsonb_build_object('item_id', v_m1, 'qty', 1))), 'err:rate_limited|partner', NULL),
      ('tester 8 order 1',                         'user:8',  '',      format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1))), 'ok', NULL),
      ('tester 8 order 2',                         'user:8',  '',      format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1))), 'ok', NULL),
      ('tester 8 order 3',                         'user:8',  '',      format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1))), 'ok', NULL),
      ('tester 8 order 4',                         'user:8',  '',      format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1))), 'ok', NULL),
      ('tester 8 order 5',                         'user:8',  '',      format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1))), 'ok', NULL),
      ('5 TEST orders by one user block the 6th',  'user:8',  '',      format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1))), 'err:rate_limited|user', NULL),
      ('verify a TEST order (anon)',               'anon',    '',      $q$SELECT public.verify_eatery_order('{{code:kt}}')$q$, 'ok', 'vt'),
      ('verify a REAL order (anon)',               'anon',    '',      $q$SELECT public.verify_eatery_order('{{code:kr}}')$q$, 'ok', 'vr')
    ) AS x(label, who, hdr, sql, want, save) LOOP
      v_sql := replace(replace(s.sql, '{{code:kt}}', COALESCE(v_saved -> 'kt' ->> 'code', 'MISSING0')),
                       '{{code:kr}}', COALESCE(v_saved -> 'kr' ->> 'code', 'MISSING0'));
      v_role := CASE WHEN s.who = 'anon' THEN 'anon' WHEN s.who = 'pg' THEN NULL ELSE 'authenticated' END;
      v_claims := CASE
        WHEN s.who = 'anon' OR s.who = 'pg' THEN ''
        WHEN s.who LIKE 'guest:%' THEN json_build_object('sub', '00000000-0000-4000-8000-' || lpad(split_part(s.who, ':', 2), 12, '0'), 'role', 'authenticated', 'is_anonymous', true)::text
        ELSE json_build_object('sub', '00000000-0000-4000-8000-' || lpad(split_part(s.who, ':', 2), 12, '0'), 'role', 'authenticated')::text END;
      v_hdr := CASE s.hdr WHEN 'key' THEN json_build_object('x-ada-preview-key', c_key)::text
                          WHEN 'wrong' THEN json_build_object('x-ada-preview-key', 'zz-wrong-key')::text ELSE '' END;
      v_res := NULL; v_state := NULL; v_msg := NULL; v_det := NULL;
      BEGIN
        IF v_role IS NOT NULL THEN EXECUTE format('SET LOCAL ROLE %I', v_role); END IF;
        PERFORM set_config('request.jwt.claims', v_claims, true);
        PERFORM set_config('request.headers', v_hdr, true);
        EXECUTE v_sql INTO v_res;
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_det = PG_EXCEPTION_DETAIL;
        v_state := SQLSTATE; v_msg := SQLERRM;
      END;
      RESET ROLE;
      PERFORM set_config('request.jwt.claims', '', true);
      PERFORM set_config('request.headers', '', true);

      v_got := CASE WHEN v_state IS NULL THEN 'ok' ELSE 'err:' || v_msg || ' [' || v_state || ']' END;
      IF s.want = 'ok' THEN
        IF v_state IS NOT NULL THEN RAISE EXCEPTION 'STEP "%" (as %): expected ok, got %', s.label, s.who, v_got; END IF;
      ELSIF s.want LIKE 'err:%' THEN
        IF v_state IS DISTINCT FROM 'P0001' OR v_msg IS DISTINCT FROM split_part(substr(s.want, 5), '|', 1)
           OR (position('|' IN s.want) > 0 AND v_det IS DISTINCT FROM split_part(s.want, '|', 2)) THEN
          RAISE EXCEPTION 'STEP "%" (as %): expected P0001 "%", got % detail %', s.label, s.who, substr(s.want, 5), v_got, v_det;
        END IF;
      ELSIF s.want LIKE 'state:%' THEN
        IF v_state IS DISTINCT FROM substr(s.want, 7) THEN
          RAISE EXCEPTION 'STEP "%" (as %): expected SQLSTATE %, got %', s.label, s.who, substr(s.want, 7), v_got;
        END IF;
      END IF;
      IF s.save IS NOT NULL THEN v_saved := v_saved || jsonb_build_object(s.save, v_res); END IF;
      v_report := v_report || format(E'\n  %-52s %-8s -> %s', s.label, s.who, v_got);
    END LOOP;

    -- ── is_test as STORED (read as postgres, the role that may read the table) ──
    FOR s IN SELECT * FROM (VALUES
      ('kp', true,  'Preview key header'), ('kr', false, 'no key'), ('kw', false, 'wrong key'), ('kt', true, 'listed tester'), ('kl', true, 'listed tester whose uuid has hex letters'),
      ('kg', false, 'listed uid, anonymous session'), ('kg0', false, 'unlisted guest'), ('kx', false, 'user with a different uuid than the listed fingerprint'), ('kn', false, 'named-arg control'),
      ('cl', false, 'guest on the 60-test-orders partner')
    ) AS x(k, want, label) LOOP
      SELECT o.is_test INTO v_b FROM public.eatery_orders o WHERE o.code = v_saved -> s.k ->> 'code';
      IF v_b IS DISTINCT FROM s.want THEN RAISE EXCEPTION 'is_test for "%" is %, want %', s.label, v_b, s.want; END IF;
    END LOOP;
    SELECT count(*) INTO v_n FROM public.eatery_orders WHERE created_by = '00000000-0000-4000-8000-000000000008' AND is_test;
    IF v_n IS DISTINCT FROM 5 THEN RAISE EXCEPTION 'tester 8 should have 5 TEST orders, has %', v_n; END IF;
    IF (v_saved -> 'ot1' #>> '{}') IS DISTINCT FROM 'true' OR (v_saved -> 'ot2' #>> '{}') IS DISTINCT FROM 'false' OR (v_saved -> 'ot3' #>> '{}') IS DISTINCT FROM 'false'
       OR (v_saved -> 'ot4' #>> '{}') IS DISTINCT FROM 'false' THEN
      RAISE EXCEPTION 'is_order_tester decisions: listed %, unlisted %, NULL %, other-fingerprint %', v_saved -> 'ot1', v_saved -> 'ot2', v_saved -> 'ot3', v_saved -> 'ot4';
    END IF;

    -- The app-facing result of create is unchanged; verify gained exactly is_test.
    SELECT array_agg(k ORDER BY k) INTO v_keys FROM jsonb_object_keys(v_saved -> 'kt') k;
    IF v_keys IS DISTINCT FROM ARRAY['code','currency','expires_at','lines','total'] THEN RAISE EXCEPTION 'create result keys are %', v_keys; END IF;
    SELECT array_agg(k ORDER BY k) INTO v_keys FROM jsonb_object_keys(v_saved -> 'vt') k;
    IF v_keys IS DISTINCT FROM ARRAY['created_at','currency','expires_at','first_viewed_at_before','is_test','lines','partner_name','status','total','view_count_before'] THEN
      RAISE EXCEPTION 'verify result keys are %', v_keys;
    END IF;
    IF (v_saved -> 'vt' -> 'is_test') IS DISTINCT FROM 'true'::jsonb OR (v_saved -> 'vr' -> 'is_test') IS DISTINCT FROM 'false'::jsonb THEN
      RAISE EXCEPTION 'verify is_test: test order %, real order %', v_saved -> 'vt' -> 'is_test', v_saved -> 'vr' -> 'is_test';
    END IF;

    -- ── Retention: run the job's stored command text, then see who is left ──
    INSERT INTO public.eatery_orders (code, partner_id, lines, total, currency, created_by, is_test, created_at, expires_at)
      SELECT x.code, v_pa, '[{"item_id":1,"name":"x","qty":1,"unit_price":1}]'::jsonb, 1, 'TRY', gen_random_uuid(), x.t, now() - x.age, now() - x.age + interval '2 hours'
        FROM (VALUES ('ZTEST25H', true, interval '25 hours'), ('ZTEST23H', true, interval '23 hours'),
                     ('ZREAL29D', false, interval '29 days'), ('ZREAL32D', false, interval '32 days')) AS x(code, t, age);
    SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'eatery-orders-retention' AND active;
    SELECT count(*) INTO v_cnt FROM public.eatery_orders WHERE partner_id IN (v_pl, v_pm);
    EXECUTE v_cmd;
    SELECT string_agg(code, ',' ORDER BY code) INTO v_md5 FROM public.eatery_orders WHERE code IN ('ZTEST25H','ZTEST23H','ZREAL29D','ZREAL32D');
    IF v_md5 IS DISTINCT FROM 'ZREAL29D,ZTEST23H' THEN
      RAISE EXCEPTION 'retention command left % (want ZREAL29D,ZTEST23H: test >24 h and real >30 d deleted, test <24 h and real <30 d kept)', v_md5;
    END IF;
    SELECT count(*) INTO v_n FROM public.eatery_orders WHERE partner_id IN (v_pl, v_pm);
    IF v_n IS DISTINCT FROM v_cnt THEN RAISE EXCEPTION 'retention command removed fresh rows: % of % remain', v_n, v_cnt; END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'zz-sentinel';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'zz-sentinel' THEN RAISE; END IF;
  END;
  RESET ROLE;

  -- Nothing survived the sentinel; the real rows are exactly as they were before the ALTER.
  SELECT count(*), COALESCE(md5(string_agg(id::text, ',' ORDER BY id)), '') INTO v_n, v_md5 FROM public.eatery_orders;
  IF v_n::text IS DISTINCT FROM v_pre[1] OR v_md5 IS DISTINCT FROM v_pre[2]
     OR (SELECT count(*) FROM private.preview_key_hashes) IS DISTINCT FROM v_pre_keys
     OR (SELECT count(*) FROM public.eatery_partners) IS DISTINCT FROM v_pre_partners
     OR (SELECT count(*) FROM public.order_testers) IS DISTINCT FROM v_pre_testers
     OR EXISTS (SELECT 1 FROM public.eatery_partners WHERE slug LIKE 'zz-t%') THEN
    RAISE EXCEPTION 'probe rows survived the sentinel or real orders changed: % rows md5 % (before: % rows md5 %)', v_n, v_md5, v_pre[1], v_pre[2];
  END IF;
  RAISE NOTICE 'is_test probes (all as stated; expected-error steps matched SQLSTATE/message); real orders unchanged (% rows, md5 %):%', v_n, v_md5, v_report;
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
VALUES ('20261132_eatery_orders_is_test.sql', 'd7dd85b234d5dbe7015c46d2cc5e5095e563da5154a9be00c249010e3682d82e')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: every 20261132_eatery_orders_is_test row must read OK.
--   Adding a tester (a workflow or the SQL editor, never a client): INSERT INTO public.order_testers (uid_sha256, note) VALUES ('<64 hex>', '<who>');  -- see ADDING A TESTER above
--
-- ─── Rollback (only if abandoned) ───────────────────────────────────────────
--   SELECT cron.unschedule('eatery-orders-retention');
--   SELECT cron.schedule('eatery-orders-retention', '40 3 * * *', $$ DELETE FROM public.eatery_orders WHERE created_at < now() - interval '30 days' $$);
--   re-run the create/verify bodies of 20261125_eatery_orders.sql (CREATE OR REPLACE);
--   DROP FUNCTION IF EXISTS public.is_order_tester(uuid);
--   DROP TABLE IF EXISTS public.order_testers;
--   ALTER TABLE public.eatery_orders DROP COLUMN IF EXISTS is_test;
