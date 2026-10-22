-- Crunchy Express pre-launch readback (read-only). Counts and checks only: this repo and its
-- workflow logs are PUBLIC, so no order codes, no account ids, no free text from orders.
-- Expected before activation: is_active false; 46 items, 46 available, 30 with photos, 46 tagged
-- (26 mains); logo + pin + maps link + phone/whatsapp +905391161059; menu_verified_on <= 30 days;
-- eatery_orders = test orders only (Crunchy has never been active, so every row is a test).
WITH p AS (SELECT * FROM eatery_partners WHERE slug = 'crunchy-express')
SELECT
  (SELECT count(*) FROM p)                                                        AS partner_rows,
  (SELECT is_active FROM p)                                                       AS is_active,
  (SELECT adult_only FROM p)                                                      AS adult_only,
  (SELECT order_requires_account FROM p)                                          AS order_requires_account,
  (SELECT lat IS NOT NULL AND lng IS NOT NULL FROM p)                             AS has_pin,
  (SELECT geocode_source FROM p)                                                  AS geocode_source,
  (SELECT logo_path IS NOT NULL FROM p)                                           AS has_logo,
  (SELECT maps_url IS NOT NULL FROM p)                                            AS has_maps_url,
  (SELECT phone = '+905391161059' AND whatsapp = '+905391161059' FROM p)          AS contacts_ok,
  (SELECT address IS NOT NULL FROM p)                                             AS has_address,
  (SELECT opening_hours IS NOT NULL AND jsonb_typeof(opening_hours) IS NOT NULL FROM p) AS has_hours,
  (SELECT menu_verified_on FROM p)                                                AS menu_verified_on,
  (SELECT (current_date - menu_verified_on) FROM p)                               AS menu_age_days,
  (SELECT count(*) FROM eatery_menu_items i JOIN p ON p.id = i.partner_id)                         AS items,
  (SELECT count(*) FROM eatery_menu_items i JOIN p ON p.id = i.partner_id WHERE i.is_available)    AS items_available,
  (SELECT count(*) FROM eatery_menu_items i JOIN p ON p.id = i.partner_id WHERE i.photo_path IS NOT NULL) AS items_with_photo,
  (SELECT count(*) FROM eatery_menu_items i JOIN p ON p.id = i.partner_id WHERE i.role IS NOT NULL) AS items_tagged,
  (SELECT count(*) FROM eatery_menu_items i JOIN p ON p.id = i.partner_id WHERE i.role = 'main')   AS mains,
  (SELECT count(*) FROM eatery_menu_items i JOIN p ON p.id = i.partner_id WHERE i.price IS NULL)   AS items_without_price,
  (SELECT count(*) FROM eatery_photos ph JOIN p ON p.id = ph.partner_id)                            AS gallery_menu_photos,
  (SELECT count(*) FROM eatery_partners WHERE is_active)                                            AS active_partners_total,
  (SELECT count(*) FROM eatery_orders)                                                              AS orders_total,
  (SELECT count(*) FROM eatery_orders o JOIN p ON p.id = o.partner_id)                              AS orders_crunchy,
  (SELECT min(created_at)::date FROM eatery_orders)                                                 AS orders_first_day,
  (SELECT max(created_at)::date FROM eatery_orders)                                                 AS orders_last_day,
  (SELECT count(*) FROM cron.job WHERE jobname = 'eatery-orders-retention')                        AS retention_cron_jobs,
  (SELECT count(*) FROM schema_migrations_applied WHERE filename LIKE '2026112%')                   AS ledger_1120s;
