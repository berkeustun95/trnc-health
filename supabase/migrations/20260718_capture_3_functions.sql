-- ============================================================================
-- CAPTURED FROM LIVE 2026-07-18 — REVIEW BEFORE APPLYING — not yet run
-- Project: trnc-health (ref jeihxnwqytnxtytgkzgf)
-- Source: read-only introspection via Supabase Management API (pg_catalog).
--
-- !!  DO NOT run this against the CURRENT live project — every object below
--     ALREADY EXISTS there; re-running will ERROR or duplicate. These files are
--     for (a) version control / review and (b) rebuilding a FRESH database.
--     See ~/ObsidianVault/10-ada/schema-backfill-report.md for apply order.
-- ============================================================================

-- FILE 3/5 — All functions in schema public, verbatim from
-- pg_get_functiondef (byte-exact). Includes helpers (is_admin, get_my_role,
-- is_anonymous_session, my_provider_facility_ids), guard functions, and the
-- signup handler handle_new_user (its trigger on auth.users is in FILE 4).

-- auto_hide_reported_content()
CREATE OR REPLACE FUNCTION public.auto_hide_reported_content()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count int;
BEGIN
  SELECT count(DISTINCT reporter_id) INTO v_count
  FROM content_reports
  WHERE content_type = NEW.content_type AND content_id = NEW.content_id;

  IF v_count < 3 THEN
    RETURN NEW;
  END IF;

  IF NEW.content_type = 'review' THEN
    UPDATE reviews   SET hidden_at = now(), hidden_reason = 'auto_reports'
      WHERE id = NEW.content_id AND hidden_at IS NULL;
  ELSIF NEW.content_type = 'question' THEN
    UPDATE questions SET hidden_at = now(), hidden_reason = 'auto_reports'
      WHERE id = NEW.content_id AND hidden_at IS NULL;
  ELSIF NEW.content_type = 'answer' THEN
    UPDATE answers   SET hidden_at = now(), hidden_reason = 'auto_reports'
      WHERE id = NEW.content_id AND hidden_at IS NULL;
  END IF;

  RETURN NEW;
END;
$function$;

