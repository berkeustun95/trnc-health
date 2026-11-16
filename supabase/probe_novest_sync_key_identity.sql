-- Is the Vault secret the cron jobs send (novest_sync_key) the same string as the functions' SUPABASE_SERVICE_ROLE_KEY?
-- READ-ONLY: one SELECT. Results are sealed. Prints NO key and no part of one: the first 16 hex chars of sha256(secret)
-- (the key-fingerprint workflow's format), its length, its shape, and the role claim of its payload. No user data.
select json_build_object(
  'now_utc', to_char(now() at time zone 'utc', 'Dy YYYY-MM-DD HH24:MI'),
  'secrets_named', (select count(*) from vault.secrets where name = 'novest_sync_key'),
  'key', (select json_build_object(
      'sha256_16', left(encode(sha256(convert_to(s.decrypted_secret, 'UTF8')), 'hex'), 16),
      'length', length(s.decrypted_secret),
      'trimmed', s.decrypted_secret = btrim(s.decrypted_secret, E' \t\r\n'),
      'jwt_shape', s.decrypted_secret ~ '^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$',
      'role_claim', case when s.decrypted_secret ~ '^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' then
          (convert_from(decode(rpad(translate(split_part(s.decrypted_secret, '.', 2), '-_', '+/'),
             4 * ceil(length(split_part(s.decrypted_secret, '.', 2)) / 4.0)::int, '='), 'base64'), 'UTF8')::json ->> 'role') end)
    from vault.decrypted_secrets s where s.name = 'novest_sync_key')
) as novest_sync_key_identity;
