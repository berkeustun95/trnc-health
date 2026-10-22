-- Read-only: every Crunchy Express order created today (Cyprus time), to identify test orders before a cleanup.
-- PUBLIC LOG: no order code, no created_by, no client_id. `fp` = first 6 hex of md5(id), a row fingerprint for a
-- targeted delete; it cannot be used on the verify page. Items/total/time carry no identity.
WITH c AS (SELECT id FROM eatery_partners WHERE slug = 'crunchy-express')
SELECT left(md5(o.id::text), 6) AS fp,
       to_char(o.created_at AT TIME ZONE 'Europe/Nicosia', 'HH24:MI:SS') AS cyprus_time,
       o.created_as_guest AS guest,
       (SELECT string_agg(format('%s× %s @ %s', l->>'qty', l->>'name', l->>'unit_price'), ' | ' ORDER BY ord)
          FROM jsonb_array_elements(o.lines) WITH ORDINALITY AS t(l, ord)) AS lines,
       o.total::text || ' ' || o.currency AS total,
       o.view_count AS views
FROM eatery_orders o JOIN c ON c.id = o.partner_id
WHERE o.created_at >= (date_trunc('day', now() AT TIME ZONE 'Europe/Nicosia') AT TIME ZONE 'Europe/Nicosia')
ORDER BY o.created_at;
