-- ═══════════════════════════════════════════════════════════════════════════
-- 20261144 — Yeme-İçme: eatery_partners.order_method ('whatsapp' | 'phone') + create_eatery_order refuses phone partners
-- ═══════════════════════════════════════════════════════════════════════════
--
-- SCHEMA + RPC ONLY. No partner row is created here (a separate data migration seeds the second partner).
--
-- (1) eatery_partners.order_method text NOT NULL, named CHECK eatery_partners_order_method_check
--     (order_method IN ('whatsapp','phone')), NO DEFAULT: every future partner seed must state its method.
--       whatsapp  the in-app basket that sends a WhatsApp order; the server records it via create_eatery_order.
--       phone     call to order: no basket in the app, and create_eatery_order refuses it.
--     Backfill: crunchy-express (the only partner today) gets 'whatsapp'. The column is added NULLABLE, backfilled,
--     asserted to have zero NULL rows (the count and slugs are printed), and only then set NOT NULL.
--
-- (2) public.create_eatery_order(uuid, jsonb, text): the 20261134 body carried forward VERBATIM, plus exactly two edits:
--       • p.order_method joins the SELECT ... INTO v_partner list;
--       • right after the partner_unavailable check, BEFORE the adult_only / order_requires_account checks, an
--         unconditional refusal: order_method IS DISTINCT FROM 'whatsapp' -> P0001 'order_not_supported'.
--     The ADA Preview key does NOT bypass it (a phone partner can never gain an order row, even while previewed).
--     Same signature, SECURITY DEFINER, search_path, owner and grants as live (asserted below, derived from the
--     catalogs). Only the function COMMENT is rewritten: the error list gains order_not_supported.
--
-- verify_eatery_order is UNTOUCHED. Proof inside this file: its pg_get_functiondef md5 is captured in the pre-state and
-- compared to the post-state.
--
-- ─── WHO CAN READ / WRITE ───────────────────────────────────────────────────
--   NO policy, grant or RLS change. Nothing is created that a client can reach.
--   • READ order_method: whoever can already read the partner row. The eatery_partners SELECT grant is TABLE-level
--     (anon + authenticated, guests included), so it covers the new column; rows are visible exactly as before:
--     anyone sees a partner while it is active (eatery_partners_select_active), and the ADA Preview app's key also
--     sees an inactive one (eatery_partners_select_preview). Asserted below: still exactly those 2 policies.
--   • WRITE order_method: service_role only (migrations / admin SQL / Edge Functions). anon and authenticated
--     (guests included) hold no INSERT/UPDATE/DELETE on the table nor on any column (asserted).
--   • create_eatery_order keeps its callers: authenticated only (guests included), NOT anon. What changes is the
--     answer for a phone partner: nobody, previewer included, can place an order against it; the RPC raises
--     order_not_supported before it reads a basket and writes nothing.
--   • order_method describes a restaurant, never a person: no personal data.
--
-- PROOF (inside this file): pre-state (20261134 body shapes, column absent or exactly this, partner set printed and
-- exactly {crunchy-express} on a first apply; a re-apply only requires zero NULL rows, so it stays safe after a second
-- partner is seeded); the column (text, NOT NULL, no DEFAULT), the CHECK set (derived) and its rejections; the full
-- eatery_partners policy set and grants unchanged; the function body (new shapes + the 1125 / 1132 / 1134 shapes that
-- must survive; the refusal block carries no previewer clause), grants / owner / DEFINER / search_path (derived), and
-- verify_eatery_order byte-identical; and, in a rolled-back sentinel, behaviour probes with positive controls: a phone
-- partner is refused (active, inactive + Preview key, active + Preview key, adult_only + guest), a whatsapp partner
-- still orders (plain, and inactive + Preview key), the older refusals keep their order, the CHECK / NOT NULL / no
-- DEFAULT reject, and anon / authenticated cannot write the column while service_role can.
--
-- Apply: gh workflow run supabase-migrate -f file=20261144_eatery_order_method.sql (dry), then -f apply=true
-- (Berke approves production-db). The workflow refuses a feature-branch ref, so the dry run works only after this
-- file is merged to main. ADDs a column => ends with NOTIFY pgrst (after COMMIT and RESET ROLE).
-- Re-runnable: a second apply accepts the already-changed column, CHECK and body.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── Pre-state (abort before changing anything) ─────────────────────────────
DO $$
DECLARE
  v_def text; v_cols int; v_slugs text[]; v_n int; v_names text[]; v_done boolean; v_has_ref boolean;
  v_nullable text; v_dflt text; v_chk int; v_vdef text;
