-- ─── Applied-migrations ledger — bootstrap ───────────────────────────────────
--
-- GENERATED ONCE by scripts/migration-ledger.mjs --baseline. Do not regenerate: the
-- checksums below are a point-in-time baseline, and re-running would silently restate
-- whatever the files say today as though it had been verified.
--
-- WHY: migrations are applied by pasting into the SQL editor, which can apply a file
-- partially, skip it entirely, or apply a version that was later edited. Nothing in this
-- repo could detect any of those. See docs/schema-drift-audit.md.
--
-- ─── WHAT THE BASELINE ROWS ASSERT, EXACTLY ─────────────────────────────────
-- These 77 rows assert: **"this file matches live as of the 2026-08-19 schema drift
-- audit"** — NOT "this file is what was applied".
--
-- Those two statements differ, and 20260802_garage_booking_details.sql is the proof:
-- its ADD COLUMN is live and its DROP COLUMN is not, so *something other than the
-- current file* ran. Whatever that was is unrecoverable. The baseline records the state
-- the audit verified, and is honest that it cannot speak to provenance.
--
-- The distinction stops mattering for every migration applied AFTER this one, because
-- those stamp their own checksum at apply time — which is a provenance claim.
--
-- The baseline is defensible rather than assumed because the audit that day found
-- sections A/D/E/G empty across 390 columns, 153 constraints and 31 indexes: every
-- object the repo declares had reached the database. It is a verified state, not a hope.
--
-- 20260903_migration_ledger.sql is deliberately ABSENT from its own baseline — a file cannot contain its
-- own checksum. The existence of this table is its applied-record; nothing else creates it.
--
-- EXECUTION: SET ROLE postgres. SQL editor Role selector = postgres.

SET ROLE postgres;
BEGIN;

CREATE TABLE IF NOT EXISTS public.schema_migrations_applied (
  filename    text PRIMARY KEY,
  checksum    text NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  applied_by  text NOT NULL DEFAULT current_user
);

COMMENT ON TABLE public.schema_migrations_applied IS
  'One row per applied migration. Baseline rows (applied_by = ''baseline'') assert only '
  'that the file matched live as of the 2026-08-19 drift audit, NOT that the file is what '
  'ran. Rows written after that are provenance: the migration stamped its own checksum '
  'at apply time. Compare against disk with supabase/migration_ledger_check.sql.';

-- RLS on, zero policies. See the access note at the foot of this file.
ALTER TABLE public.schema_migrations_applied ENABLE ROW LEVEL SECURITY;

-- ORDERING GUARD, specific to this bootstrap.
--
-- The baseline is generated from the files on DISK, and it asserts they match live. At
-- the moment it was generated, 20260902_capture_schema_drift.sql was on disk but NOT yet
-- applied — so baselining before it runs would record a claim that is simply false for
-- that one file, in the very table built to stop false claims.
--
-- This aborts unless 20260902's four outcomes are all present. Apply 20260902 first.
DO $$
DECLARE
  missing text := '';
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='appointments' AND column_name='service_type')
    THEN missing := missing || ' appointments.service_type still present;'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='claim_requests' AND column_name='kteb_confirmed')
    THEN missing := missing || ' claim_requests.kteb_confirmed still present;'; END IF;
  IF to_regclass('public.facilities_backup_20260718') IS NOT NULL
    THEN missing := missing || ' facilities_backup_20260718 still present;'; END IF;
  IF to_regclass('public.duty_list_date_idx') IS NULL
    THEN missing := missing || ' duty_list_date_idx absent;'; END IF;
  IF missing <> '' THEN
    RAISE EXCEPTION
      'Apply 20260902_capture_schema_drift.sql BEFORE this migration.%'
      ' The baseline below claims every file on disk matches live, and that claim would'
      ' be false for 20260902 until it has run.', missing;
  END IF;
END $$;

