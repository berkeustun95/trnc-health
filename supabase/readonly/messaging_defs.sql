-- Live bodies of the messaging RPCs, for the 20261095 harness fixture (non-TRNC messaging test).
select json_build_object(
  'start_conversation', pg_get_functiondef(to_regprocedure('public.start_conversation(uuid,text)')),
  'send_message', pg_get_functiondef(to_regprocedure('public.send_message(uuid,text)')),
  'may_initiate_by_age', pg_get_functiondef(to_regprocedure('public.may_initiate_by_age(uuid,uuid)')),
  'tables', (select json_agg(json_build_object('t', table_name, 'cols', (select json_agg(column_name||' '||data_type order by ordinal_position) from information_schema.columns c where c.table_schema='public' and c.table_name=t.table_name)))
             from information_schema.tables t where table_schema='public' and table_name in ('conversations','messages','conversation_attempts','blocks')),
  'triggers', (select json_agg(tgrelid::regclass::text||': '||tgname) from pg_trigger where not tgisinternal and tgrelid::regclass::text in ('conversations','messages','conversation_attempts'))
) as messaging_defs;
