-- ─── Subscription System Migration ─────────────────────────────────────────
-- Run in Supabase SQL editor.
-- Adds subscription_expires_at to estate_agents and updates RLS so that
-- listings from expired-subscription agents are hidden from the public.

-- 1. Add column
ALTER TABLE estate_agents
  ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ;

-- 2. Update properties SELECT policy
--    Public sees active listings ONLY when agent has a non-expired subscription.
--    Agents always see their own. Admin sees all.
DROP POLICY IF EXISTS "props_select_public" ON properties;
CREATE POLICY "props_select_public" ON properties FOR SELECT USING (
  (
    status = 'active'
    AND EXISTS (
      SELECT 1 FROM estate_agents ea
      WHERE ea.id = properties.agent_id
        AND ea.subscription_expires_at IS NOT NULL
        AND ea.subscription_expires_at > NOW()
    )
  )
  OR agent_id IN (SELECT id FROM estate_agents WHERE user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- 3. Update property_images SELECT policy (mirrors property visibility)
DROP POLICY IF EXISTS "images_select_public" ON property_images;
CREATE POLICY "images_select_public" ON property_images FOR SELECT USING (
  property_id IN (
    SELECT p.id FROM properties p
    JOIN estate_agents ea ON ea.id = p.agent_id
    WHERE p.status = 'active'
      AND ea.subscription_expires_at IS NOT NULL
      AND ea.subscription_expires_at > NOW()
  )
  OR property_id IN (
    SELECT p.id FROM properties p
    JOIN estate_agents ea ON ea.id = p.agent_id
    WHERE ea.user_id = auth.uid()
  )
  OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