BEGIN
  IF to_regclass('public.schema_migrations_applied') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.schema_migrations_applied WHERE filename = '20261134_eatery_item_options.sql') THEN
    RAISE EXCEPTION 'pre-state: 20261134_eatery_item_options.sql is not in the ledger';
  END IF;
  IF to_regclass('public.eatery_partners') IS NULL OR to_regclass('public.eatery_item_options') IS NULL
     OR to_regprocedure('public.create_eatery_order(uuid,jsonb,text)') IS NULL OR to_regprocedure('public.verify_eatery_order(text)') IS NULL
     OR to_regprocedure('public.is_previewer()') IS NULL OR to_regprocedure('public.is_order_tester(uuid)') IS NULL THEN
    RAISE EXCEPTION 'pre-state: eatery_partners / eatery_item_options / order functions / is_previewer() / is_order_tester() missing';
  END IF;
  v_done := EXISTS (SELECT 1 FROM public.schema_migrations_applied WHERE filename = '20261144_eatery_order_method.sql');

  -- Column: absent, or already exactly this (text NOT NULL, no DEFAULT, the named CHECK).
  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'eatery_partners' AND column_name = 'order_method';
  IF v_cols NOT IN (0, 1) THEN RAISE EXCEPTION 'pre-state: % order_method columns', v_cols; END IF;
  IF v_cols = 1 THEN
    SELECT is_nullable, column_default INTO v_nullable, v_dflt FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'eatery_partners' AND column_name = 'order_method'
       AND data_type = 'text';
    SELECT count(*) INTO v_chk FROM pg_constraint
     WHERE conrelid = 'public.eatery_partners'::regclass AND conname = 'eatery_partners_order_method_check';
    IF v_nullable IS DISTINCT FROM 'NO' OR v_dflt IS NOT NULL OR v_chk IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'pre-state: order_method exists but is not text NOT NULL with no default and the named CHECK (nullable=%, default=%, checks=%)',
        v_nullable, v_dflt, v_chk;
    END IF;
  ELSIF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.eatery_partners'::regclass AND conname = 'eatery_partners_order_method_check') THEN
    RAISE EXCEPTION 'pre-state: the CHECK exists without the column';
  END IF;

  -- Partner set: derived and printed. First apply: exactly {crunchy-express}. Re-apply: only that crunchy-express is there
  -- (a second partner may have been seeded since; the NOT NULL column already guarantees its method).
  SELECT array_agg(slug ORDER BY slug) INTO v_slugs FROM public.eatery_partners;
  v_n := COALESCE(array_length(v_slugs, 1), 0);
  IF v_cols = 0 THEN
    IF v_slugs IS DISTINCT FROM ARRAY['crunchy-express']::text[] THEN
      RAISE EXCEPTION 'pre-state: eatery_partners holds % row(s) %, expected exactly {crunchy-express}. Nothing applied.', v_n, v_slugs;
    END IF;
  ELSIF NOT ('crunchy-express' = ANY (COALESCE(v_slugs, ARRAY[]::text[]))) THEN
    RAISE EXCEPTION 'pre-state (re-apply): crunchy-express is missing from %', v_slugs;
  END IF;

  -- The live function body must be the 20261134 shape (so this file never overwrites a body it did not carry forward),
  -- or already this file's.
  v_def := pg_get_functiondef(to_regprocedure('public.create_eatery_order(uuid,jsonb,text)'));
  v_has_ref := position('MESSAGE = ''order_not_supported''' IN v_def) > 0;
  IF position('JOIN public.eatery_item_options io' IN v_def) = 0
     OR position('MESSAGE = ''option_unavailable''' IN v_def) = 0
     OR position('v_test := public.is_previewer() OR public.is_order_tester(v_uid);' IN v_def) = 0
     OR position('created_as_guest AND NOT is_test AND created_at > now()' IN v_def) = 0
     OR position('client_id, created_as_guest, is_test)' IN v_def) = 0
     OR position('p_client_id, v_guest, v_test)' IN v_def) = 0
     OR position('MESSAGE = ''partner_unavailable''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'pre-state: create_eatery_order is not the 20261134 body (options join / test derivation / 1132 shapes missing). Nothing applied.';
  END IF;
  IF NOT v_has_ref THEN
    IF position('p.adult_only INTO v_partner' IN v_def) = 0 OR position('p.order_method' IN v_def) > 0 THEN
      RAISE EXCEPTION 'pre-state: create_eatery_order is not the unchanged 20261134 body (v_partner select). Nothing applied.';
    END IF;
  ELSIF position('p.adult_only, p.order_method INTO v_partner' IN v_def) = 0 OR v_cols = 0 THEN
    RAISE EXCEPTION 'pre-state: create_eatery_order carries the refusal but the column or the select is not this file''s. Nothing applied.';
  END IF;
  IF v_done AND NOT v_has_ref THEN
    RAISE EXCEPTION 'pre-state: 20261144 is in the ledger but create_eatery_order lacks the refusal';
  END IF;

  -- verify_eatery_order: capture its fingerprint; the post-state compares (this file does not touch it).
  v_vdef := pg_get_functiondef(to_regprocedure('public.verify_eatery_order(text)'));
  PERFORM set_config('ada.v20261144_verify_md5', md5(v_vdef), true);

  SELECT array_agg(policyname::text ORDER BY policyname) INTO v_names FROM pg_policies WHERE schemaname = 'public' AND tablename = 'eatery_partners';
  IF v_names IS DISTINCT FROM ARRAY['eatery_partners_select_active','eatery_partners_select_preview'] THEN
    RAISE EXCEPTION 'pre-state: eatery_partners policies are % (want select_active + select_preview). Nothing applied.', v_names;
  END IF;
  RAISE NOTICE 'pre-state ok: done=%, order_method column present=%, % partner(s) %, body has refusal=%, policies %', v_done, v_cols, v_n, v_slugs, v_has_ref, v_names;
END $$;

-- ─── (1) The column: add nullable, backfill, assert, then NOT NULL ──────────
-- Static literals on purpose: scripts/audit-schema-drift.mjs reads CHECK literals from this file.
ALTER TABLE public.eatery_partners ADD COLUMN IF NOT EXISTS order_method text;

UPDATE public.eatery_partners SET order_method = 'whatsapp' WHERE slug = 'crunchy-express' AND order_method IS NULL;

DO $$
DECLARE v_null int; v_rows text;
BEGIN
  SELECT count(*), string_agg(slug, ', ' ORDER BY slug) INTO v_null, v_rows FROM public.eatery_partners WHERE order_method IS NULL;
  IF v_null IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'backfill left % partner(s) without an order_method: %. Nothing applied.', v_null, v_rows;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations_applied WHERE filename = '20261144_eatery_order_method.sql')
     AND NOT EXISTS (SELECT 1 FROM public.eatery_partners WHERE slug = 'crunchy-express' AND order_method IS NOT DISTINCT FROM 'whatsapp') THEN
    RAISE EXCEPTION 'crunchy-express is not whatsapp after the first-apply backfill. Nothing applied.';
  END IF;
  SELECT string_agg(slug || '=' || order_method, ', ' ORDER BY slug) INTO v_rows FROM public.eatery_partners;
  RAISE NOTICE 'backfill ok: 0 NULL; partners: %', v_rows;