-- block_content_author(p_content_type text, p_content_id uuid)
CREATE OR REPLACE FUNCTION public.block_content_author(p_content_type text, p_content_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_author uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_content_type = 'review' THEN
    SELECT customer_id INTO v_author FROM reviews WHERE id = p_content_id;
  ELSE
    -- Questions/answers are private threads; blocking there is meaningless.
    RAISE EXCEPTION 'blocking is only supported for reviews';
  END IF;

  IF v_author IS NULL THEN
    RAISE EXCEPTION 'content not found';
  END IF;

  IF v_author = auth.uid() THEN
    RAISE EXCEPTION 'cannot block yourself';
  END IF;

  INSERT INTO blocks (blocker_id, blocked_id)
  VALUES (auth.uid(), v_author)
  ON CONFLICT DO NOTHING;
END;
$function$;

-- check_pending_appointment_limit()
CREATE OR REPLACE FUNCTION public.check_pending_appointment_limit()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF (
    SELECT COUNT(*) FROM appointments
    WHERE customer_id = NEW.customer_id
      AND status = 'pending'
  ) >= 10 THEN
    RAISE EXCEPTION 'Too many pending appointments. Please wait for existing requests to be reviewed.';
  END IF;
  RETURN NEW;
END;
$function$;

-- check_question_limit()
CREATE OR REPLACE FUNCTION public.check_question_limit()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF (
    SELECT COUNT(*) FROM questions q
    WHERE q.customer_id = NEW.customer_id
      AND q.facility_id = NEW.facility_id
      AND NOT EXISTS (SELECT 1 FROM answers a WHERE a.question_id = q.id)
  ) >= 3 THEN
    RAISE EXCEPTION 'You already have 3 unanswered questions at this facility.';
  END IF;
  RETURN NEW;
END;
$function$;

-- check_report_rate_limit()
CREATE OR REPLACE FUNCTION public.check_report_rate_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF (
    SELECT count(*) FROM content_reports
    WHERE reporter_id = NEW.reporter_id
      AND created_at > now() - interval '24 hours'
  ) >= 20 THEN
    RAISE EXCEPTION 'REPORT_RATE_LIMIT';
  END IF;
  RETURN NEW;
END;
$function$;

-- check_ugc_on_insert()
CREATE OR REPLACE FUNCTION public.check_ugc_on_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_text   text;
  v_banned timestamptz;
BEGIN
  -- Nobody but an admin may create content that is already hidden.
  IF get_my_role() <> 'admin' THEN
    NEW.hidden_at     := NULL;
    NEW.hidden_reason := NULL;
  END IF;

  SELECT ugc_banned_until INTO v_banned FROM profiles WHERE id = auth.uid();
  IF v_banned IS NOT NULL AND v_banned > now() THEN
    RAISE EXCEPTION 'UGC_BANNED';
  END IF;

  v_text := to_jsonb(NEW) ->> TG_ARGV[0];
  IF v_text IS NOT NULL AND contains_blocked_term(v_text) THEN
    RAISE EXCEPTION 'BLOCKED_TERM';
  END IF;

  RETURN NEW;
END;
$function$;

-- contains_blocked_term(p_text text)
CREATE OR REPLACE FUNCTION public.contains_blocked_term(p_text text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM blocked_terms bt
    WHERE lower(p_text) ~ (
      '\m' || regexp_replace(lower(bt.term), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '\M'
    )
  );
$function$;

-- delete_own_account()
CREATE OR REPLACE FUNCTION public.delete_own_account()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_fids uuid[];
BEGIN
  SELECT ARRAY(SELECT id FROM facilities WHERE provider_id = auth.uid())
  INTO v_fids;

  IF array_length(v_fids, 1) > 0 THEN
    DELETE FROM appointments             WHERE facility_id          = ANY(v_fids);
    DELETE FROM reviews                  WHERE facility_id          = ANY(v_fids);
    DELETE FROM questions                WHERE facility_id          = ANY(v_fids);
    DELETE FROM quiz_submissions         WHERE assigned_facility_id = ANY(v_fids);
    DELETE FROM duty_schedule            WHERE facility_id          = ANY(v_fids);
    DELETE FROM facility_change_requests WHERE facility_id          = ANY(v_fids);
    DELETE FROM claim_requests           WHERE facility_id          = ANY(v_fids);
    DELETE FROM facilities               WHERE id                   = ANY(v_fids);
  END IF;

  DELETE FROM notifications WHERE user_id     = auth.uid();
  DELETE FROM reviews       WHERE customer_id = auth.uid();
  DELETE FROM appointments  WHERE customer_id = auth.uid();
  DELETE FROM profiles      WHERE id          = auth.uid();
  DELETE FROM auth.users    WHERE id          = auth.uid();
END;
$function$;

-- ev_guard_write()
CREATE OR REPLACE FUNCTION public.ev_guard_write()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE is_admin boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    INTO is_admin;
  IF is_admin THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'events: new rows must be draft';
    END IF;
    IF NEW.rejection_reason IS NOT NULL THEN
      RAISE EXCEPTION 'events: rejection_reason is admin-only';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.organizer_id IS DISTINCT FROM OLD.organizer_id THEN
    RAISE EXCEPTION 'events: organizer_id is immutable';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'draft' AND NEW.status = 'pending') THEN
    RAISE EXCEPTION 'events: status is admin-only';
  END IF;
  IF NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason THEN
    RAISE EXCEPTION 'events: rejection_reason is admin-only';
  END IF;

  RETURN NEW;
END
$function$;

-- expire_job_postings()
CREATE OR REPLACE FUNCTION public.expire_job_postings()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE job_postings
     SET status = 'expired', updated_at = now()
   WHERE status = 'active'
     AND expires_at IS NOT NULL
     AND expires_at < now();
$function$;

-- get_my_role()
CREATE OR REPLACE FUNCTION public.get_my_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT role FROM profiles WHERE id = auth.uid()
$function$;

-- guard_moderation_columns()
CREATE OR REPLACE FUNCTION public.guard_moderation_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_report_count int;
BEGIN
  IF get_my_role() = 'admin' THEN
    RETURN NEW;
  END IF;

  IF NEW.hidden_at IS NOT DISTINCT FROM OLD.hidden_at
     AND NEW.hidden_reason IS NOT DISTINCT FROM OLD.hidden_reason THEN
    RETURN NEW;                                     -- not touching moderation columns
  END IF;

  -- Permit exactly one non-admin transition: visible → auto-hidden, and only
  -- when >= 3 distinct users have actually reported this row.
  IF OLD.hidden_at IS NULL
     AND NEW.hidden_at IS NOT NULL
     AND NEW.hidden_reason = 'auto_reports' THEN
    SELECT count(DISTINCT reporter_id) INTO v_report_count
    FROM content_reports
    WHERE content_type = TG_ARGV[0] AND content_id = NEW.id;

    IF v_report_count >= 3 THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'hidden_at / hidden_reason are admin-only';
END;
$function$;

-- guard_profile_ban_column()
CREATE OR REPLACE FUNCTION public.guard_profile_ban_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF get_my_role() = 'admin' THEN
    RETURN NEW;
  END IF;
  IF NEW.ugc_banned_until IS DISTINCT FROM OLD.ugc_banned_until THEN
    RAISE EXCEPTION 'ugc_banned_until is admin-only';
  END IF;
  RETURN NEW;
END;
$function$;

-- handle_new_user()
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'role', 'customer')
  );
  return new;
