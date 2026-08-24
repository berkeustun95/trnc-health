-- ─── Public health facilities — Slice 1: schema + claim guard + search ────────
--
-- Adds the axes needed to hold the TRNC state health network (devlete bağlı sağlık
-- kurumları) alongside the 411 private rows already in `facilities`, WITHOUT seeding
-- a single row and WITHOUT changing what any existing surface renders.
--
-- Plan + decisions: ~/ObsidianVault/10-ada/public-health-facilities.md
--
-- ─── WHY `sector` AND NOT `ownership` ────────────────────────────────────────
--
-- `facilities.is_public` ALREADY EXISTS and means "visible in the directory". A column
-- called `ownership` with the value 'public' sitting two columns away from a boolean
-- called `is_public` is a misreading waiting to happen, in every future query and every
-- future migration. `sector` shares no word with it.
--
-- A correctly seeded state hospital is `sector = 'public'` AND `is_public = false`.
-- Those are not in tension; they answer different questions. Read that sentence twice.
--
-- (The same trap is already live in the admin UI: the facility editor's switch is
-- labelled "Public facility" and is bound to `is_public`. This slice relabels it.)
--
-- ─── WHY A NEW `draft` STATUS AND NOT `pending` ──────────────────────────────
--
-- `facilities` HAS NO `is_active` COLUMN. The CLAUDE.md rule "every seeded row must be
-- is_active = false" therefore has to be expressed in `status` + `is_public`, and the
-- obvious choice — 'pending' — is the wrong one:
--
--   AdminScreen.js:293 counts `status='pending' AND type<>'grooming'` and renders it as
--   the admin's "facilities awaiting approval" badge. Seeding ~36 rows that are never
--   going to be approved-by-that-flow would park a permanent 36 on the one number whose
--   entire job is to say "there is work to do here". It would then be ignored, and the
--   next REAL pending facility would be ignored with it.
--
-- 'suspended' would be free but means *moderated / punished* everywhere else in the app
-- (danger-red pill, AdminScreen.js:2973). Overloading it would make "why is Dr. Burhan
-- Nalbantoğlu suspended?" a question somebody has to ask.
--
-- So: a fifth value, 'draft'. Every read path in the app is written by INCLUSION
-- (`status IN ('active','trial')`) — verified across the RLS policies, search_content
-- and both client list filters — so 'draft' is invisible everywhere the moment it
-- exists, with no other change. See the verification block at the foot of this file.
--
-- ─── WHY THE CLAIM GUARD IS IN *THIS* SLICE AND NOT THE UI SLICE ─────────────
--
-- Today a public row could not be claimed even without this guard: it is `draft`, RLS
-- hides `draft` from everyone, so it never reaches the claim picker. That is protection
-- BY ACCIDENT. The moment one row is flipped to 'active' — a step that is coming, and
-- that touches no code — Dr. Burhan Nalbantoğlu Devlet Hastanesi becomes claimable by
-- any provider account that can produce a tax number, with no warning and nothing to
-- review. Same shape as towing_companies.is_active DEFAULT false: protect the path
-- nobody has written yet, not just the one somebody wrote.
--
-- ─── WHAT THIS DOES NOT DO ───────────────────────────────────────────────────
--
-- No rows seeded (section 6b CORRECTS seven existing rows; it inserts none).
-- No MODULE_FLAGS touched. `facilities_type_check` UNCHANGED — public
-- rows reuse the legacy four (`hospital` / `clinic` / `dentist`), so every existing
-- chip row, map marker, icon map and admin editor keeps working with zero edits.
-- AREAS_BY_REGION is NOT touched (canonical; blast radius across Explore + Garages).
--
-- ADDITIVE + idempotent EXCEPT FOR SECTION 6b, which WRITES to seven live rows. That
-- section was added after BLOCK V0 was run against the live database and found seven
-- state hospitals that exist in no repo seed. It is idempotent (re-running sets the same
-- values, and it tolerates the Girne duplicate having been retired) but it is NOT
-- additive — read it before pasting.
--
-- EXECUTION: SET ROLE postgres — ALTER TABLE facilities needs the table owner and the
-- SQL editor runs as 'authenticated'. session_user is postgres so the switch is allowed.