INSERT INTO public.schema_migrations_applied (filename, checksum, applied_by) VALUES
  ('20260621_provider_verification.sql', '931388cabb08b3689047f3f0794dd5c721dd78d939321e5af9a3bb54f2c17f2e', 'baseline'),
  ('20260623_cross_user_notifications.sql', 'f90fdb85692138af7582b66007a39d859d91ccfd10f9dd21a57d0b19e50b6f28', 'baseline'),
  ('20260628_search_content_rpc.sql', '1bb37c45a9421001d358d0dd64d4bb6a5fed92056a45203056ba89754e8ced1d', 'baseline'),
  ('20260701_rate_limits.sql', 'e8b84a9d38c2ff0046e32276473c898104a70a26c80fd846ddee948ae8f65b87', 'baseline'),
  ('20260701_security_fixes.sql', '71622f80cd2347b372d79d90241a9f768bef2fbcfea3f768b9f9d9d15d7eedeb', 'baseline'),
  ('20260702_job_postings.sql', 'b5e543498fe7b19a70bb7c9e866c82dc913838f78add2462d931f125cfa69684', 'baseline'),
  ('20260705_job_postings_auto_expire.sql', '8c7bb5affc8f91989bd05e5d1aa4ac08eb9b3fb7208795579d3b9515fa399e5e', 'baseline'),
  ('20260705_job_postings_rls_lockdown.sql', '6ee345b508f1a799961494c7bc9884de7ee70117f4788475d2c023482dfe2257', 'baseline'),
  ('20260705_search_content_add_jobs.sql', 'f15fc259fa1121f2c3372d8e3bcc3db88d54ea5e3b3f03bc25664ee3e9d04445', 'baseline'),
  ('20260712_ugc_moderation.sql', '833f149479c9b72d46966348691657668cf81e5762eea0e40027a9abb29d4fac', 'baseline'),
  ('20260712_ugc_moderation_fix_rate_limit.sql', 'b5d18c0c7f3bf28870a56f2ae295cdc8d224c98a50c2d74aa5f850799a6bf43a', 'baseline'),
  ('20260714_block_anonymous_writes.sql', '5d3ea78e6093769880e5a6f2726c020df9057524ca10725bf70fed6d8283ef92', 'baseline'),
  ('20260718_capture_1_tables_missing_from_repo.sql', 'ab90ecebc5ab99a569c98117478808a3ad74b465e96c3b26de649ae9c1f33947', 'baseline'),
  ('20260718_capture_2_check_constraints.sql', 'dc3965ac9370fb4a673d136c112fc3774d699c106f8a90a7c670e586201341e9', 'baseline'),
  ('20260718_capture_3_functions.sql', '4945df76902582a30a159d0908a68af7582152f49e673b50e9182f710d8c3443', 'baseline'),
  ('20260718_capture_4_triggers.sql', '37c648bdc891e316d98f02cc016c1725bc492e373980a1a4f6b153021740b5f3', 'baseline'),
  ('20260718_capture_5_rls_policies.sql', '63f95a0c29447a8787adc02f32456213083dbde8b4df7f06f2004fbfa3fd9c69', 'baseline'),
  ('20260718_events_allow_owner_submit.sql', '802c24344ead82f39a621bf87ad9df7e08618616c93e7fc0c2dc9a6d30a70b48', 'baseline'),
  ('20260718_facilities_guards.sql', '9a0289b727048a5a5ee2124cb2cd11bd07ad3e21640b17aa4926100254b20920', 'baseline'),
  ('20260719_add_missing_indexes.sql', 'f68c62fd1c464b23271d937d91fec1b27ad311bc272e85af87e481b62e07a912', 'baseline'),
  ('20260719_claim_evidence_and_guard.sql', 'ad81c83bb68c9f8a009e8face82f15c7748c1627786f7eca2d11ac01a13dc330', 'baseline'),
  ('20260719_claim_rename_and_tax_no.sql', '8cd9369b011ca47e126b0dd4532721fce99469307b078bb03ac1ba439905f27e', 'baseline'),
  ('20260719_create_facility_claim_rpc.sql', 'a53b4fc4761c12f9b48a0c8a6df46df75459a7f3e849088ab0be00e6a1eeccce', 'baseline'),
  ('20260719_facilities_insert_force_unclaimed.sql', '51f5cb62d70d47560654a2ba690cb1b85392cbf54734b25a3ff3b9f1ea7f949b', 'baseline'),
  ('20260719_facilities_insert_rls_allow_unclaimed.sql', '556e1fb9440a5ee2906dac49c5b7352a54240dc072334df22b9680f1f566304e', 'baseline'),
  ('20260719_fix_appointment_time_check.sql', 'fc6b212f1573ff211853dcf29ef2ea2038deecafa3800b37fcedd26c979990bc', 'baseline'),
  ('20260719_fix_signup_role_and_home_service.sql', '42bc01b6ad1ec9393d1e03ed81e6bd6b7bae73e77bdbaea87c476663d3b4af04', 'baseline'),
  ('20260719_pin_definer_search_path.sql', '3229243ab29f681e10cc511ad32bc49f5f1fbcb00c275182944deff0b7a09bca', 'baseline'),
  ('20260722_job_postings_business_paid_tier.sql', '55eb0ea5e13718f342f576ec14def6bd63047b513d080163413fd3db8cbf51ce', 'baseline'),
  ('20260723_insurance_companies.sql', '1c29a330944f3a3d5404e5cdc488fcec72f47d37f99d854a6e8bb0e020a73a83', 'baseline'),
  ('20260723_place_photo_credits.sql', '9d587dbc334fe16175e34cdc82267e14631f1f93c217ca88c68fea55a6304baf', 'baseline'),
  ('20260724_events_category_narrow.sql', '5d92ed2310fb34d8d7bd3afc4c5b9133086f8d4347f1744aec9f1bf6fc1fa4ae', 'baseline'),
  ('20260724_events_category_widen.sql', '3ccc366dce5b77116fd926e03695d733a78dc99af765bea24f5630e9222e3e4a', 'baseline'),
  ('20260725_appointments_double_booking_guard.sql', 'b3bb31a2922055520030a5737fe2c4a27225a26f19bf2208828df012ab330093', 'baseline'),
  ('20260725_esim_waitlist.sql', 'c7705ead941e0845038232c65e265a5c03494073b6ccee19cf66c1b6f84f77eb', 'baseline'),
  ('20260725_grooming_directory.sql', 'bb9483c82661b53992b4990288b269e72184559e15e2b3224d911dca3f4eae6f', 'baseline'),
  ('20260726_grooming_booking_lifecycle.sql', '63964e94c060b13d7ed84b2b481ebd1b9dd892172eaab8e56d232a2c8075e3b7', 'baseline'),
  ('20260731_garages_directory.sql', '2ce1e3fac9acf57c28fe612b3b4217fb6f72992f19dbcf4d33b821cb2ae84973', 'baseline'),
  ('20260801_appointments_service_type.sql', 'a868805c2f2a505bcd3b129c765ebf74d8c221deb1cc711b4e6c67256ed4e1ad', 'baseline'),
  ('20260802_facilities_guard_garage_edit.sql', 'd7fb42c7b6b4fc943604fa3a0a149a14027f9c952d1696b230e83f3c55116655', 'baseline'),
  ('20260802_garage_booking_details.sql', 'a69b2c7010dfb608780a2df45a95fd4640b589c34da95a3abc692ec45787403f', 'baseline'),
  ('20260802_update_garage_facility.sql', '2c2b7c0cbf1fddad0f22723e9d50709ad6039476f1c688eb8ba96e58c053245e', 'baseline'),
  ('20260803_facility_report_moderation.sql', '6ec883dad6bbf445b7882a5989c56a704dcfaf60eeb6452a7936aeeecf4976a5', 'baseline'),
  ('20260803_garage_booking_lifecycle.sql', '37c1cd0e80f39628fb01900ceb16baabe72ca78a9598bf8dfb295a3faefb7fb4', 'baseline'),
  ('20260803_grooming_owner_edit.sql', '008432fcea198c533ad81de0eab4fb9a3de551297383137a7507a203ccbfbb71', 'baseline'),
  ('20260804_grooming_multi_category.sql', 'd078480d6bc52bfbd5ff9260aafe5c5c74c4351fdf6bbdb970e55d4fe0d51f6e', 'baseline'),
  ('20260805_facilities_city.sql', '14786a6fa4551d050e307bd89382fcadd268936ff063940a14561b9e55d9777c', 'baseline'),
  ('20260806_facilities_area.sql', 'fae38c643355292e78eca98656d05c46768b576268e3ee238c8af8660c23269a', 'baseline'),
  ('20260807_facility_content_filter.sql', 'ab86c9bca929b23250326bf050554b8efcf52aae69b1d125592b636386f4cb05', 'baseline'),
  ('20260808_facility_featured_tier.sql', '4e6e21fc2b6117869a594ec1088d7da2150e2bfd1ac91b84949424e1cde74be4', 'baseline'),
  ('20260809_featured_expiry_reminder.sql', '106ac108ae87128352e0d9cbee5b994ae5339f91a08e9c40e4ac4d26aeb7a5d4', 'baseline'),
  ('20260810_change_request_content_filter.sql', 'dd2785c9be0e69a6df7f077917b27d7d2d09b30390e53bc0e4397ddbe5726779', 'baseline'),
  ('20260811_facilities_service_prices.sql', 'a1bf769dbc95ea65147ebe5676b84f7a6807c0179727755fa7d024d9f37e11f5', 'baseline'),
  ('20260812_module_waitlist.sql', 'ab08e4010699b64b0a8e563f30b9279c3cfffc3e5a04d1d07a11ca799e79bead', 'baseline'),
  ('20260813_notify_module_waitlist.sql', '945f55477370fe848b214556edc37d6dec9d5ed407b1df954f69881229f8ac4f', 'baseline'),
  ('20260814_module_waitlist_add_studenthub.sql', 'ecc65943b7626e1ad546d490aab023b8b1f94ceb27cae2d69e1a0a5e72f0d14e', 'baseline'),
  ('20260815_questions_block_blocked_customers.sql', 'e27b25a849d914c7efa243641df1e8ee57a48240b3aab08908e9827925b963b6', 'baseline'),
  ('20260816_provider_storage_policies.sql', '003b4252191abd68f1e9d51d386e16b04fd65feac97f6b8e3bf0dfa1626610e6', 'baseline'),
  ('20260817_tighten_loose_storage_inserts.sql', '147f46facb170e6b843c032d464efa6e9f32d3a12dd6218a2e95307f2859c3dc', 'baseline'),
  ('20260818_preferred_language_nullable_default.sql', 'ad879a2d2bbe2bcd8e902a1d826e884819b6cfb88f8a64ae73ed6a2d18929edf', 'baseline'),
  ('20260819_get_customer_contacts_rpc.sql', '76eb5c4871df68f3c22453f35fbb6b831133e58ccc510960f93c74dfa896f742', 'baseline'),
  ('20260819_record_no_show_time_guard.sql', 'ba74ebf6ee0344afda8435c909aca711ef3a39ea48682fdde064ad38ed7781b6', 'baseline'),
  ('20260820_facilities_moderation_read_policy.sql', '975c9f29dac071c5dbca8a82533f4e9147d64abb370668d4d4bb07e573a5ed15', 'baseline'),
  ('20260820_search_content_gate_facilities.sql', 'cd2e21fafb3eed612f97a21ebafa49024e2f77eaeb306dfb659896c1d416f6bc', 'baseline'),
  ('20260821_drop_providers_read_customer_policy.sql', '7f9607fea36de1b3e4fc00261ab99d673854a1115994f2ad04ba69ad255bbcb8', 'baseline'),
  ('20260822_places_consolidation.sql', 'be1a39cd747e3b8942b8cf05b82ad9a910b1c687e358b3ca1be2a8f44cf43787', 'baseline'),
  ('20260823_place_photos_storage_policies.sql', '8ebb5e0eef06e58c9723ed9a77a12d33575402caf2c6d880c19cb3475419cfdd', 'baseline'),
  ('20260824_place_moderation.sql', '0953d68710cf01b709fba0e3a7eb80b8eb8cf2958e7c30986b6919201be78324', 'baseline'),
  ('20260825_places_column_guards.sql', '287fe4499da9e33f0a3e4f23e324eca8da46f5d59665b0d2660f95b11be4f838', 'baseline'),
  ('20260826_place_claims.sql', '8d0db056d47bede3cd4eea1c6d2dec61af2beb7ae7db1de073566efc0f1e0ce7', 'baseline'),
  ('20260827_places_featured_tier.sql', '0d5dc0c5fc2c0fea358f1f9f32662fb3642f915dfa716d648ae6a40de95e7674', 'baseline'),
  ('20260828_explore_waitlist_module.sql', 'f4c99b2eaf3a7c28288e6a080341722cbf2e272accf7977458d85f4731d5fbc7', 'baseline'),
  ('20260829_place_resubmit.sql', '166d8a5034f6958fc25e2ee6f9d6a6717f3d9684c804136d3dbfa1da958e9ca4', 'baseline'),
  ('20260830_events_gisekibris_import.sql', 'ad14c7c24327caa4f43c96bee648fe5d6fb8a994077869f0cbfc76a4ef200c7b', 'baseline'),
  ('20260831_events_external_id_remap.sql', '61ae1338ccb28cfc74ae484a5b2fc6af37afea9480fcc693983550cf0be3197e', 'baseline'),
  ('20260901_events_status_not_null.sql', '0bbac7857969d462d61a198c1e2d7f4588bd5657aeffc094f1402f0a758c4a46', 'baseline'),
  ('20260902_capture_schema_drift.sql', 'd3c3a233da2e99b5f042b944a1b557c4005e015d4d7aa0e1562f59f57189db82', 'baseline')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Who can do what ─────────────────────────────────────────────────────────
