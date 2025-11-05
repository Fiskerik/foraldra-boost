-- Update the RLS policy to allow soft deletes
DROP POLICY IF EXISTS "Users can update own plans" ON public.saved_plans;

CREATE POLICY "Users can update own plans" 
ON public.saved_plans 
FOR UPDATE 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);