SET ROLE postgres;

BEGIN;

-- ─── 1. sector — public | private ────────────────────────────────────────────
-- Nullable-then-backfill-then-NOT NULL rather than a single ADD COLUMN … NOT NULL
-- DEFAULT, so a half-applied re-run converges instead of erroring.
ALTER TABLE public.facilities ADD COLUMN IF NOT EXISTS sector text;

UPDATE public.facilities SET sector = 'private' WHERE sector IS NULL;

ALTER TABLE public.facilities ALTER COLUMN sector SET DEFAULT 'private';
ALTER TABLE public.facilities ALTER COLUMN sector SET NOT NULL;

-- DEFAULT 'private' is the safe default here, and deliberately NOT the inverted-default
-- trick used by towing_companies.is_active. `sector` does not control visibility, so a
-- wrong value cannot publish anything; and EVERY self-serve write path that exists
-- (create_facility_claim, create_grooming_facility, create_garage_facility, provider
-- onboarding) creates a private business and will never be taught to pass this column.
-- An omitted sector must land 'private' or those four paths all break at once.
ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_sector_check;
ALTER TABLE public.facilities ADD CONSTRAINT facilities_sector_check
  CHECK (sector = ANY (ARRAY['public'::text, 'private'::text]));

-- ─── 2. public_facility_type — the ministry's own structure ──────────────────
-- FOUR values. `dental_polyclinic` is deliberately ABSENT: there is exactly one
-- standalone public dental site (Tren Yolu Diş Polikliniği), while the real question
-- users ask — "which sağlık merkezi has a dentist?" — is about ~12 rows that are
-- already health_centre and which a type value therefore cannot express. Dental is
-- carried in `specialty` instead, which finds all 13 with the filter machinery that
-- already exists. Koruyucu Ruh Sağlığı Merkezi follows the identical rule.
ALTER TABLE public.facilities ADD COLUMN IF NOT EXISTS public_facility_type text;

ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_public_facility_type_check;
ALTER TABLE public.facilities ADD CONSTRAINT facilities_public_facility_type_check
  CHECK (
    public_facility_type IS NULL
    OR public_facility_type = ANY (ARRAY['hospital'::text, 'health_centre'::text,
                                         'polyclinic'::text, 'health_room'::text])
  );

-- Couple it to sector, exactly like facilities_garage_service_types_check couples
-- service_types to type: a public row MUST carry one, nothing else MAY.
ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_public_type_sector_check;
ALTER TABLE public.facilities ADD CONSTRAINT facilities_public_type_sector_check
  CHECK ((sector =  'public' AND public_facility_type IS NOT NULL)
      OR (sector <> 'public' AND public_facility_type IS NULL));

-- ─── 3. tier — primary | secondary | tertiary | unknown ─────────────────────
-- HALF-coupled, on purpose. Public rows must have a tier or the routing screen can hit
-- a tierless row and answer nothing. Private rows are left free so the private pass can
-- backfill tiers later without another migration.
ALTER TABLE public.facilities ADD COLUMN IF NOT EXISTS tier text;

-- 'unknown' IS A REAL VALUE, NOT A GAP. Acil Durum Hastanesi cannot be classified from
-- any source that exists: the ministry HASTANELER page carries only a link, and the
-- hospital's own site (adh.gov.ct.tr) states no basamak. NULL would be ambiguous — never
-- set? not applicable? genuinely unknown? — and ambiguity in a column the routing screen
-- reads is the thing to avoid. 'unknown' says exactly one thing.
--
-- This is what keeps facilities_public_tier_required_check GLOBAL and unrelaxed below:
-- a public row must still carry a tier, and NULL is still refused. The alternative
-- considered and REJECTED was a row-scoped CHECK exemption naming Acil Durum's uuid —
-- that would encode a data accident in the schema, need a second migration to re-tighten,
-- and dangle if the row were ever recreated.
--
-- THE GUARD AGAINST 'unknown' BECOMING THE LAZY DEFAULT is not in this file — it is the
-- verification block that asserts EXACTLY ONE row carries it. A value that costs nothing
-- to reach for gets reached for; a value that trips a check when it spreads does not.
ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_tier_check;
ALTER TABLE public.facilities ADD CONSTRAINT facilities_tier_check
  CHECK (
    tier IS NULL
    OR tier = ANY (ARRAY['primary'::text, 'secondary'::text, 'tertiary'::text, 'unknown'::text])
  );

