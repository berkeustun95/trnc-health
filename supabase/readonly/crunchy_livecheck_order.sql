-- Read-only: find Berke's step-6 live-check order (2026-10-22, 16:22–16:35 Cyprus = 13:22–13:35 UTC).
-- PUBLIC LOG: no order code, no created_by, no client_id. `fp` = first 6 hex of md5(id), a row
-- fingerprint for the later targeted delete; it cannot be used on the verify page.
-- `is_test` (20261132) shows whether the server marked the order as a TEST order (Preview app or a listed order tester; deleted after 24 h);
-- read via to_jsonb so the file still runs, with false everywhere, before 20261132 is applied.
WITH c AS (SELECT id FROM eatery_partners WHERE slug = 'crunchy-express'),
w AS (
  SELECT o.* FROM eatery_orders o JOIN c ON c.id = o.partner_id
  WHERE o.created_at >= timestamptz '2026-10-22 13:22:00+00' AND o.created_at < timestamptz '2026-10-22 13:36:00+00'
)
SELECT 'in_window' AS kind,
       left(md5(w.id::text), 6) AS fp,
       to_char(w.created_at AT TIME ZONE 'Europe/Nicosia', 'HH24:MI:SS') AS cyprus_time,
       w.created_as_guest AS guest,
       ((to_jsonb(w) ->> 'is_test')::boolean) IS TRUE AS is_test,
       (SELECT string_agg(format('%s× %s @ %s', l->>'qty', l->>'name', l->>'unit_price'), ' | ' ORDER BY ord)
          FROM jsonb_array_elements(w.lines) WITH ORDINALITY AS t(l, ord)) AS lines,
       w.total::text || ' ' || w.currency AS total,
       w.view_count AS views
FROM w
UNION ALL
SELECT 'crunchy_today_total', NULL, NULL, NULL, NULL,
       count(*) FILTER (WHERE ((to_jsonb(o) ->> 'is_test')::boolean) IS NOT TRUE)::text || ' real + '
         || count(*) FILTER (WHERE ((to_jsonb(o) ->> 'is_test')::boolean) IS TRUE)::text || ' test Crunchy orders since 2026-10-22 00:00 Cyprus', NULL, NULL
FROM eatery_orders o JOIN c ON c.id = o.partner_id
WHERE o.created_at >= timestamptz '2026-10-21 21:00:00+00'
ORDER BY kind DESC, cyprus_time;
