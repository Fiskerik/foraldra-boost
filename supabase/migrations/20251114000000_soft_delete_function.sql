-- Allow users to soft delete their own plans via a helper function
CREATE OR REPLACE FUNCTION public.soft_delete_plan(plan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.saved_plans
  SET is_deleted = true,
      updated_at = timezone('utc', now())
  WHERE id = plan_id
    AND user_id = auth.uid()
    AND is_deleted = false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.soft_delete_plan(uuid) TO authenticated;