-- GLOBAL AND UNRELAXED. Every public row must carry a tier — NULL is refused, with no
-- exemptions and no per-row carve-outs. The one row nobody can classify carries the
-- real value 'unknown' instead (section 3), so the guarantee never had to bend.
ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_public_tier_required_check;
ALTER TABLE public.facilities ADD CONSTRAINT facilities_public_tier_required_check
  CHECK (sector <> 'public' OR tier IS NOT NULL);

-- ─── 4. parent_facility_id — attached units ──────────────────────────────────
-- Thalassaemia Merkezi and Radyasyon Onkoloji Merkezi are units inside Dr. Burhan
-- Nalbantoğlu, not independent sites.
--
-- ON DELETE SET NULL, not CASCADE: deleting a hospital must not silently delete its
-- oncology centre. An orphaned unit is a visible problem; a vanished one is not.
--
-- DEPTH IS NOT ENFORCED. The CHECK below stops a row parenting itself, and nothing
-- stops a grandchild or a longer cycle. One level is all the real data has. If that
-- ever changes this needs a real recursive guard — do not assume this one covers it.
ALTER TABLE public.facilities ADD COLUMN IF NOT EXISTS parent_facility_id uuid;

ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_parent_facility_id_fkey;
ALTER TABLE public.facilities ADD CONSTRAINT facilities_parent_facility_id_fkey
  FOREIGN KEY (parent_facility_id) REFERENCES public.facilities(id) ON DELETE SET NULL;

ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_parent_not_self_check;
ALTER TABLE public.facilities ADD CONSTRAINT facilities_parent_not_self_check
  CHECK (parent_facility_id IS DISTINCT FROM id);

-- Partial: only ~2 rows will ever be non-NULL, so a full index would be almost entirely
-- dead entries. Matches idx_facilities_provider_id in intent (0719_add_missing_indexes).
CREATE INDEX IF NOT EXISTS idx_facilities_parent_facility_id
  ON public.facilities (parent_facility_id)
  WHERE parent_facility_id IS NOT NULL;

-- ─── 5. name_official — the eponym form ──────────────────────────────────────
-- `name` is NOT renamed and NOT duplicated. It is referenced by search_content, the
-- admin editor, notification bodies, favourites, reviews and the map callout; a second
-- display column would guarantee the two drift apart.
--
--   name           = what people actually say   "Değirmenlik Sağlık Merkezi"
--   name_official  = the ministry's eponym form "Dr Engin Arkan Değirmenlik Sağlık Merkezi"
--
-- Nobody local will ever type the eponym, which is exactly why BOTH must be searchable:
-- the eponym is what appears on the building and on any official document a newcomer
-- is holding. Step 9 makes search match it.
ALTER TABLE public.facilities ADD COLUMN IF NOT EXISTS name_official text;

-- ─── 6. status: add 'draft' ──────────────────────────────────────────────────
-- Same-name DROP/ADD, so an existence check by name CANNOT tell the 4-value constraint
-- from the 5-value one. Registered as an H-section token in verify_schema.sql for
-- exactly that reason — see the note there.
ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_status_check;
ALTER TABLE public.facilities ADD CONSTRAINT facilities_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'trial'::text, 'active'::text,
                             'suspended'::text, 'draft'::text]));

