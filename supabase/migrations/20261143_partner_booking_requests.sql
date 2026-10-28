-- ═══════════════════════════════════════════════════════════════════════════
-- 20261143 — partner_booking_requests: anonymous log of "North Houses booking request" taps
-- ═══════════════════════════════════════════════════════════════════════════
--
-- SCHEMA ONLY, no data. Prototype for the North Houses partner: the app opens a WhatsApp message with the
-- guest's request and, at the same moment, records WHAT was asked for (which apartment, which dates, how
-- many guests) so the partner's demand can be counted. It records NOBODY: no name, phone, email, user id,
-- device id or any other identifier column exists. Those travel only inside the WhatsApp text.
--
-- ─── WHO CAN READ / WRITE ───────────────────────────────────────────────────
--   INSERT  Any authenticated session, guests included (signInAnonymously() sessions are `authenticated`).
--           True `anon` (no session) has NO privilege and cannot insert. A client may set exactly five
--           columns (partner, apartment, check_in, check_out, guests); `id` and `created_at` are not in the
--           column-level INSERT grant, so nobody can pick a key or backdate a row. The RLS WITH CHECK and the
--           table CHECKs both confine a row to the agreed vocabulary, date order, stay length and guest count.
--   SELECT  ADMINS ONLY (public.is_admin()). A guest, customer or provider selecting gets zero rows; there is
--           no public SELECT policy at all. Consequence for the client: insert WITHOUT RETURNING
--           (supabase-js `.insert(row)` with no `.select()`), because RETURNING evaluates the SELECT policy
--           and would fail for a non-admin.
--   UPDATE  NOBODY (no permissive policy, no UPDATE grant, plus a RESTRICTIVE USING(false) veto).
--   DELETE  NOBODY from the app (same three layers). postgres and service_role bypass RLS: purging spam is
--           done from the SQL editor / a workflow.
--
-- ─── ABUSE (mirrors contact_events, 20260910) ───────────────────────────────
--   Any signed-in guest can insert, so the table is spammable by construction. As in contact_events there is
--   NO per-user rate limit, because that would need a user column, which the contract forbids; and NO IP
--   (a device-linked identifier). The defence is that a bogus row cannot do anything except inflate a
--   count the partner reads with a grain of salt, and the CHECKs bound what a row can say. If it is ever
--   abused, the fix is an Edge Function in front of the insert. Unlike contact_events there is no
--   deduped reporting view yet and no retention job: both are deliberately left out of this prototype.
--
-- ─── TWO LAYERS, SAME RULES ─────────────────────────────────────────────────
--   The table CHECKs and the INSERT policy's WITH CHECK state the same bounds (partner, apartment, out > in,
--   stay <= 90 nights, guests 1..12). For a client insert the policy is evaluated first, so a bad row from
--   `authenticated` is refused with 42501; the CHECKs are the layer that holds for every other writer
--   (service_role bypasses RLS, not CHECKs) and raise 23514. No date is compared with today: CURRENT_DATE
--   is STABLE and cannot live in a CHECK (same reason MIN_SIGNUP_AGE is a trigger), and a time-relative
--   policy would reject a legitimate request on a clock/time-zone edge. Past-dated rows are accepted.
--
-- Apply: gh workflow run supabase-migrate -f file=20261143_partner_booking_requests.sql (dry), then -f apply=true
-- (Berke approves production-db). Creates a table ⇒ ends with NOTIFY pgrst (after COMMIT and RESET ROLE).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.partner_booking_requests (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  partner    text        NOT NULL,
  apartment  text        NOT NULL,
  check_in   date        NOT NULL,
  check_out  date        NOT NULL,
  guests     smallint    NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_booking_requests_pkey PRIMARY KEY (id),
  CONSTRAINT partner_booking_requests_partner_check CHECK (partner IN ('north_houses')),
  CONSTRAINT partner_booking_requests_apartment_check CHECK (apartment IN (
    'yasemin-2plus1',
    'yasemin-2plus1-plus',
    'lefkosa-gunluk-kiralik-studio-daire',
    'lefkosa-gunluk-kiralik-studio-daire-dereboyu',
    'lefkosa-gunluk-kiralik-daire-2-yatak-odali',
    'lefkosa-gunluk-kiralik-daire-iki-yatak-odali',
    'north-houses-aladag-sk-kucuk-kaymakli-lefkosa')),
  CONSTRAINT partner_booking_requests_dates_check CHECK (check_out > check_in),
  CONSTRAINT partner_booking_requests_stay_check CHECK (check_out - check_in <= 90),
  CONSTRAINT partner_booking_requests_guests_check CHECK (guests BETWEEN 1 AND 12)
);

