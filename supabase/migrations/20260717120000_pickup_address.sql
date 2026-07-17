-- Adds a free-text pickup address, captured when a client (or staff logging
-- a manual order) checks "pick up dirty laundry". Nullable — only meaningful
-- when pickup = true; the app enforces "required if pickup is checked" at
-- the UI layer, not via a DB constraint, since pickup can be toggled off
-- again after an address was once entered.

alter table public.orders
  add column if not exists pickup_address text;

-- log_manual_order gains a new trailing p_pickup_address parameter (defaulted
-- to null so any pre-existing callers with the old 8-arg signature still
-- resolve). CREATE OR REPLACE cannot add a parameter to an existing function
-- without an explicit DROP first, since the differing arg list would
-- otherwise create an ambiguous overload alongside the old signature.
drop function if exists public.log_manual_order(uuid, text, date, text, boolean, text, boolean, jsonb);

create or replace function public.log_manual_order(
  p_client_id      uuid,
  p_client_name    text,
  p_fecha          date,
  p_comentarios    text,
  p_urgent         boolean,
  p_return_method  text,
  p_pickup         boolean,
  p_items          jsonb,
  p_pickup_address text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id text;
  v_item     jsonb;
begin
  if public.current_profile_role() not in ('staff', 'admin') then
    raise exception 'not authorized';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'at least one item is required';
  end if;

  insert into public.orders
    (client_id, client_name, fecha, comentarios, estado, urgent, return_method, pickup, pickup_address, source)
  values
    (p_client_id, p_client_name, p_fecha, p_comentarios, 'en-cola', p_urgent, p_return_method, p_pickup,
     case when p_pickup then p_pickup_address else null end, 'staff')
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.order_items (order_id, product_id, qty, price_override, "desc")
    values (
      v_order_id,
      v_item ->> 'product_id',
      (v_item ->> 'qty')::numeric,
      nullif(v_item ->> 'price_override', '')::numeric,
      v_item ->> 'desc'
    );
  end loop;

  return v_order_id;
end;
$$;

revoke execute on function public.log_manual_order(uuid, text, date, text, boolean, text, boolean, jsonb, text) from public;
grant execute on function public.log_manual_order(uuid, text, date, text, boolean, text, boolean, jsonb, text) to authenticated;