-- ─── 6b. CORRECT THE SEVEN STATE HOSPITALS THAT ARE ALREADY LIVE ────────────
--
-- ⚠ THIS SECTION IS NOT ADDITIVE. It WRITES to seven existing rows. Everything above
-- this line only adds structure; this changes live data. Read it before pasting.
--
-- WHY IT IS HERE AND NOT IN A FOLLOW-UP SCRIPT: `sector` DEFAULTs to 'private', so the
-- moment section 1 runs, all seven TRNC state hospitals are labelled private. They are
-- `status='active'` and `provider_id IS NULL`, which means they are CLAIMABLE — and the
-- claim guard in section 8 keys on `sector='public'`. A follow-up script would leave a
-- window in which the guard exists and does not protect the only rows that need it.
-- Same transaction, or it is not a fix.
--
-- These seven were hand-entered through AdminScreen and appear in NO repo seed, so no
-- amount of reading this repository would have found them. They were found by running
-- BLOCK V0 of the verification file against the live database. That is what V0 is for.
--
-- ─── KEYED ON ID, NOT NAME ──────────────────────────────────────────────────
-- Full uuids supplied by the project owner from the live DB. Name matching was the
-- earlier draft and was worse: `Barış Ruh ve Sinir Hastalıkları Hastanesi` matched by
-- string is fragile against a trailing space, a non-breaking space, or `ı` vs `i` —
-- and a silent zero-row UPDATE here leaves a state hospital claimable while the
-- migration reports success. The DO block RAISES unless each id matches exactly one row.
--
-- ─── ONE UPDATE PER ROW, NOT THREE ──────────────────────────────────────────
-- `UPDATE … SET sector='public'` on its own violates facilities_public_type_sector_check
-- instantly, because public_facility_type would still be NULL. All columns move in a
-- single statement. If you hit that error mid-paste, the fix is NOT to drop the CHECK.
--
-- ─── TIER CITATIONS (Yataklı Tedavi Kurumları Dairesi, verbatim) ────────────
--   Gazimağusa   "II. Basamak tedavi hizmeti sunan 186 yatak kapasiteli bir bölge
--                 hastahanesidir"                                       → secondary
--   Akçiçek      "Girne bölgesinde bulunan ve bölge halkına II. Basamak tedavi hizmeti
--                 sunan 48 yatak kapasiteli bir bölge hastahanesidir"   → secondary
--   Cengiz Topel "Güzelyurt bölgesinde bulunan ve bölge halkına II. Basamak tedavi
--                 hizmeti sunan 45 yatak kapasiteli bir bölge hastahanesidir"
--                                                                       → secondary
--   BNDH         the ministry calls it "ülkenin en büyük II. Basamak tedavi hizmeti
--                 veren hastahanesi" — i.e. SECONDARY. We record TERTIARY anyway, on the
--                 ministry's own evidence: Radyasyon Onkoloji is "Dr. Burhan Nalbantoğlu
--                 Devlet Hastahanesi'ne bağlı olarak çalışan, KKTC'nin TEK kanser tanı ve
--                 tedavi merkezi" and Thalassaemia is likewise "BNDH'ne bağlı". A hospital
--                 that is the country's sole provider of oncology, radiotherapy and
--                 thalassaemia care is functionally tertiary whatever the 1999-era text
--                 calls it. THE CONFLICT IS RECORDED RATHER THAN HIDDEN — if TRNC ever
--                 designates a real III. Basamak facility, revisit this row first.
--   Barış        "KKTC'deki ruh ve sinir hastalıklarının tedavisinin yapıldığı TEK
--                 hastahanedir" — sole national provider, but NO basamak is stated, and
--                 sole-provider-ness is a SPECIALTY fact, not a severity tier. secondary;
--                 the mental-health distinction goes in `specialty` (Slice 2), the same
--                 rule already applied to Koruyucu Ruh Sağlığı Merkezi.
--   Acil Durum   NO CLASSIFICATION EXISTS. Ministry page carries only a link; the
--                 hospital's own site states no basamak. → tier = 'unknown', the honest
--                 placeholder. One-row UPDATE when it is established.
--
-- ─── THE GIRNE DUPLICATE IS HIDDEN, NOT MERGED ──────────────────────────────
-- 91338177… and 7a1c598d… are the same hospital. TWO GIRNE HOSPITALS RENDERING IN THE
-- DIRECTORY IS THE URGENT PROBLEM; merging their data is NOT urgent and IS irreversible.
-- So this migration sets the duplicate to status='draft': invisible, unclaimable, zero
-- rows destroyed, no CASCADE exposure. Dr. Akçiçek is canonical and stays 'active'.
--
-- Repointing-or-destroying its inbound references becomes its own reviewed slice.
-- supabase/reports/girne_duplicate_fk_counts.sql counts them and writes nothing —
-- and its QUERY 5 is why this is not decided in a migration paste: most inbound FKs are
-- ON DELETE CASCADE, so deleting the duplicate would not orphan its reviews, questions
-- and claim history, it would DESTROY them.
DO $$
DECLARE
  r record;
  n int;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('56614fa9-d7ba-4528-9fe4-f372e9f9286a'::uuid, 'Acil Durum Hastanesi',                      'unknown',   'active'),
      ('3d108354-79cd-4a11-8173-e7c996d4bcd0'::uuid, 'Barış Ruh ve Sinir Hastalıkları Hastanesi', 'secondary', 'active'),
      ('e83f3d1d-c0c0-4e68-993c-03a8164286c1'::uuid, 'Dr. Burhan Nalbantoğlu Devlet Hastanesi',   'tertiary',  'active'),
      ('ed83578f-1866-4e54-9253-705feb093c22'::uuid, 'Gazimağusa Devlet Hastanesi',               'secondary', 'active'),
      -- The duplicate. status='draft' is the whole point of this row's entry.
      ('91338177-85d8-4f38-8b0f-2c395638d2d4'::uuid, 'Girne Devlet Hastanesi (DUPLICATE)',        'secondary', 'draft'),
      ('7a1c598d-bc43-4b50-9f42-f94adffffe5d'::uuid, 'Girne Dr. Akçiçek Devlet Hastanesi',        'secondary', 'active'),
      ('32dafd70-73fb-4aec-afb2-6c940d07e9b9'::uuid, 'Lefke Cengiz Topel Hastanesi',              'secondary', 'active')
    ) AS t(fid, label, tr, st)
  LOOP
    SELECT count(*) INTO n FROM public.facilities WHERE id = r.fid;
    IF n <> 1 THEN
      RAISE EXCEPTION 'public-health correction: expected exactly 1 facility with id % (%), found % — resolve before applying', r.fid, r.label, n;
    END IF;
    -- Every column in ONE statement; see the note above. `status` is included because
    -- the Girne duplicate needs it; for the other six it is a no-op write of the value
    -- they already carry, which keeps this loop uniform and re-runnable.
    UPDATE public.facilities
       SET sector = 'public', public_facility_type = 'hospital', tier = r.tr, status = r.st
     WHERE id = r.fid;
  END LOOP;

  -- The 'unknown' tier must stay a one-off. If this ever fires, somebody reached for it
  -- instead of reading a source — which is the failure mode a cheap placeholder invites.
  SELECT count(*) INTO n FROM public.facilities WHERE tier = 'unknown';
  IF n <> 1 THEN
    RAISE EXCEPTION 'public-health correction: expected exactly 1 row with tier=''unknown'' (Acil Durum), found % — ''unknown'' is not a default', n;
  END IF;

  RAISE NOTICE 'public-health correction: 7 rows -> sector=public; Girne duplicate 91338177 -> draft; Acil Durum tier=unknown';
