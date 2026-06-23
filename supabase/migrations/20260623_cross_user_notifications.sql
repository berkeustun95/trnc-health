-- Allow authenticated callers to insert a notification for any user_id.
-- Runs as the function owner (SECURITY DEFINER) to bypass RLS on the
-- notifications table, which normally restricts inserts to own rows.
CREATE OR REPLACE FUNCTION public.insert_notification(
  p_user_id uuid,
  p_title   text,
  p_body    text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO notifications (user_id, title, body)
  VALUES (p_user_id, p_title, p_body);
$$;