COMMENT ON TABLE public.partner_booking_requests IS
  'One row per North Houses booking-request tap: apartment, dates, guest count. NO identifier of any kind (no name, phone, email, user or device id): those go only into the WhatsApp text. Authenticated (guests included) may INSERT five columns; only admins may SELECT; nobody may UPDATE or DELETE from the app. 20261143.';

ALTER TABLE public.partner_booking_requests ENABLE ROW LEVEL SECURITY;

-- Supabase default privileges hand anon/authenticated ALL on a new public table; this REVOKE is what makes
-- the rest mean anything. Column-level INSERT keeps id and created_at unforgeable (no trigger needed).
REVOKE ALL ON TABLE public.partner_booking_requests FROM PUBLIC, anon, authenticated;
GRANT INSERT (partner, apartment, check_in, check_out, guests) ON public.partner_booking_requests TO authenticated;
GRANT SELECT ON public.partner_booking_requests TO authenticated;

DROP POLICY IF EXISTS "pbr_insert_authenticated" ON public.partner_booking_requests;
CREATE POLICY "pbr_insert_authenticated" ON public.partner_booking_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    partner = 'north_houses'
    AND apartment IN ('yasemin-2plus1','yasemin-2plus1-plus','lefkosa-gunluk-kiralik-studio-daire','lefkosa-gunluk-kiralik-studio-daire-dereboyu','lefkosa-gunluk-kiralik-daire-2-yatak-odali','lefkosa-gunluk-kiralik-daire-iki-yatak-odali','north-houses-aladag-sk-kucuk-kaymakli-lefkosa')
    AND check_out > check_in
    AND check_out - check_in <= 90
    AND guests BETWEEN 1 AND 12
  );

DROP POLICY IF EXISTS "pbr_select_admin" ON public.partner_booking_requests;
CREATE POLICY "pbr_select_admin" ON public.partner_booking_requests
  FOR SELECT TO authenticated
  USING ((select public.is_admin()));

DROP POLICY IF EXISTS "pbr_no_update" ON public.partner_booking_requests;
CREATE POLICY "pbr_no_update" ON public.partner_booking_requests
  AS RESTRICTIVE FOR UPDATE TO public
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "pbr_no_delete" ON public.partner_booking_requests;
CREATE POLICY "pbr_no_delete" ON public.partner_booking_requests
  AS RESTRICTIVE FOR DELETE TO public
  USING (false);

-- ─── Assertions + probes (inside the transaction; a failure rolls the file back) ─
DO $$
DECLARE
  v_t        regclass := to_regclass('public.partner_booking_requests');
  v_n        int;
  v_names    text;
  v_cols     text;
  v_role     text;
  v_priv     text;
  v_before   int;
  v_seen     int;
  v_seen_pg  int;
  v_auth_sel int := -1;
  v_anon_ins text := 'unset';
  v_upd      text := 'unset';
  v_del      text := 'unset';
  v_sub      text := '00000000-0000-0000-0000-00000000f143';
  v_out      text;
  v_bad      text[] := ARRAY[]::text[];
  v_states   text[] := ARRAY[]::text[];
  v_case     record;
