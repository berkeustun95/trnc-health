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

-- FILE 4/5 — Triggers (public schema + the auth.users signup trigger),
-- verbatim from pg_get_triggerdef. Requires FILE 3 functions to exist first.


-- answers
CREATE TRIGGER check_answer_content BEFORE INSERT ON public.answers FOR EACH ROW EXECUTE FUNCTION check_ugc_on_insert('body');
CREATE TRIGGER guard_answer_moderation BEFORE UPDATE ON public.answers FOR EACH ROW EXECUTE FUNCTION guard_moderation_columns('answer');

-- appointments
CREATE TRIGGER enforce_pending_appointment_limit BEFORE INSERT ON public.appointments FOR EACH ROW EXECUTE FUNCTION check_pending_appointment_limit();

-- content_reports
CREATE TRIGGER auto_hide_on_report AFTER INSERT ON public.content_reports FOR EACH ROW EXECUTE FUNCTION auto_hide_reported_content();
CREATE TRIGGER enforce_report_rate_limit BEFORE INSERT ON public.content_reports FOR EACH ROW EXECUTE FUNCTION check_report_rate_limit();

-- events
CREATE TRIGGER ev_guard_write BEFORE INSERT OR UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION ev_guard_write();

-- home_services
CREATE TRIGGER hs_guard_insert BEFORE INSERT ON public.home_services FOR EACH ROW EXECUTE FUNCTION hs_guard_insert();
CREATE TRIGGER hs_guard_owner_update BEFORE UPDATE ON public.home_services FOR EACH ROW EXECUTE FUNCTION hs_guard_owner_update();

-- job_postings
CREATE TRIGGER jp_guard_insert BEFORE INSERT ON public.job_postings FOR EACH ROW EXECUTE FUNCTION jp_guard_insert();
CREATE TRIGGER jp_guard_owner_update BEFORE UPDATE ON public.job_postings FOR EACH ROW EXECUTE FUNCTION jp_guard_owner_update();

-- profiles
CREATE TRIGGER guard_profile_ban BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION guard_profile_ban_column();

-- questions
CREATE TRIGGER check_question_content BEFORE INSERT ON public.questions FOR EACH ROW EXECUTE FUNCTION check_ugc_on_insert('body');
CREATE TRIGGER enforce_question_limit BEFORE INSERT ON public.questions FOR EACH ROW EXECUTE FUNCTION check_question_limit();
CREATE TRIGGER guard_question_moderation BEFORE UPDATE ON public.questions FOR EACH ROW EXECUTE FUNCTION guard_moderation_columns('question');

-- quiz_submissions
CREATE TRIGGER on_submission_status_change AFTER UPDATE ON public.quiz_submissions FOR EACH ROW WHEN ((old.status IS DISTINCT FROM new.status)) EXECUTE FUNCTION update_pharmacist_score();

-- reviews
CREATE TRIGGER check_review_content BEFORE INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION check_ugc_on_insert('comment');
CREATE TRIGGER guard_review_moderation BEFORE UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION guard_moderation_columns('review');

-- transport_providers
CREATE TRIGGER tp_guard_write BEFORE INSERT OR UPDATE ON public.transport_providers FOR EACH ROW EXECUTE FUNCTION tp_guard_write();

-- auth.users (signup → profiles.role mapping)
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();