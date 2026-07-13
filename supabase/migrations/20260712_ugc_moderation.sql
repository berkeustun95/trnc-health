-- ─── UGC Moderation — App Store Guideline 1.2 safeguards ─────────────────────
-- Adds: content reports, user blocks, an admin-editable objectionable-word
-- filter, soft-hide moderation columns, and a UGC posting ban.
--
-- UGC surfaces in ADA and their real (RLS-enforced) visibility:
--   • reviews  — TRULY PUBLIC (policy "public read reviews" is qual: true).
--                Broadcast UGC. Needs report + block + filter.
--   • questions— NOT public. Policy "read questions" limits rows to the asking
--                customer, the facility's provider, and admin. It is private
--                asker↔business messaging, even though BookingScreen.js queries
--                it by facility_id and *renders* it like a public board.
--                Needs report + filter. Block is meaningless (you cannot see
--                another customer's questions).
--   • answers  — same thread, written by the provider. Report + filter.
--
--   ⚠ If anyone ever widens "read questions" to make the Q&A board genuinely
--     public (which the BookingScreen UI looks like it was intended to be),
--     Q&A becomes broadcast UGC and MUST also get block-filtering, exactly as
--     reviews do in section 5 below.
--
-- Other UGC (job_postings, properties, events, beaches/landmarks) is already
-- gated by an admin status: pending → approved flow and is out of scope.
--
-- Conventions followed:
--   • get_my_role() for admin checks (STABLE; avoids recursive RLS on profiles).
--   • Moderation columns are protected by BEFORE UPDATE guard triggers, per the
--     precedent set in 20260705_job_postings_rls_lockdown.sql — RLS policies
--     cannot compare OLD vs NEW, and admin/owner are both the `authenticated`
--     Postgres role, so column GRANTs cannot distinguish them.
--   • Content is NEVER hard-deleted by moderation — it is soft-hidden, which
--     preserves the evidence trail if a user disputes a removal.


-- ─── 1. Blocks ───────────────────────────────────────────────────────────────
-- A block list is PRIVATE to the blocker. Not even admins can read it.

CREATE TABLE blocks (
  blocker_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "blocks_read_own" ON blocks FOR SELECT
  USING (blocker_id = auth.uid());

CREATE POLICY "blocks_insert_own" ON blocks FOR INSERT
  WITH CHECK (blocker_id = auth.uid());

CREATE POLICY "blocks_delete_own" ON blocks FOR DELETE
  USING (blocker_id = auth.uid());
-- No UPDATE policy: a block row is immutable (insert to block, delete to unblock).


-- ─── 2. Content reports ──────────────────────────────────────────────────────
-- Polymorphic over review/question/answer so there is ONE admin triage inbox.
-- Trade-off: no FK to the content row. Acceptable because moderation soft-hides
-- rather than deletes; the admin UI must still tolerate a missing content row
-- (e.g. the author deleted their account, which cascades their reviews away).

CREATE TABLE content_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content_type text NOT NULL CHECK (content_type IN ('review', 'question', 'answer')),
  content_id   uuid NOT NULL,
  reason       text NOT NULL CHECK (reason IN ('offensive', 'harassment', 'spam', 'false_info', 'other')),
  details      text CHECK (char_length(details) <= 500),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'actioned', 'dismissed')),
  resolved_at  timestamptz,
  resolved_by  uuid REFERENCES profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reporter_id, content_type, content_id)   -- one report per user per item
);

CREATE INDEX content_reports_pending_idx ON content_reports (status, created_at DESC);
CREATE INDEX content_reports_content_idx ON content_reports (content_type, content_id);

ALTER TABLE content_reports ENABLE ROW LEVEL SECURITY;

-- Only admins can read reports. A reporter cannot read back even their own —
-- there is nothing useful in there for them, and it keeps the queue opaque.
CREATE POLICY "reports_admin_read" ON content_reports FOR SELECT
  USING (get_my_role() = 'admin');

-- Any signed-in user may file a report, only as themselves, only as 'pending'.
CREATE POLICY "reports_insert_own" ON content_reports FOR INSERT
  WITH CHECK (
    reporter_id = auth.uid()
    AND status = 'pending'
    AND resolved_at IS NULL
    AND resolved_by IS NULL
  );

