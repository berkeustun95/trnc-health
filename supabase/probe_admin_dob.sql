-- Read-only probe (Berke, 2026-10-19): do the admin accounts meet the Home eatery slide's 18+ gate?
-- Prints NO personal data: a 6-char id prefix, whether a date_of_birth is set, and whether the age is >= 18.
SELECT left(p.id::text, 6) AS id_prefix,
       p.date_of_birth IS NOT NULL AS has_dob,
       CASE WHEN p.date_of_birth IS NULL THEN NULL
            ELSE p.date_of_birth <= (current_date - interval '18 years')::date END AS is_18_plus,
       u.is_anonymous AS anon_account
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
WHERE p.role = 'admin'
ORDER BY 1;
