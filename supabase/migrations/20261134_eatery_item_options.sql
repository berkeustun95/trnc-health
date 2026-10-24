-- ═══════════════════════════════════════════════════════════════════════════
-- 20261134 — Yeme-İçme: per-dish options ("Malzeme çıkar" / "Ekstra ekle") + create/verify_eatery_order v2
-- ═══════════════════════════════════════════════════════════════════════════
--
-- SCHEMA + RPC ONLY. No option row is created here (a separate data migration seeds Crunchy Express).
--
-- Two option kinds, nothing else (no sauce choice, no groups, no reference to another item):
--   'remove'  "Malzeme çıkar": free, quantity always 1, price NULL.
--   'extra'   "Ekstra ekle":   carries its own price; price NULL = HIDDEN (the app does not show it and the server
--                              refuses it). At launch every extra is hidden, so only removals are visible.
--
-- (1) public.eatery_option_label_valid(jsonb): IMMUTABLE helper used by a CHECK. TRUE only for a JSON object with
--     EXACTLY the nine language keys (English, Turkish, Arabic, Russian, Greek, French, Spanish, German, Persian: full
--     English names, never ISO codes, so a 'tr' key is refused) whose values are all strings that are not blank and
--     at most 60 characters. Why a function and not an inline expression: the CHECK then renders as
--     CHECK (eatery_option_label_valid(label_i18n)) on every Postgres major, so verify_schema can match it, while a
--     jsonpath expression's pg_get_constraintdef text was only ever seen on PG 18 (the harness). Precedent:
--     towing_hours_valid. No client may call it (EXECUTE revoked from PUBLIC, anon, authenticated).
-- (2) public.eatery_item_options (id, item_id -> eatery_menu_items ON DELETE CASCADE, kind, label_i18n, message_tr,
--     price numeric(8,2) NULL, max_qty smallint, sort_order, is_available) with named CHECKs, UNIQUE
--     (item_id, kind, message_tr) and an index on item_id. label_i18n is what the app shows (sentence case,
--     "Turşu"); message_tr is what the restaurant reads on WhatsApp ("turşusuz" for a removal, "burger peyniri" for
--     an extra; the server prefixes "+ekstra ").
-- (3) create_eatery_order(uuid, jsonb, text), SAME signature, v2. Each p_items element is {item_id, qty} exactly as
--     shipped apps send it, OPTIONALLY plus "opts": [{"id": <int>, "qty": <int 1..10>}] (1..20 entries, distinct
--     ids). The app sends "opts" only for a line that has an option, so a plain basket's payload is unchanged.
--       • malformed opts, a repeated option id, a repeated identical line, a remove with qty <> 1, an extra with
--         qty > max_qty                                        -> invalid_items
--       • option not found / of ANOTHER dish / not is_available / an extra with price NULL (hidden)
--                                                              -> option_unavailable (new)
--       • lines must be distinct by (item_id, sorted list of option id x qty); for a basket without opts that is
--         today's "distinct item_id" rule. The same dish twice with different option sets is therefore fine.
--     Price: unit_price = menu price + SUM(extra price x option qty); total = SUM(line qty x unit_price), rounded to
--     2 places. A price the client sends is never read.
--     Stored line (eatery_orders.lines element), in input order:
--       without options: {item_id, name, qty, unit_price}                      (exactly today's object)
--       with options:    {item_id, name, qty, unit_price, base_price,
--                         options: [{option_id, kind, name, qty, price}], detail}
--     options[].name is the option's message_tr (the same Turkish text detail is built from). detail is the ONE Turkish
--     formatter (the app message, the verify page and the worker all print it): removals first in (sort_order, id)
--     order as message_tr, then extras in (sort_order, id) order as "+ekstra <message_tr>" (qty 1) or
--     "+<qty> ekstra <message_tr>" (qty > 1), joined with ", ", e.g. "turşusuz, marulsuz",
--     "turşusuz, +ekstra burger peyniri", "+2 ekstra köfte".
--     EVERYTHING ELSE is the 20261132 body byte for byte (is_test derivation, rate limits, advisory locks, gates,
--     code generator, INSERT column list, return keys). scripts/test-eatery-item-options-sql.mjs proves "identical
--     except" by diffing pg_get_functiondef after 20261132 and after this file.
-- (4) verify_eatery_order: IDENTICAL to 20261132 except each returned line object also carries 'detail' (JSON null
--     for a plain line). No option ids are exposed.
--
-- ─── WHO CAN READ / WRITE WHAT ──────────────────────────────────────────────
--   • eatery_item_options READ: anyone using the app (signed in, guest or not signed in) reads a dish's options
--     while its restaurant is live (eatery_item_options_select_active). Options of a restaurant that is NOT live
--     are readable only with the ADA Preview key (eatery_item_options_select_preview, the same shape as the live
--     eatery_menu_items policies of 20261115 / 20261120). Every option row is public content about a dish; nothing
--     about any person is stored. Hidden extras and unavailable options are readable too (the app filters them);
--     the server refuses them when an order is created.
--   • eatery_item_options WRITE: nobody through the API. anon and authenticated hold SELECT only (no INSERT, UPDATE,
--     DELETE, TRUNCATE, REFERENCES, TRIGGER, no column privilege); service_role (migrations, admin workflows) writes.
--   • create_eatery_order / verify_eatery_order / the new helper: grants exactly as before (create: authenticated
--     only, guests included; verify: anon + authenticated; helper: no client EXECUTE). The comments are updated.
--   • eatery_orders: unchanged (no policy, no client privilege). Its lines may now carry an options array and a
--     detail string; no personal data is added.
--
-- PROOF (inside this file): pre-state (20261132 in the ledger, both bodies are the 20261132 bodies or already these);
-- the helper's shape and grants; the table's columns, defaults, identity, FK (cascade), the full CHECK set (count and
-- names printed), the index; RLS on and the FULL policy set (count and names printed) on the new table and on the
-- two parents; grants (anon/authenticated SELECT only, service_role writes); both function bodies; and, in a
-- rolled-back sentinel, behaviour probes with positive controls: plain basket, removals, extras, client prices
-- ignored, same dish with two option sets, every refusal, the verify detail, row visibility for anon / guest /
-- signed-in / Preview key on a live and a non-live restaurant, every write refused for anon and authenticated
-- (42501) while service_role and postgres can write, every CHECK mutant refused (23514/23505) beside a valid row,
-- and the FK cascade.
--
-- Apply: gh workflow run supabase-migrate -f file=20261134_eatery_item_options.sql (dry), then -f apply=true
-- (Berke approves production-db). CREATEs a table ⇒ ends with NOTIFY pgrst (after COMMIT and RESET ROLE).
-- Re-runnable: the second apply accepts the already-changed bodies.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── Pre-state (abort before changing anything) ─────────────────────────────
DO $$
DECLARE
  v_def text; v_vdef text; v_done boolean; v_names text[]; t text;
BEGIN
  IF to_regclass('public.schema_migrations_applied') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.schema_migrations_applied WHERE filename = '20261132_eatery_orders_is_test.sql') THEN
    RAISE EXCEPTION 'pre-state: 20261132_eatery_orders_is_test.sql is not in the ledger';
  END IF;
  IF to_regclass('public.eatery_orders') IS NULL OR to_regclass('public.eatery_menu_items') IS NULL OR to_regclass('public.eatery_partners') IS NULL
     OR to_regprocedure('public.create_eatery_order(uuid,jsonb,text)') IS NULL OR to_regprocedure('public.verify_eatery_order(text)') IS NULL
     OR to_regprocedure('public.is_previewer()') IS NULL OR to_regprocedure('public.is_order_tester(uuid)') IS NULL
     OR to_regclass('private.preview_key_hashes') IS NULL THEN
    RAISE EXCEPTION 'pre-state: eatery tables / order functions / is_previewer() / is_order_tester() / private.preview_key_hashes missing';
  END IF;

  v_done := EXISTS (SELECT 1 FROM public.schema_migrations_applied WHERE filename = '20261134_eatery_item_options.sql');
  v_def  := pg_get_functiondef(to_regprocedure('public.create_eatery_order(uuid,jsonb,text)'));
  v_vdef := pg_get_functiondef(to_regprocedure('public.verify_eatery_order(text)'));
  IF NOT v_done THEN
    IF position('created_by, client_id, created_as_guest, is_test)' IN v_def) = 0
       OR position('v_test := public.is_previewer() OR public.is_order_tester(v_uid);' IN v_def) = 0
       OR position('option_unavailable' IN v_def) > 0 THEN
      RAISE EXCEPTION 'pre-state: create_eatery_order is not the 20261132 body. Nothing applied.';
    END IF;
    IF position('''is_test'',                v_o.is_test' IN v_vdef) = 0 OR position('''detail''' IN v_vdef) > 0 THEN
      RAISE EXCEPTION 'pre-state: verify_eatery_order is not the 20261132 body. Nothing applied.';
    END IF;
  ELSE
    IF position('option_unavailable' IN v_def) = 0 OR position('''detail'', l -> ''detail''' IN v_vdef) = 0 THEN
      RAISE EXCEPTION 'pre-state: 20261134 is in the ledger but the order functions are not its bodies';
    END IF;
  END IF;

  -- The eatery policy set must be exactly what 20261120 left (2 per table): my policies mirror those.
  FOREACH t IN ARRAY ARRAY['eatery_partners','eatery_menu_items'] LOOP
    SELECT array_agg(policyname::text ORDER BY policyname) INTO v_names FROM pg_policies WHERE schemaname = 'public' AND tablename = t;
    IF v_names IS DISTINCT FROM ARRAY[t || '_select_active', t || '_select_preview'] THEN
      RAISE EXCEPTION 'pre-state: % has policies % (expected the 1119/1120 pair). Nothing applied.', t, v_names;
    END IF;
  END LOOP;
  RAISE NOTICE 'pre-state ok (re-run: %)', v_done;
END $$;

-- ─── (1) Label helper ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.eatery_option_label_valid(j jsonb)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path = ''
AS $fn$
  SELECT COALESCE(
    pg_catalog.jsonb_typeof(j) = 'object'
    AND j ?& ARRAY['English','Turkish','Arabic','Russian','Greek','French','Spanish','German','Persian']
    AND (j - ARRAY['English','Turkish','Arabic','Russian','Greek','French','Spanish','German','Persian']) = '{}'::pg_catalog.jsonb
    AND NOT pg_catalog.jsonb_path_exists(j, '$.* ? (@.type() != "string" || @ like_regex "^\\s*$" || @ like_regex "^.{61,}$" flag "s")'),
    false)
$fn$;
ALTER FUNCTION public.eatery_option_label_valid(jsonb) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.eatery_option_label_valid(jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.eatery_option_label_valid(jsonb) TO service_role;
COMMENT ON FUNCTION public.eatery_option_label_valid(jsonb) IS
  'CHECK helper for eatery_item_options.label_i18n: a JSON object with exactly the nine full-English-name language keys, every value a non-blank string of at most 60 characters. IMMUTABLE; no client EXECUTE. 20261134.';

-- ─── (2) eatery_item_options ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.eatery_item_options (
  id           bigint        GENERATED ALWAYS AS IDENTITY,
  item_id      bigint        NOT NULL,
  kind         text          NOT NULL,
  label_i18n   jsonb         NOT NULL,
  message_tr   text          NOT NULL,
  price        numeric(8,2),
  max_qty      smallint      NOT NULL DEFAULT 1,
  sort_order   int           NOT NULL DEFAULT 0,
  is_available boolean       NOT NULL DEFAULT true,
  CONSTRAINT eatery_item_options_pkey PRIMARY KEY (id)
);
ALTER TABLE public.eatery_item_options DROP CONSTRAINT IF EXISTS eatery_item_options_item_id_fkey;
ALTER TABLE public.eatery_item_options ADD  CONSTRAINT eatery_item_options_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES public.eatery_menu_items (id) ON DELETE CASCADE;
ALTER TABLE public.eatery_item_options DROP CONSTRAINT IF EXISTS eatery_item_options_item_kind_message_key;
ALTER TABLE public.eatery_item_options ADD  CONSTRAINT eatery_item_options_item_kind_message_key
  UNIQUE (item_id, kind, message_tr);
ALTER TABLE public.eatery_item_options DROP CONSTRAINT IF EXISTS eatery_item_options_kind_check;
ALTER TABLE public.eatery_item_options ADD  CONSTRAINT eatery_item_options_kind_check
  CHECK (kind IN ('remove','extra'));
ALTER TABLE public.eatery_item_options DROP CONSTRAINT IF EXISTS eatery_item_options_label_check;
ALTER TABLE public.eatery_item_options ADD  CONSTRAINT eatery_item_options_label_check
  CHECK (public.eatery_option_label_valid(label_i18n));
ALTER TABLE public.eatery_item_options DROP CONSTRAINT IF EXISTS eatery_item_options_message_check;
ALTER TABLE public.eatery_item_options ADD  CONSTRAINT eatery_item_options_message_check
  CHECK (length(message_tr) BETWEEN 1 AND 60 AND message_tr = btrim(message_tr) AND btrim(message_tr) <> '');
ALTER TABLE public.eatery_item_options DROP CONSTRAINT IF EXISTS eatery_item_options_price_check;
ALTER TABLE public.eatery_item_options ADD  CONSTRAINT eatery_item_options_price_check
  CHECK (price IS NULL OR price > 0);
ALTER TABLE public.eatery_item_options DROP CONSTRAINT IF EXISTS eatery_item_options_max_qty_check;
ALTER TABLE public.eatery_item_options ADD  CONSTRAINT eatery_item_options_max_qty_check
  CHECK (max_qty BETWEEN 1 AND 10);
ALTER TABLE public.eatery_item_options DROP CONSTRAINT IF EXISTS eatery_item_options_remove_shape_check;
ALTER TABLE public.eatery_item_options ADD  CONSTRAINT eatery_item_options_remove_shape_check
  CHECK (kind <> 'remove' OR (price IS NULL AND max_qty = 1));
CREATE INDEX IF NOT EXISTS eatery_item_options_item_idx ON public.eatery_item_options (item_id);

ALTER TABLE public.eatery_item_options ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.eatery_item_options FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.eatery_item_options TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.eatery_item_options TO service_role;

DROP POLICY IF EXISTS eatery_item_options_select_active ON public.eatery_item_options;
CREATE POLICY eatery_item_options_select_active ON public.eatery_item_options
  FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.eatery_menu_items m JOIN public.eatery_partners p ON p.id = m.partner_id
                  WHERE m.id = eatery_item_options.item_id AND p.is_active));

DROP POLICY IF EXISTS eatery_item_options_select_preview ON public.eatery_item_options;
CREATE POLICY eatery_item_options_select_preview ON public.eatery_item_options
  FOR SELECT TO anon, authenticated
  USING ((SELECT public.is_previewer())
         AND EXISTS (SELECT 1 FROM public.eatery_menu_items m JOIN public.eatery_partners p ON p.id = m.partner_id
                      WHERE m.id = eatery_item_options.item_id AND NOT p.is_active));

COMMENT ON TABLE public.eatery_item_options IS
  'Per-dish options: kind remove ("Malzeme çıkar", free, qty 1) or extra ("Ekstra ekle", own price; price NULL = hidden, refused by create_eatery_order). label_i18n = the nine full-English-name languages (app text); message_tr = what the restaurant reads. SELECT for anon/authenticated while the restaurant is live (Preview key: also while not live); writes service_role only. 20261134.';

-- ─── (3) create_eatery_order v2: 20261132 body + options ────────────────────
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
  v_bad     int;
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
  'Records a WhatsApp order and returns {code, lines, total, currency, expires_at}. Prices come from eatery_menu_items and eatery_item_options, never the client. A p_items element may carry "opts" [{id, qty}]: removals (qty 1, free) and priced extras; the stored line then also holds base_price, options and a Turkish detail. authenticated only (guests included unless the partner sets order_requires_account). 5/user/h counts ALL orders including test orders; 60/partner/h counts guest-session orders that are NOT test orders. is_test is derived by the server (ADA Preview key header, or a listed order tester who is not a guest), never a parameter; test orders are deleted after 24 h. Errors: SQLSTATE P0001, MESSAGE = not_authenticated | partner_unavailable | adult_only (DETAIL guest/no_dob/under_18) | order_requires_account | invalid_items | invalid_client_id | item_unavailable | option_unavailable | mixed_currency | rate_limited | code_generation_failed. 20261134.';

-- ─── (4) verify_eatery_order: 20261132 body + 'detail' per line ────────────
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
    'is_test',                v_o.is_test);
END;
$fn$;
ALTER FUNCTION public.verify_eatery_order(text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.verify_eatery_order(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.verify_eatery_order(text) TO anon, authenticated;
COMMENT ON FUNCTION public.verify_eatery_order(text) IS
  'Partner-side check of a WhatsApp order code (anon + authenticated). Returns {status ok|expired|not_found, partner_name, created_at, expires_at, lines[name,qty,unit_price,detail], total, currency, first_viewed_at_before, view_count_before, is_test} and counts the call as a view. detail is the Turkish option text of a line (null for a plain line). Never returns created_by, client_id, item ids or option ids. 20261134.';

-- ─── Structure proof (read from the live catalogs) ──────────────────────────
DO $$
DECLARE
  v_n int; v_s text; v_def text; v_names text[]; t text; r record; v_report text := ''; v_perm text;
BEGIN
  -- Helper: IMMUTABLE, owner postgres, pinned empty search_path, no client EXECUTE, service_role keeps it.
  SELECT count(*) INTO v_n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'eatery_option_label_valid'
     AND p.provolatile = 'i' AND pg_get_userbyid(p.proowner) = 'postgres' AND p.proconfig @> ARRAY['search_path=""'];
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'eatery_option_label_valid is not exactly one IMMUTABLE postgres function with search_path=""'; END IF;
  IF has_function_privilege('anon', 'public.eatery_option_label_valid(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.eatery_option_label_valid(jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.eatery_option_label_valid(jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('postgres', 'public.eatery_option_label_valid(jsonb)', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) a WHERE p.oid = to_regprocedure('public.eatery_option_label_valid(jsonb)') AND a.grantee = 0) THEN
    RAISE EXCEPTION 'eatery_option_label_valid EXECUTE: anon/authenticated/PUBLIC must have none, service_role and postgres must';
  END IF;
  v_def := pg_get_functiondef(to_regprocedure('public.eatery_option_label_valid(jsonb)'));
  IF v_def NOT LIKE '%''English'',''Turkish'',''Arabic'',''Russian'',''Greek'',''French'',''Spanish'',''German'',''Persian''%'
     OR v_def NOT LIKE '%jsonb_path_exists%' OR v_def NOT LIKE '%?&%' OR v_def LIKE '%''tr''%' THEN
    RAISE EXCEPTION 'eatery_option_label_valid body is not the nine-name check';
  END IF;

  -- Table: columns, identity, defaults.
  SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
                    || CASE WHEN a.attidentity = 'a' THEN ' IDENTITY' ELSE '' END, ', ' ORDER BY a.attnum) INTO v_s
    FROM pg_attribute a WHERE a.attrelid = 'public.eatery_item_options'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_s IS DISTINCT FROM 'id bigint NOT NULL IDENTITY, item_id bigint NOT NULL, kind text NOT NULL, label_i18n jsonb NOT NULL, message_tr text NOT NULL, price numeric(8,2), max_qty smallint NOT NULL, sort_order integer NOT NULL, is_available boolean NOT NULL' THEN
    RAISE EXCEPTION 'eatery_item_options columns are [%]', v_s;
  END IF;
  SELECT string_agg(a.attname || '=' || pg_get_expr(d.adbin, d.adrelid), ', ' ORDER BY a.attname) INTO v_s
    FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum WHERE d.adrelid = 'public.eatery_item_options'::regclass;
  IF v_s IS DISTINCT FROM 'is_available=true, max_qty=1, sort_order=0' THEN RAISE EXCEPTION 'eatery_item_options defaults are [%]', v_s; END IF;

  -- Constraints: the full set, printed. One FK, ON DELETE CASCADE, to eatery_menu_items.
  SELECT count(*), string_agg(c.conname || ' ' || pg_get_constraintdef(c.oid), E'\n    ' ORDER BY c.conname) INTO v_n, v_s
    FROM pg_constraint c WHERE c.conrelid = 'public.eatery_item_options'::regclass AND c.contype IN ('p','f','u','c');
  RAISE NOTICE E'eatery_item_options constraints: %\n    %', v_n, v_s;
  SELECT array_agg(c.conname::text ORDER BY c.conname) INTO v_names FROM pg_constraint c WHERE c.conrelid = 'public.eatery_item_options'::regclass AND c.contype IN ('p','f','u','c');
  IF v_names IS DISTINCT FROM ARRAY['eatery_item_options_item_id_fkey','eatery_item_options_item_kind_message_key','eatery_item_options_kind_check',
       'eatery_item_options_label_check','eatery_item_options_max_qty_check','eatery_item_options_message_check','eatery_item_options_pkey',
       'eatery_item_options_price_check','eatery_item_options_remove_shape_check']::text[] THEN
    RAISE EXCEPTION 'eatery_item_options constraint set is %', v_names;
  END IF;
  SELECT count(*) INTO v_n FROM pg_constraint c WHERE c.conrelid = 'public.eatery_item_options'::regclass AND c.contype = 'f'
     AND c.confrelid = 'public.eatery_menu_items'::regclass AND c.confdeltype = 'c';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'eatery_item_options needs exactly one FK to eatery_menu_items ON DELETE CASCADE (found %)', v_n; END IF;
  IF (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conname = 'eatery_item_options_label_check' AND c.conrelid = 'public.eatery_item_options'::regclass)
       NOT LIKE '%eatery_option_label_valid(label_i18n)%'
     OR (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conname = 'eatery_item_options_kind_check' AND c.conrelid = 'public.eatery_item_options'::regclass)
       NOT LIKE '%remove%' OR (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conname = 'eatery_item_options_kind_check' AND c.conrelid = 'public.eatery_item_options'::regclass) NOT LIKE '%extra%'
     OR (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conname = 'eatery_item_options_remove_shape_check' AND c.conrelid = 'public.eatery_item_options'::regclass)
       NOT LIKE '%price IS NULL%' OR (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conname = 'eatery_item_options_remove_shape_check' AND c.conrelid = 'public.eatery_item_options'::regclass) NOT LIKE '%max_qty = 1%'
     OR (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conname = 'eatery_item_options_price_check' AND c.conrelid = 'public.eatery_item_options'::regclass) NOT LIKE '%price > (0)::numeric%' THEN
    RAISE EXCEPTION 'a CHECK on eatery_item_options does not say what it must (label helper / kind / remove shape / price > 0): %', replace(v_s, E'\n    ', ' ; ');
  END IF;
  SELECT count(*) INTO v_n FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'eatery_item_options' AND indexname = 'eatery_item_options_item_idx'
     AND indexdef LIKE '%(item_id)%';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'index eatery_item_options_item_idx on (item_id) missing'; END IF;

  -- RLS and the FULL policy set (permissive-OR: mine never prove the absence of others), printed.
  IF (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.eatery_item_options'::regclass) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'RLS is not enabled on eatery_item_options';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'eatery_item_options';
  IF v_n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'eatery_item_options has % policies (want exactly 2)', v_n; END IF;
  FOR r IN SELECT policyname, cmd, permissive, roles::text AS roles, qual, with_check FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'eatery_item_options' ORDER BY policyname LOOP
    v_report := v_report || E'\n  ' || r.policyname || ' ' || r.cmd || ' ' || r.permissive || ' ' || r.roles || ' USING ' || r.qual;
    IF r.cmd IS DISTINCT FROM 'SELECT' OR r.permissive IS DISTINCT FROM 'PERMISSIVE' OR r.roles IS DISTINCT FROM '{anon,authenticated}' OR r.with_check IS NOT NULL THEN
      RAISE EXCEPTION 'policy % is not a permissive SELECT for exactly {anon,authenticated} without WITH CHECK: % % %', r.policyname, r.cmd, r.permissive, r.roles;
    END IF;
  END LOOP;
  RAISE NOTICE 'eatery_item_options policies:%', v_report;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'eatery_item_options' AND policyname = 'eatery_item_options_select_active'
                  AND qual LIKE '%p.is_active%' AND qual NOT LIKE '%NOT p.is_active%' AND qual NOT LIKE '%is_previewer%' AND qual LIKE '%eatery_menu_items%' AND qual LIKE '%eatery_partners%')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'eatery_item_options' AND policyname = 'eatery_item_options_select_preview'
                  AND qual LIKE '%is_previewer()%' AND qual LIKE '%NOT p.is_active%' AND qual LIKE '%eatery_menu_items%' AND qual LIKE '%eatery_partners%') THEN
    RAISE EXCEPTION 'an eatery_item_options policy expression is not as designed';
  END IF;
  FOREACH t IN ARRAY ARRAY['eatery_partners','eatery_menu_items'] LOOP
    SELECT array_agg(policyname::text ORDER BY policyname) INTO v_names FROM pg_policies WHERE schemaname = 'public' AND tablename = t;
    IF v_names IS DISTINCT FROM ARRAY[t || '_select_active', t || '_select_preview'] THEN RAISE EXCEPTION 'parent % policy set changed: %', t, v_names; END IF;
  END LOOP;

  -- Grants: anon/authenticated SELECT only (table and column level), nothing for PUBLIC, service_role writes.
  IF NOT has_table_privilege('anon', 'public.eatery_item_options', 'SELECT') OR NOT has_table_privilege('authenticated', 'public.eatery_item_options', 'SELECT') THEN
    RAISE EXCEPTION 'CONTROL FAILED: anon / authenticated lost SELECT on eatery_item_options';
  END IF;
  FOREACH v_perm IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    IF has_table_privilege('anon', 'public.eatery_item_options', v_perm) OR has_table_privilege('authenticated', 'public.eatery_item_options', v_perm) THEN
      RAISE EXCEPTION 'anon or authenticated holds % on eatery_item_options', v_perm;
    END IF;
  END LOOP;
  IF has_any_column_privilege('anon', 'public.eatery_item_options', 'INSERT,UPDATE,REFERENCES')
     OR has_any_column_privilege('authenticated', 'public.eatery_item_options', 'INSERT,UPDATE,REFERENCES') THEN
    RAISE EXCEPTION 'anon or authenticated holds a column write privilege on eatery_item_options';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c, LATERAL aclexplode(c.relacl) a WHERE c.oid = 'public.eatery_item_options'::regclass AND a.grantee = 0) THEN
    RAISE EXCEPTION 'PUBLIC holds a privilege on eatery_item_options';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.eatery_item_options', 'SELECT,INSERT,UPDATE,DELETE')
     OR NOT has_table_privilege('postgres', 'public.eatery_item_options', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'CONTROL FAILED: service_role / postgres lost their privileges on eatery_item_options';
  END IF;

  -- Function bodies: the new shapes AND the 1125 / 1132 shapes that must survive.
  v_def := pg_get_functiondef('public.create_eatery_order(uuid,jsonb,text)'::regprocedure);
  IF v_def NOT LIKE '%JOIN public.eatery_item_options io%' OR v_def NOT LIKE '%io.item_id = m.id%' OR v_def NOT LIKE '%io.item_id = r.item_id%'
     OR v_def NOT LIKE '%io.is_available%' OR v_def NOT LIKE '%io.kind = ''remove'' OR io.price IS NOT NULL%'
     OR v_def NOT LIKE '%MESSAGE = ''option_unavailable''%' OR v_def NOT LIKE '%r.qty > io.max_qty%'
     OR v_def NOT LIKE '%JOIN public.eatery_menu_items m%' OR v_def NOT LIKE '%m.price IS NOT NULL%'
     OR v_def NOT LIKE '%v_test := public.is_previewer() OR public.is_order_tester(v_uid);%'
     OR v_def NOT LIKE '%WHERE partner_id = p_partner AND created_as_guest AND NOT is_test AND created_at > now()%'
     OR v_def NOT LIKE '%WHERE created_by = v_uid AND created_at > now() - interval ''1 hour'';%'
     OR v_def NOT LIKE '%client_id, created_as_guest, is_test)%' OR v_def NOT LIKE '%p_client_id, v_guest, v_test)%'
     OR v_def LIKE '%p_items -> %' THEN
    RAISE EXCEPTION 'create_eatery_order body is not as designed (options join / option_unavailable / max_qty / 1132 shapes / no client price read)';
  END IF;
  SELECT proargnames INTO v_names FROM pg_proc WHERE oid = 'public.create_eatery_order(uuid,jsonb,text)'::regprocedure;
  IF v_names IS DISTINCT FROM ARRAY['p_partner','p_items','p_client_id']::text[] THEN RAISE EXCEPTION 'create_eatery_order argument names are %', v_names; END IF;
  SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('create_eatery_order','verify_eatery_order');
  IF v_n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'expected exactly one create and one verify, found % functions', v_n; END IF;
  v_def := pg_get_functiondef('public.verify_eatery_order(text)'::regprocedure);
  IF v_def NOT LIKE '%''detail'', l -> ''detail''%' OR v_def NOT LIKE '%''is_test'',                v_o.is_test%'
     OR v_def LIKE '%''created_by''%' OR v_def LIKE '%''client_id''%' OR v_def LIKE '%option_id%' THEN
    RAISE EXCEPTION 'verify_eatery_order body: expected the detail key, still is_test, and no created_by / client_id / option id';
  END IF;
  IF obj_description('public.create_eatery_order(uuid,jsonb,text)'::regprocedure, 'pg_proc') NOT LIKE '%option_unavailable%'
     OR obj_description('public.create_eatery_order(uuid,jsonb,text)'::regprocedure, 'pg_proc') NOT LIKE '%NOT test orders%'
     OR obj_description('public.create_eatery_order(uuid,jsonb,text)'::regprocedure, 'pg_proc') NOT LIKE '%20261134.'
     OR obj_description('public.verify_eatery_order(text)'::regprocedure, 'pg_proc') NOT LIKE '%detail%'
     OR obj_description('public.verify_eatery_order(text)'::regprocedure, 'pg_proc') NOT LIKE '%20261134.' THEN
    RAISE EXCEPTION 'create / verify COMMENT is not the 20261134 text';
  END IF;

  FOR r IN SELECT p.proname, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS owner,
                  CASE p.proname WHEN 'create_eatery_order' THEN 'authenticated' ELSE 'anon,authenticated' END AS want_grantees,
                  COALESCE((SELECT string_agg(DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE g.rolname END, ',' ORDER BY CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE g.rolname END)
                     FROM aclexplode(p.proacl) a LEFT JOIN pg_roles g ON g.oid = a.grantee
                    WHERE a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner AND g.rolname IS DISTINCT FROM 'service_role'), '') AS grantees
             FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('create_eatery_order','verify_eatery_order') ORDER BY p.proname LOOP
    IF r.prosecdef IS DISTINCT FROM true OR r.owner IS DISTINCT FROM 'postgres' OR NOT COALESCE(r.proconfig @> ARRAY['search_path=public, pg_temp'], false)
       OR r.grantees IS DISTINCT FROM r.want_grantees THEN
      RAISE EXCEPTION '%: definer=% owner=% config=% EXECUTE grantees="%"', r.proname, r.prosecdef, r.owner, r.proconfig, r.grantees;
    END IF;
    RAISE NOTICE '% -> definer, owner %, config %, EXECUTE for "%"', r.proname, r.owner, r.proconfig, r.grantees;
  END LOOP;
END $$;

-- ─── Behaviour proof (throwaway partners and rows; a sentinel rolls everything back) ───
DO $$
DECLARE
  c_key constant text := 'zz-20261134-probe-key-not-a-secret';
  c_langs constant text[] := ARRAY['English','Turkish','Arabic','Russian','Greek','French','Spanish','German','Persian'];
  v_label jsonb := (SELECT jsonb_object_agg(k, 'zz ' || k) FROM unnest(ARRAY['English','Turkish','Arabic','Russian','Greek','French','Spanish','German','Persian']) k);
  v_ids jsonb := '{}'::jsonb;
  v_saved jsonb := '{}'::jsonb;
  s record; k record;
  v_sql text; v_res jsonb; v_state text; v_msg text; v_role text; v_claims text; v_hdr text; v_got text; v_report text := '';
  v_n int; v_keys text[]; v_s text; v_item bigint; v_uuid uuid;
  v_pre_orders int; v_pre_opts int; v_pre_partners int; v_pre_items int; v_pre_keys int;
BEGIN
  SELECT count(*) INTO v_pre_orders FROM public.eatery_orders;
  SELECT count(*) INTO v_pre_opts FROM public.eatery_item_options;
  SELECT count(*) INTO v_pre_partners FROM public.eatery_partners;
  SELECT count(*) INTO v_pre_items FROM public.eatery_menu_items;
  SELECT count(*) INTO v_pre_keys FROM private.preview_key_hashes;

  BEGIN
    INSERT INTO private.preview_key_hashes (hash, label) VALUES (encode(sha256(convert_to(c_key, 'UTF8')), 'hex'), 'zz probe 1134');
    INSERT INTO public.eatery_partners (slug, name, category, lat, lng, geocode_source, logo_path, menu_verified_on, is_active)
      VALUES ('zz-oa', 'zz opt live', 'cafe', 35.1, 33.3, 'partner', 'zz-oa/logo.png', current_date, true) RETURNING id INTO v_uuid;
    v_ids := v_ids || jsonb_build_object('pa', v_uuid);
    INSERT INTO public.eatery_partners (slug, name, category, is_active) VALUES ('zz-oi', 'zz opt not live', 'cafe', false) RETURNING id INTO v_uuid;
    v_ids := v_ids || jsonb_build_object('pi', v_uuid);
    INSERT INTO public.eatery_menu_items (partner_id, section, name, price, currency) VALUES ((v_ids ->> 'pa')::uuid, 'zz', 'zz dish one', 10.00, 'TRY') RETURNING id INTO v_item;
    v_ids := v_ids || jsonb_build_object('d1', v_item);
    INSERT INTO public.eatery_menu_items (partner_id, section, name, price, currency) VALUES ((v_ids ->> 'pa')::uuid, 'zz', 'zz dish two', 20.00, 'TRY') RETURNING id INTO v_item;
    v_ids := v_ids || jsonb_build_object('d2', v_item);
    INSERT INTO public.eatery_menu_items (partner_id, section, name, price, currency) VALUES ((v_ids ->> 'pi')::uuid, 'zz', 'zz dish inactive', 5.00, 'TRY') RETURNING id INTO v_item;
    v_ids := v_ids || jsonb_build_object('di', v_item);

    -- Options (as postgres). d1: r1 (sort 1), r2 (sort 2), r0 unavailable, e1 priced extra 5.00 max 3, eh hidden extra. d2: r3. di: oi.
    FOR k IN SELECT * FROM (VALUES
      ('r1', 'd1', 'remove', 'turşusuz',        NULL::numeric, 1, 1, true),
      ('r2', 'd1', 'remove', 'marulsuz',        NULL,          1, 2, true),
      ('r0', 'd1', 'remove', 'zz kapalı',       NULL,          1, 3, false),
      ('e1', 'd1', 'extra',  'burger peyniri',  5.00,          3, 1, true),
      ('eh', 'd1', 'extra',  'gizli sos',       NULL,          3, 2, true),
      ('r3', 'd2', 'remove', 'soğansız',        NULL,          1, 1, true),
      ('oi', 'di', 'remove', 'zz pasif',        NULL,          1, 1, true)) AS x(key, dish, kind, msg, price, maxq, so, avail) LOOP
      INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr, price, max_qty, sort_order, is_available)
        VALUES ((v_ids ->> k.dish)::bigint, k.kind, v_label, k.msg, k.price, k.maxq, k.so, k.avail) RETURNING id INTO v_item;
      v_ids := v_ids || jsonb_build_object(k.key, v_item);
    END LOOP;

    -- Steps: (label, who, hdr, typ, sql, want, save). typ c = create with this items JSON, q = raw SQL. {{x}} = id of x.
    -- who = anon | user:N | guest:N | pg | sr ; hdr = '' | 'key'. want = ok | err:<message> | state:<sqlstate> | val:<value>.
    FOR s IN SELECT * FROM (VALUES
      -- accepted baskets (each signed-in user stays below the 5-per-hour cap)
      ('plain basket, no opts',                'user:21', '', 'c', '[{"item_id":{{d1}},"qty":2},{"item_id":{{d2}},"qty":1}]', 'ok', 'plain'),
      ('two removals, sent out of order',      'user:22', '', 'c', '[{"item_id":{{d1}},"qty":1,"opts":[{"id":{{r2}},"qty":1},{"id":{{r1}},"qty":1}]}]', 'ok', 'rm'),
      ('removal + priced extra',               'user:23', '', 'c', '[{"item_id":{{d1}},"qty":1,"opts":[{"id":{{e1}},"qty":1},{"id":{{r1}},"qty":1}]}]', 'ok', 'rx'),
      ('extra x2 on a line of 2',              'user:24', '', 'c', '[{"item_id":{{d1}},"qty":2,"opts":[{"id":{{e1}},"qty":2}]}]', 'ok', 'x2'),
      ('client prices ignored everywhere',     'user:25', '', 'c', '[{"item_id":{{d1}},"qty":1,"unit_price":0.01,"price":0.01,"opts":[{"id":{{e1}},"qty":1,"price":0.01,"unit_price":0.01}]}]', 'ok', 'cp'),
      ('plain basket with client prices',     'user:29', '', 'c', '[{"item_id":{{d1}},"qty":1,"unit_price":0.01,"price":0.01}]', 'ok', 'cpp'),
      ('same dish, two different option sets', 'user:26', '', 'c', '[{"item_id":{{d1}},"qty":1,"opts":[{"id":{{r1}},"qty":1}]},{"item_id":{{d1}},"qty":1,"opts":[{"id":{{r2}},"qty":1}]}]', 'ok', 'two'),
      ('same dish plain and with an option',   'user:27', '', 'c', '[{"item_id":{{d1}},"qty":1},{"item_id":{{d1}},"qty":1,"opts":[{"id":{{r1}},"qty":1}]}]', 'ok', 'two2'),
      ('preview key: option on a non-live partner', 'user:28', 'key', 'c', '[{"item_id":{{di}},"qty":1,"opts":[{"id":{{oi}},"qty":1}]}]', 'ok', 'pv'),
      -- refusals (nothing is written)
      ('exact duplicate line (opts in another order)', 'user:30', '', 'c', '[{"item_id":{{d1}},"qty":1,"opts":[{"id":{{r1}},"qty":1},{"id":{{r2}},"qty":1}]},{"item_id":{{d1}},"qty":3,"opts":[{"id":{{r2}},"qty":1},{"id":{{r1}},"qty":1}]}]', 'err:invalid_items', NULL),
      ('same dish twice without opts',         'user:30', '', 'c', '[{"item_id":{{d1}},"qty":1},{"item_id":{{d1}},"qty":2}]', 'err:invalid_items', NULL),
      ('repeated option id in a line',         'user:30', '', 'c', '[{"item_id":{{d1}},"qty":1,"opts":[{"id":{{r1}},"qty":1},{"id":{{r1}},"qty":1}]}]', 'err:invalid_items', NULL),
      ('option qty 0',                         'user:30', '', 'c', '[{"item_id":{{d1}},"qty":1,"opts":[{"id":{{e1}},"qty":0}]}]', 'err:invalid_items', NULL),
      ('option qty -1',                        'user:30', '', 'c', '[{"item_id":{{d1}},"qty":1,"opts":[{"id":{{e1}},"qty":-1}]}]', 'err:invalid_items', NULL),
      ('option qty 11',                        'user:30', '', 'c', '[{"item_id":{{d1}},"qty":1,"opts":[{"id":{{e1}},"qty":11}]}]', 'err:invalid_items', NULL),
      ('removal with qty 2',                   'user:30', '', 'c', '[{"item_id":{{d1}},"qty":1,"opts":[{"id":{{r1}},"qty":2}]}]', 'err:invalid_items', NULL),
      ('extra qty 4 above max_qty 3',          'user:30', '', 'c', '[{"item_id":{{d1}},"qty":1,"opts":[{"id":{{e1}},"qty":4}]}]', 'err:invalid_items', NULL),
      ('empty opts array',                     'user:30', '', 'c', '[{"item_id":{{d1}},"qty":1,"opts":[]}]', 'err:invalid_items', NULL),
      ('opts is a string',                     'user:30', '', 'c', '[{"item_id":{{d1}},"qty":1,"opts":"x"}]', 'err:invalid_items', NULL),
      ('opts is null',                         'user:30', '', 'c', '[{"item_id":{{d1}},"qty":1,"opts":null}]', 'err:invalid_items', NULL),
      ('option id is a string',                'user:30', '', 'c', '[{"item_id":{{d1}},"qty":1,"opts":[{"id":"5","qty":1}]}]', 'err:invalid_items', NULL),
      ('option without qty',                   'user:30', '', 'c', '[{"item_id":{{d1}},"qty":1,"opts":[{"id":{{r1}}}]}]', 'err:invalid_items', NULL),
      ('21 options in a line',                 'user:30', '', 'c', '[{"item_id":{{d1}},"qty":1,"opts":[{"id":1,"qty":1},{"id":2,"qty":1},{"id":3,"qty":1},{"id":4,"qty":1},{"id":5,"qty":1},{"id":6,"qty":1},{"id":7,"qty":1},{"id":8,"qty":1},{"id":9,"qty":1},{"id":10,"qty":1},{"id":11,"qty":1},{"id":12,"qty":1},{"id":13,"qty":1},{"id":14,"qty":1},{"id":15,"qty":1},{"id":16,"qty":1},{"id":17,"qty":1},{"id":18,"qty":1},{"id":19,"qty":1},{"id":20,"qty":1},{"id":21,"qty":1}]}]', 'err:invalid_items', NULL),
      ('option of ANOTHER dish',               'user:30', '', 'c', '[{"item_id":{{d1}},"qty":1,"opts":[{"id":{{r3}},"qty":1}]}]', 'err:option_unavailable', NULL),
      ('option of a dish of a non-live partner on a live dish', 'user:30', '', 'c', '[{"item_id":{{d1}},"qty":1,"opts":[{"id":{{oi}},"qty":1}]}]', 'err:option_unavailable', NULL),
      ('HIDDEN extra (price NULL)',            'user:30', '', 'c', '[{"item_id":{{d1}},"qty":1,"opts":[{"id":{{eh}},"qty":1}]}]', 'err:option_unavailable', NULL),
      ('unavailable removal',                  'user:30', '', 'c', '[{"item_id":{{d1}},"qty":1,"opts":[{"id":{{r0}},"qty":1}]}]', 'err:option_unavailable', NULL),
      ('option id that does not exist',        'user:30', '', 'c', '[{"item_id":{{d1}},"qty":1,"opts":[{"id":999999999,"qty":1}]}]', 'err:option_unavailable', NULL),
      ('one good + one hidden option',         'user:30', '', 'c', '[{"item_id":{{d1}},"qty":1,"opts":[{"id":{{r1}},"qty":1},{"id":{{eh}},"qty":1}]}]', 'err:option_unavailable', NULL),
      ('item of a non-live partner on a live partner', 'user:30', '', 'c', '[{"item_id":{{di}},"qty":1}]', 'err:item_unavailable', NULL),
      -- verify
      ('verify: line with options',            'anon',    '', 'q', $q$SELECT public.verify_eatery_order('{{code:rx}}')$q$, 'ok', 'vrx'),
      ('verify: plain line',                   'anon',    '', 'q', $q$SELECT public.verify_eatery_order('{{code:plain}}')$q$, 'ok', 'vpl'),
      -- who can read the options table
      ('anon reads options of the live partner',      'anon',    '',    'q', 'SELECT to_jsonb(count(*)) FROM public.eatery_item_options WHERE item_id IN ({{d1}},{{d2}})', 'val:6', NULL),
      ('guest reads options of the live partner',     'guest:41','',    'q', 'SELECT to_jsonb(count(*)) FROM public.eatery_item_options WHERE item_id IN ({{d1}},{{d2}})', 'val:6', NULL),
      ('signed-in reads options of the live partner', 'user:42', '',    'q', 'SELECT to_jsonb(count(*)) FROM public.eatery_item_options WHERE item_id IN ({{d1}},{{d2}})', 'val:6', NULL),
      ('anon sees NO option of the non-live partner', 'anon',    '',    'q', 'SELECT to_jsonb(count(*)) FROM public.eatery_item_options WHERE item_id = {{di}}', 'val:0', NULL),
      ('guest sees NO option of the non-live partner','guest:41','',    'q', 'SELECT to_jsonb(count(*)) FROM public.eatery_item_options WHERE item_id = {{di}}', 'val:0', NULL),
      ('signed-in sees NO option of the non-live partner', 'user:42','','q', 'SELECT to_jsonb(count(*)) FROM public.eatery_item_options WHERE item_id = {{di}}', 'val:0', NULL),
      ('CONTROL anon + Preview key sees the non-live partner''s option', 'anon', 'key', 'q', 'SELECT to_jsonb(count(*)) FROM public.eatery_item_options WHERE item_id = {{di}}', 'val:1', NULL),
      ('CONTROL signed-in + Preview key sees it too',  'user:42','key', 'q', 'SELECT to_jsonb(count(*)) FROM public.eatery_item_options WHERE item_id = {{di}}', 'val:1', NULL),
      ('CONTROL Preview key still sees the live options', 'anon', 'key','q', 'SELECT to_jsonb(count(*)) FROM public.eatery_item_options WHERE item_id IN ({{d1}},{{d2}})', 'val:6', NULL),
      ('CONTROL postgres counts every option',        'pg',      '',    'q', 'SELECT to_jsonb(count(*)) FROM public.eatery_item_options WHERE item_id IN ({{d1}},{{d2}},{{di}})', 'val:7', NULL),
      -- who can NOT write it (each beside a control that the write works for the allowed roles)
      ('authenticated INSERT refused',         'user:42', '', 'q', $q$INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr) VALUES ({{d1}}, 'remove', '{}', 'zz x') RETURNING to_jsonb(id)$q$, 'state:42501', NULL),
      ('guest INSERT refused',                 'guest:41','', 'q', $q$INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr) VALUES ({{d1}}, 'remove', '{}', 'zz x') RETURNING to_jsonb(id)$q$, 'state:42501', NULL),
      ('anon INSERT refused',                  'anon',    '', 'q', $q$INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr) VALUES ({{d1}}, 'remove', '{}', 'zz x') RETURNING to_jsonb(id)$q$, 'state:42501', NULL),
      ('authenticated UPDATE refused',         'user:42', '', 'q', 'UPDATE public.eatery_item_options SET price = 0.01 WHERE id = {{e1}} RETURNING to_jsonb(id)', 'state:42501', NULL),
      ('authenticated DELETE refused',         'user:42', '', 'q', 'DELETE FROM public.eatery_item_options WHERE id = {{r1}} RETURNING to_jsonb(id)', 'state:42501', NULL),
      ('anon DELETE refused',                  'anon',    '', 'q', 'DELETE FROM public.eatery_item_options WHERE id = {{r1}} RETURNING to_jsonb(id)', 'state:42501', NULL),
      ('anon calls the label helper',          'anon',    '', 'q', $q$SELECT to_jsonb(public.eatery_option_label_valid('{}'))$q$, 'state:42501', NULL),
      ('CONTROL service_role INSERT works',    'sr',      '', 'q', $q$INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr) VALUES ({{d2}}, 'remove', (SELECT label_i18n FROM public.eatery_item_options WHERE id = {{r1}}), 'zz sr') RETURNING to_jsonb(id)$q$, 'ok', 'srins'),
      ('CONTROL service_role UPDATE works',    'sr',      '', 'q', 'UPDATE public.eatery_item_options SET sort_order = 9 WHERE id = {{r3}} RETURNING to_jsonb(id)', 'ok', NULL),
      ('CONTROL service_role DELETE works',    'sr',      '', 'q', 'DELETE FROM public.eatery_item_options WHERE message_tr = ''zz sr'' RETURNING to_jsonb(id)', 'ok', NULL)
    ) AS x(label, who, hdr, typ, sql, want, save) LOOP
      v_sql := CASE WHEN s.typ = 'c' THEN 'SELECT public.create_eatery_order(' || quote_literal(v_ids ->> 'pa') || ', ' || quote_literal(s.sql) || '::jsonb)' ELSE s.sql END;
      FOR k IN SELECT key, value FROM jsonb_each_text(v_ids) LOOP
        v_sql := replace(v_sql, '{{' || k.key || '}}', k.value);
      END LOOP;
      FOR k IN SELECT key, value #>> '{code}' AS code FROM jsonb_each(v_saved) WHERE jsonb_typeof(value) = 'object' LOOP
        v_sql := replace(v_sql, '{{code:' || k.key || '}}', COALESCE(k.code, 'MISSING0'));
      END LOOP;
      IF s.label LIKE 'preview key: option%' THEN
        v_sql := replace(v_sql, quote_literal(v_ids ->> 'pa'), quote_literal(v_ids ->> 'pi'));
      END IF;
      v_role := CASE WHEN s.who = 'anon' THEN 'anon' WHEN s.who = 'pg' THEN NULL WHEN s.who = 'sr' THEN 'service_role' ELSE 'authenticated' END;
      v_claims := CASE
        WHEN s.who IN ('anon', 'pg') THEN ''
        WHEN s.who = 'sr' THEN json_build_object('role', 'service_role')::text
        WHEN s.who LIKE 'guest:%' THEN json_build_object('sub', '00000000-0000-4000-8000-' || lpad(split_part(s.who, ':', 2), 12, '0'), 'role', 'authenticated', 'is_anonymous', true)::text
        ELSE json_build_object('sub', '00000000-0000-4000-8000-' || lpad(split_part(s.who, ':', 2), 12, '0'), 'role', 'authenticated')::text END;
      v_hdr := CASE s.hdr WHEN 'key' THEN json_build_object('x-ada-preview-key', c_key)::text ELSE '' END;
      v_res := NULL; v_state := NULL; v_msg := NULL;
      BEGIN
        IF v_role IS NOT NULL THEN EXECUTE format('SET LOCAL ROLE %I', v_role); END IF;
        PERFORM set_config('request.jwt.claims', v_claims, true);
        PERFORM set_config('request.headers', v_hdr, true);
        EXECUTE v_sql INTO v_res;
      EXCEPTION WHEN OTHERS THEN
        v_state := SQLSTATE; v_msg := SQLERRM;
      END;
      RESET ROLE;
      PERFORM set_config('request.jwt.claims', '', true);
      PERFORM set_config('request.headers', '', true);

      v_got := CASE WHEN v_state IS NULL THEN 'ok ' || COALESCE(left(v_res::text, 40), '') ELSE 'err:' || v_msg || ' [' || v_state || ']' END;
      IF s.want = 'ok' THEN
        IF v_state IS NOT NULL THEN RAISE EXCEPTION 'STEP "%" (as %): expected ok, got % (sql %)', s.label, s.who, v_got, left(v_sql, 200); END IF;
      ELSIF s.want LIKE 'err:%' THEN
        IF v_state IS DISTINCT FROM 'P0001' OR v_msg IS DISTINCT FROM substr(s.want, 5) THEN
          RAISE EXCEPTION 'STEP "%" (as %): expected P0001 "%", got %', s.label, s.who, substr(s.want, 5), v_got;
        END IF;
      ELSIF s.want LIKE 'state:%' THEN
        IF v_state IS DISTINCT FROM substr(s.want, 7) THEN RAISE EXCEPTION 'STEP "%" (as %): expected SQLSTATE %, got %', s.label, s.who, substr(s.want, 7), v_got; END IF;
      ELSIF s.want LIKE 'val:%' THEN
        IF v_state IS NOT NULL OR (v_res #>> '{}') IS DISTINCT FROM substr(s.want, 5) THEN
          RAISE EXCEPTION 'STEP "%" (as %): expected value %, got % %', s.label, s.who, substr(s.want, 5), v_got, v_res;
        END IF;
      END IF;
      IF s.save IS NOT NULL THEN v_saved := v_saved || jsonb_build_object(s.save, v_res); END IF;
      v_report := v_report || format(E'\n  %-58s %-9s -> %s', s.label, s.who, v_got);
    END LOOP;

    -- ── What the accepted baskets stored and returned ──
    SELECT array_agg(key ORDER BY key) INTO v_keys FROM jsonb_object_keys(v_saved -> 'plain' -> 'lines' -> 0) key;
    IF v_keys IS DISTINCT FROM ARRAY['item_id','name','qty','unit_price'] THEN RAISE EXCEPTION 'a plain line must be exactly {item_id,name,qty,unit_price}, got %', v_keys; END IF;
    IF (v_saved -> 'plain' ->> 'total')::numeric IS DISTINCT FROM 40.00 THEN RAISE EXCEPTION 'plain total is %', v_saved -> 'plain' -> 'total'; END IF;
    SELECT array_agg(key ORDER BY key) INTO v_keys FROM jsonb_object_keys(v_saved -> 'rm' -> 'lines' -> 0) key;
    IF v_keys IS DISTINCT FROM ARRAY['base_price','detail','item_id','name','options','qty','unit_price'] THEN RAISE EXCEPTION 'an option line has keys %', v_keys; END IF;
    SELECT array_agg(key ORDER BY key) INTO v_keys FROM jsonb_object_keys(v_saved -> 'rm' -> 'lines' -> 0 -> 'options' -> 0) key;
    IF v_keys IS DISTINCT FROM ARRAY['kind','name','option_id','price','qty'] THEN RAISE EXCEPTION 'an options[] element has keys %', v_keys; END IF;
    IF v_saved -> 'rm' -> 'lines' -> 0 ->> 'detail' IS DISTINCT FROM 'turşusuz, marulsuz'
       OR (v_saved -> 'rm' ->> 'total')::numeric IS DISTINCT FROM 10.00 OR (v_saved -> 'rm' -> 'lines' -> 0 ->> 'unit_price')::numeric IS DISTINCT FROM 10.00
       OR (v_saved -> 'rm' -> 'lines' -> 0 ->> 'base_price')::numeric IS DISTINCT FROM 10.00
       OR (v_saved -> 'rm' -> 'lines' -> 0 -> 'options' -> 0 ->> 'name') IS DISTINCT FROM 'turşusuz'
       OR jsonb_typeof(v_saved -> 'rm' -> 'lines' -> 0 -> 'options' -> 0 -> 'price') IS DISTINCT FROM 'null' THEN
      RAISE EXCEPTION 'removals line wrong: %', v_saved -> 'rm';
    END IF;
    IF v_saved -> 'rx' -> 'lines' -> 0 ->> 'detail' IS DISTINCT FROM 'turşusuz, +ekstra burger peyniri'
       OR (v_saved -> 'rx' -> 'lines' -> 0 ->> 'unit_price')::numeric IS DISTINCT FROM 15.00 OR (v_saved -> 'rx' ->> 'total')::numeric IS DISTINCT FROM 15.00
       OR (v_saved -> 'rx' -> 'lines' -> 0 -> 'options' -> 0 ->> 'kind') IS DISTINCT FROM 'remove' THEN
      RAISE EXCEPTION 'removal + extra line wrong: %', v_saved -> 'rx';
    END IF;
    IF v_saved -> 'x2' -> 'lines' -> 0 ->> 'detail' IS DISTINCT FROM '+2 ekstra burger peyniri'
       OR (v_saved -> 'x2' -> 'lines' -> 0 ->> 'unit_price')::numeric IS DISTINCT FROM 20.00 OR (v_saved -> 'x2' ->> 'total')::numeric IS DISTINCT FROM 40.00 THEN
      RAISE EXCEPTION 'extra x2 line wrong: %', v_saved -> 'x2';
    END IF;
    IF (v_saved -> 'cp' -> 'lines' -> 0 ->> 'unit_price')::numeric IS DISTINCT FROM 15.00 OR (v_saved -> 'cp' ->> 'total')::numeric IS DISTINCT FROM 15.00
       OR (v_saved -> 'cp' -> 'lines' -> 0 -> 'options' -> 0 ->> 'price')::numeric IS DISTINCT FROM 5.00 THEN
      RAISE EXCEPTION 'client-sent prices were read: %', v_saved -> 'cp';
    END IF;
    IF (v_saved -> 'cpp' -> 'lines' -> 0 ->> 'unit_price')::numeric IS DISTINCT FROM 10.00 OR (v_saved -> 'cpp' ->> 'total')::numeric IS DISTINCT FROM 10.00 THEN
      RAISE EXCEPTION 'client prices were read in a plain line: %', v_saved -> 'cpp';
    END IF;
    IF jsonb_array_length(v_saved -> 'two' -> 'lines') IS DISTINCT FROM 2 OR (v_saved -> 'two' ->> 'total')::numeric IS DISTINCT FROM 20.00
       OR v_saved -> 'two' -> 'lines' -> 0 ->> 'detail' IS DISTINCT FROM 'turşusuz' OR v_saved -> 'two' -> 'lines' -> 1 ->> 'detail' IS DISTINCT FROM 'marulsuz' THEN
      RAISE EXCEPTION 'same dish with two option sets wrong: %', v_saved -> 'two';
    END IF;
    IF jsonb_array_length(v_saved -> 'two2' -> 'lines') IS DISTINCT FROM 2 OR (v_saved -> 'two2' -> 'lines' -> 0 ? 'detail') OR NOT (v_saved -> 'two2' -> 'lines' -> 1 ? 'detail') THEN
      RAISE EXCEPTION 'plain + option line of the same dish wrong: %', v_saved -> 'two2';
    END IF;
    -- Stored = returned, read as postgres (the role that may read the table).
    FOR k IN SELECT key FROM jsonb_each(v_saved) WHERE jsonb_typeof(value) = 'object' AND value ? 'code' LOOP
      SELECT count(*) INTO v_n FROM public.eatery_orders o WHERE o.code = v_saved -> k.key ->> 'code' AND o.lines = v_saved -> k.key -> 'lines'
         AND o.total = (v_saved -> k.key ->> 'total')::numeric;
      IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'order % is not stored as returned', k.key; END IF;
    END LOOP;
    SELECT count(*) INTO v_n FROM public.eatery_orders WHERE code IN (SELECT value ->> 'code' FROM jsonb_each(v_saved) WHERE jsonb_typeof(value) = 'object' AND value ? 'code');
    IF v_n IS DISTINCT FROM 9 THEN RAISE EXCEPTION 'expected 9 stored orders from the accepted steps, found %', v_n; END IF;
    SELECT count(*) INTO v_n FROM public.eatery_orders WHERE created_by = '00000000-0000-4000-8000-000000000030';
    IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'refused baskets wrote % row(s)', v_n; END IF;

    -- verify: detail per line, null for a plain line, no ids.
    IF v_saved -> 'vrx' -> 'lines' -> 0 -> 'detail' IS DISTINCT FROM to_jsonb('turşusuz, +ekstra burger peyniri'::text)
       OR v_saved -> 'vpl' -> 'lines' -> 0 -> 'detail' IS DISTINCT FROM 'null'::jsonb OR v_saved -> 'vpl' -> 'lines' -> 1 -> 'detail' IS DISTINCT FROM 'null'::jsonb THEN
      RAISE EXCEPTION 'verify detail wrong: % / %', v_saved -> 'vrx' -> 'lines', v_saved -> 'vpl' -> 'lines';
    END IF;
    SELECT array_agg(key ORDER BY key) INTO v_keys FROM jsonb_object_keys(v_saved -> 'vrx' -> 'lines' -> 0) key;
    IF v_keys IS DISTINCT FROM ARRAY['detail','name','qty','unit_price'] THEN RAISE EXCEPTION 'verify line keys are %', v_keys; END IF;

    -- ── CHECK / UNIQUE / FK mutants, as postgres, each beside a valid row ──
    FOR s IN SELECT * FROM (VALUES
      ('CONTROL valid remove',                          $q$INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr) VALUES ({{d2}}, 'remove', {{L}}, 'zz ok remove')$q$, 'ok'),
      ('CONTROL valid priced extra, max_qty 10',        $q$INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr, price, max_qty) VALUES ({{d2}}, 'extra', {{L}}, 'zz ok extra', 12.50, 10)$q$, 'ok'),
      ('CONTROL valid hidden extra',                    $q$INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr) VALUES ({{d2}}, 'extra', {{L}}, 'zz ok hidden')$q$, 'ok'),
      ('CONTROL label value of exactly 60 chars',       $q$INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr) VALUES ({{d2}}, 'remove', {{L}} || jsonb_build_object('Persian', repeat('ش', 60)), 'zz ok 60')$q$, 'ok'),
      ('8 keys (Persian missing)',                      $q$INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr) VALUES ({{d2}}, 'remove', {{L}} - 'Persian', 'zz m1')$q$, '23514'),
      ('a tenth key',                                   $q$INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr) VALUES ({{d2}}, 'remove', {{L}} || '{"Italian":"x"}', 'zz m2')$q$, '23514'),
      ('a ''tr'' key beside the nine',                  $q$INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr) VALUES ({{d2}}, 'remove', {{L}} || '{"tr":"x"}', 'zz m3')$q$, '23514'),
      ('''tr'' instead of Turkish (nine keys, one ISO)', $q$INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr) VALUES ({{d2}}, 'remove', ({{L}} - 'Turkish') || '{"tr":"x"}', 'zz m4')$q$, '23514'),
      ('a blank label value',                           $q$INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr) VALUES ({{d2}}, 'remove', {{L}} || '{"Greek":"  "}', 'zz m5')$q$, '23514'),
      ('a 61-char label value',                         $q$INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr) VALUES ({{d2}}, 'remove', {{L}} || jsonb_build_object('Arabic', repeat('ع', 61)), 'zz m6')$q$, '23514'),
      ('a numeric label value',                         $q$INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr) VALUES ({{d2}}, 'remove', {{L}} || '{"German":5}', 'zz m7')$q$, '23514'),
      ('label is an array',                             $q$INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr) VALUES ({{d2}}, 'remove', '["a"]', 'zz m8')$q$, '23514'),
      ('remove with a price',                           $q$INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr, price) VALUES ({{d2}}, 'remove', {{L}}, 'zz m9', 1.00)$q$, '23514'),
      ('remove with max_qty 2',                         $q$INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr, max_qty) VALUES ({{d2}}, 'remove', {{L}}, 'zz m10', 2)$q$, '23514'),
      ('extra with price 0',                            $q$INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr, price) VALUES ({{d2}}, 'extra', {{L}}, 'zz m11', 0)$q$, '23514'),
      ('extra with a negative price',                   $q$INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr, price) VALUES ({{d2}}, 'extra', {{L}}, 'zz m12', -1)$q$, '23514'),
      ('extra with max_qty 0',                          $q$INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr, max_qty) VALUES ({{d2}}, 'extra', {{L}}, 'zz m13', 0)$q$, '23514'),
      ('extra with max_qty 11',                         $q$INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr, max_qty) VALUES ({{d2}}, 'extra', {{L}}, 'zz m14', 11)$q$, '23514'),
      ('kind ''sauce''',                                $q$INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr) VALUES ({{d2}}, 'sauce', {{L}}, 'zz m15')$q$, '23514'),
      ('empty message_tr',                              $q$INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr) VALUES ({{d2}}, 'remove', {{L}}, '')$q$, '23514'),
      ('message_tr with trailing space',                $q$INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr) VALUES ({{d2}}, 'remove', {{L}}, 'zz m16 ')$q$, '23514'),
      ('61-char message_tr',                            $q$INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr) VALUES ({{d2}}, 'remove', {{L}}, repeat('a', 61))$q$, '23514'),
      ('NULL label',                                    $q$INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr) VALUES ({{d2}}, 'remove', NULL, 'zz m17')$q$, '23502'),
      ('same (item, kind, message_tr) twice',           $q$INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr) VALUES ({{d2}}, 'remove', {{L}}, 'zz ok remove')$q$, '23505'),
      ('item that does not exist',                      $q$INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr) VALUES (999999999, 'remove', {{L}}, 'zz m18')$q$, '23503')
    ) AS x(label, sql, want) LOOP
      v_sql := replace(replace(s.sql, '{{L}}', quote_literal(v_label::text) || '::jsonb'), '{{d2}}', v_ids ->> 'd2');
      v_state := NULL;
      BEGIN
        EXECUTE v_sql;
      EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
      END;
      IF s.want = 'ok' THEN
        IF v_state IS NOT NULL THEN RAISE EXCEPTION 'MUTANT STEP "%": the valid row was refused (%)', s.label, v_state; END IF;
      ELSIF v_state IS DISTINCT FROM s.want THEN
        RAISE EXCEPTION 'MUTANT STEP "%": expected SQLSTATE %, got %', s.label, s.want, v_state;
      END IF;
      v_report := v_report || format(E'\n  %-58s %-9s -> %s', s.label, 'postgres', COALESCE(v_state, 'inserted'));
    END LOOP;

    -- FK: deleting a dish removes its options.
    INSERT INTO public.eatery_menu_items (partner_id, section, name, price, currency) VALUES ((v_ids ->> 'pa')::uuid, 'zz', 'zz cascade', 1.00, 'TRY') RETURNING id INTO v_item;
    INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr) VALUES (v_item, 'remove', v_label, 'zz cascade');
    DELETE FROM public.eatery_menu_items WHERE id = v_item;
    SELECT count(*) INTO v_n FROM public.eatery_item_options WHERE item_id = v_item;
    IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'deleting a dish left % option row(s)', v_n; END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'zz-sentinel';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'zz-sentinel' THEN RAISE; END IF;
  END;
  RESET ROLE;

  -- Nothing survived the sentinel.
  IF (SELECT count(*) FROM public.eatery_orders) IS DISTINCT FROM v_pre_orders
     OR (SELECT count(*) FROM public.eatery_item_options) IS DISTINCT FROM v_pre_opts
     OR (SELECT count(*) FROM public.eatery_partners) IS DISTINCT FROM v_pre_partners
     OR (SELECT count(*) FROM public.eatery_menu_items) IS DISTINCT FROM v_pre_items
     OR (SELECT count(*) FROM private.preview_key_hashes) IS DISTINCT FROM v_pre_keys
     OR EXISTS (SELECT 1 FROM public.eatery_partners WHERE slug LIKE 'zz-o%') THEN
    RAISE EXCEPTION 'probe rows survived the sentinel';
  END IF;
  RAISE NOTICE 'option probes (all as stated); nothing survived:%', v_report;
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
VALUES ('20261134_eatery_item_options.sql', '8226c18426ddb1269b09f191635c7db1a1b6aeff42a53d953da4e7b76e99904f')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: every 20261134_eatery_item_options row must read OK.
--
-- ─── Rollback (only if abandoned; no option row exists yet) ─────────────────
--   re-run the create/verify bodies of 20261132_eatery_orders_is_test.sql (CREATE OR REPLACE);
--   DROP TABLE IF EXISTS public.eatery_item_options;
--   DROP FUNCTION IF EXISTS public.eatery_option_label_valid(jsonb);
