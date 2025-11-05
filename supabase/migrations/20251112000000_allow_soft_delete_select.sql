-- Allow users to select their own soft-deleted plans so that updates can succeed
ALTER TABLE public.saved_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_soft_deleted_plans" ON public.saved_plans;
CREATE POLICY "select_soft_deleted_plans"
ON public.saved_plans
FOR SELECT
USING (auth.uid() = user_id AND is_deleted = true);