END $$;

ALTER TABLE public.eatery_partners ALTER COLUMN order_method SET NOT NULL;

ALTER TABLE public.eatery_partners DROP CONSTRAINT IF EXISTS eatery_partners_order_method_check;
ALTER TABLE public.eatery_partners ADD  CONSTRAINT eatery_partners_order_method_check
  CHECK (order_method IN ('whatsapp','phone'));

COMMENT ON COLUMN public.eatery_partners.order_method IS
  'How a customer orders from this restaurant. whatsapp = the in-app basket that sends a WhatsApp order (the server records it via create_eatery_order). phone = call to order: no basket in the app, and create_eatery_order refuses it (order_not_supported). NOT NULL, no DEFAULT: every partner seed must state its method. Writes: service_role only. 20261144.';

-- ─── (2) create_eatery_order: the 20261134 body + the order_method refusal ──
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
  'Records a WhatsApp order and returns {code, lines, total, currency, expires_at}. Prices come from eatery_menu_items and eatery_item_options, never the client. A p_items element may carry "opts" [{id, qty}]: removals (qty 1, free) and priced extras; the stored line then also holds base_price, options and a Turkish detail. authenticated only (guests included unless the partner sets order_requires_account). 5/user/h counts ALL orders including test orders; 60/partner/h counts guest-session orders that are NOT test orders. is_test is derived by the server (ADA Preview key header, or a listed order tester who is not a guest), never a parameter; test orders are deleted after 24 h. A partner whose order_method is not whatsapp (phone = call to order) is refused for everyone, the Preview key included. Errors: SQLSTATE P0001, MESSAGE = not_authenticated | partner_unavailable | order_not_supported | adult_only (DETAIL guest/no_dob/under_18) | order_requires_account | invalid_items | invalid_client_id | item_unavailable | option_unavailable | mixed_currency | rate_limited | code_generation_failed. 20261144.';

