-- Fixes a real security hole introduced by 20260829120000_client_scoped_products.sql,
-- found via live testing (crafted direct REST insert as a non-owning client
-- succeeded when it should have been rejected).
--
-- Root cause: order_items_insert_client's WITH CHECK queries public.products
-- directly ("select 1 from public.products p where p.id = ... and (...)").
-- That subquery runs as the calling role, so it is itself subject to
-- products_select RLS. 20260829120000 changed products_select to hide a
-- product from a client entirely when owner_client_id belongs to someone
-- else. That's correct for reads, but it means the SAME row becomes
-- invisible to the "not exists (... p.owner_client_id <> auth.uid())"
-- subquery too — RLS filters the row out before the WHERE clause's
-- owner-mismatch condition is even evaluated, so NOT EXISTS is vacuously
-- true and the insert is wrongly allowed. (staff_only alone never hit this,
-- because staff_only never affected products_select visibility — only
-- owner_client_id does.)
--
-- Fix: move the products check into a SECURITY DEFINER helper function
-- (same pattern as current_profile_role() in 20260711140200_rls_policies.sql),
-- so the check runs with the function owner's privileges and bypasses
-- products RLS entirely — it sees the real row regardless of the caller's
-- own visibility into it.
--
-- New migration file, not an edit to 20260829120000, for the same
-- already-applied-to-production reason documented in every other migration
-- in this project.

create or replace function public.product_orderable_by_client(p_product_id text, p_client_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select not exists (
    select 1 from public.products p
    where p.id = p_product_id
      and (
        p.staff_only = true
        or (p.owner_client_id is not null and p.owner_client_id <> p_client_id)
      )
  );
$$;

revoke execute on function public.product_orderable_by_client(text, uuid) from public;
grant execute on function public.product_orderable_by_client(text, uuid) to authenticated;

drop policy if exists order_items_insert_client on public.order_items;

create policy order_items_insert_client on public.order_items
  for insert
  with check (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.client_id = auth.uid()
    )
    and public.product_orderable_by_client(order_items.product_id, auth.uid())
  );
