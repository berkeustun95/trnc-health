-- ════════════════════════════════════════════════════════════════════════════
-- 20261029 — STUDENT HUB SLICE 6: MESSAGING
-- ════════════════════════════════════════════════════════════════════════════
--
-- The THIRD cross-user surface, and the first one where a customer WRITES something
-- another customer reads. Slices 4 and 5 were reads: a list and a profile, both served
-- by column-limited SECURITY DEFINER functions over rows the reader can never touch.
-- This slice adds rows that two people jointly own, and that is a different shape of
-- risk, so the whole file is built on one structural decision:
--
--   ► NOBODY HAS INSERT, UPDATE OR DELETE ON conversations OR messages. Not the owner,
--     not a participant, not an admin (except the one scoped UPDATE that moderation
--     needs). `authenticated` is granted SELECT and nothing else, and every write in the
--     app goes through a SECURITY DEFINER function in this file.
--
-- That is not belt-and-braces, it is the only way the rules below can hold. RLS HAS NO
-- COLUMN DIMENSION: a policy that lets you write a row lets you write every column of
-- it. An accept-first gate, a 1000-character cap, a snapshotted sender name, a permanent
-- decline and an age rule are all statements about WHICH COLUMNS MAY CHANGE AND WHEN,
-- and no `FOR UPDATE ... USING` can express one of them. A trigger can refuse, but a
-- trigger cannot see intent; a function that owns the only write path can.
--
--
-- ─── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
--
-- NO IMAGES. Slice 7, and it waits on CSAM detection procurement. `body` is text, the
-- table has no attachment column, and there is no storage bucket. Adding one is a
-- migration and a procurement decision, in that order.
--
-- NO READ RECEIPTS. Nothing records that a message was seen. "Seen and ignored" is a
-- pressure a stranger should not be able to apply to someone who has not accepted them.
--
-- NO EDITING. `body` is immutable, enforced by msg_40_immutable below. If a body could
-- change after insert then screening is bypassable (write clean, edit dirty) and the
-- sender-name snapshot describes a message that no longer exists.
--
-- NO AUTO-BAN, and no auto-hide. See section 4.
--
--
-- Requires 20261026 (student_education, can_see_student_lists) and 20261028
-- (get_student_profile). Section 0 refuses without them.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 0. Refuse on a database that is not ready ───────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.student_education') IS NULL THEN
    RAISE EXCEPTION 'apply 20261026 first — student_education does not exist';
  END IF;
  IF to_regprocedure('public.get_student_profile(uuid, text)') IS NULL THEN
    RAISE EXCEPTION 'apply 20261028 first — get_student_profile does not exist';
  END IF;
  IF to_regclass('public.blocks') IS NULL THEN
    RAISE EXCEPTION 'blocks is missing — 20260712 has not been applied';
  END IF;
END $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 1. conversations
-- ════════════════════════════════════════════════════════════════════════════
--
-- ─── WHY THE PAIR KEY IS A *PARTIAL* UNIQUE INDEX ───────────────────────────
--
-- The obvious design is one permanent row per pair with `UNIQUE (pair_lo, pair_hi)`.
-- It is wrong, and it is wrong in a way that only shows up months later: LEAVING a
-- conversation would then permanently prevent that pair from ever having another one,
-- because the row occupying the unique slot never goes away. Leaving would silently BE
-- a mutual block. It is explicitly not a block.
--
-- So the uniqueness is scoped to LIVE threads — at most one open conversation per pair
-- at a time, any number of settled ones in history. This is the same shape as
-- `student_education_one_open_per_user` from 20261026 (one open enrolment, any number of
-- closed ones), and it is the same reasoning: the constraint belongs on the state that
-- must be singular, not on the pair that must be re-openable.
--
-- pair_lo/pair_hi are GENERATED STORED so the pair is orientation-free: a conversation
-- A→B and a conversation B→A collide on the index whichever way round they were made.
-- Doing this in the application instead would mean every caller remembering to sort two
-- uuids, and the one that forgets creates the duplicate thread.
--
-- ─── THE FOUR END STATES, AND WHY THEY ARE FOUR COLUMNS AND NOT ONE ENUM ────
--
--   accepted_at  the recipient let it through. Now it is a conversation.
--   declined_at  the recipient said no. PERMANENT and ASYMMETRIC — see decline_conversation.
--   closed_at    somebody left. Ends the thread; does not seal the pair.
--   closed_by    WHO left, because the thread is hidden for them and visible to the other.
--
-- They are not mutually exclusive (a thread can be accepted and later closed), which is
-- exactly why a single `status` column would have to invent a precedence order and then
-- lose information the moment two of them are true.

CREATE TABLE IF NOT EXISTS public.conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ON DELETE SET NULL, not CASCADE: deleting your account must not delete the messages
  -- you sent to somebody else. They are that person's conversation too, and a reported
  -- message has to survive its author for an admin to look at. The snapshot on
  -- messages.sender_display_name is what keeps the thread readable afterwards.
  initiator_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  recipient_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),
  accepted_at     timestamptz,
  declined_at     timestamptz,
  closed_at       timestamptz,
  closed_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_message_at timestamptz,

  pair_lo uuid GENERATED ALWAYS AS
    (CASE WHEN initiator_id < recipient_id THEN initiator_id ELSE recipient_id END) STORED,
  pair_hi uuid GENERATED ALWAYS AS
    (CASE WHEN initiator_id < recipient_id THEN recipient_id ELSE initiator_id END) STORED,

  -- ► `<>`, NOT `IS DISTINCT FROM`, AND THE DIFFERENCE IS A BUG EITHER WAY ROUND.
  --   CLAUDE.md's rule — always IS DISTINCT FROM — is about ASSERTIONS, where a NULL
  --   comparison must FIRE. A CHECK is the opposite: an unknown result counts as
  --   SATISFIED, which is exactly what nullable columns need. Both participants are
  --   ON DELETE SET NULL, so once two people have deleted their accounts this row holds
  --   (NULL, NULL) — and `NULL IS DISTINCT FROM NULL` is FALSE, so the strict form would
  --   refuse the SECOND deletion. `NULL <> NULL` is NULL, which passes.
  --   Do not "correct" this to IS DISTINCT FROM.
  CONSTRAINT conversations_not_self CHECK (initiator_id <> recipient_id),
  -- You cannot both accept and decline. A decline is final, so this is a real invariant
  -- rather than a tidiness rule: if both were ever set, `awaiting acceptance` and
  -- `permanently refused` would be true at once and every gate below would disagree.
  CONSTRAINT conversations_not_both CHECK (accepted_at IS NULL OR declined_at IS NULL),
  -- ► ONE-WAY, NOT AN EQUIVALENCE, FOR THE SAME REASON. `closed_by` is ON DELETE SET
  --   NULL, so when the person who LEFT deletes their account Postgres nulls it while
  --   `closed_at` stays set. The symmetric form `(closed_at IS NULL) = (closed_by IS
  --   NULL)` then refuses the DELETE, and anybody who has ever tapped Leave or Block
  --   cannot delete their account. Same failure as the one guard_message_immutable had:
  --   a foreign key's own SET NULL is an ordinary write, and constraints see it.
  --   So: a recorded closer implies the thread is closed; a closed thread may have lost
  --   its closer. The other direction is not an invariant.
  CONSTRAINT conversations_closed_pair CHECK (closed_by IS NULL OR closed_at IS NOT NULL)
);