-- ─── Assertions (inside the transaction; a failure rolls the file back) ─────
DO $$
DECLARE
  v_def text; v_s text; v_names text[]; v_n int; v_set text[]; r record; v_blk text; v_i int; v_j int;
  v_ctype text; v_nullable text; v_dflt text; v_rows text;
BEGIN
  -- Column: text, NOT NULL, no DEFAULT.
  SELECT data_type, is_nullable, column_default INTO v_ctype, v_nullable, v_dflt FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'eatery_partners' AND column_name = 'order_method';
  IF v_ctype IS DISTINCT FROM 'text' OR v_nullable IS DISTINCT FROM 'NO' OR v_dflt IS NOT NULL THEN
    RAISE EXCEPTION 'order_method is type=% nullable=% default=% (want text, NO, no default)', v_ctype, v_nullable, v_dflt;
  END IF;
  SELECT count(*) INTO v_n FROM public.eatery_partners WHERE order_method IS NULL;
  IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION '% partner(s) with NULL order_method', v_n; END IF;
  SELECT string_agg(slug || '=' || order_method, ', ' ORDER BY slug) INTO v_rows FROM public.eatery_partners;
  RAISE NOTICE 'partners and their method: %', v_rows;

  -- CHECK: exactly one named check on the column, validated, allowed set derived from the live definition.
  SELECT count(*) INTO v_n FROM pg_constraint c
   WHERE c.conrelid = 'public.eatery_partners'::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%order_method%';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION '% CHECK constraint(s) mention order_method (want exactly 1)', v_n; END IF;
  SELECT pg_get_constraintdef(c.oid) INTO v_s FROM pg_constraint c
   WHERE c.conrelid = 'public.eatery_partners'::regclass AND c.conname = 'eatery_partners_order_method_check' AND c.convalidated;
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_set FROM regexp_matches(coalesce(v_s, ''), '''([a-z_]+)''::text', 'g') AS m;
  IF v_set IS DISTINCT FROM ARRAY['phone','whatsapp']::text[] THEN
    RAISE EXCEPTION 'eatery_partners_order_method_check allows % (def: %)', v_set, coalesce(v_s, '<missing or not validated>');
  END IF;
  RAISE NOTICE 'CHECK: %', v_s;

  -- Policies and grants on eatery_partners are exactly what they were: nothing here widens them.
  SELECT array_agg(policyname::text ORDER BY policyname) INTO v_names FROM pg_policies WHERE schemaname = 'public' AND tablename = 'eatery_partners';
  IF v_names IS DISTINCT FROM ARRAY['eatery_partners_select_active','eatery_partners_select_preview'] THEN
    RAISE EXCEPTION 'eatery_partners policies are % after the file', v_names;
  END IF;
  IF NOT COALESCE(has_table_privilege('anon', 'public.eatery_partners', 'SELECT') AND has_table_privilege('authenticated', 'public.eatery_partners', 'SELECT')
                  AND has_table_privilege('service_role', 'public.eatery_partners', 'SELECT,INSERT,UPDATE,DELETE'), false) THEN
    RAISE EXCEPTION 'CONTROL FAILED: anon / authenticated lost SELECT or service_role lost write on eatery_partners';
  END IF;
  IF has_table_privilege('anon', 'public.eatery_partners', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('authenticated', 'public.eatery_partners', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_any_column_privilege('anon', 'public.eatery_partners', 'INSERT,UPDATE,REFERENCES')
     OR has_any_column_privilege('authenticated', 'public.eatery_partners', 'INSERT,UPDATE,REFERENCES') THEN
    RAISE EXCEPTION 'anon or authenticated can write eatery_partners (table or column level)';
  END IF;
  IF (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = 'public.eatery_partners'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'eatery_partners has column-level ACLs';
  END IF;

  -- Function body: the new shapes AND the 1125 / 1132 / 1134 shapes that must survive.
  v_def := pg_get_functiondef('public.create_eatery_order(uuid,jsonb,text)'::regprocedure);
  IF v_def NOT LIKE '%p.adult_only, p.order_method INTO v_partner%'
     OR v_def NOT LIKE '%IF v_partner.order_method IS DISTINCT FROM ''whatsapp'' THEN%'
     OR v_def NOT LIKE '%MESSAGE = ''order_not_supported''%' THEN
    RAISE EXCEPTION 'create_eatery_order body: the order_method select / refusal shapes are missing';
  END IF;
  v_i := position('MESSAGE = ''partner_unavailable''' IN v_def);
  v_j := position('IF v_partner.order_method IS DISTINCT FROM ''whatsapp'' THEN' IN v_def);
  IF v_i = 0 OR v_j <= v_i OR v_j >= position('MESSAGE = ''adult_only'', DETAIL = ''guest''' IN v_def)
     OR v_j >= position('MESSAGE = ''order_requires_account''' IN v_def) THEN
    RAISE EXCEPTION 'create_eatery_order body: the refusal is not between partner_unavailable and the adult / account checks (%, %)', v_i, v_j;
  END IF;
  v_blk := substr(v_def, v_j, position('END IF;' IN substr(v_def, v_j)) + 6);
  IF v_blk LIKE '%is_previewer%' OR v_blk LIKE '% AND %' OR v_blk LIKE '% OR %' OR v_blk NOT LIKE '%order_not_supported%' THEN
    RAISE EXCEPTION 'the refusal block is not unconditional: [%]', v_blk;
  END IF;
  IF v_def NOT LIKE '%JOIN public.eatery_item_options io%' OR v_def NOT LIKE '%io.item_id = m.id%' OR v_def NOT LIKE '%io.item_id = r.item_id%'
     OR v_def NOT LIKE '%io.is_available%' OR v_def NOT LIKE '%io.kind = ''remove'' OR io.price IS NOT NULL%'
     OR v_def NOT LIKE '%MESSAGE = ''option_unavailable''%' OR v_def NOT LIKE '%r.qty > io.max_qty%'
     OR v_def NOT LIKE '%JOIN public.eatery_menu_items m%' OR v_def NOT LIKE '%m.price IS NOT NULL%'
     OR v_def NOT LIKE '%v_test := public.is_previewer() OR public.is_order_tester(v_uid);%'
     OR v_def NOT LIKE '%NOT (v_partner.is_active OR public.is_previewer())%'
     OR v_def NOT LIKE '%WHERE partner_id = p_partner AND created_as_guest AND NOT is_test AND created_at > now()%'
     OR v_def NOT LIKE '%WHERE created_by = v_uid AND created_at > now() - interval ''1 hour'';%'
     OR v_def NOT LIKE '%client_id, created_as_guest, is_test)%' OR v_def NOT LIKE '%p_client_id, v_guest, v_test)%'
     OR v_def NOT LIKE '%v_partner.adult_only%' OR v_def NOT LIKE '%eatery_order_age_gate(v_dob%' OR v_def NOT LIKE '%v_user_n >= 5%'
     OR v_def LIKE '%p_items -> %' THEN
    RAISE EXCEPTION 'create_eatery_order body: a 1125 / 1132 / 1134 shape did not survive the carry-forward';
  END IF;
  SELECT proargnames INTO v_names FROM pg_proc WHERE oid = 'public.create_eatery_order(uuid,jsonb,text)'::regprocedure;
  IF v_names IS DISTINCT FROM ARRAY['p_partner','p_items','p_client_id']::text[] THEN RAISE EXCEPTION 'create_eatery_order argument names are %', v_names; END IF;
  SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'create_eatery_order';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'expected exactly one create_eatery_order, found %', v_n; END IF;
  IF md5(pg_get_functiondef('public.verify_eatery_order(text)'::regprocedure)) IS DISTINCT FROM current_setting('ada.v20261144_verify_md5', true) THEN
    RAISE EXCEPTION 'verify_eatery_order changed during this file (it must not)';
  END IF;
  IF obj_description('public.create_eatery_order(uuid,jsonb,text)'::regprocedure, 'pg_proc') NOT LIKE '%order_not_supported%'
     OR obj_description('public.create_eatery_order(uuid,jsonb,text)'::regprocedure, 'pg_proc') NOT LIKE '%option_unavailable%'
     OR obj_description('public.create_eatery_order(uuid,jsonb,text)'::regprocedure, 'pg_proc') NOT LIKE '%NOT test orders%'
     OR obj_description('public.create_eatery_order(uuid,jsonb,text)'::regprocedure, 'pg_proc') NOT LIKE '%20261144.' THEN
    RAISE EXCEPTION 'create_eatery_order COMMENT is not the 20261144 text';
  END IF;

  -- Owner, DEFINER, search_path, EXECUTE grantees: derived from the catalog (authenticated only; not PUBLIC, not anon).
  FOR r IN SELECT p.proname, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS owner,
                  COALESCE((SELECT string_agg(DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE g.rolname END, ',' ORDER BY CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE g.rolname END)
                     FROM aclexplode(p.proacl) a LEFT JOIN pg_roles g ON g.oid = a.grantee
                    WHERE a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner AND g.rolname IS DISTINCT FROM 'service_role'), '') AS grantees
             FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'create_eatery_order' LOOP
    IF r.prosecdef IS DISTINCT FROM true OR r.owner IS DISTINCT FROM 'postgres' OR NOT COALESCE(r.proconfig @> ARRAY['search_path=public, pg_temp'], false)
       OR r.grantees IS DISTINCT FROM 'authenticated' THEN
      RAISE EXCEPTION '%: definer=% owner=% config=% EXECUTE grantees="%"', r.proname, r.prosecdef, r.owner, r.proconfig, r.grantees;
    END IF;
    RAISE NOTICE '% -> definer, owner %, config %, EXECUTE for "%"', r.proname, r.owner, r.proconfig, r.grantees;
  END LOOP;
