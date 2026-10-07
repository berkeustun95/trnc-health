-- Verbatim from production, 2026-10-07 (supabase-readonly run 37626893971, checkins_launch_readiness.sql):
-- the two live-only BEFORE triggers on public.profiles. Used by scripts/test-checkins-live-triggers.mjs.
CREATE OR REPLACE FUNCTION public.check_profile_name_content()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_norm       text;
  v_name_moved boolean;
BEGIN
  -- (a) full_name FOLLOWS first+last, but only when one of those actually changed.
  -- ProfileScreen still edits full_name directly until Slice 3; that edit touches
  -- neither name part, so it passes through untouched instead of being clobbered by a
  -- derivation the user cannot see.
  IF TG_OP = 'INSERT' THEN
    IF NEW.first_name IS NOT NULL OR NEW.last_name IS NOT NULL THEN
      NEW.full_name := nullif(btrim(concat_ws(' ', NEW.first_name, NEW.last_name)), '');
    END IF;
    v_name_moved := NEW.full_name IS NOT NULL;
  ELSE
    IF NEW.first_name IS DISTINCT FROM OLD.first_name
       OR NEW.last_name IS DISTINCT FROM OLD.last_name THEN
      NEW.full_name := nullif(btrim(concat_ws(' ', NEW.first_name, NEW.last_name)), '');
    END IF;
    v_name_moved := NEW.full_name IS DISTINCT FROM OLD.full_name;
  END IF;

  -- (b) full_name content — checked AFTER derivation, so a first_name of 'fuck' cannot
  -- reach full_name through a column the check never looked at.
  IF v_name_moved AND NEW.full_name IS NOT NULL
     AND contains_blocked_term(NEW.full_name) THEN
    RAISE EXCEPTION 'BLOCKED_TERM';
  END IF;

  -- (c) display_name — content filter, reserved list, and the normalized key.
  IF TG_OP = 'INSERT' OR NEW.display_name IS DISTINCT FROM OLD.display_name THEN
    IF NEW.display_name IS NULL THEN
      NEW.display_name_normalized := NULL;
    ELSE
      IF contains_blocked_term(NEW.display_name) THEN
        RAISE EXCEPTION 'BLOCKED_TERM';
      END IF;
      v_norm := normalize_display_name(NEW.display_name);
      IF v_norm IS NULL THEN
        -- Nothing left after normalization: the name was made entirely of invisible
        -- characters. NULL here would silently opt the row out of the unique index.
        RAISE EXCEPTION 'DISPLAY_NAME_INVALID';
      END IF;
      IF is_reserved_display_name(v_norm) THEN
        RAISE EXCEPTION 'DISPLAY_NAME_RESERVED';
      END IF;
      NEW.display_name_normalized := v_norm;
    END IF;
  ELSE
    -- display_name is not part of this UPDATE: carry the stored key forward, so a client
    -- that echoes the column back cannot desync the key from the name it indexes.
    NEW.display_name_normalized := OLD.display_name_normalized;
  END IF;

  -- (d) resident_status_updated_at is stamped by the SERVER, never accepted from a
  -- client. It is the only evidence of when someone stopped being a student.
  IF TG_OP = 'INSERT' THEN
    IF NEW.resident_status IS NOT NULL THEN
      NEW.resident_status_updated_at := now();
    END IF;
  ELSIF NEW.resident_status IS DISTINCT FROM OLD.resident_status THEN
    NEW.resident_status_updated_at := now();
  ELSE
    NEW.resident_status_updated_at := OLD.resident_status_updated_at;
  END IF;

  -- (e) MIN_SIGNUP_AGE = 13. THE ONLY OTHER PLACE THIS NUMBER APPEARS IS
  -- constants/profileGate.js; scripts/check-profile-gate.mjs reads both and fails if
  -- they disagree. It is a trigger and not a CHECK because CURRENT_DATE is STABLE.
  -- Matches the Google Play target-age declaration of 2026-08-29 (13-15 / 16-17 / 18+).
  IF NEW.date_of_birth IS NOT NULL
     AND NEW.date_of_birth > (current_date - interval '13 years')::date THEN
    RAISE EXCEPTION 'UNDERAGE';
  END IF;

  -- (f) age_ineligible is ONE-WAY for anyone but an admin. Without this, the neutral
  -- age screen is a formality: the client sets the flag, and the same client clears it.
  IF TG_OP = 'UPDATE'
     AND coalesce(get_my_role(), '') <> 'admin'
     AND OLD.age_ineligible AND NOT NEW.age_ineligible THEN
    RAISE EXCEPTION 'age_ineligible is admin-only once set';
  END IF;

  -- (g) terms_accepted_at is stamped by the SERVER. Same shape as (d), same reason,
  -- and here the reason is legal rather than merely tidy: an acceptance record carrying
  -- a device clock is not a record. A phone with the wrong date, or one deliberately
  -- set back, would write a timestamp we would later have to defend.
  --
  -- THE CLIENT SENDS terms_version AND terms_locale; THE SERVER SUPPLIES THE TIME. The
  -- version changing is what marks a fresh acceptance, so re-accepting a NEW version
  -- re-stamps and an unrelated UPDATE (a push_token write, a profile edit) carries the
  -- original forward untouched.
  --
  -- All three arms assign, including the pass-through — a client that sends its own
  -- terms_accepted_at has it overwritten rather than honoured, which is the point.
  IF TG_OP = 'INSERT' THEN
    IF NEW.terms_version IS NOT NULL THEN
      NEW.terms_accepted_at := now();
    END IF;
  ELSIF NEW.terms_version IS DISTINCT FROM OLD.terms_version THEN
    NEW.terms_accepted_at := now();
  ELSE
    NEW.terms_accepted_at := OLD.terms_accepted_at;
  END IF;

  -- (h) marketing_opt_in_at: THE CLIENT SAYS WHETHER, THE SERVER SAYS WHEN.
  --
  -- It cannot key off a version the way (g) does, because opting in and withdrawing are
  -- the same column moving between NULL and not-NULL. So the client's VALUE is read as a
  -- boolean intent and the timestamp is the server's:
  --
  --   NEW NULL                     -> withdrawal, honoured immediately and exactly
  --   NEW non-NULL, OLD NULL       -> fresh opt-in, stamped now()
  --   NEW non-NULL, OLD non-NULL   -> unchanged, the ORIGINAL opt-in time is preserved
  --
  -- That third arm is what stops an unrelated UPDATE silently re-dating a consent the
  -- user gave months ago. Withdrawal is deliberately the cheapest path in the function:
  -- consent that cannot be withdrawn as easily as it was given is not consent.
  IF TG_OP = 'INSERT' THEN
    IF NEW.marketing_opt_in_at IS NOT NULL THEN
      NEW.marketing_opt_in_at := now();
    END IF;
  ELSIF NEW.marketing_opt_in_at IS NULL THEN
    NEW.marketing_opt_in_at := NULL;
  ELSIF OLD.marketing_opt_in_at IS NULL THEN
    NEW.marketing_opt_in_at := now();
  ELSE
    NEW.marketing_opt_in_at := OLD.marketing_opt_in_at;
  END IF;

  RETURN NEW;
END;
$function$
;
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
$function$
;
CREATE TRIGGER check_profile_name_content BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION check_profile_name_content();
CREATE TRIGGER guard_profile_ban BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION guard_profile_ban_column();