end;
$function$;

-- hs_guard_insert()
CREATE OR REPLACE FUNCTION public.hs_guard_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE is_admin boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    INTO is_admin;
  IF is_admin THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'home_services: new rows must be pending';
  END IF;

  IF NEW.verified IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'home_services: verified is admin-only';
  END IF;

  IF NEW.rejection_reason IS NOT NULL THEN
    RAISE EXCEPTION 'home_services: rejection_reason is admin-only';
  END IF;

  RETURN NEW;
END
$function$;

-- hs_guard_owner_update()
CREATE OR REPLACE FUNCTION public.hs_guard_owner_update()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE is_admin boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'home_services: no system-context updates allowed';
  END IF;

  SELECT EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    INTO is_admin;
  IF is_admin THEN
    RETURN NEW;
  END IF;

  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'home_services: owner_id is immutable';
  END IF;

  IF NEW.verified IS DISTINCT FROM OLD.verified THEN
    RAISE EXCEPTION 'home_services: verified is admin-only';
  END IF;

  IF NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason THEN
    RAISE EXCEPTION 'home_services: rejection_reason is admin-only';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'home_services: status is admin-only';
  END IF;

  RETURN NEW;
END
$function$;

-- insert_notification(p_user_id uuid, p_title text, p_body text)
CREATE OR REPLACE FUNCTION public.insert_notification(p_user_id uuid, p_title text, p_body text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Admins can notify anyone.
  IF EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    INSERT INTO notifications (user_id, title, body) VALUES (p_user_id, p_title, p_body);
    RETURN;
  END IF;

  -- Providers can only notify customers who have an appointment at their facility.
  IF EXISTS (
    SELECT 1 FROM appointments a
    JOIN facilities f ON f.id = a.facility_id
    WHERE a.customer_id = p_user_id
      AND f.provider_id = auth.uid()
  ) THEN
    INSERT INTO notifications (user_id, title, body) VALUES (p_user_id, p_title, p_body);
    RETURN;
  END IF;

  RAISE EXCEPTION 'permission denied';
END;
$function$;

-- is_admin()
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$function$;

-- is_anonymous_session()
CREATE OR REPLACE FUNCTION public.is_anonymous_session()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
$function$;

-- is_customer_blocked()
CREATE OR REPLACE FUNCTION public.is_customer_blocked()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND blocked_until IS NOT NULL
      AND blocked_until > now()
  )
$function$;

-- jp_guard_insert()
CREATE OR REPLACE FUNCTION public.jp_guard_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE is_admin boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;  -- service role / SQL editor
  END IF;

  SELECT EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    INTO is_admin;
  IF is_admin THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'job_postings: new rows must be pending';
  END IF;

  IF NEW.rejection_reason IS NOT NULL THEN
    RAISE EXCEPTION 'job_postings: rejection_reason is admin-only';
  END IF;

  -- ⚠️ CHECK THIS: does the app set expires_at at post time, or does the
  -- admin set it on approval? If the app sets it at insert, delete this block.
  IF NEW.expires_at IS NOT NULL THEN
    RAISE EXCEPTION 'job_postings: expires_at is admin-only';
  END IF;

  RETURN NEW;
