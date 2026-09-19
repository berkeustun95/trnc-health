-- ─── 20261032 — the blocked list can say who, without naming a reviewer ─────
--
-- One column, two function bodies carried over verbatim, one new read function.
--
-- ─── THE DEFECT ──────────────────────────────────────────────────────────────
--
-- ProfileScreen's blocked list renders "Blocked on 19 Sept 2026" and an Unblock button.
-- No name, no avatar, nothing. With one block it is merely odd; with three it is three
-- identical rows and no way to tell them apart, so the user cannot unblock a SPECIFIC
-- person — which makes blocking irreversible in practice.
--
-- It is nameless for a real reason. block_content_author() blocks the author of a REVIEW,
-- and reviews are anonymous: the blocker may never have known who they were. Naming that
-- row would tell them. So the list named nobody, and became unusable for everybody.
--
-- ─── WHY NAMING person-BLOCKS IS NOT A LEAK ─────────────────────────────────
--
-- The viewer of this list is the person who did the blocking. Both facts — who, and why —
-- are their own actions reflected back at them. There is no second party to protect: the
-- blocked person never sees this list.
--
-- The genuine constraint is the INVERSE, and it is kept: never name a review-block,
-- because that is the one case where the blocker may know the person only as an anonymous
-- reviewer. block_user() is reachable only from a profile page or a conversation, where
-- the name was on screen when the button was pressed.
--
-- ─── ⚠ WHY DEFAULTING EVERY EXISTING ROW TO 'content' IS A FACT, NOT A HOPE ──
--
-- "Every existing row is a review-block" will read as an assumption to whoever finds this
-- later. It is not. Three independent things make it true, and all three are checkable:
--
--   1. THE CLIENT NEVER INSERTS INTO blocks. Grepping the app for from('blocks') finds
--      exactly two call sites, a SELECT and a DELETE. Every row was written by one of the
--      two SECURITY DEFINER functions below and by nothing else.
--   2. block_user() DID NOT EXIST until 20261029. Before that, block_content_author() was
--      the only writer in the database — so any row older than that migration is a
--      review-block by construction, not by inference.
--   3. MODULE_FLAGS.studentHub HAS NEVER BEEN TRUE in a shipped build. block_user() is
--      reachable only from the Student Hub's profile page and conversation screen, so no
--      real user has ever been able to call it.
--
-- So the backfill is not a cautious guess that happens to be safe; it is provably correct.
-- If any of the three ever stops being true, this reasoning expires with it — which is why
-- it is written down rather than left as a default nobody can explain.
--
-- The DEFAULT is 'content' for a second reason as well, the towing_companies.is_active
-- inversion (20260907): a banner protects the one path somebody wrote, a default protects
-- every path nobody has written yet. A future writer that forgets to set origin produces
-- an UNNAMED row, which is the direction that cannot leak.

BEGIN;