END $$;

-- DELIBERATELY NOT TOUCHED BY THIS CORRECTION:
--   • ACK Clinic (2cf2aa52…) and Nutripedia Wellness Centre (f7cf30b4…) — both private,
--     both have a provider_id, both already correct. The DEFAULT handles them.
--   • `city` — all seven are NULL and stay NULL. Region is established by the coordinate
--     pass (resolveRegion on the placed pin), the agreed audit mechanism. Writing a region
--     here would be the guess that pass exists to avoid.
--   • `name_official` and `specialty` — Slice 2 reconciliation, not a data fix. That is
--     where Barış gets its mental-health specialty and Kronik Hastalıklar its care-home one.
--   • `is_public` — untouched. Decorative on this table since 20260820 dropped the
--     is_public term from the read gate; `status` is what actually governs visibility,
--     which is why the duplicate is hidden with `status`, not with this.
--   • The six canonical rows stay `status='active'`. They are real hospitals users can
--     already find; hiding them to tidy the data model would be a regression for anyone
--     who needs one tonight.

-- ─── 7. update guard — the five new columns are admin-only ──────────────────
--
-- THE MIRROR OF STEP 8, AND THE MORE DANGEROUS HALF. Step 8 stops a provider claiming
-- a state facility. This stops a provider DECLARING THEMSELVES one.
--
-- facilities_guard_update is a DENY-LIST: it names the columns an owner may not change
-- and lets everything else through. A new column is therefore owner-writable THE MOMENT
-- IT IS ADDED, and the "Provider can update own facility" RLS policy has no column
-- granularity to fall back on. Without the five branches below, any provider could
-- UPDATE their own row to:
--
--     sector = 'public', public_facility_type = 'health_centre', tier = 'primary'
--
-- — which satisfies every CHECK in this migration, is indistinguishable from a real
-- ministry row, and would be handed to users by the Slice 5 routing screen as the
-- answer to "I have X, where do I actually go?". They could also set
-- parent_facility_id to Dr. Burhan Nalbantoğlu and appear as a unit inside the
-- national referral hospital.
--
-- name_official is locked for the same reason: it is now searchable (step 9), so an
-- owner writing "Devlet Hastanesi" into it makes their private clinic answer to a
-- search for the state one.
--
-- ⚠ NOTE THE ASYMMETRY, WHICH THIS MIGRATION DOES NOT FIX: plain `name` is NOT locked
-- for non-garage rows. 20260718 locked the contact fields; the 0802-0809 rewrites
-- dropped those locks and kept only the garage carve-out. So an owner can already
-- rename themselves freely. That is a pre-existing hole, it is out of scope here, and
-- it is written down rather than quietly inherited.
--
-- Body reproduced VERBATIM from 20260809_featured_expiry_reminder.sql — the true latest
-- definition (0802 → 0803 → 0804 → 0808 → 0809; the H-token in verify_schema tracks the
-- 0808 featured_requested_at branch, and 0809 added featured_reminded_at after it).
-- Basing this on 20260808 would silently drop the reminder lock; basing it on 20260718
-- would drop five other things. ONLY the flagged block below is new.
--
-- Not SECURITY DEFINER and no SET search_path — reproduced as-is. The 0718 original had
-- both; the 0802 rewrite dropped them and every version since has run as invoker. This
-- migration does not change that: the admin lookup reads the caller's OWN profiles row,
-- which their RLS always permits. Flagged, not silently "fixed" — changing a live
-- guard's security context is its own migration with its own verification.
CREATE OR REPLACE FUNCTION public.facilities_guard_update()
 RETURNS trigger LANGUAGE plpgsql AS $function$
