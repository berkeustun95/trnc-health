-- ═══════════════════════════════════════════════════════════════════════════
-- 20261193 — Yeme-İçme: order status from the restaurant, part 1 (columns, event log, helpers, customer-side RPCs)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DATABASE ONLY. No app, Worker or partner code ships with this file. The restaurant-side half (PIN, enrolled devices,
-- the status-change RPC, push text) is 20261194, which refuses to run unless this file is applied.
--
-- (1) eatery_partners.order_status_enabled boolean NOT NULL DEFAULT false. A restaurant takes part only when this is
--     switched on (by service_role, later); an unpublished-by-default flag, registered as an H token.
-- (2) eatery_orders gains: fulfilment ('pickup' | 'delivery' | NULL = order from an older app), status ('sent' default |
--     received | preparing | on_the_way | ready | cancelled), status_at, cancel_reason (six codes; set exactly when the
--     status is cancelled), notify_token (an Expo push token of the ordering phone) and notify_lang (one of the nine
--     full English language names; an ISO code such as 'tr' is refused). notify_token and notify_lang are both set or
--     both NULL. CHECK literals are static (scripts/audit-schema-drift.mjs reads them).
-- (3) public.eatery_order_events: one row per status change (order, status, reason, time, device id). No customer
--     data. The device id has NO foreign key (a revoked or deleted device must not block or cascade the history).
-- (4) eatery_order_next_statuses(status, fulfilment): the forward-only transition table, IMMUTABLE, internal.
-- (5) eatery_order_can_manage(partner, is_test, device): a STUB returning false here; 20261194 gives it its body, so
--     verify_eatery_order below is written once. A re-run of this file after 20261194 does NOT put the stub back.
-- (6) create_eatery_order(uuid, jsonb, text, text): the 20261144 body carried forward, identical EXCEPT a fourth
--     parameter p_mode (NULL | 'pickup' | 'delivery'; anything else raises invalid_mode before any write and before the
--     rate-limit count) stored in the new fulfilment column. The 3-argument function is DROPPED in the same transaction:
--     exactly one create_eatery_order remains. An older app that sends only p_partner and p_items still works.
-- (7) verify_eatery_order(text, text): the 20261134 body, identical EXCEPT a second optional parameter p_device and
--     extra keys: fulfilment, order_status, status_at, cancel_reason, status_open, status_enabled, can_manage, next.
--     Existing keys (status ok|expired|not_found, view counting) are unchanged. The 1-argument function is DROPPED.
-- (8) my_eatery_orders(): the caller's own orders of the last 24 hours (max 20), newest first. Never counts a view,
--     never returns the push token.
-- (9) eatery_order_subscribe(code, token, lang): the order's own creator attaches (or clears) the push token + language.
--
-- ─── WHO CAN READ / WRITE WHAT ──────────────────────────────────────────────
--   • eatery_orders: unchanged. RLS on, ZERO policies, no privilege for anon / authenticated (guests included). The new
--     columns are reachable only through the DEFINER functions below. notify_token / notify_lang are never returned by any
--     function in this file.
--   • eatery_order_events: RLS on, ZERO policies, ALL privileges revoked from PUBLIC, anon, authenticated. service_role only.
--   • eatery_partners: the table-level SELECT grant (anon + authenticated) now also covers order_status_enabled; rows are
--     visible exactly as before. Still exactly the 2 policies (select_active, select_preview). Writes: service_role only.
--   • create_eatery_order: authenticated only (guests included), as before. verify_eatery_order: anon + authenticated, as
--     before (anyone holding the order code); it still never returns created_by, client_id, item / option ids, notify_token
--     or notify_lang. can_manage and next are false / empty for everyone until 20261194.
--   • my_eatery_orders: authenticated only. A caller sees ONLY orders whose created_by is their own auth.uid(); never
--     another user's. anon is refused (no EXECUTE).
--   • eatery_order_subscribe: authenticated only; works only on the caller's own order (another user's order and an unknown
--     code both answer not_found); the order must be under 12 hours old and not in a final status.
--   • Helpers (next_statuses, can_manage): no EXECUTE for PUBLIC, anon, authenticated.
--
-- PROOF (inside this file): pre-state; columns, CHECK set and rejections; the full policy set and grants of every touched
-- object; one function per name; "identical except" shapes; and, in a rolled-back sentinel, behaviour probes with a positive
-- control beside every denial. Step results are never printed (only labels), so no code, id or total reaches a public log.
--
-- Apply: gh workflow run supabase-migrate (dry), then apply=true after Berke's go. ADDs columns => ends with NOTIFY pgrst.
-- Re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── Pre-state (abort before changing anything) ─────────────────────────────
DO $$
DECLARE
  v_cdef text; v_vdef text; v_names text[]; v_n int; v_has3 boolean; v_has4 boolean; v_hasv1 boolean; v_hasv2 boolean;
