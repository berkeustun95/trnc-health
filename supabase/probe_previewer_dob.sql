-- Read-only probe (Berke, 2026-10-19): does the previewer customer account meet the Home eatery slide's 18+ gate?
-- Prints NO personal data: whether the row exists, its role, whether a date_of_birth is set, whether age >= 18.
SELECT count(*) AS rows_found,
       max(p.role) AS role,
       bool_or(p.date_of_birth IS NOT NULL) AS has_dob,
       bool_or(p.date_of_birth <= (current_date - interval '18 years')::date) AS is_18_plus,
       bool_or(u.is_anonymous) AS anon_account
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
WHERE p.id = '412cad91-2e3b-41b9-8186-175dfb8afa35';
