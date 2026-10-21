-- ═══════════════════════════════════════════════════════════════════════════
-- 20261125 — Yeme-İçme: WhatsApp order proof (eatery_orders + create/verify RPCs + 30-day retention)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The app sends an order to a partner on WhatsApp. This file adds the server side that lets the PARTNER prove the
-- message is genuine: the app first asks the server to record the order (create_eatery_order), puts the returned
-- 8-character code in the WhatsApp text, and the partner opens a page that calls verify_eatery_order(code) to see
-- what ADA recorded (items, quantities, DATABASE prices, total, age of the order, whether it was viewed before).
--
-- (1) eatery_partners.order_requires_account boolean NOT NULL DEFAULT false: a per-partner switch. When true,
--     guest (anonymous) sessions cannot create an order for that partner; they must sign in. Stays false.
--
-- (2) public.eatery_orders: code (8 chars, 32-letter alphabet without 0/O/1/I/L-confusables: 2-9 A-Z minus I, O),
--     partner, lines (jsonb array of {item_id, name, qty, unit_price}), total, currency, created_at, expires_at
--     (created_at + 2 hours), first_viewed_at, view_count, created_by (uuid, NO foreign key), client_id (optional
--     install id). NO name, phone, address or note column: the order carries no personal data except created_by.
--     created_by has no FK on purpose: an FK ... ON DELETE SET NULL broke account deletion three times in this
--     project. The cost is that a deleted account's uuid lingers on its orders until the 30-day retention job
--     below removes them.
--
-- (3) create_eatery_order(p_partner, p_items, p_client_id): SECURITY DEFINER. The client sends only item ids and
--     quantities; names, prices and the currency come from eatery_menu_items, so a forged price is ignored.
-- (4) verify_eatery_order(p_code): SECURITY DEFINER, callable by anon (the Cloudflare Worker uses the anon key).
--     Returns the order WITHOUT created_by, client_id or item ids. Each call counts as a view.
-- (5) pg_cron job 'eatery-orders-retention' (03:40 UTC daily): deletes orders older than 30 days.
--
-- ─── WHO CAN READ / WRITE WHAT ──────────────────────────────────────────────
--   • eatery_orders: RLS ON, ZERO policies, and ALL privileges revoked from PUBLIC, anon and authenticated. No
--     client role can SELECT, INSERT, UPDATE or DELETE a row, directly or through PostgREST. (Defence in depth:
--     the probe below also GRANTs SELECT back inside the rolled-back sentinel and shows RLS alone returns 0 rows.)
--     Only the two functions below (owner postgres, bypassing RLS) and service_role touch the table.
--   • create_eatery_order: EXECUTE for authenticated only (a guest is authenticated). anon cannot call it.
--       - needs auth.uid(); the partner must be active, or the caller must carry the ADA Preview key
--         (public.is_previewer(), 20261119/20261120) for an inactive partner; if the partner has
--         order_requires_account, an anonymous (guest) session is refused;
--       - every item must belong to that partner, be is_available and have a price; one currency per order;
--       - at most 5 orders per user in any rolling hour, and at most 60 per partner per hour counting ONLY orders
--         created from guest (anonymous) sessions (created_as_guest). Signed-in users are exempt from the partner
--         cap (guests are free, so otherwise a dozen guest sessions could block every real order for a partner);
--         both counts run under advisory locks.
--   • verify_eatery_order: EXECUTE for anon and authenticated. Anyone holding the code can read that one order's
--     partner name, time, lines (name, qty, unit price), total and currency. 8 chars of a 32-letter alphabet
--     (2^40 codes) make guessing impractical; the Worker should additionally rate-limit. The 2-hour validity only
--     sets status 'expired': an expired order still returns its contents until the 30-day retention job deletes it,
--     and verify is callable with the public anon key directly (the Worker's POST step is not the only path). The
--     data is non-personal (dish names, quantities, prices); accepted.
--   • 18+ RULE: for a partner with adult_only = true (20261121), create_eatery_order refuses with MESSAGE 'adult_only'
--     and DETAIL 'guest' (anonymous session), 'no_dob' (signed in, profiles.date_of_birth NULL or no profile row) or
--     'under_18' (date_of_birth later than today's Europe/Istanbul date minus 18 years; turning 18 today counts as 18).
--     The age decision itself is the pure helper eatery_order_age_gate(dob, today) (internal: no client EXECUTE).
--     PROOF SPLIT: prod probes here need no write to auth.users / profiles: the helper is tested exhaustively
--     (NULL, birthday tomorrow / today, 30 years, a Feb-29 birth on non-leap years), and the create wiring is tested
--     for 'guest' and for 'no_dob' (a signed-in uuid with no profile row). The end-to-end "adult accepted" and
--     "under_18 refused" cases need real profile rows and are proven in the PGlite harness only
--     (scripts/test-eatery-orders-sql.mjs). Leap-day rule: a Feb-29 birth turns 18 on Mar 1 in a non-leap year.
--     The check runs after partner visibility and before items and rate limits, so a refusal writes no row and uses
--     no rate-limit quota. adult_only = false partners (Crunchy Express) are unaffected.
--   • eatery_partners.order_requires_account is readable by everyone who can already read an active partner
--     (the existing table-level SELECT grant covers a new column; asserted: no column-level ACL).
--
-- ─── ERROR CODES (RAISE EXCEPTION, SQLSTATE P0001; the MESSAGE is the stable code the app matches) ──
--   not_authenticated · partner_unavailable · adult_only (DETAIL guest | no_dob | under_18) · order_requires_account · invalid_items · invalid_client_id ·
--   item_unavailable · mixed_currency · rate_limited · code_generation_failed
--
-- Random code: the 8 characters are 5 bits each, taken from five bytes of gen_random_uuid() (a core, CSPRNG-backed
-- function; bytes 0-3 and 10 are not touched by the uuid version/variant bits). pgcrypto is NOT required.
--
-- Apply: gh workflow run supabase-migrate -f file=20261125_eatery_orders.sql (dry), then -f apply=true
-- (Berke approves production-db). ADDs a column and functions ⇒ ends with NOTIFY pgrst (after COMMIT and RESET ROLE).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── Pre-state (abort before changing anything) ─────────────────────────────
DO $$
DECLARE
  v_cols int;
  v_pol  int;
BEGIN
  IF to_regclass('public.eatery_partners') IS NULL OR to_regclass('public.eatery_menu_items') IS NULL THEN
    RAISE EXCEPTION 'pre-state: eatery_partners / eatery_menu_items missing (20261115 not applied)';
  END IF;
  IF to_regprocedure('public.is_previewer()') IS NULL THEN
    RAISE EXCEPTION 'pre-state: public.is_previewer() missing (20261119/20261120 not applied)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'eatery_partners' AND column_name = 'adult_only')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'date_of_birth') THEN
    RAISE EXCEPTION 'pre-state: eatery_partners.adult_only (20261121) or profiles.date_of_birth (20261001) missing';
  END IF;
  IF to_regprocedure('public.is_anonymous_session()') IS NULL THEN
    RAISE EXCEPTION 'pre-state: public.is_anonymous_session() missing (20260714)';
  END IF;
  IF to_regnamespace('cron') IS NULL OR to_regclass('cron.job') IS NULL
     OR to_regprocedure('cron.schedule(text,text,text)') IS NULL OR to_regprocedure('cron.unschedule(text)') IS NULL THEN
    RAISE EXCEPTION 'pre-state: pg_cron is not installed (cron.job / cron.schedule / cron.unschedule missing)';
  END IF;
  IF to_regprocedure('public.gen_random_uuid()') IS NULL AND to_regprocedure('pg_catalog.gen_random_uuid()') IS NULL THEN
    RAISE EXCEPTION 'pre-state: gen_random_uuid() missing';
  END IF;

  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'eatery_partners' AND column_name = 'order_requires_account';
  IF v_cols NOT IN (0, 1) THEN RAISE EXCEPTION 'pre-state: order_requires_account column count %', v_cols; END IF;

  IF to_regclass('public.eatery_orders') IS NOT NULL THEN
    SELECT count(*) INTO v_pol FROM pg_policies WHERE schemaname = 'public' AND tablename = 'eatery_orders';
    IF v_pol IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'pre-state: eatery_orders already has % policies (want 0)', v_pol; END IF;
  END IF;
  RAISE NOTICE 'pre-state ok (order_requires_account present: %, eatery_orders present: %)', v_cols, to_regclass('public.eatery_orders') IS NOT NULL;
END $$;

-- ─── (1) Per-partner sign-in switch ─────────────────────────────────────────
ALTER TABLE public.eatery_partners ADD COLUMN IF NOT EXISTS order_requires_account boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.eatery_partners.order_requires_account IS
  'true = guests (anonymous sessions) cannot create a WhatsApp order for this partner; they must sign in. DEFAULT false. 20261125.';

-- ─── (2) eatery_orders ──────────────────────────────────────────────────────
-- Static literals on purpose: scripts/audit-schema-drift.mjs reads CHECK literals from this file.
CREATE TABLE IF NOT EXISTS public.eatery_orders (
  id              uuid          NOT NULL DEFAULT gen_random_uuid(),
  code            text          NOT NULL,
  partner_id      uuid          NOT NULL,
  lines           jsonb         NOT NULL,
  total           numeric(10,2) NOT NULL,
  currency        text          NOT NULL,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  expires_at      timestamptz   NOT NULL DEFAULT (now() + interval '2 hours'),
  first_viewed_at timestamptz,
  view_count      int           NOT NULL DEFAULT 0,
  created_by      uuid          NOT NULL,
  client_id       text,
  created_as_guest boolean      NOT NULL DEFAULT false,
  CONSTRAINT eatery_orders_pkey PRIMARY KEY (id),
  CONSTRAINT eatery_orders_code_key UNIQUE (code),
  CONSTRAINT eatery_orders_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.eatery_partners (id) ON DELETE CASCADE,
  CONSTRAINT eatery_orders_code_check CHECK (code ~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$'),
  CONSTRAINT eatery_orders_lines_check CHECK (CASE WHEN jsonb_typeof(lines) = 'array' THEN jsonb_array_length(lines) BETWEEN 1 AND 50 ELSE false END),
  CONSTRAINT eatery_orders_total_check CHECK (total >= 0),
  CONSTRAINT eatery_orders_currency_check CHECK (currency IN ('TRY','EUR','GBP')),
  CONSTRAINT eatery_orders_expires_check CHECK (expires_at > created_at),
  CONSTRAINT eatery_orders_view_count_check CHECK (view_count >= 0),
  CONSTRAINT eatery_orders_client_id_check CHECK (client_id IS NULL OR client_id ~ '^[A-Za-z0-9_-]{8,64}$')
);
CREATE INDEX IF NOT EXISTS eatery_orders_created_by_created_at_idx ON public.eatery_orders (created_by, created_at);
CREATE INDEX IF NOT EXISTS eatery_orders_partner_created_at_idx    ON public.eatery_orders (partner_id, created_at);
CREATE INDEX IF NOT EXISTS eatery_orders_created_at_idx            ON public.eatery_orders (created_at);
CREATE INDEX IF NOT EXISTS eatery_orders_guest_partner_idx         ON public.eatery_orders (partner_id, created_at) WHERE created_as_guest;

ALTER TABLE public.eatery_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.eatery_orders FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.eatery_orders IS
  'WhatsApp order proof. RLS on, ZERO policies, all client privileges revoked: touched only by create_eatery_order / verify_eatery_order (SECURITY DEFINER) and the eatery-orders-retention cron (30 days). No name, phone or note column. created_by has no FK on purpose (FK SET NULL broke account deletion). 20261125.';
COMMENT ON COLUMN public.eatery_orders.created_by IS
  'auth.uid() of the creator. NO foreign key (deliberate). Never returned by verify_eatery_order. Rate-limit key.';
COMMENT ON COLUMN public.eatery_orders.client_id IS
  'Optional random install id (8-64 chars of A-Za-z0-9_-). Never returned by verify_eatery_order.';

-- ─── (3a) eatery_order_age_gate: the 18+ decision as a pure function ────────
CREATE OR REPLACE FUNCTION public.eatery_order_age_gate(p_dob date, p_today date)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN p_today IS NULL THEN 'under_18'
    WHEN p_dob IS NULL THEN 'no_dob'
    WHEN p_dob > (p_today - interval '18 years')::date THEN 'under_18'
    ELSE NULL
  END
$fn$;
ALTER FUNCTION public.eatery_order_age_gate(date, date) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.eatery_order_age_gate(date, date) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.eatery_order_age_gate(date, date) IS
  'Internal helper of create_eatery_order. NULL = adult (18th birthday on or before p_today), no_dob, or under_18 (also for a NULL p_today: fail closed). A Feb-29 birth turns 18 on Mar 1 in non-leap years. No client EXECUTE. 20261125.';

-- ─── (3) create_eatery_order ────────────────────────────────────────────────
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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_authenticated';
  END IF;

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
  SELECT count(*) INTO v_part_n FROM public.eatery_orders WHERE partner_id = p_partner AND created_as_guest AND created_at > now() - interval '1 hour';
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
      INSERT INTO public.eatery_orders (code, partner_id, lines, total, currency, created_by, client_id, created_as_guest)
      VALUES (v_code, p_partner, v_lines, v_total, v_cur, v_uid, p_client_id, v_guest)
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
  'Records a WhatsApp order and returns {code, lines, total, currency, expires_at}. Prices come from eatery_menu_items, never the client. authenticated only (guests included unless the partner sets order_requires_account). 5/user/h, 60/partner/h counted over guest-session orders only. Errors: SQLSTATE P0001, MESSAGE = not_authenticated | partner_unavailable | adult_only (DETAIL guest/no_dob/under_18) | order_requires_account | invalid_items | invalid_client_id | item_unavailable | mixed_currency | rate_limited | code_generation_failed. 20261125.';

-- ─── (4) verify_eatery_order ────────────────────────────────────────────────
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
    'view_count_before',      v_o.view_count);
END;
$fn$;
ALTER FUNCTION public.verify_eatery_order(text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.verify_eatery_order(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.verify_eatery_order(text) TO anon, authenticated;
COMMENT ON FUNCTION public.verify_eatery_order(text) IS
  'Partner-side check of a WhatsApp order code (anon + authenticated). Returns {status ok|expired|not_found, partner_name, created_at, expires_at, lines[name,qty,unit_price], total, currency, first_viewed_at_before, view_count_before} and counts the call as a view. Never returns created_by, client_id or item ids. 20261125.';

-- ─── (5) Retention: 30 days ─────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'eatery-orders-retention') THEN
    PERFORM cron.unschedule('eatery-orders-retention');
  END IF;
END $$;
-- 03:40 UTC, after purge-soft-deleted-ugc (03:27) and purge-app-update-events (03:33).
SELECT cron.schedule('eatery-orders-retention', '40 3 * * *',
  $$ DELETE FROM public.eatery_orders WHERE created_at < now() - interval '30 days' $$);

-- ─── Assertions + probes (inside the transaction; a failure rolls the file back) ─
DO $$
DECLARE
  v_pm uuid; v_m1 bigint; v_pad uuid; v_ad1 bigint;
  v_det text;
  v_n int; v_s text; v_def text; v_fn record; v_rls boolean;
  v_pre_orders int; v_pre_keys int; v_pre_partners int;
  c_key constant text := 'zz-20261125-probe-key-not-a-secret';
  v_pa uuid; v_pb uuid; v_pi uuid; v_pr uuid; v_pl uuid;
  v_a1 bigint; v_a2 bigint; v_a3 bigint; v_a4 bigint; v_ae bigint; v_b1 bigint; v_i1 bigint; v_r1 bigint; v_l1 bigint;
  s record; v_res jsonb; v_saved jsonb := '{}'::jsonb; v_sql text; v_state text; v_msg text; v_report text := '';
  v_role text; v_claims text; v_hdr text; v_got text; v_cur text;
  v_o jsonb; v_keys text[];
BEGIN
  -- ── Structure, read from the live catalogs ──
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'eatery_partners' AND column_name = 'order_requires_account'
     AND data_type = 'boolean' AND is_nullable = 'NO' AND column_default = 'false';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'eatery_partners.order_requires_account is not boolean NOT NULL DEFAULT false'; END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.eatery_partners'::regclass AND attname = 'order_requires_account' AND attacl IS NOT NULL) THEN
    RAISE EXCEPTION 'order_requires_account carries a column-level ACL (want none: the table-level grant covers it)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.eatery_partners WHERE order_requires_account) THEN
    RAISE EXCEPTION 'a real partner has order_requires_account = true (it must stay false)';
  END IF;

  SELECT string_agg(column_name || ':' || data_type || CASE WHEN is_nullable = 'NO' THEN '!' ELSE '?' END, ', ' ORDER BY ordinal_position)
    INTO v_s FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'eatery_orders';
  IF v_s IS DISTINCT FROM 'id:uuid!, code:text!, partner_id:uuid!, lines:jsonb!, total:numeric!, currency:text!, created_at:timestamp with time zone!, expires_at:timestamp with time zone!, first_viewed_at:timestamp with time zone?, view_count:integer!, created_by:uuid!, client_id:text?, created_as_guest:boolean!' THEN
    RAISE EXCEPTION 'eatery_orders columns are not as designed: %', v_s;
  END IF;
  RAISE NOTICE 'eatery_orders columns: %', v_s;

  SELECT count(*) INTO v_n FROM pg_constraint WHERE conrelid = 'public.eatery_orders'::regclass AND contype = 'f';
  IF v_n IS DISTINCT FROM 1 OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.eatery_orders'::regclass AND contype = 'f'
       AND conname = 'eatery_orders_partner_id_fkey' AND confrelid = 'public.eatery_partners'::regclass) THEN
    RAISE EXCEPTION 'eatery_orders must have exactly ONE foreign key (partner_id); created_by has none. found %', v_n;
  END IF;
  SELECT string_agg(conname::text, ', ' ORDER BY conname) INTO v_s FROM pg_constraint
   WHERE conrelid = 'public.eatery_orders'::regclass AND contype = 'c';
  IF v_s IS DISTINCT FROM 'eatery_orders_client_id_check, eatery_orders_code_check, eatery_orders_currency_check, eatery_orders_expires_check, eatery_orders_lines_check, eatery_orders_total_check, eatery_orders_view_count_check' THEN
    RAISE EXCEPTION 'eatery_orders CHECK set is %', v_s;
  END IF;
  RAISE NOTICE 'eatery_orders CHECKs: %', v_s;
  SELECT string_agg(indexdef, E'\n  ' ORDER BY indexname) INTO v_s FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'eatery_orders';
  SELECT count(*) INTO v_n FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'eatery_orders'
     AND indexname IN ('eatery_orders_pkey','eatery_orders_code_key','eatery_orders_created_by_created_at_idx','eatery_orders_partner_created_at_idx','eatery_orders_created_at_idx','eatery_orders_guest_partner_idx');
  IF v_n IS DISTINCT FROM 6 OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'eatery_orders_guest_partner_idx' AND indexdef LIKE '%WHERE created_as_guest%') THEN
    RAISE EXCEPTION 'eatery_orders indexes: % of 6 (guest index must be partial on created_as_guest). %', v_n, v_s;
  END IF;

  -- ── RLS on, ZERO policies, no client privilege of any kind ──
  SELECT c.relrowsecurity INTO v_rls FROM pg_class c WHERE c.oid = 'public.eatery_orders'::regclass;
  IF v_rls IS DISTINCT FROM true THEN RAISE EXCEPTION 'RLS is not enabled on eatery_orders'; END IF;
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'eatery_orders';
  IF v_n IS DISTINCT FROM 0 THEN
    SELECT string_agg(policyname::text, ', ') INTO v_s FROM pg_policies WHERE schemaname = 'public' AND tablename = 'eatery_orders';
    RAISE EXCEPTION 'eatery_orders has % policies (want 0): %', v_n, v_s;
  END IF;
  IF has_table_privilege('anon', 'public.eatery_orders', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('authenticated', 'public.eatery_orders', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_any_column_privilege('anon', 'public.eatery_orders', 'SELECT,INSERT,UPDATE,REFERENCES')
     OR has_any_column_privilege('authenticated', 'public.eatery_orders', 'SELECT,INSERT,UPDATE,REFERENCES') THEN
    RAISE EXCEPTION 'anon or authenticated holds a privilege on eatery_orders';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.eatery_orders', 'SELECT,INSERT,UPDATE,DELETE')
     OR NOT has_table_privilege('postgres', 'public.eatery_orders', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'CONTROL FAILED: service_role / postgres lost their privileges on eatery_orders';
  END IF;

  -- ── Functions: DEFINER, pinned search_path, owner, exact EXECUTE grantees ──
  FOR v_fn IN
    SELECT p.oid, p.proname, p.prosecdef, p.proconfig, p.provolatile, pg_get_userbyid(p.proowner) AS owner,
           CASE p.proname WHEN 'create_eatery_order' THEN 'authenticated' ELSE 'anon,authenticated' END AS want_grantees,
           (SELECT string_agg(DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END, ',' ORDER BY CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END)
              FROM aclexplode(p.proacl) a LEFT JOIN pg_roles r ON r.oid = a.grantee
             WHERE a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner AND r.rolname IS DISTINCT FROM 'service_role') AS grantees
      FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('create_eatery_order','verify_eatery_order')
  LOOP
    IF v_fn.prosecdef IS DISTINCT FROM true OR v_fn.owner IS DISTINCT FROM 'postgres' OR v_fn.provolatile IS DISTINCT FROM 'v'
       OR NOT COALESCE(v_fn.proconfig @> ARRAY['search_path=public, pg_temp'], false) THEN
      RAISE EXCEPTION '%: definer=% owner=% volatility=% config=%', v_fn.proname, v_fn.prosecdef, v_fn.owner, v_fn.provolatile, v_fn.proconfig;
    END IF;
    IF v_fn.grantees IS DISTINCT FROM v_fn.want_grantees THEN
      RAISE EXCEPTION '%: EXECUTE grantees are % (want %)', v_fn.proname, v_fn.grantees, v_fn.want_grantees;
    END IF;
    RAISE NOTICE '% -> definer, owner %, config %, EXECUTE for %', v_fn.proname, v_fn.owner, v_fn.proconfig, v_fn.grantees;
  END LOOP;
  -- The age helper: IMMUTABLE, pinned, no client EXECUTE (positive control: postgres can), and exact decisions.
  SELECT p.provolatile, p.proconfig, pg_get_userbyid(p.proowner) AS owner INTO v_fn FROM pg_proc p WHERE p.oid = to_regprocedure('public.eatery_order_age_gate(date,date)');
  IF v_fn.provolatile IS DISTINCT FROM 'i' OR v_fn.owner IS DISTINCT FROM 'postgres' OR NOT COALESCE(v_fn.proconfig @> ARRAY['search_path=public, pg_temp'], false) THEN
    RAISE EXCEPTION 'eatery_order_age_gate: volatility % owner % config %', v_fn.provolatile, v_fn.owner, v_fn.proconfig;
  END IF;
  IF has_function_privilege('anon', 'public.eatery_order_age_gate(date,date)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.eatery_order_age_gate(date,date)', 'EXECUTE')
     OR NOT has_function_privilege('postgres', 'public.eatery_order_age_gate(date,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'eatery_order_age_gate EXECUTE rights wrong (anon/authenticated must have none, postgres must)';
  END IF;
  IF public.eatery_order_age_gate(NULL, DATE '2026-10-21') IS DISTINCT FROM 'no_dob'
     OR public.eatery_order_age_gate(DATE '2008-10-22', DATE '2026-10-21') IS DISTINCT FROM 'under_18'
     OR public.eatery_order_age_gate(DATE '2008-10-21', DATE '2026-10-21') IS NOT NULL
     OR public.eatery_order_age_gate(DATE '2008-10-20', DATE '2026-10-21') IS NOT NULL
     OR public.eatery_order_age_gate(DATE '1996-10-21', DATE '2026-10-21') IS NOT NULL
     OR public.eatery_order_age_gate(DATE '2000-02-29', DATE '2018-02-28') IS DISTINCT FROM 'under_18'
     OR public.eatery_order_age_gate(DATE '2000-02-29', DATE '2018-03-01') IS NOT NULL
     OR public.eatery_order_age_gate(DATE '2000-02-29', DATE '2024-02-29') IS NOT NULL
     OR public.eatery_order_age_gate(DATE '2000-01-01', NULL) IS DISTINCT FROM 'under_18' THEN
    RAISE EXCEPTION 'eatery_order_age_gate decisions are wrong (age gate: NULL dob, birthday tomorrow/today, 30 y, Feb-29, NULL today)';
  END IF;

  SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('create_eatery_order','verify_eatery_order');
  IF v_n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'expected exactly 2 order functions, found %', v_n; END IF;
  IF NOT has_function_privilege('authenticated', 'public.create_eatery_order(uuid,jsonb,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.create_eatery_order(uuid,jsonb,text)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.verify_eatery_order(text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.verify_eatery_order(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'function EXECUTE rights are not as designed';
  END IF;
  v_def := pg_get_functiondef('public.verify_eatery_order(text)'::regprocedure);
  IF v_def NOT LIKE '%''first_viewed_at_before''%' OR v_def LIKE '%''created_by''%' OR v_def LIKE '%''client_id''%' THEN
    RAISE EXCEPTION 'verify_eatery_order body: expected the *_before keys and no created_by / client_id key';
  END IF;

  -- ── Cron: exactly one job, active, the 30-day delete ──
  SELECT count(*), max(command), max(schedule) INTO v_n, v_s, v_def FROM cron.job WHERE jobname = 'eatery-orders-retention' AND active;
  IF v_n IS DISTINCT FROM 1 OR v_s NOT LIKE '%DELETE FROM public.eatery_orders%' OR v_s NOT LIKE '%interval ''30 days''%' OR v_def IS DISTINCT FROM '40 3 * * *' THEN
    RAISE EXCEPTION 'cron job eatery-orders-retention: % active rows, schedule %, command %', v_n, v_def, v_s;
  END IF;
  RAISE NOTICE 'cron: eatery-orders-retention [%] %', v_def, v_s;

  -- ── Behavioural probes (throwaway partners; a sentinel rolls everything back) ──
  SELECT count(*) INTO v_pre_orders FROM public.eatery_orders;
  SELECT count(*) INTO v_pre_keys FROM private.preview_key_hashes;
  SELECT count(*) INTO v_pre_partners FROM public.eatery_partners;

  BEGIN
    INSERT INTO private.preview_key_hashes (hash, label) VALUES (encode(sha256(convert_to(c_key, 'UTF8')), 'hex'), 'zz probe 1125');
    INSERT INTO public.eatery_partners (slug, name, category, lat, lng, geocode_source, logo_path, menu_verified_on, is_active)
      VALUES ('zz-oa', 'zz order A', 'cafe', 35.1, 33.3, 'partner', 'zz-oa/logo.png', current_date, true) RETURNING id INTO v_pa;
    INSERT INTO public.eatery_partners (slug, name, category, lat, lng, geocode_source, logo_path, menu_verified_on, is_active)
      VALUES ('zz-ob', 'zz order B', 'cafe', 35.1, 33.3, 'partner', 'zz-ob/logo.png', current_date, true) RETURNING id INTO v_pb;
    INSERT INTO public.eatery_partners (slug, name, category, is_active) VALUES ('zz-oi', 'zz order inactive', 'cafe', false) RETURNING id INTO v_pi;
    INSERT INTO public.eatery_partners (slug, name, category, lat, lng, geocode_source, logo_path, menu_verified_on, is_active, order_requires_account)
      VALUES ('zz-or', 'zz order signin', 'cafe', 35.1, 33.3, 'partner', 'zz-or/logo.png', current_date, true, true) RETURNING id INTO v_pr;
    INSERT INTO public.eatery_partners (slug, name, category, lat, lng, geocode_source, logo_path, menu_verified_on, is_active)
      VALUES ('zz-ol', 'zz order limit', 'cafe', 35.1, 33.3, 'partner', 'zz-ol/logo.png', current_date, true) RETURNING id INTO v_pl;
    INSERT INTO public.eatery_menu_items (partner_id, section, name, price, currency) VALUES (v_pa, 'zz', 'zz dish 1', 10.00, 'TRY') RETURNING id INTO v_a1;
    INSERT INTO public.eatery_menu_items (partner_id, section, name, price, currency) VALUES (v_pa, 'zz', 'zz dish 2', 5.50, 'TRY') RETURNING id INTO v_a2;
    INSERT INTO public.eatery_menu_items (partner_id, section, name, price, currency, is_available) VALUES (v_pa, 'zz', 'zz sold out', 7.00, 'TRY', false) RETURNING id INTO v_a3;
    INSERT INTO public.eatery_menu_items (partner_id, section, name, price, currency) VALUES (v_pa, 'zz', 'zz no price', NULL, 'TRY') RETURNING id INTO v_a4;
    INSERT INTO public.eatery_menu_items (partner_id, section, name, price, currency) VALUES (v_pa, 'zz', 'zz euro dish', 3.00, 'EUR') RETURNING id INTO v_ae;
    INSERT INTO public.eatery_menu_items (partner_id, section, name, price, currency) VALUES (v_pb, 'zz', 'zz other partner dish', 4.00, 'TRY') RETURNING id INTO v_b1;
    INSERT INTO public.eatery_menu_items (partner_id, section, name, price, currency) VALUES (v_pi, 'zz', 'zz inactive dish', 6.00, 'TRY') RETURNING id INTO v_i1;
    INSERT INTO public.eatery_menu_items (partner_id, section, name, price, currency) VALUES (v_pr, 'zz', 'zz signin dish', 2.00, 'TRY') RETURNING id INTO v_r1;
    INSERT INTO public.eatery_menu_items (partner_id, section, name, price, currency) VALUES (v_pl, 'zz', 'zz limit dish', 1.00, 'TRY') RETURNING id INTO v_l1;
    INSERT INTO public.eatery_partners (slug, name, category, lat, lng, geocode_source, logo_path, menu_verified_on, is_active)
      VALUES ('zz-om', 'zz order mixed', 'cafe', 35.1, 33.3, 'partner', 'zz-om/logo.png', current_date, true) RETURNING id INTO v_pm;
    INSERT INTO public.eatery_menu_items (partner_id, section, name, price, currency) VALUES (v_pm, 'zz', 'zz mixed dish', 1.00, 'TRY') RETURNING id INTO v_m1;

    INSERT INTO public.eatery_partners (slug, name, category, lat, lng, geocode_source, logo_path, menu_verified_on, is_active, adult_only)
      VALUES ('zz-oad', 'zz order adult', 'cafe', 35.1, 33.3, 'partner', 'zz-oad/logo.png', current_date, true, true) RETURNING id INTO v_pad;
    INSERT INTO public.eatery_menu_items (partner_id, section, name, price, currency) VALUES (v_pad, 'zz', 'zz adult dish', 9.00, 'TRY') RETURNING id INTO v_ad1;
    -- Seed rows as postgres: 60 fresh orders on the limit partner; an expired order; 5 two-hour-old orders for user 7.
    INSERT INTO public.eatery_orders (code, partner_id, lines, total, currency, created_by)
      SELECT 'ZZ' || lpad(translate(g::text, '01', 'AB'), 6, 'C'), v_pl, '[{"item_id":1,"name":"x","qty":1,"unit_price":1}]'::jsonb, 1, 'TRY', gen_random_uuid()
        FROM generate_series(1, 60) g;
    UPDATE public.eatery_orders SET created_as_guest = true WHERE partner_id = v_pl;
    INSERT INTO public.eatery_orders (code, partner_id, lines, total, currency, created_by)
      SELECT 'YY' || lpad(translate(g::text, '01', 'AB'), 6, 'C'), v_pm, '[{"item_id":1,"name":"x","qty":1,"unit_price":1}]'::jsonb, 1, 'TRY', gen_random_uuid()
        FROM generate_series(1, 60) g;
    INSERT INTO public.eatery_orders (code, partner_id, lines, total, currency, created_by, created_at, expires_at)
      VALUES ('EXP2RED3', v_pa, '[{"item_id":1,"name":"old dish","qty":2,"unit_price":3.5}]'::jsonb, 7, 'TRY', gen_random_uuid(), now() - interval '3 hours', now() - interval '1 hour');
    INSERT INTO public.eatery_orders (code, partner_id, lines, total, currency, created_by, created_at, expires_at)
      SELECT 'PQ' || lpad(translate(g::text, '01', 'AB'), 6, 'D'), v_pa, '[{"item_id":1,"name":"x","qty":1,"unit_price":1}]'::jsonb, 1, 'TRY',
             '00000000-0000-4000-8000-000000000007', now() - interval '2 hours', now() - interval '1 hour' + (g || ' seconds')::interval
        FROM generate_series(1, 5) g;

    -- Steps: (label, who, hdr, sql, want, save). who = anon | user:N | guest:N | nosub | pg ; hdr = '' | 'key'.
    -- want = ok | err:<message> | state:<sqlstate>.
    FOR s IN SELECT * FROM (VALUES
      -- raw table access: every client verb refused (state 42501), postgres control works
      ('anon SELECT table',  'anon',    '', 'SELECT to_jsonb(count(*)) FROM public.eatery_orders', 'state:42501', NULL),
      ('anon INSERT table',  'anon',    '', $q$WITH i AS (INSERT INTO public.eatery_orders (code, partner_id, lines, total, currency, created_by) VALUES ('ABCDEFGH', '00000000-0000-4000-8000-0000000000aa', '[1]', 1, 'TRY', '00000000-0000-4000-8000-000000000001') RETURNING 1) SELECT to_jsonb(count(*)) FROM i$q$, 'state:42501', NULL),
      ('auth SELECT table', 'user:1',  '', 'SELECT to_jsonb(count(*)) FROM public.eatery_orders', 'state:42501', NULL),
      ('guest SELECT table', 'guest:1', '', 'SELECT to_jsonb(count(*)) FROM public.eatery_orders', 'state:42501', NULL),
      ('auth INSERT table',  'user:1',  '', $q$WITH i AS (INSERT INTO public.eatery_orders (code, partner_id, lines, total, currency, created_by) VALUES ('ABCDEFGH', '00000000-0000-4000-8000-0000000000aa', '[1]', 1, 'TRY', '00000000-0000-4000-8000-000000000001') RETURNING 1) SELECT to_jsonb(count(*)) FROM i$q$, 'state:42501', NULL),
      ('auth UPDATE table',  'user:1',  '', 'WITH u AS (UPDATE public.eatery_orders SET view_count = 0 RETURNING 1) SELECT to_jsonb(count(*)) FROM u', 'state:42501', NULL),
      ('auth DELETE table',  'user:1',  '', 'WITH d AS (DELETE FROM public.eatery_orders RETURNING 1) SELECT to_jsonb(count(*)) FROM d', 'state:42501', NULL),
      ('CONTROL postgres SELECT table', 'pg', '', 'SELECT to_jsonb(count(*)) FROM public.eatery_orders', 'ok', 'pgcount'),
      ('anon create (no EXECUTE)', 'anon', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1))), 'state:42501', NULL),
      -- create: happy path with a FORGED price and name
      ('create with forged price', 'user:1', '', format('SELECT public.create_eatery_order(%L, %L::jsonb, %L)', v_pa,
          jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 2, 'price', 0.01, 'unit_price', 0.01, 'name', 'hacked'), jsonb_build_object('item_id', v_a2, 'qty', 1)),
          'probe-client-0001'), 'ok', 'o1'),
      ('create: another partner''s item', 'user:2', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_b1, 'qty', 1))), 'err:item_unavailable', NULL),
      ('create: unavailable item', 'user:2', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a3, 'qty', 1))), 'err:item_unavailable', NULL),
      ('create: NULL-price item', 'user:2', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a4, 'qty', 1))), 'err:item_unavailable', NULL),
      ('create: nonexistent item', 'user:2', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', 999999999999, 'qty', 1))), 'err:item_unavailable', NULL),
      ('create: one good + one bad item', 'user:2', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1), jsonb_build_object('item_id', v_a3, 'qty', 1))), 'err:item_unavailable', NULL),
      ('create: mixed currency', 'user:2', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1), jsonb_build_object('item_id', v_ae, 'qty', 1))), 'err:mixed_currency', NULL),
      ('create: duplicate item_id', 'user:2', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1), jsonb_build_object('item_id', v_a1, 'qty', 2))), 'err:invalid_items', NULL),
      ('create: qty 0', 'user:2', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 0))), 'err:invalid_items', NULL),
      ('create: qty 100', 'user:2', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 100))), 'err:invalid_items', NULL),
      ('create: qty 1.5', 'user:2', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1.5))), 'err:invalid_items', NULL),
      ('create: qty as string', 'user:2', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', '2'))), 'err:invalid_items', NULL),
      ('create: item_id as string', 'user:2', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1::text, 'qty', 1))), 'err:invalid_items', NULL),
      ('create: empty array', 'user:2', '', format('SELECT public.create_eatery_order(%L, ''[]''::jsonb)', v_pa), 'err:invalid_items', NULL),
      ('create: object not array', 'user:2', '', format('SELECT public.create_eatery_order(%L, ''{}''::jsonb)', v_pa), 'err:invalid_items', NULL),
      ('create: NULL items', 'user:2', '', format('SELECT public.create_eatery_order(%L, NULL)', v_pa), 'err:invalid_items', NULL),
      ('create: 31 items', 'user:2', '', format('SELECT public.create_eatery_order(%L, (SELECT jsonb_agg(jsonb_build_object(''item_id'', g, ''qty'', 1)) FROM generate_series(1, 31) g))', v_pa), 'err:invalid_items', NULL),
      ('create: bad client_id', 'user:2', '', format('SELECT public.create_eatery_order(%L, %L::jsonb, ''x'')', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1))), 'err:invalid_client_id', NULL),
      ('create: no sub claim', 'nosub', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1))), 'err:not_authenticated', NULL),
      ('create: unknown partner', 'user:2', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', gen_random_uuid(), jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1))), 'err:partner_unavailable', NULL),
      -- preview path (inactive partner)
      ('create inactive partner, no preview key', 'user:2', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pi, jsonb_build_array(jsonb_build_object('item_id', v_i1, 'qty', 1))), 'err:partner_unavailable', NULL),
      ('create inactive partner, WRONG preview key', 'user:2', 'wrong', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pi, jsonb_build_array(jsonb_build_object('item_id', v_i1, 'qty', 1))), 'err:partner_unavailable', NULL),
      ('create inactive partner, preview key', 'user:2', 'key', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pi, jsonb_build_array(jsonb_build_object('item_id', v_i1, 'qty', 1))), 'ok', 'oi'),
      -- 18+ rule (adult_only partner): refusals write no row and use no quota; the 18th birthday TODAY is adult
      ('adult_only: guest refused', 'guest:10', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pad, jsonb_build_array(jsonb_build_object('item_id', v_ad1, 'qty', 1))), 'err:adult_only|guest', NULL),
      ('adult_only: signed-in with no profile row, refused', 'user:15', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pad, jsonb_build_array(jsonb_build_object('item_id', v_ad1, 'qty', 1))), 'err:adult_only|no_dob', NULL),
      -- order_requires_account
      ('guest create, partner requires account', 'guest:3', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pr, jsonb_build_array(jsonb_build_object('item_id', v_r1, 'qty', 1))), 'err:order_requires_account', NULL),
      ('CONTROL signed-in create, partner requires account', 'user:3', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pr, jsonb_build_array(jsonb_build_object('item_id', v_r1, 'qty', 1))), 'ok', NULL),
      ('CONTROL guest create, normal partner', 'guest:3', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1))), 'ok', NULL),
      -- per-user limit: five succeed, the sixth is refused (even on another partner), a different user succeeds
      ('user 4 order 1', 'user:4', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1))), 'ok', NULL),
      ('user 4 order 2', 'user:4', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1))), 'ok', NULL),
      ('user 4 order 3', 'user:4', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1))), 'ok', NULL),
      ('user 4 order 4', 'user:4', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1))), 'ok', NULL),
      ('user 4 order 5', 'user:4', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1))), 'ok', NULL),
      ('user 4 order 6 REFUSED', 'user:4', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1))), 'err:rate_limited|user', NULL),
      ('user 4 order 6 on another partner REFUSED', 'user:4', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pb, jsonb_build_array(jsonb_build_object('item_id', v_b1, 'qty', 1))), 'err:rate_limited|user', NULL),
      ('CONTROL user 5 succeeds while user 4 is limited', 'user:5', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1))), 'ok', NULL),
      ('CONTROL user 7 (5 orders 2 h old) succeeds', 'user:7', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1))), 'ok', NULL),
      -- per-partner limit: 60 fresh orders on the limit partner
      ('partner at 60 GUEST orders/h REFUSES a fresh guest', 'guest:6', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pl, jsonb_build_array(jsonb_build_object('item_id', v_l1, 'qty', 1))), 'err:rate_limited|partner', NULL),
      ('CONTROL signed-in user NOT blocked by the guest cap', 'user:6', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pl, jsonb_build_array(jsonb_build_object('item_id', v_l1, 'qty', 1))), 'ok', 'ug'),
      ('60 NON-guest orders/h do not block a guest', 'guest:8', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pm, jsonb_build_array(jsonb_build_object('item_id', v_m1, 'qty', 1))), 'ok', 'gm'),
      ('CONTROL same user, other partner, succeeds', 'user:6', '', format('SELECT public.create_eatery_order(%L, %L::jsonb)', v_pa, jsonb_build_array(jsonb_build_object('item_id', v_a1, 'qty', 1))), 'ok', NULL),
      -- verify
      ('verify unknown code', 'anon', '', $q$SELECT public.verify_eatery_order('ZZZZZZZZ')$q$, 'ok', 'vunknown'),
      ('verify too short', 'anon', '', $q$SELECT public.verify_eatery_order('abc')$q$, 'ok', 'vshort'),
      ('verify NULL', 'anon', '', 'SELECT public.verify_eatery_order(NULL)', 'ok', 'vnull'),
      ('verify forbidden characters', 'anon', '', $q$SELECT public.verify_eatery_order('0OIL1111')$q$, 'ok', 'vchars'),
      ('verify first view (anon)', 'anon', '', $q$SELECT public.verify_eatery_order('{{code:o1}}')$q$, 'ok', 'v1'),
      ('verify second view (user)', 'user:9', '', $q$SELECT public.verify_eatery_order('{{code:o1}}')$q$, 'ok', 'v2'),
      ('verify lower-case, dashed, spaced', 'anon', '', $q$SELECT public.verify_eatery_order(lower(substr('{{code:o1}}', 1, 4)) || '- ' || lower(substr('{{code:o1}}', 5)))$q$, 'ok', 'v3'),
      ('verify expired order', 'anon', '', $q$SELECT public.verify_eatery_order('EXP2RED3')$q$, 'ok', 'vexp'),
      ('CONTROL verify of the preview-key order', 'anon', '', $q$SELECT public.verify_eatery_order('{{code:oi}}')$q$, 'ok', 'voi')
    ) AS x(label, who, hdr, sql, want, save) LOOP
      v_sql := replace(replace(s.sql, '{{code:o1}}', COALESCE(v_saved -> 'o1' ->> 'code', 'MISSING0')),
                       '{{code:oi}}', COALESCE(v_saved -> 'oi' ->> 'code', 'MISSING0'));
      v_role := CASE WHEN s.who = 'anon' THEN 'anon' WHEN s.who = 'pg' THEN NULL ELSE 'authenticated' END;
      v_claims := CASE
        WHEN s.who = 'anon' OR s.who = 'pg' THEN ''
        WHEN s.who = 'nosub' THEN json_build_object('role', 'authenticated')::text
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

    -- ── Result content ──
    v_o := v_saved -> 'o1';
    IF v_o ->> 'code' !~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$' THEN RAISE EXCEPTION 'order code shape: %', v_o ->> 'code'; END IF;
    IF (v_o ->> 'total')::numeric IS DISTINCT FROM 25.50 OR v_o ->> 'currency' IS DISTINCT FROM 'TRY' THEN
      RAISE EXCEPTION 'forged price was trusted or total wrong: % %', v_o ->> 'total', v_o ->> 'currency';
    END IF;
    IF (v_o -> 'lines' -> 0 ->> 'unit_price')::numeric IS DISTINCT FROM 10.00 OR v_o -> 'lines' -> 0 ->> 'name' IS DISTINCT FROM 'zz dish 1'
       OR (v_o -> 'lines' -> 0 ->> 'qty')::int IS DISTINCT FROM 2 OR (v_o -> 'lines' -> 1 ->> 'unit_price')::numeric IS DISTINCT FROM 5.50
       OR jsonb_array_length(v_o -> 'lines') IS DISTINCT FROM 2 THEN
      RAISE EXCEPTION 'stored lines are not the database lines: %', v_o -> 'lines';
    END IF;
    IF (v_o ->> 'expires_at')::timestamptz NOT BETWEEN now() + interval '119 minutes' AND now() + interval '121 minutes' THEN
      RAISE EXCEPTION 'expires_at is not ~2 hours ahead: %', v_o ->> 'expires_at';
    END IF;
    SELECT count(*) INTO v_n FROM public.eatery_orders WHERE code = v_o ->> 'code' AND created_by = '00000000-0000-4000-8000-000000000001'
       AND client_id = 'probe-client-0001' AND total = 25.50 AND (lines -> 0 ->> 'unit_price')::numeric = 10.00;
    IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'stored row for o1 not as expected (% matching)', v_n; END IF;

    IF v_saved -> 'vunknown' ->> 'status' IS DISTINCT FROM 'not_found' OR v_saved -> 'vshort' ->> 'status' IS DISTINCT FROM 'not_found'
       OR v_saved -> 'vnull' ->> 'status' IS DISTINCT FROM 'not_found' OR v_saved -> 'vchars' ->> 'status' IS DISTINCT FROM 'not_found' THEN
      RAISE EXCEPTION 'verify of unknown / malformed codes: % % % %', v_saved -> 'vunknown', v_saved -> 'vshort', v_saved -> 'vnull', v_saved -> 'vchars';
    END IF;
    IF (v_saved -> 'vunknown') <> '{"status":"not_found"}'::jsonb THEN RAISE EXCEPTION 'not_found must carry no other key: %', v_saved -> 'vunknown'; END IF;
    IF v_saved -> 'v1' ->> 'status' IS DISTINCT FROM 'ok' OR (v_saved -> 'v1' ->> 'view_count_before')::int IS DISTINCT FROM 0
       OR v_saved -> 'v1' -> 'first_viewed_at_before' IS DISTINCT FROM 'null'::jsonb THEN
      RAISE EXCEPTION 'first verify: %', v_saved -> 'v1';
    END IF;
    IF v_saved -> 'v2' ->> 'status' IS DISTINCT FROM 'ok' OR (v_saved -> 'v2' ->> 'view_count_before')::int IS DISTINCT FROM 1
       OR (v_saved -> 'v2' ->> 'first_viewed_at_before') IS NULL THEN
      RAISE EXCEPTION 'second verify must show view_count_before = 1 and a first_viewed_at_before: %', v_saved -> 'v2';
    END IF;
    IF v_saved -> 'v3' ->> 'status' IS DISTINCT FROM 'ok' OR (v_saved -> 'v3' ->> 'view_count_before')::int IS DISTINCT FROM 2 THEN
      RAISE EXCEPTION 'normalised (lower-case, dash, space) verify: %', v_saved -> 'v3';
    END IF;
    SELECT array_agg(k ORDER BY k) INTO v_keys FROM jsonb_object_keys(v_saved -> 'v1') k;
    IF v_keys IS DISTINCT FROM ARRAY['created_at','currency','expires_at','first_viewed_at_before','lines','partner_name','status','total','view_count_before'] THEN
      RAISE EXCEPTION 'verify result keys are %', v_keys;
    END IF;
    IF (v_saved -> 'v1')::text ~ '(created_by|client_id|item_id|probe-client|00000000-0000-4000)' THEN
      RAISE EXCEPTION 'verify result leaks an identifier: %', v_saved -> 'v1';
    END IF;
    SELECT array_agg(k ORDER BY k) INTO v_keys FROM jsonb_object_keys(v_saved -> 'v1' -> 'lines' -> 0) k;
    IF v_keys IS DISTINCT FROM ARRAY['name','qty','unit_price'] OR v_saved -> 'v1' ->> 'partner_name' IS DISTINCT FROM 'zz order A'
       OR (v_saved -> 'v1' ->> 'total')::numeric IS DISTINCT FROM 25.50 THEN
      RAISE EXCEPTION 'verify line keys % / partner / total wrong: %', v_keys, v_saved -> 'v1';
    END IF;
    IF v_saved -> 'vexp' ->> 'status' IS DISTINCT FROM 'expired' OR v_saved -> 'vexp' -> 'lines' -> 0 ->> 'name' IS DISTINCT FROM 'old dish' THEN
      RAISE EXCEPTION 'expired order: %', v_saved -> 'vexp';
    END IF;
    SELECT count(*) INTO v_n FROM public.eatery_orders WHERE code IN (v_saved -> 'ug' ->> 'code', v_saved -> 'gm' ->> 'code')
       AND created_as_guest = (code = v_saved -> 'gm' ->> 'code');
    IF v_n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'created_as_guest not stored from the session (signed-in = false, guest = true): % of 2', v_n; END IF;
    SELECT count(*) INTO v_n FROM public.eatery_orders WHERE created_by IN
      ('00000000-0000-4000-8000-000000000015','00000000-0000-4000-8000-000000000010');
    IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'an 18+ refusal still wrote % order row(s)', v_n; END IF;
    SELECT view_count INTO v_n FROM public.eatery_orders WHERE code = v_o ->> 'code';
    IF v_n IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'view_count after 3 verifies is %', v_n; END IF;
    IF (v_saved -> 'pgcount' #>> '{}')::int IS DISTINCT FROM v_pre_orders + 126 THEN
      RAISE EXCEPTION 'CONTROL: postgres saw % rows before any create, expected % (pre) + 66 seeded', v_saved -> 'pgcount', v_pre_orders;
    END IF;

    -- RLS alone (policies = 0) must hide rows even if a privilege were granted back: GRANT inside the sentinel.
    GRANT SELECT ON public.eatery_orders TO authenticated;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
    SELECT count(*) INTO v_n FROM public.eatery_orders;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'RLS with zero policies let authenticated read % rows once SELECT was granted', v_n; END IF;
    SELECT count(*) INTO v_n FROM public.eatery_orders;
    IF v_n < 60 THEN RAISE EXCEPTION 'CONTROL: postgres sees only % rows', v_n; END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'zz-sentinel';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'zz-sentinel' THEN RAISE; END IF;
  END;
  RESET ROLE;

  -- Nothing survived the sentinel.
  IF (SELECT count(*) FROM public.eatery_orders) IS DISTINCT FROM v_pre_orders
     OR (SELECT count(*) FROM private.preview_key_hashes) IS DISTINCT FROM v_pre_keys
     OR (SELECT count(*) FROM public.eatery_partners) IS DISTINCT FROM v_pre_partners
     OR EXISTS (SELECT 1 FROM public.eatery_partners WHERE slug LIKE 'zz-o%')
     OR has_table_privilege('authenticated', 'public.eatery_orders', 'SELECT') THEN
    RAISE EXCEPTION 'probe rows or the probe GRANT survived the sentinel';
  END IF;
  RAISE NOTICE 'order probes (all as stated; expected-error steps matched SQLSTATE/message):%', v_report;
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
VALUES ('20261125_eatery_orders.sql', '8d2b4aec3bea7587556434d8cdcac4bf2cac410be083e1f6c59f1b982e621d5a')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: every 20261125_eatery_orders row must read OK.
--
-- ─── Rollback (only if abandoned) ───────────────────────────────────────────
--   SELECT cron.unschedule('eatery-orders-retention');
--   DROP FUNCTION IF EXISTS public.verify_eatery_order(text);
--   DROP FUNCTION IF EXISTS public.create_eatery_order(uuid, jsonb, text);
--   DROP TABLE IF EXISTS public.eatery_orders;
--   ALTER TABLE public.eatery_partners DROP COLUMN IF EXISTS order_requires_account;