BEGIN
  IF to_regclass('public.schema_migrations_applied') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.schema_migrations_applied WHERE filename = '20261144_eatery_order_method.sql') THEN
    RAISE EXCEPTION 'pre-state: 20261144_eatery_order_method.sql is not in the ledger';
  END IF;
  IF to_regclass('public.eatery_orders') IS NULL OR to_regclass('public.eatery_partners') IS NULL
     OR to_regprocedure('public.is_previewer()') IS NULL OR to_regprocedure('public.is_order_tester(uuid)') IS NULL
     OR to_regprocedure('public.is_anonymous_session()') IS NULL THEN
    RAISE EXCEPTION 'pre-state: eatery_orders / eatery_partners / is_previewer / is_order_tester / is_anonymous_session missing';
  END IF;
  v_has3  := to_regprocedure('public.create_eatery_order(uuid,jsonb,text)') IS NOT NULL;
  v_has4  := to_regprocedure('public.create_eatery_order(uuid,jsonb,text,text)') IS NOT NULL;
  v_hasv1 := to_regprocedure('public.verify_eatery_order(text)') IS NOT NULL;
  v_hasv2 := to_regprocedure('public.verify_eatery_order(text,text)') IS NOT NULL;
  IF v_has3 = v_has4 OR v_hasv1 = v_hasv2 THEN
    RAISE EXCEPTION 'pre-state: create has 3-arg=% 4-arg=%, verify has 1-arg=% 2-arg=% (need exactly one of each pair)', v_has3, v_has4, v_hasv1, v_hasv2;
  END IF;
  IF v_has3 THEN
    v_cdef := pg_get_functiondef(to_regprocedure('public.create_eatery_order(uuid,jsonb,text)'));
    IF position('p.adult_only, p.order_method INTO v_partner' IN v_cdef) = 0
       OR position('MESSAGE = ''order_not_supported''' IN v_cdef) = 0
       OR position('JOIN public.eatery_item_options io' IN v_cdef) = 0
       OR position('v_test := public.is_previewer() OR public.is_order_tester(v_uid);' IN v_cdef) = 0
       OR position('client_id, created_as_guest, is_test)' IN v_cdef) = 0 THEN
      RAISE EXCEPTION 'pre-state: the live 3-argument create_eatery_order is not the 20261144 body. Nothing applied.';
    END IF;
  END IF;
  IF v_hasv1 THEN
    v_vdef := pg_get_functiondef(to_regprocedure('public.verify_eatery_order(text)'));
    IF position('''detail'', l -> ''detail''' IN v_vdef) = 0 OR position('''is_test'',                v_o.is_test' IN v_vdef) = 0 THEN
      RAISE EXCEPTION 'pre-state: the live 1-argument verify_eatery_order is not the 20261134 body. Nothing applied.';
    END IF;
  END IF;
  SELECT array_agg(policyname::text ORDER BY policyname) INTO v_names FROM pg_policies WHERE schemaname = 'public' AND tablename = 'eatery_partners';
  IF v_names IS DISTINCT FROM ARRAY['eatery_partners_select_active','eatery_partners_select_preview'] THEN
    RAISE EXCEPTION 'pre-state: eatery_partners policies are % (want select_active + select_preview). Nothing applied.', v_names;
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'eatery_orders';
  IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'pre-state: eatery_orders has % policies (want 0)', v_n; END IF;
  RAISE NOTICE 'pre-state ok: create 3-arg=% 4-arg=%, verify 1-arg=% 2-arg=%, partner policies %', v_has3, v_has4, v_hasv1, v_hasv2, v_names;
END $$;

-- ─── (1) eatery_partners.order_status_enabled ───────────────────────────────
ALTER TABLE public.eatery_partners ADD COLUMN IF NOT EXISTS order_status_enabled boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.eatery_partners.order_status_enabled IS
  'true = this restaurant reports order status (received, preparing, on the way / ready, cancelled) for REAL orders. Default false. Test orders ignore it. Writes: service_role only. 20261193.';

-- ─── (2) eatery_orders: status columns ──────────────────────────────────────
-- Static literals on purpose: scripts/audit-schema-drift.mjs reads CHECK literals from this file.
ALTER TABLE public.eatery_orders ADD COLUMN IF NOT EXISTS fulfilment    text;
ALTER TABLE public.eatery_orders ADD COLUMN IF NOT EXISTS status        text        NOT NULL DEFAULT 'sent';
ALTER TABLE public.eatery_orders ADD COLUMN IF NOT EXISTS status_at     timestamptz;
ALTER TABLE public.eatery_orders ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE public.eatery_orders ADD COLUMN IF NOT EXISTS notify_token  text;
ALTER TABLE public.eatery_orders ADD COLUMN IF NOT EXISTS notify_lang   text;

ALTER TABLE public.eatery_orders DROP CONSTRAINT IF EXISTS eatery_orders_fulfilment_check;
ALTER TABLE public.eatery_orders ADD  CONSTRAINT eatery_orders_fulfilment_check CHECK (fulfilment IN ('pickup','delivery'));
ALTER TABLE public.eatery_orders DROP CONSTRAINT IF EXISTS eatery_orders_status_check;
ALTER TABLE public.eatery_orders ADD  CONSTRAINT eatery_orders_status_check CHECK (status IN ('sent','received','preparing','on_the_way','ready','cancelled'));
ALTER TABLE public.eatery_orders DROP CONSTRAINT IF EXISTS eatery_orders_cancel_reason_check;
ALTER TABLE public.eatery_orders ADD  CONSTRAINT eatery_orders_cancel_reason_check CHECK (cancel_reason IN ('closed','busy','item_out','no_delivery_there','unreachable','other'));
ALTER TABLE public.eatery_orders DROP CONSTRAINT IF EXISTS eatery_orders_cancel_pair_check;
ALTER TABLE public.eatery_orders ADD  CONSTRAINT eatery_orders_cancel_pair_check CHECK ((cancel_reason IS NOT NULL) = (status = 'cancelled'));
ALTER TABLE public.eatery_orders DROP CONSTRAINT IF EXISTS eatery_orders_notify_token_check;
ALTER TABLE public.eatery_orders ADD  CONSTRAINT eatery_orders_notify_token_check CHECK (notify_token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,200}\]$');
ALTER TABLE public.eatery_orders DROP CONSTRAINT IF EXISTS eatery_orders_notify_lang_check;
ALTER TABLE public.eatery_orders ADD  CONSTRAINT eatery_orders_notify_lang_check CHECK (notify_lang IN ('English','Turkish','Arabic','Russian','Greek','French','Spanish','German','Persian'));
ALTER TABLE public.eatery_orders DROP CONSTRAINT IF EXISTS eatery_orders_notify_pair_check;
ALTER TABLE public.eatery_orders ADD  CONSTRAINT eatery_orders_notify_pair_check CHECK ((notify_token IS NULL) = (notify_lang IS NULL));

COMMENT ON COLUMN public.eatery_orders.fulfilment IS 'pickup | delivery as chosen in the app; NULL = an order from an older app. 20261193.';
COMMENT ON COLUMN public.eatery_orders.status IS 'Where the order stands: sent (default), received, preparing, on_the_way, ready, cancelled. Forward only (eatery_order_next_statuses). 20261193.';
COMMENT ON COLUMN public.eatery_orders.notify_token IS 'Expo push token of the ordering phone, set by eatery_order_subscribe; cleared on a final status and by the retention job after 12 hours. Never returned by any function. 20261193.';

-- ─── (3) eatery_order_events ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.eatery_order_events (
  id            bigint      GENERATED ALWAYS AS IDENTITY,
  order_id      uuid        NOT NULL,
  status        text        NOT NULL,
  cancel_reason text,
  at            timestamptz NOT NULL DEFAULT now(),
  device_id     uuid,
  CONSTRAINT eatery_order_events_pkey PRIMARY KEY (id),
  CONSTRAINT eatery_order_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.eatery_orders (id) ON DELETE CASCADE,
  CONSTRAINT eatery_order_events_status_check CHECK (status IN ('sent','received','preparing','on_the_way','ready','cancelled')),
  CONSTRAINT eatery_order_events_cancel_reason_check CHECK (cancel_reason IN ('closed','busy','item_out','no_delivery_there','unreachable','other')),
  CONSTRAINT eatery_order_events_cancel_pair_check CHECK ((cancel_reason IS NOT NULL) = (status = 'cancelled'))
);
CREATE INDEX IF NOT EXISTS eatery_order_events_order_id_idx ON public.eatery_order_events (order_id, at);
ALTER TABLE public.eatery_order_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.eatery_order_events FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.eatery_order_events IS
  'One row per order status change (status, reason, time, the device id that made it). RLS on, ZERO policies, no client privilege: written only by eatery_order_set_status (20261194), deleted with its order. No customer data; device_id has no FK. 20261193.';

-- ─── (4) + (5) helpers ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.eatery_order_next_statuses(p_status text, p_fulfilment text)
  RETURNS text[]
  LANGUAGE sql
  IMMUTABLE
  SET search_path = ''
AS $fn$
  SELECT CASE p_status
    WHEN 'sent'      THEN ARRAY['received','preparing'] || f.fin || ARRAY['cancelled']
    WHEN 'received'  THEN ARRAY['preparing'] || f.fin || ARRAY['cancelled']
    WHEN 'preparing' THEN f.fin || ARRAY['cancelled']
    ELSE ARRAY[]::text[]
  END
  FROM (SELECT CASE p_fulfilment WHEN 'delivery' THEN ARRAY['on_the_way']
                                 WHEN 'pickup'   THEN ARRAY['ready']
                                 ELSE ARRAY['on_the_way','ready'] END AS fin) f
$fn$;
ALTER FUNCTION public.eatery_order_next_statuses(text, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.eatery_order_next_statuses(text, text) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.eatery_order_next_statuses(text, text) IS
  'Internal. The statuses an order may move to next: forward only, skipping allowed; the last step is on_the_way (delivery), ready (pickup) or both (fulfilment unknown); cancelled from sent / received / preparing; nothing after a final status. No client EXECUTE. 20261193.';

DO $$
BEGIN
  -- The stub is created on a first apply only. After 20261194 holds the real body, a re-run of this file must NOT
  -- put the stub back (that would switch off every enrolled device).
  IF to_regprocedure('public.eatery_order_can_manage(uuid,boolean,text)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.schema_migrations_applied WHERE filename = '20261194_eatery_order_status_partner.sql') THEN
    CREATE OR REPLACE FUNCTION public.eatery_order_can_manage(p_partner uuid, p_is_test boolean, p_device text)
      RETURNS boolean
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = ''
    AS $f$ SELECT false $f$;
    ALTER FUNCTION public.eatery_order_can_manage(uuid, boolean, text) OWNER TO postgres;
    COMMENT ON FUNCTION public.eatery_order_can_manage(uuid, boolean, text) IS
      'Internal. Whether this device may change the status of an order of this partner. STUB (always false) until 20261194. No client EXECUTE. 20261193.';
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.eatery_order_can_manage(uuid, boolean, text) FROM PUBLIC, anon, authenticated;

-- ─── (6) create_eatery_order: 20261144 body + p_mode ────────────────────────
DROP FUNCTION IF EXISTS public.create_eatery_order(uuid, jsonb, text);
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
COMMENT ON FUNCTION public.create_eatery_order(uuid, jsonb, text, text) IS
  'Records a WhatsApp order and returns {code, lines, total, currency, expires_at}. Prices come from eatery_menu_items and eatery_item_options, never the client. p_mode (optional) = pickup | delivery, stored as fulfilment; NULL = an older app. authenticated only (guests included unless the partner sets order_requires_account). 5/user/h counts ALL orders including test orders; 60/partner/h counts guest-session orders that are NOT test orders. is_test is derived by the server, never a parameter. Errors: SQLSTATE P0001, MESSAGE = not_authenticated | partner_unavailable | order_not_supported | adult_only (DETAIL guest/no_dob/under_18) | order_requires_account | invalid_client_id | invalid_mode | invalid_items | item_unavailable | option_unavailable | mixed_currency | rate_limited | code_generation_failed. 20261193.';

-- ─── (7) verify_eatery_order: 20261134 body + status keys + p_device ─────────
DROP FUNCTION IF EXISTS public.verify_eatery_order(text);
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

  UPDATE public.eatery_orders
     SET first_viewed_at = COALESCE(first_viewed_at, now()), view_count = view_count + 1
   WHERE id = v_o.id;

  SELECT name, order_status_enabled INTO v_name, v_enabled FROM public.eatery_partners WHERE id = v_o.partner_id;
  v_open := now() < v_o.created_at + interval '12 hours' AND v_o.status NOT IN ('on_the_way','ready','cancelled');
  v_can  := public.eatery_order_can_manage(v_o.partner_id, v_o.is_test, p_device);
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
  'Partner-side check of a WhatsApp order code (anon + authenticated). Returns {status ok|expired|not_found, partner_name, created_at, expires_at, lines[name,qty,unit_price,detail], total, currency, first_viewed_at_before, view_count_before, is_test, fulfilment, order_status, status_at, cancel_reason, status_open (under 12 h and not final), status_enabled, can_manage (this p_device may change the status), next (the statuses it may move to; empty unless can_manage and status_open and (test order or status_enabled))} and counts the call as a view. Never returns created_by, client_id, item ids, option ids, notify_token or notify_lang. 20261193.';

-- ─── (8) my_eatery_orders ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.my_eatery_orders()
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_res jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_authenticated';
  END IF;
  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.created_at DESC, x.code), '[]'::jsonb) INTO v_res
    FROM (SELECT o.created_at, o.code,
                 jsonb_build_object(
                   'code',           o.code,
                   'partner_id',     o.partner_id,
                   'partner_name',   p.name,
                   'total',          o.total,
                   'currency',       o.currency,
                   'created_at',     o.created_at,
                   'fulfilment',     o.fulfilment,
                   'order_status',   o.status,
                   'status_at',      o.status_at,
                   'cancel_reason',  o.cancel_reason,
                   'is_test',        o.is_test,
                   'status_enabled', p.order_status_enabled,
                   'status_open',    (now() < o.created_at + interval '12 hours' AND o.status NOT IN ('on_the_way','ready','cancelled')),
                   'notify_set',     (o.notify_token IS NOT NULL)) AS j
            FROM public.eatery_orders o
            JOIN public.eatery_partners p ON p.id = o.partner_id
           WHERE o.created_by = v_uid AND o.created_at > now() - interval '24 hours'
           ORDER BY o.created_at DESC, o.code
           LIMIT 20) x;
  RETURN v_res;
END;
$fn$;
ALTER FUNCTION public.my_eatery_orders() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.my_eatery_orders() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.my_eatery_orders() TO authenticated;
COMMENT ON FUNCTION public.my_eatery_orders() IS
  'The caller''s OWN eatery orders (created_by = auth.uid()) of the last 24 hours, newest first, max 20: code, partner_id, partner_name, total, currency, created_at, fulfilment, order_status, status_at, cancel_reason, is_test, status_enabled, status_open, notify_set. Never counts a view, never returns the push token. authenticated only (guests included). 20261193.';

-- ─── (9) eatery_order_subscribe ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.eatery_order_subscribe(p_code text, p_token text, p_lang text)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_c   text;
  v_o   public.eatery_orders%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_authenticated';
  END IF;
  IF p_code IS NULL OR length(p_code) > 40 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_found';
  END IF;
  v_c := upper(regexp_replace(p_code, '[-\s]', '', 'g'));
  IF v_c !~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_found';
  END IF;
  IF p_token IS NOT NULL THEN
    IF p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,200}\]$' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
    END IF;
    IF p_lang IS NULL OR p_lang NOT IN ('English','Turkish','Arabic','Russian','Greek','French','Spanish','German','Persian') THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_lang';
    END IF;
  END IF;

  SELECT * INTO v_o FROM public.eatery_orders WHERE code = v_c AND created_by = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_found';
  END IF;
  IF now() >= v_o.created_at + interval '12 hours' OR v_o.status IN ('on_the_way','ready','cancelled') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'closed';
  END IF;

  UPDATE public.eatery_orders
     SET notify_token = p_token, notify_lang = CASE WHEN p_token IS NULL THEN NULL ELSE p_lang END
   WHERE id = v_o.id;
  RETURN jsonb_build_object('status', 'ok', 'notify_set', p_token IS NOT NULL);
END;
$fn$;
ALTER FUNCTION public.eatery_order_subscribe(text, text, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.eatery_order_subscribe(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.eatery_order_subscribe(text, text, text) TO authenticated;
COMMENT ON FUNCTION public.eatery_order_subscribe(text, text, text) IS
  'The creator of an order attaches (or, with a NULL token, clears) the push token and language that status changes are sent to. Only the caller''s own order (another user''s and an unknown code both answer not_found); the order must be under 12 hours old and not final (else closed). Errors (P0001): not_authenticated | not_found | invalid_token | invalid_lang | closed. Does not count as a view. authenticated only. 20261193.';

-- ─── Structure proof (read from the live catalogs) ──────────────────────────
DO $$
DECLARE
  v_n int; v_s text; v_def text; v_names text[]; r record; t text; v_want text; v_cfg text;
BEGIN
  -- Columns: exact types, nullability, defaults.
  SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
                    || COALESCE(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), ''), ', ' ORDER BY a.attname) INTO v_s
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.eatery_orders'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname IN ('fulfilment','status','status_at','cancel_reason','notify_token','notify_lang');
  IF v_s IS DISTINCT FROM 'cancel_reason text, fulfilment text, notify_lang text, notify_token text, status text NOT NULL DEFAULT ''sent''::text, status_at timestamp with time zone' THEN
    RAISE EXCEPTION 'eatery_orders new columns are [%]', v_s;
  END IF;
  SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
                    || CASE WHEN a.attidentity = 'a' THEN ' IDENTITY' ELSE '' END || COALESCE(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), ''), ', ' ORDER BY a.attnum) INTO v_s
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.eatery_order_events'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_s IS DISTINCT FROM 'id bigint NOT NULL IDENTITY, order_id uuid NOT NULL, status text NOT NULL, cancel_reason text, at timestamp with time zone NOT NULL DEFAULT now(), device_id uuid' THEN
    RAISE EXCEPTION 'eatery_order_events columns are [%]', v_s;
  END IF;
  SELECT format_type(a.atttypid, a.atttypmod) || (CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END) || ' ' || pg_get_expr(d.adbin, d.adrelid) INTO v_s
    FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.eatery_partners'::regclass AND a.attname = 'order_status_enabled';
  IF v_s IS DISTINCT FROM 'boolean NOT NULL false' THEN RAISE EXCEPTION 'eatery_partners.order_status_enabled is [%]', v_s; END IF;

  -- Constraints: the full sets, derived and printed.
  SELECT count(*), array_agg(c.conname::text ORDER BY c.conname) INTO v_n, v_names
    FROM pg_constraint c WHERE c.conrelid = 'public.eatery_orders'::regclass AND c.contype IN ('p','f','u','c');
  RAISE NOTICE 'eatery_orders constraints: % %', v_n, v_names;
  IF v_names IS DISTINCT FROM ARRAY['eatery_orders_cancel_pair_check','eatery_orders_cancel_reason_check','eatery_orders_client_id_check','eatery_orders_code_check',
       'eatery_orders_code_key','eatery_orders_currency_check','eatery_orders_expires_check','eatery_orders_fulfilment_check','eatery_orders_lines_check',
       'eatery_orders_notify_lang_check','eatery_orders_notify_pair_check','eatery_orders_notify_token_check','eatery_orders_partner_id_fkey','eatery_orders_pkey',
       'eatery_orders_status_check','eatery_orders_total_check','eatery_orders_view_count_check']::text[] THEN
    RAISE EXCEPTION 'eatery_orders constraint set is %', v_names;
  END IF;
  SELECT count(*), array_agg(c.conname::text ORDER BY c.conname) INTO v_n, v_names
    FROM pg_constraint c WHERE c.conrelid = 'public.eatery_order_events'::regclass AND c.contype IN ('p','f','u','c');
  RAISE NOTICE 'eatery_order_events constraints: % %', v_n, v_names;
  IF v_names IS DISTINCT FROM ARRAY['eatery_order_events_cancel_pair_check','eatery_order_events_cancel_reason_check','eatery_order_events_order_id_fkey',
       'eatery_order_events_pkey','eatery_order_events_status_check']::text[] THEN
    RAISE EXCEPTION 'eatery_order_events constraint set is %', v_names;
  END IF;
  SELECT count(*) INTO v_n FROM pg_constraint c WHERE c.conrelid = 'public.eatery_order_events'::regclass AND c.contype = 'f'
     AND c.confrelid = 'public.eatery_orders'::regclass AND c.confdeltype = 'c';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'eatery_order_events needs exactly one FK to eatery_orders ON DELETE CASCADE (found %)', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_constraint c WHERE c.conrelid = 'public.eatery_orders'::regclass AND c.contype = 'f';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'eatery_orders must keep exactly ONE foreign key (partner_id), found %', v_n; END IF;
  FOR r IN SELECT c.conname, pg_get_constraintdef(c.oid) AS d FROM pg_constraint c
            WHERE c.conrelid = 'public.eatery_orders'::regclass AND c.conname IN ('eatery_orders_notify_lang_check','eatery_orders_status_check','eatery_orders_cancel_reason_check','eatery_orders_fulfilment_check') LOOP
    IF r.d LIKE '%''tr''%' OR r.d LIKE '%''en''%' THEN RAISE EXCEPTION '% accepts an ISO code: %', r.conname, r.d; END IF;
  END LOOP;

  -- Policies: the FULL set of every touched table, printed.
  FOREACH t IN ARRAY ARRAY['eatery_orders','eatery_order_events'] LOOP
    SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = t;
    IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION '% has % policies (want 0)', t, v_n; END IF;
    IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass('public.' || t)) THEN RAISE EXCEPTION '% has RLS off', t; END IF;
    IF has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_table_privilege('authenticated', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_any_column_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,REFERENCES')
       OR has_any_column_privilege('authenticated', 'public.' || t, 'SELECT,INSERT,UPDATE,REFERENCES')
       OR NOT has_table_privilege('service_role', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION '% grants: anon/authenticated must hold nothing, service_role must write', t;
    END IF;
  END LOOP;
  SELECT array_agg(policyname::text ORDER BY policyname) INTO v_names FROM pg_policies WHERE schemaname = 'public' AND tablename = 'eatery_partners';
  RAISE NOTICE 'eatery_partners policies: % %', cardinality(v_names), v_names;
  IF v_names IS DISTINCT FROM ARRAY['eatery_partners_select_active','eatery_partners_select_preview'] THEN RAISE EXCEPTION 'eatery_partners policy set changed: %', v_names; END IF;
  IF NOT has_column_privilege('anon', 'public.eatery_partners', 'order_status_enabled', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.eatery_partners', 'order_status_enabled', 'SELECT')
     OR has_any_column_privilege('anon', 'public.eatery_partners', 'INSERT,UPDATE')
     OR has_any_column_privilege('authenticated', 'public.eatery_partners', 'INSERT,UPDATE')
     OR NOT has_table_privilege('service_role', 'public.eatery_partners', 'UPDATE') THEN
    RAISE EXCEPTION 'eatery_partners column grants: clients read order_status_enabled, only service_role writes';
  END IF;

  -- Functions: one per name, old signatures gone, DEFINER / owner / config / EXECUTE grantees derived.
  IF to_regprocedure('public.create_eatery_order(uuid,jsonb,text)') IS NOT NULL OR to_regprocedure('public.verify_eatery_order(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'an old create/verify signature survived';
  END IF;
  FOR r IN SELECT p.proname, count(*) AS n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
             AND p.proname IN ('create_eatery_order','verify_eatery_order','my_eatery_orders','eatery_order_subscribe','eatery_order_next_statuses','eatery_order_can_manage')
            GROUP BY p.proname LOOP
    IF r.n IS DISTINCT FROM 1 THEN RAISE EXCEPTION '% has % overloads (want 1)', r.proname, r.n; END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('create_eatery_order','verify_eatery_order','my_eatery_orders','eatery_order_subscribe','eatery_order_next_statuses','eatery_order_can_manage');
  IF v_n IS DISTINCT FROM 6 THEN RAISE EXCEPTION 'expected 6 functions, found %', v_n; END IF;
  FOR r IN SELECT p.proname, p.prosecdef, p.proconfig, p.provolatile, pg_get_userbyid(p.proowner) AS owner,
                  COALESCE((SELECT string_agg(DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE g.rolname END, ',' ORDER BY CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE g.rolname END)
                     FROM aclexplode(p.proacl) a LEFT JOIN pg_roles g ON g.oid = a.grantee
                    WHERE a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner AND g.rolname IS DISTINCT FROM 'service_role'), '') AS grantees
             FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('create_eatery_order','verify_eatery_order','my_eatery_orders','eatery_order_subscribe','eatery_order_next_statuses','eatery_order_can_manage') LOOP
    RAISE NOTICE '% -> definer %, owner %, config %, EXECUTE for "%"', r.proname, r.prosecdef, r.owner, r.proconfig, r.grantees;
    v_want := CASE r.proname WHEN 'verify_eatery_order' THEN 'anon,authenticated'
                             WHEN 'eatery_order_next_statuses' THEN '' WHEN 'eatery_order_can_manage' THEN ''
                             ELSE 'authenticated' END;
    v_cfg  := CASE WHEN r.proname IN ('eatery_order_next_statuses','eatery_order_can_manage') THEN 'search_path=""' ELSE 'search_path=public, pg_temp' END;
    IF r.owner IS DISTINCT FROM 'postgres'
       OR r.grantees IS DISTINCT FROM v_want
       OR r.prosecdef IS DISTINCT FROM (r.proname <> 'eatery_order_next_statuses')
       OR NOT COALESCE(r.proconfig @> ARRAY[v_cfg], false) THEN
      RAISE EXCEPTION '% has the wrong owner / DEFINER flag / search_path / EXECUTE grantees', r.proname;
    END IF;
  END LOOP;
  IF (SELECT provolatile FROM pg_proc WHERE oid = 'public.eatery_order_next_statuses(text,text)'::regprocedure) IS DISTINCT FROM 'i' THEN
    RAISE EXCEPTION 'eatery_order_next_statuses must be IMMUTABLE';
  END IF;
  SELECT proargnames INTO v_names FROM pg_proc WHERE oid = 'public.create_eatery_order(uuid,jsonb,text,text)'::regprocedure;
  IF v_names IS DISTINCT FROM ARRAY['p_partner','p_items','p_client_id','p_mode']::text[] THEN RAISE EXCEPTION 'create_eatery_order argument names are %', v_names; END IF;
  SELECT proargnames INTO v_names FROM pg_proc WHERE oid = 'public.verify_eatery_order(text,text)'::regprocedure;
  IF v_names IS DISTINCT FROM ARRAY['p_code','p_device']::text[] THEN RAISE EXCEPTION 'verify_eatery_order argument names are %', v_names; END IF;
  IF (SELECT pronargdefaults FROM pg_proc WHERE oid = 'public.create_eatery_order(uuid,jsonb,text,text)'::regprocedure) IS DISTINCT FROM 2
     OR (SELECT pronargdefaults FROM pg_proc WHERE oid = 'public.verify_eatery_order(text,text)'::regprocedure) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'create must default p_client_id + p_mode, verify must default p_device';
  END IF;

  -- Bodies: new shapes + the 1125 / 1132 / 1134 / 1144 shapes that must survive.
  v_def := pg_get_functiondef('public.create_eatery_order(uuid,jsonb,text,text)'::regprocedure);
  IF v_def NOT LIKE '%MESSAGE = ''invalid_mode''%' OR v_def NOT LIKE '%p_mode IS NOT NULL AND p_mode NOT IN (''pickup'',''delivery'')%'
     OR v_def NOT LIKE '%client_id, created_as_guest, is_test, fulfilment)%' OR v_def NOT LIKE '%p_client_id, v_guest, v_test, p_mode)%'
     OR position('MESSAGE = ''invalid_mode''' IN v_def) > position('pg_advisory_xact_lock' IN v_def)
     OR v_def NOT LIKE '%MESSAGE = ''order_not_supported''%' OR v_def NOT LIKE '%JOIN public.eatery_item_options io%'
     OR v_def NOT LIKE '%v_test := public.is_previewer() OR public.is_order_tester(v_uid);%'
     OR v_def NOT LIKE '%WHERE partner_id = p_partner AND created_as_guest AND NOT is_test AND created_at > now()%'
     OR v_def NOT LIKE '%WHERE created_by = v_uid AND created_at > now() - interval ''1 hour'';%'
     OR v_def NOT LIKE '%v_partner.adult_only%' OR v_def NOT LIKE '%v_user_n >= 5%' OR v_def LIKE '%p_items -> %' THEN
    RAISE EXCEPTION 'create_eatery_order body: a carried-forward or new shape is missing';
  END IF;
  v_def := pg_get_functiondef('public.verify_eatery_order(text,text)'::regprocedure);
  IF v_def NOT LIKE '%''order_status'',%' OR v_def NOT LIKE '%''status_open'',%' OR v_def NOT LIKE '%''can_manage'',%' OR v_def NOT LIKE '%''next'',%'
     OR v_def NOT LIKE '%''detail'', l -> ''detail''%' OR v_def NOT LIKE '%view_count = view_count + 1%'
     OR v_def LIKE '%''created_by''%' OR v_def LIKE '%''client_id''%' OR v_def LIKE '%''notify_token''%' OR v_def LIKE '%''notify_lang''%' OR v_def LIKE '%option_id%' THEN
    RAISE EXCEPTION 'verify_eatery_order body: new keys missing, or a forbidden key present';
  END IF;
  v_def := pg_get_functiondef('public.my_eatery_orders()'::regprocedure);
  IF v_def NOT LIKE '%o.created_by = v_uid%' OR v_def LIKE '%view_count = view_count%' OR v_def LIKE '%UPDATE%' OR v_def LIKE '%''notify_token''%' THEN
    RAISE EXCEPTION 'my_eatery_orders body: owner filter missing, or it writes / returns the token';
  END IF;
  v_def := pg_get_functiondef('public.eatery_order_subscribe(text,text,text)'::regprocedure);
  IF v_def NOT LIKE '%created_by = v_uid FOR UPDATE%' OR v_def LIKE '%view_count%' THEN RAISE EXCEPTION 'eatery_order_subscribe body: owner filter missing or it counts a view'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations_applied WHERE filename = '20261194_eatery_order_status_partner.sql')
     AND pg_get_functiondef('public.eatery_order_can_manage(uuid,boolean,text)'::regprocedure) NOT LIKE '%SELECT false%' THEN
    RAISE EXCEPTION 'eatery_order_can_manage must be the false stub before 20261194';
  END IF;
