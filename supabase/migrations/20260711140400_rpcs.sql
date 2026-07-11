-- T3: staff/admin-scoped RPCs. All SECURITY DEFINER with pinned search_path.
-- SECURITY DEFINER bypasses RLS entirely, so each function does its own
-- role check internally — that check IS the access control here, not RLS.

-- ===== advance_order_status =====
-- Server computes the next state from the ESTADOS pipeline order; caller
-- cannot set an arbitrary state, only "advance one step." Sets delivered_at
-- when reaching the final state.
create or replace function public.advance_order_status(p_order_id text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_estado  text;
  v_next    text;
  v_idx     int;
  estados   text[] := array['en-cola', 'aceptado', 'en-proceso', 'listo', 'entregado'];
begin
  if public.current_profile_role() not in ('staff', 'admin') then
    raise exception 'not authorized';
  end if;

  select estado into v_estado from public.orders where id = p_order_id;
  if v_estado is null then
    raise exception 'order not found';
  end if;

  v_idx := array_position(estados, v_estado);
  if v_idx is null or v_idx = array_length(estados, 1) then
    raise exception 'order already at final status';
  end if;

  v_next := estados[v_idx + 1];

  update public.orders
  set estado = v_next,
      delivered_at = case when v_next = 'entregado' then now() else delivered_at end
  where id = p_order_id;

  return v_next;
end;
$$;

-- ===== add_order_note =====
create or replace function public.add_order_note(p_order_id text, p_note text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.current_profile_role() not in ('staff', 'admin') then
    raise exception 'not authorized';
  end if;

  update public.orders
  set notas = notas || jsonb_build_array(jsonb_build_object('text', p_note, 'at', now(), 'by', auth.uid()))
  where id = p_order_id;

  if not found then
    raise exception 'order not found';
  end if;
end;
$$;

-- ===== flag_problem =====
create or replace function public.flag_problem(p_order_id text, p_flagged boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.current_profile_role() not in ('staff', 'admin') then
    raise exception 'not authorized';
  end if;

  update public.orders set problem = p_flagged where id = p_order_id;

  if not found then
    raise exception 'order not found';
  end if;
end;
$$;

-- ===== assign_item_price =====
-- Admin only. Fires the T4 notify_price_assigned trigger (batched per order).
create or replace function public.assign_item_price(p_order_item_id uuid, p_price numeric)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.current_profile_role() <> 'admin' then
    raise exception 'not authorized';
  end if;

  if p_price < 0 then
    raise exception 'price must be non-negative';
  end if;

  update public.order_items set price_override = p_price where id = p_order_item_id;

  if not found then
    raise exception 'order item not found';
  end if;
end;
$$;

-- ===== log_manual_order =====
-- Staff/admin logs a walk-in or contract-client order (e.g. "Hótel Húsavík").
-- p_client_id is nullable — null for a pure walk-in with no account, or an
-- existing profile id for a contract client. p_items is a jsonb array of
-- {product_id, qty, price_override?, desc?}. Inserts order + items in one
-- transaction; order id comes from the assign_order_id trigger.
create or replace function public.log_manual_order(
  p_client_id     uuid,
  p_client_name   text,
  p_fecha         date,
  p_comentarios   text,
  p_urgent        boolean,
  p_return_method text,
  p_pickup        boolean,
  p_items         jsonb
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
    (client_id, client_name, fecha, comentarios, estado, urgent, return_method, pickup, source)
  values
    (p_client_id, p_client_name, p_fecha, p_comentarios, 'en-cola', p_urgent, p_return_method, p_pickup, 'staff')
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

-- Restrict to authenticated callers only (defense in depth alongside the
-- internal role checks above — anon should never reach these at all).
revoke execute on function public.advance_order_status(text) from public;
revoke execute on function public.add_order_note(text, text) from public;
revoke execute on function public.flag_problem(text, boolean) from public;
revoke execute on function public.assign_item_price(uuid, numeric) from public;
revoke execute on function public.log_manual_order(uuid, text, date, text, boolean, text, boolean, jsonb) from public;

grant execute on function public.advance_order_status(text) to authenticated;
grant execute on function public.add_order_note(text, text) to authenticated;
grant execute on function public.flag_problem(text, boolean) to authenticated;
grant execute on function public.assign_item_price(uuid, numeric) to authenticated;
grant execute on function public.log_manual_order(uuid, text, date, text, boolean, text, boolean, jsonb) to authenticated;