END $$;

-- ─── Behaviour proof (throwaway partners and rows; a sentinel rolls everything back) ───
DO $$
DECLARE
  c_key constant text := 'zz-20261144-probe-key-not-a-secret';
  v_ids jsonb := '{}'::jsonb;
  v_saved jsonb := '{}'::jsonb;
  s record; k record;
  v_sql text; v_res jsonb; v_state text; v_msg text; v_role text; v_claims text; v_hdr text; v_got text; v_report text := '';
  v_uuid uuid; v_item bigint;
  v_pre_orders int; v_pre_partners int; v_pre_items int; v_pre_keys int;
BEGIN
  SELECT count(*) INTO v_pre_orders FROM public.eatery_orders;
  SELECT count(*) INTO v_pre_partners FROM public.eatery_partners;
  SELECT count(*) INTO v_pre_items FROM public.eatery_menu_items;
  SELECT count(*) INTO v_pre_keys FROM private.preview_key_hashes;

  BEGIN
    INSERT INTO private.preview_key_hashes (hash, label) VALUES (encode(sha256(convert_to(c_key, 'UTF8')), 'hex'), 'zz probe 1144');

    -- Seven throwaway partners; every INSERT states its method (NOT NULL, no default).
    FOR k IN SELECT * FROM (VALUES
      ('wa',  'zz-op-wa',  'whatsapp', true,  false),
      ('wi',  'zz-op-wi',  'whatsapp', false, false),
      ('wad', 'zz-op-wad', 'whatsapp', true,  true),
      ('pa',  'zz-op-pa',  'phone',    true,  false),
      ('pi',  'zz-op-pi',  'phone',    false, false),
      ('pad', 'zz-op-pad', 'phone',    true,  true)) AS x(key, slug, method, active, adult) LOOP
      IF k.active THEN
        INSERT INTO public.eatery_partners (slug, name, category, lat, lng, geocode_source, logo_path, menu_verified_on, is_active, order_method, adult_only)
          VALUES (k.slug, 'zz ' || k.slug, 'cafe', 35.1, 33.3, 'partner', k.slug || '/logo.png', current_date, true, k.method, k.adult) RETURNING id INTO v_uuid;
      ELSE
        INSERT INTO public.eatery_partners (slug, name, category, is_active, order_method, adult_only)
          VALUES (k.slug, 'zz ' || k.slug, 'cafe', false, k.method, k.adult) RETURNING id INTO v_uuid;
      END IF;
      v_ids := v_ids || jsonb_build_object(k.key, v_uuid);
      INSERT INTO public.eatery_menu_items (partner_id, section, name, price, currency) VALUES (v_uuid, 'zz', 'zz dish ' || k.slug, 10.00, 'TRY') RETURNING id INTO v_item;
      v_ids := v_ids || jsonb_build_object('d' || k.key, v_item);
    END LOOP;

    -- Steps: (label, who, hdr, sql, want, save). {{x}} = id of x. who = anon | user:N | guest:N | pg | sr.
    -- want = ok | err:<message> (P0001) | state:<sqlstate> | val:<value>.
    FOR s IN SELECT * FROM (VALUES
      -- POSITIVE CONTROLS: a whatsapp partner still takes an order (live, and inactive through the Preview key).
      ('whatsapp, active: accepted',                          'user:61',  '',    $q$SELECT public.create_eatery_order('{{wa}}', '[{"item_id":{{dwa}},"qty":2}]'::jsonb)$q$, 'ok', 'okwa'),
      ('whatsapp, inactive + Preview key: accepted',          'user:62',  'key', $q$SELECT public.create_eatery_order('{{wi}}', '[{"item_id":{{dwi}},"qty":1}]'::jsonb)$q$, 'ok', 'okwi'),
      ('whatsapp adult_only, guest: still adult_only',        'guest:63', '',    $q$SELECT public.create_eatery_order('{{wad}}', '[{"item_id":{{dwad}},"qty":1}]'::jsonb)$q$, 'err:adult_only', NULL),
      -- THE REFUSAL: a phone partner is refused for everyone.
      ('phone, active, signed-in user: order_not_supported',  'user:64',  '',    $q$SELECT public.create_eatery_order('{{pa}}', '[{"item_id":{{dpa}},"qty":1}]'::jsonb)$q$, 'err:order_not_supported', NULL),
      ('phone, active, guest: order_not_supported',           'guest:65', '',    $q$SELECT public.create_eatery_order('{{pa}}', '[{"item_id":{{dpa}},"qty":1}]'::jsonb)$q$, 'err:order_not_supported', NULL),
      ('phone, active + Preview key: order_not_supported',    'user:66',  'key', $q$SELECT public.create_eatery_order('{{pa}}', '[{"item_id":{{dpa}},"qty":1}]'::jsonb)$q$, 'err:order_not_supported', NULL),
      ('phone, INACTIVE + Preview key: order_not_supported (past partner_unavailable, no previewer bypass)', 'user:67', 'key', $q$SELECT public.create_eatery_order('{{pi}}', '[{"item_id":{{dpi}},"qty":1}]'::jsonb)$q$, 'err:order_not_supported', NULL),
      ('phone adult_only, guest: order_not_supported BEFORE adult_only', 'guest:68', '', $q$SELECT public.create_eatery_order('{{pad}}', '[{"item_id":{{dpad}},"qty":1}]'::jsonb)$q$, 'err:order_not_supported', NULL),
      ('phone, empty basket: order_not_supported (before the items are read)', 'user:69', '', $q$SELECT public.create_eatery_order('{{pa}}', '[]'::jsonb)$q$, 'err:order_not_supported', NULL),
      -- Older refusals keep their place.
      ('phone, inactive, no key: still partner_unavailable',  'user:70',  '',    $q$SELECT public.create_eatery_order('{{pi}}', '[{"item_id":{{dpi}},"qty":1}]'::jsonb)$q$, 'err:partner_unavailable', NULL),
      ('unknown partner id: partner_unavailable',             'user:71',  '',    $q$SELECT public.create_eatery_order('00000000-0000-4000-8000-00000000dead', '[{"item_id":1,"qty":1}]'::jsonb)$q$, 'err:partner_unavailable', NULL),
      ('anon cannot call it at all',                          'anon',     '',    $q$SELECT public.create_eatery_order('{{wa}}', '[{"item_id":{{dwa}},"qty":1}]'::jsonb)$q$, 'state:42501', NULL),
      -- The column: CHECK, NOT NULL, no DEFAULT (as the table owner).
      ('CHECK: order_method = fax refused',                   'pg',       '',    $q$UPDATE public.eatery_partners SET order_method = 'fax' WHERE id = '{{wa}}' RETURNING to_jsonb(id)$q$, 'state:23514', NULL),
      ('CHECK: order_method = WhatsApp (case) refused',       'pg',       '',    $q$UPDATE public.eatery_partners SET order_method = 'WhatsApp' WHERE id = '{{wa}}' RETURNING to_jsonb(id)$q$, 'state:23514', NULL),
      ('NOT NULL: order_method = NULL refused',               'pg',       '',    $q$UPDATE public.eatery_partners SET order_method = NULL WHERE id = '{{wa}}' RETURNING to_jsonb(id)$q$, 'state:23502', NULL),
      ('no DEFAULT: an INSERT that omits order_method is refused', 'pg',  '',    $q$INSERT INTO public.eatery_partners (slug, name, category) VALUES ('zz-op-nodef', 'zz nodef', 'cafe') RETURNING to_jsonb(id)$q$, 'state:23502', NULL),
      ('CONTROL postgres can flip it to phone and back',      'pg',       '',    $q$WITH u AS (UPDATE public.eatery_partners SET order_method = 'phone' WHERE id = '{{wi}}' RETURNING order_method) SELECT to_jsonb(count(*)) FROM u$q$, 'val:1', NULL),
      -- Who can write it, each beside a control.
      ('authenticated UPDATE order_method refused',           'user:72',  '',    $q$UPDATE public.eatery_partners SET order_method = 'phone' WHERE id = '{{wa}}' RETURNING to_jsonb(id)$q$, 'state:42501', NULL),
      ('guest UPDATE order_method refused',                   'guest:73', '',    $q$UPDATE public.eatery_partners SET order_method = 'phone' WHERE id = '{{wa}}' RETURNING to_jsonb(id)$q$, 'state:42501', NULL),
      ('anon UPDATE order_method refused',                    'anon',     '',    $q$UPDATE public.eatery_partners SET order_method = 'phone' WHERE id = '{{wa}}' RETURNING to_jsonb(id)$q$, 'state:42501', NULL),
      ('authenticated INSERT refused',                        'user:72',  '',    $q$INSERT INTO public.eatery_partners (slug, name, category, order_method) VALUES ('zz-op-x', 'zz x', 'cafe', 'phone') RETURNING to_jsonb(id)$q$, 'state:42501', NULL),
      ('CONTROL service_role UPDATE order_method works',      'sr',       '',    $q$WITH u AS (UPDATE public.eatery_partners SET order_method = 'whatsapp' WHERE id = '{{wi}}' RETURNING order_method) SELECT to_jsonb(count(*)) FROM u$q$, 'val:1', NULL),
      -- Who can read it, each beside a control.
      ('anon reads order_method of the live whatsapp partner',        'anon',     '',    $q$SELECT to_jsonb(order_method) FROM public.eatery_partners WHERE id = '{{wa}}'$q$, 'val:whatsapp', NULL),
      ('guest reads order_method of the live phone partner',          'guest:73', '',    $q$SELECT to_jsonb(order_method) FROM public.eatery_partners WHERE id = '{{pa}}'$q$, 'val:phone', NULL),
      ('anon sees NO row of the inactive phone partner',              'anon',     '',    $q$SELECT to_jsonb(count(*)) FROM public.eatery_partners WHERE id = '{{pi}}'$q$, 'val:0', NULL),
      ('CONTROL anon + Preview key sees the inactive phone partner',  'anon',     'key', $q$SELECT to_jsonb(order_method) FROM public.eatery_partners WHERE id = '{{pi}}'$q$, 'val:phone', NULL)
    ) AS x(label, who, hdr, sql, want, save) LOOP
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
      v_report := v_report || format(E'\n  %-60s %-9s -> %s', s.label, s.who, v_got);
    END LOOP;

    -- What the accepted orders stored: a whatsapp order is a real row, with the server's price; the refused ones wrote nothing.
    IF (v_saved -> 'okwa' ->> 'total')::numeric IS DISTINCT FROM 20.00 THEN RAISE EXCEPTION 'whatsapp order total is %', v_saved -> 'okwa' -> 'total'; END IF;
    IF (SELECT count(*) FROM public.eatery_orders WHERE partner_id IN ((v_ids ->> 'wa')::uuid, (v_ids ->> 'wi')::uuid)) IS DISTINCT FROM 2 THEN
      RAISE EXCEPTION 'expected exactly the 2 accepted whatsapp orders';
    END IF;
    IF (SELECT count(*) FROM public.eatery_orders WHERE partner_id IN ((v_ids ->> 'pa')::uuid, (v_ids ->> 'pi')::uuid, (v_ids ->> 'pad')::uuid, (v_ids ->> 'wad')::uuid)) IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'a refused order left a row';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'zz-sentinel';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'zz-sentinel' THEN RAISE; END IF;
  END;
  RESET ROLE;

  -- Nothing survived the sentinel.
  IF (SELECT count(*) FROM public.eatery_orders) IS DISTINCT FROM v_pre_orders
     OR (SELECT count(*) FROM public.eatery_partners) IS DISTINCT FROM v_pre_partners
     OR (SELECT count(*) FROM public.eatery_menu_items) IS DISTINCT FROM v_pre_items
     OR (SELECT count(*) FROM private.preview_key_hashes) IS DISTINCT FROM v_pre_keys
     OR EXISTS (SELECT 1 FROM public.eatery_partners WHERE slug LIKE 'zz-op%') THEN
    RAISE EXCEPTION 'probe rows survived the sentinel';
  END IF;
  RAISE NOTICE 'order_method probes (all as stated); nothing survived:%', v_report;
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
VALUES ('20261144_eatery_order_method.sql', '40ede101828e90625b35178e4f3fe695aadf569e7ee9871ce11d47aeffec4f05')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';
