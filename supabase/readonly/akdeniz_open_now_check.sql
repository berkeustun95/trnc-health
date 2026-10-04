-- Read-only. Open-now test facility (AKDENİZ ECZANESİ, 8396e795…) before its hours are written:
-- the facility row, duty_list's columns, its upcoming duty nights, and today's roster size
-- (positive control: today's roster is non-empty, so an empty Akdeniz list means no duty dates).
SELECT 'facility' AS what, f.name || ' | type ' || f.type || ' | status ' || f.status
       || ' | hours ' || coalesce(f.opening_hours, 'NULL') || ' | provider ' || coalesce(f.provider_id::text, 'NULL') AS detail
  FROM facilities f WHERE f.id = '8396e795-fb07-4fc8-bba8-c05359d76463'
UNION ALL
SELECT 'duty_list column', column_name || ' ' || data_type
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'duty_list'
UNION ALL
SELECT 'akdeniz duty', d.duty_date::text || ' | ' || d.name || ' | ' || coalesce(d.region, '?') || ' | until ' || coalesce(d.open_until::text, '?')
  FROM duty_list d
 WHERE d.name ILIKE '%AKDEN%' AND d.duty_date >= (now() AT TIME ZONE 'Europe/Istanbul')::date - 1
UNION ALL
SELECT 'roster today (control)', count(*)::text FROM duty_list d
 WHERE d.duty_date = (now() AT TIME ZONE 'Europe/Istanbul')::date;
