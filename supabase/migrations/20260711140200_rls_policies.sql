-- T2: RLS policies for all 6 tables, per the RLS summary table in
-- docs/engineering-plan.md. RLS was already enabled (fail-closed) in T1;
-- these policies are additive (permissive, OR'd together).

-- SECURITY DEFINER helper so policies can check the caller's role without
-- re-triggering RLS on profiles (avoids recursion/perf overhead).
create or replace function public.current_profile_role()
returns text
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- ===== profiles =====
-- select: own row, or any row if staff/admin
create policy profiles_select on public.profiles
  for select
  using (
    id = auth.uid()
    or public.current_profile_role() in ('staff', 'admin')
  );

-- update: own row, or any row if admin. Column-level protection of
-- role/is_contract is enforced by the T1 BEFORE UPDATE trigger, not RLS
-- (RLS is row-level only).
create policy profiles_update on public.profiles
  for update
  using (
    id = auth.uid()
    or public.current_profile_role() = 'admin'
  )
  with check (
    id = auth.uid()
    or public.current_profile_role() = 'admin'
  );

-- no insert/delete policy: rows are created only by the T1 handle_new_user
-- trigger (SECURITY DEFINER, bypasses RLS).

-- ===== products =====
-- select: active products for everyone; all products (incl. inactive) for staff/admin
create policy products_select on public.products
  for select
  using (
    active = true
    or public.current_profile_role() in ('staff', 'admin')
  );

create policy products_insert_admin on public.products
  for insert
  with check (public.current_profile_role() = 'admin');

create policy products_update_admin on public.products
  for update
  using (public.current_profile_role() = 'admin')
  with check (public.current_profile_role() = 'admin');

create policy products_delete_admin on public.products
  for delete
  using (public.current_profile_role() = 'admin');

-- ===== settings =====
-- select: any authenticated user (client/staff/admin all need current pricing)
create policy settings_select on public.settings
  for select
  using (auth.uid() is not null);

create policy settings_update_admin on public.settings
  for update
  using (public.current_profile_role() = 'admin')
  with check (public.current_profile_role() = 'admin');

-- no insert/delete policy: the single row is seeded once via migration/service role.

-- ===== orders =====
-- select: own orders (client), or all orders (staff/admin)
create policy orders_select on public.orders
  for select
  using (
    client_id = auth.uid()
    or public.current_profile_role() in ('staff', 'admin')
  );

-- insert: client can create their own order (source='client')
create policy orders_insert_client on public.orders
  for insert
  with check (
    client_id = auth.uid()
    and source = 'client'
  );

-- insert: staff/admin can log a manual/contract order (source='staff')
create policy orders_insert_staff on public.orders
  for insert
  with check (
    public.current_profile_role() in ('staff', 'admin')
    and source = 'staff'
  );

-- update: admin only. Staff has NO direct update policy — status/note/problem
-- changes go through the T3 SECURITY DEFINER RPCs, which bypass RLS entirely
-- via the function owner's privileges.
create policy orders_update_admin on public.orders
  for update
  using (public.current_profile_role() = 'admin')
  with check (public.current_profile_role() = 'admin');

-- ===== order_items =====
-- select: items on an order the caller can see (own order, or staff/admin sees all)
create policy order_items_select on public.order_items
  for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and (o.client_id = auth.uid() or public.current_profile_role() in ('staff', 'admin'))
    )
  );

-- insert: client can add items to their own order at creation time. Not listed
-- explicitly in the plan's RLS table (which only lists order_items reads for
-- clients), but required for the approved "client submits new order" flow —
-- orders.insert already permits client-created orders, and there's no
-- create_order RPC, so item rows are inserted directly by the client.
create policy order_items_insert_client on public.order_items
  for insert
  with check (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.client_id = auth.uid()
    )
  );

-- insert/update/delete: admin only (direct). Staff writes (e.g. assign_item_price)
-- go through the T3 SECURITY DEFINER RPC, bypassing RLS.
create policy order_items_insert_admin on public.order_items
  for insert
  with check (public.current_profile_role() = 'admin');

create policy order_items_update_admin on public.order_items
  for update
  using (public.current_profile_role() = 'admin')
  with check (public.current_profile_role() = 'admin');

create policy order_items_delete_admin on public.order_items
  for delete
  using (public.current_profile_role() = 'admin');

-- ===== email_log =====
-- select: staff/admin only (never clients)
create policy email_log_select on public.email_log
  for select
  using (public.current_profile_role() in ('staff', 'admin'));

-- insert: admin only, direct. The T4/T6 Edge Function writes via the
-- service-role key, which bypasses RLS entirely and needs no policy here.
create policy email_log_insert_admin on public.email_log
  for insert
  with check (public.current_profile_role() = 'admin');