declare is_admin_user boolean;
begin
  if current_setting('app.trusted_facility_write', true) = '1' then
    return new;
  end if;

  if auth.uid() is null then return new; end if;
  select exists(select 1 from profiles where id = auth.uid() and role = 'admin')
    into is_admin_user;
  if is_admin_user then return new; end if;
  if new.verified is distinct from old.verified then
    raise exception 'facilities: verified is admin-only'; end if;
  if new.status is distinct from old.status then
    raise exception 'facilities: status is admin-only'; end if;
  if new.is_public is distinct from old.is_public then
    raise exception 'facilities: is_public is admin-only'; end if;
  if new.provider_id is distinct from old.provider_id then
    raise exception 'facilities: provider_id is immutable'; end if;
  if new.membership_tier is distinct from old.membership_tier then
    raise exception 'facilities: membership_tier is admin-only'; end if;
  if new.trial_ends_at is distinct from old.trial_ends_at then
    raise exception 'facilities: trial_ends_at is admin-only'; end if;

  if new.featured_until is distinct from old.featured_until then
    raise exception 'facilities: featured_until is admin-only'; end if;
  if new.featured_requested_at is distinct from old.featured_requested_at then
    raise exception 'facilities: featured_requested_at is set via request_featured_facility'; end if;

  if new.featured_reminded_at is distinct from old.featured_reminded_at then
    raise exception 'facilities: featured_reminded_at is admin-only'; end if;

  -- NEW (0911): the public-health axes. A provider must never be able to declare
  -- their own listing part of the state network, nor attach it to a state hospital.
  if new.sector is distinct from old.sector then
    raise exception 'facilities: sector is admin-only'; end if;
  if new.public_facility_type is distinct from old.public_facility_type then
    raise exception 'facilities: public_facility_type is admin-only'; end if;
  if new.tier is distinct from old.tier then
    raise exception 'facilities: tier is admin-only'; end if;
  if new.parent_facility_id is distinct from old.parent_facility_id then
    raise exception 'facilities: parent_facility_id is admin-only'; end if;
  if new.name_official is distinct from old.name_official then
    raise exception 'facilities: name_official is admin-only'; end if;

  -- Garage material-field lock (20260802) — unchanged.
  if old.type = 'garage' then
    if new.name is distinct from old.name then
      raise exception 'facilities: garage name changes must go through update_garage_facility'; end if;
    if new.service_types is distinct from old.service_types then
      raise exception 'facilities: garage service_types changes must go through update_garage_facility'; end if;
    if new.address is distinct from old.address then
      raise exception 'facilities: garage address changes must go through update_garage_facility'; end if;
  end if;

  return new;
