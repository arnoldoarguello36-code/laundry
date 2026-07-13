-- Staff-only products (e.g. "Gull" / kilos amarillos, an internal
-- color-coded laundry classification): visible/selectable in the
-- staff/admin manual-order sheet, but hidden from the client-facing
-- self-service order sheet. This is a NEW migration (not an amendment to
-- the T1 schema file) because T1-T6 are already applied to a live
-- production project with real customer data — amending an already-applied
-- migration in place would have no effect on production and would drift
-- local/remote state apart.

alter table public.products
  add column staff_only boolean not null default false;

-- Defense in depth: hiding staff-only products from the client-facing UI
-- (index.html's activeProducts()) is a client-side convenience only. A
-- client could otherwise still craft a direct insert into order_items
-- referencing a staff-only product id on their own order, bypassing the UI
-- entirely (order_items_insert_client previously only checked order
-- ownership, not the referenced product's visibility). Replace that policy
-- to also reject staff-only products for client-originated inserts.
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
        and p.staff_only = true
    )
  );
