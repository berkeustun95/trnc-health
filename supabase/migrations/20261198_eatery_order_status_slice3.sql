-- ═══════════════════════════════════════════════════════════════════════════
-- 20261198 — Yeme-İçme order status, slice 3 DB: restaurant re-checks are not views, "forget this device" frees its slot,
--            the 18+ gate's "today" is the Cyprus date
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DATABASE ONLY. Needs 20261193 + 20261194 (it refuses to run otherwise). The Worker change that calls (b) ships separately.
--
-- (a) verify_eatery_order(p_code, p_device): a call whose p_device CAN MANAGE this order (Worker key present AND an un-revoked
--     enrolled device of this order's partner, or a test-scope device on a TEST order: eatery_order_can_manage, unchanged) no
--     longer counts as a view (view_count and first_viewed_at stay as they are). Every other call counts exactly as before: a
--     customer, an anonymous page, a device token without the Worker key, a revoked device, another partner's device. Signature,
--     grants and returned keys unchanged (view_count_before / first_viewed_at_before are still the values before this call).
--     Berke, 2026-11-13: "signed-in restaurant phones don't count".
-- (b) public.eatery_partner_device_revoke(p_device text) RETURNS jsonb: the Worker's "Bu cihazı unut / Forget this device".
--     forbidden unless the request carries the Worker key (checked first, exactly like eatery_partner_enrol). A token that is
--     not 96 lowercase hex characters (the enrol format) changes nothing. Otherwise it sets revoked_at on the ONE live device
--     row whose token_sha256 is the sha256 of p_device (the same hash the device helpers use), freeing that slot of the
--     5-device cap. Returns {status: 'ok'} whether or not a row matched, so it is no oracle for which tokens exist. Never raises.
-- (c) create_eatery_order: the 18+ gate's "today" is (now() AT TIME ZONE 'Europe/Nicosia')::date instead of 'Europe/Istanbul'.
--     Istanbul is fixed UTC+3; Cyprus is UTC+2 in winter, so in winter the gate's date turned over at 23:00 Cyprus time. That
--     ONE line is the only change: the body is the 20261193 body carried forward (the harness line-diffs the two renderings).
--
-- ─── WHO CAN READ / WRITE WHAT ──────────────────────────────────────────────
--   • No table, policy or grant on a table changes. eatery_orders keeps zero policies; the private tables keep no client access.
--   • verify_eatery_order: anon + authenticated, as before (anyone holding the order code). It returns exactly what it returned;
--     the only difference is that a managing restaurant phone's call writes nothing.
--   • eatery_partner_device_revoke: anon + authenticated EXECUTE (no PUBLIC), but the body answers forbidden and writes nothing
--     unless the request carries the Worker key, which only the getadaapp Worker holds. With the key, it can revoke only the
--     device whose 96-hex token the caller already holds (the token lives in that phone's HttpOnly cookie). It writes only
--     private.eatery_partner_devices.revoked_at of that one row and returns no row data. No customer data is touched.
--   • create_eatery_order: authenticated only (guests included), as before; grants unchanged.
--
-- PROOF (inside this file): pre-state (ledger rows, live bodies are the 20261193 / 20261194 shapes or already this file's);
-- post-state: one overload of each function, DEFINER / owner / search_path / grants, body shapes (the managing check BEFORE the
-- view UPDATE, which sits inside IF NOT; the key gate first in revoke, its format check and its single-row UPDATE, no DELETE, no
-- RAISE; create carries Europe/Nicosia and no Europe/Istanbul), and Europe/Nicosia on fixed instants (winter UTC+2, summer UTC+3)
-- in this server's tz data. Behaviour (view counted vs not, the freed slot, denials with positive controls, the Nicosia boundary)
-- is proven in the harness: scripts/test-eatery-order-status-sql.mjs. Nothing printed carries a count, a code or an id.
--
-- Apply: gh workflow run supabase-migrate (dry), then apply=true after Berke's go. Re-runnable (CREATE OR REPLACE). A new
-- function signature => ends with NOTIFY pgrst.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── Pre-state (abort before changing anything) ─────────────────────────────
DO $$
DECLARE
  v_cdef text; v_vdef text;
BEGIN
  IF to_regclass('public.schema_migrations_applied') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.schema_migrations_applied WHERE filename = '20261193_eatery_order_status.sql')
     OR NOT EXISTS (SELECT 1 FROM public.schema_migrations_applied WHERE filename = '20261194_eatery_order_status_partner.sql') THEN
    RAISE EXCEPTION 'pre-state: 20261193 / 20261194 are not both in the ledger. Nothing applied.';
  END IF;
  IF to_regprocedure('public.create_eatery_order(uuid,jsonb,text,text)') IS NULL
     OR to_regprocedure('public.verify_eatery_order(text,text)') IS NULL
     OR to_regprocedure('public.eatery_order_can_manage(uuid,boolean,text)') IS NULL
     OR to_regprocedure('public.eatery_order_device_id(uuid,boolean,text)') IS NULL
     OR to_regprocedure('public.eatery_worker_key_ok()') IS NULL
     OR to_regprocedure('public.eatery_order_age_gate(date,date)') IS NULL
     OR to_regclass('private.eatery_partner_devices') IS NULL THEN
    RAISE EXCEPTION 'pre-state: create / verify / can_manage / device_id / worker_key_ok / age_gate / private.eatery_partner_devices missing. Nothing applied.';
  END IF;
  v_cdef := pg_get_functiondef(to_regprocedure('public.create_eatery_order(uuid,jsonb,text,text)'));
  IF (position('v_gate := public.eatery_order_age_gate(v_dob, (now() AT TIME ZONE ''Europe/Istanbul'')::date);' IN v_cdef) = 0
      AND position('v_gate := public.eatery_order_age_gate(v_dob, (now() AT TIME ZONE ''Europe/Nicosia'')::date);' IN v_cdef) = 0)
     OR position('MESSAGE = ''invalid_mode''' IN v_cdef) = 0
     OR position('MESSAGE = ''order_not_supported''' IN v_cdef) = 0
     OR position('client_id, created_as_guest, is_test, fulfilment)' IN v_cdef) = 0 THEN
    RAISE EXCEPTION 'pre-state: the live create_eatery_order is not the 20261193 body (or this file''s). Nothing applied.';
  END IF;
  v_vdef := pg_get_functiondef(to_regprocedure('public.verify_eatery_order(text,text)'));
  IF position('view_count = view_count + 1' IN v_vdef) = 0
     OR position('eatery_order_can_manage(v_o.partner_id, v_o.is_test, p_device)' IN v_vdef) = 0
     OR position('''can_manage'',' IN v_vdef) = 0 THEN
    RAISE EXCEPTION 'pre-state: the live verify_eatery_order is not the 20261193 body (or this file''s). Nothing applied.';
  END IF;
  RAISE NOTICE 'pre-state ok: 20261193 + 20261194 applied, create / verify bodies as expected';
END $$;

-- ─── (a) verify_eatery_order: a managing device's call is not a view ────────
CREATE OR REPLACE FUNCTION public.verify_eatery_order(p_code text, p_device text DEFAULT NULL)
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
  v_enabled boolean;
  v_open    boolean;
  v_can     boolean;
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

  -- 20261198: a phone that can manage this order (Worker key + its enrolled device) re-reading the page is not a view.
  v_can  := public.eatery_order_can_manage(v_o.partner_id, v_o.is_test, p_device);
  IF NOT COALESCE(v_can, false) THEN
    UPDATE public.eatery_orders
       SET first_viewed_at = COALESCE(first_viewed_at, now()), view_count = view_count + 1
     WHERE id = v_o.id;
  END IF;

  SELECT name, order_status_enabled INTO v_name, v_enabled FROM public.eatery_partners WHERE id = v_o.partner_id;
  v_open := now() < v_o.created_at + interval '12 hours' AND v_o.status NOT IN ('on_the_way','ready','cancelled');
  SELECT jsonb_agg(jsonb_build_object('name', l -> 'name', 'qty', l -> 'qty', 'unit_price', l -> 'unit_price', 'detail', l -> 'detail') ORDER BY t.ord)
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
    'is_test',                v_o.is_test,
    'fulfilment',             v_o.fulfilment,
    'order_status',           v_o.status,
    'status_at',              v_o.status_at,
    'cancel_reason',          v_o.cancel_reason,
    'status_open',            v_open,
    'status_enabled',         COALESCE(v_enabled, false),
    'can_manage',             COALESCE(v_can, false),
    'next',                   CASE WHEN COALESCE(v_can, false) AND v_open AND (v_o.is_test OR COALESCE(v_enabled, false))
                                   THEN to_jsonb(public.eatery_order_next_statuses(v_o.status, v_o.fulfilment))
                                   ELSE '[]'::jsonb END);
END;
$fn$;
ALTER FUNCTION public.verify_eatery_order(text, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.verify_eatery_order(text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.verify_eatery_order(text, text) TO anon, authenticated;
COMMENT ON FUNCTION public.verify_eatery_order(text, text) IS
  'Partner-side check of a WhatsApp order code (anon + authenticated). Returns {status ok|expired|not_found, partner_name, created_at, expires_at, lines[name,qty,unit_price,detail], total, currency, first_viewed_at_before, view_count_before, is_test, fulfilment, order_status, status_at, cancel_reason, status_open (under 12 h and not final), status_enabled, can_manage (this p_device may change the status), next (the statuses it may move to; empty unless can_manage and status_open and (test order or status_enabled))}. Counts the call as a view UNLESS can_manage is true (a signed-in restaurant phone re-reading its order is not a view). Never returns created_by, client_id, item ids, option ids, notify_token or notify_lang. 20261193, view rule 20261198.';

-- ─── (b) eatery_partner_device_revoke: "forget this device" frees its slot ──
CREATE OR REPLACE FUNCTION public.eatery_partner_device_revoke(p_device text)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- Never raises; the same answer whether or not a device matched (no oracle for which tokens exist).
  IF NOT public.eatery_worker_key_ok() THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;
  IF p_device IS NULL OR p_device !~ '^[0-9a-f]{96}$' THEN
    RETURN jsonb_build_object('status', 'ok');
  END IF;
  UPDATE private.eatery_partner_devices d
     SET revoked_at = now()
   WHERE d.token_sha256 = encode(sha256(convert_to(p_device, 'UTF8')), 'hex')
     AND d.revoked_at IS NULL;
  RETURN jsonb_build_object('status', 'ok');
END;
$fn$;
ALTER FUNCTION public.eatery_partner_device_revoke(text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.eatery_partner_device_revoke(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.eatery_partner_device_revoke(text) TO anon, authenticated;
COMMENT ON FUNCTION public.eatery_partner_device_revoke(text) IS
  'The Worker''s "forget this device": sets revoked_at on the one live enrolled device whose token this is (sha256, any partner or the test scope), freeing its slot of the 5-device cap. {status forbidden} unless the request carries the Worker key; otherwise always {status ok}, matched or not (a malformed token changes nothing). Never raises, returns no row data. anon + authenticated EXECUTE; the key is the gate. 20261198.';

-- ─── (c) create_eatery_order: the 20261193 body, the 18+ "today" in Europe/Nicosia ───
CREATE OR REPLACE FUNCTION public.create_eatery_order(p_partner uuid, p_items jsonb, p_client_id text DEFAULT NULL, p_mode text DEFAULT NULL)
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
  v_bad     int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_authenticated';
  END IF;

  -- 20261132: a TEST order is decided by the server, never by a parameter: the ADA Preview app (its key header) or a
  -- listed order tester. Test orders are deleted after 24 h and never count toward the partner cap.
  v_test := public.is_previewer() OR public.is_order_tester(v_uid);

  SELECT p.id, p.is_active, p.order_requires_account, p.adult_only, p.order_method INTO v_partner
    FROM public.eatery_partners p WHERE p.id = p_partner;
  IF NOT FOUND OR NOT (v_partner.is_active OR public.is_previewer()) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'partner_unavailable';
  END IF;

  -- 20261144: a phone-only restaurant has no basket. Unconditional: the ADA Preview key does not bypass it, so a
  -- phone partner can never gain an order row, even while it is being previewed.
  IF v_partner.order_method IS DISTINCT FROM 'whatsapp' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'order_not_supported';
  END IF;

  IF v_partner.adult_only THEN
    IF v_guest THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'adult_only', DETAIL = 'guest';
    END IF;
    SELECT pr.date_of_birth INTO v_dob FROM public.profiles pr WHERE pr.id = v_uid;
    v_gate := public.eatery_order_age_gate(v_dob, (now() AT TIME ZONE 'Europe/Nicosia')::date);
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

  -- 20261193: the fulfilment the customer chose; NULL = an order from an older app. Checked before anything is written or counted.
  IF p_mode IS NOT NULL AND p_mode NOT IN ('pickup','delivery') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_mode';
  END IF;

  -- Shape of p_items: 1..30 objects {item_id: integer, qty: integer 1..99}, optionally with "opts": 1..20 objects
  -- {id: integer, qty: integer 1..10} and no repeated option id. CASE guards every cast.
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
  IF EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_items) e
        WHERE e ? 'opts'
          AND CASE WHEN jsonb_typeof(e -> 'opts') IS DISTINCT FROM 'array' THEN true
                   WHEN jsonb_array_length(e -> 'opts') NOT BETWEEN 1 AND 20 THEN true
                   WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(e -> 'opts') o
                                 WHERE jsonb_typeof(o) IS DISTINCT FROM 'object'
                                    OR jsonb_typeof(o -> 'id') IS DISTINCT FROM 'number'
                                    OR jsonb_typeof(o -> 'qty') IS DISTINCT FROM 'number'
                                    OR (o ->> 'id') !~ '^[0-9]{1,15}$'
                                    OR CASE WHEN (o ->> 'qty') ~ '^[0-9]{1,2}$' THEN (o ->> 'qty')::int NOT BETWEEN 1 AND 10 ELSE true END)
                        THEN true
                   ELSE (SELECT count(DISTINCT (o ->> 'id')::bigint) FROM jsonb_array_elements(e -> 'opts') o) IS DISTINCT FROM jsonb_array_length(e -> 'opts')
              END)
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_items';
  END IF;
  -- Lines are distinct by (item_id, sorted option id x qty); without opts that is "no repeated item_id".
  IF (SELECT count(DISTINCT (e ->> 'item_id')::bigint::text || ':' ||
                COALESCE((SELECT string_agg((o ->> 'id')::bigint::text || 'x' || (o ->> 'qty')::int::text, ',' ORDER BY (o ->> 'id')::bigint)
                            FROM jsonb_array_elements(CASE WHEN e ? 'opts' THEN e -> 'opts' ELSE '[]'::jsonb END) o), ''))
        FROM jsonb_array_elements(p_items) e) IS DISTINCT FROM jsonb_array_length(p_items) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_items';
  END IF;

  -- Lines come from the DATABASE: name, price and currency of this partner's available, priced items, and the
  -- price of each chosen extra. Any price the client sent is never read.
  SELECT count(*),
         jsonb_agg(z.line ORDER BY z.ord),
         sum(z.qty * z.unit),
         count(DISTINCT z.currency),
         min(z.currency)
    INTO v_found, v_lines, v_total, v_ncur, v_cur
    FROM (SELECT x.ord, x.qty, m.currency, m.price + ox.extra AS unit,
                 CASE WHEN x.opts IS NULL
                      THEN jsonb_build_object('item_id', m.id, 'name', m.name, 'qty', x.qty, 'unit_price', m.price)
                      ELSE jsonb_build_object('item_id', m.id, 'name', m.name, 'qty', x.qty, 'unit_price', m.price + ox.extra,
                                              'base_price', m.price, 'options', ox.opts, 'detail', ox.detail)
                 END AS line
            FROM (SELECT (e ->> 'item_id')::bigint AS item_id, (e ->> 'qty')::int AS qty, e -> 'opts' AS opts, t.ord
                    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS t(e, ord)) x
            JOIN public.eatery_menu_items m
              ON m.id = x.item_id AND m.partner_id = p_partner AND m.is_available AND m.price IS NOT NULL
           CROSS JOIN LATERAL (
                 SELECT COALESCE(sum(CASE WHEN io.kind = 'extra' THEN io.price * r.qty END), 0) AS extra,
                        jsonb_agg(jsonb_build_object('option_id', io.id, 'kind', io.kind, 'name', io.message_tr, 'qty', r.qty, 'price', io.price)
                                  ORDER BY (io.kind = 'extra'), io.sort_order, io.id) AS opts,
                        string_agg(CASE WHEN io.kind = 'remove' THEN io.message_tr
                                        WHEN r.qty = 1 THEN '+ekstra ' || io.message_tr
                                        ELSE '+' || r.qty::text || ' ekstra ' || io.message_tr END,
                                   ', ' ORDER BY (io.kind = 'extra'), io.sort_order, io.id) AS detail
                   FROM (SELECT (o ->> 'id')::bigint AS id, (o ->> 'qty')::int AS qty FROM jsonb_array_elements(x.opts) o) r
                   JOIN public.eatery_item_options io
                     ON io.id = r.id AND io.item_id = m.id AND io.is_available AND (io.kind = 'remove' OR io.price IS NOT NULL)) ox) z;
  IF v_found IS DISTINCT FROM jsonb_array_length(p_items) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'item_unavailable';
  END IF;
  -- Every requested option must exist, belong to ITS line's dish, be available, and (extras) be priced.
  SELECT count(*) INTO v_bad
    FROM (SELECT (e ->> 'item_id')::bigint AS item_id, (o ->> 'id')::bigint AS id
            FROM jsonb_array_elements(p_items) e CROSS JOIN LATERAL jsonb_array_elements(e -> 'opts') o) r
    LEFT JOIN public.eatery_item_options io
      ON io.id = r.id AND io.item_id = r.item_id AND io.is_available AND (io.kind = 'remove' OR io.price IS NOT NULL)
   WHERE io.id IS NULL;
  IF v_bad > 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'option_unavailable';
  END IF;
  -- A removal is chosen once; an extra at most max_qty times.
  SELECT count(*) INTO v_bad
    FROM (SELECT (o ->> 'id')::bigint AS id, (o ->> 'qty')::int AS qty
            FROM jsonb_array_elements(p_items) e CROSS JOIN LATERAL jsonb_array_elements(e -> 'opts') o) r
    JOIN public.eatery_item_options io ON io.id = r.id
   WHERE r.qty > io.max_qty OR (io.kind = 'remove' AND r.qty <> 1);
  IF v_bad > 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_items';
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
      INSERT INTO public.eatery_orders (code, partner_id, lines, total, currency, created_by, client_id, created_as_guest, is_test, fulfilment)
      VALUES (v_code, p_partner, v_lines, v_total, v_cur, v_uid, p_client_id, v_guest, v_test, p_mode)
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
ALTER FUNCTION public.create_eatery_order(uuid, jsonb, text, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.create_eatery_order(uuid, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.create_eatery_order(uuid, jsonb, text, text) TO authenticated;

-- ─── Post-state ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_c oid := to_regprocedure('public.create_eatery_order(uuid,jsonb,text,text)');
  v_v oid := to_regprocedure('public.verify_eatery_order(text,text)');
  v_r oid := to_regprocedure('public.eatery_partner_device_revoke(text)');
  v_def text;
  v_g text;
BEGIN
  IF v_c IS NULL OR v_v IS NULL OR v_r IS NULL THEN
    RAISE EXCEPTION 'post-state: create / verify / revoke missing. Rolled back.';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'create_eatery_order') IS DISTINCT FROM 1
     OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'verify_eatery_order') IS DISTINCT FROM 1
     OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'eatery_partner_device_revoke') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'post-state: create / verify / revoke must each have exactly one overload. Rolled back.';
  END IF;
  IF (SELECT count(*) FROM pg_proc p WHERE p.oid IN (v_c, v_v, v_r) AND p.prosecdef AND p.provolatile = 'v'
        AND pg_get_userbyid(p.proowner) = 'postgres' AND p.proconfig @> ARRAY['search_path=public, pg_temp']) IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'post-state: create / verify / revoke must be SECURITY DEFINER, VOLATILE, owner postgres, search_path public, pg_temp. Rolled back.';
  END IF;
  -- EXECUTE grantees other than the owner and service_role, as one sorted list per function.
  FOR v_def, v_g IN
    SELECT x.want, COALESCE((SELECT string_agg(DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END, ',')
                               FROM pg_proc p, LATERAL aclexplode(p.proacl) a LEFT JOIN pg_roles r ON r.oid = a.grantee
                              WHERE p.oid = x.f AND a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner
                                AND r.rolname IS DISTINCT FROM 'service_role'), '')
      FROM (VALUES (v_c, 'authenticated'), (v_v, 'anon,authenticated'), (v_r, 'anon,authenticated')) x(f, want)
  LOOP
    IF v_g IS DISTINCT FROM v_def THEN
      RAISE EXCEPTION 'post-state grants: an EXECUTE list is % (want %). Rolled back.', v_g, v_def;
    END IF;
  END LOOP;

  -- (a) verify: the managing check comes BEFORE the view UPDATE, which only runs when the caller cannot manage.
  v_def := pg_get_functiondef(v_v);
  IF position('IF NOT COALESCE(v_can, false) THEN' IN v_def) = 0
     OR position('view_count = view_count + 1' IN v_def) = 0
     OR (length(v_def) - length(replace(v_def, 'eatery_order_can_manage(v_o.partner_id, v_o.is_test, p_device)', ''))) / length('eatery_order_can_manage(v_o.partner_id, v_o.is_test, p_device)') IS DISTINCT FROM 1
     OR (length(v_def) - length(replace(v_def, 'UPDATE public.eatery_orders', ''))) / length('UPDATE public.eatery_orders') IS DISTINCT FROM 1
     OR position('eatery_order_can_manage(v_o.partner_id, v_o.is_test, p_device)' IN v_def) > position('IF NOT COALESCE(v_can, false) THEN' IN v_def)
     OR position(E'IF NOT COALESCE(v_can, false) THEN\n    UPDATE public.eatery_orders\n       SET first_viewed_at = COALESCE(first_viewed_at, now()), view_count = view_count + 1\n     WHERE id = v_o.id;\n  END IF;' IN v_def) = 0
     OR position('''view_count_before'',      v_o.view_count' IN v_def) = 0
     OR position('''can_manage'',             COALESCE(v_can, false)' IN v_def) = 0 THEN
    RAISE EXCEPTION 'verify_eatery_order body: can_manage computed once, before an IF NOT COALESCE(v_can, false) that wraps the only view UPDATE; keys kept. Rolled back.';
  END IF;

  -- (b) revoke: key gate first, the 96-hex format check, one UPDATE of revoked_at on a live row by token hash; no DELETE, no RAISE.
  v_def := pg_get_functiondef(v_r);
  IF position('IF NOT public.eatery_worker_key_ok() THEN' IN v_def) = 0
     OR position('IF NOT public.eatery_worker_key_ok() THEN' IN v_def) > position('UPDATE private.eatery_partner_devices' IN v_def)
     OR position('p_device !~ ''^[0-9a-f]{96}$''' IN v_def) = 0
     OR position('p_device !~ ''^[0-9a-f]{96}$''' IN v_def) > position('UPDATE private.eatery_partner_devices' IN v_def)
     OR position('WHERE d.token_sha256 = encode(sha256(convert_to(p_device, ''UTF8'')), ''hex'')' IN v_def) = 0
     OR position('AND d.revoked_at IS NULL;' IN v_def) = 0
     OR v_def LIKE '%DELETE FROM%'
     OR v_def LIKE '%RAISE EXCEPTION%'
     OR v_def LIKE '%private.eatery_partner_pins%'
     OR v_def LIKE '%private.eatery_pin_attempts%' THEN
    RAISE EXCEPTION 'eatery_partner_device_revoke body: key gate first, 96-hex check, single live-row revoked_at UPDATE by token hash, no DELETE / RAISE / PIN / attempts table. Rolled back.';
  END IF;

  -- (c) create: Nicosia in, Istanbul out; the 20261193 shapes still there.
  v_def := pg_get_functiondef(v_c);
  IF position('v_gate := public.eatery_order_age_gate(v_dob, (now() AT TIME ZONE ''Europe/Nicosia'')::date);' IN v_def) = 0
     OR v_def LIKE '%Europe/Istanbul%'
     OR position('MESSAGE = ''invalid_mode''' IN v_def) = 0
     OR position('MESSAGE = ''order_not_supported''' IN v_def) = 0
     OR position('client_id, created_as_guest, is_test, fulfilment)' IN v_def) = 0 THEN
    RAISE EXCEPTION 'create_eatery_order body: the age gate must read Europe/Nicosia (no Europe/Istanbul left), 20261193 shapes kept. Rolled back.';
  END IF;

  -- This server's tz data: Cyprus is UTC+2 in winter, UTC+3 in summer (EU rules).
  IF ('2026-01-15 21:30:00+00'::timestamptz AT TIME ZONE 'Europe/Nicosia')::date IS DISTINCT FROM date '2026-01-15'
     OR ('2026-01-15 22:30:00+00'::timestamptz AT TIME ZONE 'Europe/Nicosia')::date IS DISTINCT FROM date '2026-01-16'
     OR ('2026-07-15 20:30:00+00'::timestamptz AT TIME ZONE 'Europe/Nicosia')::date IS DISTINCT FROM date '2026-07-15'
     OR ('2026-07-15 21:30:00+00'::timestamptz AT TIME ZONE 'Europe/Nicosia')::date IS DISTINCT FROM date '2026-07-16' THEN
    RAISE EXCEPTION 'post-state: Europe/Nicosia does not give UTC+2 in winter / UTC+3 in summer on this server. Rolled back.';
  END IF;
  RAISE NOTICE 'post-state ok: verify skips the view for a managing device; eatery_partner_device_revoke (DEFINER, anon + authenticated, key-gated); create age gate in Europe/Nicosia';
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
VALUES ('20261198_eatery_order_status_slice3.sql', 'a49eba2d2ee2330f639ca593931cf3e013fffae538b2035d058566fd10e99409')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: the 20261198_eatery_order_status_slice3 rows (C, G, H) must read OK.
--
-- ─── Rollback ──
--   DROP FUNCTION IF EXISTS public.eatery_partner_device_revoke(text);   (the Worker's /forget then only clears the cookie)
--   verify_eatery_order / create_eatery_order: re-create the 20261193 bodies (section (7) / (6) of that file) in a new migration.
