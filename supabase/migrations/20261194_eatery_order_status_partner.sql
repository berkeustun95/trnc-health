-- ═══════════════════════════════════════════════════════════════════════════
-- 20261194 — Yeme-İçme: order status from the restaurant, part 2 (Worker proof, PIN, devices, set-status, push text)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DATABASE ONLY. Needs 20261193 (it refuses to run otherwise). Ships NO secret: the Cloudflare Worker key and every PIN
-- are generated later, outside this file; only a one-way hash of the Worker key ever reaches the database (a later
-- one-row data migration). The table that holds it starts EMPTY, so until then NOBODY can enrol, manage or change a status.
--
-- (1) private.eatery_worker_key_hashes + public.eatery_worker_key_ok(): "this request came through our Worker". It reads the
--     request header x-ada-worker-key, hashes it with the same built-in sha256 form as 20261120, and looks the hash up.
--     Missing / empty / wrong header = false. is_previewer() is neither reused nor touched.
-- (2) private.eatery_partner_pins (one salted-hash PIN per partner, and at most one for the 'test' scope),
--     private.eatery_partner_devices (one row per enrolled device, only the sha256 of its random token),
--     private.eatery_pin_attempts (identity, scope, partner, order code, time, ok; no IP, no user id).
-- (3) admin_set_eatery_partner_pin(partner, scope): a signed-in, non-guest ADMIN gets a fresh random 6-digit PIN, once,
--     in the response. It stores only sha256(salt || ':' || pin), revokes that bucket's devices and clears its lock counters.
--     The PIN is never written to a table, a log or a message. (Internally: eatery_pin_issue does the work; the admin
--     function is the gate.)
-- (4) eatery_order_can_manage gets its real body (replacing the 20261193 stub): Worker key present AND an un-revoked device
--     of THIS partner (or a 'test'-scope device for a TEST order). A test device can never manage a real order; a device of
--     partner X never manages partner Y. eatery_order_device_id does the lookup, so can_manage and set_status cannot drift.
-- (5) eatery_partner_enrol(order code, pin): a restaurant phone proves itself with the PIN and receives a device token.
--     Every refusal is a RETURNED status (forbidden | not_found | closed | no_pin | locked | wrong_pin | device_limit), never an
--     exception, so the attempt row is never rolled back. A test order uses ONLY the test PIN and the test bucket; a real
--     order uses ONLY its partner's PIN and bucket. Caps on FAILED attempts under a per-bucket advisory lock: 5 per order code
--     per hour, 10 per bucket per 15 minutes, 30 per bucket per 24 hours => locked (checked BEFORE the PIN is compared). A lock
--     stops NEW enrolment only; an enrolled device keeps working.
-- (6) eatery_order_set_status(code, status, reason, device): the only way a status changes. Refusals are returned statuses.
--     Allowed for 12 hours after the order was made (the 2-hour expires_at does not block it).
-- (7) eatery_order_push_text(language, status, reason): the push body in the nine languages (English fallback).
-- (8) Retention: the existing eatery-orders-retention job keeps its command and gains two statements: clear notify_token /
--     notify_lang on orders over 12 hours old, and delete PIN attempts over 7 days old. No new job.
--
-- ─── WHO CAN READ / WRITE WHAT ──────────────────────────────────────────────
--   • The four private tables: nobody through the API. All privileges revoked from PUBLIC, anon and authenticated BY NAME
--     (default privileges grant by name); RLS on with ZERO policies as a second lock. Only postgres (this file and the DEFINER
--     functions) and a later data migration touch them. They hold only hashes (key, PIN, device token) and attempt counters.
--   • admin_set_eatery_partner_pin: authenticated EXECUTE, but the body refuses (P0001 forbidden) unless the caller is a
--     non-guest admin. A customer, a provider, a guest and an anon session (no EXECUTE at all) cannot issue a PIN.
--   • eatery_partner_enrol / eatery_order_set_status: anon + authenticated EXECUTE, but both answer forbidden unless the request
--     carries a valid Worker key, so the public API alone can neither guess a PIN nor change a status. Even with the key, a
--     status change needs an enrolled device of the right partner.
--   • Helpers (worker_key_ok, pin_generate, pin_issue, device_id, can_manage, push_text): no EXECUTE for PUBLIC, anon,
--     authenticated.
--   • A customer's own data is not widened: the orders table keeps zero policies; verify / my orders return what 20261193 says.
--
-- PROOF (inside this file): pre-state (20261193 applied, the live retention command is exactly the expected text, push_log has
-- no CHECK on kind, pg_net present); the full object / grant / constraint sets; the text table (every language x status and
-- reason, no placeholder left); and, in a rolled-back sentinel, behaviour probes with a positive control beside every denial.
-- Step results are never printed, so no PIN, token, code or id reaches the public Actions log. The push itself (pg_net) is NOT
-- exercised here: the sentinel orders carry no token, so no HTTP call is made; the harness suite proves the send path.
--
-- Apply: gh workflow run supabase-migrate (dry), then apply=true after Berke's go; with 20261193 in ONE run (files=).
-- Re-runnable: the hash store keeps whatever rows it holds; the retention job is accepted in its old or new form.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── Pre-state (abort before changing anything) ─────────────────────────────
DO $$
DECLARE
  v_n int; v_cmd text; v_old text; v_new text; v_names text[]; v_keys int;
BEGIN
  IF to_regclass('public.schema_migrations_applied') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.schema_migrations_applied WHERE filename = '20261193_eatery_order_status.sql') THEN
    RAISE EXCEPTION 'pre-state: 20261193_eatery_order_status.sql is not in the ledger. Nothing applied.';
  END IF;
  IF to_regprocedure('public.create_eatery_order(uuid,jsonb,text,text)') IS NULL OR to_regprocedure('public.verify_eatery_order(text,text)') IS NULL
     OR to_regprocedure('public.eatery_order_can_manage(uuid,boolean,text)') IS NULL OR to_regprocedure('public.eatery_order_next_statuses(text,text)') IS NULL
     OR to_regclass('public.eatery_order_events') IS NULL OR to_regnamespace('private') IS NULL
     OR to_regprocedure('public.is_admin()') IS NULL OR to_regprocedure('public.is_anonymous_session()') IS NULL THEN
    RAISE EXCEPTION 'pre-state: 20261193 objects / schema private / is_admin / is_anonymous_session missing. Nothing applied.';
  END IF;
  -- push_log: a CHECK on kind would make every order_status log row fail, silently (the insert is wrapped).
  SELECT count(*) INTO v_n FROM pg_constraint c WHERE c.conrelid = to_regclass('public.push_log') AND c.contype = 'c' AND pg_get_constraintdef(c.oid) ILIKE '%kind%';
  IF to_regclass('public.push_log') IS NULL OR v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'pre-state: push_log is missing or has % CHECK(s) on kind. Nothing applied.', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name IN ('push_token','preferred_language');
  IF v_n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'pre-state: profiles.push_token / preferred_language missing. Nothing applied.'; END IF;
  SELECT count(*) INTO v_n FROM pg_proc p WHERE p.pronamespace = to_regnamespace('net') AND p.proname = 'http_post';
  IF v_n < 1 THEN RAISE EXCEPTION 'pre-state: net.http_post (pg_net) is missing. Nothing applied.'; END IF;

  -- Retention job: exactly the 20261132 command, or already this file's.
  v_old := 'DELETE FROM public.eatery_orders WHERE created_at < now() - interval ''30 days'' OR (is_test AND created_at < now() - interval ''24 hours'')';
  SELECT count(*) INTO v_n FROM cron.job WHERE jobname = 'eatery-orders-retention';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'pre-state: % eatery-orders-retention jobs (want 1)', v_n; END IF;
  SELECT btrim(command) INTO v_cmd FROM cron.job WHERE jobname = 'eatery-orders-retention';
  IF v_cmd IS DISTINCT FROM v_old AND v_cmd NOT LIKE v_old || ';%' THEN
    RAISE EXCEPTION 'pre-state: the live eatery-orders-retention command is not the expected 20261132 text. Nothing applied.';
  END IF;
  SELECT array_agg(jobname::text ORDER BY jobname) INTO v_names FROM cron.job WHERE jobname IS DISTINCT FROM 'eatery-orders-retention';
  PERFORM set_config('ada.m1194_other_jobs', COALESCE(array_to_string(v_names, '|'), ''), true);

  IF to_regclass('private.eatery_worker_key_hashes') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM private.eatery_worker_key_hashes' INTO v_keys;
  ELSE
    v_keys := 0;
  END IF;
  PERFORM set_config('ada.m1194_key_rows', v_keys::text, true);
  RAISE NOTICE 'pre-state ok: A applied, retention command as expected, % other cron job(s) %', COALESCE(array_length(v_names, 1), 0), v_names;
END $$;

