-- Run this in Supabase SQL Editor (Dashboard → SQL Editor)
-- Requires pg_cron and pg_net extensions — both enabled by default on Supabase.
--
-- This schedules the duty notification Edge Function to fire every day at
-- 17:00 UTC = 20:00 TRNC (UTC+3).
--
-- Replace YOUR_PROJECT_REF with your actual Supabase project ref (found in
-- Project Settings → General, e.g. "abcdefghijklmnop").
-- Replace YOUR_ANON_KEY with your project's anon/public key (found in
-- Project Settings → API).

select cron.schedule(
  'send-duty-notification',       -- job name (must be unique)
  '0 17 * * *',                   -- every day at 17:00 UTC (20:00 TRNC)
  $$
  select net.http_post(
    url     := 'https://jeihxnwqytnxtytgkzgf.supabase.co/functions/v1/send-duty-notification',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImplaWh4bndxeXRueHR5dGdremdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNzEzNTUsImV4cCI6MjA5NTc0NzM1NX0.wWYmD2R2T3mzQ_y1moIVca8cjvLOgYQjG8nz7W0vEJw'
    ),
    body    := '{}'::jsonb
  )
  $$
);

-- To verify the job was created:
-- select * from cron.job;

-- To remove it later:
-- select cron.unschedule('send-duty-notification');
