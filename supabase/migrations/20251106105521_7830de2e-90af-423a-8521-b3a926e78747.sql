-- Create secure soft delete function for saved_plans
create or replace function public.soft_delete_plan(plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Ensure only the owner can delete their plan
  update public.saved_plans
  set is_deleted = true,
      updated_at = now()
  where id = plan_id
    and user_id = auth.uid();

  if not found then
    raise exception 'Plan not found or not owned by user';
  end if;
end;
$$;

-- Allow authenticated users to execute the function
grant execute on function public.soft_delete_plan(uuid) to authenticated;