-- Supports the 2026-10-02 request: "in the orders interphase, I want that the
-- system load just a small amount to not overload the database." Today,
-- index.html's loadOrders() does `select * from orders` with no limit, and
-- that full-table pull is re-run constantly: once per login, again every 20s
-- for every open staff/admin tab (startPolling), and again after every single
-- order mutation (advance status, add note, flag/resolve problem, create or
-- edit an order - six separate call sites). None of those recurring reloads
-- need the WHOLE table - they only need whatever changed since the last
-- fetch.
--
-- This migration just lays the DB-side groundwork: an updated_at column that
-- actually tracks row changes, so the app can ask "give me only what changed
-- since <cursor>" instead of re-pulling everything, every time. (The
-- application-side switch to that incremental fetch is a separate index.html
-- change, not part of this migration.)
--
-- Not reusing created_at for this: created_at is intentionally stable once
-- set (it's load-bearing for the Volume/Billing reports' date filtering, see
-- 20261002100400's header) and delivered_at is intentionally null until the
-- order actually reaches 'entregado' - neither reflects "this row changed
-- just now" the way a true updated_at does.
alter table public.orders
  add column if not exists updated_at timestamptz not null default now();

-- Existing rows get updated_at = now() (this migration's run time) via the
-- column default applied at ADD COLUMN time - harmless: it just means the
-- very first incremental poll after this migration starts its cursor fresh,
-- same as a normal login's full reload already would.

create or replace function public.set_orders_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row
  execute function public.set_orders_updated_at();

-- Every mutation path already goes through a plain UPDATE (advance_order_status,
-- add_order_note, flag_problem, admin edit-order's direct table write) or a
-- plain INSERT with the column default - so this trigger alone covers every
-- existing write path with no RPC changes required.

create index if not exists orders_updated_at_idx on public.orders (updated_at);