CREATE POLICY "reports_admin_update" ON content_reports FOR UPDATE
  USING (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');
-- No DELETE policy: reports are an audit trail.

-- Rate limit: max 20 reports per user per rolling 24h. Mirrors the trigger-based
-- rate limiting in 20260701_rate_limits.sql. The UNIQUE constraint already caps
-- one report per item; this caps a user carpet-bombing many items.
CREATE OR REPLACE FUNCTION check_report_rate_limit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
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
$$;

CREATE TRIGGER enforce_report_rate_limit
  BEFORE INSERT ON content_reports
  FOR EACH ROW EXECUTE FUNCTION check_report_rate_limit();


-- ─── 3. Objectionable-term filter ────────────────────────────────────────────
-- Stored in a table, not hardcoded, so terms can be added WITHOUT shipping a new
-- build (matters if App Review flags something). The client caches this list for
-- instant inline feedback; this trigger is the actual boundary.

CREATE TABLE blocked_terms (
  term       text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE blocked_terms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "blocked_terms_read_all" ON blocked_terms FOR SELECT USING (true);
CREATE POLICY "blocked_terms_admin_write" ON blocked_terms FOR ALL
  USING (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');

-- Word-boundary, case-insensitive match. Regex metacharacters in a term are
-- escaped so a stray '.' or '*' cannot turn into a wildcard.
CREATE OR REPLACE FUNCTION contains_blocked_term(p_text text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM blocked_terms bt
    WHERE lower(p_text) ~ (
      '\m' || regexp_replace(lower(bt.term), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '\M'
    )
  );
$$;

INSERT INTO blocked_terms (term) VALUES
  -- English profanity / slurs
  ('fuck'), ('fucking'), ('fucker'), ('motherfucker'), ('shit'), ('bullshit'),
  ('cunt'), ('bitch'), ('whore'), ('slut'), ('bastard'), ('asshole'), ('dickhead'),
  ('faggot'), ('fag'), ('nigger'), ('nigga'), ('retard'), ('retarded'), ('tranny'),
  ('kike'), ('spic'), ('wetback'), ('paki'), ('chink'), ('gook'), ('towelhead'),
  ('rape'), ('rapist'), ('kys'),
  -- Turkish profanity / slurs
  ('amk'), ('aq'), ('amina'), ('amına'), ('sik'), ('sikeyim'), ('sikik'), ('siktir'),
  ('orospu'), ('piç'), ('pic'), ('yarrak'), ('yarak'), ('göt'), ('got oglani'),
  ('ibne'), ('kahpe'), ('şerefsiz'), ('serefsiz'), ('gavat'), ('pezevenk'),
  ('salak'), ('gerizekalı'), ('gerizekali')
ON CONFLICT DO NOTHING;
-- Deliberately NOT seeded: Turkish 'top' and 'mal'. Both are used as slurs but are
-- also ordinary words (ball / goods), and a wrongly-rejected review is worse UX
-- than a rare slur reaching the report queue. Add via the admin UI if that changes.


-- ─── 4. Moderation columns + UGC ban ─────────────────────────────────────────

ALTER TABLE reviews   ADD COLUMN hidden_at timestamptz, ADD COLUMN hidden_reason text;
ALTER TABLE questions ADD COLUMN hidden_at timestamptz, ADD COLUMN hidden_reason text;
ALTER TABLE answers   ADD COLUMN hidden_at timestamptz, ADD COLUMN hidden_reason text;

-- Separate from profiles.blocked_until, which is the booking no-show strike
-- system. Conflating them would mean a rude reviewer also loses appointments.
ALTER TABLE profiles ADD COLUMN ugc_banned_until timestamptz;

CREATE INDEX IF NOT EXISTS reviews_customer_id_idx ON reviews (customer_id);

-- A user may UPDATE their own profiles row, so without this guard they could
-- simply set ugc_banned_until = NULL and unban themselves.
CREATE OR REPLACE FUNCTION guard_profile_ban_column()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_my_role() = 'admin' THEN
    RETURN NEW;
  END IF;
  IF NEW.ugc_banned_until IS DISTINCT FROM OLD.ugc_banned_until THEN
    RAISE EXCEPTION 'ugc_banned_until is admin-only';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_profile_ban
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION guard_profile_ban_column();


-- ─── 5. Read policies: hide removed content + content from blocked users ─────
-- reviews: PRESERVE public read, ADD the hidden + block filters.
-- `auth.uid() IS NULL` short-circuits the block subquery for logged-out readers.

DROP POLICY "public read reviews" ON reviews;

CREATE POLICY "public read reviews" ON reviews FOR SELECT
  USING (
    (
      hidden_at IS NULL
      AND (
        auth.uid() IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM blocks b
          WHERE b.blocker_id = auth.uid()
            AND b.blocked_id = reviews.customer_id
        )
      )
    )
    OR customer_id = auth.uid()      -- author still sees their own, even if hidden
    OR get_my_role() = 'admin'       -- admin sees everything, including hidden
  );

-- questions/answers: NOT public (see header). Only add the hidden filter; no
-- block filter, because a customer can never see another customer's question.
DROP POLICY "read questions" ON questions;

CREATE POLICY "read questions" ON questions FOR SELECT
  USING (
    (
      hidden_at IS NULL
      AND (
        customer_id = auth.uid()
        OR (
          get_my_role() = 'provider'
          AND EXISTS (
            SELECT 1 FROM facilities f
            WHERE f.id = questions.facility_id
              AND f.provider_id = auth.uid()
          )
        )
      )
    )
    OR customer_id = auth.uid()      -- asker still sees their own, even if hidden
    OR get_my_role() = 'admin'
  );
-- ⚠ VERIFY BEFORE APPLYING: the original "read questions" qual was reported as
--   (customer_id = auth.uid())
--   OR (get_my_role() = 'provider' AND EXISTS(...facility owner...))
--   OR (get_my_role() = 'admin')
-- and I have reconstructed the facility-owner EXISTS clause from the facilities
-- schema, because the dump elided it as "(...facility owner...)". Diff the
-- reconstruction against the real qual in the pg_policies output before running
-- this. If the real clause differs, keep the real one and only wrap it with the
-- hidden_at filter.


-- ─── 6. Guard: only admins may hide/unhide content ───────────────────────────
-- Without this, an author could UPDATE their own review and set hidden_at.
-- The exception is the auto-hide in section 8, which is allowed only when the
-- report threshold actually justifies it — the trigger verifies the JUSTIFICATION
-- rather than trusting the caller's identity, so no privilege escalation or
-- session-flag trickery is needed.

CREATE OR REPLACE FUNCTION guard_moderation_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;

CREATE TRIGGER guard_review_moderation
  BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION guard_moderation_columns('review');

CREATE TRIGGER guard_question_moderation
  BEFORE UPDATE ON questions
  FOR EACH ROW EXECUTE FUNCTION guard_moderation_columns('question');

CREATE TRIGGER guard_answer_moderation
  BEFORE UPDATE ON answers
  FOR EACH ROW EXECUTE FUNCTION guard_moderation_columns('answer');


-- ─── 7. Submit-time checks: ban + profanity ──────────────────────────────────
-- TG_ARGV[0] is the name of the free-text column on the table.

CREATE OR REPLACE FUNCTION check_ugc_on_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;

CREATE TRIGGER check_review_content
  BEFORE INSERT ON reviews
  FOR EACH ROW EXECUTE FUNCTION check_ugc_on_insert('comment');

CREATE TRIGGER check_question_content
  BEFORE INSERT ON questions
  FOR EACH ROW EXECUTE FUNCTION check_ugc_on_insert('body');

CREATE TRIGGER check_answer_content
  BEFORE INSERT ON answers
  FOR EACH ROW EXECUTE FUNCTION check_ugc_on_insert('body');


-- ─── 8. Auto-hide at 3 distinct reporters ────────────────────────────────────
-- Bounds the worst case when the (solo) admin is asleep, so the published 24h
-- removal commitment does not depend on a human being awake. Admin can restore.
-- SAFE TO DELETE this whole section if you'd rather every removal be manual.

CREATE OR REPLACE FUNCTION auto_hide_reported_content()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;

CREATE TRIGGER auto_hide_on_report
  AFTER INSERT ON content_reports
  FOR EACH ROW EXECUTE FUNCTION auto_hide_reported_content();


-- ─── 9. Block the author of a piece of content ───────────────────────────────
-- Reviews render ANONYMOUSLY — the client never receives customer_id, and must
-- not. So blocking is done by content id: the author is resolved server-side and
-- the caller never learns who they blocked. Enforcement is entirely in the
-- reviews SELECT policy (section 5), so every existing and future screen that
-- reads reviews gets block-filtering for free, with no query changes.

CREATE OR REPLACE FUNCTION block_content_author(p_content_type text, p_content_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;

REVOKE ALL ON FUNCTION block_content_author(text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION block_content_author(text, uuid) TO authenticated;