-- ─── 0. Guards ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.blocks') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: public.blocks does not exist. Nothing applied.';
  END IF;
  IF to_regprocedure('public.block_user(uuid)') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: block_user(uuid) is missing — 20261029 has not been applied here. Nothing applied.';
  END IF;
  IF to_regprocedure('public.block_content_author(text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: block_content_author(text,uuid) is missing. Nothing applied.';
  END IF;
  RAISE NOTICE '20261032: % existing block row(s) will be classified as review-blocks.',
    (SELECT count(*) FROM public.blocks);
END $$;

-- ─── 1. The column ──────────────────────────────────────────────────────────
ALTER TABLE public.blocks
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'content';

ALTER TABLE public.blocks DROP CONSTRAINT IF EXISTS blocks_origin_check;
ALTER TABLE public.blocks ADD  CONSTRAINT blocks_origin_check
  CHECK (origin IN ('content', 'person'));

COMMENT ON COLUMN public.blocks.origin IS
  'Which path created this block. content = block_content_author (an anonymous review '
  'author — NEVER show a name); person = block_user (a profile or conversation, where the '
  'blocker already knew the name). DEFAULT content so an unclassified row is unnamed, '
  'which is the direction that cannot leak.';

-- ─── 2. The two writers, carried over verbatim except for the origin value ──
--
-- Both bodies are spliced from their own migrations (20261029 and 20260718) rather than
-- retyped, and each replacement was diffed against the original before this file ran. A
-- draft of 20261031 retyped a body from memory and silently replaced nine languages of
-- notification copy with a call to a function that does not exist here; CREATE OR REPLACE
-- reports success either way.
CREATE OR REPLACE FUNCTION public.block_user(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL OR is_anonymous_session() THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_user_id IS NULL OR p_user_id = v_me THEN RAISE EXCEPTION 'INVALID_TARGET'; END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'NO_SUCH_USER';
  END IF;

  -- ► origin = 'person' NAMES THIS ROW in the blocked list. Reached only from a profile
  --   page or a conversation, so the blocker already knows who this is by name.
  --
  -- ► ON CONFLICT DO NOTHING IS LOAD-BEARING AND MUST NOT BECOME DO UPDATE.
  --   If a row already exists it was a review-block, and upgrading it to 'person' would
  --   put a name on it — telling the blocker WHICH anonymous reviewer this was. Once
  --   'content', always 'content'. The cost is that a later person-block of the same
  --   individual shows as an unnamed row; the alternative is a leak.
  INSERT INTO blocks (blocker_id, blocked_id, origin) VALUES (v_me, p_user_id, 'person')
  ON CONFLICT DO NOTHING;

  UPDATE conversations
     SET closed_at = coalesce(closed_at, now()),
         closed_by = coalesce(closed_by, v_me)
   WHERE pair_lo = least(v_me, p_user_id) AND pair_hi = greatest(v_me, p_user_id)
     AND closed_at IS NULL;
END;
$function$;

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

  -- ► NAMED EXPLICITLY THOUGH IT MATCHES THE COLUMN DEFAULT. The default is what protects
  --   every path nobody has written yet; this line is what makes THIS path's intent
  --   readable at the call site, so a future edit cannot change the default and silently
  --   start naming anonymous reviewers here.
  INSERT INTO blocks (blocker_id, blocked_id, origin)
  VALUES (auth.uid(), v_author, 'content')
  ON CONFLICT DO NOTHING;
END;
$function$;

-- ─── 3. The read path ───────────────────────────────────────────────────────
--
-- ► A DEFINER FUNCTION, BECAUSE THE APP CANNOT READ THESE NAMES AT ALL.
--   profiles RLS does not let one customer read another's row — the over-share policies
--   were dropped by 20260922 — so a client-side join here is not merely discouraged, it
--   returns nothing. Same instrument and same reason as get_student_list and
--   get_student_profile: RLS has no column dimension, so a policy wide enough to expose a
--   display name exposes the phone number beside it.
--
-- ► THE NAME IS WITHHELD SERVER-SIDE, AND THAT IS THE WHOLE POINT.
--   Returning every name and letting the screen hide some would put an anonymous
--   reviewer's name on the wire and in the client's memory, where a future refactor, a log
--   line or a debugger would find it. The CASE below is the boundary. An edit that
--   "simplifies" it to a plain p.display_name is the one change that silently breaks this,
--   which is why verify_schema asserts the CASE is still in the body.
CREATE OR REPLACE FUNCTION public.list_my_blocks()
 RETURNS TABLE(blocked_id uuid, created_at timestamptz, origin text,
               display_name text, avatar_url text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT b.blocked_id,
         b.created_at,
         b.origin,
         CASE WHEN b.origin = 'person' THEN p.display_name END,
         CASE WHEN b.origin = 'person' THEN p.avatar_url  END
    FROM blocks b
    LEFT JOIN profiles p ON p.id = b.blocked_id
   WHERE b.blocker_id = auth.uid()
   ORDER BY b.created_at DESC;
$function$;

COMMENT ON FUNCTION public.list_my_blocks() IS
  'The caller own blocks. Returns display_name and avatar_url ONLY for origin = person; a '
  'review-block returns NULL for both, server-side, because the blocker may know that '
  'author only as an anonymous reviewer.';

-- ─── 4. Grants ──────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.list_my_blocks() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_my_blocks() FROM anon;
GRANT EXECUTE ON FUNCTION public.list_my_blocks() TO authenticated;

-- ─── 5. Verification, read from the catalogue ───────────────────────────────
DO $$
DECLARE v_def text; v_n int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='blocks' AND column_name='origin') THEN
    RAISE EXCEPTION 'blocks.origin is missing after the ALTER.';
  END IF;
  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema='public' AND table_name='blocks' AND column_name='origin')
     NOT LIKE '%content%' THEN
    RAISE EXCEPTION 'blocks.origin does not default to content — an unclassified row would be NAMED.';
  END IF;

  SELECT count(*) INTO v_n FROM blocks WHERE origin <> 'content';
  IF v_n > 0 THEN
    RAISE NOTICE '20261032: % row(s) already carry origin <> content (re-apply).', v_n;
  END IF;

  IF pg_get_functiondef(to_regprocedure('public.block_user(uuid)')) NOT LIKE '%person%' THEN
    RAISE EXCEPTION 'block_user does not set origin = person.';
  END IF;
  IF pg_get_functiondef(to_regprocedure('public.block_content_author(text,uuid)')) NOT LIKE '%content%' THEN
    RAISE EXCEPTION 'block_content_author does not set origin = content.';
  END IF;
  -- …and still do what they did before. block_user closes the pair's conversations, and
  -- losing that would leave a blocked thread open — invisible from the blocked list.
  IF pg_get_functiondef(to_regprocedure('public.block_user(uuid)')) NOT LIKE '%UPDATE conversations%' THEN
    RAISE EXCEPTION 'block_user no longer closes the conversation.';
  END IF;
  IF pg_get_functiondef(to_regprocedure('public.block_content_author(text,uuid)')) NOT LIKE '%only supported for reviews%' THEN
    RAISE EXCEPTION 'block_content_author lost its review-only guard.';
  END IF;

  -- ► THE LINE A FUTURE EDIT COULD QUIETLY REMOVE.
  v_def := pg_get_functiondef(to_regprocedure('public.list_my_blocks()'));
  IF position('CASE' in v_def) = 0 OR position('person' in v_def) = 0 THEN
    RAISE EXCEPTION 'list_my_blocks no longer withholds the name server-side.';
  END IF;
  IF position('auth.uid()' in v_def) = 0 THEN
    RAISE EXCEPTION 'list_my_blocks is not scoped to the caller.';
  END IF;

  RAISE NOTICE '20261032 verified: origin defaults to content, both writers classify, names withheld server-side.';
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
VALUES ('20261032_blocks_origin.sql', '840863d3f2f1225659b829b18a002bb1de4afa0b4884839c899919ab46dd8828')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

NOTIFY pgrst, 'reload schema';
