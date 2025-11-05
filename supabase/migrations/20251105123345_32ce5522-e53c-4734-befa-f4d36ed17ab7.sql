-- Ensure RLS is correctly configured to allow soft deletes by owners
ALTER TABLE public.saved_plans ENABLE ROW LEVEL SECURITY;

-- Drop conflicting/old policies if they exist
DROP POLICY IF EXISTS "select_own_plans" ON public.saved_plans;
DROP POLICY IF EXISTS "insert_own_plans" ON public.saved_plans;
DROP POLICY IF EXISTS "update_own_plans" ON public.saved_plans;
DROP POLICY IF EXISTS "delete_own_plans" ON public.saved_plans;
DROP POLICY IF EXISTS "Users can update own plans" ON public.saved_plans;

-- Allow users to read their own non-deleted plans
CREATE POLICY "select_own_plans"
ON public.saved_plans
FOR SELECT
USING (auth.uid() = user_id AND is_deleted = false);

-- Allow users to insert their own plans
CREATE POLICY "insert_own_plans"
ON public.saved_plans
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Allow users to update their own plans (including setting is_deleted = true)
CREATE POLICY "update_own_plans"
ON public.saved_plans
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Optional: allow hard delete of own rows (we still soft-delete in app)
CREATE POLICY "delete_own_plans"
ON public.saved_plans
FOR DELETE
USING (auth.uid() = user_id);