END
$function$;

-- jp_guard_owner_update()
CREATE OR REPLACE FUNCTION public.jp_guard_owner_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE is_admin boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    IF OLD.status = 'active' AND NEW.status = 'expired' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'job_postings: only active->expired allowed in system context';
  END IF;

  SELECT EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    INTO is_admin;
  IF is_admin THEN
    RETURN NEW;
  END IF;

  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'job_postings: owner_id is immutable';
  END IF;
  IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'job_postings: expires_at is admin-only';
  END IF;
  IF NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason THEN
    RAISE EXCEPTION 'job_postings: rejection_reason is admin-only';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'active' AND NEW.status = 'filled') THEN
    RAISE EXCEPTION 'job_postings: owner may only set status active->filled';
  END IF;

  RETURN NEW;
END $function$;

-- my_provider_facility_ids()
CREATE OR REPLACE FUNCTION public.my_provider_facility_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT id FROM facilities WHERE provider_id = auth.uid()
$function$;

-- record_no_show(p_appointment_id uuid)
CREATE OR REPLACE FUNCTION public.record_no_show(p_appointment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_customer_id uuid;
BEGIN
  SELECT a.customer_id INTO v_customer_id
  FROM appointments a
  JOIN facilities f ON f.id = a.facility_id
  WHERE a.id = p_appointment_id
    AND f.provider_id = auth.uid()
    AND a.status = 'confirmed';

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized or appointment not found';
  END IF;

  UPDATE appointments SET status = 'no_show' WHERE id = p_appointment_id;

  UPDATE profiles
  SET
    strikes = strikes + 1,
    blocked_until = CASE
      WHEN strikes + 1 >= 3 THEN now() + interval '7 days'
      ELSE blocked_until
    END
  WHERE id = v_customer_id;
END;
$function$;

-- search_content(query text, user_lat double precision, user_lon double precision)
CREATE OR REPLACE FUNCTION public.search_content(query text, user_lat double precision DEFAULT NULL::double precision, user_lon double precision DEFAULT NULL::double precision)
 RETURNS TABLE(id text, title text, subtitle text, module text, lat double precision, lon double precision)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT *
  FROM (

    -- Medical facilities (all public — no status filter)
    SELECT
      f.id::text,
      f.name                                        AS title,
      COALESCE(f.address, f.type::text, '')         AS subtitle,
      'medical'                                     AS module,
      f.latitude                                    AS lat,
      f.longitude                                   AS lon
    FROM facilities f
    WHERE f.name    ILIKE '%' || query || '%'
       OR f.address ILIKE '%' || query || '%'

    UNION ALL

    -- Upcoming approved events
    SELECT
      e.id::text,
      e.title,
      COALESCE(e.location, '')                      AS subtitle,
      'events'                                      AS module,
      NULL::float8                                  AS lat,
      NULL::float8                                  AS lon
    FROM events e
    WHERE e.status     = 'approved'
      AND e.start_date >= now() - interval '1 day'
      AND (e.title    ILIKE '%' || query || '%'
        OR e.location ILIKE '%' || query || '%')

    UNION ALL

    -- Beaches (name is JSONB keyed by lang code)
    SELECT
      b.id::text,
      COALESCE(b.name->>'en', '')                   AS title,
      COALESCE(b.district, '')                      AS subtitle,
      'beach'                                       AS module,
      b.latitude                                    AS lat,
      b.longitude                                   AS lon
    FROM beaches b
    WHERE b.status = 'active'
      AND (b.name->>'en' ILIKE '%' || query || '%'
        OR b.name->>'tr' ILIKE '%' || query || '%')

    UNION ALL

    -- Landmarks (name is JSONB keyed by lang code)
    SELECT
      l.id::text,
      COALESCE(l.name->>'en', '')                   AS title,
      COALESCE(l.district, '')                      AS subtitle,
      'landmark'                                    AS module,
      l.latitude                                    AS lat,
      l.longitude                                   AS lon
    FROM landmarks l
    WHERE l.status = 'active'
      AND (l.name->>'en' ILIKE '%' || query || '%'
        OR l.name->>'tr' ILIKE '%' || query || '%')

    UNION ALL

    -- Home service providers
    SELECT
      hs.id::text,
      hs.name,
      COALESCE(hs.district, '')                     AS subtitle,
      'homeServices'                                AS module,
      NULL::float8                                  AS lat,
      NULL::float8                                  AS lon
    FROM home_services hs
    WHERE hs.status = 'active'
      AND hs.name ILIKE '%' || query || '%'

    UNION ALL

    -- Transport providers
    SELECT
      tp.id::text,
      tp.name,
      COALESCE(tp.type, '')                         AS subtitle,
      'transport'                                   AS module,
      NULL::float8                                  AS lat,
      NULL::float8                                  AS lon
    FROM transport_providers tp
    WHERE tp.status = 'active'
      AND tp.name ILIKE '%' || query || '%'

    UNION ALL

    -- Job postings (only publicly visible: active + not expired)
    SELECT
      jp.id::text,
      jp.job_title                                  AS title,
      jp.employer_name || ' · ' || initcap(jp.district) AS subtitle,
      'jobPostings'                                 AS module,
      NULL::float8                                  AS lat,
      NULL::float8                                  AS lon
    FROM job_postings jp
    WHERE jp.status = 'active'
      AND jp.expires_at IS NOT NULL
      AND jp.expires_at > now()
      AND (jp.job_title     ILIKE '%' || query || '%'
        OR jp.employer_name ILIKE '%' || query || '%')

  ) combined
  ORDER BY
    -- Distance first when location is available
    CASE
      WHEN lat IS NOT NULL AND user_lat IS NOT NULL THEN
        6371 * acos(LEAST(1.0,
          cos(radians(user_lat)) * cos(radians(lat))
            * cos(radians(lon) - radians(user_lon))
          + sin(radians(user_lat)) * sin(radians(lat))
        ))
    END ASC NULLS LAST,
    -- Then alphabetical
    title ASC
  LIMIT 40
$function$;

-- tp_guard_write()
CREATE OR REPLACE FUNCTION public.tp_guard_write()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE is_admin boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    INTO is_admin;
  IF is_admin THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION 'transport_providers: new rows must be pending';
    END IF;
    IF NEW.verified IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'transport_providers: verified is admin-only';
    END IF;
    IF NEW.rejection_reason IS NOT NULL THEN
      RAISE EXCEPTION 'transport_providers: rejection_reason is admin-only';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'transport_providers: owner_id is immutable';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'transport_providers: status is admin-only';
  END IF;
  IF NEW.verified IS DISTINCT FROM OLD.verified THEN
    RAISE EXCEPTION 'transport_providers: verified is admin-only';
  END IF;
  IF NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason THEN
    RAISE EXCEPTION 'transport_providers: rejection_reason is admin-only';
  END IF;

  RETURN NEW;
END
$function$;

-- update_pharmacist_score()
CREATE OR REPLACE FUNCTION public.update_pharmacist_score()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  response_mins float;
  points int;
BEGIN
  IF NEW.status = 'approved' AND OLD.status = 'pending' THEN
    response_mins := EXTRACT(EPOCH FROM (now() - OLD.created_at)) / 60.0;
    IF    response_mins <= 5  THEN points := 10;
    ELSIF response_mins <= 15 THEN points := 7;
    ELSE                           points := 5;
    END IF;
    NEW.reviewed_at := now();
    INSERT INTO pharmacist_scores (facility_id, total_points, total_reviews, avg_response_mins)
      VALUES (NEW.assigned_facility_id, points, 1, response_mins)
    ON CONFLICT (facility_id) DO UPDATE SET
      total_points      = pharmacist_scores.total_points + points,
      total_reviews     = pharmacist_scores.total_reviews + 1,
      avg_response_mins = (pharmacist_scores.avg_response_mins * pharmacist_scores.total_reviews + response_mins)
                          / (pharmacist_scores.total_reviews + 1),
      updated_at        = now();
  ELSIF NEW.status = 'timed_out' AND OLD.status = 'pending' THEN
    INSERT INTO pharmacist_scores (facility_id, total_points, total_reviews, avg_response_mins)
      VALUES (NEW.assigned_facility_id, 0, 0, 0)
    ON CONFLICT (facility_id) DO UPDATE SET
      total_points = GREATEST(0, pharmacist_scores.total_points - 5),
      updated_at   = now();
  END IF;
  RETURN NEW;
END;
$function$;