BEGIN
  IF v_t IS NULL THEN RAISE EXCEPTION 'partner_booking_requests is not visible to this block'; END IF;
  IF (SELECT relowner::regrole::text FROM pg_class WHERE oid = v_t) IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'partner_booking_requests is owned by %, expected postgres', (SELECT relowner::regrole::text FROM pg_class WHERE oid = v_t);
  END IF;
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = v_t) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'RLS is not enabled on partner_booking_requests';
  END IF;

  -- Columns: exactly these seven, no identifier column.
  SELECT count(*), string_agg(column_name || ':' || data_type, ', ' ORDER BY ordinal_position) INTO v_n, v_cols
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'partner_booking_requests';
  IF v_n IS DISTINCT FROM 7 THEN RAISE EXCEPTION 'partner_booking_requests has % columns (want 7): %', v_n, v_cols; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'partner_booking_requests'
              AND column_name IN ('user_id','device_id','session_id','install_id','ip','ip_address','name','full_name','phone','email','dedup_key')) THEN
    RAISE EXCEPTION 'partner_booking_requests carries an identifier column: %', v_cols;
  END IF;

  -- Constraints: exactly 6 (pkey + 5 CHECK), printed. contype filter: PG 18 also lists NOT NULL in pg_constraint, older majors do not.
  SELECT count(*), string_agg(conname, ', ' ORDER BY conname) INTO v_n, v_names
    FROM pg_constraint WHERE conrelid = v_t AND contype IN ('p','c');
  IF v_n IS DISTINCT FROM 6 THEN RAISE EXCEPTION 'partner_booking_requests has % constraints (want 6): %', v_n, v_names; END IF;

  -- FULL policy set on the table: exactly these four, none anything else.
  SELECT count(*), string_agg(policyname || ':' || cmd || ':' || permissive, ', ' ORDER BY policyname)
    INTO v_n, v_names FROM pg_policies WHERE schemaname = 'public' AND tablename = 'partner_booking_requests';
  IF v_n IS DISTINCT FROM 4 THEN RAISE EXCEPTION 'partner_booking_requests must carry exactly 4 policies; found %: %', v_n, v_names; END IF;
  IF (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'partner_booking_requests')
     IS DISTINCT FROM ARRAY['pbr_insert_authenticated','pbr_no_delete','pbr_no_update','pbr_select_admin'] THEN
    RAISE EXCEPTION 'partner_booking_requests policy names unexpected: %', v_names;
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'partner_booking_requests' AND permissive = 'PERMISSIVE') IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'expected exactly 2 PERMISSIVE policies (insert, select-admin): %', v_names;
  END IF;
  RAISE NOTICE 'partner_booking_requests policies (4): %', v_names;

  -- Privileges. anon: nothing at table or column level. authenticated: INSERT on exactly the five columns,
  -- SELECT, and no UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER. Positive controls beside every denial.
  FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    IF has_table_privilege('anon', v_t, v_priv) THEN RAISE EXCEPTION 'anon holds % on partner_booking_requests', v_priv; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = v_t AND a.attnum > 0 AND NOT a.attisdropped
              AND has_column_privilege('anon', a.attrelid, a.attnum, 'SELECT,INSERT,UPDATE,REFERENCES')) THEN
    RAISE EXCEPTION 'anon holds a column privilege on partner_booking_requests';
  END IF;
  FOREACH v_priv IN ARRAY ARRAY['UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    IF has_table_privilege('authenticated', v_t, v_priv) THEN RAISE EXCEPTION 'authenticated holds % on partner_booking_requests', v_priv; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = v_t AND a.attnum > 0 AND NOT a.attisdropped
              AND has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE,REFERENCES')) THEN
    RAISE EXCEPTION 'authenticated holds a column UPDATE/REFERENCES privilege on partner_booking_requests';
  END IF;
  IF (SELECT string_agg(a.attname, ',' ORDER BY a.attname) FROM pg_attribute a
       WHERE a.attrelid = v_t AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('authenticated', a.attrelid, a.attnum, 'INSERT'))
     IS DISTINCT FROM 'apartment,check_in,check_out,guests,partner' THEN
    RAISE EXCEPTION 'authenticated INSERT columns are not exactly partner,apartment,check_in,check_out,guests: %',
      (SELECT string_agg(a.attname, ',' ORDER BY a.attname) FROM pg_attribute a WHERE a.attrelid = v_t AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('authenticated', a.attrelid, a.attnum, 'INSERT'));
  END IF;
  IF NOT has_table_privilege('authenticated', v_t, 'SELECT') THEN RAISE EXCEPTION 'authenticated lost SELECT (the admin screen could not read)'; END IF;
  IF NOT has_column_privilege('authenticated', v_t, 'partner', 'INSERT') THEN RAISE EXCEPTION 'authenticated cannot INSERT partner (positive control)'; END IF;
  IF has_column_privilege('authenticated', v_t, 'created_at', 'INSERT') OR has_column_privilege('authenticated', v_t, 'id', 'INSERT') THEN
    RAISE EXCEPTION 'authenticated can set id or created_at';
  END IF;

  -- ── Behaviour, as the roles the claim is about ──
  SELECT count(*) INTO v_before FROM public.partner_booking_requests;

  -- anon: denied (no session, no privilege)
  BEGIN
    SET LOCAL ROLE anon;
    INSERT INTO public.partner_booking_requests (partner, apartment, check_in, check_out, guests)
      VALUES ('north_houses', 'yasemin-2plus1', current_date + 30, current_date + 33, 2);
    v_anon_ins := 'ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN v_anon_ins := 'denied';
  END;
  RESET ROLE;

  -- authenticated guest (is_anonymous = true): positive control, then bad rows
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_sub, 'role', 'authenticated', 'is_anonymous', true)::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO public.partner_booking_requests (partner, apartment, check_in, check_out, guests)
    VALUES ('north_houses', 'yasemin-2plus1', current_date + 30, current_date + 33, 7);   -- probe: guests = 7
  SELECT count(*) INTO v_auth_sel FROM public.partner_booking_requests;                  -- must be 0 (no read policy for non-admin)

  -- bad rows as `authenticated`: the INSERT policy's WITH CHECK refuses each (42501), before the table CHECKs are reached.
  FOR v_case IN
    SELECT * FROM (VALUES
      ('out = in',          'north_houses','yasemin-2plus1', 30, 30, 2),
      ('out < in',          'north_houses','yasemin-2plus1', 30, 29, 2),
      ('guests 0',          'north_houses','yasemin-2plus1', 30, 33, 0),
      ('guests 13',         'north_houses','yasemin-2plus1', 30, 33, 13),
      ('unknown partner',   'other_partner','yasemin-2plus1', 30, 33, 2),
      ('unknown apartment', 'north_houses','not-a-real-slug', 30, 33, 2),
      ('stay 91 nights',    'north_houses','yasemin-2plus1', 30, 121, 2)
    ) AS t(label, p, a, di, do_, g)
  LOOP
    BEGIN
      INSERT INTO public.partner_booking_requests (partner, apartment, check_in, check_out, guests)
        VALUES (v_case.p, v_case.a, current_date + v_case.di, current_date + v_case.do_, v_case.g);
      v_bad := v_bad || (v_case.label || ':ACCEPTED');
    EXCEPTION WHEN insufficient_privilege THEN v_states := v_states || (v_case.label || '=policy 42501');
              WHEN check_violation THEN v_bad := v_bad || (v_case.label || ':reached CHECK, policy let it through');
    END;
  END LOOP;

  -- id / created_at cannot be set by the client
  BEGIN
    INSERT INTO public.partner_booking_requests (created_at, partner, apartment, check_in, check_out, guests)
      VALUES (now() - interval '30 days', 'north_houses', 'yasemin-2plus1', current_date + 30, current_date + 33, 3);
    v_bad := v_bad || 'backdated created_at:ACCEPTED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- UPDATE / DELETE denied
  BEGIN
    UPDATE public.partner_booking_requests SET guests = 1;
    v_upd := 'ran';
  EXCEPTION WHEN insufficient_privilege THEN v_upd := 'denied';
  END;
  BEGIN
    DELETE FROM public.partner_booking_requests;
    v_del := 'ran';
  EXCEPTION WHEN insufficient_privilege THEN v_del := 'denied';
  END;
  RESET ROLE;

  -- the table CHECKs on their own: as postgres (RLS bypassed) every bad row must raise check_violation (23514)
  FOR v_case IN
    SELECT * FROM (VALUES
      ('out = in',          'north_houses','yasemin-2plus1', 30, 30, 2),
      ('out < in',          'north_houses','yasemin-2plus1', 30, 29, 2),
      ('guests 0',          'north_houses','yasemin-2plus1', 30, 33, 0),
      ('guests 13',         'north_houses','yasemin-2plus1', 30, 33, 13),
      ('unknown partner',   'other_partner','yasemin-2plus1', 30, 33, 2),
      ('unknown apartment', 'north_houses','not-a-real-slug', 30, 33, 2),
      ('stay 91 nights',    'north_houses','yasemin-2plus1', 30, 121, 2)
    ) AS t(label, p, a, di, do_, g)
  LOOP
    BEGIN
      INSERT INTO public.partner_booking_requests (partner, apartment, check_in, check_out, guests)
        VALUES (v_case.p, v_case.a, current_date + v_case.di, current_date + v_case.do_, v_case.g);
      v_bad := v_bad || (v_case.label || ':CHECK layer ACCEPTED');
    EXCEPTION WHEN check_violation THEN v_states := v_states || (v_case.label || '=CHECK 23514');
    END;
  END LOOP;
  -- positive control for the CHECK probe: a good row inserts as postgres too, and is removed again below
  INSERT INTO public.partner_booking_requests (partner, apartment, check_in, check_out, guests)
    VALUES ('north_houses', 'yasemin-2plus1', current_date + 30, current_date + 120, 8);   -- exactly 90 nights, probe: guests = 8

  -- postgres sees exactly the one positive-control row; then it is deleted so the file is re-runnable
  SELECT count(*) INTO v_seen FROM public.partner_booking_requests WHERE guests = 7 AND apartment = 'yasemin-2plus1' AND created_at = now();
  SELECT count(*) INTO v_seen_pg FROM public.partner_booking_requests WHERE guests = 8 AND apartment = 'yasemin-2plus1' AND created_at = now();
  DELETE FROM public.partner_booking_requests WHERE guests IN (7, 8) AND apartment = 'yasemin-2plus1' AND created_at = now();

  IF v_anon_ins IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'anon INSERT was %', v_anon_ins; END IF;
  IF v_seen     IS DISTINCT FROM 1        THEN RAISE EXCEPTION 'authenticated guest INSERT (positive control): postgres sees % probe rows, expected 1', v_seen; END IF;
  IF v_seen_pg  IS DISTINCT FROM 1        THEN RAISE EXCEPTION 'postgres INSERT of a good 90-night row (positive control for the CHECK probe): % rows, expected 1', v_seen_pg; END IF;
  IF v_auth_sel IS DISTINCT FROM 0        THEN RAISE EXCEPTION 'authenticated non-admin SELECT returned % rows, expected 0', v_auth_sel; END IF;
  IF array_length(v_bad, 1) IS NOT NULL   THEN RAISE EXCEPTION 'bad rows: %', v_bad; END IF;
  IF coalesce(array_length(v_states, 1), 0) IS DISTINCT FROM 14 THEN RAISE EXCEPTION 'expected 14 rejections (7 policy + 7 CHECK), got %: %', coalesce(array_length(v_states, 1), 0), v_states; END IF;
  RAISE NOTICE 'rejections by layer: %', v_states;
  IF v_upd IS DISTINCT FROM 'denied'      THEN RAISE EXCEPTION 'authenticated UPDATE was %', v_upd; END IF;
  IF v_del IS DISTINCT FROM 'denied'      THEN RAISE EXCEPTION 'authenticated DELETE was %', v_del; END IF;
  IF (SELECT count(*) FROM public.partner_booking_requests) IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'probe rows leaked into partner_booking_requests';
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
VALUES ('20261143_partner_booking_requests.sql', '082a4ad8dace3366bfcb77a243bd1e12bc4687bf0e9bbabd11b13ac2b1464f7f')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;
NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   verify_schema QUERY 1: the 20261143_partner_booking_requests rows must read OK.
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   DROP TABLE public.partner_booking_requests;  (and delete its schema_migrations_applied row)
