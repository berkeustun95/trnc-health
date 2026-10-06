-- 20261087 pre-flight: fingerprint of the live notify_new_message body, compared against
-- 20261066's text before 20261087 replaces it.
select json_build_object(
  'prosrc_md5', (select md5(prosrc) from pg_proc where oid = 'public.notify_new_message(uuid)'::regprocedure),
  'prosrc_len', (select length(prosrc) from pg_proc where oid = 'public.notify_new_message(uuid)'::regprocedure),
  'proconfig', (select proconfig from pg_proc where oid = 'public.notify_new_message(uuid)'::regprocedure),
  'auth_uid_def', (select pg_get_functiondef('auth.uid()'::regprocedure))
) as nnm_fingerprint;