-- RLS is ENABLED and there are ZERO policies, which in Postgres means: no row is
-- visible or writable to any role that RLS applies to. Concretely —
--   • anon (a logged-out client) and authenticated (every customer, provider,
--     organizer and admin): CANNOT read, insert, update or delete a single row. RLS
--     with no permissive policy denies by default.
--   • service_role and postgres: full access, because both BYPASS RLS.
--   • So this table is reachable only from the SQL editor and from a service_role
--     script. No app query can see it, which is correct — it is operational metadata
--     about the repo, not application data, and it names internal file paths.
-- No other table's policies are touched.

-- ─── Verification (run after applying) ───────────────────────────────────────
--   SELECT count(*) AS baseline_rows FROM public.schema_migrations_applied;
--   -- expect 77
--
--   SELECT relrowsecurity,
--          (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
--   FROM pg_class c WHERE c.oid = 'public.schema_migrations_applied'::regclass;
--   -- expect true, 0
--
--   -- Then run supabase/migration_ledger_check.sql — it must return ZERO rows.

-- ─── Rollback ────────────────────────────────────────────────────────────────
--   SET ROLE postgres;
--   DROP TABLE IF EXISTS public.schema_migrations_applied;
--   RESET ROLE;
--   NOTIFY pgrst, 'reload schema';
