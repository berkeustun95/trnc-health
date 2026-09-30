-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE for 20261066 — READ-ONLY. Run BEFORE applying the migration.
-- One statement, creates nothing, writes nothing. The report is delivered as an ERROR
-- (the only output this SQL editor reliably shows): a red result is normal. Read the
-- FIRST LINE — "READY" or "NOT READY" — then the detail.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_rep   text := '';
  v_ok    boolean := true;
  v_n     int  := (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.prosrc ~* 'insert\s+into\s+(public\.)?notifications\M');
  v_names text := (SELECT string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ' ORDER BY p.proname)
                 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.prosrc ~* 'insert\s+into\s+(public\.)?notifications\M');
  v_oid   oid;
  v_md5   text;
  r       record;
BEGIN
  v_rep := v_rep || E'\nserver: ' || version()
                 || E'\nlocale: collate=' || (SELECT datcollate FROM pg_database WHERE datname = current_database())
                 || ' ctype=' || (SELECT datctype FROM pg_database WHERE datname = current_database())
                 || E'\nlower() test: ' || lower('Дежурная Εφημερεύον NÖBETÇİ') || '  (expect all lower-case)';
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='notifications' AND column_name='type') THEN
    v_rep := v_rep || E'\nnotifications.type ALREADY EXISTS';
  ELSE
    v_rep := v_rep || E'\nnotifications.type absent (expected)';
  END IF;

  v_rep := v_rep || E'\ntriggers on notifications: ' || coalesce((SELECT string_agg(tgname, ', ') FROM pg_trigger
                 WHERE tgrelid = 'public.notifications'::regclass AND NOT tgisinternal), 'none');
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.notifications'::regclass AND NOT tgisinternal) THEN
    v_ok := false; v_rep := v_rep || '  ← the migration refuses to run its CHECK test with a trigger present';
  END IF;
  v_rep := v_rep || E'\nwriters found (' || v_n || '): ' || coalesce(v_names, '—');
  IF v_n IS DISTINCT FROM 6 THEN v_ok := false; v_rep := v_rep || '  ← EXPECTED 6'; END IF;

  FOR r IN SELECT * FROM (VALUES
      ('insert_notification', 'uuid, text, text', '17c96b09dc11bd1843fc4bcd80f7ad55', 'cfa50ccdfc1db219b6626b212f8c6baf', 'admin_message'),
      ('notify_facility_owner', 'uuid, text', '2b587c63289b98cfda60e43bb619f412', 'c966f2a4c37938eb6c2d7fd1ca313538', 'question'),
      ('notify_admins', 'text, uuid', '4ad3d6f4e156d77cf34d1e08ff2e8682', 'd2d83c89a69568524e5a43ff8592dbcd', 'admin_alert'),
      ('notify_module_waitlist', 'text', 'a01c7354cf9afec8dee66b85c52ca3f3', '49f87d365afa6b3cc1f367ea120961bc', 'waitlist'),
      ('notify_new_message', 'uuid', '0502ad280b4851ed274dc58c90c44778', '9daa04e8ad5be2dd4c66ba4616bc2a32', 'message'),
      ('process_featured_expiring', '', 'fb6690a8b7bdbed61633d90bc8083343', '586b03b9b889cef47afe38e8a54cc62c', 'featured')
    ) AS t(fn, args, md5_old, md5_new, typ)
  LOOP
    v_oid := to_regprocedure('public.' || r.fn || '(' || r.args || ')');
    IF v_oid IS NULL THEN
      v_ok := false; v_rep := v_rep || E'\n  ' || r.fn || ': MISSING';
      CONTINUE;
    END IF;
    SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = v_oid;
    v_rep := v_rep || E'\n  ' || r.fn || ': ' ||
      CASE WHEN v_md5 = r.md5_old THEN 'matches its source file'
           WHEN v_md5 = r.md5_new THEN 'already migrated'
           ELSE 'DRIFTED (live md5 ' || v_md5 || ', file ' || r.md5_old || ')' END;
    IF v_md5 IS DISTINCT FROM r.md5_old AND v_md5 IS DISTINCT FROM r.md5_new THEN v_ok := false; END IF;
  END LOOP;

  v_rep := v_rep || E'\nrows: ' || (SELECT count(*) FROM public.notifications)
                 || '  would become duty: ' || (SELECT count(*) FROM public.notifications WHERE position('duty' in lower(title)) > 0 OR position('nöbetçi' in lower(title)) > 0 OR position('مناوبة' in lower(title)) > 0 OR position('дежурн' in lower(title)) > 0 OR position('εφημερεύ' in lower(title)) > 0 OR position('garde' in lower(title)) > 0 OR position('guardia' in lower(title)) > 0 OR position('notdienst' in lower(title)) > 0 OR position('نوبتی' in lower(title)) > 0)
                 || '  💊-titled: ' || (SELECT count(*) FROM public.notifications WHERE title LIKE '💊%')
                 || '  💊 but no keyword: ' || (SELECT count(*) FROM public.notifications WHERE title LIKE '💊%' AND NOT (position('duty' in lower(title)) > 0 OR position('nöbetçi' in lower(title)) > 0 OR position('مناوبة' in lower(title)) > 0 OR position('дежурн' in lower(title)) > 0 OR position('εφημερεύ' in lower(title)) > 0 OR position('garde' in lower(title)) > 0 OR position('guardia' in lower(title)) > 0 OR position('notdienst' in lower(title)) > 0 OR position('نوبتی' in lower(title)) > 0))
                 || '  keyword but no 💊: ' || (SELECT count(*) FROM public.notifications WHERE NOT (title LIKE '💊%') AND (position('duty' in lower(title)) > 0 OR position('nöbetçi' in lower(title)) > 0 OR position('مناوبة' in lower(title)) > 0 OR position('дежурн' in lower(title)) > 0 OR position('εφημερεύ' in lower(title)) > 0 OR position('garde' in lower(title)) > 0 OR position('guardia' in lower(title)) > 0 OR position('notdienst' in lower(title)) > 0 OR position('نوبتی' in lower(title)) > 0));
  IF (SELECT count(*) FROM public.notifications WHERE title LIKE '💊%' AND NOT (position('duty' in lower(title)) > 0 OR position('nöbetçi' in lower(title)) > 0 OR position('مناوبة' in lower(title)) > 0 OR position('дежурн' in lower(title)) > 0 OR position('εφημερεύ' in lower(title)) > 0 OR position('garde' in lower(title)) > 0 OR position('guardia' in lower(title)) > 0 OR position('notdienst' in lower(title)) > 0 OR position('نوبتی' in lower(title)) > 0)) > 0 THEN v_ok := false; END IF;
  v_rep := v_rep || E'\nper keyword:';
  v_rep := v_rep || E'\n    duty: ' || (SELECT count(*) FROM public.notifications WHERE position('duty' in lower(title)) > 0)
           || '  e.g. ' || coalesce((SELECT title FROM public.notifications WHERE position('duty' in lower(title)) > 0 ORDER BY created_at DESC LIMIT 1), '—');
  v_rep := v_rep || E'\n    nöbetçi: ' || (SELECT count(*) FROM public.notifications WHERE position('nöbetçi' in lower(title)) > 0)
           || '  e.g. ' || coalesce((SELECT title FROM public.notifications WHERE position('nöbetçi' in lower(title)) > 0 ORDER BY created_at DESC LIMIT 1), '—');
  v_rep := v_rep || E'\n    مناوبة: ' || (SELECT count(*) FROM public.notifications WHERE position('مناوبة' in lower(title)) > 0)
           || '  e.g. ' || coalesce((SELECT title FROM public.notifications WHERE position('مناوبة' in lower(title)) > 0 ORDER BY created_at DESC LIMIT 1), '—');
  v_rep := v_rep || E'\n    дежурн: ' || (SELECT count(*) FROM public.notifications WHERE position('дежурн' in lower(title)) > 0)
           || '  e.g. ' || coalesce((SELECT title FROM public.notifications WHERE position('дежурн' in lower(title)) > 0 ORDER BY created_at DESC LIMIT 1), '—');
  v_rep := v_rep || E'\n    εφημερεύ: ' || (SELECT count(*) FROM public.notifications WHERE position('εφημερεύ' in lower(title)) > 0)
           || '  e.g. ' || coalesce((SELECT title FROM public.notifications WHERE position('εφημερεύ' in lower(title)) > 0 ORDER BY created_at DESC LIMIT 1), '—');
  v_rep := v_rep || E'\n    garde: ' || (SELECT count(*) FROM public.notifications WHERE position('garde' in lower(title)) > 0)
           || '  e.g. ' || coalesce((SELECT title FROM public.notifications WHERE position('garde' in lower(title)) > 0 ORDER BY created_at DESC LIMIT 1), '—');
  v_rep := v_rep || E'\n    guardia: ' || (SELECT count(*) FROM public.notifications WHERE position('guardia' in lower(title)) > 0)
           || '  e.g. ' || coalesce((SELECT title FROM public.notifications WHERE position('guardia' in lower(title)) > 0 ORDER BY created_at DESC LIMIT 1), '—');
  v_rep := v_rep || E'\n    notdienst: ' || (SELECT count(*) FROM public.notifications WHERE position('notdienst' in lower(title)) > 0)
           || '  e.g. ' || coalesce((SELECT title FROM public.notifications WHERE position('notdienst' in lower(title)) > 0 ORDER BY created_at DESC LIMIT 1), '—');
  v_rep := v_rep || E'\n    نوبتی: ' || (SELECT count(*) FROM public.notifications WHERE position('نوبتی' in lower(title)) > 0)
           || '  e.g. ' || coalesce((SELECT title FROM public.notifications WHERE position('نوبتی' in lower(title)) > 0 ORDER BY created_at DESC LIMIT 1), '—');
  v_rep := v_rep || E'\nkeyword-but-no-💊 samples (these become duty too): ' || coalesce((SELECT string_agg(DISTINCT title, ' | ')
                 FROM (SELECT title FROM public.notifications WHERE NOT (title LIKE '💊%') AND (position('duty' in lower(title)) > 0 OR position('nöbetçi' in lower(title)) > 0 OR position('مناوبة' in lower(title)) > 0 OR position('дежурн' in lower(title)) > 0 OR position('εφημερεύ' in lower(title)) > 0 OR position('garde' in lower(title)) > 0 OR position('guardia' in lower(title)) > 0 OR position('notdienst' in lower(title)) > 0 OR position('نوبتی' in lower(title)) > 0) LIMIT 20) s), '—');

  RAISE EXCEPTION '%', CASE WHEN v_ok THEN 'READY for 20261066' ELSE 'NOT READY for 20261066' END || v_rep;
END $$;