end $function$;

-- ─── 8. claim guard — a public facility cannot be claimed ────────────────────
-- Whole function reproduced from the live version (20260719_claim_evidence_and_guard);
-- the ONLY change is the sector branch and folding the sector lookup into the existing
-- provider_id SELECT rather than adding a second round-trip.
--
-- SECURITY DEFINER IS LOAD-BEARING HERE, NOT INCIDENTAL. If this ran as INVOKER, the
-- `SELECT … FROM facilities` below would return NO ROW for a draft facility under the
-- caller's own RLS, target_sector would be NULL, and the new check would pass
-- vacuously — a guard that is green precisely when it matters. Do not "tidy" the
-- SECURITY DEFINER away.
CREATE OR REPLACE FUNCTION claim_requests_guard_insert() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_admin        boolean;
  target_owner    uuid;
  target_sector   text;
  dup_exists      boolean;
BEGIN
  -- System context (no JWT, e.g. seed / service-role writes): trust it.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    INTO is_admin;
  IF is_admin THEN
    RETURN NEW;                                        -- admin may file anything
  END IF;

  -- One lookup, both facts.
  SELECT provider_id, sector INTO target_owner, target_sector
    FROM facilities WHERE id = NEW.facility_id;

  -- Unclaimed-only: the facility must not already have an owner.
  IF target_owner IS NOT NULL THEN
    RAISE EXCEPTION 'claim_requests: facility already claimed';
  END IF;

  -- A state facility has no owner to verify and nothing to sell. There is no evidence
  -- a private party could produce that would make claiming a public hospital correct,
  -- so this is a flat refusal rather than an extra review step.
  IF target_sector = 'public' THEN
    RAISE EXCEPTION 'claim_requests: public health facilities cannot be claimed';
  END IF;

  -- Queue-spam guard: no second pending claim by the same requester on the same
  -- facility while one is still awaiting review.
  SELECT EXISTS(
    SELECT 1 FROM claim_requests
     WHERE facility_id  = NEW.facility_id
       AND requester_id = NEW.requester_id
       AND status       = 'pending'
  ) INTO dup_exists;
  IF dup_exists THEN
    RAISE EXCEPTION 'claim_requests: duplicate pending claim';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS claim_requests_guard_insert ON claim_requests;
CREATE TRIGGER claim_requests_guard_insert
  BEFORE INSERT ON claim_requests
  FOR EACH ROW EXECUTE FUNCTION claim_requests_guard_insert();

