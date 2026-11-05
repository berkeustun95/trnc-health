-- ═══════════════════════════════════════════════════════════════════════════
-- 20261162 — delete the 70 guest users that scripts created
-- ═══════════════════════════════════════════════════════════════════════════
--
-- check-gisekibris-staleness.mjs signed in as a guest on every run and left the user behind (stopped
-- by #297); hand runs of scripts left others. They count as people on the admin screen.
--
-- WHAT IT DELETES: exactly these ids, each re-proven below at apply time: guest, no email, role
-- customer, a node/curl session, no other client, never refreshed, never used after creation, no
-- push token. One failing id aborts the whole file. Signed-up accounts cannot be reached:
-- the DELETE carries is_anonymous and the file asserts the signed-up count is unchanged.
-- Cascades: their profiles and notifications rows.
-- NOT here: guests with no live session. Nothing proves those were scripts.
--
-- Apply: supabase-migrate. Irreversible; the ids are in the vault log 2026-11-05_admin-user-counts.md.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  v_ids uuid[] := ARRAY[
    '4b10e6b4-23bd-40ad-a684-4a8d0a5ae9ef',
    '277544d7-222d-4da3-b424-417b95800e9b',
    '18011a42-258f-4f96-9e0a-6f5b50095e87',
    '71afb947-15c0-440e-9ad1-ee3011ad20ba',
    '276a62af-1533-4faa-9df2-8a4cdc75d988',
    'a176dce9-29f1-4f88-954e-04fcf5a501be',
    'b5d3f82e-9c0c-43df-8c54-7bc20ecd6af8',
    'aaaf338c-4aae-4d44-88a9-5b5bb4a7081e',
    '9377fa83-993f-483f-9fb7-84a1788da35e',
    'bfa9a8cc-cf24-4d12-805e-8b799a021af8',
    '3c5c0e35-b64c-4bc8-9b56-46f7d74d0833',
    'bdcad13c-8303-46d1-918e-177c6b642525',
    'bec70e32-1241-4225-a60a-8632f0f16041',
    '172f2a65-d3ea-4f4b-86ad-8d378feae79f',
    '8e3ced56-055c-497f-bc07-f99ebc29cf0d',
    '04ed66d3-c3a2-4985-b973-3ec530fa45a2',
    '931cef24-4518-49dc-8280-797d92080162',
    '97f3e1d4-da19-4caa-8bd4-7942ad935f36',
    'e3ca6cf5-5df4-493c-955c-8d983291fc39',
    '3a993837-917a-4285-b4cb-2927e20d7b0d',
    'b81e5e57-4a42-4fa8-b4e1-e43d9adbcc86',
    'd632887b-12db-4eb9-8c2d-6096831ad537',
    'e65b6dbc-1af7-4a0d-b5ed-4b3b55b003c0',
    '95e9ca23-035a-467f-ab73-fa8d9e12ec0a',
    '77cb2ffd-e4c9-401b-bf0a-720fda1f47df',
    '9b6c1255-27b5-45f2-a6bc-0e68ccec6aca',
    'e8736de5-ffc0-417f-8a41-839e1a3ee6e3',
    'f1c01455-4460-4818-9beb-875849d7a336',
    'fde6d611-a646-4727-b695-b88326cf6e24',
    'db2a5326-ab7d-496d-a254-21ac58f03466',
    'ed5f0472-6f40-4d50-9a1f-0ba39329ed90',
    'b8507037-8335-4dbf-afdf-2f61b67b555e',
    'acae416a-d7d1-45f1-8a4c-c92bdba45247',
    '075b149e-3cd1-4763-adcb-de92dd2cbf8a',
    'b7d8471b-6e54-4804-b936-00742704f701',
    'fcf2ce81-35fe-41b1-988b-47ffb0780c19',
    'a8831698-a99b-4d36-8a27-7b80af914f91',
    '59db104d-d791-415f-8f7b-63bd09d2b7d2',
    '1e7ee3ff-873d-4418-94a0-28a1f8d2abbb',
    '53820816-f2a5-450d-a797-90f1ee28ea5a',
    '06b4868a-32b2-4733-9fd4-98e47147d2a8',
    '46373d5b-ff82-4536-ada4-2d2e504947c3',
    '849adef4-b4f6-4968-a9c7-5f58a1876ad0',
    '9806bc86-e707-4c32-9720-bb785c6fed2b',
    'f1413a89-f58f-4459-ad39-604306dec413',
    'faff0da3-078b-4cf5-ab10-62b32a92ba72',
    '38ce22ed-6428-49a9-ae73-412a97da4b58',
    'e3172308-22ef-4ab0-a534-3d3bb0048a9b',
    'a500ccc9-3e22-48ed-a7d7-d51bcdf69165',
    'ddd5540e-df63-4d47-a766-cecf7e916928',
    'e1569bb8-8e55-4f28-b3a1-1f77af23fd13',
    '2f7e4636-b8ba-4043-aa8d-60bd48d9ac69',
    '0732afc5-933a-402d-a167-8076af8de524',
    'bb473542-ff8b-49d3-b675-4c935d13d6fd',
    'd76c2500-06b4-4ab2-b53a-ef69a62984d8',
    '28afa645-ea44-447d-9376-eb0743dfadd1',
    '5c4adf05-8cea-485a-b4ab-9f839fee2ff5',
    'c75c5d89-e888-4467-8891-8419a29ef5c8',
    '4f91b965-a03d-425b-8ce8-6537068b821a',
    'd5546a3e-5688-44e9-8cee-18f31ddd04e9',
    '506ae2d5-ff68-4905-a8ca-dbf36f0babfb',
    'fa3ed8b8-decf-4786-8cc0-334601ad988a',
    '71d6578a-9ee0-48fa-9f82-0bc7acf5e0a1',
    'dd5def50-fea7-4c1e-b9c8-e3bea73d8d4b',
    '783e3d7d-6f52-4337-87fa-5194430b4935',
    'd2980ca2-5a46-4e16-ad7b-da4f84bdbdad',
    'cfd9cf10-cd31-4b1c-99c4-24094bb2c7d1',
    '45cb636d-4129-4202-bcdb-72c6e3f3e3b0',
    '802dbfa1-881f-455b-b948-cd3c0c88e716',
    '0859e723-6447-478c-90b5-815d85552b0c'
  ]::uuid[];
  v_found    int;
  v_bad      int;
  v_deleted  int;
  v_accounts bigint;
  v_guests   bigint;
  v_left     int;
BEGIN
  SELECT count(*) INTO v_found FROM auth.users WHERE id = ANY(v_ids);
  IF v_found IS DISTINCT FROM 70 THEN
    RAISE EXCEPTION 'expected 70 listed users, found %. Nothing deleted.', v_found;
  END IF;

  SELECT count(*) INTO v_bad
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
   WHERE u.id = ANY(v_ids)
     AND NOT (
       u.is_anonymous AND u.email IS NULL AND u.deleted_at IS NULL
       AND p.role IS NOT DISTINCT FROM 'customer' AND p.push_token IS NULL
       AND GREATEST(u.updated_at, u.last_sign_in_at) <= u.created_at + interval '1 minute'
       AND EXISTS (SELECT 1 FROM auth.sessions s WHERE s.user_id = u.id
                    AND (s.user_agent ILIKE 'node%' OR s.user_agent ILIKE 'curl%'))
       AND NOT EXISTS (SELECT 1 FROM auth.sessions s WHERE s.user_id = u.id
                        AND (s.refreshed_at IS NOT NULL OR s.user_agent IS NULL
                             OR (s.user_agent NOT ILIKE 'node%' AND s.user_agent NOT ILIKE 'curl%')))
     );
  IF v_bad IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '% listed users no longer match the script-made signature. Nothing deleted.', v_bad;
  END IF;

  SELECT count(*) FILTER (WHERE NOT is_anonymous), count(*) FILTER (WHERE is_anonymous)
    INTO v_accounts, v_guests FROM auth.users;

  DELETE FROM auth.users WHERE id = ANY(v_ids) AND is_anonymous;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted IS DISTINCT FROM 70 THEN
    RAISE EXCEPTION 'deleted %, expected 70. Rolling back.', v_deleted;
  END IF;
  IF (SELECT count(*) FROM auth.users WHERE NOT is_anonymous) IS DISTINCT FROM v_accounts THEN
    RAISE EXCEPTION 'the signed-up count changed. Rolling back.';
  END IF;
  IF (SELECT count(*) FROM auth.users WHERE is_anonymous) IS DISTINCT FROM v_guests - 70 THEN
    RAISE EXCEPTION 'the guest count did not fall by exactly 70. Rolling back.';
  END IF;
  SELECT (SELECT count(*) FROM public.profiles WHERE id = ANY(v_ids))
       + (SELECT count(*) FROM public.notifications WHERE user_id = ANY(v_ids)) INTO v_left;
  IF v_left IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '% dependent rows survived the delete. Rolling back.', v_left;
  END IF;
  RAISE NOTICE 'deleted % script-made guests; signed-up unchanged at %, guests % -> %', v_deleted, v_accounts, v_guests, v_guests - v_deleted;
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
VALUES ('20261162_delete_script_guests.sql', '2f203e58f71328cbfb65d8417a28a5717f5f8f3c29c3670e144f1144f4b9d12a')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;