-- ─── (1) Worker proof ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS private.eatery_worker_key_hashes (
  key_sha256 text        NOT NULL,
  added_at   timestamptz NOT NULL DEFAULT now(),
  note       text,
  CONSTRAINT eatery_worker_key_hashes_pkey PRIMARY KEY (key_sha256),
  CONSTRAINT eatery_worker_key_hashes_hash_check CHECK (key_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE OR REPLACE FUNCTION public.eatery_worker_key_ok()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = ''
AS $fn$
  SELECT COALESCE((
    SELECT EXISTS (
      SELECT 1 FROM private.eatery_worker_key_hashes h
      WHERE h.key_sha256 = encode(pg_catalog.sha256(pg_catalog.convert_to(k.key, 'UTF8')), 'hex'))
    FROM (SELECT NULLIF(COALESCE(NULLIF(pg_catalog.current_setting('request.headers', true), ''), '{}')::json ->> 'x-ada-worker-key', '') AS key) k
    WHERE k.key IS NOT NULL
  ), false)
$fn$;
ALTER FUNCTION public.eatery_worker_key_ok() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.eatery_worker_key_ok() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.eatery_worker_key_ok() IS
  'Internal. true when the request carries the Worker key (x-ada-worker-key, SHA-256 in private.eatery_worker_key_hashes). No client EXECUTE; only DEFINER functions call it. 20261194.';

-- ─── (2) PINs, devices, attempts ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS private.eatery_partner_pins (
  id         bigint      GENERATED ALWAYS AS IDENTITY,
  scope      text        NOT NULL,
  partner_id uuid,
  salt       text        NOT NULL,
  pin_sha256 text        NOT NULL,
  set_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eatery_partner_pins_pkey PRIMARY KEY (id),
  CONSTRAINT eatery_partner_pins_partner_id_key UNIQUE (partner_id),
  CONSTRAINT eatery_partner_pins_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.eatery_partners (id) ON DELETE CASCADE,
  CONSTRAINT eatery_partner_pins_scope_check CHECK (scope IN ('partner','test')),
  CONSTRAINT eatery_partner_pins_scope_partner_check CHECK ((scope = 'partner') = (partner_id IS NOT NULL)),
  CONSTRAINT eatery_partner_pins_salt_check CHECK (length(salt) BETWEEN 16 AND 128),
  CONSTRAINT eatery_partner_pins_hash_check CHECK (pin_sha256 ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS eatery_partner_pins_one_test_idx ON private.eatery_partner_pins (scope) WHERE scope = 'test';

CREATE TABLE IF NOT EXISTS private.eatery_partner_devices (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  scope        text        NOT NULL,
  partner_id   uuid,
  token_sha256 text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  CONSTRAINT eatery_partner_devices_pkey PRIMARY KEY (id),
  CONSTRAINT eatery_partner_devices_token_key UNIQUE (token_sha256),
  CONSTRAINT eatery_partner_devices_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.eatery_partners (id) ON DELETE CASCADE,
  CONSTRAINT eatery_partner_devices_scope_check CHECK (scope IN ('partner','test')),
  CONSTRAINT eatery_partner_devices_scope_partner_check CHECK ((scope = 'partner') = (partner_id IS NOT NULL)),
  CONSTRAINT eatery_partner_devices_hash_check CHECK (token_sha256 ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS eatery_partner_devices_bucket_idx ON private.eatery_partner_devices (scope, partner_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS private.eatery_pin_attempts (
  id         bigint      GENERATED ALWAYS AS IDENTITY,
  scope      text        NOT NULL,
  partner_id uuid,
  order_code text        NOT NULL,
  at         timestamptz NOT NULL DEFAULT now(),
  ok         boolean     NOT NULL,
  CONSTRAINT eatery_pin_attempts_pkey PRIMARY KEY (id),
  CONSTRAINT eatery_pin_attempts_scope_check CHECK (scope IN ('partner','test')),
  CONSTRAINT eatery_pin_attempts_scope_partner_check CHECK ((scope = 'partner') = (partner_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS eatery_pin_attempts_bucket_idx ON private.eatery_pin_attempts (scope, partner_id, at);
CREATE INDEX IF NOT EXISTS eatery_pin_attempts_code_idx   ON private.eatery_pin_attempts (order_code, at);

DO $$
DECLARE t text; sq text;
BEGIN
  FOREACH t IN ARRAY ARRAY['eatery_worker_key_hashes','eatery_partner_pins','eatery_partner_devices','eatery_pin_attempts'] LOOP
    EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE private.%I FROM PUBLIC, anon, authenticated', t);
    sq := CASE WHEN t = 'eatery_worker_key_hashes' THEN NULL ELSE pg_get_serial_sequence('private.' || t, 'id') END;
    IF sq IS NOT NULL THEN EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated', sq); END IF;
  END LOOP;
END $$;
COMMENT ON TABLE private.eatery_worker_key_hashes IS 'SHA-256 (hex) of the Cloudflare Worker key sent as x-ada-worker-key. Hashes only. Starts empty; a later data migration adds the one row. 20261194.';
COMMENT ON TABLE private.eatery_partner_pins IS 'One salted SHA-256 of a restaurant PIN per partner, plus at most one for the test scope. The PIN itself is never stored. 20261194.';
COMMENT ON TABLE private.eatery_partner_devices IS 'Enrolled restaurant phones: only the SHA-256 of each random device token; revoked_at set when the PIN is renewed. 20261194.';
COMMENT ON TABLE private.eatery_pin_attempts IS 'Enrolment attempts (scope, partner, order code, time, ok) for the lock caps; no IP and no user id; deleted after 7 days. 20261194.';

-- ─── (3) helpers: PIN source, device lookup, can_manage ─────────────────────
-- A PIN is 24 random bits from gen_random_uuid() (bytes 0-2, none of them version / variant bits), rejected at 16,000,000 and
-- above, then taken modulo 1,000,000: 16,000,000 is an exact multiple, so every PIN is equally likely. Zero-padded to 6 digits.
CREATE OR REPLACE FUNCTION public.eatery_pin_generate()
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = ''
AS $fn$
DECLARE
  v_b bytea;
  v_v bigint;
BEGIN
  LOOP
    v_b := pg_catalog.decode(pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 6), 'hex');
    v_v := (pg_catalog.get_byte(v_b, 0)::bigint * 256 + pg_catalog.get_byte(v_b, 1)) * 256 + pg_catalog.get_byte(v_b, 2);
    IF v_v < 16000000 THEN
      RETURN pg_catalog.lpad((v_v % 1000000)::text, 6, '0');
    END IF;
  END LOOP;
END;
$fn$;
ALTER FUNCTION public.eatery_pin_generate() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.eatery_pin_generate() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.eatery_pin_generate() IS 'Internal. A uniformly random 6-digit PIN (rejection sampling on 24 CSPRNG bits). No client EXECUTE. 20261194.';

CREATE OR REPLACE FUNCTION public.eatery_order_device_id(p_partner uuid, p_is_test boolean, p_device text)
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = ''
AS $fn$
  SELECT d.id
    FROM private.eatery_partner_devices d
   WHERE public.eatery_worker_key_ok()
     AND p_device IS NOT NULL AND pg_catalog.length(p_device) <= 200
     AND d.token_sha256 = encode(pg_catalog.sha256(pg_catalog.convert_to(p_device, 'UTF8')), 'hex')
     AND d.revoked_at IS NULL
     AND ((d.scope = 'partner' AND d.partner_id = p_partner) OR (d.scope = 'test' AND p_is_test IS TRUE))
$fn$;
ALTER FUNCTION public.eatery_order_device_id(uuid, boolean, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.eatery_order_device_id(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.eatery_order_device_id(uuid, boolean, text) IS
  'Internal. The id of the un-revoked device whose token this is, when the Worker key is present and the device is the partner''s (or a test-scope device and the order is a test order); else NULL. No client EXECUTE. 20261194.';

CREATE OR REPLACE FUNCTION public.eatery_order_can_manage(p_partner uuid, p_is_test boolean, p_device text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = ''
AS $fn$ SELECT public.eatery_order_device_id(p_partner, p_is_test, p_device) IS NOT NULL $fn$;
ALTER FUNCTION public.eatery_order_can_manage(uuid, boolean, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.eatery_order_can_manage(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.eatery_order_can_manage(uuid, boolean, text) IS
  'Internal. Whether this device may change the status of an order of this partner: eatery_order_device_id IS NOT NULL. No client EXECUTE. 20261194.';

-- ─── (3b) issuing a PIN ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.eatery_pin_issue(p_partner uuid, p_scope text)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_pin  text;
  v_salt text;
BEGIN
  IF p_scope IS DISTINCT FROM 'partner' AND p_scope IS DISTINCT FROM 'test' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_scope';
  END IF;
  IF p_scope = 'test' AND p_partner IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_partner';
  END IF;
  IF p_scope = 'partner' AND (p_partner IS NULL OR NOT EXISTS (SELECT 1 FROM public.eatery_partners WHERE id = p_partner)) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_partner';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('eatery_enrol:' || p_scope || ':' || COALESCE(p_partner::text, '')));

  v_pin  := public.eatery_pin_generate();
  v_salt := encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')), 'hex');
  IF p_scope = 'partner' THEN
    INSERT INTO private.eatery_partner_pins (scope, partner_id, salt, pin_sha256)
    VALUES ('partner', p_partner, v_salt, encode(sha256(convert_to(v_salt || ':' || v_pin, 'UTF8')), 'hex'))
    ON CONFLICT (partner_id) DO UPDATE SET salt = EXCLUDED.salt, pin_sha256 = EXCLUDED.pin_sha256, set_at = now();
  ELSE
    INSERT INTO private.eatery_partner_pins (scope, partner_id, salt, pin_sha256)
    VALUES ('test', NULL, v_salt, encode(sha256(convert_to(v_salt || ':' || v_pin, 'UTF8')), 'hex'))
    ON CONFLICT (scope) WHERE scope = 'test' DO UPDATE SET salt = EXCLUDED.salt, pin_sha256 = EXCLUDED.pin_sha256, set_at = now();
  END IF;
  UPDATE private.eatery_partner_devices SET revoked_at = now()
   WHERE revoked_at IS NULL AND scope = p_scope AND partner_id IS NOT DISTINCT FROM p_partner;
  DELETE FROM private.eatery_pin_attempts WHERE scope = p_scope AND partner_id IS NOT DISTINCT FROM p_partner;
  RETURN jsonb_build_object('pin', v_pin, 'scope', p_scope, 'partner_id', p_partner);
END;
$fn$;
ALTER FUNCTION public.eatery_pin_issue(uuid, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.eatery_pin_issue(uuid, text) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.eatery_pin_issue(uuid, text) IS
  'Internal (the admin RPC is the gate). Makes a fresh PIN for a partner or the test scope, stores only its salted hash, revokes that bucket''s devices, clears its attempt counters, returns the PIN once. No client EXECUTE. 20261194.';

CREATE OR REPLACE FUNCTION public.admin_set_eatery_partner_pin(p_partner uuid DEFAULT NULL, p_scope text DEFAULT 'partner')
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF auth.uid() IS NULL OR public.is_anonymous_session() OR NOT public.is_admin() THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'forbidden';
  END IF;
  RETURN public.eatery_pin_issue(p_partner, p_scope);
END;
$fn$;
ALTER FUNCTION public.admin_set_eatery_partner_pin(uuid, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.admin_set_eatery_partner_pin(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_set_eatery_partner_pin(uuid, text) TO authenticated;
COMMENT ON FUNCTION public.admin_set_eatery_partner_pin(uuid, text) IS
  'Admin only (non-guest admin session; anything else = P0001 forbidden). Issues a fresh 6-digit PIN for a partner (p_scope partner, p_partner required) or the test scope (p_scope test, p_partner NULL), returns {pin, scope, partner_id} ONCE, stores only a salted hash, revokes that bucket''s devices and resets its lock counters. 20261194.';

-- ─── (7) push text: nine languages, English fallback ────────────────────────
CREATE OR REPLACE FUNCTION public.eatery_order_push_text(p_lang text, p_status text, p_reason text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path = ''
AS $fn$
  SELECT CASE WHEN p_status = 'cancelled'
    THEN replace(
      (SELECT c.tpl FROM (VALUES
        ('English', 'Your order was cancelled: {reason}'),
        ('Turkish', 'Siparişin iptal edildi: {reason}'),
        ('Arabic',  'تم إلغاء طلبك: {reason}'),
        ('Russian', 'Ваш заказ отменён: {reason}'),
        ('Greek',   'Η παραγγελία σου ακυρώθηκε: {reason}'),
        ('French',  'Ta commande a été annulée : {reason}'),
        ('Spanish', 'Tu pedido ha sido cancelado: {reason}'),
        ('German',  'Deine Bestellung wurde storniert: {reason}'),
        ('Persian', 'سفارش شما لغو شد: {reason}')) AS c(lang, tpl) WHERE c.lang = l.lang),
      '{reason}',
      (SELECT r.txt FROM (VALUES
        ('English', 'closed',            'The restaurant is closed right now.'),
        ('English', 'busy',              'The restaurant is too busy right now.'),
        ('English', 'item_out',          'An item in your order is no longer available.'),
        ('English', 'no_delivery_there', 'The restaurant doesn''t deliver to this address.'),
        ('English', 'unreachable',       'The restaurant couldn''t reach you.'),
        ('English', 'other',             'The restaurant cancelled the order.'),
        ('Turkish', 'closed',            'Restoran şu an kapalı.'),
        ('Turkish', 'busy',              'Restoran şu an çok yoğun.'),
        ('Turkish', 'item_out',          'Siparişindeki bir ürün kalmamış.'),
        ('Turkish', 'no_delivery_there', 'Restoran bu adrese teslimat yapmıyor.'),
        ('Turkish', 'unreachable',       'Restoran sana ulaşamadı.'),
        ('Turkish', 'other',             'Restoran siparişi iptal etti.'),
        ('Arabic',  'closed',            'المطعم مغلق حاليًا.'),
        ('Arabic',  'busy',              'المطعم مشغول جدًا حاليًا.'),
        ('Arabic',  'item_out',          'أحد المنتجات في طلبك لم يعد متوفرًا.'),
        ('Arabic',  'no_delivery_there', 'المطعم لا يوصّل إلى هذا العنوان.'),
        ('Arabic',  'unreachable',       'لم يتمكن المطعم من الوصول إليك.'),
        ('Arabic',  'other',             'ألغى المطعم الطلب.'),
        ('Russian', 'closed',            'Ресторан сейчас закрыт.'),
        ('Russian', 'busy',              'Ресторан сейчас слишком загружен.'),
        ('Russian', 'item_out',          'Одного из товаров в заказе больше нет.'),
        ('Russian', 'no_delivery_there', 'Ресторан не доставляет по этому адресу.'),
        ('Russian', 'unreachable',       'Ресторан не смог с вами связаться.'),
        ('Russian', 'other',             'Ресторан отменил заказ.'),
        ('Greek',   'closed',            'Το εστιατόριο είναι κλειστό αυτή τη στιγμή.'),
        ('Greek',   'busy',              'Το εστιατόριο έχει πολλή δουλειά αυτή τη στιγμή.'),
        ('Greek',   'item_out',          'Ένα προϊόν της παραγγελίας σου δεν είναι πια διαθέσιμο.'),
        ('Greek',   'no_delivery_there', 'Το εστιατόριο δεν κάνει παράδοση σε αυτή τη διεύθυνση.'),
        ('Greek',   'unreachable',       'Το εστιατόριο δεν κατάφερε να επικοινωνήσει μαζί σου.'),
        ('Greek',   'other',             'Το εστιατόριο ακύρωσε την παραγγελία.'),
        ('French',  'closed',            'Le restaurant est fermé pour le moment.'),
        ('French',  'busy',              'Le restaurant est trop occupé pour le moment.'),
        ('French',  'item_out',          'Un article de ta commande n''est plus disponible.'),
        ('French',  'no_delivery_there', 'Le restaurant ne livre pas à cette adresse.'),
        ('French',  'unreachable',       'Le restaurant n''a pas pu te joindre.'),
        ('French',  'other',             'Le restaurant a annulé la commande.'),
        ('Spanish', 'closed',            'El restaurante está cerrado en este momento.'),
        ('Spanish', 'busy',              'El restaurante está demasiado ocupado en este momento.'),
        ('Spanish', 'item_out',          'Un producto de tu pedido ya no está disponible.'),
        ('Spanish', 'no_delivery_there', 'El restaurante no reparte en esta dirección.'),
        ('Spanish', 'unreachable',       'El restaurante no pudo contactarte.'),
        ('Spanish', 'other',             'El restaurante canceló el pedido.'),
        ('German',  'closed',            'Das Restaurant ist gerade geschlossen.'),
        ('German',  'busy',              'Das Restaurant ist gerade zu ausgelastet.'),
        ('German',  'item_out',          'Ein Artikel deiner Bestellung ist nicht mehr verfügbar.'),
        ('German',  'no_delivery_there', 'Das Restaurant liefert nicht an diese Adresse.'),
        ('German',  'unreachable',       'Das Restaurant konnte dich nicht erreichen.'),
        ('German',  'other',             'Das Restaurant hat die Bestellung storniert.'),
        -- Persian: the zero-width non-joiner (U+200C) is written as an escape on purpose (invisible in a diff, lost by a paste).
        ('Persian', 'closed',            'رستوران در حال حاضر بسته است.'),
        ('Persian', 'busy',              'رستوران در حال حاضر بسیار شلوغ است.'),
        ('Persian', 'item_out',          'یکی از اقلام سفارش شما دیگر موجود نیست.'),
        ('Persian', 'no_delivery_there', 'رستوران به این نشانی تحویل نمی' || U&'\200C' || 'دهد.'),
        ('Persian', 'unreachable',       'رستوران نتوانست با شما تماس بگیرد.'),
        ('Persian', 'other',             'رستوران سفارش را لغو کرد.')) AS r(lang, reason, txt)
        WHERE r.lang = l.lang AND r.reason = CASE WHEN p_reason IN ('closed','busy','item_out','no_delivery_there','unreachable','other') THEN p_reason ELSE 'other' END))
    ELSE (SELECT s.body FROM (VALUES
        ('English', 'received',   'Your order was received.'),
        ('English', 'preparing',  'Your order is being prepared.'),
        ('English', 'on_the_way', 'Your order is on its way.'),
        ('English', 'ready',      'Your order is ready for pick-up.'),
        ('Turkish', 'received',   'Siparişin alındı.'),
        ('Turkish', 'preparing',  'Siparişin hazırlanıyor.'),
        ('Turkish', 'on_the_way', 'Siparişin yolda.'),
        ('Turkish', 'ready',      'Siparişin hazır, gelip alabilirsin.'),
        ('Arabic',  'received',   'تم استلام طلبك.'),
        ('Arabic',  'preparing',  'يتم تحضير طلبك.'),
        ('Arabic',  'on_the_way', 'طلبك في الطريق إليك.'),
        ('Arabic',  'ready',      'طلبك جاهز، يمكنك استلامه.'),
        ('Russian', 'received',   'Ваш заказ принят.'),
        ('Russian', 'preparing',  'Ваш заказ готовится.'),
        ('Russian', 'on_the_way', 'Ваш заказ уже в пути.'),
        ('Russian', 'ready',      'Ваш заказ готов, можно забирать.'),
        ('Greek',   'received',   'Η παραγγελία σου ελήφθη.'),
        ('Greek',   'preparing',  'Η παραγγελία σου ετοιμάζεται.'),
        ('Greek',   'on_the_way', 'Η παραγγελία σου είναι στον δρόμο.'),
        ('Greek',   'ready',      'Η παραγγελία σου είναι έτοιμη, μπορείς να την παραλάβεις.'),
        ('French',  'received',   'Ta commande a bien été reçue.'),
        ('French',  'preparing',  'Ta commande est en cours de préparation.'),
        ('French',  'on_the_way', 'Ta commande est en route.'),
        ('French',  'ready',      'Ta commande est prête, tu peux venir la récupérer.'),
        ('Spanish', 'received',   'Tu pedido ha sido recibido.'),
        ('Spanish', 'preparing',  'Tu pedido se está preparando.'),
        ('Spanish', 'on_the_way', 'Tu pedido va en camino.'),
        ('Spanish', 'ready',      'Tu pedido está listo, puedes pasar a recogerlo.'),
        ('German',  'received',   'Deine Bestellung ist eingegangen.'),
        ('German',  'preparing',  'Deine Bestellung wird zubereitet.'),
        ('German',  'on_the_way', 'Deine Bestellung ist unterwegs.'),
        ('German',  'ready',      'Deine Bestellung ist fertig, du kannst sie abholen.'),
        ('Persian', 'received',   'سفارش شما دریافت شد.'),
        ('Persian', 'preparing',  'سفارش شما در حال آماده' || U&'\200C' || 'سازی است.'),
        ('Persian', 'on_the_way', 'سفارش شما در راه است.'),
        ('Persian', 'ready',      'سفارش شما آماده است، می' || U&'\200C' || 'توانید آن را تحویل بگیرید.')) AS s(lang, status, body)
        WHERE s.lang = l.lang AND s.status = p_status)
    END
  FROM (SELECT CASE WHEN p_lang IN ('English','Turkish','Arabic','Russian','Greek','French','Spanish','German','Persian') THEN p_lang ELSE 'English' END AS lang) l
$fn$;
ALTER FUNCTION public.eatery_order_push_text(text, text, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.eatery_order_push_text(text, text, text) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.eatery_order_push_text(text, text, text) IS
  'Internal. The push body for (language full English name, status received|preparing|on_the_way|ready|cancelled, cancel reason); an unknown language falls back to English, an unknown reason to other, an unknown status gives NULL. No client EXECUTE. 20261194.';

-- ─── (5) eatery_partner_enrol ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.eatery_partner_enrol(p_code text, p_pin text)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_c       text;
  v_o       record;
  v_scope   text;
  v_partner uuid;
  v_pin     record;
  v_ok      boolean;
  v_token   text;
BEGIN
  -- Every refusal below is a RETURNED status, never an exception: a RAISE would roll back the attempt row just written.
  IF NOT public.eatery_worker_key_ok() THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;
  IF p_code IS NULL OR length(p_code) > 40 THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  v_c := upper(regexp_replace(p_code, '[-\s]', '', 'g'));
  IF v_c !~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$' THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  SELECT o.code, o.partner_id, o.is_test, o.created_at INTO v_o FROM public.eatery_orders o WHERE o.code = v_c;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF now() >= v_o.created_at + interval '12 hours' THEN
    RETURN jsonb_build_object('status', 'closed');
  END IF;

  -- A test order is judged ONLY against the test PIN and the test bucket; a real order ONLY against its partner's.
  v_scope   := CASE WHEN v_o.is_test THEN 'test' ELSE 'partner' END;
  v_partner := CASE WHEN v_o.is_test THEN NULL ELSE v_o.partner_id END;
  PERFORM pg_advisory_xact_lock(hashtext('eatery_enrol:' || v_scope || ':' || COALESCE(v_partner::text, '')));

  SELECT p.salt, p.pin_sha256 INTO v_pin FROM private.eatery_partner_pins p
   WHERE p.scope = v_scope AND p.partner_id IS NOT DISTINCT FROM v_partner;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'no_pin');
  END IF;

  -- Locked BEFORE the PIN is compared, so a locked bucket never confirms a correct PIN. Failed attempts only.
  IF (SELECT count(*) FROM private.eatery_pin_attempts a WHERE a.order_code = v_c AND NOT a.ok AND a.at > now() - interval '1 hour') >= 5
     OR (SELECT count(*) FROM private.eatery_pin_attempts a WHERE a.scope = v_scope AND a.partner_id IS NOT DISTINCT FROM v_partner AND NOT a.ok AND a.at > now() - interval '15 minutes') >= 10
     OR (SELECT count(*) FROM private.eatery_pin_attempts a WHERE a.scope = v_scope AND a.partner_id IS NOT DISTINCT FROM v_partner AND NOT a.ok AND a.at > now() - interval '24 hours') >= 30 THEN
    RETURN jsonb_build_object('status', 'locked');
  END IF;

  v_ok := p_pin IS NOT NULL AND p_pin ~ '^[0-9]{6}$'
          AND encode(sha256(convert_to(v_pin.salt || ':' || p_pin, 'UTF8')), 'hex') = v_pin.pin_sha256;
  IF NOT v_ok THEN
    INSERT INTO private.eatery_pin_attempts (scope, partner_id, order_code, ok) VALUES (v_scope, v_partner, v_c, false);
    RETURN jsonb_build_object('status', 'wrong_pin');
  END IF;

  IF (SELECT count(*) FROM private.eatery_partner_devices d WHERE d.scope = v_scope AND d.partner_id IS NOT DISTINCT FROM v_partner AND d.revoked_at IS NULL) >= 5 THEN
    RETURN jsonb_build_object('status', 'device_limit');
  END IF;

  -- Three random uuids (about 366 random bits) with the dashes removed; only the sha256 is stored.
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  INSERT INTO private.eatery_partner_devices (scope, partner_id, token_sha256)
  VALUES (v_scope, v_partner, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'));
  INSERT INTO private.eatery_pin_attempts (scope, partner_id, order_code, ok) VALUES (v_scope, v_partner, v_c, true);
  RETURN jsonb_build_object('status', 'ok', 'device_token', v_token);
END;
$fn$;
ALTER FUNCTION public.eatery_partner_enrol(text, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.eatery_partner_enrol(text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.eatery_partner_enrol(text, text) TO anon, authenticated;
COMMENT ON FUNCTION public.eatery_partner_enrol(text, text) IS
  'A restaurant phone enrols with an order code and the PIN: returns {status ok, device_token} or {status forbidden | not_found | closed | no_pin | locked | wrong_pin | device_limit}; never raises. forbidden unless the request carries the Worker key. A test order uses only the test PIN and bucket, a real order only its partner''s. Failed-attempt caps (5 per code per hour, 10 per bucket per 15 minutes, 30 per bucket per 24 hours) lock NEW enrolment only. At most 5 live devices per bucket. anon + authenticated EXECUTE. 20261194.';

-- ─── (6) eatery_order_set_status ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.eatery_order_set_status(p_code text, p_status text, p_reason text DEFAULT NULL, p_device text DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_c       text;
  v_o       public.eatery_orders%ROWTYPE;
  v_dev     uuid;
  v_enabled boolean;
  v_pname   text;
  v_next    text[];
  v_tok     text;
  v_lang    text;
  v_plang   text;
  v_title   text;
  v_text    text;
  v_req     bigint;
BEGIN
  IF NOT public.eatery_worker_key_ok() THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;
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
  v_dev := public.eatery_order_device_id(v_o.partner_id, v_o.is_test, p_device);
  IF v_dev IS NULL THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  SELECT p.order_status_enabled, p.name INTO v_enabled, v_pname FROM public.eatery_partners p WHERE p.id = v_o.partner_id;
  IF NOT v_o.is_test AND NOT COALESCE(v_enabled, false) THEN
    RETURN jsonb_build_object('status', 'disabled');
  END IF;
  IF now() >= v_o.created_at + interval '12 hours' THEN
    RETURN jsonb_build_object('status', 'frozen');
  END IF;
  IF p_status IS NOT DISTINCT FROM v_o.status THEN
    RETURN jsonb_build_object('status', 'ok', 'changed', false);
  END IF;
  v_next := public.eatery_order_next_statuses(v_o.status, v_o.fulfilment);
  IF p_status IS NULL OR NOT (p_status = ANY (v_next)) THEN
    RETURN jsonb_build_object('status', 'invalid_transition');
  END IF;
  IF p_status = 'cancelled' THEN
    IF p_reason IS NULL OR p_reason NOT IN ('closed','busy','item_out','no_delivery_there','unreachable','other') THEN
      RETURN jsonb_build_object('status', 'invalid_reason');
    END IF;
  ELSIF p_reason IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'invalid_reason');
  END IF;

  UPDATE public.eatery_orders SET status = p_status, status_at = now(), cancel_reason = CASE WHEN p_status = 'cancelled' THEN p_reason END WHERE id = v_o.id;
  INSERT INTO public.eatery_order_events (order_id, status, cancel_reason, device_id)
  VALUES (v_o.id, p_status, CASE WHEN p_status = 'cancelled' THEN p_reason END, v_dev);
  UPDATE private.eatery_partner_devices SET last_used_at = now() WHERE id = v_dev;

  -- Push. The order's own token first; else, only for a signed-in (not guest) customer, the profile's token. ANY failure here
  -- is swallowed: it must never undo or fail the status change. The send and the log row are separate blocks, so a failed log
  -- insert can never roll back a queued send.
  v_tok := v_o.notify_token;
  v_lang := v_o.notify_lang;
  IF v_tok IS NULL AND NOT v_o.created_as_guest THEN
    BEGIN
      SELECT NULLIF(btrim(pr.push_token), ''), pr.preferred_language INTO v_tok, v_plang FROM public.profiles pr WHERE pr.id = v_o.created_by;
      v_lang := COALESCE(v_plang, 'English');
    EXCEPTION WHEN OTHERS THEN
      v_tok := NULL;
    END;
  END IF;
  v_req := NULL;
  IF v_tok IS NOT NULL THEN
    BEGIN
      v_title := CASE WHEN v_o.is_test THEN 'TEST ' || U&'\00B7' || ' ' || v_pname ELSE v_pname END;
      v_text  := public.eatery_order_push_text(COALESCE(v_lang, 'English'), p_status, p_reason);
      v_req := net.http_post(
        url     := 'https://exp.host/--/api/v2/push/send',
        body    := jsonb_build_object('to', v_tok, 'title', v_title, 'body', v_text, 'sound', 'default',
                                      'data', jsonb_build_object('screen', 'eatery_order', 'code', v_o.code)),
        headers := jsonb_build_object('Content-Type', 'application/json'));
    EXCEPTION WHEN OTHERS THEN
      v_req := NULL;
    END;
  END IF;
  BEGIN
    INSERT INTO public.push_log (user_id, kind, request_id) VALUES (v_o.created_by, 'order_status', v_req);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  IF p_status IN ('on_the_way','ready','cancelled') THEN
    UPDATE public.eatery_orders SET notify_token = NULL, notify_lang = NULL WHERE id = v_o.id;
  END IF;
  RETURN jsonb_build_object('status', 'ok', 'changed', true, 'order_status', p_status,
                            'next', to_jsonb(public.eatery_order_next_statuses(p_status, v_o.fulfilment)));
END;
$fn$;
ALTER FUNCTION public.eatery_order_set_status(text, text, text, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.eatery_order_set_status(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.eatery_order_set_status(text, text, text, text) TO anon, authenticated;
COMMENT ON FUNCTION public.eatery_order_set_status(text, text, text, text) IS
  'Changes the status of an order. Returns {status ok, changed, order_status, next} or {status forbidden | not_found | disabled | frozen | invalid_transition | invalid_reason}; never raises. forbidden (one word, no oracle) unless the request carries the Worker key AND p_device is an enrolled device allowed for this order. disabled = a REAL order of a partner whose order_status_enabled is false. frozen = 12 hours or more after the order was made (the 2-hour expires_at does not block). Same status = ok, changed false, nothing written. Forward only (eatery_order_next_statuses); cancelled needs one of six reasons, any other status needs none. Writes the event row, then sends the push (any push failure is swallowed) and, on a final status, clears the order''s push token. Never counts as a view. anon + authenticated EXECUTE. 20261194.';

-- ─── (8) Retention: the existing job, command carried forward + two statements ───
DO $$
DECLARE v_old text := 'DELETE FROM public.eatery_orders WHERE created_at < now() - interval ''30 days'' OR (is_test AND created_at < now() - interval ''24 hours'')';
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'eatery-orders-retention') THEN
    PERFORM cron.unschedule('eatery-orders-retention');
  END IF;
  PERFORM cron.schedule('eatery-orders-retention', '40 * * * *',
    v_old || E';\nUPDATE public.eatery_orders SET notify_token = NULL, notify_lang = NULL WHERE created_at < now() - interval ''12 hours'' AND (notify_token IS NOT NULL OR notify_lang IS NOT NULL);\nDELETE FROM private.eatery_pin_attempts WHERE at < now() - interval ''7 days''');
END $$;

-- ─── Structure proof (read from the live catalogs) ──────────────────────────
DO $$
DECLARE
  v_n int; v_s text; v_def text; v_names text[]; r record; t text; v_want text; v_cfg text; v_keys int; v_old text; v_cmd text; v_other text;
  l text; st text; rs text; v_txt text;
BEGIN
  -- Private tables: RLS on, zero policies, no client privilege (table, column, sequence), service_role is NOT granted by this file.
  FOREACH t IN ARRAY ARRAY['eatery_worker_key_hashes','eatery_partner_pins','eatery_partner_devices','eatery_pin_attempts'] LOOP
    IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass('private.' || t)) THEN RAISE EXCEPTION 'private.% has RLS off', t; END IF;
    SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'private' AND tablename = t;
    IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'private.% has % policies (want 0)', t, v_n; END IF;
    IF has_table_privilege('anon', 'private.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_table_privilege('authenticated', 'private.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_any_column_privilege('anon', 'private.' || t, 'SELECT,INSERT,UPDATE,REFERENCES')
       OR has_any_column_privilege('authenticated', 'private.' || t, 'SELECT,INSERT,UPDATE,REFERENCES') THEN
      RAISE EXCEPTION 'private.% is reachable by anon / authenticated', t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class c, LATERAL aclexplode(c.relacl) a WHERE c.oid = to_regclass('private.' || t) AND a.grantee = 0) THEN
      RAISE EXCEPTION 'private.% grants something to PUBLIC', t;
    END IF;
  END LOOP;
  FOR r IN SELECT c.relname FROM pg_class c WHERE c.relnamespace = 'private'::regnamespace AND c.relkind = 'S' AND c.relname LIKE 'eatery\_%' LOOP
    IF has_sequence_privilege('anon', 'private.' || r.relname, 'USAGE,SELECT,UPDATE') OR has_sequence_privilege('authenticated', 'private.' || r.relname, 'USAGE,SELECT,UPDATE') THEN
      RAISE EXCEPTION 'sequence private.% is reachable by anon / authenticated', r.relname;
    END IF;
  END LOOP;

  -- The key store keeps whatever it held (empty on a first apply; a re-run never empties or fills it).
  EXECUTE 'SELECT count(*) FROM private.eatery_worker_key_hashes' INTO v_keys;
  IF v_keys IS DISTINCT FROM current_setting('ada.m1194_key_rows')::int THEN RAISE EXCEPTION 'the worker key store changed during this file'; END IF;

  -- Constraint sets, derived and printed.
  FOR r IN SELECT x.tbl, x.want FROM (VALUES
      ('eatery_worker_key_hashes', ARRAY['eatery_worker_key_hashes_hash_check','eatery_worker_key_hashes_pkey']),
      ('eatery_partner_pins',     ARRAY['eatery_partner_pins_hash_check','eatery_partner_pins_partner_id_fkey','eatery_partner_pins_partner_id_key','eatery_partner_pins_pkey','eatery_partner_pins_salt_check','eatery_partner_pins_scope_check','eatery_partner_pins_scope_partner_check']),
      ('eatery_partner_devices',  ARRAY['eatery_partner_devices_hash_check','eatery_partner_devices_partner_id_fkey','eatery_partner_devices_pkey','eatery_partner_devices_scope_check','eatery_partner_devices_scope_partner_check','eatery_partner_devices_token_key']),
      ('eatery_pin_attempts',     ARRAY['eatery_pin_attempts_pkey','eatery_pin_attempts_scope_check','eatery_pin_attempts_scope_partner_check'])
    ) AS x(tbl, want) LOOP
    SELECT count(*), array_agg(c.conname::text ORDER BY c.conname) INTO v_n, v_names
      FROM pg_constraint c WHERE c.conrelid = to_regclass('private.' || r.tbl) AND c.contype IN ('p','f','u','c');
    RAISE NOTICE 'private.% constraints: % %', r.tbl, v_n, v_names;
    IF v_names IS DISTINCT FROM r.want::text[] THEN RAISE EXCEPTION 'private.% constraint set is %', r.tbl, v_names; END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM pg_indexes WHERE schemaname = 'private' AND indexname = 'eatery_partner_pins_one_test_idx' AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%scope = ''test''%';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'the one-test-PIN partial unique index is missing'; END IF;

  -- Functions: one per name; owner / DEFINER / search_path / EXECUTE grantees derived.
  FOR r IN SELECT p.proname, count(*) AS n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
             AND p.proname IN ('eatery_worker_key_ok','eatery_pin_generate','eatery_order_device_id','eatery_order_can_manage','eatery_pin_issue','admin_set_eatery_partner_pin',
                               'eatery_order_push_text','eatery_partner_enrol','eatery_order_set_status')
            GROUP BY p.proname LOOP
    IF r.n IS DISTINCT FROM 1 THEN RAISE EXCEPTION '% has % overloads (want 1)', r.proname, r.n; END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('eatery_worker_key_ok','eatery_pin_generate','eatery_order_device_id','eatery_order_can_manage','eatery_pin_issue','admin_set_eatery_partner_pin',
                       'eatery_order_push_text','eatery_partner_enrol','eatery_order_set_status');
  IF v_n IS DISTINCT FROM 9 THEN RAISE EXCEPTION 'expected 9 functions of this file, found %', v_n; END IF;
  FOR r IN SELECT p.proname, p.prosecdef, p.proconfig, p.provolatile, pg_get_userbyid(p.proowner) AS owner,
                  COALESCE((SELECT string_agg(DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE g.rolname END, ',' ORDER BY CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE g.rolname END)
                     FROM aclexplode(p.proacl) a LEFT JOIN pg_roles g ON g.oid = a.grantee
                    WHERE a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner AND g.rolname IS DISTINCT FROM 'service_role'), '') AS grantees
             FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('eatery_worker_key_ok','eatery_pin_generate','eatery_order_device_id','eatery_order_can_manage','eatery_pin_issue','admin_set_eatery_partner_pin',
                                'eatery_order_push_text','eatery_partner_enrol','eatery_order_set_status') LOOP
    v_want := CASE r.proname WHEN 'eatery_partner_enrol' THEN 'anon,authenticated' WHEN 'eatery_order_set_status' THEN 'anon,authenticated'
                             WHEN 'admin_set_eatery_partner_pin' THEN 'authenticated' ELSE '' END;
    v_cfg  := CASE WHEN r.proname IN ('eatery_partner_enrol','eatery_order_set_status','admin_set_eatery_partner_pin','eatery_pin_issue') THEN 'search_path=public, pg_temp' ELSE 'search_path=""' END;
    RAISE NOTICE '% -> definer %, owner %, config %, EXECUTE for "%"', r.proname, r.prosecdef, r.owner, r.proconfig, r.grantees;
    IF r.owner IS DISTINCT FROM 'postgres' OR r.grantees IS DISTINCT FROM v_want
       OR r.prosecdef IS DISTINCT FROM (r.proname NOT IN ('eatery_pin_generate','eatery_order_push_text'))
       OR NOT COALESCE(r.proconfig @> ARRAY[v_cfg], false) THEN
      RAISE EXCEPTION '% has the wrong owner / DEFINER flag / search_path / EXECUTE grantees', r.proname;
    END IF;
  END LOOP;
  IF (SELECT provolatile FROM pg_proc WHERE oid = 'public.eatery_order_push_text(text,text,text)'::regprocedure) IS DISTINCT FROM 'i' THEN RAISE EXCEPTION 'push_text must be IMMUTABLE'; END IF;
  SELECT proargnames INTO v_names FROM pg_proc WHERE oid = 'public.eatery_order_set_status(text,text,text,text)'::regprocedure;
  IF v_names IS DISTINCT FROM ARRAY['p_code','p_status','p_reason','p_device']::text[] THEN RAISE EXCEPTION 'set_status argument names are %', v_names; END IF;
  SELECT proargnames INTO v_names FROM pg_proc WHERE oid = 'public.admin_set_eatery_partner_pin(uuid,text)'::regprocedure;
  IF v_names IS DISTINCT FROM ARRAY['p_partner','p_scope']::text[] THEN RAISE EXCEPTION 'admin pin argument names are %', v_names; END IF;

  -- Bodies: the shapes that must be there.
  v_def := pg_get_functiondef('public.eatery_worker_key_ok()'::regprocedure);
  IF v_def NOT LIKE '%x-ada-worker-key%' OR v_def NOT LIKE '%private.eatery_worker_key_hashes%' OR v_def LIKE '%is_previewer%' OR v_def LIKE '%x-ada-preview-key%' THEN
    RAISE EXCEPTION 'eatery_worker_key_ok body is not the worker-key lookup';
  END IF;
  v_def := pg_get_functiondef('public.eatery_order_can_manage(uuid,boolean,text)'::regprocedure);
  IF v_def NOT LIKE '%eatery_order_device_id(p_partner, p_is_test, p_device) IS NOT NULL%' THEN RAISE EXCEPTION 'eatery_order_can_manage still is not the real body'; END IF;
  v_def := pg_get_functiondef('public.eatery_order_device_id(uuid,boolean,text)'::regprocedure);
  IF v_def NOT LIKE '%eatery_worker_key_ok()%' OR v_def NOT LIKE '%d.revoked_at IS NULL%' OR v_def NOT LIKE '%d.partner_id = p_partner%' OR v_def NOT LIKE '%d.scope = ''test'' AND p_is_test IS TRUE%' THEN
    RAISE EXCEPTION 'eatery_order_device_id body: worker key / revoked / partner / test-scope shapes missing';
  END IF;
  v_def := pg_get_functiondef('public.admin_set_eatery_partner_pin(uuid,text)'::regprocedure);
  IF v_def NOT LIKE '%public.is_admin()%' OR v_def NOT LIKE '%public.is_anonymous_session()%' OR v_def NOT LIKE '%MESSAGE = ''forbidden''%' THEN RAISE EXCEPTION 'admin pin function: the admin / guest gate is missing'; END IF;
  v_def := pg_get_functiondef('public.eatery_pin_issue(uuid,text)'::regprocedure);
  IF v_def LIKE '%RAISE NOTICE%' OR v_def LIKE '%RAISE LOG%' OR v_def LIKE '%RAISE INFO%' OR v_def NOT LIKE '%eatery_pin_generate()%' OR v_def NOT LIKE '%revoked_at = now()%'
     OR v_def NOT LIKE '%DELETE FROM private.eatery_pin_attempts%' THEN
    RAISE EXCEPTION 'eatery_pin_issue body: it must generate, hash, revoke devices, clear attempts and never raise the PIN';
  END IF;
  v_def := pg_get_functiondef('public.eatery_partner_enrol(text,text)'::regprocedure);
  IF v_def NOT LIKE '%eatery_worker_key_ok()%' OR v_def LIKE '%RAISE EXCEPTION%' OR v_def NOT LIKE '%>= 5%' OR v_def NOT LIKE '%>= 10%' OR v_def NOT LIKE '%>= 30%'
     OR position('''locked''' IN v_def) > position('encode(sha256' IN v_def) THEN
    RAISE EXCEPTION 'eatery_partner_enrol body: worker key / caps / no-RAISE / lock-before-compare shapes missing';
  END IF;
  v_def := pg_get_functiondef('public.eatery_order_set_status(text,text,text,text)'::regprocedure);
  IF v_def LIKE '%RAISE EXCEPTION%' OR v_def NOT LIKE '%FOR UPDATE%' OR v_def NOT LIKE '%interval ''12 hours''%' OR v_def LIKE '%expires_at%' OR v_def LIKE '%view_count%'
     OR v_def NOT LIKE '%net.http_post%' OR v_def NOT LIKE '%''order_status''%' OR v_def NOT LIKE '%EXCEPTION WHEN OTHERS%' THEN
    RAISE EXCEPTION 'eatery_order_set_status body: a required shape is missing, or it raises / reads expires_at / counts a view';
  END IF;

  -- Text matrix: every (language x status) and (language x reason) cell is non-empty with no placeholder left; TR / EN are the approved text.
  FOREACH l IN ARRAY ARRAY['English','Turkish','Arabic','Russian','Greek','French','Spanish','German','Persian'] LOOP
    FOREACH st IN ARRAY ARRAY['received','preparing','on_the_way','ready'] LOOP
      v_txt := public.eatery_order_push_text(l, st, NULL);
      IF v_txt IS NULL OR btrim(v_txt) = '' OR v_txt LIKE '%{%' THEN RAISE EXCEPTION 'push text empty or with a placeholder: % %', l, st; END IF;
    END LOOP;
    FOREACH rs IN ARRAY ARRAY['closed','busy','item_out','no_delivery_there','unreachable','other'] LOOP
      v_txt := public.eatery_order_push_text(l, 'cancelled', rs);
      IF v_txt IS NULL OR btrim(v_txt) = '' OR v_txt LIKE '%{%' OR v_txt LIKE '%}%' THEN RAISE EXCEPTION 'cancel text empty or with a placeholder: % %', l, rs; END IF;
    END LOOP;
  END LOOP;
  IF public.eatery_order_push_text('Turkish', 'received', NULL) IS DISTINCT FROM 'Siparişin alındı.'
     OR public.eatery_order_push_text('Turkish', 'preparing', NULL) IS DISTINCT FROM 'Siparişin hazırlanıyor.'
     OR public.eatery_order_push_text('Turkish', 'on_the_way', NULL) IS DISTINCT FROM 'Siparişin yolda.'
     OR public.eatery_order_push_text('Turkish', 'ready', NULL) IS DISTINCT FROM 'Siparişin hazır, gelip alabilirsin.'
     OR public.eatery_order_push_text('Turkish', 'cancelled', 'closed') IS DISTINCT FROM 'Siparişin iptal edildi: Restoran şu an kapalı.'
     OR public.eatery_order_push_text('Turkish', 'cancelled', 'busy') IS DISTINCT FROM 'Siparişin iptal edildi: Restoran şu an çok yoğun.'
     OR public.eatery_order_push_text('Turkish', 'cancelled', 'item_out') IS DISTINCT FROM 'Siparişin iptal edildi: Siparişindeki bir ürün kalmamış.'
     OR public.eatery_order_push_text('Turkish', 'cancelled', 'no_delivery_there') IS DISTINCT FROM 'Siparişin iptal edildi: Restoran bu adrese teslimat yapmıyor.'
     OR public.eatery_order_push_text('Turkish', 'cancelled', 'unreachable') IS DISTINCT FROM 'Siparişin iptal edildi: Restoran sana ulaşamadı.'
     OR public.eatery_order_push_text('Turkish', 'cancelled', 'other') IS DISTINCT FROM 'Siparişin iptal edildi: Restoran siparişi iptal etti.'
     OR public.eatery_order_push_text('English', 'received', NULL) IS DISTINCT FROM 'Your order was received.'
     OR public.eatery_order_push_text('English', 'preparing', NULL) IS DISTINCT FROM 'Your order is being prepared.'
     OR public.eatery_order_push_text('English', 'on_the_way', NULL) IS DISTINCT FROM 'Your order is on its way.'
     OR public.eatery_order_push_text('English', 'ready', NULL) IS DISTINCT FROM 'Your order is ready for pick-up.'
     OR public.eatery_order_push_text('English', 'cancelled', 'closed') IS DISTINCT FROM 'Your order was cancelled: The restaurant is closed right now.'
     OR public.eatery_order_push_text('English', 'cancelled', 'busy') IS DISTINCT FROM 'Your order was cancelled: The restaurant is too busy right now.'
     OR public.eatery_order_push_text('English', 'cancelled', 'item_out') IS DISTINCT FROM 'Your order was cancelled: An item in your order is no longer available.'
     OR public.eatery_order_push_text('English', 'cancelled', 'no_delivery_there') IS DISTINCT FROM 'Your order was cancelled: The restaurant doesn''t deliver to this address.'
     OR public.eatery_order_push_text('English', 'cancelled', 'unreachable') IS DISTINCT FROM 'Your order was cancelled: The restaurant couldn''t reach you.'
     OR public.eatery_order_push_text('English', 'cancelled', 'other') IS DISTINCT FROM 'Your order was cancelled: The restaurant cancelled the order.' THEN
    RAISE EXCEPTION 'the approved Turkish / English push text is not exact';
  END IF;
  IF public.eatery_order_push_text('tr', 'received', NULL) IS DISTINCT FROM 'Your order was received.'
     OR public.eatery_order_push_text(NULL, 'ready', NULL) IS DISTINCT FROM 'Your order is ready for pick-up.'
     OR public.eatery_order_push_text('Turkish', 'cancelled', 'rude') IS DISTINCT FROM public.eatery_order_push_text('Turkish', 'cancelled', 'other')
     OR public.eatery_order_push_text('Turkish', 'sent', NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'push text fallbacks: an unknown language must give English, an unknown reason other, an unknown status NULL';
  END IF;
  IF public.eatery_order_push_text('Persian', 'preparing', NULL) NOT LIKE '%' || U&'\200C' || '%' THEN RAISE EXCEPTION 'the Persian zero-width non-joiner is missing'; END IF;

  -- Retention: the job set (count + names printed), the old deletes unchanged, the two new statements present.
  SELECT count(*), array_agg(jobname::text ORDER BY jobname) INTO v_n, v_names FROM cron.job;
  RAISE NOTICE 'cron jobs: % %', v_n, v_names;
  SELECT array_to_string(array_agg(jobname::text ORDER BY jobname), '|') INTO v_other FROM cron.job WHERE jobname IS DISTINCT FROM 'eatery-orders-retention';
  IF COALESCE(v_other, '') IS DISTINCT FROM current_setting('ada.m1194_other_jobs') THEN RAISE EXCEPTION 'another cron job changed during this file'; END IF;
  SELECT count(*) INTO v_n FROM cron.job WHERE jobname = 'eatery-orders-retention' AND schedule = '40 * * * *' AND active;
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'eatery-orders-retention is not one active hourly :40 job'; END IF;
  v_old := 'DELETE FROM public.eatery_orders WHERE created_at < now() - interval ''30 days'' OR (is_test AND created_at < now() - interval ''24 hours'')';
  SELECT btrim(command) INTO v_cmd FROM cron.job WHERE jobname = 'eatery-orders-retention';
  IF v_cmd NOT LIKE v_old || ';%' OR v_cmd NOT LIKE '%UPDATE public.eatery_orders SET notify_token = NULL, notify_lang = NULL WHERE created_at < now() - interval ''12 hours''%'
     OR v_cmd NOT LIKE '%DELETE FROM private.eatery_pin_attempts WHERE at < now() - interval ''7 days''%' THEN
    RAISE EXCEPTION 'the retention command is not the 20261132 delete + the two new statements';
  END IF;
END $$;

-- ─── Behaviour proof (throwaway partners and orders; a sentinel rolls everything back) ───
DO $$
DECLARE
  c_key constant text := 'zz-20261194-probe-key-not-a-secret';
  v_ids jsonb := '{}'::jsonb;
  s record; k record;
  v_sql text; v_res jsonb; v_state text; v_msg text; v_role text; v_claims text; v_hdr text; v_got text; v_report text := '';
  v_uuid uuid; v_cnt int := 0;
  v_pre jsonb;
BEGIN
  v_pre := jsonb_build_object(
    'orders',   (SELECT count(*) FROM public.eatery_orders),
    'partners', (SELECT count(*) FROM public.eatery_partners),
    'events',   (SELECT count(*) FROM public.eatery_order_events),
    'keys',     (SELECT count(*) FROM private.eatery_worker_key_hashes),
    'pins',     (SELECT count(*) FROM private.eatery_partner_pins),
    'devices',  (SELECT count(*) FROM private.eatery_partner_devices),
    'attempts', (SELECT count(*) FROM private.eatery_pin_attempts),
    'log',      (SELECT count(*) FROM public.push_log));

  BEGIN
    INSERT INTO private.eatery_worker_key_hashes (key_sha256, note) VALUES (encode(sha256(convert_to(c_key, 'UTF8')), 'hex'), 'zz probe 1194');
    INSERT INTO public.eatery_partners (slug, name, category, lat, lng, geocode_source, logo_path, menu_verified_on, is_active, order_method, order_status_enabled)
      VALUES ('zz-os-wa', 'zz zz-os-wa', 'cafe', 35.1, 33.3, 'partner', 'zz-os-wa/logo.png', current_date, true, 'whatsapp', true) RETURNING id INTO v_uuid;
    v_ids := v_ids || jsonb_build_object('wa', v_uuid);
    INSERT INTO public.eatery_partners (slug, name, category, lat, lng, geocode_source, logo_path, menu_verified_on, is_active, order_method, order_status_enabled)
      VALUES ('zz-os-wb', 'zz zz-os-wb', 'cafe', 35.1, 33.3, 'partner', 'zz-os-wb/logo.png', current_date, true, 'whatsapp', false) RETURNING id INTO v_uuid;
    v_ids := v_ids || jsonb_build_object('wb', v_uuid);

    INSERT INTO public.eatery_orders (code, partner_id, lines, total, currency, created_by, created_as_guest, is_test, fulfilment, created_at, expires_at)
    SELECT o.code, (v_ids ->> o.p)::uuid, '[{"name":"zz","qty":1,"unit_price":1}]'::jsonb, 1, 'TRY', '00000000-0000-4000-8000-000000000091', false, o.test, o.mode,
           now() - o.age, now() - o.age + o.life
      FROM (VALUES
        ('ZZZZ2222', 'wa', false, NULL::text,  interval '0',  interval '2 hours'),
        ('ZZZZ3333', 'wb', false, NULL,        interval '0',  interval '2 hours'),
        ('ZZZZ4444', 'wa', true,  NULL,        interval '0',  interval '2 hours'),
        ('ZZZZ5555', 'wb', true,  NULL,        interval '0',  interval '2 hours'),
        ('ZZZZ6666', 'wa', false, NULL,        interval '3 hours',  interval '2 hours'),
        ('ZZZZ7777', 'wa', false, NULL,        interval '13 hours', interval '2 hours'),
        ('ZZZZ8888', 'wa', false, 'pickup',    interval '0',  interval '2 hours'),
        ('ZZZZ9999', 'wa', false, 'delivery',  interval '0',  interval '2 hours'),
        ('ZZZZCCCC', 'wa', false, NULL,        interval '0',  interval '2 hours'),
        ('ZZZZDDDD', 'wa', false, NULL,        interval '0',  interval '2 hours')) AS o(code, p, test, mode, age, life);

    -- Steps: (label, who, hdr, sql, want, save). {{x}} = id; {{c_x}} = code, {{p_x}} = PIN, {{t_x}} = device token saved as x.
    -- hdr: '' none | key = the probe Worker key | bad = a wrong key. want = ok | err:<message> | state:<sqlstate> | val:<value>.
    -- Only labels are printed, never a result (a result can hold a PIN or a device token).
    FOR s IN SELECT * FROM (VALUES
      ('enrol with NO Worker key: forbidden',                 'anon', '',    $q$SELECT public.eatery_partner_enrol('ZZZZ2222', '000000') -> 'status'$q$, 'val:forbidden', NULL),
      ('enrol with a WRONG Worker key: forbidden',            'anon', 'bad', $q$SELECT public.eatery_partner_enrol('ZZZZ2222', '000000') -> 'status'$q$, 'val:forbidden', NULL),
      ('CONTROL enrol with the key, no PIN set yet: no_pin',  'anon', 'key', $q$SELECT public.eatery_partner_enrol('ZZZZ2222', '000000') -> 'status'$q$, 'val:no_pin', NULL),
      ('no PIN set: no attempt recorded',                     'pg',   '',    $q$SELECT to_jsonb(count(*)) FROM private.eatery_pin_attempts WHERE order_code = 'ZZZZ2222'$q$, 'val:0', NULL),
      ('issue a partner PIN for wa (internal core)',          'pg',   '',    $q$SELECT public.eatery_pin_issue('{{wa}}', 'partner')$q$, 'ok', 'pa'),
      ('issue a partner PIN for wb',                          'pg',   '',    $q$SELECT public.eatery_pin_issue('{{wb}}', 'partner')$q$, 'ok', 'pb'),
      ('issue the test PIN',                                  'pg',   '',    $q$SELECT public.eatery_pin_issue(NULL, 'test')$q$, 'ok', 'pt'),
      ('the PIN is six digits',                               'pg',   '',    $q$SELECT to_jsonb('{{p_pa}}' ~ '^[0-9]{6}$' AND '{{p_pb}}' ~ '^[0-9]{6}$' AND '{{p_pt}}' ~ '^[0-9]{6}$')$q$, 'val:true', NULL),
      ('only a salted hash is stored for wa',                 'pg',   '',    $q$SELECT to_jsonb(pin_sha256 = encode(sha256(convert_to(salt || ':' || '{{p_pa}}', 'UTF8')), 'hex') AND pin_sha256 <> encode(sha256(convert_to('{{p_pa}}', 'UTF8')), 'hex')) FROM private.eatery_partner_pins WHERE partner_id = '{{wa}}'$q$, 'val:true', NULL),
      ('exactly 3 PIN rows for wa, wb and the test scope',    'pg',   '',    $q$SELECT to_jsonb(count(*)) FROM private.eatery_partner_pins WHERE partner_id IN ('{{wa}}', '{{wb}}') OR scope = 'test'$q$, 'val:3', NULL),
      ('unknown code: not_found',                             'anon', 'key', $q$SELECT public.eatery_partner_enrol('ZZZZ2224', '{{p_pa}}') -> 'status'$q$, 'val:not_found', NULL),
      ('garbage code: not_found',                             'anon', 'key', $q$SELECT public.eatery_partner_enrol('not a code', '{{p_pa}}') -> 'status'$q$, 'val:not_found', NULL),
      ('13 h old order: closed even with the right PIN',      'anon', 'key', $q$SELECT public.eatery_partner_enrol('ZZZZ7777', '{{p_pa}}') -> 'status'$q$, 'val:closed', NULL),
      ('malformed PIN: wrong_pin (returned, not raised)',     'anon', 'key', $q$SELECT public.eatery_partner_enrol('ZZZZ8888', '12345') -> 'status'$q$, 'val:wrong_pin', NULL),
      ('NULL PIN: wrong_pin',                                 'anon', 'key', $q$SELECT public.eatery_partner_enrol('ZZZZ9999', NULL) -> 'status'$q$, 'val:wrong_pin', NULL),
      ('the failed attempts were recorded (not rolled back)', 'pg',   '',    $q$SELECT to_jsonb(count(*)) FROM private.eatery_pin_attempts WHERE NOT ok AND order_code IN ('ZZZZ8888', 'ZZZZ9999')$q$, 'val:2', NULL),
      ('real order with the TEST PIN: wrong_pin',             'anon', 'key', $q$SELECT public.eatery_partner_enrol('ZZZZ2222', '{{p_pt}}') -> 'status'$q$, 'val:wrong_pin', NULL),
      ('real order of wa with the wb PIN: wrong_pin',         'anon', 'key', $q$SELECT public.eatery_partner_enrol('ZZZZ2222', '{{p_pb}}') -> 'status'$q$, 'val:wrong_pin', NULL),
      ('test order with the REAL wa PIN: wrong_pin',          'anon', 'key', $q$SELECT public.eatery_partner_enrol('ZZZZ4444', '{{p_pa}}') -> 'status'$q$, 'val:wrong_pin', NULL),
      ('CONTROL real order with its own PIN: ok',             'anon', 'key', $q$SELECT public.eatery_partner_enrol('ZZZZ2222', '{{p_pa}}')$q$, 'ok', 'd1'),
      ('CONTROL test order with the test PIN: ok',            'anon', 'key', $q$SELECT public.eatery_partner_enrol('ZZZZ4444', '{{p_pt}}')$q$, 'ok', 'dt'),
      ('CONTROL wb real order with the wb PIN: ok',           'anon', 'key', $q$SELECT public.eatery_partner_enrol('ZZZZ3333', '{{p_pb}}')$q$, 'ok', 'd2'),
      ('the device token is long',                            'pg',   '',    $q$SELECT to_jsonb(length('{{t_d1}}') >= 60)$q$, 'val:true', NULL),
      ('only its hash is stored',                             'pg',   '',    $q$SELECT to_jsonb(count(*)) FROM private.eatery_partner_devices WHERE token_sha256 = encode(sha256(convert_to('{{t_d1}}', 'UTF8')), 'hex')$q$, 'val:1', NULL),
      -- who can manage what
      ('device WITHOUT the Worker key: can_manage false',     'anon', '',    $q$SELECT public.verify_eatery_order('ZZZZ2222', '{{t_d1}}') -> 'can_manage'$q$, 'val:false', NULL),
      ('CONTROL device WITH the key: can_manage true',        'anon', 'key', $q$SELECT public.verify_eatery_order('ZZZZ2222', '{{t_d1}}') -> 'can_manage'$q$, 'val:true', NULL),
      ('next on an older-app order offers both finals',       'anon', 'key', $q$SELECT public.verify_eatery_order('ZZZZ2222', '{{t_d1}}') -> 'next'$q$, 'val:["received", "preparing", "on_the_way", "ready", "cancelled"]', NULL),
      ('no device: next is empty',                            'anon', 'key', $q$SELECT public.verify_eatery_order('ZZZZ2222') -> 'next'$q$, 'val:[]', NULL),
      ('wa device on a wb order: can_manage false',           'anon', 'key', $q$SELECT public.verify_eatery_order('ZZZZ3333', '{{t_d1}}') -> 'can_manage'$q$, 'val:false', NULL),
      ('wb device on its own order: can_manage true',         'anon', 'key', $q$SELECT public.verify_eatery_order('ZZZZ3333', '{{t_d2}}') -> 'can_manage'$q$, 'val:true', NULL),
      ('wb order, status switched off: next stays empty',     'anon', 'key', $q$SELECT public.verify_eatery_order('ZZZZ3333', '{{t_d2}}') -> 'next'$q$, 'val:[]', NULL),
      ('wa device on a wa TEST order: can_manage true',       'anon', 'key', $q$SELECT public.verify_eatery_order('ZZZZ4444', '{{t_d1}}') -> 'can_manage'$q$, 'val:true', NULL),
      ('test device on a test order: can_manage true',        'anon', 'key', $q$SELECT public.verify_eatery_order('ZZZZ5555', '{{t_dt}}') -> 'can_manage'$q$, 'val:true', NULL),
      ('test device on a REAL order: can_manage false',       'anon', 'key', $q$SELECT public.verify_eatery_order('ZZZZ2222', '{{t_dt}}') -> 'can_manage'$q$, 'val:false', NULL),
      ('wb device on a wa test order: can_manage false',      'anon', 'key', $q$SELECT public.verify_eatery_order('ZZZZ4444', '{{t_d2}}') -> 'can_manage'$q$, 'val:false', NULL),
      -- set_status refusals
      ('set_status without the Worker key: forbidden',        'anon', '',    $q$SELECT public.eatery_order_set_status('ZZZZ2222', 'received', NULL, '{{t_d1}}') -> 'status'$q$, 'val:forbidden', NULL),
      ('set_status with a wrong device: forbidden',           'anon', 'key', $q$SELECT public.eatery_order_set_status('ZZZZ2222', 'received', NULL, 'zz-not-a-device') -> 'status'$q$, 'val:forbidden', NULL),
      ('set_status with no device: forbidden',                'anon', 'key', $q$SELECT public.eatery_order_set_status('ZZZZ2222', 'received') -> 'status'$q$, 'val:forbidden', NULL),
      ('set_status, other partner device: forbidden',         'anon', 'key', $q$SELECT public.eatery_order_set_status('ZZZZ2222', 'received', NULL, '{{t_d2}}') -> 'status'$q$, 'val:forbidden', NULL),
      ('set_status unknown code: not_found',                  'anon', 'key', $q$SELECT public.eatery_order_set_status('ZZZZ2224', 'received', NULL, '{{t_d1}}') -> 'status'$q$, 'val:not_found', NULL),
      ('nothing changed by the refusals',                     'pg',   '',    $q$SELECT to_jsonb(status) FROM public.eatery_orders WHERE code = 'ZZZZ2222'$q$, 'val:sent', NULL),
      ('real order of a partner with status switched off: disabled', 'anon', 'key', $q$SELECT public.eatery_order_set_status('ZZZZ3333', 'received', NULL, '{{t_d2}}') -> 'status'$q$, 'val:disabled', NULL),
      ('CONTROL a TEST order of that partner works anyway',   'anon', 'key', $q$SELECT public.eatery_order_set_status('ZZZZ5555', 'received', NULL, '{{t_d2}}') -> 'order_status'$q$, 'val:received', NULL),
      -- the happy path and the rules
      ('received: ok, changed',                               'anon', 'key', $q$SELECT public.eatery_order_set_status('ZZZZ2222', 'received', NULL, '{{t_d1}}') -> 'changed'$q$, 'val:true', NULL),
      ('same status again: ok, changed false',                'anon', 'key', $q$SELECT public.eatery_order_set_status('ZZZZ2222', 'received', NULL, '{{t_d1}}') -> 'changed'$q$, 'val:false', NULL),
      ('same status wrote no second event',                   'pg',   '',    $q$SELECT to_jsonb(count(*)) FROM public.eatery_order_events e JOIN public.eatery_orders o ON o.id = e.order_id WHERE o.code = 'ZZZZ2222'$q$, 'val:1', NULL),
      ('backwards to sent: invalid_transition',               'anon', 'key', $q$SELECT public.eatery_order_set_status('ZZZZ2222', 'sent', NULL, '{{t_d1}}') -> 'status'$q$, 'val:invalid_transition', NULL),
      ('unknown status: invalid_transition',                  'anon', 'key', $q$SELECT public.eatery_order_set_status('ZZZZ2222', 'delivered', NULL, '{{t_d1}}') -> 'status'$q$, 'val:invalid_transition', NULL),
      ('NULL status: invalid_transition',                     'anon', 'key', $q$SELECT public.eatery_order_set_status('ZZZZ2222', NULL, NULL, '{{t_d1}}') -> 'status'$q$, 'val:invalid_transition', NULL),
      ('a reason on a non-cancel status: invalid_reason',     'anon', 'key', $q$SELECT public.eatery_order_set_status('ZZZZ2222', 'preparing', 'busy', '{{t_d1}}') -> 'status'$q$, 'val:invalid_reason', NULL),
      ('cancelled without a reason: invalid_reason',          'anon', 'key', $q$SELECT public.eatery_order_set_status('ZZZZ2222', 'cancelled', NULL, '{{t_d1}}') -> 'status'$q$, 'val:invalid_reason', NULL),
      ('cancelled with an unknown reason: invalid_reason',    'anon', 'key', $q$SELECT public.eatery_order_set_status('ZZZZ2222', 'cancelled', 'rude', '{{t_d1}}') -> 'status'$q$, 'val:invalid_reason', NULL),
      ('refusals changed nothing',                            'pg',   '',    $q$SELECT to_jsonb(status) FROM public.eatery_orders WHERE code = 'ZZZZ2222'$q$, 'val:received', NULL),
      ('preparing: ok (skipping is allowed from sent, forward here)', 'anon', 'key', $q$SELECT public.eatery_order_set_status('ZZZZ2222', 'preparing', NULL, '{{t_d1}}') -> 'order_status'$q$, 'val:preparing', NULL),
      ('status_at is set',                                    'pg',   '',    $q$SELECT to_jsonb(status_at IS NOT NULL) FROM public.eatery_orders WHERE code = 'ZZZZ2222'$q$, 'val:true', NULL),
      ('ready (older-app order allows either final): ok',     'anon', 'key', $q$SELECT public.eatery_order_set_status('ZZZZ2222', 'ready', NULL, '{{t_d1}}') -> 'next'$q$, 'val:[]', NULL),
      ('after a final status nothing moves: cancelled',       'anon', 'key', $q$SELECT public.eatery_order_set_status('ZZZZ2222', 'cancelled', 'busy', '{{t_d1}}') -> 'status'$q$, 'val:invalid_transition', NULL),
      ('after a final status nothing moves: preparing',       'anon', 'key', $q$SELECT public.eatery_order_set_status('ZZZZ2222', 'preparing', NULL, '{{t_d1}}') -> 'status'$q$, 'val:invalid_transition', NULL),
      ('events: received, preparing, ready (3 rows)',         'pg',   '',    $q$SELECT to_jsonb(count(*)) FROM public.eatery_order_events e JOIN public.eatery_orders o ON o.id = e.order_id WHERE o.code = 'ZZZZ2222'$q$, 'val:3', NULL),
      ('events carry the device id',                          'pg',   '',    $q$SELECT to_jsonb(count(*)) FROM public.eatery_order_events e JOIN public.eatery_orders o ON o.id = e.order_id WHERE o.code = 'ZZZZ2222' AND e.device_id IS NOT NULL$q$, 'val:3', NULL),
      ('the device was stamped used',                         'pg',   '',    $q$SELECT to_jsonb(last_used_at IS NOT NULL) FROM private.eatery_partner_devices WHERE token_sha256 = encode(sha256(convert_to('{{t_d1}}', 'UTF8')), 'hex')$q$, 'val:true', NULL),
      ('pickup order: on_the_way refused',                    'anon', 'key', $q$SELECT public.eatery_order_set_status('ZZZZ8888', 'on_the_way', NULL, '{{t_d1}}') -> 'status'$q$, 'val:invalid_transition', NULL),
      ('pickup order: ready ok',                              'anon', 'key', $q$SELECT public.eatery_order_set_status('ZZZZ8888', 'ready', NULL, '{{t_d1}}') -> 'order_status'$q$, 'val:ready', NULL),
      ('delivery order: ready refused',                       'anon', 'key', $q$SELECT public.eatery_order_set_status('ZZZZ9999', 'ready', NULL, '{{t_d1}}') -> 'status'$q$, 'val:invalid_transition', NULL),
      ('delivery order: on_the_way ok',                       'anon', 'key', $q$SELECT public.eatery_order_set_status('ZZZZ9999', 'on_the_way', NULL, '{{t_d1}}') -> 'order_status'$q$, 'val:on_the_way', NULL),
      ('cancel from sent with a reason: ok',                  'anon', 'key', $q$SELECT public.eatery_order_set_status('ZZZZ4444', 'cancelled', 'busy', '{{t_d1}}') -> 'order_status'$q$, 'val:cancelled', NULL),
      ('cancel reason stored',                                'pg',   '',    $q$SELECT to_jsonb(cancel_reason) FROM public.eatery_orders WHERE code = 'ZZZZ4444'$q$, 'val:busy', NULL),
      -- 2 h expiry does not block, 12 h does
      ('3 h old order (expires_at passed): change works',     'anon', 'key', $q$SELECT public.eatery_order_set_status('ZZZZ6666', 'received', NULL, '{{t_d1}}') -> 'order_status'$q$, 'val:received', NULL),
      ('3 h old order: verify says expired, status still open', 'anon', 'key', $q$SELECT to_jsonb(public.verify_eatery_order('ZZZZ6666') ->> 'status' = 'expired' AND (public.verify_eatery_order('ZZZZ6666') -> 'status_open')::boolean)$q$, 'val:true', NULL),
      ('13 h old order: frozen',                              'anon', 'key', $q$SELECT public.eatery_order_set_status('ZZZZ7777', 'received', NULL, '{{t_d1}}') -> 'status'$q$, 'val:frozen', NULL),
      ('13 h old order, same status: frozen first',           'anon', 'key', $q$SELECT public.eatery_order_set_status('ZZZZ7777', 'sent', NULL, '{{t_d1}}') -> 'status'$q$, 'val:frozen', NULL),
      ('set_status never counts a view',                      'pg',   '',    $q$SELECT to_jsonb(view_count) FROM public.eatery_orders WHERE code = 'ZZZZ8888'$q$, 'val:0', NULL),
      -- caps: a lock blocks NEW enrolment only
      ('failed attempt 1 on ZZZZCCCC',                        'anon', 'key', $q$SELECT public.eatery_partner_enrol('ZZZZCCCC', 'x') -> 'status'$q$, 'val:wrong_pin', NULL),
      ('failed attempt 2',                                    'anon', 'key', $q$SELECT public.eatery_partner_enrol('ZZZZCCCC', 'x') -> 'status'$q$, 'val:wrong_pin', NULL),
      ('failed attempt 3',                                    'anon', 'key', $q$SELECT public.eatery_partner_enrol('ZZZZCCCC', 'x') -> 'status'$q$, 'val:wrong_pin', NULL),
      ('failed attempt 4',                                    'anon', 'key', $q$SELECT public.eatery_partner_enrol('ZZZZCCCC', 'x') -> 'status'$q$, 'val:wrong_pin', NULL),
      ('failed attempt 5',                                    'anon', 'key', $q$SELECT public.eatery_partner_enrol('ZZZZCCCC', 'x') -> 'status'$q$, 'val:wrong_pin', NULL),
      ('6th attempt WITH THE CORRECT PIN: locked',            'anon', 'key', $q$SELECT public.eatery_partner_enrol('ZZZZCCCC', '{{p_pa}}') -> 'status'$q$, 'val:locked', NULL),
      ('CONTROL another order, same partner, correct PIN: ok', 'anon', 'key', $q$SELECT public.eatery_partner_enrol('ZZZZDDDD', '{{p_pa}}') -> 'status'$q$, 'val:ok', NULL),
      ('test failures never lock the real partner (control: wb)', 'anon', 'key', $q$SELECT public.eatery_partner_enrol('ZZZZ3333', '{{p_pb}}') -> 'status'$q$, 'val:ok', NULL),
      ('the lock did not stop an enrolled device',            'anon', 'key', $q$SELECT public.eatery_order_set_status('ZZZZCCCC', 'received', NULL, '{{t_d1}}') -> 'order_status'$q$, 'val:received', NULL),
      -- renewing the PIN
      ('renew the wa PIN',                                    'pg',   '',    $q$SELECT public.eatery_pin_issue('{{wa}}', 'partner')$q$, 'ok', 'pa2'),
      ('the old device is revoked: set_status forbidden',     'anon', 'key', $q$SELECT public.eatery_order_set_status('ZZZZDDDD', 'received', NULL, '{{t_d1}}') -> 'status'$q$, 'val:forbidden', NULL),
      ('the old device is revoked: can_manage false',         'anon', 'key', $q$SELECT public.verify_eatery_order('ZZZZDDDD', '{{t_d1}}') -> 'can_manage'$q$, 'val:false', NULL),
      ('CONTROL the wb device is untouched by the wa renewal', 'anon', 'key', $q$SELECT public.verify_eatery_order('ZZZZ3333', '{{t_d2}}') -> 'can_manage'$q$, 'val:true', NULL),
      ('the lock counters of wa were cleared',                'pg',   '',    $q$SELECT to_jsonb(count(*)) FROM private.eatery_pin_attempts WHERE scope = 'partner' AND partner_id = '{{wa}}'$q$, 'val:0', NULL),
      ('the old PIN no longer works',                         'anon', 'key', $q$SELECT public.eatery_partner_enrol('ZZZZCCCC', '{{p_pa}}') -> 'status'$q$, 'val:wrong_pin', NULL),
      ('CONTROL the new PIN enrols, the old lock is gone',    'anon', 'key', $q$SELECT public.eatery_partner_enrol('ZZZZCCCC', '{{p_pa2}}') -> 'status'$q$, 'val:ok', NULL),
      -- no plaintext PIN / token anywhere
      ('POSITIVE CONTROL the scan sees a stored value (an order code)', 'pg', '', $q$SELECT to_jsonb(EXISTS (SELECT 1 FROM (SELECT to_jsonb(t) j FROM public.eatery_orders t) x, LATERAL jsonb_each_text(x.j) e WHERE e.value = 'ZZZZ2222'))$q$, 'val:true', NULL),
      ('no table holds a PIN or a device token in the clear', 'pg',   '',    $q$SELECT to_jsonb(EXISTS (SELECT 1 FROM (SELECT to_jsonb(t) j FROM private.eatery_partner_pins t UNION ALL SELECT to_jsonb(t) FROM private.eatery_partner_devices t UNION ALL SELECT to_jsonb(t) FROM private.eatery_pin_attempts t UNION ALL SELECT to_jsonb(t) FROM private.eatery_worker_key_hashes t UNION ALL SELECT to_jsonb(t) FROM public.eatery_orders t UNION ALL SELECT to_jsonb(t) FROM public.eatery_order_events t UNION ALL SELECT to_jsonb(t) FROM public.push_log t) x, LATERAL jsonb_each_text(x.j) e WHERE e.value IN ('{{p_pa}}', '{{p_pa2}}', '{{p_pb}}', '{{p_pt}}', '{{t_d1}}', '{{t_d2}}', '{{t_dt}}', '{{t_d1}}')))$q$, 'val:false', NULL),
      -- the admin function and the internals
      ('admin RPC: a signed-in non-admin is refused',         'user:94', '',  $q$SELECT public.admin_set_eatery_partner_pin('{{wa}}', 'partner')$q$, 'err:forbidden', NULL),
      ('admin RPC: a guest is refused',                       'guest:95', '', $q$SELECT public.admin_set_eatery_partner_pin('{{wa}}', 'partner')$q$, 'err:forbidden', NULL),
      ('admin RPC: anon has no EXECUTE',                      'anon', '',     $q$SELECT public.admin_set_eatery_partner_pin('{{wa}}', 'partner')$q$, 'state:42501', NULL),
      ('refusals issued no PIN (still 3 rows for wa, wb, test)', 'pg', '',   $q$SELECT to_jsonb(count(*)) FROM private.eatery_partner_pins WHERE partner_id IN ('{{wa}}', '{{wb}}') OR scope = 'test'$q$, 'val:3', NULL),
      ('core: test scope with a partner refused',             'pg',   '',    $q$SELECT public.eatery_pin_issue('{{wa}}', 'test')$q$, 'err:invalid_partner', NULL),
      ('core: partner scope without a partner refused',       'pg',   '',    $q$SELECT public.eatery_pin_issue(NULL, 'partner')$q$, 'err:invalid_partner', NULL),
      ('core: unknown partner refused',                       'pg',   '',    $q$SELECT public.eatery_pin_issue('00000000-0000-4000-8000-0000000000ee', 'partner')$q$, 'err:invalid_partner', NULL),
      ('core: unknown scope refused',                         'pg',   '',    $q$SELECT public.eatery_pin_issue('{{wa}}', 'x')$q$, 'err:invalid_scope', NULL),
      ('the PIN generator gives six digits',                  'pg',   '',    $q$SELECT to_jsonb(public.eatery_pin_generate() ~ '^[0-9]{6}$')$q$, 'val:true', NULL),
      ('private tables: authenticated denied (pins)',         'user:94', '',  $q$SELECT to_jsonb(count(*)) FROM private.eatery_partner_pins$q$, 'state:42501', NULL),
      ('private tables: authenticated denied (devices)',      'user:94', '',  $q$SELECT to_jsonb(count(*)) FROM private.eatery_partner_devices$q$, 'state:42501', NULL),
      ('private tables: anon denied (attempts)',              'anon', '',     $q$SELECT to_jsonb(count(*)) FROM private.eatery_pin_attempts$q$, 'state:42501', NULL),
      ('private tables: guest denied (key hashes)',           'guest:95', '', $q$SELECT to_jsonb(count(*)) FROM private.eatery_worker_key_hashes$q$, 'state:42501', NULL),
      ('CONTROL postgres reads the pins',                     'pg',   '',    $q$SELECT to_jsonb(count(*) = 3) FROM private.eatery_partner_pins WHERE partner_id IN ('{{wa}}', '{{wb}}') OR scope = 'test'$q$, 'val:true', NULL),
      ('helpers: worker_key_ok denied to authenticated',      'user:94', '',  $q$SELECT public.eatery_worker_key_ok()$q$, 'state:42501', NULL),
      ('helpers: pin_generate denied to authenticated',       'user:94', '',  $q$SELECT public.eatery_pin_generate()$q$, 'state:42501', NULL),
      ('helpers: pin_issue denied to authenticated',          'user:94', '',  $q$SELECT public.eatery_pin_issue('{{wa}}', 'partner')$q$, 'state:42501', NULL),
      ('helpers: device_id denied to anon',                   'anon', '',     $q$SELECT public.eatery_order_device_id('{{wa}}', false, 'x')$q$, 'state:42501', NULL),
      ('helpers: push_text denied to anon',                   'anon', '',     $q$SELECT public.eatery_order_push_text('Turkish', 'ready', NULL)$q$, 'state:42501', NULL),
      ('CONTROL postgres can call push_text',                 'pg',   '',    $q$SELECT to_jsonb(public.eatery_order_push_text('Turkish', 'ready', NULL))$q$, 'val:Siparişin hazır, gelip alabilirsin.', NULL),
      ('CONTROL the worker key is recognised for the key header', 'anon', 'key', $q$SELECT to_jsonb(public.eatery_partner_enrol('ZZZZ2224', '000000') ->> 'status' IS DISTINCT FROM 'forbidden')$q$, 'val:true', NULL)
    ) AS x(label, who, hdr, sql, want, save) LOOP
      v_sql := s.sql;
      FOR k IN SELECT key, value FROM jsonb_each_text(v_ids) LOOP
        v_sql := replace(v_sql, '{{' || k.key || '}}', k.value);
      END LOOP;
      v_role := CASE WHEN s.who = 'anon' THEN 'anon' WHEN s.who = 'pg' THEN NULL ELSE 'authenticated' END;
      v_claims := CASE
        WHEN s.who IN ('anon', 'pg') THEN ''
        WHEN s.who LIKE 'guest:%' THEN json_build_object('sub', '00000000-0000-4000-8000-' || lpad(split_part(s.who, ':', 2), 12, '0'), 'role', 'authenticated', 'is_anonymous', true)::text
        ELSE json_build_object('sub', '00000000-0000-4000-8000-' || lpad(split_part(s.who, ':', 2), 12, '0'), 'role', 'authenticated')::text END;
      v_hdr := CASE s.hdr WHEN 'key' THEN json_build_object('x-ada-worker-key', c_key)::text
                          WHEN 'bad' THEN json_build_object('x-ada-worker-key', 'zz-wrong-key')::text ELSE '' END;
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
      IF s.save IS NOT NULL THEN
        v_ids := v_ids || jsonb_strip_nulls(jsonb_build_object('p_' || s.save, v_res ->> 'pin', 't_' || s.save, v_res ->> 'device_token'));
      END IF;
      v_cnt := v_cnt + 1;
      v_report := v_report || format(E'\n  %-72s %-9s -> %s', s.label, s.who, v_got);
    END LOOP;

    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'zz-sentinel';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'zz-sentinel' THEN RAISE; END IF;
  END;
  RESET ROLE;

  IF v_pre IS DISTINCT FROM jsonb_build_object(
       'orders',   (SELECT count(*) FROM public.eatery_orders),
       'partners', (SELECT count(*) FROM public.eatery_partners),
       'events',   (SELECT count(*) FROM public.eatery_order_events),
       'keys',     (SELECT count(*) FROM private.eatery_worker_key_hashes),
       'pins',     (SELECT count(*) FROM private.eatery_partner_pins),
       'devices',  (SELECT count(*) FROM private.eatery_partner_devices),
       'attempts', (SELECT count(*) FROM private.eatery_pin_attempts),
       'log',      (SELECT count(*) FROM public.push_log))
     OR EXISTS (SELECT 1 FROM public.eatery_partners WHERE slug LIKE 'zz-os-%') THEN
    RAISE EXCEPTION 'probe rows survived the sentinel';
  END IF;
  RAISE NOTICE 'order status part 2 probes (all as stated, % steps); nothing survived:%', v_cnt, v_report;
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
VALUES ('20261194_eatery_order_status_partner.sql', '7f189edd2368a2fce716aecf99ef7822aef677c0f69bbf980af4a857c45b07c8')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';