-- At most ONE live thread per pair. Settled threads (declined, closed) drop out of the
-- index, which is what lets the pair start again.
CREATE UNIQUE INDEX IF NOT EXISTS conversations_one_live_per_pair
  ON public.conversations (pair_lo, pair_hi)
  WHERE declined_at IS NULL
    AND closed_at IS NULL
    AND initiator_id IS NOT NULL
    AND recipient_id IS NOT NULL;

-- The decline lookup scans a pair's whole history, so it needs its own index — the
-- partial one above cannot serve it (declined rows are precisely what it excludes).
CREATE INDEX IF NOT EXISTS conversations_pair_idx
  ON public.conversations (pair_lo, pair_hi);

CREATE INDEX IF NOT EXISTS conversations_recipient_idx
  ON public.conversations (recipient_id, last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS conversations_initiator_idx
  ON public.conversations (initiator_id, last_message_at DESC NULLS LAST);

COMMENT ON TABLE public.conversations IS
  'One thread between two listed students. At most one LIVE thread per pair '
  '(conversations_one_live_per_pair); settled threads stay as history so a decline can '
  'be permanent and a leave cannot. All writes via SECURITY DEFINER functions.';
COMMENT ON COLUMN public.conversations.declined_at IS
  'PERMANENT and ONE-DIRECTIONAL: the person who declined may still initiate later; the '
  'person who was declined may never initiate to them again. Hidden from the initiator.';
COMMENT ON COLUMN public.conversations.closed_by IS
  'Who left. The thread is hidden for them and stays visible (closed) for the other '
  'party. Leaving is not a block — see block_user().';


-- ════════════════════════════════════════════════════════════════════════════
-- 2. messages
-- ════════════════════════════════════════════════════════════════════════════
--
-- ─── WHY sender_display_name IS SNAPSHOTTED HERE AND NOWHERE ELSE ───────────
--
-- `20261024`'s note argues against snapshotting names into the directory, and that still
-- holds: a directory describes who somebody IS NOW, so a stale copy there is simply
-- wrong. A message is the opposite kind of object. It is a thing SAID, at a moment, by
-- somebody with a name at that moment — and `delete_own_account` HARD-DELETES profiles
-- and auth.users, so without the snapshot every message from a departed user renders
-- with a null name and the thread becomes unreadable for the person who stayed.
--
-- Stamped by a trigger, never by the caller (msg_10_stamp_sender). A client-supplied
-- name would let anyone sign a message with somebody else's name, which is the one
-- impersonation this table could enable.

CREATE TABLE IF NOT EXISTS public.messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id     uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,

  sender_id           uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  sender_display_name text NOT NULL,

  body                text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),

  created_at          timestamptz NOT NULL DEFAULT now(),

  -- SOFT delete, for both sides, by the sender only. The row stays so a report still has
  -- something to point at: "delete for everyone" that actually deleted would let an
  -- abuser erase the evidence a moment after sending it.
  deleted_at          timestamptz,

  -- Admin moderation, same two columns as every other UGC table in this schema.
  hidden_at           timestamptz,
  hidden_reason       text
);

CREATE INDEX IF NOT EXISTS messages_conversation_idx
  ON public.messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS messages_sender_idx
  ON public.messages (sender_id);

COMMENT ON TABLE public.messages IS
  'Text only, 1-1000 chars, immutable body. No attachments (slice 7, gated on CSAM '
  'detection). Links are rendered as PLAIN TEXT by the client and are never tappable.';
COMMENT ON COLUMN public.messages.sender_display_name IS
  'Server-stamped snapshot (msg_10_stamp_sender). Keeps a thread readable after the '
  'sender deletes their account, which hard-deletes profiles.';


-- ════════════════════════════════════════════════════════════════════════════
-- 3. conversation_attempts — the rate-limit denominator, and an audit trail
-- ════════════════════════════════════════════════════════════════════════════
--
-- ─── THIS TABLE EXISTS BECAUSE A REFUSAL CREATES NO CONVERSATION ────────────
--
-- The cap is 50 NEW conversations per day and it must count EVERYTHING that consumed a
-- slot — declined, blocked, refused on age. If it counted only successes, the cheapest
-- way to send 500 openers would be to be unwelcome, and an account that is being
-- refused everywhere is exactly the account the cap exists to slow down. But a refused
-- attempt creates no `conversations` row, so there is nothing in that table to count.
--
-- ► AND THIS IS WHY start_conversation RETURNS A STATUS FOR REFUSALS INSTEAD OF RAISING.
--   `RAISE EXCEPTION` aborts the transaction and takes the attempt row with it — always,
--   not usually. That is the same trap `20260926` hit when it tried to log blocked terms
--   from the trigger that rejects them, and the result there was a logger that ran on
--   every rejection and stayed empty forever. A refusal that cannot be counted is a
--   refusal that cannot be capped.
--
--   So the RPC splits on a real line, and the line is stated once here:
--     RAISE    — "you cannot make this call": not signed in, not listed, over the cap,
--                body too long, thread already open. Nothing was attempted; nothing to
--                count; the client shows an error.
--     RETURN   — "you made the call and were refused": blocked, not listed, declined
--                before, refused on age. The attempt happened, the row commits, the slot
--                is spent, and the caller gets ONE indistinguishable word.
--
-- ─── PRIVACY: THIS IS A NEW DATA CATEGORY AND IT IS NOT LIKE THE OTHERS ─────
--
-- It records "X tried to reach Y", including every adult who tried to open a
-- conversation with a minor. That is precisely the pattern an admin needs to see, and
-- precisely the sort of table that should not exist a day longer than it is useful:
--   * ADMIN READ ONLY. The initiator cannot read their own attempts — a person who
--     could list their own refusals has an oracle for who blocked them.
--   * PURGED AT 30 DAYS by cron, exactly like moderation_rejections.
--   * No message body is stored here. What was attempted is in `messages` if it landed
--     and nowhere at all if it did not.