END $$;

-- ─── Behaviour proof (throwaway partner and rows; a sentinel rolls everything back) ───
DO $$
DECLARE
  v_ids jsonb := '{}'::jsonb;
  s record; k record;
  v_sql text; v_res jsonb; v_state text; v_msg text; v_role text; v_claims text; v_got text; v_report text := '';
  v_uuid uuid; v_item bigint; v_cnt int := 0;
  v_pre_orders int; v_pre_partners int; v_pre_items int; v_pre_events int;
BEGIN
  SELECT count(*) INTO v_pre_orders FROM public.eatery_orders;
  SELECT count(*) INTO v_pre_partners FROM public.eatery_partners;
  SELECT count(*) INTO v_pre_items FROM public.eatery_menu_items;
  SELECT count(*) INTO v_pre_events FROM public.eatery_order_events;

  BEGIN
    INSERT INTO public.eatery_partners (slug, name, category, lat, lng, geocode_source, logo_path, menu_verified_on, is_active, order_method)
      VALUES ('zz-os-wa', 'zz zz-os-wa', 'cafe', 35.1, 33.3, 'partner', 'zz-os-wa/logo.png', current_date, true, 'whatsapp') RETURNING id INTO v_uuid;
    v_ids := v_ids || jsonb_build_object('wa', v_uuid);
    INSERT INTO public.eatery_menu_items (partner_id, section, name, price, currency) VALUES (v_uuid, 'zz', 'zz dish', 10.00, 'TRY') RETURNING id INTO v_item;
    v_ids := v_ids || jsonb_build_object('dwa', v_item);

    -- Steps: (label, who, sql, want, save). {{x}} = id; {{c_x}} = order code saved as x. who = anon | user:N | guest:N | pg | sr.
    -- want = ok | err:<message> (P0001) | state:<sqlstate> | val:<value>. Only labels are printed, never a result.
    FOR s IN SELECT * FROM (VALUES
      ('create, no p_mode (older app): accepted',            'user:81',  $q$SELECT public.create_eatery_order('{{wa}}', '[{"item_id":{{dwa}},"qty":1}]'::jsonb)$q$, 'ok', 'o1'),
      ('create, PostgREST-shaped named args only: accepted', 'user:81',  $q$SELECT public.create_eatery_order(p_partner => '{{wa}}', p_items => '[{"item_id":{{dwa}},"qty":1}]'::jsonb)$q$, 'ok', 'o1b'),
      ('create, p_mode delivery: accepted',                  'user:81',  $q$SELECT public.create_eatery_order('{{wa}}', '[{"item_id":{{dwa}},"qty":1}]'::jsonb, NULL, 'delivery')$q$, 'ok', 'o2'),
      ('create, p_mode pickup: accepted',                    'user:82',  $q$SELECT public.create_eatery_order('{{wa}}', '[{"item_id":{{dwa}},"qty":1}]'::jsonb, NULL, 'pickup')$q$, 'ok', 'o3'),
      ('p_mode carryout refused',                            'user:83',  $q$SELECT public.create_eatery_order('{{wa}}', '[{"item_id":{{dwa}},"qty":1}]'::jsonb, NULL, 'carryout')$q$, 'err:invalid_mode', NULL),
      ('p_mode PICKUP (case) refused',                       'user:83',  $q$SELECT public.create_eatery_order('{{wa}}', '[{"item_id":{{dwa}},"qty":1}]'::jsonb, NULL, 'PICKUP')$q$, 'err:invalid_mode', NULL),
      ('p_mode empty string refused',                        'user:83',  $q$SELECT public.create_eatery_order('{{wa}}', '[{"item_id":{{dwa}},"qty":1}]'::jsonb, NULL, '')$q$, 'err:invalid_mode', NULL),
      ('p_mode refused before the basket is read',           'user:83',  $q$SELECT public.create_eatery_order('{{wa}}', '[]'::jsonb, NULL, 'x')$q$, 'err:invalid_mode', NULL),
      ('refused modes wrote nothing',                        'pg',       $q$SELECT to_jsonb(count(*)) FROM public.eatery_orders WHERE created_by = '00000000-0000-4000-8000-000000000083'$q$, 'val:0', NULL),
      ('fulfilment of the older-app order is NULL',          'pg',       $q$SELECT to_jsonb(fulfilment IS NULL) FROM public.eatery_orders WHERE code = '{{c_o1}}'$q$, 'val:true', NULL),
      ('fulfilment of the delivery order is stored',         'pg',       $q$SELECT to_jsonb(fulfilment) FROM public.eatery_orders WHERE code = '{{c_o2}}'$q$, 'val:delivery', NULL),
      ('anon cannot call create at all',                     'anon',     $q$SELECT public.create_eatery_order('{{wa}}', '[{"item_id":{{dwa}},"qty":1}]'::jsonb, NULL, 'pickup')$q$, 'state:42501', NULL),
      -- verify: new keys, old keys, never the forbidden ones.
      ('verify (anon): order_status sent',                   'anon',     $q$SELECT public.verify_eatery_order('{{c_o1}}') -> 'order_status'$q$, 'val:sent', NULL),
      ('verify (anon): can_manage false (stub)',             'anon',     $q$SELECT public.verify_eatery_order('{{c_o1}}') -> 'can_manage'$q$, 'val:false', NULL),
      ('verify (anon): next is empty',                       'anon',     $q$SELECT public.verify_eatery_order('{{c_o1}}') -> 'next'$q$, 'val:[]', NULL),
      ('verify (anon): status_open true',                    'anon',     $q$SELECT public.verify_eatery_order('{{c_o1}}') -> 'status_open'$q$, 'val:true', NULL),
      ('verify (anon): status_enabled false (default)',      'anon',     $q$SELECT public.verify_eatery_order('{{c_o1}}') -> 'status_enabled'$q$, 'val:false', NULL),
      ('verify: 18 keys',                                    'anon',     $q$SELECT to_jsonb(count(*)) FROM jsonb_object_keys(public.verify_eatery_order('{{c_o1}}'))$q$, 'val:18', NULL),
      ('verify: every expected key present',                 'anon',     $q$SELECT to_jsonb(public.verify_eatery_order('{{c_o1}}') ?& ARRAY['status','partner_name','created_at','expires_at','lines','total','currency','first_viewed_at_before','view_count_before','is_test','fulfilment','order_status','status_at','cancel_reason','status_open','status_enabled','can_manage','next'])$q$, 'val:true', NULL),
      ('verify: no forbidden key',                           'anon',     $q$SELECT to_jsonb(public.verify_eatery_order('{{c_o1}}') ?| ARRAY['created_by','client_id','notify_token','notify_lang','item_id','option_id'])$q$, 'val:false', NULL),
      ('verify: status ok (expires_at still ahead)',         'anon',     $q$SELECT public.verify_eatery_order('{{c_o1}}') -> 'status'$q$, 'val:ok', NULL),
      ('verify: unknown code not_found',                     'anon',     $q$SELECT public.verify_eatery_order('AAAAAAAA') -> 'status'$q$, 'val:not_found', NULL),
      ('verify: still counts a view',                        'pg',       $q$SELECT to_jsonb(view_count > 0) FROM public.eatery_orders WHERE code = '{{c_o1}}'$q$, 'val:true', NULL),
      ('verify with a device argument is accepted',          'anon',     $q$SELECT public.verify_eatery_order('{{c_o1}}', 'zz-not-a-device') -> 'can_manage'$q$, 'val:false', NULL),
      -- my_eatery_orders
      ('my orders: user 81 sees exactly its 3',              'user:81',  $q$SELECT to_jsonb(jsonb_array_length(public.my_eatery_orders()))$q$, 'val:3', NULL),
      ('my orders: user 82 sees exactly its 1',              'user:82',  $q$SELECT to_jsonb(jsonb_array_length(public.my_eatery_orders()))$q$, 'val:1', NULL),
      ('my orders: user 84 (no orders) sees 0',              'user:84',  $q$SELECT to_jsonb(jsonb_array_length(public.my_eatery_orders()))$q$, 'val:0', NULL),
      ('my orders: a guest works',                           'guest:86', $q$SELECT to_jsonb(jsonb_array_length(public.my_eatery_orders()))$q$, 'val:0', NULL),
      ('my orders: anon refused',                            'anon',     $q$SELECT public.my_eatery_orders()$q$, 'state:42501', NULL),
      ('my orders: user 82 never sees user 81 order',        'user:82',  $q$SELECT to_jsonb(public.my_eatery_orders()::text LIKE '%{{c_o1}}%')$q$, 'val:false', NULL),
      ('my orders: CONTROL user 81 sees its own order',      'user:81',  $q$SELECT to_jsonb(public.my_eatery_orders()::text LIKE '%{{c_o1}}%')$q$, 'val:true', NULL),
      ('my orders: no view counted (before)',                'pg',       $q$SELECT to_jsonb(view_count) FROM public.eatery_orders WHERE code = '{{c_o3}}'$q$, 'val:0', NULL),
      ('my orders: call as owner',                           'user:82',  $q$SELECT to_jsonb(jsonb_array_length(public.my_eatery_orders()))$q$, 'val:1', NULL),
      ('my orders: no view counted (after)',                 'pg',       $q$SELECT to_jsonb(view_count) FROM public.eatery_orders WHERE code = '{{c_o3}}'$q$, 'val:0', NULL),
      -- subscribe
      ('subscribe: owner sets token + language',             'user:81',  $q$SELECT public.eatery_order_subscribe('{{c_o1b}}', 'ExponentPushToken[zzprobe0001]', 'Turkish')$q$, 'ok', NULL),
      ('subscribe: stored language',                         'pg',       $q$SELECT to_jsonb(notify_lang) FROM public.eatery_orders WHERE code = '{{c_o1b}}'$q$, 'val:Turkish', NULL),
      ('subscribe: not a view',                              'pg',       $q$SELECT to_jsonb(view_count) FROM public.eatery_orders WHERE code = '{{c_o1b}}'$q$, 'val:0', NULL),
      ('my orders: notify_set true, token never returned',   'user:81',  $q$SELECT to_jsonb(EXISTS (SELECT 1 FROM jsonb_array_elements(public.my_eatery_orders()) e WHERE e ->> 'code' = '{{c_o1b}}' AND (e ->> 'notify_set')::boolean) AND public.my_eatery_orders()::text NOT LIKE '%PushToken%')$q$, 'val:true', NULL),
      ('subscribe: another user gets not_found',             'user:82',  $q$SELECT public.eatery_order_subscribe('{{c_o1b}}', 'ExponentPushToken[zzprobe0002]', 'Turkish')$q$, 'err:not_found', NULL),
      ('subscribe: unknown code gets the same not_found',    'user:81',  $q$SELECT public.eatery_order_subscribe('AAAAAAAA', 'ExponentPushToken[zzprobe0001]', 'Turkish')$q$, 'err:not_found', NULL),
      ('subscribe: the other user did not overwrite it',     'pg',       $q$SELECT to_jsonb(notify_token) FROM public.eatery_orders WHERE code = '{{c_o1b}}'$q$, 'val:ExponentPushToken[zzprobe0001]', NULL),
      ('subscribe: bad token shape',                         'user:81',  $q$SELECT public.eatery_order_subscribe('{{c_o1b}}', 'garbage token', 'Turkish')$q$, 'err:invalid_token', NULL),
      ('subscribe: ISO language tr refused',                 'user:81',  $q$SELECT public.eatery_order_subscribe('{{c_o1b}}', 'ExponentPushToken[zzprobe0001]', 'tr')$q$, 'err:invalid_lang', NULL),
      ('subscribe: NULL language refused',                   'user:81',  $q$SELECT public.eatery_order_subscribe('{{c_o1b}}', 'ExponentPushToken[zzprobe0001]', NULL)$q$, 'err:invalid_lang', NULL),
      ('subscribe: anon refused',                            'anon',     $q$SELECT public.eatery_order_subscribe('{{c_o1b}}', 'ExponentPushToken[zzprobe0001]', 'Turkish')$q$, 'state:42501', NULL),
      ('subscribe: a guest session may call it (unknown code, not_found)',     'guest:87', $q$SELECT public.eatery_order_subscribe('AAAAAAAA', NULL, NULL)$q$, 'err:not_found', NULL),
      ('subscribe: NULL token clears both',                  'user:81',  $q$SELECT public.eatery_order_subscribe('{{c_o1b}}', NULL, NULL)$q$, 'ok', NULL),
      ('subscribe: both cleared',                            'pg',       $q$SELECT to_jsonb(notify_token IS NULL AND notify_lang IS NULL) FROM public.eatery_orders WHERE code = '{{c_o1b}}'$q$, 'val:true', NULL),
      -- 12 h window and final statuses
      ('age order 3 to 13 hours',                            'pg',       $q$WITH u AS (UPDATE public.eatery_orders SET created_at = now() - interval '13 hours' WHERE code = '{{c_o3}}' RETURNING 1) SELECT to_jsonb(count(*)) FROM u$q$, 'val:1', NULL),
      ('subscribe: 13 h old order is closed',                'user:82',  $q$SELECT public.eatery_order_subscribe('{{c_o3}}', 'ExponentPushToken[zzprobe0003]', 'Turkish')$q$, 'err:closed', NULL),
      ('verify: 13 h old order status_open false',           'anon',     $q$SELECT public.verify_eatery_order('{{c_o3}}') -> 'status_open'$q$, 'val:false', NULL),
      ('my orders: a 13 h old order is still listed',        'user:82',  $q$SELECT to_jsonb(jsonb_array_length(public.my_eatery_orders()))$q$, 'val:1', NULL),
      ('age order 3 to 25 hours',                            'pg',       $q$WITH u AS (UPDATE public.eatery_orders SET created_at = now() - interval '25 hours' WHERE code = '{{c_o3}}' RETURNING 1) SELECT to_jsonb(count(*)) FROM u$q$, 'val:1', NULL),
      ('my orders: a 25 h old order is not listed',          'user:82',  $q$SELECT to_jsonb(jsonb_array_length(public.my_eatery_orders()))$q$, 'val:0', NULL),
      ('a final status closes subscribe',                    'pg',       $q$WITH u AS (UPDATE public.eatery_orders SET status = 'on_the_way' WHERE code = '{{c_o2}}' RETURNING 1) SELECT to_jsonb(count(*)) FROM u$q$, 'val:1', NULL),
      ('subscribe: final status is closed',                  'user:81',  $q$SELECT public.eatery_order_subscribe('{{c_o2}}', 'ExponentPushToken[zzprobe0001]', 'Turkish')$q$, 'err:closed', NULL),
      ('verify: final status, status_open false',           'anon',     $q$SELECT public.verify_eatery_order('{{c_o2}}') -> 'status_open'$q$, 'val:false', NULL),
      -- CHECKs, as the table owner
      ('CHECK: cancelled without a reason refused',          'pg',       $q$UPDATE public.eatery_orders SET status = 'cancelled' WHERE code = '{{c_o1}}' RETURNING to_jsonb(id)$q$, 'state:23514', NULL),
      ('CHECK: a reason without cancelled refused',          'pg',       $q$UPDATE public.eatery_orders SET cancel_reason = 'busy' WHERE code = '{{c_o1}}' RETURNING to_jsonb(id)$q$, 'state:23514', NULL),
      ('CHECK: unknown reason refused',                      'pg',       $q$UPDATE public.eatery_orders SET status = 'cancelled', cancel_reason = 'rude' WHERE code = '{{c_o1}}' RETURNING to_jsonb(id)$q$, 'state:23514', NULL),
      ('CHECK: unknown status refused',                      'pg',       $q$UPDATE public.eatery_orders SET status = 'delivered' WHERE code = '{{c_o1}}' RETURNING to_jsonb(id)$q$, 'state:23514', NULL),
      ('CHECK: fulfilment other refused',                    'pg',       $q$UPDATE public.eatery_orders SET fulfilment = 'dinein' WHERE code = '{{c_o1}}' RETURNING to_jsonb(id)$q$, 'state:23514', NULL),
      ('CHECK: ISO language tr refused',                     'pg',       $q$UPDATE public.eatery_orders SET notify_token = 'ExponentPushToken[zzprobe0001]', notify_lang = 'tr' WHERE code = '{{c_o1}}' RETURNING to_jsonb(id)$q$, 'state:23514', NULL),
      ('CHECK: token without language refused',              'pg',       $q$UPDATE public.eatery_orders SET notify_token = 'ExponentPushToken[zzprobe0001]' WHERE code = '{{c_o1}}' RETURNING to_jsonb(id)$q$, 'state:23514', NULL),
      ('CHECK: language without token refused',              'pg',       $q$UPDATE public.eatery_orders SET notify_lang = 'Turkish' WHERE code = '{{c_o1}}' RETURNING to_jsonb(id)$q$, 'state:23514', NULL),
      ('CHECK: token with whitespace refused',               'pg',       $q$UPDATE public.eatery_orders SET notify_token = 'ExponentPushToken[zz probe 1]', notify_lang = 'Turkish' WHERE code = '{{c_o1}}' RETURNING to_jsonb(id)$q$, 'state:23514', NULL),
      ('CHECK: oversized token refused',                     'pg',       $q$UPDATE public.eatery_orders SET notify_token = 'ExponentPushToken[' || repeat('a', 201) || ']', notify_lang = 'Turkish' WHERE code = '{{c_o1}}' RETURNING to_jsonb(id)$q$, 'state:23514', NULL),
      ('CONTROL: a valid cancel + valid token pair is accepted', 'pg',    $q$WITH u AS (UPDATE public.eatery_orders SET status = 'cancelled', cancel_reason = 'busy', notify_token = 'ExpoPushToken[zzprobe0009]', notify_lang = 'Greek' WHERE code = '{{c_o1}}' RETURNING 1) SELECT to_jsonb(count(*)) FROM u$q$, 'val:1', NULL),
      -- Nobody reaches the tables or the helpers
      ('authenticated cannot SELECT eatery_orders',          'user:81',  $q$SELECT to_jsonb(count(*)) FROM public.eatery_orders$q$, 'state:42501', NULL),
      ('guest cannot SELECT eatery_orders',                  'guest:86', $q$SELECT to_jsonb(count(*)) FROM public.eatery_orders$q$, 'state:42501', NULL),
      ('anon cannot SELECT eatery_orders',                   'anon',     $q$SELECT to_jsonb(count(*)) FROM public.eatery_orders$q$, 'state:42501', NULL),
      ('authenticated cannot SELECT eatery_order_events',    'user:81',  $q$SELECT to_jsonb(count(*)) FROM public.eatery_order_events$q$, 'state:42501', NULL),
      ('authenticated cannot INSERT eatery_order_events',    'user:81',  $q$INSERT INTO public.eatery_order_events (order_id, status) VALUES ('00000000-0000-4000-8000-0000000000aa', 'received')$q$, 'state:42501', NULL),
      ('anon cannot SELECT eatery_order_events',             'anon',     $q$SELECT to_jsonb(count(*)) FROM public.eatery_order_events$q$, 'state:42501', NULL),
      ('CONTROL service_role reads the orders',              'sr',       $q$SELECT to_jsonb(count(*) > 0) FROM public.eatery_orders$q$, 'val:true', NULL),
      ('CONTROL service_role reads the events (empty)',      'sr',       $q$SELECT to_jsonb(count(*)) FROM public.eatery_order_events$q$, 'val:0', NULL),
      ('authenticated cannot call next_statuses',            'user:81',  $q$SELECT public.eatery_order_next_statuses('sent', 'pickup')$q$, 'state:42501', NULL),
      ('authenticated cannot call can_manage',               'user:81',  $q$SELECT public.eatery_order_can_manage('{{wa}}', false, 'x')$q$, 'state:42501', NULL),
      ('anon cannot call can_manage',                        'anon',     $q$SELECT public.eatery_order_can_manage('{{wa}}', false, 'x')$q$, 'state:42501', NULL),
      -- Transition table (internal helper, called as the owner)
      ('next: sent / delivery',                              'pg',       $q$SELECT to_jsonb(public.eatery_order_next_statuses('sent', 'delivery'))$q$, 'val:["received", "preparing", "on_the_way", "cancelled"]', NULL),
      ('next: sent / pickup',                                'pg',       $q$SELECT to_jsonb(public.eatery_order_next_statuses('sent', 'pickup'))$q$, 'val:["received", "preparing", "ready", "cancelled"]', NULL),
      ('next: sent / unknown mode offers both finals',       'pg',       $q$SELECT to_jsonb(public.eatery_order_next_statuses('sent', NULL))$q$, 'val:["received", "preparing", "on_the_way", "ready", "cancelled"]', NULL),
      ('next: received / pickup',                            'pg',       $q$SELECT to_jsonb(public.eatery_order_next_statuses('received', 'pickup'))$q$, 'val:["preparing", "ready", "cancelled"]', NULL),
      ('next: preparing / delivery',                         'pg',       $q$SELECT to_jsonb(public.eatery_order_next_statuses('preparing', 'delivery'))$q$, 'val:["on_the_way", "cancelled"]', NULL),
      ('next: on_the_way is final',                          'pg',       $q$SELECT to_jsonb(public.eatery_order_next_statuses('on_the_way', 'delivery'))$q$, 'val:[]', NULL),
      ('next: ready is final',                               'pg',       $q$SELECT to_jsonb(public.eatery_order_next_statuses('ready', 'pickup'))$q$, 'val:[]', NULL),
      ('next: cancelled is final',                           'pg',       $q$SELECT to_jsonb(public.eatery_order_next_statuses('cancelled', NULL))$q$, 'val:[]', NULL),
      -- partner flag
      ('anon reads order_status_enabled (default false)',    'anon',     $q$SELECT to_jsonb(order_status_enabled) FROM public.eatery_partners WHERE id = '{{wa}}'$q$, 'val:false', NULL),
      ('authenticated cannot write order_status_enabled',    'user:81',  $q$UPDATE public.eatery_partners SET order_status_enabled = true WHERE id = '{{wa}}' RETURNING to_jsonb(id)$q$, 'state:42501', NULL),
      ('anon cannot write order_status_enabled',             'anon',     $q$UPDATE public.eatery_partners SET order_status_enabled = true WHERE id = '{{wa}}' RETURNING to_jsonb(id)$q$, 'state:42501', NULL),
      ('CONTROL service_role can write order_status_enabled', 'sr',      $q$WITH u AS (UPDATE public.eatery_partners SET order_status_enabled = true WHERE id = '{{wa}}' RETURNING 1) SELECT to_jsonb(count(*)) FROM u$q$, 'val:1', NULL)
    ) AS x(label, who, sql, want, save) LOOP
      v_sql := s.sql;
      FOR k IN SELECT key, value FROM jsonb_each_text(v_ids) LOOP
        v_sql := replace(v_sql, '{{' || k.key || '}}', k.value);
      END LOOP;
      v_role := CASE WHEN s.who = 'anon' THEN 'anon' WHEN s.who = 'pg' THEN NULL WHEN s.who = 'sr' THEN 'service_role' ELSE 'authenticated' END;
      v_claims := CASE
        WHEN s.who IN ('anon', 'pg') THEN ''
        WHEN s.who = 'sr' THEN json_build_object('role', 'service_role')::text
        WHEN s.who LIKE 'guest:%' THEN json_build_object('sub', '00000000-0000-4000-8000-' || lpad(split_part(s.who, ':', 2), 12, '0'), 'role', 'authenticated', 'is_anonymous', true)::text
        ELSE json_build_object('sub', '00000000-0000-4000-8000-' || lpad(split_part(s.who, ':', 2), 12, '0'), 'role', 'authenticated')::text END;
      v_res := NULL; v_state := NULL; v_msg := NULL;
      BEGIN
        IF v_role IS NOT NULL THEN EXECUTE format('SET LOCAL ROLE %I', v_role); END IF;
        PERFORM set_config('request.jwt.claims', v_claims, true);
        PERFORM set_config('request.headers', '', true);
        EXECUTE v_sql INTO v_res;
      EXCEPTION WHEN OTHERS THEN
        v_state := SQLSTATE; v_msg := SQLERRM;
      END;
      RESET ROLE;
      PERFORM set_config('request.jwt.claims', '', true);

      v_got := CASE WHEN v_state IS NULL THEN 'ok' ELSE 'err ' || v_state END;
      IF s.want = 'ok' THEN
        IF v_state IS NOT NULL THEN RAISE EXCEPTION 'STEP "%" (as %): expected ok, got % [%]', s.label, s.who, v_got, v_msg; END IF;
      ELSIF s.want LIKE 'err:%' THEN
        IF v_state IS DISTINCT FROM 'P0001' OR v_msg IS DISTINCT FROM substr(s.want, 5) THEN
          RAISE EXCEPTION 'STEP "%" (as %): expected P0001 "%", got % [%]', s.label, s.who, substr(s.want, 5), v_got, v_msg;
        END IF;
      ELSIF s.want LIKE 'state:%' THEN
        IF v_state IS DISTINCT FROM substr(s.want, 7) THEN RAISE EXCEPTION 'STEP "%" (as %): expected SQLSTATE %, got %', s.label, s.who, substr(s.want, 7), v_got; END IF;
      ELSIF s.want LIKE 'val:%' THEN
        IF v_state IS NOT NULL OR (v_res #>> '{}') IS DISTINCT FROM substr(s.want, 5) THEN
          RAISE EXCEPTION 'STEP "%" (as %): expected the stated value, got % (state %)', s.label, s.who, v_got, v_state;
        END IF;
      END IF;
      IF s.save IS NOT NULL THEN v_ids := v_ids || jsonb_build_object('c_' || s.save, v_res ->> 'code'); END IF;
      v_cnt := v_cnt + 1;
      v_report := v_report || format(E'\n  %-72s %-9s -> %s', s.label, s.who, v_got);
    END LOOP;

    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'zz-sentinel';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'zz-sentinel' THEN RAISE; END IF;
  END;
  RESET ROLE;

  IF (SELECT count(*) FROM public.eatery_orders) IS DISTINCT FROM v_pre_orders
     OR (SELECT count(*) FROM public.eatery_partners) IS DISTINCT FROM v_pre_partners
     OR (SELECT count(*) FROM public.eatery_menu_items) IS DISTINCT FROM v_pre_items
     OR (SELECT count(*) FROM public.eatery_order_events) IS DISTINCT FROM v_pre_events
     OR EXISTS (SELECT 1 FROM public.eatery_partners WHERE slug LIKE 'zz-os-%') THEN
    RAISE EXCEPTION 'probe rows survived the sentinel';
  END IF;
  RAISE NOTICE 'order status part 1 probes (all as stated); nothing survived:%', v_report;
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
VALUES ('20261193_eatery_order_status.sql', 'c02dd3d72ebbd04b231eb83db80497f999da924db276249be9a45f9c95badaff')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';
