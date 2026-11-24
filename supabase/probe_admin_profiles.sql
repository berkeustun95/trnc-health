-- Read-only probe (2026-11-24): which admin profiles exist. Berke expected exactly one.
-- One row per admin: when the profile and sign-in account were created, last sign-in, provider,
-- and a masked e-mail hint (first two characters + domain) so Berke can tell them apart.
-- No ids are selected. The result is sealed and opened only into the vault.
SELECT row_number() OVER (ORDER BY p.created_at) AS n,
       to_char(p.created_at AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI') AS profile_created_utc,
       to_char(u.created_at AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI') AS account_created_utc,
       to_char(u.last_sign_in_at AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI') AS last_sign_in_utc,
       u.raw_app_meta_data->>'provider' AS provider,
       u.is_anonymous,
       CASE WHEN u.email IS NULL THEN NULL
            ELSE left(u.email, 2) || '…@' || split_part(u.email, '@', 2) END AS email_hint,
       p.preferred_language
FROM public.profiles p
LEFT JOIN auth.users u ON u.id = p.id
WHERE p.role = 'admin'
ORDER BY p.created_at;
