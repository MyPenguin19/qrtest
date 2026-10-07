-- THALIQ core schema: extensions and enum types.

create extension if not exists "pgcrypto";

create type restaurant_role as enum (
  'owner',
  'manager',
  'waiter',
  'kitchen',
  'cashier'
);

create type restaurant_status as enum (
  'active',
  'suspended',
  'closed'
);

create type table_status as enum (
  'available',
  'occupied',
  'order_pending',
  'preparing',
  'ready',
  'bill_requested',
  'cleaning'
);

create type table_session_status as enum (
  'open',
  'bill_requested',
  'closed'
);

create type order_status as enum (
  'pending',
  'accepted',
  'preparing',
  'ready',
  'served',
  'completed',
  'cancelled'
);

create type offer_type as enum (
  'percentage',
  'flat',
  'bogo',
  'combo',
  'happy_hour'
);

create type payment_method as enum (
  'cash',
  'upi',
  'card',
  'online'
);

create type payment_status as enum (
  'pending',
  'paid',
  'failed',
  'refunded'
);

create type bill_status as enum (
  'open',
  'requested',
  'paid'
);

create type waiter_request_type as enum (
  'call_waiter',
  'water',
  'cutlery',
  'bill',
  'other'
);

create type notification_event as enum (
  'new_order',
  'waiter_request',
  'bill_request',
  'payment_received',
  'order_ready'
);

create type subscription_plan_tier as enum (
  'starter',
  'business',
  'pro'
);

create type subscription_status as enum (
  'trialing',
  'active',
  'past_due',
  'cancelled',
  'expired'
);
-- THALIQ core schema: tables.
--
-- Auth is handled by Supabase (auth.users). `profiles` mirrors the subset of
-- user data THALIQ needs and is kept in sync via the trigger at the bottom
-- of this file.

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- Platform / identity
-- ---------------------------------------------------------------------------

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function set_updated_at();

-- Platform (THALIQ) staff — separate from restaurant staff.
create table platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Restaurants, branches, membership
-- ---------------------------------------------------------------------------

create table restaurants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete restrict,
  slug text not null unique,
  name text not null,
  logo_url text,
  cover_image_url text,
  description text,
  phone text,
  website text,
  instagram text,
  cuisine_type text,
  tax_percent numeric(5, 2) not null default 0,
  service_charge_percent numeric(5, 2) not null default 0,
  status restaurant_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger restaurants_set_updated_at
  before update on restaurants
  for each row execute function set_updated_at();

create index restaurants_owner_id_idx on restaurants (owner_id);

create table branches (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  slug text not null,
  name text not null,
  address text,
  city text,
  opens_at time,
  closes_at time,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, slug)
);

create trigger branches_set_updated_at
  before update on branches
  for each row execute function set_updated_at();

create index branches_restaurant_id_idx on branches (restaurant_id);

-- Owners/managers who sign in with Supabase Auth (email/password or OTP).
create table restaurant_members (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role restaurant_role not null,
  created_at timestamptz not null default now(),
  unique (restaurant_id, user_id)
);

create index restaurant_members_user_id_idx on restaurant_members (user_id);
create index restaurant_members_restaurant_id_idx on restaurant_members (restaurant_id);

-- Restaurant staff who sign in with a role + PIN on a shared branch device.
create table staff (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  branch_id uuid references branches (id) on delete set null,
  name text not null,
  phone text,
  role restaurant_role not null,
  pin_hash text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger staff_set_updated_at
  before update on staff
  for each row execute function set_updated_at();

create index staff_restaurant_id_idx on staff (restaurant_id);
create index staff_branch_id_idx on staff (branch_id);

-- ---------------------------------------------------------------------------
-- Tables & sessions
-- ---------------------------------------------------------------------------

create table restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches (id) on delete cascade,
  label text not null,
  status table_status not null default 'available',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, label)
);

create trigger restaurant_tables_set_updated_at
  before update on restaurant_tables
  for each row execute function set_updated_at();

create index restaurant_tables_branch_id_idx on restaurant_tables (branch_id);

