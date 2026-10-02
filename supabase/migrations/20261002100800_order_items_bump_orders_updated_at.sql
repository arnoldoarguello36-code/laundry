-- Fixes a gap in 20261002100700's incremental-sync support (ship-time
-- adversarial review, 2026-10-02): orders.updated_at only had a trigger on
-- `orders` itself. Two real write paths touch `order_items` directly without
-- ever updating the parent `orders` row:
--   1. assign_item_price() (T3 RPC, 20260711140400) - admin "assign quote
--      price" for an 'other' item. `update order_items set price_override =
--      ... where id = p_order_item_id` never touches orders.
--   2. The admin "Edit order" save handler (index.html, sheetMode==='edit')
--      inserts/updates/deletes order_items rows directly (no RPC - see that
--      handler's own comment on why it's a plain table write).
-- Both call sites were switched from loadOrders() to loadOrdersIncremental()
-- as part of this same branch's incremental-sync change. Without this
-- trigger, orders.updated_at never advances when only its order_items
-- change, so loadOrdersIncremental()'s `.gt('updated_at', queryFloor)` query
-- returns nothing for that order - the admin's own screen silently keeps
-- showing the stale pre-edit price/items until something else unrelated
-- bumps that order's updated_at, or a full reload/login happens.
--
-- Fires on INSERT/UPDATE/DELETE so every order_items write path is covered,
-- not just the two known today - any future order_items write gets correct
-- incremental-sync visibility for free.
--
-- SECURITY DEFINER (follow-up, ship-time adversarial re-review, 2026-10-02):
-- without it this function runs as the invoking role, and its `update orders`
-- is itself subject to orders_update_admin RLS (admin-role only, see
-- 20260711140200). Both write paths named above happen to pass today (the
-- RPC runs as a definer that owns the table; the admin UI's own session role
-- really is admin) - but a plain client's own order_items INSERT (allowed by
-- order_items_insert_client, 20260711140200) would fire this trigger as that
-- client's non-admin role, and the cross-table UPDATE on `orders` would be
-- silently filtered to 0 rows by RLS - no error, just a quiet no-op that
-- breaks this migration's own "every future order_items write path is
-- covered" claim. Matches this codebase's established convention: every
-- other cross-table-write trigger (handle_new_user/protect_profile_role_
-- columns in 20260711140100, the notification triggers in 20260711140500,
-- assign_order_id in 20260711140300) is SECURITY DEFINER with pinned
-- search_path. search_path is already pinned below, so this adds no new
-- schema-injection surface - the function's only effect is a hardcoded
-- `updated_at = now()` keyed by the row's own order_id.
create or replace function public.bump_order_updated_at_from_item()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.orders
  set updated_at = now()
  where id = coalesce(new.order_id, old.order_id);
  return coalesce(new, old);
end;
$$;

drop trigger if exists order_items_bump_order_updated_at on public.order_items;
create trigger order_items_bump_order_updated_at
  after insert or update or delete on public.order_items
  for each row
  execute function public.bump_order_updated_at_from_item();

-- Note: this UPDATE on `orders` re-fires orders_set_updated_at (20261002100700)
-- too, but that trigger just sets new.updated_at = now() again on the same
-- row in the same statement - harmless, not a recursive loop (it's a trigger
-- on `orders`, not `order_items`).