-- ─── 9. search_content — match name_official ─────────────────────────────────
-- Base body taken VERBATIM from 20260906_search_content_add_towing.sql, which is the
-- true live definition (0907 and 0908 only mention the function in comments; they do
-- not re-create it). The ONLY change is one line in the facilities arm. Basing this on
-- the 0820 version instead would have silently deleted the towing arm.
--
-- The facilities WHERE stays written by INCLUSION — `status IN ('active','trial')` —
-- which is what makes the new 'draft' value invisible here by construction rather than
-- by anyone remembering to exclude it.
--
-- BEHAVIOUR-ONLY CREATE OR REPLACE: adds no new named object, so existence checks
-- cannot tell the new body from the old. H-section token in verify_schema.sql.
CREATE OR REPLACE FUNCTION public.search_content(query text, user_lat double precision DEFAULT NULL::double precision, user_lon double precision DEFAULT NULL::double precision)
 RETURNS TABLE(id text, title text, subtitle text, module text, lat double precision, lon double precision)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT *
  FROM (

    -- Medical facilities — moderation-gated (hide suspended / pending / draft / hidden)
    SELECT
      f.id::text,
      f.name                                        AS title,
      COALESCE(f.address, f.type::text, '')         AS subtitle,
      'medical'                                     AS module,
      f.latitude                                    AS lat,
      f.longitude                                   AS lon
    FROM facilities f
    WHERE f.hidden_at IS NULL
      AND f.status IN ('active','trial')
      AND (f.name          ILIKE '%' || query || '%'
        OR f.name_official ILIKE '%' || query || '%'
        OR f.address       ILIKE '%' || query || '%')

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

    UNION ALL

    -- Towing / roadside-assistance firms (Çekici & Yol Yardım).
    -- SECURITY INVOKER means towing_select_public already hides inactive rows from a
    -- normal caller; the explicit is_active filter is belt-and-braces so an ADMIN
    -- searching does not get inactive firms mixed into their results (their RLS would
    -- otherwise let those through via towing_select_admin_all).
    SELECT
      tc.id::text,
      tc.name                                       AS title,
      initcap(tc.base_region)                       AS subtitle,
      'towing'                                      AS module,
      NULL::float8                                  AS lat,
      NULL::float8                                  AS lon
    FROM towing_companies tc
    WHERE tc.is_active
      AND tc.name ILIKE '%' || query || '%'

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
VALUES ('20260911_facilities_public_health.sql', '04c9426ca0e99a6308a2ba433da1243ee814c882cdec48fb0d6b642409608a67')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

-- PostgREST schema-cache refresh. MANDATORY tail on every ADD COLUMN migration: without
-- it a stale cache raises 42703 "column does not exist" through the REST API even though
-- the column exists in Postgres. Five columns were added above.
NOTIFY pgrst, 'reload schema';

-- ─── Verification ────────────────────────────────────────────────────────────
-- Run supabase/verify_facilities_public_health.sql. It is written in the
-- verify_contact_events.sql house style: several blocks are EXPECTED TO ERROR, and the
-- error is the pass. Do not skip the ones that fail — those are the only checks in the
-- file that have been watched go red.

-- ─── Rollback ────────────────────────────────────────────────────────────────
--   SET ROLE postgres; BEGIN;
--   -- 1. restore the 4-value status CHECK (FAILS if any row is already 'draft' —
--   --    that is correct: fix the rows first, deliberately, before narrowing).
--   ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_status_check;
--   ALTER TABLE public.facilities ADD CONSTRAINT facilities_status_check
--     CHECK (status = ANY (ARRAY['pending','trial','active','suspended']::text[]));
--   -- 2. drop the new objects
--   DROP INDEX IF EXISTS public.idx_facilities_parent_facility_id;
--   ALTER TABLE public.facilities
--     DROP CONSTRAINT IF EXISTS facilities_public_tier_required_check,
--     DROP CONSTRAINT IF EXISTS facilities_public_type_sector_check,
--     DROP CONSTRAINT IF EXISTS facilities_parent_not_self_check,
--     DROP CONSTRAINT IF EXISTS facilities_parent_facility_id_fkey,
--     DROP CONSTRAINT IF EXISTS facilities_tier_check,
--     DROP CONSTRAINT IF EXISTS facilities_public_facility_type_check,
--     DROP CONSTRAINT IF EXISTS facilities_sector_check;
--   ALTER TABLE public.facilities
--     DROP COLUMN IF EXISTS name_official,
--     DROP COLUMN IF EXISTS parent_facility_id,
--     DROP COLUMN IF EXISTS tier,
--     DROP COLUMN IF EXISTS public_facility_type,
--     DROP COLUMN IF EXISTS sector;
--   -- NB: section 6b's writes are NOT undone by the above. Dropping the columns removes
--   --     sector/tier/public_facility_type outright, but the Girne duplicate stays
--   --     status='draft' — re-activate it by hand if you really mean to un-hide it.
--   -- 3. re-apply 20260809_featured_expiry_reminder.sql (update guard),
--   --    20260719_claim_evidence_and_guard.sql (claim guard) and
--   --    20260906_search_content_add_towing.sql (search) to restore those three bodies.
--   COMMIT; RESET ROLE;
--   NOTIFY pgrst, 'reload schema';