create table table_sessions (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references restaurant_tables (id) on delete cascade,
  status table_session_status not null default 'open',
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create index table_sessions_table_id_idx on table_sessions (table_id);
create index table_sessions_open_idx on table_sessions (table_id) where status <> 'closed';

-- ---------------------------------------------------------------------------
-- Menu
-- ---------------------------------------------------------------------------

create table menu_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger menu_categories_set_updated_at
  before update on menu_categories
  for each row execute function set_updated_at();

create index menu_categories_restaurant_id_idx on menu_categories (restaurant_id);

create table menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  category_id uuid not null references menu_categories (id) on delete cascade,
  name text not null,
  description text,
  image_url text,
  base_price numeric(10, 2) not null,
  is_veg boolean not null default true,
  is_bestseller boolean not null default false,
  is_recommended boolean not null default false,
  is_available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger menu_items_set_updated_at
  before update on menu_items
  for each row execute function set_updated_at();

create index menu_items_restaurant_id_idx on menu_items (restaurant_id);
create index menu_items_category_id_idx on menu_items (category_id);

create table menu_variants (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references menu_items (id) on delete cascade,
  name text not null,
  price numeric(10, 2) not null,
  is_default boolean not null default false,
  sort_order integer not null default 0
);

create index menu_variants_item_id_idx on menu_variants (item_id);

create table menu_addons (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references menu_items (id) on delete cascade,
  name text not null,
  price numeric(10, 2) not null,
  sort_order integer not null default 0
);

create index menu_addons_item_id_idx on menu_addons (item_id);

-- ---------------------------------------------------------------------------
-- Offers, coupons, combos
-- ---------------------------------------------------------------------------

create table offers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  name text not null,
  type offer_type not null,
  percentage_value numeric(5, 2),
  flat_value numeric(10, 2),
  starts_on date,
  ends_on date,
  starts_at time,
  ends_at time,
  days_of_week smallint[],
  min_order_value numeric(10, 2),
  max_discount_value numeric(10, 2),
  category_ids uuid[],
  item_ids uuid[],
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger offers_set_updated_at
  before update on offers
  for each row execute function set_updated_at();

create index offers_restaurant_id_idx on offers (restaurant_id);

create table coupons (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  offer_id uuid references offers (id) on delete cascade,
  code text not null,
  usage_limit integer,
  times_used integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (restaurant_id, code)
);

create index coupons_restaurant_id_idx on coupons (restaurant_id);

create table combos (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  name text not null,
  price numeric(10, 2) not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index combos_restaurant_id_idx on combos (restaurant_id);

create table combo_items (
  id uuid primary key default gen_random_uuid(),
  combo_id uuid not null references combos (id) on delete cascade,
  item_id uuid not null references menu_items (id) on delete cascade,
  quantity integer not null default 1
);

create index combo_items_combo_id_idx on combo_items (combo_id);

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------

create table customers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  name text,
  phone text,
  email text,
  created_at timestamptz not null default now(),
  unique (restaurant_id, phone)
);

create index customers_restaurant_id_idx on customers (restaurant_id);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

create table orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity,
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  branch_id uuid not null references branches (id) on delete cascade,
  table_session_id uuid references table_sessions (id) on delete set null,
  customer_id uuid references customers (id) on delete set null,
  status order_status not null default 'pending',
  subtotal numeric(10, 2) not null default 0,
  discount_amount numeric(10, 2) not null default 0,
  tax_amount numeric(10, 2) not null default 0,
  service_charge_amount numeric(10, 2) not null default 0,
  total_amount numeric(10, 2) not null default 0,
  coupon_id uuid references coupons (id) on delete set null,
  special_instructions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger orders_set_updated_at
  before update on orders
  for each row execute function set_updated_at();

create index orders_restaurant_id_idx on orders (restaurant_id);
create index orders_branch_id_idx on orders (branch_id);
create index orders_table_session_id_idx on orders (table_session_id);
create index orders_status_idx on orders (restaurant_id, status);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  item_id uuid not null references menu_items (id) on delete restrict,
  variant_id uuid references menu_variants (id) on delete set null,
  item_name text not null,
  variant_name text,
  unit_price numeric(10, 2) not null,
  quantity integer not null default 1,
  addon_selection jsonb not null default '[]'::jsonb,
  special_instructions text,
  created_at timestamptz not null default now()
);

create index order_items_order_id_idx on order_items (order_id);

create table order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  status order_status not null,
  changed_by uuid references auth.users (id) on delete set null,
  changed_by_staff_id uuid references staff (id) on delete set null,
  created_at timestamptz not null default now()
);

