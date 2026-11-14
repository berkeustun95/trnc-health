-- Push token cleanup, dry run, 2026-11-14. READ-ONLY, one SELECT, sealed: the result lists account e-mails for Berke's
-- vault only. Nothing personal is in this file. Tokens are never printed, only left(md5(token), 8).
-- One phone token on 2+ profiles rows = that phone is pushed once per row by every per-row sender (waitlist, admin and
-- other SQL notifiers) and also gets pushes meant only for the other account; since #405 the duty push and the weekend
-- digest send one message per token. The cleanup migration
-- (*_push_token_dedupe.sql) keeps one row per token and nulls the rest, for groups whose members are ALL customer or
-- admin (Berke: providers are never touched). The predicate slice below is byte-identical to the migration's
-- (scripts/test-push-token-dedupe-sql.mjs compares them), so this shows exactly which rows it would keep.
-- Per group: eligible yes/no and, when no, why. Per member: kept_by_last_sign_in = the migration's rule (newest
-- sign-in, then highest id); kept_by_created_at = the alternative "keep the oldest account" (created_at oldest first,
-- unknown last, then highest id), for comparison only. Both are null for an excluded group.
-- underage_dob_blocks = a member the cleanup would clear whose date of birth is under 13: the profiles name/age
-- trigger raises on any change to such a row, so the migration would roll back. Expected false everywhere.
-- Controls: token rows visible to this role, and auth.users visible (without it ranking falls back to the id alone).
WITH
-- predicate:begin (byte-identical in the dedupe migration; the test compares the two slices)
grp AS (
  SELECT p.push_token,
         coalesce(bool_and(coalesce(p.role IN ('customer', 'admin'), false)), false) AS eligible
    FROM public.profiles p
   WHERE p.push_token IS NOT NULL
   GROUP BY p.push_token
  HAVING count(*) > 1),
ranked AS (
  SELECT p.id, p.push_token, g.eligible,
         row_number() OVER (PARTITION BY p.push_token
                            ORDER BY u.last_sign_in_at DESC NULLS LAST, p.id DESC) AS rn
    FROM public.profiles p
    JOIN grp g ON g.push_token = p.push_token
    LEFT JOIN auth.users u ON u.id = p.id)
-- predicate:end
, members AS (
  SELECT r.push_token, r.eligible, r.rn, p.role, u.email, u.is_anonymous, u.created_at, u.last_sign_in_at,
         p.date_of_birth > (current_date - interval '13 years')::date AS dob_under_13,
         row_number() OVER (PARTITION BY r.push_token
                            ORDER BY u.created_at ASC NULLS LAST, r.id DESC) AS rn_created
    FROM ranked r
    JOIN public.profiles p ON p.id = r.id
    LEFT JOIN auth.users u ON u.id = r.id)
SELECT json_build_object(
  'control_token_rows_visible', EXISTS (SELECT 1 FROM public.profiles WHERE push_token IS NOT NULL),
  'control_auth_users_visible', EXISTS (SELECT 1 FROM auth.users),
  'groups', coalesce((SELECT json_agg(g.j ORDER BY g.eligible DESC, g.fp) FROM (
      SELECT left(md5(m.push_token), 8) AS fp, bool_or(m.eligible) AS eligible,
             json_build_object(
               'token_fp', left(md5(m.push_token), 8),
               'eligible', bool_or(m.eligible),
               'excluded_reason', CASE WHEN bool_or(m.eligible) THEN NULL
                                       ELSE 'a member is not customer or admin (provider, other role or no role): left as is' END,
               'rules_agree', CASE WHEN bool_or(m.eligible)
                                   THEN bool_and((m.rn = 1) = (m.rn_created = 1)) END,
               'members', json_agg(json_build_object(
                   'email', m.email,
                   'role', m.role,
                   'guest', m.is_anonymous,
                   'created_at', to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
                   'last_sign_in_at', to_char(m.last_sign_in_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
                   'kept_by_last_sign_in', CASE WHEN m.eligible THEN m.rn = 1 END,
                   'kept_by_created_at', CASE WHEN m.eligible THEN m.rn_created = 1 END,
                   'underage_dob_blocks', m.eligible AND m.rn > 1 AND coalesce(m.dob_under_13, false))
                 ORDER BY m.rn)) AS j
        FROM members m
       GROUP BY m.push_token) g), '[]'::json)
) AS push_token_cleanup_dry;
