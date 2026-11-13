-- Read-only probe (2026-11-13): which 2026119x migrations the production ledger records, before the
-- production OTA from 6cdf106c (carries #388, Admin Restaurant PINs). File names, checksum prefixes
-- and timestamps only; no user data.
SELECT filename, left(checksum, 12) AS checksum_prefix, applied_at
FROM public.schema_migrations_applied
WHERE filename LIKE '2026119%'
ORDER BY filename;