CREATE TABLE IF NOT EXISTS public.conversation_attempts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  initiator_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  outcome      text NOT NULL CHECK (outcome IN ('sent', 'refused')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversation_attempts_rate_idx
  ON public.conversation_attempts (initiator_id, created_at DESC);

COMMENT ON TABLE public.conversation_attempts IS
  'Denominator for the 50-new-conversations-per-day cap, counting refusals too — a '
  'refused attempt creates no conversations row, so it has to be recorded here. Admin '
  'read only (an initiator reading their own refusals is a block oracle). Purged at 30d.';


-- ════════════════════════════════════════════════════════════════════════════
-- 4. The two moderation vocabularies grow one value each
-- ════════════════════════════════════════════════════════════════════════════
--
-- ► BOTH OF THESE MOVE A NUMBER THAT verify_schema.sql PINS. The `content_reports`
--   token that asserts the admitted type list is bumped from 6 values to 7 IN THE SAME
--   COMMIT as this file. That edit is the review moment, and it is the whole point of
--   pinning the derived array rather than a remembered name.

ALTER TABLE public.content_reports DROP CONSTRAINT IF EXISTS content_reports_content_type_check;
ALTER TABLE public.content_reports ADD CONSTRAINT content_reports_content_type_check
  CHECK (content_type IN ('answer','facility','message','place','profile','question','review'));

ALTER TABLE public.moderation_rejections DROP CONSTRAINT IF EXISTS moderation_rejections_content_type_check;
ALTER TABLE public.moderation_rejections ADD CONSTRAINT moderation_rejections_content_type_check
  CHECK (content_type IN ('review','question','answer','facility','change_request','place','message'));

-- ─── NO auto_hide_reported_content BRANCH FOR MESSAGES, ON PURPOSE ──────────
--
-- That function hides content at 3 DISTINCT reporters. A message has exactly two people
-- who can see it, so the threshold is unreachable and a branch for it would be dead code
-- that looks like a safeguard. Reported messages go to admin triage and nowhere else.
--
-- ─── AND NO AUTO-BAN ON REPEATED SCREENING HITS ─────────────────────────────
--
-- `blocked_terms` WAS CURATED FOR PUBLIC CONTENT — reviews, facility names, place
-- descriptions. It matches on a word boundary over a normalized form, which means it
-- catches PROFANITY and it CANNOT CATCH GROOMING: there is no word to list. Swearing
-- between two people who have accepted each other is also a different problem from
-- swearing in a public review, and the same list is currently answering both questions.
-- A message-specific view of that list may be wanted later.
--
-- Screening here is A FLOOR, NOT A SOLUTION, and that is the argument against banning on
-- it automatically: the matcher has known false positives (the entire exact/contains
-- split in `reserved_names` exists because of them), and an automatic ban on a fuzzy
-- match punishes an innocent person with no human in the loop. `moderation_rejections`
-- gives an admin the pattern; an admin acts on it.

COMMENT ON CONSTRAINT moderation_rejections_content_type_check ON public.moderation_rejections IS
  'Adds ''message'' (20261029). blocked_terms was curated for PUBLIC content and matches '
  'profanity on a word boundary; it cannot catch grooming. A floor, not a solution — '
  'which is why nothing auto-bans on a hit.';


-- ════════════════════════════════════════════════════════════════════════════
-- 5. Helpers
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 5a. is_listed_student(uuid) — the reciprocity rule, for ANY user ────────
--
-- `can_see_student_lists()` answers this for auth.uid() only, and messaging needs the
-- same question about the RECIPIENT. Rather than restate the predicate (two copies of a
-- privacy rule, and the copy that drifts is the one that lets somebody lurk), the general
-- form is defined here and can_see_student_lists is REPLACED to delegate to it. Same
-- wrapper move `20260926` made when contains_blocked_term became a thin shell over
-- blocked_term_hit. One rule, one place, six call sites.
CREATE OR REPLACE FUNCTION public.is_listed_student(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM student_education e
      JOIN profiles p ON p.id = e.user_id
     WHERE e.user_id = p_user_id
       AND e.listing_opt_in
       AND p.display_name IS NOT NULL
       AND (p.ugc_banned_until IS NULL OR p.ugc_banned_until <= now())
  );
$function$;

COMMENT ON FUNCTION public.is_listed_student(uuid) IS
  'Is this person visible in the Student Hub: opted in, named, not UGC-banned. The '
  'general form of can_see_student_lists(), which now delegates to it.';

CREATE OR REPLACE FUNCTION public.can_see_student_lists()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Unchanged in meaning from 20261026: a non-anonymous caller who is themselves listed.
  -- The `is_anonymous_session()` half stays HERE and is not pushed into
  -- is_listed_student, because it is a fact about the CALLER's session, not about a user.
  SELECT NOT public.is_anonymous_session()
     AND public.is_listed_student(auth.uid());
$function$;


-- ─── 5b. may_initiate_by_age — the age rule ─────────────────────────────────
--
-- ► ADULTS CANNOT INITIATE CONTACT WITH UNDER-18s. Minor→minor is fine, adult→adult is
--   fine, minor→adult is fine. Only adult→minor is refused.
--
-- 18 is mirrored from ADULT_AGE in constants/profileGate.js and `npm run profile:check`
-- fails if the two halves disagree. Same contract as MIN_SIGNUP_AGE, and for the same
-- reason a CHECK constraint cannot hold it: CURRENT_DATE is STABLE, a CHECK needs
-- IMMUTABLE, so a trigger and a function are the only places the number can live.
--
-- ─── HOW IT HANDLES AN UNKNOWN DATE OF BIRTH, WHICH IS THE WHOLE DESIGN ─────
--
-- The naive form — `NOT (sender_is_adult AND recipient_is_minor)` — FAILS OPEN on a null
-- date of birth, because an unknown sender is not `sender_is_adult` and the rule simply
-- does not fire. That is backwards: a null DOB is the case where we know least, and it
-- would be the case we allow.
--
-- So the rule is stated as a positive ALLOW with two named escapes, and everything else
-- is refused:
--
--   ALLOW if the SENDER is a KNOWN MINOR      → minor→anyone is never the harm here
--   ALLOW if the RECIPIENT is a KNOWN ADULT   → no child is on the receiving end
--   otherwise REFUSE
--
--   sender    recipient   result   why
--   adult     adult       allow    recipient is a known adult
--   adult     minor       REFUSE   ← the rule
--   minor     minor       allow    sender is a known minor
--   minor     adult       allow    both escapes
--   null      adult       allow    recipient is a known adult; no child at risk
--   null      minor       REFUSE   cannot rule out an adult sender
--   null      null        REFUSE   cannot rule out adult→child
--   adult     null        REFUSE   cannot rule out a child recipient
--   minor     null        allow    sender is a known minor
--
-- The four refusals on null are strict, and they are meant to be: everyone who can reach
-- this function completed the profile wizard, which collects date_of_birth, so a null
-- here is an anomaly rather than an ordinary user. An anomaly should not be the hole.
CREATE OR REPLACE FUNCTION public.may_initiate_by_age(p_sender uuid, p_recipient uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sender    date;
  v_recipient date;
  v_cutoff    date := (current_date - interval '18 years')::date;  -- ADULT_AGE
BEGIN
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

COMMENT ON FUNCTION public.may_initiate_by_age(uuid, uuid) IS
  'Adults cannot initiate contact with under-18s. Stated as a positive ALLOW so that an '
  'unknown date_of_birth fails CLOSED — the naive NOT(adult AND minor) form allows every '
  'null. Enforced twice: in start_conversation and in msg_20_age_rule.';


-- ════════════════════════════════════════════════════════════════════════════
-- 6. Triggers on messages
-- ════════════════════════════════════════════════════════════════════════════
--
-- ► THE NUMERIC PREFIXES ARE LOAD-BEARING. Postgres fires triggers of the same kind on
--   the same table IN NAME ORDER, alphabetically. Names like `stamp_sender` and
--   `check_age` would fire in an order nobody chose and that changes if one is renamed.
--   None of these four actually depend on each other today — but "they happen to be
--   independent" is a property somebody can break without noticing, and the prefix makes
--   the order a decision rather than an accident.

-- ─── 6a. msg_10_stamp_sender ────────────────────────────────────────────────
-- SECURITY DEFINER so it cannot be defeated by a future tightening of the profiles
-- policies: if this ever returned NULL the NOT NULL would abort the send, which is a
-- loud failure rather than a silent one, but a stamp that depends on a policy is a stamp
-- that stops working the day somebody changes the policy.
CREATE OR REPLACE FUNCTION public.stamp_message_sender()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- The CALLER never supplies this. Whatever arrived is discarded.
  SELECT display_name INTO NEW.sender_display_name FROM profiles WHERE id = NEW.sender_id;
  IF NEW.sender_display_name IS NULL THEN
    RAISE EXCEPTION 'NO_DISPLAY_NAME';
  END IF;
  RETURN NEW;
END;
$function$;

-- ─── 6b. msg_20_age_rule ────────────────────────────────────────────────────
-- The second of the two enforcement points, and the one that matters in a year's time.
-- start_conversation checks the rule too, but a rule enforced only inside one function
-- is a rule that lasts exactly until somebody writes a second way to insert a message —
-- an admin tool, an import, a reply-by-email worker. This one sits on the table.
--
-- It is evaluated against the CONVERSATION's direction, not the message's: the rule is
-- about who INITIATED, and it holds for every message in a thread that should never have
-- existed.
CREATE OR REPLACE FUNCTION public.enforce_message_age_rule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_initiator uuid;
  v_recipient uuid;
BEGIN
  SELECT initiator_id, recipient_id INTO v_initiator, v_recipient
    FROM conversations WHERE id = NEW.conversation_id;

  -- A deleted participant leaves a null here. Nothing can be sent into such a thread
  -- anyway (send_message requires both), so this is a belt on an already-closed path.
  IF v_initiator IS NULL OR v_recipient IS NULL THEN
    RAISE EXCEPTION 'CONVERSATION_CLOSED';
  END IF;

  IF NOT may_initiate_by_age(v_initiator, v_recipient) THEN
    RAISE EXCEPTION 'AGE_RULE';
  END IF;

  RETURN NEW;
END;
$function$;

-- ─── 6c. msg_40_immutable ───────────────────────────────────────────────────
-- `authenticated` is granted UPDATE on messages for exactly one reason — the admin
-- moderation policy in section 8 — and an UPDATE grant is column-blind. This is what
-- keeps it to the two columns moderation actually needs.
CREATE OR REPLACE FUNCTION public.guard_message_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.body                IS DISTINCT FROM OLD.body
     OR NEW.sender_display_name IS DISTINCT FROM OLD.sender_display_name
     OR NEW.conversation_id     IS DISTINCT FROM OLD.conversation_id
     OR NEW.created_at          IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'MESSAGE_IMMUTABLE';
  END IF;

  -- ► sender_id GETS ITS OWN CLAUSE, AND THE REASON IS NOT COSMETIC.
  --   The flat `NEW.sender_id IS DISTINCT FROM OLD.sender_id` this started as also blocks
  --   the FOREIGN KEY'S OWN `ON DELETE SET NULL`, which Postgres performs as an ordinary
  --   UPDATE that fires this trigger. The effect is that delete_own_account RAISES for
  --   any user who has ever sent a message — account deletion, which we are obliged to
  --   honour, broken by a guard meant to protect the messages. Caught by the test that
  --   deletes an account, never by reading the trigger.
  --   So: a sender may become NULL (they left), and may never become anyone else.
  IF NEW.sender_id IS DISTINCT FROM OLD.sender_id AND NEW.sender_id IS NOT NULL THEN
    RAISE EXCEPTION 'MESSAGE_IMMUTABLE';
  END IF;

  RETURN NEW;
END;
$function$;

-- ─── 6d. msg_50_touch_conversation ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_conversation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE conversations SET last_message_at = NEW.created_at WHERE id = NEW.conversation_id;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS msg_10_stamp_sender       ON public.messages;
DROP TRIGGER IF EXISTS msg_20_age_rule           ON public.messages;
DROP TRIGGER IF EXISTS msg_30_ugc_screen         ON public.messages;
DROP TRIGGER IF EXISTS msg_40_immutable          ON public.messages;
DROP TRIGGER IF EXISTS msg_50_touch_conversation ON public.messages;

CREATE TRIGGER msg_10_stamp_sender
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.stamp_message_sender();

CREATE TRIGGER msg_20_age_rule
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_message_age_rule();

-- The EXISTING screening trigger, bound to this table's text column. No new matcher, no
-- second copy of the rule: `check_ugc_on_insert` reads `to_jsonb(NEW) ->> TG_ARGV[0]`,
-- which is why it needs no change to cover a table it has never seen. It also clears
-- hidden_at/hidden_reason for non-admins, so a client cannot post a pre-hidden message.
CREATE TRIGGER msg_30_ugc_screen
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.check_ugc_on_insert('body');

CREATE TRIGGER msg_40_immutable
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.guard_message_immutable();

CREATE TRIGGER msg_50_touch_conversation
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_conversation();


-- ════════════════════════════════════════════════════════════════════════════
-- 7. Push
-- ════════════════════════════════════════════════════════════════════════════
--
-- ► AN UNACCEPTED CONVERSATION'S NOTIFICATION CARRIES NO NAME AND NO CONTENT.
--
-- Push is the one part of this feature that reaches someone who has not agreed to be
-- reached. Before acceptance the notification says only that somebody wants to message
-- them — because otherwise the first thing an abusive stranger sends lands on a lock
-- screen, in front of whoever is in the room, BEFORE the recipient has had any chance to
-- decline. After acceptance the name and the text are fine; the recipient chose it.
--
-- The IN-APP list still shows the opener in full, and that is deliberate rather than
-- inconsistent: the recipient has to read it to decide whether to accept, and the phone
-- in their hand is a different audience from the lock screen on the table.
--
-- Title and body are built HERE from the stored row. A push function taking a
-- caller-supplied title would let any sender put arbitrary text on a stranger's lock
-- screen, which is the abuse this whole section is about.
CREATE OR REPLACE FUNCTION public.notify_new_message(p_message_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_to       uuid;
  v_accepted boolean;
  v_name     text;
  v_body     text;
  v_lang     text;
  v_token    text;
  v_title    text;
  v_text     text;
BEGIN
  SELECT CASE WHEN m.sender_id = c.initiator_id THEN c.recipient_id ELSE c.initiator_id END,
         c.accepted_at IS NOT NULL, m.sender_display_name, m.body
    INTO v_to, v_accepted, v_name, v_body
    FROM messages m JOIN conversations c ON c.id = m.conversation_id
   WHERE m.id = p_message_id;

  IF v_to IS NULL THEN RETURN; END IF;

  SELECT coalesce(preferred_language, 'English'), push_token
    INTO v_lang, v_token FROM profiles WHERE id = v_to;

  IF v_accepted THEN
    v_title := v_name;
    v_text  := left(v_body, 140);
  ELSE
    -- No name, no content, and no count either — "3 people want to message you" is
    -- itself information about how exposed somebody is.
    --
    -- ALL NINE LANGUAGES, with an English fallback, in the shape module_notif_text()
    -- already uses. An English/Turkish CASE would have been two lines and would have put
    -- English on the lock screen of every Greek, Persian, Arabic, Russian, French,
    -- Spanish and German user — and this is the ONE notification that reaches somebody
    -- who has not agreed to be reached, so it is the worst one to leave untranslated.
    -- preferred_language holds FULL ENGLISH NAMES ('Turkish'), never ISO codes: an ISO
    -- comparison never errors, it just matches nothing and silently falls back.
    SELECT coalesce(t.title, 'New message request'), coalesce(t.body, 'Someone wants to message you.')
      INTO v_title, v_text
      FROM (VALUES
        ('English', 'New message request',  'Someone wants to message you.'),
        ('Turkish', 'Yeni mesaj isteği',    'Biri sana mesaj göndermek istiyor.'),
        ('Arabic',  'طلب رسالة جديد',        'شخص ما يريد مراسلتك.'),
        ('Russian', 'Новый запрос на переписку', 'Кто-то хочет написать вам.'),
        ('Greek',   'Νέο αίτημα μηνύματος', 'Κάποιος θέλει να σας στείλει μήνυμα.'),
        ('French',  'Nouvelle demande de message', 'Quelqu''un souhaite vous écrire.'),
        ('Spanish', 'Nueva solicitud de mensaje',  'Alguien quiere enviarte un mensaje.'),
        ('German',  'Neue Nachrichtenanfrage',     'Jemand möchte dir schreiben.'),
        ('Persian', 'درخواست پیام جدید',    'کسی می‌خواهد به شما پیام بدهد.')
      ) AS t(lang, title, body)
     WHERE t.lang = v_lang;

    IF v_title IS NULL THEN
      v_title := 'New message request';
      v_text  := 'Someone wants to message you.';
    END IF;
  END IF;

  INSERT INTO notifications (user_id, title, body) VALUES (v_to, v_title, v_text);

  IF v_token IS NOT NULL THEN
    PERFORM net.http_post(
      url     := 'https://exp.host/--/api/v2/push/send',
      body    := jsonb_build_object('to', v_token, 'title', v_title, 'body', v_text, 'sound', 'default'),
      headers := jsonb_build_object('Content-Type', 'application/json'));
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.notify_new_message(uuid) IS
  'Push for every message. Before acceptance the notification carries NO name and NO '
  'content — unsolicited abuse must not land on a lock screen ahead of the decline. '
  'Title and body are built from the stored row, never supplied by the caller.';


-- ════════════════════════════════════════════════════════════════════════════
-- 8. The write path — SECURITY DEFINER, and the only one there is
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 8a. start_conversation ─────────────────────────────────────────────────
--
-- Returns 'sent' or 'refused'. See section 3 for why a refusal returns instead of
-- raising, and for the line between the two.
--
-- ► THE REFUSAL IS ONE WORD FOR FOUR DIFFERENT REASONS, AND THAT IS NOT LAZINESS.
--   Blocked, not listed, previously declined and refused-on-age all return 'refused'.
--   If refused-on-age had its own code, an adult could type a uuid and learn that the
--   person behind it is a child. Distinguishing the reasons would turn this function
--   into an age oracle pointed at specific named children, which is worse than anything
--   the distinct error messages would have made easier.
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
  -- `check_report_rate_limit` shipped with, where a non-admin counting an admin-read
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

COMMENT ON FUNCTION public.start_conversation(uuid, text) IS
  'Opens a thread with one message. RAISES for "you cannot make this call" (auth, not '
  'listed, over the 50/day cap, body length, thread already open); RETURNS ''refused'' '
  'for "you called and were refused" (blocked, unlisted, previously declined, age rule) '
  'so the attempt row survives to be counted. One word for all four: distinguishing them '
  'makes this an age oracle.';


-- ─── 8b. send_message ───────────────────────────────────────────────────────
--
-- ► WHY A DECLINE LOOKS EXACTLY LIKE SILENCE TO THE INITIATOR.
--   declined_at is hidden from the initiator in the SELECT policy, and this function
--   keeps that consistent: an initiator sending into a declined thread gets
--   AWAITING_ACCEPTANCE, the same answer they get when the recipient simply has not
--   replied. If a decline produced its own error, "she declined me" would be a fact the
--   app hands to somebody who has already been told no once, and the people most likely
--   to check are the people that matters most for. It reads as no reply, which is both
--   safer and kinder — and it is what happens offline anyway.
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
$function$;


-- ─── 8c. accept / decline / leave ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.accept_conversation(p_conversation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c conversations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR is_anonymous_session() THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO c FROM conversations WHERE id = p_conversation_id;
  -- Only the RECIPIENT accepts. An initiator accepting their own opener would defeat
  -- accept-first entirely.
  IF c.id IS NULL OR c.recipient_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'NO_SUCH_CONVERSATION';
  END IF;
  IF c.declined_at IS NOT NULL OR c.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'CONVERSATION_CLOSED';
  END IF;
  UPDATE conversations SET accepted_at = coalesce(accepted_at, now()) WHERE id = c.id;
END;
$function$;

-- ► A DECLINE IS PERMANENT AND ONE-DIRECTIONAL.
--   Permanent, because a decline that can be reopened is decorative — if the person you
--   turned down can try again next week, you have not declined anything, you have
--   snoozed it.
--   One-directional, because "I do not want to hear from you" is not the same statement
--   as "this pair is sealed". The person who declined may change their mind and start a
--   conversation themselves; the person who was declined may not. That asymmetry is the
--   whole meaning of the word, and it is enforced in start_conversation's decline scan
--   by the `initiator_id = v_me` clause — without it, a decline would silently become a
--   mutual block on whoever happened to ask first.
CREATE OR REPLACE FUNCTION public.decline_conversation(p_conversation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c conversations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR is_anonymous_session() THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO c FROM conversations WHERE id = p_conversation_id;
  IF c.id IS NULL OR c.recipient_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'NO_SUCH_CONVERSATION';
  END IF;
  IF c.accepted_at IS NOT NULL THEN
    -- Already accepted: the action you want is Leave. (conversations_not_both would
    -- refuse this anyway; saying so is friendlier than a constraint violation.)
    RAISE EXCEPTION 'ALREADY_ACCEPTED';
  END IF;
  UPDATE conversations SET declined_at = coalesce(declined_at, now()) WHERE id = c.id;
END;
$function$;

-- ► LEAVE HIDES THE THREAD FOR THE LEAVER *AND* CLOSES IT FOR BOTH.
--   Hiding alone would be meaningless: the next message would resurface the thread and
--   leaving would have achieved nothing but a pause.
--
--   ► AND LEAVE IS NOT A DEFENCE. The other person is not blocked — they can open a NEW
--     conversation with you tomorrow (the partial unique index is what allows that, and
--     allowing it is the point: otherwise leaving would be a permanent secret block that
--     neither party could see or undo). If you want somebody to stop, that is block_user,
--     and the UI must not present Leave where Block belongs. People reach for the softer
--     word at the worst moment.
CREATE OR REPLACE FUNCTION public.leave_conversation(p_conversation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c conversations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR is_anonymous_session() THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO c FROM conversations WHERE id = p_conversation_id;
  IF c.id IS NULL OR auth.uid() NOT IN (coalesce(c.initiator_id, '00000000-0000-0000-0000-000000000000'::uuid),
                                        coalesce(c.recipient_id, '00000000-0000-0000-0000-000000000000'::uuid)) THEN
    RAISE EXCEPTION 'NO_SUCH_CONVERSATION';
  END IF;
  UPDATE conversations
     SET closed_at = coalesce(closed_at, now()),
         closed_by = coalesce(closed_by, auth.uid())
   WHERE id = c.id;
END;
$function$;


-- ─── 8d. delete_message — the SENDER only ───────────────────────────────────
--
-- ► A RECIPIENT CANNOT DELETE WHAT WAS SAID TO THEM. Delete-for-both-sides is the
--   sender withdrawing their own words; a recipient doing it is not withdrawal, it is
--   erasing something somebody said to them — and the person most motivated to erase a
--   message they received is the one who wants it gone before it is reported. The
--   recipient's remedies are Report, Block and Leave, all of which keep the evidence.
--
-- Soft, so moderation keeps its copy either way.
CREATE OR REPLACE FUNCTION public.delete_message(p_message_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR is_anonymous_session() THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  UPDATE messages SET deleted_at = coalesce(deleted_at, now())
   WHERE id = p_message_id AND sender_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_SUCH_MESSAGE';
  END IF;
END;
$function$;


-- ─── 8e. block_user — blocking a PERSON ─────────────────────────────────────
--
-- `blocks` has existed since 20260712 and slice 4's RPC already honours it in both
-- directions, but until now the only way to CREATE one was the review flow: you had to
-- find something somebody wrote and block the author of it. That is
-- `block_content_author(content_type, content_id)`, and its content-type indirection is
-- wrong for this — blocking a person is not blocking the author of a thing. Hence a
-- plain function taking a person.
--
-- Blocking also CLOSES any live thread between the two, because a block that left the
-- thread open would be a block you could still be messaged through.
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

  INSERT INTO blocks (blocker_id, blocked_id) VALUES (v_me, p_user_id)
  ON CONFLICT DO NOTHING;

  UPDATE conversations
     SET closed_at = coalesce(closed_at, now()),
         closed_by = coalesce(closed_by, v_me)
   WHERE pair_lo = least(v_me, p_user_id) AND pair_hi = greatest(v_me, p_user_id)
     AND closed_at IS NULL;
END;
$function$;

COMMENT ON FUNCTION public.block_user(uuid) IS
  'Blocks a PERSON (the profile page and the thread menu), as opposed to '
  'block_content_author which blocks the author of a piece of content. Also closes any '
  'live conversation — a block you can still be messaged through is not a block.';


-- ─── 8f. list_conversations — the thread list ───────────────────────────────
--
-- COLUMN-LIMITED SECURITY DEFINER, the same instrument as get_student_list and
-- get_student_profile, for the same reason: the other participant's display_name and
-- avatar_url have to cross the RLS boundary, and RLS has no column dimension, so a
-- policy on `profiles` that exposed those two would expose phone, date_of_birth,
-- nationality, push_token and the ban timestamps with them. That is the defect
-- `20260922` dropped and this file will not reintroduce.
--
-- Nine columns. Nothing here reveals anything the caller could not already see by
-- opening the thread.
CREATE OR REPLACE FUNCTION public.list_conversations()
 RETURNS TABLE (
   conversation_id  uuid,
   other_user_id    uuid,
   display_name     text,
   avatar_url       text,
   is_accepted      boolean,
   awaiting_me      boolean,
   is_closed        boolean,
   last_message_at  timestamptz,
   last_body        text
 )
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL OR is_anonymous_session() THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT can_see_student_lists() THEN RAISE EXCEPTION 'NOT_LISTED'; END IF;

  RETURN QUERY
  SELECT c.id,
         o.id,
         o.display_name,
         o.avatar_url,
         c.accepted_at IS NOT NULL,
         -- Only the recipient is ever "awaiting me". The initiator is never told a
         -- decline happened, so for them an unaccepted thread simply has no reply.
         (c.recipient_id = v_me AND c.accepted_at IS NULL AND c.declined_at IS NULL),
         -- ► A BLOCK MUST READ AS "CLOSED", NEVER AS "GONE". block_user() closes the
         --   thread, so a block and a leave normally look identical here — which is the
         --   rule: the blocked party is told the conversation is closed, never that they
         --   were blocked. The older block_content_author() path does NOT close anything
         --   though, so without this clause a thread blocked from the review flow would
         --   sit in the list looking live while every send returned CONVERSATION_CLOSED.
         --   Note what this deliberately does NOT do: it does not FILTER the row out. A
         --   thread that vanishes when a leave would have left it visible is exactly the
         --   signal that tells somebody they were blocked.
         (c.closed_at IS NOT NULL
          OR EXISTS (SELECT 1 FROM blocks b
                      WHERE (b.blocker_id = v_me AND b.blocked_id = o.id)
                         OR (b.blocker_id = o.id AND b.blocked_id = v_me))),
         c.last_message_at,
         -- The opener IS shown in full in-app even before acceptance: the recipient has
         -- to read it to decide. Push is the surface that stays blank, not this one.
         (SELECT m.body FROM messages m
           WHERE m.conversation_id = c.id AND m.deleted_at IS NULL AND m.hidden_at IS NULL
           ORDER BY m.created_at DESC LIMIT 1)
    FROM conversations c
    JOIN profiles o
      ON o.id = CASE WHEN c.initiator_id = v_me THEN c.recipient_id ELSE c.initiator_id END
   WHERE (c.initiator_id = v_me OR c.recipient_id = v_me)
     -- The leaver does not see what they left. The other party still does.
     AND c.closed_by IS DISTINCT FROM v_me
     -- A declined thread is gone from the decliner's list, and INVISIBLE AS DECLINED to
     -- the initiator: it drops out of their list too, reading as a conversation that was
     -- never answered rather than one that was refused.
     AND NOT (c.declined_at IS NOT NULL)
   ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC;
END;
$function$;


-- ════════════════════════════════════════════════════════════════════════════
-- 9. RLS
-- ════════════════════════════════════════════════════════════════════════════
--
-- ─── WHY THIS IS NOT SLICE 4's EMBEDDING PROBLEM ────────────────────────────
--
-- Slice 4's lesson was that a policy on `profiles` letting listed students read each
-- other would leak the WHOLE ROW through a PostgREST embed — `select=*,profiles(*)` —
-- because RLS decides rows and PostgREST decides columns.
--
-- ► NOTHING IN THIS FILE ADDS A POLICY TO `profiles`. That is the answer, and it is
--   structural rather than careful. `messages.sender_id` and `conversations.*_id` are
--   foreign keys, so PostgREST WILL offer an embed on them — and that embed resolves
--   under the profiles policies as they already stand, which means the caller gets their
--   own row and nothing else. The cross-user data that legitimately reaches the other
--   party travels two ways only: as `messages.sender_display_name`, a snapshot column on
--   a table the reader is a participant of, and through `list_conversations()`, which is
--   column-limited by its own signature. Neither is a policy, so neither can be widened
--   by a URL.
--
-- The tables themselves get SELECT policies and no write policies at all.

ALTER TABLE public.conversations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_attempts ENABLE ROW LEVEL SECURITY;

-- ─── conversations ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "conversations participant read" ON public.conversations;
CREATE POLICY "conversations participant read" ON public.conversations
  FOR SELECT TO authenticated
  USING (
    NOT is_anonymous_session()
    AND closed_by IS DISTINCT FROM auth.uid()          -- hidden for whoever left
    AND (
      recipient_id = auth.uid()
      -- The initiator loses sight of a thread the moment it is declined. Together with
      -- send_message's AWAITING_ACCEPTANCE this is what makes a decline read as silence:
      -- there is no row to inspect a declined_at on.
      OR (initiator_id = auth.uid() AND declined_at IS NULL)
    )
  );

-- No admin policy on conversations, deliberately. Moderation reads a REPORTED MESSAGE
-- (below); thread metadata — who talks to whom, how often, when — is not something a
-- report should unlock, and it is the part of this feature that most resembles
-- surveillance if it is readable in bulk.

DROP POLICY IF EXISTS "no_anon_insert_conversations" ON public.conversations;
CREATE POLICY "no_anon_insert_conversations" ON public.conversations
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (false);
DROP POLICY IF EXISTS "no_anon_update_conversations" ON public.conversations;
CREATE POLICY "no_anon_update_conversations" ON public.conversations
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (false);
DROP POLICY IF EXISTS "no_anon_delete_conversations" ON public.conversations;
CREATE POLICY "no_anon_delete_conversations" ON public.conversations
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (false);

-- ─── messages ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "messages participant read" ON public.messages;
CREATE POLICY "messages participant read" ON public.messages
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND hidden_at IS NULL
    AND EXISTS (
      SELECT 1 FROM conversations c
       WHERE c.id = messages.conversation_id
         AND NOT is_anonymous_session()
         AND c.closed_by IS DISTINCT FROM auth.uid()
         AND (c.recipient_id = auth.uid()
              OR (c.initiator_id = auth.uid() AND c.declined_at IS NULL))
    )
  );

-- ► ADMIN SEES A REPORTED MESSAGE. NOT A THREAD, AND NEVER THE TABLE.
--   A report is what opens the door, and it opens it exactly one message wide. The two
--   easier designs were both rejected:
--     * blanket `is_admin()` — every private message in the app becomes admin-readable,
--       which is not a moderation tool, it is a wiretap;
--     * the reported message's whole CONVERSATION — one report unlocks an entire private
--       history, including everything the reporter did not complain about.
--   The cost is real and accepted: an admin sometimes judges a message without the
--   exchange around it, which makes some harassment harder to read. That is the price of
--   the other two being worse.
--   No deleted_at/hidden_at filter here — a soft-deleted or already-hidden message is
--   precisely what moderation still has to be able to see.
DROP POLICY IF EXISTS "messages admin read reported" ON public.messages;
CREATE POLICY "messages admin read reported" ON public.messages
  FOR SELECT TO authenticated
  USING (
    is_admin()
    AND EXISTS (SELECT 1 FROM content_reports cr
                 WHERE cr.content_type = 'message' AND cr.content_id = messages.id)
  );

-- The only UPDATE anybody has, scoped the same way: an admin may hide a message that has
-- been reported. msg_40_immutable keeps it to the moderation columns.
DROP POLICY IF EXISTS "messages admin hide reported" ON public.messages;
CREATE POLICY "messages admin hide reported" ON public.messages
  FOR UPDATE TO authenticated
  USING (
    is_admin()
    AND EXISTS (SELECT 1 FROM content_reports cr
                 WHERE cr.content_type = 'message' AND cr.content_id = messages.id)
  )
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS "no_anon_insert_messages" ON public.messages;
CREATE POLICY "no_anon_insert_messages" ON public.messages
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (false);
DROP POLICY IF EXISTS "no_anon_update_messages" ON public.messages;
CREATE POLICY "no_anon_update_messages" ON public.messages
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT is_anonymous_session());
DROP POLICY IF EXISTS "no_anon_delete_messages" ON public.messages;
CREATE POLICY "no_anon_delete_messages" ON public.messages
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (false);

-- ─── conversation_attempts ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "conversation_attempts admin read" ON public.conversation_attempts;
CREATE POLICY "conversation_attempts admin read" ON public.conversation_attempts
  FOR SELECT TO authenticated
  USING (is_admin());

DROP POLICY IF EXISTS "no_anon_insert_conversation_attempts" ON public.conversation_attempts;
CREATE POLICY "no_anon_insert_conversation_attempts" ON public.conversation_attempts
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (false);
DROP POLICY IF EXISTS "no_anon_update_conversation_attempts" ON public.conversation_attempts;
CREATE POLICY "no_anon_update_conversation_attempts" ON public.conversation_attempts
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (false);
DROP POLICY IF EXISTS "no_anon_delete_conversation_attempts" ON public.conversation_attempts;
CREATE POLICY "no_anon_delete_conversation_attempts" ON public.conversation_attempts
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (false);


-- ════════════════════════════════════════════════════════════════════════════
-- 10. Grants
-- ════════════════════════════════════════════════════════════════════════════
--
-- SELECT only. The single UPDATE is what the admin hide policy needs; there is no INSERT
-- and no DELETE anywhere, for anyone.
REVOKE ALL ON public.conversations         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.messages              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.conversation_attempts FROM PUBLIC, anon, authenticated;

GRANT SELECT          ON public.conversations         TO authenticated;
GRANT SELECT, UPDATE  ON public.messages              TO authenticated;
GRANT SELECT          ON public.conversation_attempts TO authenticated;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.is_listed_student(uuid)',
    'public.may_initiate_by_age(uuid, uuid)',
    'public.start_conversation(uuid, text)',
    'public.send_message(uuid, text)',
    'public.accept_conversation(uuid)',
    'public.decline_conversation(uuid)',
    'public.leave_conversation(uuid)',
    'public.delete_message(uuid)',
    'public.block_user(uuid)',
    'public.list_conversations()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

-- notify_new_message is called only from inside the two send functions. No client
-- reaches it — a push sender that anyone can call is a push sender anyone can aim.
REVOKE ALL ON FUNCTION public.notify_new_message(uuid) FROM PUBLIC, anon, authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 11. Retention
-- ════════════════════════════════════════════════════════════════════════════
-- Same 30-day window and the same shape as purge-moderation-rejections (20260926).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-conversation-attempts') THEN
      PERFORM cron.unschedule('purge-conversation-attempts');
    END IF;
    PERFORM cron.schedule('purge-conversation-attempts', '23 3 * * *',
      $cron$DELETE FROM public.conversation_attempts WHERE created_at < now() - interval '30 days'$cron$);
  ELSE
    RAISE WARNING 'pg_cron not installed — conversation_attempts will NOT be purged. '
                  'Schedule the 30-day delete by hand or this table grows forever.';
  END IF;
END $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 12. Verification — inside the transaction, so a failure applies nothing
-- ════════════════════════════════════════════════════════════════════════════
-- Every assertion uses IS DISTINCT FROM: `<>` against NULL is NULL and `IF NULL` does
-- not fire, which would make each of these pass on precisely the failure it exists to
-- catch. Counts are DERIVED and PRINTED, never a remembered list of names.
DO $$
DECLARE
  v_pol_conv int;
  v_pol_msg  int;
  v_pol_att  int;
  v_trg      text;
  v_types    text[];
  v_writes   int;
BEGIN
  SELECT count(*) INTO v_pol_conv FROM pg_policies WHERE tablename = 'conversations';
  SELECT count(*) INTO v_pol_msg  FROM pg_policies WHERE tablename = 'messages';
  SELECT count(*) INTO v_pol_att  FROM pg_policies WHERE tablename = 'conversation_attempts';
  RAISE NOTICE 'policies — conversations=%, messages=%, conversation_attempts=%',
    v_pol_conv, v_pol_msg, v_pol_att;
  IF v_pol_conv IS DISTINCT FROM 4 THEN RAISE EXCEPTION 'conversations policies = %, expected 4', v_pol_conv; END IF;
  IF v_pol_msg  IS DISTINCT FROM 6 THEN RAISE EXCEPTION 'messages policies = %, expected 6', v_pol_msg; END IF;
  IF v_pol_att  IS DISTINCT FROM 4 THEN RAISE EXCEPTION 'conversation_attempts policies = %, expected 4', v_pol_att; END IF;

  -- NOBODY may write these tables directly. This is the assertion the whole design rests
  -- on, so it is derived from information_schema rather than from the GRANT statements
  -- above — a grant added later by a different migration would show up here.
  SELECT count(*) INTO v_writes FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name IN ('conversations', 'messages', 'conversation_attempts')
     AND privilege_type IN ('INSERT', 'DELETE')
     AND grantee IN ('anon', 'authenticated', 'PUBLIC');
  IF v_writes IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'INSERT/DELETE granted on a messaging table (% grants) — every write must go through a DEFINER function', v_writes;
  END IF;

  -- The trigger firing order is a decision; assert it reads back in that order.
  SELECT string_agg(tgname, ',' ORDER BY tgname) INTO v_trg
    FROM pg_trigger WHERE tgrelid = 'public.messages'::regclass AND NOT tgisinternal;
  RAISE NOTICE 'messages triggers in firing order: %', v_trg;
  IF v_trg IS DISTINCT FROM 'msg_10_stamp_sender,msg_20_age_rule,msg_30_ugc_screen,msg_40_immutable,msg_50_touch_conversation' THEN
    RAISE EXCEPTION 'messages triggers are %, not the five expected in order', v_trg;
  END IF;

  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_types
    FROM pg_constraint c,
         LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') AS m
   WHERE c.conrelid = to_regclass('public.content_reports')
     AND c.conname = 'content_reports_content_type_check';
  RAISE NOTICE 'content_reports admits: %', v_types;
  IF v_types IS DISTINCT FROM ARRAY['answer','facility','message','place','profile','question','review'] THEN
    RAISE EXCEPTION 'content_reports type list is %, expected the 6 old plus message', v_types;
  END IF;

  -- ADULT_AGE lives in exactly one place in SQL. If a second copy appears, the mirror
  -- check in scripts/check-profile-gate.mjs is comparing against an ambiguous source.
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.prosrc LIKE '%interval ''18 years''%') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'interval ''18 years'' appears in more than one function — ADULT_AGE must have one home';
  END IF;

  -- ► THE TWO CHECKS THAT MUST TOLERATE A DELETED ACCOUNT.
  -- Both `initiator_id`/`recipient_id` and `closed_by` are ON DELETE SET NULL, and a
  -- foreign key performs that as an ordinary UPDATE which constraints see. The strict
  -- forms — `initiator_id IS DISTINCT FROM recipient_id` and
  -- `(closed_at IS NULL) = (closed_by IS NULL)` — each make `DELETE FROM profiles` fail,
  -- so account deletion breaks for anyone who has left a thread or blocked somebody.
  -- Asserted by READING THE DEFINITION rather than by deleting a profile: an in-migration
  -- probe that removes a real account is not a probe, it is an outage.
  -- pg_get_constraintdef carries no comments, so a LIKE over it matches code and only code.
  IF EXISTS (SELECT 1 FROM pg_constraint c
              WHERE c.conrelid = to_regclass('public.conversations')
                AND c.conname = 'conversations_not_self'
                AND pg_get_constraintdef(c.oid) ILIKE '%IS DISTINCT FROM%') THEN
    RAISE EXCEPTION 'conversations_not_self uses IS DISTINCT FROM: once BOTH participants delete their accounts the row is (NULL, NULL) and the second DELETE is refused. Use <>.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint c
              WHERE c.conrelid = to_regclass('public.conversations')
                AND c.conname = 'conversations_closed_pair'
                -- Parens stripped before matching: pg_get_constraintdef returns the
                -- CANONICAL rendering, `((closed_by IS NULL) OR (closed_at IS NOT
                -- NULL))`, not the spelling above it. Matching the source spelling is
                -- the frame-of-reference mistake this file warns about twice.
                AND replace(replace(pg_get_constraintdef(c.oid), '(', ''), ')', '')
                    NOT ILIKE '%closed_by IS NULL OR closed_at IS NOT NULL%') THEN
    RAISE EXCEPTION 'conversations_closed_pair is not the one-way form: %',
      (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
        WHERE c.conrelid = to_regclass('public.conversations') AND c.conname = 'conversations_closed_pair');
  END IF;

  RAISE NOTICE '20261029 verified.';
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
VALUES ('20261029_student_messaging.sql', '98b00ee19adbbdd74e3700f85a70f17b65ca6ba8508ed463e9e9186a255ec552')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

NOTIFY pgrst, 'reload schema';