create index order_status_history_order_id_idx on order_status_history (order_id);

-- ---------------------------------------------------------------------------
-- Bills, payments
-- ---------------------------------------------------------------------------

create table bills (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  branch_id uuid not null references branches (id) on delete cascade,
  table_session_id uuid not null references table_sessions (id) on delete cascade,
  status bill_status not null default 'open',
  total_amount numeric(10, 2) not null default 0,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create index bills_table_session_id_idx on bills (table_session_id);

create table payments (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  bill_id uuid references bills (id) on delete set null,
  order_id uuid references orders (id) on delete set null,
  method payment_method not null,
  status payment_status not null default 'pending',
  amount numeric(10, 2) not null,
  recorded_by uuid references auth.users (id) on delete set null,
  recorded_by_staff_id uuid references staff (id) on delete set null,
  created_at timestamptz not null default now()
);

create index payments_restaurant_id_idx on payments (restaurant_id);
create index payments_bill_id_idx on payments (bill_id);

-- ---------------------------------------------------------------------------
-- Waiter requests, notifications, staff devices
-- ---------------------------------------------------------------------------

create table waiter_requests (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches (id) on delete cascade,
  table_id uuid not null references restaurant_tables (id) on delete cascade,
  type waiter_request_type not null,
  note text,
  resolved_at timestamptz,
  resolved_by_staff_id uuid references staff (id) on delete set null,
  created_at timestamptz not null default now()
);

create index waiter_requests_branch_id_idx on waiter_requests (branch_id);
create index waiter_requests_open_idx on waiter_requests (branch_id) where resolved_at is null;

create table notifications (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  branch_id uuid references branches (id) on delete cascade,
  event notification_event not null,
  title text not null,
  body text,
  reference_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_restaurant_id_idx on notifications (restaurant_id);
create index notifications_unread_idx on notifications (restaurant_id) where read_at is null;

create table staff_devices (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid references staff (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  push_subscription jsonb not null,
  created_at timestamptz not null default now(),
  check (staff_id is not null or user_id is not null)
);

create index staff_devices_staff_id_idx on staff_devices (staff_id);
create index staff_devices_user_id_idx on staff_devices (user_id);

-- ---------------------------------------------------------------------------
-- QR codes, templates, branding
-- ---------------------------------------------------------------------------

create table qr_codes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  branch_id uuid references branches (id) on delete cascade,
  table_id uuid references restaurant_tables (id) on delete cascade,
  label text not null,
  target_url text not null,
  created_at timestamptz not null default now()
);

create index qr_codes_restaurant_id_idx on qr_codes (restaurant_id);

create table templates (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  is_premium boolean not null default false,
  preview_image_url text
);

create table restaurant_themes (
  restaurant_id uuid primary key references restaurants (id) on delete cascade,
  template_id uuid references templates (id) on delete set null,
  primary_color text,
  secondary_color text,
  font_family text,
  updated_at timestamptz not null default now()
);

create trigger restaurant_themes_set_updated_at
  before update on restaurant_themes
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Feedback, loyalty
-- ---------------------------------------------------------------------------

create table feedback (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  order_id uuid references orders (id) on delete set null,
  food_rating smallint check (food_rating between 1 and 5),
  service_rating smallint check (service_rating between 1 and 5),
  experience_rating smallint check (experience_rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

create index feedback_restaurant_id_idx on feedback (restaurant_id);

create table loyalty_points (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  customer_id uuid not null references customers (id) on delete cascade,
  points integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (restaurant_id, customer_id)
);

-- ---------------------------------------------------------------------------
-- Subscriptions (SaaS billing)
-- ---------------------------------------------------------------------------

create table subscription_plans (
  id uuid primary key default gen_random_uuid(),
  tier subscription_plan_tier not null unique,
  name text not null,
  monthly_price numeric(10, 2) not null,
  max_branches integer,
  max_staff integer,
  features jsonb not null default '{}'::jsonb
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  plan_id uuid not null references subscription_plans (id) on delete restrict,
  status subscription_status not null default 'trialing',
  trial_ends_at timestamptz,
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger subscriptions_set_updated_at
  before update on subscriptions
  for each row execute function set_updated_at();

create index subscriptions_restaurant_id_idx on subscriptions (restaurant_id);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references subscriptions (id) on delete cascade,
  amount numeric(10, 2) not null,
  status payment_status not null default 'pending',
  provider_reference text,
  created_at timestamptz not null default now()
);

create index transactions_subscription_id_idx on transactions (subscription_id);

-- ---------------------------------------------------------------------------
-- Keep profiles in sync with auth.users
-- ---------------------------------------------------------------------------

create or replace function handle_new_auth_user()
returns trigger as $$
begin
  insert into profiles (id, full_name, phone)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.phone)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();
-- THALIQ RLS policies.
--
-- Critical rule (PRD section 51): Restaurant A must never be able to access
-- Restaurant B's data.
--
-- Two access paths exist:
--   1. Supabase Auth sessions — restaurant owners/managers signed in with
--      email/password or OTP. `auth.uid()` identifies them and policies
--      below scope every row to the restaurant(s) they belong to via
--      `restaurant_members`.
--   2. Restaurant staff (waiter/kitchen/cashier) sign in with a role + PIN
--      on a shared device, which is NOT a Supabase Auth session. Staff
--      requests are authenticated and authorized in the Next.js server
--      layer (Server Actions / Route Handlers) using the service role key,
--      after validating a signed staff-session cookie. The same is true for
--      customer-initiated writes (placing an order, requesting the bill,
--      submitting feedback) — the anon key is read-only for public menu
--      data; every write and every "give me my own order status" read goes
--      through a server-side handler that checks a table/order token
--      before touching the service-role client. This avoids relying on RLS
--      to express "only if you know this UUID", which Postgres row
--      security cannot do safely for anon/public roles.

-- ---------------------------------------------------------------------------
-- Helper functions (security definer to avoid RLS recursion)
-- ---------------------------------------------------------------------------

create or replace function is_platform_admin()
returns boolean as $$
  select exists (
    select 1 from platform_admins where user_id = auth.uid()
  );
$$ language sql stable security definer set search_path = public;

create or replace function is_restaurant_member(target_restaurant_id uuid)
returns boolean as $$
  select exists (
    select 1 from restaurant_members
    where restaurant_id = target_restaurant_id and user_id = auth.uid()
  );
$$ language sql stable security definer set search_path = public;

create or replace function is_restaurant_manager(target_restaurant_id uuid)
returns boolean as $$
  select exists (
    select 1 from restaurant_members
    where restaurant_id = target_restaurant_id
      and user_id = auth.uid()
      and role in ('owner', 'manager')
  );
$$ language sql stable security definer set search_path = public;

create or replace function branch_restaurant_id(target_branch_id uuid)
returns uuid as $$
  select restaurant_id from branches where id = target_branch_id;
$$ language sql stable security definer set search_path = public;

create or replace function table_restaurant_id(target_table_id uuid)
returns uuid as $$
  select b.restaurant_id
  from restaurant_tables t
  join branches b on b.id = t.branch_id
  where t.id = target_table_id;
$$ language sql stable security definer set search_path = public;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------

alter table profiles enable row level security;
alter table platform_admins enable row level security;
alter table restaurants enable row level security;
alter table branches enable row level security;
alter table restaurant_members enable row level security;
alter table staff enable row level security;
alter table restaurant_tables enable row level security;
alter table table_sessions enable row level security;
alter table menu_categories enable row level security;
alter table menu_items enable row level security;
alter table menu_variants enable row level security;
alter table menu_addons enable row level security;
alter table offers enable row level security;
alter table coupons enable row level security;
alter table combos enable row level security;
alter table combo_items enable row level security;
alter table customers enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table order_status_history enable row level security;
alter table bills enable row level security;
alter table payments enable row level security;
alter table waiter_requests enable row level security;
alter table notifications enable row level security;
alter table staff_devices enable row level security;
alter table qr_codes enable row level security;
alter table templates enable row level security;
alter table restaurant_themes enable row level security;
alter table feedback enable row level security;
alter table loyalty_points enable row level security;
alter table subscription_plans enable row level security;
alter table subscriptions enable row level security;
alter table transactions enable row level security;

-- ---------------------------------------------------------------------------
-- profiles / platform_admins
-- ---------------------------------------------------------------------------

create policy "profiles_select_own" on profiles for select
  using (id = auth.uid() or is_platform_admin());

create policy "profiles_update_own" on profiles for update
  using (id = auth.uid());

create policy "platform_admins_select_self" on platform_admins for select
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- restaurants / branches
-- ---------------------------------------------------------------------------

create policy "restaurants_public_read" on restaurants for select
  using (status = 'active' or is_restaurant_member(id) or is_platform_admin());

-- Bootstrap case: a freshly signed-up owner has no restaurant_members row
-- yet, so is_restaurant_manager() cannot pass. Allow creating a restaurant
-- they immediately own; membership is granted right after (see the
-- restaurant_members bootstrap policy below).
create policy "restaurants_insert_self" on restaurants for insert
  with check (owner_id = auth.uid());

create policy "restaurants_member_update" on restaurants for update
  using (is_restaurant_manager(id) or is_platform_admin())
  with check (is_restaurant_manager(id) or is_platform_admin());

create policy "restaurants_member_delete" on restaurants for delete
  using (is_restaurant_manager(id) or is_platform_admin());

create policy "branches_public_read" on branches for select
  using (is_active or is_restaurant_member(restaurant_id) or is_platform_admin());

create policy "branches_manager_manage" on branches for all
  using (is_restaurant_manager(restaurant_id) or is_platform_admin())
  with check (is_restaurant_manager(restaurant_id) or is_platform_admin());

-- ---------------------------------------------------------------------------
-- restaurant_members / staff
-- ---------------------------------------------------------------------------

create policy "restaurant_members_select" on restaurant_members for select
  using (user_id = auth.uid() or is_restaurant_manager(restaurant_id) or is_platform_admin());

-- Bootstrap case: lets a user who just created a restaurant (restaurants.
-- owner_id = auth.uid()) grant themselves the 'owner' membership row. Every
-- subsequent invite (adding a manager, etc.) goes through the policy below
-- instead, once an owner/manager membership already exists.
create policy "restaurant_members_owner_bootstrap" on restaurant_members for insert
  with check (
    user_id = auth.uid()
    and role = 'owner'
    and exists (
      select 1 from restaurants r
      where r.id = restaurant_id and r.owner_id = auth.uid()
    )
  );

create policy "restaurant_members_manage" on restaurant_members for all
  using (is_restaurant_manager(restaurant_id) or is_platform_admin())
  with check (is_restaurant_manager(restaurant_id) or is_platform_admin());

create policy "staff_manager_manage" on staff for all
  using (is_restaurant_manager(restaurant_id) or is_platform_admin())
  with check (is_restaurant_manager(restaurant_id) or is_platform_admin());

-- ---------------------------------------------------------------------------
-- tables / sessions (public read for QR resolution, member manage)
-- ---------------------------------------------------------------------------

create policy "restaurant_tables_public_read" on restaurant_tables for select
  using (true);

create policy "restaurant_tables_member_manage" on restaurant_tables for all
  using (is_restaurant_member(branch_restaurant_id(branch_id)) or is_platform_admin())
  with check (is_restaurant_member(branch_restaurant_id(branch_id)) or is_platform_admin());

create policy "table_sessions_member_read" on table_sessions for select
  using (is_restaurant_member(table_restaurant_id(table_id)) or is_platform_admin());

create policy "table_sessions_member_manage" on table_sessions for all
  using (is_restaurant_member(table_restaurant_id(table_id)) or is_platform_admin())
  with check (is_restaurant_member(table_restaurant_id(table_id)) or is_platform_admin());

-- ---------------------------------------------------------------------------
-- menu (public read of available items, member manage)
-- ---------------------------------------------------------------------------

create policy "menu_categories_public_read" on menu_categories for select
  using (true);

create policy "menu_categories_member_manage" on menu_categories for all
  using (is_restaurant_member(restaurant_id) or is_platform_admin())
  with check (is_restaurant_member(restaurant_id) or is_platform_admin());

create policy "menu_items_public_read" on menu_items for select
  using (true);

create policy "menu_items_member_manage" on menu_items for all
  using (is_restaurant_member(restaurant_id) or is_platform_admin())
  with check (is_restaurant_member(restaurant_id) or is_platform_admin());

create policy "menu_variants_public_read" on menu_variants for select
  using (true);

create policy "menu_variants_member_manage" on menu_variants for all
  using (
    is_restaurant_member((select restaurant_id from menu_items where id = item_id))
    or is_platform_admin()
  )
  with check (
    is_restaurant_member((select restaurant_id from menu_items where id = item_id))
    or is_platform_admin()
  );

create policy "menu_addons_public_read" on menu_addons for select
  using (true);

create policy "menu_addons_member_manage" on menu_addons for all
  using (
    is_restaurant_member((select restaurant_id from menu_items where id = item_id))
    or is_platform_admin()
  )
  with check (
    is_restaurant_member((select restaurant_id from menu_items where id = item_id))
    or is_platform_admin()
  );

-- ---------------------------------------------------------------------------
-- offers, coupons, combos (public read of active offers, member manage)
-- ---------------------------------------------------------------------------

create policy "offers_public_read" on offers for select
  using (is_active);

create policy "offers_member_manage" on offers for all
  using (is_restaurant_member(restaurant_id) or is_platform_admin())
  with check (is_restaurant_member(restaurant_id) or is_platform_admin());

create policy "coupons_member_only" on coupons for all
  using (is_restaurant_member(restaurant_id) or is_platform_admin())
  with check (is_restaurant_member(restaurant_id) or is_platform_admin());

create policy "combos_public_read" on combos for select
  using (is_active);

create policy "combos_member_manage" on combos for all
  using (is_restaurant_member(restaurant_id) or is_platform_admin())
  with check (is_restaurant_member(restaurant_id) or is_platform_admin());

create policy "combo_items_public_read" on combo_items for select
  using (true);

create policy "combo_items_member_manage" on combo_items for all
  using (
    is_restaurant_member((select restaurant_id from combos where id = combo_id))
    or is_platform_admin()
  )
  with check (
    is_restaurant_member((select restaurant_id from combos where id = combo_id))
    or is_platform_admin()
  );

-- ---------------------------------------------------------------------------
-- customers, orders, order_items, order_status_history — member only.
-- Customer-facing order placement and tracking go through server-side
-- handlers using the service role key (see comment at top of file).
-- ---------------------------------------------------------------------------

create policy "customers_member_only" on customers for all
  using (is_restaurant_member(restaurant_id) or is_platform_admin())
  with check (is_restaurant_member(restaurant_id) or is_platform_admin());

create policy "orders_member_only" on orders for all
  using (is_restaurant_member(restaurant_id) or is_platform_admin())
  with check (is_restaurant_member(restaurant_id) or is_platform_admin());

create policy "order_items_member_only" on order_items for all
  using (
    is_restaurant_member((select restaurant_id from orders where id = order_id))
    or is_platform_admin()
  )
  with check (
    is_restaurant_member((select restaurant_id from orders where id = order_id))
    or is_platform_admin()
  );

create policy "order_status_history_member_only" on order_status_history for all
  using (
    is_restaurant_member((select restaurant_id from orders where id = order_id))
    or is_platform_admin()
  )
  with check (
    is_restaurant_member((select restaurant_id from orders where id = order_id))
    or is_platform_admin()
  );

-- ---------------------------------------------------------------------------
-- bills, payments — member only
-- ---------------------------------------------------------------------------

create policy "bills_member_only" on bills for all
  using (is_restaurant_member(restaurant_id) or is_platform_admin())
  with check (is_restaurant_member(restaurant_id) or is_platform_admin());

create policy "payments_member_only" on payments for all
  using (is_restaurant_member(restaurant_id) or is_platform_admin())
  with check (is_restaurant_member(restaurant_id) or is_platform_admin());

-- ---------------------------------------------------------------------------
-- waiter requests, notifications, staff devices — member only
-- ---------------------------------------------------------------------------

create policy "waiter_requests_member_only" on waiter_requests for all
  using (is_restaurant_member(branch_restaurant_id(branch_id)) or is_platform_admin())
  with check (is_restaurant_member(branch_restaurant_id(branch_id)) or is_platform_admin());

create policy "notifications_member_only" on notifications for all
  using (is_restaurant_member(restaurant_id) or is_platform_admin())
  with check (is_restaurant_member(restaurant_id) or is_platform_admin());

create policy "staff_devices_own_or_manager" on staff_devices for all
  using (
    user_id = auth.uid()
    or is_platform_admin()
    or is_restaurant_manager((select restaurant_id from staff where id = staff_id))
  )
  with check (
    user_id = auth.uid()
    or is_platform_admin()
    or is_restaurant_manager((select restaurant_id from staff where id = staff_id))
  );

-- ---------------------------------------------------------------------------
-- qr_codes, templates, restaurant_themes
-- ---------------------------------------------------------------------------

create policy "qr_codes_member_only" on qr_codes for all
  using (is_restaurant_member(restaurant_id) or is_platform_admin())
  with check (is_restaurant_member(restaurant_id) or is_platform_admin());

create policy "templates_public_read" on templates for select
  using (true);

create policy "templates_platform_admin_manage" on templates for insert
  with check (is_platform_admin());

create policy "templates_platform_admin_update" on templates for update
  using (is_platform_admin());

create policy "templates_platform_admin_delete" on templates for delete
  using (is_platform_admin());

create policy "restaurant_themes_public_read" on restaurant_themes for select
  using (true);

create policy "restaurant_themes_member_manage" on restaurant_themes for insert
  with check (is_restaurant_member(restaurant_id) or is_platform_admin());

create policy "restaurant_themes_member_update" on restaurant_themes for update
  using (is_restaurant_member(restaurant_id) or is_platform_admin());

create policy "restaurant_themes_member_delete" on restaurant_themes for delete
  using (is_restaurant_member(restaurant_id) or is_platform_admin());

-- ---------------------------------------------------------------------------
-- feedback, loyalty
-- ---------------------------------------------------------------------------

create policy "feedback_member_only" on feedback for all
  using (is_restaurant_member(restaurant_id) or is_platform_admin())
  with check (is_restaurant_member(restaurant_id) or is_platform_admin());

create policy "loyalty_points_member_only" on loyalty_points for all
  using (is_restaurant_member(restaurant_id) or is_platform_admin())
  with check (is_restaurant_member(restaurant_id) or is_platform_admin());

-- ---------------------------------------------------------------------------
-- subscriptions / billing
-- ---------------------------------------------------------------------------

create policy "subscription_plans_public_read" on subscription_plans for select
  using (true);

create policy "subscription_plans_platform_admin_manage" on subscription_plans for insert
  with check (is_platform_admin());

create policy "subscription_plans_platform_admin_update" on subscription_plans for update
  using (is_platform_admin());

create policy "subscription_plans_platform_admin_delete" on subscription_plans for delete
  using (is_platform_admin());

create policy "subscriptions_owner_read" on subscriptions for select
  using (is_restaurant_manager(restaurant_id) or is_platform_admin());

create policy "subscriptions_platform_admin_manage" on subscriptions for insert
  with check (is_platform_admin());

create policy "subscriptions_platform_admin_update" on subscriptions for update
  using (is_platform_admin());

create policy "subscriptions_platform_admin_delete" on subscriptions for delete
  using (is_platform_admin());

create policy "transactions_owner_read" on transactions for select
  using (
    is_platform_admin()
    or is_restaurant_manager(
      (select restaurant_id from subscriptions where id = subscription_id)
    )
  );

create policy "transactions_platform_admin_manage" on transactions for insert
  with check (is_platform_admin());

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
--
-- RLS policies above are the real access-control boundary. These grants
-- just make the schema self-sufficient on any Postgres instance — a
-- hosted Supabase project already configures equivalent default privileges
-- for `anon`/`authenticated`/`service_role` on the public schema, but we
-- don't want migration correctness to depend on that being true.

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all routines in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on routines to anon, authenticated, service_role;
-- Reference data: subscription plans and menu templates (PRD sections 32, 47).

insert into subscription_plans (tier, name, monthly_price, max_branches, max_staff, features)
values
  ('starter', 'Starter', 499, 1, 5, jsonb_build_object(
    'templates', 'limited',
    'offers', 'limited',
    'kitchen_display', false,
    'analytics', 'basic',
    'whatsapp', false,
    'loyalty', false,
    'multi_branch', false,
    'white_label', false
  )),
  ('business', 'Business', 999, 1, 20, jsonb_build_object(
    'templates', 'full',
    'offers', 'full',
    'kitchen_display', true,
    'analytics', 'advanced',
    'whatsapp', false,
    'loyalty', false,
    'multi_branch', false,
    'white_label', false
  )),
  ('pro', 'Pro', 1999, null, null, jsonb_build_object(
    'templates', 'full',
    'offers', 'full',
    'kitchen_display', true,
    'analytics', 'advanced',
    'whatsapp', true,
    'loyalty', true,
    'multi_branch', true,
    'white_label', true
  ))
on conflict (tier) do nothing;

insert into templates (slug, name, is_premium)
values
  ('minimal', 'Minimal', false),
  ('classic', 'Classic', false),
  ('modern', 'Modern', false),
  ('luxury', 'Luxury', true),
  ('premium-dark', 'Premium Dark', true),
  ('cafe', 'Cafe', true),
  ('indian', 'Indian', true),
  ('fast-food', 'Fast Food', true),
  ('coffee', 'Coffee', true),
  ('fine-dining', 'Fine Dining', true),
  ('editorial', 'Editorial', true)
on conflict (slug) do nothing;
-- Atomic coupon usage increment, called from the order-placement server
-- action via the service-role client (customers never touch this table
-- directly).

create or replace function increment_coupon_usage(p_coupon_id uuid)
returns void as $$
  update coupons set times_used = times_used + 1 where id = p_coupon_id;
$$ language sql security definer set search_path = public;

grant execute on function increment_coupon_usage(uuid) to service_role;
-- Storage buckets for menu item photos and restaurant branding.
--
-- Layout: every object is stored under the owning restaurant's id, e.g.
--   menu-images/<restaurant_id>/<uuid>.webp
--   restaurant-branding/<restaurant_id>/logo-<uuid>.webp
--
-- The first path segment is what the policies below check, so Restaurant A
-- can never overwrite or delete Restaurant B's images (PRD section 51's
-- isolation rule applies to files, not just rows).
--
-- Both buckets are public-read: customers scanning a QR code are anonymous
-- and must be able to load menu photos without a session. Nothing sensitive
-- goes in these buckets.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'menu-images',
    'menu-images',
    true,
    2097152, -- 2 MB; the client compresses to well under this before upload
    array['image/webp', 'image/jpeg', 'image/png']
  ),
  (
    'restaurant-branding',
    'restaurant-branding',
    true,
    2097152,
    array['image/webp', 'image/jpeg', 'image/png']
  )
on conflict (id) do nothing;

-- Helper: is the caller an owner/manager of the restaurant whose id is the
-- first folder segment of this object's path?
--
-- The segment is regex-checked before casting: a path like "junk/x.webp"
-- would otherwise raise invalid_text_representation, and an exception inside
-- a policy fails the whole statement rather than simply denying the write.
create or replace function owns_storage_object_restaurant(object_name text)
returns boolean as $$
declare
  segment text := split_part(object_name, '/', 1);
begin
  if segment !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return false;
  end if;

  return is_restaurant_manager(segment::uuid);
end;
$$ language plpgsql stable security definer set search_path = public;

-- Public read for both buckets.
create policy "menu_images_public_read" on storage.objects for select
  using (bucket_id in ('menu-images', 'restaurant-branding'));

-- Writes are restricted to the restaurant's own folder.
create policy "menu_images_manager_insert" on storage.objects for insert
  with check (
    bucket_id in ('menu-images', 'restaurant-branding')
    and owns_storage_object_restaurant(name)
  );

create policy "menu_images_manager_update" on storage.objects for update
  using (
    bucket_id in ('menu-images', 'restaurant-branding')
    and owns_storage_object_restaurant(name)
  );

create policy "menu_images_manager_delete" on storage.objects for delete
  using (
    bucket_id in ('menu-images', 'restaurant-branding')
    and owns_storage_object_restaurant(name)
  );
-- UPI collection details for in-person payment (PRD section 35's MVP scope:
-- cash / UPI / card with a manually recorded status).
--
-- No payment gateway is involved: THALIQ builds a standard `upi://pay` deep
-- link from these fields and renders it as a QR. The customer's UPI app pays
-- the restaurant directly, so there is nothing to settle, no per-transaction
-- fee, and no gateway account to onboard. The cashier still confirms receipt
-- manually, exactly like cash.

alter table restaurants
  add column if not exists upi_id text,
  add column if not exists upi_display_name text;

comment on column restaurants.upi_id is
  'UPI VPA (e.g. restaurant@okhdfcbank) used to build upi://pay QR codes.';

-- Restrict privileged writes to the server and pin trigger search paths.
revoke execute on function public.increment_coupon_usage(uuid) from public, anon, authenticated;
grant execute on function public.increment_coupon_usage(uuid) to service_role;
alter function public.set_updated_at() set search_path = public;
-- RLS does not protect TRUNCATE, REFERENCES, or TRIGGER privileges.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;
