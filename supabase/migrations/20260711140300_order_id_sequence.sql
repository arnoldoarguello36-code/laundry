-- Gap-fill: T1's schema left orders.id (text PK) with no generation strategy.
-- Needed by both log_manual_order (T3, below) and the client-direct order
-- insert already permitted by T2's orders_insert_client policy — a single
-- sequence + BEFORE INSERT trigger keeps ID generation consistent across
-- both insert paths instead of duplicating "ORD-####" logic in JS and SQL.

create sequence public.order_id_seq start 1000;

create or replace function public.assign_order_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.id is null or new.id = '' then
    new.id := 'ORD-' || nextval('public.order_id_seq');
  end if;
  return new;
end;
$$;

create trigger assign_order_id_trigger
  before insert on public.orders
  for each row execute function public.assign_order_id();
