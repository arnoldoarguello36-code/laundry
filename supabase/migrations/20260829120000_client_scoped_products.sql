-- Client-scoped ("customer-exclusive") products: in addition to today's
-- global catalog (owner_client_id is null, visible to every client), a
-- product can now be scoped to exactly one client via owner_client_id —
-- visible only to that client (plus staff/admin, who already see every
-- product regardless of active/staff_only/ownership). Lets staff give a
-- specific customer (e.g. a hotel with its own branded linens) a private
-- item alongside the shared catalog everyone else also sees.
--
-- This is a NEW migration file, not an amendment to T1 or the staff_only
-- migration, for the same reason given in 20260712150000_staff_only_products.sql:
-- this project's migrations are already applied to a live production
-- project with real customer data — editing an already-applied migration
-- file in place would have no effect on production and would drift
-- local/remote state apart.

alter table public.products
  add column owner_client_id uuid references public.profiles(id) on delete cascade;

-- Hit on every products_select / order_items_insert_client policy check below.
create index products_owner_client_id_idx on public.products(owner_client_id);

-- Defense in depth, same shape/reasoning as staff_only_products.sql: hiding
-- another client's exclusive products from the UI (index.html's
-- activeProducts()) is a client-side convenience only. Replace both
-- products_select and order_items_insert_client so a client can't list or
-- order another client's exclusive product even via a crafted direct
-- request that bypasses the UI entirely.
drop policy if exists products_select on public.products;

create policy products_select on public.products
  for select
  using (
    (
      active = true
      and (owner_client_id is null or owner_client_id = auth.uid())
    )
    or public.current_profile_role() in ('staff', 'admin')
  );

drop policy if exists order_items_insert_client on public.order_items;

create policy order_items_insert_client on public.order_items
  for insert
  with check (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.client_id = auth.uid()
    )
    and not exists (
      select 1 from public.products p
      where p.id = order_items.product_id
        and (
          p.staff_only = true
          or (p.owner_client_id is not null and p.owner_client_id <> auth.uid())
        )
    )
  );
