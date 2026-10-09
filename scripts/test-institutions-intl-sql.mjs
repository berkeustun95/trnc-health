// 20261095 (institutions.country + the reciprocity join) against a fixture of the LIVE
// shapes: readonly institutions_intl_baseline, 2026-10-08. The 25 rows, the four
// constraints and the three function bodies are verbatim from that probe.
// PGlite = PG 18; prod is 17.6. A pass is evidence about constraints, function bodies and
// grants as seeded here, nothing else.
//   node scripts/test-institutions-intl-sql.mjs
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freshDb, applyFile, asRole } from './migration-harness.mjs'
import { loadCountry, migration, activation } from './gen-institution-seeds.mjs'

const FILE = fileURLToPath(new URL('../supabase/migrations/20261095_institutions_country.sql', import.meta.url))
const OTHER = '00000000-0000-4000-b000-0000000000ff'
const ILIM = '00000000-0000-4000-b000-000000000006'
const DAU = '00000000-0000-4000-b000-000000000001'
const U = n => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`
const LISTED = U('1'), OTHER_ONLY = U('2'), ILIM_ONLY = U('3'), NOBODY = U('4')

const LIVE_ROWS = `  ('00000000-0000-4000-b000-000000000001', 'Doğu Akdeniz Üniversitesi', 'DAÜ', 'famagusta', true, 10, 'https://www.emu.edu.tr'),
  ('00000000-0000-4000-b000-000000000002', 'Yakın Doğu Üniversitesi', 'YDÜ', 'nicosia', true, 20, 'https://neu.edu.tr'),
  ('00000000-0000-4000-b000-000000000003', 'Uluslararası Kıbrıs Üniversitesi', 'UKÜ', 'nicosia', true, 30, 'https://ciu.edu.tr'),
  ('00000000-0000-4000-b000-000000000004', 'Girne Amerikan Üniversitesi', 'GAÜ', 'kyrenia', true, 40, 'https://www.gau.edu.tr'),
  ('00000000-0000-4000-b000-000000000016', 'ODTÜ Kuzey Kıbrıs Kampüsü', 'ODTÜ KKK', 'morphou', true, 45, 'https://ncc.metu.edu.tr'),
  ('00000000-0000-4000-b000-000000000005', 'Lefke Avrupa Üniversitesi', 'LAÜ', 'lefke', true, 50, 'https://www.eul.edu.tr'),
  ('00000000-0000-4000-b000-000000000011', 'İTÜ-KKTC Eğitim Araştırma Yerleşkeleri', 'İTÜ-KKTC', 'famagusta', true, 55, 'https://kktc.itu.edu.tr'),
  ('00000000-0000-4000-b000-000000000006', 'Kıbrıs İlim Üniversitesi', NULL, 'kyrenia', false, 60, NULL),
  ('00000000-0000-4000-b000-000000000017', 'Ankara Sosyal Bilimler Üniversitesi', NULL, 'nicosia', true, 65, 'https://kktc.asbu.edu.tr'),
  ('00000000-0000-4000-b000-000000000007', 'Arkın Yaratıcı Sanatlar ve Tasarım Üniversitesi', 'ARUCAD', 'kyrenia', true, 70, 'https://arucad.edu.tr'),
  ('00000000-0000-4000-b000-000000000008', 'Uluslararası Final Üniversitesi', NULL, 'kyrenia', true, 80, 'https://final.edu.tr'),
  ('00000000-0000-4000-b000-000000000015', 'Kıbrıs Sağlık ve Toplum Bilimleri Üniversitesi', NULL, 'morphou', true, 85, 'https://kstu.edu.tr'),
  ('00000000-0000-4000-b000-000000000009', 'Girne Üniversitesi', NULL, 'kyrenia', true, 90, 'https://kyrenia.edu.tr'),
  ('00000000-0000-4000-b000-000000000014', 'Kıbrıs Batı Üniversitesi', NULL, 'famagusta', true, 95, 'https://cwu.edu.tr'),
  ('00000000-0000-4000-b000-00000000000a', 'Bahçeşehir Kıbrıs Üniversitesi', 'BAU', 'nicosia', true, 100, 'https://baucyprus.edu.tr'),
  ('00000000-0000-4000-b000-000000000012', 'Kıbrıs Amerikan Üniversitesi', NULL, 'nicosia', true, 105, 'https://auc.edu.tr'),
  ('00000000-0000-4000-b000-00000000000b', 'Onbeş Kasım Kıbrıs Üniversitesi', NULL, 'nicosia', true, 110, 'https://onbeskku.edu.tr'),
  ('00000000-0000-4000-b000-000000000013', 'Kıbrıs Aydın Üniversitesi', NULL, 'kyrenia', true, 115, 'https://cau.edu.tr'),
  ('00000000-0000-4000-b000-00000000000c', 'Akdeniz Karpaz Üniversitesi', NULL, 'nicosia', true, 120, 'https://akun.edu.tr'),
  ('00000000-0000-4000-b000-000000000010', 'Avrupa Liderlik Üniversitesi', NULL, 'famagusta', true, 125, 'https://elu.edu.tr'),
  ('00000000-0000-4000-b000-00000000000d', 'Rauf Denktaş Üniversitesi', NULL, 'nicosia', true, 130, 'https://rdu.edu.tr'),
  ('00000000-0000-4000-b000-00000000000f', 'Ada Kent Üniversitesi', NULL, 'famagusta', true, 135, 'https://adakent.edu.tr'),
  ('00000000-0000-4000-b000-000000000018', 'Altınbaş Kıbrıs Üniversitesi', NULL, 'nicosia', true, 140, 'https://wpu.edu.tr'),
  ('00000000-0000-4000-b000-000000000019', 'Uluslararası Alasia Üniversitesi', NULL, 'kyrenia', true, 145, 'https://alasia.edu.tr'),
  ('00000000-0000-4000-b000-0000000000ff', 'Other / Diğer', NULL, NULL, true, 999, NULL)`
const LIVE_DEFS = `CREATE OR REPLACE FUNCTION public.is_listed_student(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL
     AND NOT is_anonymous_session()
     AND EXISTS (
    SELECT 1
      FROM student_education e
      JOIN profiles p ON p.id = e.user_id
     WHERE e.user_id = p_user_id
       AND e.listing_opt_in
       AND p.display_name IS NOT NULL
       AND (p.ugc_banned_until IS NULL OR p.ugc_banned_until <= now())
  );
$function$;
CREATE OR REPLACE FUNCTION public.can_see_student_lists()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Unchanged in meaning from 20261026: a non-anonymous caller who is themselves listed.
  -- The \`is_anonymous_session()\` half stays HERE and is not pushed into
  -- is_listed_student, because it is a fact about the CALLER's session, not about a user.
  SELECT NOT public.is_anonymous_session()
     AND public.is_listed_student(auth.uid());
$function$;
CREATE OR REPLACE FUNCTION public.get_student_list(p_institution_id uuid, p_lang text DEFAULT 'English'::text, p_limit integer DEFAULT 100)
 RETURNS TABLE(user_id uuid, display_name text, avatar_url text, subject_name text, study_start_year smallint, study_end_year smallint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me    uuid    := auth.uid();
  v_lang  text;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
BEGIN
  IF v_me IS NULL OR is_anonymous_session() THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF NOT can_see_student_lists() THEN
    RAISE EXCEPTION 'NOT_LISTED';
  END IF;

  -- Validity DERIVED from the data, not from nine names typed here: a second copy of that
  -- list is a second thing to drift. An unknown language falls back to English rather
  -- than raising, so a locale added before its subject rows exist shows English names.
  SELECT CASE WHEN EXISTS (SELECT 1 FROM subject_i18n si WHERE si.lang = p_lang)
              THEN p_lang ELSE 'English' END
    INTO v_lang;

  RETURN QUERY
  WITH one_per_person AS (
    SELECT DISTINCT ON (e.user_id)
           e.user_id, e.subject_id, e.study_start_year, e.study_end_year
      FROM student_education e
      JOIN profiles p      ON p.id = e.user_id
      JOIN institutions i  ON i.id = e.institution_id AND i.is_active
     WHERE e.institution_id = p_institution_id
       AND e.listing_opt_in
       AND p.display_name IS NOT NULL
       AND (p.ugc_banned_until IS NULL OR p.ugc_banned_until <= now())
       AND NOT EXISTS (
         SELECT 1 FROM blocks b
          WHERE (b.blocker_id = v_me AND b.blocked_id = e.user_id)
             OR (b.blocker_id = e.user_id AND b.blocked_id = v_me)
       )
     ORDER BY e.user_id,
              (e.study_end_year IS NULL) DESC,
              e.study_start_year DESC NULLS LAST,
              e.id
  )
  SELECT o.user_id, p.display_name, p.avatar_url, sn.name,
         o.study_start_year, o.study_end_year
    FROM one_per_person o
    JOIN profiles p ON p.id = o.user_id
    LEFT JOIN LATERAL (
      SELECT si.name
        FROM subject_i18n si
       WHERE si.subject_id = o.subject_id
       ORDER BY (si.lang = v_lang) DESC, (si.lang = 'English') DESC, si.lang
       LIMIT 1
    ) sn ON TRUE
   ORDER BY (o.user_id = v_me) DESC, p.display_name
   LIMIT v_limit;
END;
$function$;`

const SEED = `
CREATE ROLE supabase_read_only_user NOLOGIN;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $j$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb $j$;
GRANT EXECUTE ON FUNCTION auth.jwt() TO anon, authenticated;
CREATE FUNCTION public.is_anonymous_session() RETURNS boolean LANGUAGE sql STABLE SET search_path TO '' AS $f$
  SELECT coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) $f$;
CREATE TABLE public.institutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, short_name text, city text,
  is_active boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(), website_url text,
  CONSTRAINT institutions_name_unique UNIQUE (name),
  CONSTRAINT institutions_city_check CHECK (((city IS NULL) OR (city = ANY (ARRAY['nicosia'::text, 'kyrenia'::text, 'famagusta'::text, 'morphou'::text, 'iskele'::text, 'lefke'::text, 'karpaz'::text])))),
  CONSTRAINT institutions_website_url_scheme_check CHECK (((website_url IS NULL) OR (website_url ~ '^https://'::text))));
ALTER TABLE public.institutions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "institutions_read_authenticated" ON public.institutions FOR SELECT TO authenticated USING (true);
INSERT INTO public.institutions (id, name, short_name, city, is_active, sort_order, website_url) VALUES
${LIVE_ROWS};
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id), display_name text, avatar_url text, ugc_banned_until timestamptz);
CREATE TABLE public.subject_i18n (subject_id uuid, lang text, name text);
CREATE TABLE public.blocks (blocker_id uuid, blocked_id uuid);
CREATE TABLE public.student_education (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id), institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE RESTRICT,
  level text NOT NULL, subject_id uuid, study_start_year smallint, study_end_year smallint,
  listing_opt_in boolean NOT NULL DEFAULT false);
${LIVE_DEFS}
REVOKE ALL ON FUNCTION public.is_listed_student(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_listed_student(uuid) TO authenticated, service_role, supabase_read_only_user;
REVOKE ALL ON FUNCTION public.can_see_student_lists() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_student_list(uuid, text, integer) FROM PUBLIC, anon;
INSERT INTO auth.users VALUES ('${LISTED}'), ('${OTHER_ONLY}'), ('${ILIM_ONLY}'), ('${NOBODY}');
INSERT INTO public.profiles (id, display_name) VALUES ('${LISTED}', 'listed'), ('${OTHER_ONLY}', 'other'), ('${ILIM_ONLY}', 'ilim'), ('${NOBODY}', 'nobody');
INSERT INTO public.student_education (user_id, institution_id, level, listing_opt_in) VALUES
  ('${LISTED}', '${DAU}', 'university', true),
  ('${NOBODY}', '${DAU}', 'university', false);
`

// Messaging (20261029 as live, readonly messaging_defs 2026-10-09): start_conversation,
// send_message and may_initiate_by_age verbatim. Tables carry only the columns those bodies
// touch; the messages triggers (sender stamp, age rule, UGC screen) are NOT modelled —
// this tests the LISTED gates, which is what 20261095 changed.
const LIVE_MSG_DEFS = `CREATE OR REPLACE FUNCTION public.may_initiate_by_age(p_sender uuid, p_recipient uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sender    date;
  v_recipient date;
  v_cutoff    date := (current_date - interval '18 years')::date;  -- ADULT_AGE
BEGIN
  -- ⚠ TWO CLAUSES, AND THE SECOND ONE IS 20261036. Without it a guest — one tap from a
  --   cold start, no credentials — gets a minor/adult bit on any uuid they name. The
  --   first clause alone reads like "a real user is asking"; in this app it only means
  --   "a session exists", and signInAnonymously() makes one.
  IF auth.uid() IS NULL OR is_anonymous_session() THEN
    RETURN false;
  END IF;

  SELECT date_of_birth INTO v_sender    FROM profiles WHERE id = p_sender;
  SELECT date_of_birth INTO v_recipient FROM profiles WHERE id = p_recipient;

  -- Born AFTER the cutoff = younger than 18 = a minor.
  IF v_sender IS NOT NULL AND v_sender > v_cutoff THEN
    RETURN true;   -- the sender is a known minor
  END IF;
  IF v_recipient IS NOT NULL AND v_recipient <= v_cutoff THEN
    RETURN true;   -- the recipient is a known adult
  END IF;

  RETURN false;
END;
$function$;
CREATE OR REPLACE FUNCTION public.start_conversation(p_recipient_id uuid, p_body text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me      uuid := auth.uid();
  v_body    text := btrim(coalesce(p_body, ''));
  v_refused boolean;
  v_conv    uuid;
  v_msg     uuid;
BEGIN
  -- ── the gates that RAISE: nothing was attempted, nothing is counted ──────
  IF v_me IS NULL OR is_anonymous_session() THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF NOT can_see_student_lists() THEN
    RAISE EXCEPTION 'NOT_LISTED';
  END IF;
  IF p_recipient_id IS NULL OR p_recipient_id = v_me THEN
    RAISE EXCEPTION 'INVALID_RECIPIENT';
  END IF;
  IF char_length(v_body) < 1 OR char_length(v_body) > 1000 THEN
    RAISE EXCEPTION 'BODY_LENGTH';
  END IF;

  -- A live thread already exists; the client should have opened it. Not a secret — the
  -- caller is a participant of it by definition.
  IF EXISTS (
    SELECT 1 FROM conversations
     WHERE pair_lo = least(v_me, p_recipient_id) AND pair_hi = greatest(v_me, p_recipient_id)
       AND declined_at IS NULL AND closed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'CONVERSATION_EXISTS';
  END IF;

  -- ── THE CAP. Fifty new conversations a day, counting refusals. ───────────
  -- SECURITY DEFINER is not decoration here. An INVOKER count would read
  -- conversation_attempts under the caller's own RLS, which grants them nothing, so it
  -- would return 0 forever and the cap would be structurally dead — the exact defect
  -- \`check_report_rate_limit\` shipped with, where a non-admin counting an admin-read
  -- table could never reach the threshold. A rate limit that cannot see its own
  -- denominator is not a rate limit.
  IF (SELECT count(*) FROM conversation_attempts
       WHERE initiator_id = v_me AND created_at > now() - interval '24 hours') >= 50 THEN
    RAISE EXCEPTION 'RATE_LIMITED';
  END IF;

  -- A uuid that is nobody is not an attempt on anyone, so it records nothing. (It costs
  -- no slot either, which is an oracle only in the sense that spending fifty attempts a
  -- day and watching for the cap would distinguish it. The answer is identical, the cost
  -- is a day per bit, and the alternative is a foreign-key error that says "no such
  -- user" outright.)
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_recipient_id) THEN
    RETURN 'refused';
  END IF;

  -- ── the refusable gates, evaluated together and answered as one word ─────
  v_refused :=
       EXISTS (SELECT 1 FROM blocks
                WHERE (blocker_id = v_me AND blocked_id = p_recipient_id)
                   OR (blocker_id = p_recipient_id AND blocked_id = v_me))
    OR NOT is_listed_student(p_recipient_id)
    -- PERMANENT, ONE-DIRECTIONAL DECLINE: any past thread this person declined while I
    -- was the initiator seals me out of initiating again. It does not seal them out of
    -- initiating to me — a decline means "not from you", not "this pair is over".
    OR EXISTS (SELECT 1 FROM conversations
                WHERE pair_lo = least(v_me, p_recipient_id)
                  AND pair_hi = greatest(v_me, p_recipient_id)
                  AND declined_at IS NOT NULL
                  AND initiator_id = v_me)
    OR NOT may_initiate_by_age(v_me, p_recipient_id);

  INSERT INTO conversation_attempts (initiator_id, recipient_id, outcome)
  VALUES (v_me, p_recipient_id, CASE WHEN v_refused THEN 'refused' ELSE 'sent' END);

  IF v_refused THEN
    RETURN 'refused';
  END IF;

  -- The EXISTS check above and this INSERT are not atomic with respect to another
  -- session doing the same thing, so two simultaneous openers both pass it and the
  -- second meets the partial unique index as a raw 23505 the client cannot read.
  -- 20261026's own belt, worn for the same reason.
  BEGIN
    INSERT INTO conversations (initiator_id, recipient_id) VALUES (v_me, p_recipient_id)
    RETURNING id INTO v_conv;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'CONVERSATION_EXISTS';
  END;

  -- sender_display_name is stamped by msg_10; the placeholder is never stored.
  INSERT INTO messages (conversation_id, sender_id, sender_display_name, body)
  VALUES (v_conv, v_me, '-', v_body)
  RETURNING id INTO v_msg;

  PERFORM notify_new_message(v_msg);
  RETURN 'sent';
END;
$function$;
CREATE OR REPLACE FUNCTION public.send_message(p_conversation_id uuid, p_body text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me   uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  c      conversations%ROWTYPE;
  v_them uuid;
  v_msg  uuid;
BEGIN
  IF v_me IS NULL OR is_anonymous_session() THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF NOT can_see_student_lists() THEN
    RAISE EXCEPTION 'NOT_LISTED';
  END IF;
  IF char_length(v_body) < 1 OR char_length(v_body) > 1000 THEN
    RAISE EXCEPTION 'BODY_LENGTH';
  END IF;

  SELECT * INTO c FROM conversations WHERE id = p_conversation_id;
  -- A non-participant gets the same answer as a nonexistent id: the thread is not
  -- theirs, and "wrong id" versus "not yours" is a membership oracle.
  IF c.id IS NULL OR v_me NOT IN (coalesce(c.initiator_id, '00000000-0000-0000-0000-000000000000'::uuid),
                                  coalesce(c.recipient_id, '00000000-0000-0000-0000-000000000000'::uuid)) THEN
    RAISE EXCEPTION 'NO_SUCH_CONVERSATION';
  END IF;

  v_them := CASE WHEN c.initiator_id = v_me THEN c.recipient_id ELSE c.initiator_id END;

  -- Left by either side, or the other person is gone.
  IF c.closed_at IS NOT NULL OR v_them IS NULL THEN
    RAISE EXCEPTION 'CONVERSATION_CLOSED';
  END IF;

  -- A block in either direction closes the thread in practice. The blocked party is told
  -- the conversation is closed, never that they were blocked.
  IF EXISTS (SELECT 1 FROM blocks
              WHERE (blocker_id = v_me AND blocked_id = v_them)
                 OR (blocker_id = v_them AND blocked_id = v_me)) THEN
    RAISE EXCEPTION 'CONVERSATION_CLOSED';
  END IF;

  IF c.initiator_id = v_me THEN
    -- ACCEPT-FIRST: one opener, then nothing until the recipient lets it through.
    -- Declined threads land here too, wearing the same answer. See the note above.
    IF c.accepted_at IS NULL THEN
      RAISE EXCEPTION 'AWAITING_ACCEPTANCE';
    END IF;
  ELSE
    IF c.declined_at IS NOT NULL THEN
      RAISE EXCEPTION 'CONVERSATION_CLOSED';
    END IF;
    -- REPLYING IS ACCEPTING. An explicit accept exists too, but making somebody tap
    -- Accept before they may answer is a step that means nothing: the reply IS the
    -- acceptance. Declining stays explicit, because it is permanent.
    IF c.accepted_at IS NULL THEN
      UPDATE conversations SET accepted_at = now() WHERE id = c.id;
    END IF;
  END IF;

  IF NOT is_listed_student(v_them) THEN
    -- They left the hub. Nothing more lands in the thread; it stays readable.
    RAISE EXCEPTION 'CONVERSATION_CLOSED';
  END IF;

  INSERT INTO messages (conversation_id, sender_id, sender_display_name, body)
  VALUES (c.id, v_me, '-', v_body)
  RETURNING id INTO v_msg;

  PERFORM notify_new_message(v_msg);
  RETURN 'sent';
END;
$function$;`
const MSG_SEED = `
ALTER TABLE public.profiles ADD COLUMN date_of_birth date;
-- All adults: the age rule (may_initiate_by_age) refuses an unknown-age pair, and it is not
-- what this tests. Positive control below: the legitimate pair IS sent.
UPDATE public.profiles SET date_of_birth = '2000-01-01';
CREATE TABLE public.conversations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  initiator_id uuid, recipient_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz, declined_at timestamptz, closed_at timestamptz, closed_by uuid,
  last_message_at timestamptz,
  pair_lo uuid GENERATED ALWAYS AS (least(initiator_id, recipient_id)) STORED,
  pair_hi uuid GENERATED ALWAYS AS (greatest(initiator_id, recipient_id)) STORED);
CREATE TABLE public.messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid,
  sender_id uuid, sender_display_name text, body text, created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz, hidden_at timestamptz, hidden_reason text);
CREATE TABLE public.conversation_attempts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  initiator_id uuid, recipient_id uuid, outcome text, created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION public.notify_new_message(p uuid) RETURNS void LANGUAGE sql AS 'SELECT';
${LIVE_MSG_DEFS}
`

const results = []
const check = (name, ok, got) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  got: ' + JSON.stringify(got)}`) }
const one = async (db, sql) => (await db.query(sql)).rows[0]
const variant = (from, to) => {
  const src = readFileSync(FILE, 'utf8')
  if (!src.includes(from)) throw new Error(`red-first anchor not found: ${from.slice(0, 60)}`)
  const p = join(mkdtempSync(join(tmpdir(), 'inst-')), 'variant.sql')
  writeFileSync(p, src.split(from).join(to))
  return p
}

// 1. Applies on the live shape; the backfill and constraints are what the file says.
{
  const db = await freshDb(SEED)
  const r = await applyFile(db, FILE)
  check('applies on the live shape', r.ok, r.msg)
  const c = await one(db, `SELECT count(*) FILTER (WHERE country = 'XN')::int xn, count(*) FILTER (WHERE country IS NULL)::int nul FROM institutions`)
  check('24 rows XN, only Other NULL', c.xn === 24 && c.nul === 1, c)

  // Constraint behaviour, each refusal with a passing control.
  const ins = async sql => { try { await db.exec(sql); return 'ok' } catch (e) { return String(e.message).split('\n')[0] } }
  check('same name in another country is allowed (ASBÜ, Ankara)', await ins(`INSERT INTO institutions (name, country, city_name, sort_order) VALUES ('Ankara Sosyal Bilimler Üniversitesi', 'TR', 'Ankara', 500)`) === 'ok')
  check('same name in the same country is refused', /unique/i.test(await ins(`INSERT INTO institutions (name, country) VALUES ('Ankara Sosyal Bilimler Üniversitesi', 'TR')`)))
  check('a region slug outside the TRNC is refused', /institutions_city_country_check/.test(await ins(`INSERT INTO institutions (name, country, city) VALUES ('X1', 'TR', 'nicosia')`)))
  check('a city_name on a TRNC row is refused', /institutions_city_name_check/.test(await ins(`INSERT INTO institutions (name, country, city_name) VALUES ('X2', 'XN', 'Lefkoşa')`)))
  check('a blank city_name is refused', /institutions_city_name_check/.test(await ins(`INSERT INTO institutions (name, country, city_name) VALUES ('X3', 'GB', '  ')`)))
  check('a row without a country is refused', /institutions_country_required_check/.test(await ins(`INSERT INTO institutions (name) VALUES ('X4')`)))
  check('a lowercase 3-letter country is refused', /institutions_country_check/.test(await ins(`INSERT INTO institutions (name, country) VALUES ('X5', 'gbr')`)))
  check('control: a GB row with a city_name and an https link is accepted', await ins(`INSERT INTO institutions (name, country, city_name, website_url) VALUES ('X6', 'GB', 'London', 'https://x.ac.uk')`) === 'ok')

  // Reciprocity. These opt-ins are added AFTER the apply (the file refuses to de-list anybody).
  await db.exec(`INSERT INTO student_education (user_id, institution_id, level, listing_opt_in) VALUES
    ('${OTHER_ONLY}', '${OTHER}', 'university', true), ('${ILIM_ONLY}', '${ILIM}', 'university', true)`)
  const canSee = async uid => (await asRole(db, 'authenticated', uid, 'SELECT can_see_student_lists() v')).rows?.[0]?.v
  check('control: opted in at an active university → can see lists', await canSee(LISTED) === true)
  check('opted in only at Other → cannot see lists', await canSee(OTHER_ONLY) === false)
  check('opted in only at an inactive university → cannot see lists', await canSee(ILIM_ONLY) === false)
  check('not opted in → cannot see lists', await canSee(NOBODY) === false)
  const listOther = await asRole(db, 'authenticated', LISTED, `SELECT count(*)::int n FROM get_student_list('${OTHER}')`)
  check('get_student_list(Other) returns nobody', listOther.ok && listOther.rows[0].n === 0, listOther)
  const listDau = await asRole(db, 'authenticated', LISTED, `SELECT count(*)::int n FROM get_student_list('${DAU}')`)
  check('control: get_student_list(DAÜ) returns the listed student', listDau.ok && listDau.rows[0].n === 1, listDau)
  const gb = (await db.query(`SELECT id FROM institutions WHERE name = 'X6'`)).rows[0].id
  await db.exec(`INSERT INTO student_education (user_id, institution_id, level, listing_opt_in) VALUES ('${NOBODY}', '${gb}', 'university', true)`)
  check('opted in at a GB university → listed, can see (every country has a list)', await canSee(NOBODY) === true)
  const listGb = await asRole(db, 'authenticated', LISTED, `SELECT count(*)::int n FROM get_student_list('${gb}')`)
  check('…and appears in that university\'s list', listGb.ok && listGb.rows[0].n === 1, listGb)
  const anon = await asRole(db, 'anon', null, `SELECT is_listed_student('${LISTED}')`)
  check('anon cannot call is_listed_student', !anon.ok, anon)
}

// 2. Re-run on its own end state (no one opted in only at Other/inactive) is a no-op.
{
  const db = await freshDb(SEED)
  const r1 = await applyFile(db, FILE)
  const r2 = await applyFile(db, FILE)
  check('re-run is a no-op', r1.ok && r2.ok, [r1.msg, r2.msg])
}

// 3. RED-FIRST: each guard fires on the defect it exists for.
{
  // The probes in 1 see the hole on the LIVE bodies: before this file, an opt-in at Other
  // or at an inactive university unlocks every list.
  const db = await freshDb(SEED)
  await db.exec(`INSERT INTO student_education (user_id, institution_id, level, listing_opt_in) VALUES
    ('${OTHER_ONLY}', '${OTHER}', 'university', true), ('${ILIM_ONLY}', '${ILIM}', 'university', true)`)
  const canSee = async uid => (await asRole(db, 'authenticated', uid, 'SELECT can_see_student_lists() v')).rows?.[0]?.v
  check('RED: on the live bodies, opted in only at Other CAN see lists (the hole)', await canSee(OTHER_ONLY) === true)
  check('RED: on the live bodies, opted in only at inactive İlim CAN see lists (the hole)', await canSee(ILIM_ONLY) === true)
}
{
  const db = await freshDb(SEED)
  await db.exec(`INSERT INTO student_education (user_id, institution_id, level, listing_opt_in) VALUES ('${OTHER_ONLY}', '${OTHER}', 'university', true)`)
  const r = await applyFile(db, FILE)
  check('RED: refuses while someone is opted in only at Other (would be de-listed)', !r.ok && /de-lists 1/.test(r.msg), r.msg)
}
{
  const db = await freshDb(SEED)
  const p = variant(`      JOIN institutions i ON i.id = e.institution_id AND i.is_active
                         AND i.id <> '00000000-0000-4000-b000-0000000000ff'
     WHERE e.user_id = p_user_id`, `     WHERE e.user_id = p_user_id`)
  const r = await applyFile(db, p)
  check('RED: refuses an is_listed_student without the join', !r.ok && /is_listed_student\(uuid\) does not carry/.test(r.msg), r.msg)
}
{
  const db = await freshDb(SEED)
  const p = variant(`  SELECT auth.uid() IS NOT NULL
     AND NOT is_anonymous_session()
     AND EXISTS (`, `  SELECT NOT is_anonymous_session() AND false AND EXISTS (`)
  const r = await applyFile(db, p)
  check('RED: a gate that refuses everyone fails the positive control', !r.ok && /CONTROL/.test(r.msg), r.msg)
}
{
  const db = await freshDb(SEED + `GRANT EXECUTE ON FUNCTION public.is_listed_student(uuid) TO anon;`)
  const r = await applyFile(db, FILE)
  check('RED: refuses when anon can execute is_listed_student', !r.ok && /EXECUTE grantees/.test(r.msg), r.msg)
}

// 4. The generated seeds (gen-institution-seeds.mjs) on top of 1095: all three countries,
//    inactive, coexisting with the TRNC rows (ASBÜ's name in both XN and TR), re-runnable.
{
  const db = await freshDb(SEED)
  check('seeds: 1095 applies first', (await applyFile(db, FILE)).ok)
  const dir = mkdtempSync(join(tmpdir(), 'seed-'))
  const want = {}
  for (const c of ['TR', 'CY', 'GB']) {
    const rows = loadCountry(c)
    want[c] = rows.length
    const { file, sql } = migration(c, '99999999', rows)
    writeFileSync(join(dir, file), sql)
    const r1 = await applyFile(db, join(dir, file))
    const r2 = await applyFile(db, join(dir, file))
    check(`seeds: ${c} applies (${rows.length} rows) and re-runs as a no-op`, r1.ok && r2.ok, [r1.msg, r2.msg])
  }
  const got = (await db.query(`SELECT country, count(*)::int n, count(*) FILTER (WHERE is_active)::int a
                                 FROM institutions GROUP BY 1 ORDER BY 1`)).rows
  const by = Object.fromEntries(got.map(r => [r.country ?? 'NULL', r]))
  check('seeds: counts per country match the CSVs, all inactive',
    ['TR', 'CY', 'GB'].every(c => by[c]?.n === want[c] && by[c]?.a === 0), got)
  check('seeds: the TRNC rows are untouched (24 XN, 23 active)', by.XN?.n === 24 && by.XN?.a === 23, by.XN)
  const asbu = (await db.query(`SELECT count(*)::int n FROM institutions WHERE name = 'Ankara Sosyal Bilimler Üniversitesi'`)).rows[0].n
  check('seeds: ASBÜ exists in both XN and TR', asbu === 2, asbu)
  // Activation publishes exactly the seeded rows, leaves a hand-added row alone, re-runs clean.
  await db.exec(`INSERT INTO institutions (name, country, is_active) VALUES ('Hand Added', 'GB', false)`)
  const act = activation('99999996')
  writeFileSync(join(dir, act.file), act.sql)
  const redAct = await applyFile(db, join(dir, act.file))
  check('RED activation: refuses while a country holds rows its seed does not have', !redAct.ok && /GB holds 152 rows, its seed has 151/.test(redAct.msg), redAct.msg)
  await db.exec('ROLLBACK; RESET ROLE;')   // the refused apply left its transaction open
  await db.exec(`DELETE FROM institutions WHERE name = 'Hand Added'`)
  const a1 = await applyFile(db, join(dir, act.file))
  const a2 = await applyFile(db, join(dir, act.file))
  const on = (await db.query(`SELECT country, count(*) FILTER (WHERE is_active)::int a FROM institutions GROUP BY 1`)).rows
  const onBy = Object.fromEntries(on.map(r => [r.country ?? 'NULL', r.a]))
  check('activation: every seeded row active, TRNC unchanged, re-run clean',
    a1.ok && a2.ok && ['TR', 'CY', 'GB'].every(c => onBy[c] === want[c]) && onBy.XN === 23, { a1: a1.msg, a2: a2.msg, onBy })
  // RED: a name already taken in the country under another id is refused by name.
  await db.exec(`UPDATE institutions SET name = name || ' (x)' WHERE country = 'CY'`)
  await db.exec(`INSERT INTO institutions (name, country) VALUES ('University of Cyprus', 'CY')`)
  const cy = migration('CY', '99999998', loadCountry('CY'))
  writeFileSync(join(dir, cy.file), cy.sql)
  const r = await applyFile(db, join(dir, cy.file))
  check('RED seeds: a same-country name under another id is refused by name', !r.ok && /already in CY under another id: University of Cyprus/.test(r.msg), r.msg)
}
{
  // RED: a seed name equal to a TRNC row's name (outside the reviewed allowance) is refused.
  const db = await freshDb(SEED)
  await applyFile(db, FILE)
  await db.exec(`UPDATE institutions SET name = 'Imperial College London' WHERE id = '00000000-0000-4000-b000-000000000019'`)
  const dir = mkdtempSync(join(tmpdir(), 'seed-'))
  const gb = migration('GB', '99999997', loadCountry('GB'))
  writeFileSync(join(dir, gb.file), gb.sql)
  const r = await applyFile(db, join(dir, gb.file))
  check('RED seeds: a name shared with a TRNC row outside the allowance is refused', !r.ok && /shared with TRNC rows are \[Imperial College London\]/.test(r.msg), r.msg)
}

// 5. The COMMITTED, stamped files (not the generator's fresh output), in apply order.
{
  const db = await freshDb(SEED)
  const dirM = fileURLToPath(new URL('../supabase/migrations/', import.meta.url))
  const files = ['20261095_institutions_country.sql', '20261096_institutions_seed_tr.sql', '20261097_institutions_seed_cy.sql',
                 '20261098_institutions_seed_gb.sql', '20261099_institutions_activate_intl.sql']
  const out = []
  for (const f of files) { const r = await applyFile(db, dirM + f); out.push(r.ok ? 'ok' : `${f}: ${r.msg}`) }
  check('committed 1095–1099 apply in order', out.every(x => x === 'ok'), out)
  const led = (await db.query(`SELECT count(*)::int n FROM schema_migrations_applied WHERE filename = ANY($1)`, [files])).rows[0].n
  check('…each stamps its ledger row', led === 5, led)
}

// 6. MESSAGING at universities outside the TRNC, through the live RPC bodies.
//    A listed at a GB university, B listed at a TR university, C opted in only at Other.
{
  const A = LISTED, B = NOBODY, C = OTHER_ONLY
  const call = (uid, sql) => asRole(db6, 'authenticated', uid, sql)
  let db6
  // RED-first: on the LIVE (pre-1095) bodies, C — opted in only at Other — can message.
  db6 = await freshDb(SEED + MSG_SEED)
  await db6.exec(`INSERT INTO student_education (user_id, institution_id, level, listing_opt_in) VALUES ('${C}', '${OTHER}', 'university', true)`)
  const holeC = await call(C, `SELECT start_conversation('${A}', 'merhaba') r`)
  check('RED messaging: on the live bodies, Other-only C can open a conversation (the hole)', holeC.ok && holeC.rows[0].r === 'sent', holeC)

  db6 = await freshDb(SEED + MSG_SEED)
  const dirM = fileURLToPath(new URL('../supabase/migrations/', import.meta.url))
  for (const f of ['20261095_institutions_country.sql', '20261096_institutions_seed_tr.sql',
                   '20261097_institutions_seed_cy.sql', '20261098_institutions_seed_gb.sql',
                   '20261099_institutions_activate_intl.sql']) {
    const r = await applyFile(db6, dirM + f)
    if (!r.ok) check(`messaging fixture: ${f} applies`, false, r.msg)
  }
  const gbId = (await db6.query(`SELECT id FROM institutions WHERE country = 'GB' AND name = 'Imperial College London'`)).rows[0].id
  const trId = (await db6.query(`SELECT id FROM institutions WHERE country = 'TR' AND name = 'Boğaziçi Üniversitesi'`)).rows[0].id
  await db6.exec(`DELETE FROM student_education;
    INSERT INTO student_education (user_id, institution_id, level, listing_opt_in) VALUES
      ('${A}', '${gbId}', 'university', true), ('${B}', '${trId}', 'university', true),
      ('${C}', '${OTHER}', 'university', true)`)

  const listGb = await call(B, `SELECT count(*)::int n FROM get_student_list('${gbId}')`)
  check('messaging: TR-listed B sees GB-listed A in Imperial\'s list', listGb.ok && listGb.rows[0].n === 1, listGb)
  const open = await call(A, `SELECT start_conversation('${B}', 'hello from London') r`)
  check('messaging: GB-listed A opens a conversation with TR-listed B → sent', open.ok && open.rows[0].r === 'sent', open)
  const conv = (await db6.query(`SELECT id FROM conversations WHERE initiator_id = '${A}' AND recipient_id = '${B}'`)).rows[0]?.id
  const early = await call(A, `SELECT send_message('${conv}', 'second') r`)
  check('messaging: accept-first still holds (A cannot send again before B replies)', !early.ok && /AWAITING_ACCEPTANCE/.test(early.msg), early)
  const reply = await call(B, `SELECT send_message('${conv}', 'merhaba') r`)
  check('messaging: B replies (= accepts) → sent', reply.ok && reply.rows[0].r === 'sent', reply)
  const again = await call(A, `SELECT send_message('${conv}', 'great') r`)
  check('messaging: after acceptance A can send → sent', again.ok && again.rows[0].r === 'sent', again)

  const cOpen = await call(C, `SELECT start_conversation('${A}', 'hi') r`)
  check('messaging: Other-only C cannot open a conversation (NOT_LISTED)', !cOpen.ok && /NOT_LISTED/.test(cOpen.msg), cOpen)
  const cList = await call(C, `SELECT count(*) FROM get_student_list('${gbId}')`)
  check('messaging: Other-only C cannot read any list (NOT_LISTED)', !cList.ok && /NOT_LISTED/.test(cList.msg), cList)
  const toC = await call(A, `SELECT start_conversation('${C}', 'hi') r`)
  check('messaging: nobody can open a conversation with Other-only C → refused', toC.ok && toC.rows[0].r === 'refused', toC)
  const msgs = (await db6.query(`SELECT count(*)::int n FROM messages`)).rows[0].n
  check('messaging: exactly the 3 legitimate messages were stored', msgs === 3, msgs)
}

const failed = results.filter(x => !x).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
