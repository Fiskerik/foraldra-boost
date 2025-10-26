-- Create profiles table
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  full_name text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.profiles enable row level security;

-- Users can view own profile
create policy "Users can view own profile"
  on profiles for select
  using (auth.uid() = id);

-- Users can update own profile
create policy "Users can update own profile"
  on profiles for update
  using (auth.uid() = id);

-- Trigger to create profile on signup
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Create saved_plans table
create table public.saved_plans (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  name text not null default 'Min föräldraledighetsplan',
  
  -- Plan metadata
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  expected_birth_date date not null,
  
  -- Parent 1 data
  parent1_income numeric not null,
  parent1_has_agreement boolean not null,
  
  -- Parent 2 data
  parent2_income numeric not null,
  parent2_has_agreement boolean not null,
  
  -- Shared settings
  municipality text not null,
  tax_rate numeric not null,
  total_months integer not null,
  parent1_months integer not null,
  household_income numeric not null,
  days_per_week integer not null,
  simultaneous_leave boolean not null default false,
  simultaneous_months integer not null default 0,
  
  -- Selected strategy and results
  selected_strategy_index integer not null default 0,
  optimization_results jsonb not null,
  
  -- Soft delete
  is_deleted boolean not null default false
);

alter table public.saved_plans enable row level security;

-- Users can view own plans
create policy "Users can view own plans"
  on saved_plans for select
  using (auth.uid() = user_id and is_deleted = false);

-- Users can insert own plans
create policy "Users can insert own plans"
  on saved_plans for insert
  with check (auth.uid() = user_id);

-- Users can update own plans
create policy "Users can update own plans"
  on saved_plans for update
  using (auth.uid() = user_id);

-- Trigger to update updated_at
create function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger on_plan_updated
  before update on saved_plans
  for each row execute procedure public.handle_updated_at();